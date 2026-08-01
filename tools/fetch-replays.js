#!/usr/bin/env node
// Fetch the other tables' replays for a BBO history export and fold them back
// into the JSON.
//
// The extension's #bcdev-mega export captures every table's contract, result
// and score, but auction and cardplay only for your own table — the LIN it
// parses comes from your personal hands list, which holds just your seat. The
// other tables' replays are reachable at fetchlin.php, keyed by the myhand ID
// already present on every result row's handviewer_url.
//
// That endpoint needs no authentication, which is why this runs outside the
// browser: the extension's part (tournament listing, hands lists, travellers)
// is session-bound and takes ~20 minutes, while this part is public, rate
// limited to roughly one request per two seconds, and takes days. Splitting
// them lets this half run detached and resume after interruption.
//
//   node tools/fetch-replays.js fetch  bbo-history-user-2026-08-01.json
//   node tools/fetch-replays.js merge  bbo-history-user-2026-08-01.json
//   node tools/fetch-replays.js status bbo-history-user-2026-08-01.json
//
// Work is journalled to <input>.replays.jsonl as it completes, so an
// interrupted run resumes where it stopped instead of restarting. Ctrl-C stops
// cleanly. See --help for the throttle knobs; they can also be changed while a
// run is in flight by editing <input>.knobs.json.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { parseLin } from '../src/adapters/bbo/parsers/lin.js'

const FETCHLIN = 'https://www.bridgebase.com/myhands/fetchlin.php'

// Measured against BBO in August 2026: 8 concurrent requests and 1s spacing
// both drew HTTP 429 within a handful of requests; 2s spacing sustained 150
// consecutive requests with none refused. The limiter looks like a token
// bucket with ~5 requests of burst and a refill somewhere between 0.5/s and
// 1/s, so 2s is the conservative floor to start from.
const DEFAULTS = {
  delayMs: 2000,
  minDelayMs: 1500,
  maxDelayMs: 60000,
  // Multiplicative backoff on refusal, gentle decay when the coast is clear —
  // the classic shape, tuned slow because a multi-day run has no reason to
  // probe aggressively.
  backoff: 1.5,
  speedup: 0.95,
  speedupAfter: 50,
  maxRetries: 5,
  progressEvery: 25,
}

const USER_AGENT =
  'acbl-live-fetch/replay-backfill (+https://github.com/bridge-craftwork/acbl-live-fetch)'

// ── CLI ──────────────────────────────────────────────────────────────────────

function usage() {
  console.log(`
Fetch other tables' replays for a BBO history export.

  node tools/fetch-replays.js <command> <input.json> [options]

Commands:
  fetch    Fetch missing replays into <input>.replays.jsonl (resumable)
  merge    Fold fetched replays into <input>.expanded.json
  status   Report how much is done without fetching anything

Options:
  --delay <ms>            Starting delay between requests (default ${DEFAULTS.delayMs})
  --min-delay <ms>        Floor the adaptive throttle won't go below (default ${DEFAULTS.minDelayMs})
  --max-delay <ms>        Ceiling when backing off (default ${DEFAULTS.maxDelayMs})
  --no-adaptive           Hold --delay fixed; never speed up or back off
  --max-per-board <n>     Fetch at most n replays per board, in traveller order
  --limit <n>             Stop after n fetches this run (testing)
  --out <path>            Output path for merge (default <input>.expanded.json)
  --help

Throttle knobs can be changed mid-run by editing <input>.knobs.json; it is
re-read every ${DEFAULTS.progressEvery} requests. Ctrl-C stops cleanly and the next
run resumes from the journal.
`)
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS, adaptive: true }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const num = () => {
      const v = Number.parseInt(argv[++i], 10)
      if (!Number.isFinite(v)) throw new Error(`${a} needs a number`)
      return v
    }
    switch (a) {
      case '--delay': opts.delayMs = num(); break
      case '--min-delay': opts.minDelayMs = num(); break
      case '--max-delay': opts.maxDelayMs = num(); break
      case '--no-adaptive': opts.adaptive = false; break
      case '--max-per-board': opts.maxPerBoard = num(); break
      case '--limit': opts.limit = num(); break
      case '--out': opts.out = argv[++i]; break
      case '--help': case '-h': usage(); process.exit(0); break
      default:
        if (a.startsWith('-')) throw new Error(`unknown option ${a}`)
        positional.push(a)
    }
  }
  return { opts, positional }
}

// ── Work list ────────────────────────────────────────────────────────────────

// Every result row carries handviewer_url of the form
//   .../handviewer.html?bbo=y&myhand=M-<handId>-<whenPlayed>
// whose two components are exactly fetchlin.php's parameters. No lookup needed.
const MYHAND_RE = /myhand=M-(\d+)-(\d+)/

function replayId(result) {
  const m = MYHAND_RE.exec(result?.handviewer_url ?? '')
  return m ? { id: m[1], whenPlayed: m[2] } : null
}

// Walk the envelope tree yielding every board with its enclosing event, so
// callers can report and cap per board without repeating the nesting.
function* eachBoard(doc) {
  for (const env of doc.envelopes ?? []) {
    for (const t of env.tournaments ?? []) {
      for (const ev of t.events ?? []) {
        for (const s of ev.sessions ?? []) {
          for (const b of s.boards ?? []) yield { event: ev, board: b }
        }
      }
    }
  }
}

// Rows needing a fetch: every table but yours, that has no play yet and does
// carry an ID. Ordered board by board so an interrupted run leaves whole
// boards finished rather than a scatter of rows.
function buildWorkList(doc, { maxPerBoard } = {}) {
  const work = []
  const seen = new Set()
  for (const { board } of eachBoard(doc)) {
    let taken = 0
    for (const [i, r] of (board.results ?? []).entries()) {
      if (i === board.user_result_index) continue
      if (r.play) continue
      if (maxPerBoard != null && taken >= maxPerBoard) break
      const ref = replayId(r)
      if (!ref) continue
      taken++
      if (seen.has(ref.id)) continue
      seen.add(ref.id)
      work.push(ref)
    }
  }
  return work
}

// ── Journal ──────────────────────────────────────────────────────────────────
//
// Append-only JSONL, one record per replay. Only terminal outcomes are
// journalled: a success, or a failure that retrying can't fix. Rate limits and
// network errors are deliberately left unrecorded so they're retried on the
// next run rather than baked in as permanent holes.

function journalPath(input) { return `${stripJson(input)}.replays.jsonl` }
function knobsPath(input) { return `${stripJson(input)}.knobs.json` }
function stripJson(p) { return p.replace(/\.json$/i, '') }

async function readJournal(file) {
  const done = new Map()
  if (!fs.existsSync(file)) return done
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  })
  let bad = 0
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line)
      if (rec.id) done.set(rec.id, rec)
    } catch {
      // A run killed mid-write can leave one torn final line. Skip it; that
      // replay simply gets refetched.
      bad++
    }
  }
  if (bad) console.warn(`  (skipped ${bad} unparseable journal line(s))`)
  return done
}

// ── Fetching ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A LIN always carries the deal in an md| token. The rate limiter answers with
// a 117-byte HTML page, and checking the shape rather than trusting the status
// code keeps that from being stored as though it were cardplay.
function looksLikeLin(text) {
  return typeof text === 'string' && text.includes('md|')
}

class RateLimited extends Error {}

async function fetchReplay({ id, whenPlayed }) {
  const url = `${FETCHLIN}?id=${id}&when_played=${whenPlayed}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (res.status === 429) throw new RateLimited('429')
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.permanent = res.status >= 400 && res.status < 500
    throw err
  }
  const text = await res.text()
  if (!looksLikeLin(text)) {
    if (/429|too many/i.test(text)) throw new RateLimited('429 body')
    const err = new Error(`unexpected body (${text.length} bytes)`)
    err.permanent = true
    throw err
  }
  return text.trim()
}

// Knobs are re-read from disk periodically so a multi-day run can be slowed
// down or sped up without losing its place.
function readKnobs(file, opts) {
  if (!fs.existsSync(file)) return opts
  try {
    const k = JSON.parse(fs.readFileSync(file, 'utf8'))
    const next = { ...opts }
    for (const key of ['delayMs', 'minDelayMs', 'maxDelayMs']) {
      if (Number.isFinite(k[key])) next[key] = k[key]
    }
    if (typeof k.adaptive === 'boolean') next.adaptive = k.adaptive
    return next
  } catch {
    return opts
  }
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?'
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s % 60).padStart(2, '0')}s`
}

async function cmdFetch(input, opts) {
  const doc = readInput(input)
  const jpath = journalPath(input)
  const kpath = knobsPath(input)

  const done = await readJournal(jpath)
  const work = buildWorkList(doc, opts).filter((w) => !done.has(w.id))

  console.log(`input     ${input}`)
  console.log(`journal   ${jpath} (${done.size} already recorded)`)
  console.log(`to fetch  ${work.length}${opts.limit ? ` (capped at ${opts.limit} this run)` : ''}`)
  if (!work.length) {
    console.log('nothing to do — run `merge` to build the expanded JSON')
    return
  }
  const target = opts.limit ? Math.min(opts.limit, work.length) : work.length
  console.log(`estimate  ${fmtDuration(target * opts.delayMs)} at ${opts.delayMs}ms spacing\n`)

  const out = fs.createWriteStream(jpath, { flags: 'a' })
  let live = { ...opts }
  let ok = 0, failed = 0, limited = 0, streak = 0
  let stopping = false
  const started = Date.now()

  const onSig = () => {
    if (stopping) process.exit(130)
    stopping = true
    console.log('\ninterrupted — finishing current request, progress is saved')
  }
  process.on('SIGINT', onSig)
  process.on('SIGTERM', onSig)

  for (let i = 0; i < work.length && !stopping; i++) {
    if (opts.limit && ok + failed >= opts.limit) break
    const item = work[i]

    let attempt = 0
    for (;;) {
      try {
        const lin = await fetchReplay(item)
        out.write(JSON.stringify({ id: item.id, lin }) + '\n')
        ok++
        streak++
        break
      } catch (err) {
        if (err instanceof RateLimited) {
          limited++
          streak = 0
          if (live.adaptive) {
            live.delayMs = Math.min(Math.round(live.delayMs * live.backoff), live.maxDelayMs)
          }
          // Wait out the bucket before trying this one again. Refusals aren't
          // journalled, so a run that dies here just refetches the row.
          await sleep(live.delayMs)
          if (++attempt > live.maxRetries) { limited--; failed++; break }
          continue
        }
        if (err.permanent) {
          out.write(JSON.stringify({ id: item.id, error: String(err.message) }) + '\n')
          failed++
          break
        }
        // Network hiccup: retry a few times, then give up without journalling
        // so the next run picks it back up.
        if (++attempt > live.maxRetries) { failed++; break }
        await sleep(live.delayMs * attempt)
      }
    }

    if (live.adaptive && streak >= live.speedupAfter) {
      live.delayMs = Math.max(Math.round(live.delayMs * live.speedup), live.minDelayMs)
      streak = 0
    }

    const n = ok + failed
    if (n % live.progressEvery === 0) {
      live = { ...readKnobs(kpath, live) }
      const rate = n / ((Date.now() - started) / 1000)
      const left = (opts.limit ? Math.min(opts.limit, work.length) : work.length) - n
      process.stdout.write(
        `\r${n}/${target}  ok=${ok} fail=${failed} 429=${limited}  ` +
        `${live.delayMs}ms  ${rate.toFixed(2)}/s  eta ${fmtDuration((left / rate) * 1000)}   `
      )
    }
  }

  await new Promise((r) => out.end(r))
  process.off('SIGINT', onSig)
  process.off('SIGTERM', onSig)

  const elapsed = Date.now() - started
  console.log(`\n\nfetched ${ok}, failed ${failed}, rate-limited ${limited} in ${fmtDuration(elapsed)}`)
  const remaining = work.length - (ok + failed)
  if (remaining > 0) {
    console.log(`${remaining} remaining — rerun the same command to continue`)
  } else {
    console.log(`all replays fetched — run: node tools/fetch-replays.js merge ${input}`)
  }
}

// ── Merge ────────────────────────────────────────────────────────────────────

async function cmdMerge(input, opts) {
  const doc = readInput(input)
  const done = await readJournal(journalPath(input))
  console.log(`journal   ${done.size} records`)

  let filled = 0, noPlay = 0, badLin = 0, missing = 0
  for (const { board } of eachBoard(doc)) {
    for (const [i, r] of (board.results ?? []).entries()) {
      if (i === board.user_result_index || r.play) continue
      const ref = replayId(r)
      if (!ref) continue
      const rec = done.get(ref.id)
      if (!rec) { missing++; continue }
      if (!rec.lin) { badLin++; continue }
      let parsed
      try {
        parsed = parseLin(rec.lin)
      } catch {
        badLin++
        continue
      }
      // Match the extension's own convention: empty arrays become null so the
      // analyzer sees "absent" rather than "played no cards".
      r.auction = parsed.auction?.length ? parsed.auction : null
      r.play = parsed.play?.length ? parsed.play : null
      if (r.play) filled++
      else noPlay++
    }
  }

  const out = opts.out ?? `${stripJson(input)}.expanded.json`
  fs.writeFileSync(out, JSON.stringify(doc))
  const mb = (fs.statSync(out).size / 1e6).toFixed(0)

  console.log(`filled    ${filled} rows with auction + play`)
  if (noPlay) console.log(`no play   ${noPlay} (passed out or LIN without pc| tokens)`)
  if (badLin) console.log(`bad lin   ${badLin}`)
  if (missing) console.log(`missing   ${missing} not yet fetched — rerun \`fetch\` then merge again`)
  console.log(`\nwrote ${out} (${mb} MB)`)
}

// ── Status ───────────────────────────────────────────────────────────────────

async function cmdStatus(input, opts) {
  const doc = readInput(input)
  const done = await readJournal(journalPath(input))
  const work = buildWorkList(doc, opts)
  const remaining = work.filter((w) => !done.has(w.id))
  let rows = 0, boards = 0, mine = 0
  for (const { board } of eachBoard(doc)) {
    boards++
    for (const [i, r] of (board.results ?? []).entries()) {
      rows++
      if (i === board.user_result_index && r.play) mine++
    }
  }
  const pct = work.length ? (100 * (work.length - remaining.length)) / work.length : 100
  console.log(`boards            ${boards}`)
  console.log(`result rows       ${rows}`)
  console.log(`your tables       ${mine} with cardplay`)
  console.log(`replays wanted    ${work.length}${opts.maxPerBoard ? ` (capped ${opts.maxPerBoard}/board)` : ''}`)
  console.log(`replays fetched   ${work.length - remaining.length}  (${pct.toFixed(1)}%)`)
  console.log(`remaining         ${remaining.length}  ~${fmtDuration(remaining.length * opts.delayMs)} at ${opts.delayMs}ms`)
}

// ── Entry ────────────────────────────────────────────────────────────────────

function readInput(input) {
  if (!fs.existsSync(input)) {
    console.error(`no such file: ${input}`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(input, 'utf8'))
}

const { opts, positional } = parseArgs(process.argv.slice(2))
const [command, input] = positional
if (!command || !input) {
  usage()
  process.exit(1)
}

const commands = { fetch: cmdFetch, merge: cmdMerge, status: cmdStatus }
if (!commands[command]) {
  console.error(`unknown command: ${command}`)
  usage()
  process.exit(1)
}
await commands[command](path.resolve(input), opts)
