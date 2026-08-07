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
  // Steady-state pacing moves additively in both directions. A multiplicative
  // backoff ratchets: seven refusals took the delay from 2s to 34s, and at
  // -5%-per-50-successes it would have needed hundreds of clean requests to
  // recover. Nudging up 250ms and down 100ms keeps a burst of refusals from
  // permanently crippling throughput.
  stepUpMs: 250,
  stepDownMs: 100,
  speedupAfter: 20,
  // Retry pacing is separate from steady-state pacing: a refusal means the
  // bucket is empty right now, which calls for a real pause, not a permanent
  // slowdown.
  penaltyBaseMs: 5000,
  penaltyMaxMs: 120000,
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
  --min-per-board <n>     Skip boards with fewer than n comparable tables
  --worse-than-field <m>  Only boards where you took fewer tricks than the
                          comparable tables: best | mean | median
  --same-contract         Only tables that played your exact contract from your
                          exact declarer seat (4S and 4SX count as different)
  --player <name>         Only tables where this player sat (case-insensitive,
                          repeatable). Use alone to capture one player's whole
                          history rather than your own comparison set.
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
      case '--min-per-board': opts.minPerBoard = num(); break
      case '--worse-than-field': {
        const mode = argv[++i] ?? 'mean'
        if (!Object.hasOwn(FIELD_THRESHOLDS, mode)) {
          throw new Error(
            `--worse-than-field takes ${Object.keys(FIELD_THRESHOLDS).join(' | ')}, got '${mode}'`
          )
        }
        opts.worseThanField = mode
        break
      }
      case '--same-contract': opts.sameContract = true; break
      case '--player':
        // Repeatable: --player gavin --player nazinator
        opts.players = [...(opts.players ?? []), argv[++i]]
        break
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
//
// --same-contract narrows this to tables that reached your exact contract from
// your exact declarer seat, which is the comparison set for asking whether a
// double-dummy miss was a play error or only findable with all 52 cards
// visible. Contracts compare as exact strings, so 4S and 4SX are treated as
// different problems.
// Selection must be *nested*: raising --max-per-board, or dropping a filter,
// has to yield a superset of what a narrower run already fetched, so reruns
// only fill in extras. That holds because rows are taken in traveller order
// and the cap is a prefix of that order — see tests/tools/workList.test.js.
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const FIELD_THRESHOLDS = {
  // The best table measures the worst defence anyone met, so it flags boards
  // where a defender slipped rather than where a line was hard to find.
  best: (xs) => Math.max(...xs),
  // Mean and median measure play against typical defence, which is the useful
  // comparison for asking whether a line was findable at the table.
  mean,
  median,
}

// BBO usernames are case-insensitive to log in but stored as typed, so the same
// person shows up as both 'emwny' and 'EMWNY'. Fold case or you'll split people.
function seatedPlayers(result) {
  const out = []
  for (const pair of [result?.ns_pair, result?.ew_pair]) {
    for (const p of pair?.players ?? []) {
      if (p?.name) out.push(p.name.toLowerCase())
    }
  }
  return out
}

export function buildWorkList(
  doc,
  { maxPerBoard, minPerBoard, sameContract, worseThanField, players } = {}
) {
  const wanted = players?.length ? new Set(players.map((p) => p.toLowerCase())) : null

  const work = []
  const seen = new Set()
  for (const { board } of eachBoard(doc)) {
    const ui = board.user_result_index
    const mine = ui != null ? board.results?.[ui] : null
    // Nothing to compare against when you passed the board out, or when the
    // export never identified your row.
    if (sameContract && !mine?.contract) continue

    const eligible = (r, i) =>
      i !== ui &&
      (!sameContract || (r.contract === mine.contract && r.declarer === mine.declarer)) &&
      (!wanted || seatedPlayers(r).some((n) => wanted.has(n)))

    // --min-per-board gates the whole board on how many comparable tables it
    // has, for when a board is only worth fetching if the comparison is broad
    // enough to be meaningful. Counted over the input's rows regardless of what
    // has been fetched, so the gate is a property of the board, not of progress.
    if (minPerBoard != null) {
      const comparable = (board.results ?? []).filter((r, i) => eligible(r, i)).length
      if (comparable < minPerBoard) continue
    }

    // --worse-than-field keeps only boards where you underperformed tables in
    // the same contract from the same seat — the boards with something to
    // explain. Always compared like for like, even when --same-contract isn't
    // narrowing the fetch, since trick counts across different contracts
    // aren't comparable.
    if (worseThanField) {
      if (mine?.tricks == null || !mine.contract) continue
      const peers = (board.results ?? [])
        .filter((r, i) =>
          i !== ui && r.contract === mine.contract && r.declarer === mine.declarer && r.tricks != null)
        .map((r) => r.tricks)
      if (!peers.length) continue
      if (!(mine.tricks < FIELD_THRESHOLDS[worseThanField](peers))) continue
    }

    let taken = 0
    for (const [i, r] of (board.results ?? []).entries()) {
      if (!eligible(r, i)) continue
      if (maxPerBoard != null && taken >= maxPerBoard) break
      const ref = replayId(r)
      if (!ref) continue
      // Count toward the cap before checking whether we already hold the play,
      // so which rows a cap selects depends only on the input's row order —
      // never on how much has been fetched or merged already. Otherwise
      // rerunning against a merged file would slide the cap onto fresh rows.
      taken++
      if (r.play) continue
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
          attempt++
          if (live.adaptive) {
            live.delayMs = Math.min(live.delayMs + live.stepUpMs, live.maxDelayMs)
          }
          if (attempt > live.maxRetries) { limited--; failed++; break }
          // Wait out the bucket before retrying: exponential in the number of
          // consecutive refusals for this row, but reset for the next row.
          // Refusals aren't journalled, so a run that dies here refetches it.
          await sleep(Math.min(live.penaltyBaseMs * 2 ** (attempt - 1), live.penaltyMaxMs))
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
      live.delayMs = Math.max(live.delayMs - live.stepDownMs, live.minDelayMs)
      streak = 0
    }

    // Pace the next request. This is the throttle: without it the loop runs
    // flat out and the delay above only ever applies to retries.
    if (i + 1 < work.length) await sleep(live.delayMs)

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
  const scope = [
    opts.sameContract ? 'same contract + seat' : null,
    opts.minPerBoard ? `>=${opts.minPerBoard} comparable/board` : null,
    opts.worseThanField ? `worse than field ${opts.worseThanField}` : null,
    opts.players?.length ? `player ${opts.players.join('/')}` : null,
    opts.maxPerBoard ? `capped ${opts.maxPerBoard}/board` : null,
  ].filter(Boolean).join(', ')
  console.log(`replays wanted    ${work.length}${scope ? ` (${scope})` : ''}`)
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

// Only run as a CLI when invoked directly, so tests can import buildWorkList.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)

if (invokedDirectly) {
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
}
