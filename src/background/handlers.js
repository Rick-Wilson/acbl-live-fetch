// Pure message-handling logic for the service worker. All chrome.* APIs are
// passed in via the `deps` parameter so this file is testable without a
// browser. The thin wrapper in src/background.js wires real chrome APIs in.
//
// Message protocol: see docs/handoff-protocol.md.

import acblLiveAdapter, {
  classifyPage as classifyLive,
  findScorecardUrlInSummary,
} from '../adapters/acbl-live/index.js'
import { parsePairScorecard } from '../adapters/acbl-live/parsers/pairScorecard.js'
import { fetchAll } from '../lib/rateLimiter.js'
import acblLiveClubAdapter from '../adapters/acbl-live-club/index.js'
import bboAdapter from '../adapters/bbo/index.js'
import { parseClubResultsList } from '../adapters/acbl-live-club/parsers/clubResultsList.js'
import { parseBboHistoryList } from '../adapters/bbo/parsers/historyList.js'

// Adapter registry. The first adapter whose matchesUrl(url) returns true
// owns that URL. Order matters when adapters could overlap; today they
// don't (different hostnames), but list more-specific ones first.
export const ADAPTERS = [acblLiveClubAdapter, acblLiveAdapter, bboAdapter]

export function pickAdapter(url) {
  return ADAPTERS.find((a) => a.matchesUrl(url)) ?? null
}

async function dispatchExtract(url, options) {
  const a = pickAdapter(url)
  if (!a) {
    const err = new Error(`No adapter matches URL: ${url}`)
    err.name = 'ParseError'
    throw err
  }
  return a.extractSession(url, options)
}

export const EXTRACT_PROGRESS_PREFIX = 'extract-progress:'
export const PENDING_PREFIX = 'pending-sessions:'
export const PENDING_BATCH_PREFIX = 'pending-batch:'
export const PENDING_TTL_MS = 60 * 60 * 1000 // 1 hour
// Results are handed to bridge-classroom.{tld}/ingest/, which receives the
// payload and forwards it to whichever Bridge Classroom tool the user picks —
// game analysis today, the double-dummy and replay tools as they arrive. Routing
// through one versioned entry point means adding a consumer is a web deploy
// rather than an extension release (ADR 0001).
//
// `?v=1` versions the transport contract, not the payload; the envelope carries
// its own schema_version. The tab-open appends `#sid=` / `#batch=`.
//
// Trailing slash is deliberate: /ingest 301s to /ingest/, and pointing at the
// final URL avoids a redirect on every hand-off.
export const ingestUrlForTld = (tld) =>
  `https://bridge-classroom.${tld}/ingest/?v=1`
export const DEFAULT_INGEST_URL = ingestUrlForTld('org')
const INGEST_TLDS = new Set(['org', 'com'])

export const DEV_INGEST_URL_KEY = 'devIngestUrl'
export const PREFERRED_TLD_KEY = 'preferredTld'
// Read once more under the pre-rename names so an existing install doesn't
// silently change destination on upgrade. Removable after a release.
const LEGACY_DEV_URL_KEY = 'devAnalyzerUrl'
const LEGACY_TLD_KEY = 'preferredAnalyzerTld'

/** Returns the hand-off URL. Resolution order:
 *  1. devIngestUrl (manual override for local dev — set via:
 *       chrome.storage.local.set({ devIngestUrl: 'http://localhost:3001/ingest/?v=1' })
 *     clear with: chrome.storage.local.remove('devIngestUrl'))
 *     Only ever written from an extension context. A destination a *page* could
 *     set would be an exfiltration vector, since the payload comes from the
 *     user's authenticated sessions.
 *  2. preferredTld (auto-tracked: whenever the user visits Bridge Classroom on
 *     .com or .org, ingestContent.js writes that TLD here so subsequent
 *     hand-offs stay on the same domain)
 *  3. DEFAULT_INGEST_URL (.org) */

// A team game's results pages carry no board detail — there is nothing for the
// adapters to read. Recognised from the event list's own Type column, so a
// batch can skip them before fetching rather than failing on each one.
export function isTeamEvent(e) {
  return /team/i.test(e?.type ?? '') || /\bteams?\b/i.test(e?.name ?? '')
}

export async function getIngestUrl(storage) {
  const result = await storage.get([
    DEV_INGEST_URL_KEY, PREFERRED_TLD_KEY, LEGACY_DEV_URL_KEY, LEGACY_TLD_KEY,
  ])
  const override = result?.[DEV_INGEST_URL_KEY] ?? result?.[LEGACY_DEV_URL_KEY]
  if (override) return override
  const tld = result?.[PREFERRED_TLD_KEY] ?? result?.[LEGACY_TLD_KEY]
  if (tld && INGEST_TLDS.has(tld)) return ingestUrlForTld(tld)
  return DEFAULT_INGEST_URL
}
// Per-host pause between batch items to avoid rate-limiting. ACBL needs more
// breathing room than BBO (we got a 403 on my.acbl.org with no delay; BBO has
// been fine at 250ms). Defaults to 1s for unknown hosts.

// my-results and player-results list one row per *session*, but extractSession
// already pulls every sibling session of the event it is given. So a selection
// of "26MP/1, 26MP/2, 27OP/1, 27OP/2" is two events, and extracting all four
// rows fetches each event twice — 96 board requests done, then done again.
//
// That doubling is most of what made batches trip live.acbl.org's limit: the
// first event of a run completes cleanly, and it is the redundant second pass
// that gets refused. Collapse to one URL per event, keeping the earliest
// session so the adapter starts where it always has.
const ACBL_EVENT_SUMMARY = /^(https:\/\/[^/]+\/event\/[^/]+\/[^/]+)\/(\d+)\/summary\/?$/

export function dedupeAcblSessions(urls) {
  const bestByEvent = new Map()
  const out = []
  for (const url of urls) {
    const m = ACBL_EVENT_SUMMARY.exec(url)
    if (!m) {
      out.push(url)
      continue
    }
    const [, eventKey, session] = m
    const existing = bestByEvent.get(eventKey)
    if (!existing || Number(session) < Number(existing.session)) {
      bestByEvent.set(eventKey, { url, session })
    }
  }
  return [...out, ...[...bestByEvent.values()].map((e) => e.url)]
}

export function batchItemDelayMs(url) {
  try {
    const host = new URL(url).hostname
    if (host === 'webutil.bridgebase.com' || host === 'www.bridgebase.com') return 250
    return 1000
  } catch {
    return 1000
  }
}
// Waits shorter than this are not worth announcing; the label would flicker.
export const WAIT_VISIBLE_MS = 3000

export const CANCEL_BATCH_PREFIX = 'cancel-batch:'

// In-flight batches, so Stop can interrupt the event being extracted rather
// than only the gap between events. The storage flag alone is checked at the
// event boundary, and an ACBL event can run for a minute — long enough that
// the button looked broken.
const inFlightBatches = new Map()

function isQuotaError(err) {
  const msg = (err?.message ?? '').toLowerCase()
  return msg.includes('quota') || err?.name === 'QuotaExceededError'
}

async function compressEnvelope(envelope) {
  const stream = new CompressionStream('gzip')
  const writer = stream.writable.getWriter()
  writer.write(new TextEncoder().encode(JSON.stringify(envelope)))
  writer.close()
  const chunks = []
  const reader = stream.readable.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  let s = ''
  for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i])
  return btoa(s)
}

export async function handleMessage(msg, deps) {
  if (!msg || typeof msg.type !== 'string') {
    return {
      type: 'extraction-error',
      error: { code: 'bad-request', message: 'Missing message type' },
    }
  }
  if (msg.type === 'extract-session') {
    // playerName rides along from the per-row links on ACBL Live's results
    // listing, which is one player's page — it lets the adapter enter through
    // that player's own scorecard. See runExtraction.
    return runExtraction(msg.url, deps, {
      playerName: msg.playerName ?? null,
      progressKey: msg.progressKey ?? null,
    })
  }
  if (msg.type === 'list-event-pairs') return listEventPairs(msg.url, deps)
  if (msg.type === 'extract-shortlink') return runShortlinkExtraction(msg.url, deps)
  if (msg.type === 'consume-pending-session') return consumePending(msg.sid, deps)
  if (msg.type === 'extract-batch') return runBatchExtraction(msg.listUrl, deps, msg.since ?? null, msg.max ?? null, msg.urls ?? null)
  if (msg.type === 'consume-pending-batch') return consumePendingBatch(msg.key, deps)
  if (msg.type === 'cancel-batch') return cancelBatch(msg.key, deps)
  if (msg.type === 'get-bbo-username') return getBboUsername(deps)
  return {
    type: 'extraction-error',
    error: { code: 'unknown-message-type', message: `Unknown message type '${msg.type}'` },
  }
}

const BBO_SHORTLINK_HOST = 'tinyurl.bridgebase.com'

/** Resolve a BBO short link, then extract whatever it points at.
 *
 *  The v3 lobby's Export ▸ Handviewer link does not hand over the deal — it
 *  mints a `tinyurl.bridgebase.com` short link, so following the redirect is the
 *  only route from that menu to a LIN. What comes back is worth the round trip:
 *  a hand viewer URL carrying the players, the deal, the full auction *with*
 *  alert explanations, and all 52 cards played.
 *
 *  `redirect: 'follow'` and then reading `res.url` rather than `'manual'` and
 *  reading Location: a manual redirect in a service worker yields an opaque
 *  response whose headers cannot be read at all.
 */
export async function runShortlinkExtraction(url, deps) {
  const doFetch = deps.fetch ?? globalThis.fetch
  let resolved
  try {
    const u = new URL(url)
    // Only ever follow BBO's own shortener. An open redirector reachable from a
    // content script is not something to hand a fetch to.
    if (u.hostname !== BBO_SHORTLINK_HOST) {
      return {
        type: 'extraction-error',
        error: { code: 'bad-request', message: `Not a BBO short link: ${u.hostname}` },
      }
    }
    const res = await doFetch(url, { redirect: 'follow', signal: deps.signal })
    resolved = res?.url
  } catch (err) {
    return {
      type: 'extraction-error',
      error: { code: classifyError(err), message: err?.message ?? 'Could not resolve the BBO link' },
    }
  }
  if (!resolved || !resolved.includes('/tools/handviewer.html')) {
    return {
      type: 'extraction-error',
      error: { code: 'parse-error', message: 'That BBO link did not lead to a hand viewer' },
    }
  }
  return runExtraction(resolved, deps)
}

// Every pair in an event, so the summary page can ask which one is meant.
//
// A summary page names no user, and the extractor now fetches one section — so
// guessing costs the user a stranger's section and none of their own boards.
// Rather than guess, the page offers a list and the click that follows goes
// straight to that pair's scorecard, which is the ordinary, already-tested
// entry point.
//
// The list comes from a scorecard's #pair-select dropdown rather than from the
// summary markup: it covers every section in one predictable format
// ("Tim Benoit & Michael Fleisher"), where the summary's own rows vary. Two
// fetches out of an allowance of ~110.
export async function listEventPairs(url, deps) {
  const { fetch: fetchFn = globalThis.fetch, signal } = deps
  if (typeof url !== 'string' || !url) {
    return { type: 'extraction-error', error: { code: 'bad-request', message: 'Missing URL' } }
  }
  if (classifyLive(url) !== 'event-summary') {
    return {
      type: 'extraction-error',
      error: { code: 'bad-request', message: `Not an ACBL Live event summary: ${url}` },
    }
  }

  try {
    const fetchOpts = { fetch: fetchFn, signal, concurrency: 1 }
    const summaryMap = await fetchAll([url], fetchOpts)
    const html = summaryMap.get(url)
    if (html instanceof Error) throw html

    const { url: scorecardUrl } = findScorecardUrlInSummary(html, url)
    if (!scorecardUrl) {
      const err = new Error(
        'No pair scorecards on this event — team events are not supported.'
      )
      err.name = 'ParseError'
      throw err
    }

    const scMap = await fetchAll([scorecardUrl], fetchOpts)
    const scHtml = scMap.get(scorecardUrl)
    if (scHtml instanceof Error) throw scHtml

    const pairs = parsePairScorecard(scHtml).pair_directory.map((p) => ({
      section: p.section,
      direction: p.direction,
      pair_number: p.pair_number,
      players_text: p.players_text,
      url: new URL(p.url, url).toString(),
    }))
    return { type: 'event-pairs', pairs }
  } catch (err) {
    return {
      type: 'extraction-error',
      error: { code: classifyError(err), message: err?.message ?? 'Could not list the pairs' },
    }
  }
}

// Publish progress where the page can see it.
//
// The extraction runs in the service worker and the message that started it
// does not resolve until it is finished, so the only channel back to the page
// mid-flight is storage. Throttled: fifty boards would otherwise be fifty
// writes, and the page only repaints a few times a second anyway.
const PROGRESS_THROTTLE_MS = 250

export function makeProgressReporter(storage, key, now = () => Date.now()) {
  const storageKey = `${EXTRACT_PROGRESS_PREFIX}${key}`
  let lastWrite = 0
  return (done, total) => {
    const t = now()
    // Always publish the last one, so the bar reaches 100 rather than stopping
    // at whatever the throttle happened to allow.
    if (t - lastWrite < PROGRESS_THROTTLE_MS && done < total) return
    lastWrite = t
    storage.set({ [storageKey]: { done, total, stored_at: t } }).catch(() => {})
  }
}

export async function runExtraction(url, deps, extra = {}) {
  const { storage, tabs, crypto, fetch, signal, extract = dispatchExtract } = deps
  // The caller supplies the key so it can watch from the moment it clicks,
  // rather than waiting for a round trip that only completes at the end.
  const progressKey = extra.progressKey ?? null
  delete extra.progressKey
  if (typeof url !== 'string' || !url) {
    return { type: 'extraction-error', error: { code: 'bad-request', message: 'Missing URL' } }
  }
  let envelope
  try {
    // extractOptions carries the fetch-rate override, if one is set. It is a
    // dev knob for finding the rate live.acbl.org's Cloudflare rules tolerate;
    // unset, the adapter's own defaults apply.
    envelope = await extract(url, {
      fetch: fetch ?? globalThis.fetch,
      signal,
      ...(deps.extractOptions ?? {}),
      ...extra,
      onProgress: progressKey ? makeProgressReporter(storage, progressKey) : undefined,
    })
  } catch (err) {
    if (progressKey) {
      await storage.remove(`${EXTRACT_PROGRESS_PREFIX}${progressKey}`).catch(() => {})
    }
    return {
      type: 'extraction-error',
      error: { code: classifyError(err), message: err?.message ?? 'Extraction failed' },
    }
  }
  if (progressKey) {
    await storage.remove(`${EXTRACT_PROGRESS_PREFIX}${progressKey}`).catch(() => {})
  }
  const sid = crypto.randomUUID()
  const key = `${PENDING_PREFIX}${sid}`
  await storage.set({ [key]: { stored_at: Date.now(), envelope } })
  await cacheBboUsername(url, storage)
  const ingestUrl = await getIngestUrl(storage)
  await tabs.create({ url: `${ingestUrl}#sid=${sid}` })
  return { type: 'extraction-complete', sid }
}

export async function consumePending(sid, deps) {
  const { storage } = deps
  if (typeof sid !== 'string' || !sid) {
    return { type: 'no-pending-session', reason: 'missing' }
  }
  const key = `${PENDING_PREFIX}${sid}`
  const result = await storage.get(key)
  const entry = result?.[key]
  if (!entry) return { type: 'no-pending-session', reason: 'missing' }
  if (typeof entry.stored_at !== 'number' || Date.now() - entry.stored_at > PENDING_TTL_MS) {
    await storage.remove(key)
    return { type: 'no-pending-session', reason: 'expired' }
  }
  if (!entry.envelope || typeof entry.envelope !== 'object') {
    await storage.remove(key)
    return { type: 'no-pending-session', reason: 'malformed' }
  }
  await storage.remove(key)
  return { type: 'pending-session', envelope: entry.envelope }
}


export async function runBatchExtraction(listUrl, deps, since = null, max = null, directUrls = null) {
  const { storage, tabs, crypto, fetch: fetchFn = globalThis.fetch, signal, extract = dispatchExtract } = deps

  let teamsSkipped = 0
  let allUrls
  if (Array.isArray(directUrls)) {
    // Pre-parsed URL list supplied by the content script (BBO lobby case):
    // the SW cannot fetch BBO pages with session cookies, so the content script
    // fetches same-origin and passes the extracted tview URLs directly.
    allUrls = directUrls
  } else {
    if (typeof listUrl !== 'string' || !listUrl) {
      return { type: 'extraction-error', error: { code: 'bad-request', message: 'Missing list URL' } }
    }

    // Fetch and parse the listing page to get the ordered event URL list.
    let eventList
    try {
      const host = new URL(listUrl).hostname
      // my.acbl.org started requiring authentication in May 2026; BBO has
      // always needed it. The SW's smartFetch in background.js already
      // routes my.acbl.org through a same-origin tab so cookies attach;
      // here we still pass credentials:'include' for the BBO path.
      const needsCredentials = host === 'www.bridgebase.com' || host === 'my.acbl.org'
      const listFetch = needsCredentials
        ? (u) => fetchFn(u, { credentials: 'include' }).then((r) => r.text())
        : (u) => fetchFn(u).then((r) => r.text())
      const html = await listFetch(listUrl)
      if (host === 'www.bridgebase.com') {
        eventList = parseBboHistoryList(html)
      } else if (host === 'live.acbl.org') {
        // No batch here, deliberately. live.acbl.org allows roughly 110
        // requests per sign-in under /event/*, which is about two events; a
        // date-range batch spent that partway through and left the user signed
        // out. The results listing offers one link per row instead — see
        // setupRowLinks in src/ui/sourceContent.js and docs/acbl-rate-limit.md.
        return {
          type: 'extraction-error',
          error: {
            code: 'unsupported',
            message:
              'ACBL Live is fetched one event at a time. Use the ' +
              '"Analyze in Bridge Classroom" link on the row you want.',
          },
        }
      } else {
        eventList = parseClubResultsList(html, new URL(listUrl).origin)
      }
    } catch (err) {
      return { type: 'extraction-error', error: { code: classifyError(err), message: err?.message ?? 'Failed to fetch event list' } }
    }

    // Filter by date if requested. date_sort is a Unix timestamp in seconds.
    const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : null
    const inRange = sinceTs ? eventList.filter((e) => e.date_sort >= sinceTs) : eventList
    if (inRange.length === 0) {
      return { type: 'extraction-error', error: { code: 'bad-request', message: 'No events found in the selected date range' } }
    }

    // Team games carry no board-level data we can read, so extracting one
    // fails and takes its place in the batch for nothing. Skip them here
    // rather than one failure at a time, and say how many were skipped —
    // silently dropping events looks identical to losing them.
    const filtered = inRange.filter((e) => !isTeamEvent(e))
    const skippedTeams = inRange.length - filtered.length
    if (filtered.length === 0) {
      return {
        type: 'extraction-error',
        error: {
          code: 'bad-request',
          message:
            skippedTeams === 1
              ? 'The only event in that range is a team game, which has no board data to analyse.'
              : `All ${skippedTeams} events in that range are team games, which have no board data to analyse.`,
        },
      }
    }
    allUrls = dedupeAcblSessions(filtered.map((e) => e.url))
    teamsSkipped = skippedTeams
  }

  if (allUrls.length === 0) {
    return { type: 'extraction-error', error: { code: 'bad-request', message: 'No events found in the selected date range' } }
  }
  // Slice first, then reverse so we process oldest-first. The SPA's FIFO
  // event cache (max 10) will then naturally retain the most recent events.
  const urls = (max != null ? allUrls.slice(0, max) : allUrls).slice().reverse()
  const key = crypto.randomUUID()
  const storageKey = `${PENDING_BATCH_PREFIX}${key}`
  const total = urls.length

  await storage.set({ [storageKey]: { stored_at: Date.now(), total, completed: 0, items: [], errors: [], done: false } })
  const ingestUrl = await getIngestUrl(storage)

  // Return the key immediately so the UI can start showing progress, then
  // continue processing in the background (network requests keep the SW alive).
  const cancelKey = `${CANCEL_BATCH_PREFIX}${key}`
  const isCancelled = async () => {
    try {
      const r = await storage.get(cancelKey)
      return !!r?.[cancelKey]
    } catch { return false }
  }

  // Abort in-flight fetches on cancel. fetchAll checks the signal between
  // requests, so this stops within a request rather than within an event.
  const controller = new AbortController()
  const batchSignal = signal
    ? AbortSignal.any
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
    : controller.signal
  inFlightBatches.set(key, controller)

  const doWork = async () => {
    const items = []
    const errors = []
    let cancelled = false
    for (const url of urls) {
      if (batchSignal.aborted) { cancelled = true; break }
      if (await isCancelled()) { cancelled = true; break }
      // Mark the boundary so the fetch log can show where one event ends and
      // the next begins. "It is always the second event" is the central claim
      // about this bug and nothing recorded enough to confirm it.
      deps.onEventStart?.(url, { index: items.length + errors.length + 1, total })
      try {
        const envelope = await extract(url, {
          fetch: fetchFn,
          signal: batchSignal,
          ...(deps.extractOptions ?? {}),
        })
        const compressed = await compressEnvelope(envelope)
        items.push({ compressed, source_url: url })
      } catch (err) {
        errors.push({ url, error: err?.message ?? 'failed' })
      }
      let storageQuotaHit = false
      try {
        await storage.set({ [storageKey]: { stored_at: Date.now(), total, completed: items.length + errors.length, items, errors, done: false } })
      } catch (err) {
        if (isQuotaError(err)) { storageQuotaHit = true }
      }
      if (storageQuotaHit || batchSignal.aborted) break
      if (await isCancelled()) { cancelled = true; break }
      // Between events, not between boards. One event's 96 board fetches run
      // clean; it is the running total across events that gets refused, so
      // spacing boards taxes the case that already works. deps.pacer knows
      // whether the event just finished was refused and asks for a longer gap
      // only then, leaving a clean batch at full speed.
      const gapMs = deps.pacer?.eventGapMs?.(url) ?? batchItemDelayMs(url)
      if (gapMs >= WAIT_VISIBLE_MS) {
        // Publish when the wait ends so the button can count down. A pause
        // with no explanation is indistinguishable from a stall — which is
        // exactly how the ten seconds before the first event used to read.
        await storage
          .set({
            [storageKey]: {
              stored_at: Date.now(), total,
              completed: items.length + errors.length,
              items, errors, done: false,
              waiting_until: Date.now() + gapMs,
            },
          })
          .catch(() => {})
      }
      await new Promise((r) => setTimeout(r, gapMs))
    }
    await storage.set({ [storageKey]: { stored_at: Date.now(), total, completed: items.length + errors.length, items, errors, done: true, cancelled } })
    inFlightBatches.delete(key)
    // Clean up the cancel flag if it was set.
    await storage.remove(cancelKey).catch(() => {})
    // Don't open the analyzer if the batch was cancelled with no items.
    if (!cancelled || items.length > 0) {
      await tabs.create({ url: `${ingestUrl}#batch=${key}` })
    }
  }

  doWork().catch(() => {
    // Swallow — the storage entry will be left with done:false and will expire.
  })

  return { type: 'batch-started', key, total, teamsSkipped }
}

export async function consumePendingBatch(key, deps) {
  const { storage } = deps
  if (typeof key !== 'string' || !key) {
    return { type: 'no-pending-batch', reason: 'missing' }
  }
  const storageKey = `${PENDING_BATCH_PREFIX}${key}`
  const result = await storage.get(storageKey)
  const entry = result?.[storageKey]
  if (!entry) return { type: 'no-pending-batch', reason: 'missing' }
  if (typeof entry.stored_at !== 'number' || Date.now() - entry.stored_at > PENDING_TTL_MS) {
    await storage.remove(storageKey)
    return { type: 'no-pending-batch', reason: 'expired' }
  }
  await storage.remove(storageKey)
  return { type: 'pending-batch', items: entry.items, total: entry.total, errors: entry.errors }
}

// Cancel an in-progress batch. The batch loop checks for this flag between
// items (and after each network operation) and breaks out cleanly, finalizing
// whatever items it has so far.
export async function cancelBatch(key, deps) {
  const { storage } = deps
  if (typeof key !== 'string' || !key) {
    return { type: 'cancel-error', error: { code: 'bad-request', message: 'Missing batch key' } }
  }
  await storage.set({ [`${CANCEL_BATCH_PREFIX}${key}`]: true })
  // Abort anything in flight for this batch. Without this the flag is only
  // seen at the next event boundary, which can be a minute away.
  inFlightBatches.get(key)?.abort()
  inFlightBatches.delete(key)
  return { type: 'cancel-acknowledged', key }
}

export const BBO_USERNAME_KEY = 'bbo-username'
export const BATCH_RESULT_KEY = 'bbo-batch-result'

// Both of these identify a person, so both expire on the same clock as the game
// data. Neither is expensive to lose: the username is re-read from any BBO page,
// and the batch result is consumed seconds after it is written. Keeping them
// bounded means nothing personally identifying outlives PENDING_TTL_MS, which is
// a far simpler thing to state in a privacy policy than a list of exceptions.
//
// Stored as { username, stored_at }. Earlier versions wrote a bare string; those
// are swept on sight rather than migrated, since re-deriving costs one page
// visit.
export async function getBboUsername(deps) {
  const { storage } = deps
  const result = await storage.get(BBO_USERNAME_KEY)
  const entry = result?.[BBO_USERNAME_KEY]
  if (typeof entry === 'string') return { username: entry }   // legacy shape
  if (!entry || typeof entry !== 'object') return { username: null }
  if (typeof entry.stored_at !== 'number' || Date.now() - entry.stored_at > PENDING_TTL_MS) {
    return { username: null }
  }
  return { username: entry.username ?? null }
}

async function cacheBboUsername(url, storage) {
  try {
    const u = new URL(url)
    if (u.hostname === 'webutil.bridgebase.com') {
      const username = u.searchParams.get('u') ?? u.searchParams.get('U')
      if (username) {
        await storage.set({ [BBO_USERNAME_KEY]: { username, stored_at: Date.now() } })
      }
    }
  } catch { /* non-fatal */ }
}

export async function sweepExpired(deps) {
  const { storage } = deps
  const all = await storage.get(null)
  const toRemove = []
  for (const [key, value] of Object.entries(all ?? {})) {
    // Always sweep stale cancel-batch flags — they're meant to live only as
    // long as the batch they're cancelling.
    if (key.startsWith(CANCEL_BATCH_PREFIX)) { toRemove.push(key); continue }
    // The two identifying caches. A legacy bare-string username has no
    // timestamp to judge, so it goes.
    if (key === BBO_USERNAME_KEY) {
      const at = typeof value === 'object' ? value?.stored_at : null
      if (typeof at !== 'number' || Date.now() - at > PENDING_TTL_MS) toRemove.push(key)
      continue
    }
    if (key === BATCH_RESULT_KEY) {
      const at = value?.timestamp
      if (typeof at !== 'number' || Date.now() - at > PENDING_TTL_MS) toRemove.push(key)
      continue
    }
    if (!key.startsWith(PENDING_PREFIX) && !key.startsWith(PENDING_BATCH_PREFIX)) continue
    const storedAt = value?.stored_at
    if (typeof storedAt !== 'number' || Date.now() - storedAt > PENDING_TTL_MS) {
      toRemove.push(key)
    }
  }
  if (toRemove.length) await storage.remove(toRemove)
  return toRemove
}

function classifyError(err) {
  // Its own code, because it is the only failure with a specific cure: sign out
  // of ACBL Live and back in. live.acbl.org allows about 110 requests per
  // sign-in under /event/*, so the second extraction in one sitting usually
  // lands here. See docs/acbl-rate-limit.md.
  if (err?.sessionExpired || err?.cause?.sessionExpired) return 'session-expired'
  switch (err?.name) {
    case 'FetchError':
      return 'fetch-failed'
    case 'ParseError':
      return 'parse-failed'
    case 'AbortError':
      return 'aborted'
    default:
      return 'unknown'
  }
}
