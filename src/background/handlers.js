// Pure message-handling logic for the service worker. All chrome.* APIs are
// passed in via the `deps` parameter so this file is testable without a
// browser. The thin wrapper in src/background.js wires real chrome APIs in.
//
// Message protocol: see docs/handoff-protocol.md.

import acblLiveAdapter from '../adapters/acbl-live/index.js'
import acblLiveClubAdapter from '../adapters/acbl-live-club/index.js'
import bboAdapter from '../adapters/bbo/index.js'
import { parseClubResultsList } from '../adapters/acbl-live-club/parsers/clubResultsList.js'
import { parseBboHistoryList } from '../adapters/bbo/parsers/historyList.js'
import { parsePlayerResults } from '../adapters/acbl-live/parsers/playerResults.js'

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

export const PENDING_PREFIX = 'pending-sessions:'
export const PENDING_BATCH_PREFIX = 'pending-batch:'
export const PENDING_TTL_MS = 60 * 60 * 1000 // 1 hour
export const DEFAULT_ANALYZER_URL = 'https://game-analysis.bridge-classroom.org/analyze'
const KNOWN_ANALYZER_HOSTS = new Set([
  'game-analysis.bridge-classroom.org',
  'game-analysis.bridge-classroom.com',
])
/** Returns the analyzer URL. Resolution order:
 *  1. devAnalyzerUrl (manual override for local dev — set via:
 *       chrome.storage.local.set({ devAnalyzerUrl: 'http://localhost:3001/analyze' })
 *     clear with: chrome.storage.local.remove('devAnalyzerUrl'))
 *  2. preferredAnalyzerHost (auto-tracked: whenever the user visits the
 *     analyzer on .com or .org, analyzerContent.js writes that host here so
 *     subsequent launches stay on the same domain)
 *  3. DEFAULT_ANALYZER_URL (.org) */
export async function getAnalyzerUrl(storage) {
  const result = await storage.get(['devAnalyzerUrl', 'preferredAnalyzerHost'])
  if (result?.devAnalyzerUrl) return result.devAnalyzerUrl
  const host = result?.preferredAnalyzerHost
  if (host && KNOWN_ANALYZER_HOSTS.has(host)) return `https://${host}/analyze`
  return DEFAULT_ANALYZER_URL
}
// Per-host pause between batch items to avoid rate-limiting. ACBL needs more
// breathing room than BBO (we got a 403 on my.acbl.org with no delay; BBO has
// been fine at 250ms). Defaults to 1s for unknown hosts.
export function batchItemDelayMs(url) {
  try {
    const host = new URL(url).hostname
    if (host === 'webutil.bridgebase.com' || host === 'www.bridgebase.com') return 250
    return 1000
  } catch {
    return 1000
  }
}
export const CANCEL_BATCH_PREFIX = 'cancel-batch:'

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
  if (msg.type === 'extract-session') return runExtraction(msg.url, deps)
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

export async function runExtraction(url, deps) {
  const { storage, tabs, crypto, fetch, signal, extract = dispatchExtract } = deps
  if (typeof url !== 'string' || !url) {
    return { type: 'extraction-error', error: { code: 'bad-request', message: 'Missing URL' } }
  }
  let envelope
  try {
    envelope = await extract(url, { fetch: fetch ?? globalThis.fetch, signal })
  } catch (err) {
    return {
      type: 'extraction-error',
      error: { code: classifyError(err), message: err?.message ?? 'Extraction failed' },
    }
  }
  const sid = crypto.randomUUID()
  const key = `${PENDING_PREFIX}${sid}`
  await storage.set({ [key]: { stored_at: Date.now(), envelope } })
  await cacheBboUsername(url, storage)
  const analyzerUrl = await getAnalyzerUrl(storage)
  await tabs.create({ url: `${analyzerUrl}#sid=${sid}` })
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
      const listFetch = host === 'www.bridgebase.com'
        ? (u) => fetchFn(u, { credentials: 'include' }).then((r) => r.text())
        : (u) => fetchFn(u).then((r) => r.text())
      const html = await listFetch(listUrl)
      if (host === 'www.bridgebase.com') {
        eventList = parseBboHistoryList(html)
      } else if (host === 'live.acbl.org') {
        eventList = parsePlayerResults(html)
      } else {
        eventList = parseClubResultsList(html, new URL(listUrl).origin)
      }
    } catch (err) {
      return { type: 'extraction-error', error: { code: classifyError(err), message: err?.message ?? 'Failed to fetch event list' } }
    }

    // Filter by date if requested. date_sort is a Unix timestamp in seconds.
    const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : null
    const filtered = sinceTs ? eventList.filter((e) => e.date_sort >= sinceTs) : eventList
    if (filtered.length === 0) {
      return { type: 'extraction-error', error: { code: 'bad-request', message: 'No events found in the selected date range' } }
    }
    allUrls = filtered.map((e) => e.url)
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
  const analyzerUrl = await getAnalyzerUrl(storage)

  // Return the key immediately so the UI can start showing progress, then
  // continue processing in the background (network requests keep the SW alive).
  const cancelKey = `${CANCEL_BATCH_PREFIX}${key}`
  const isCancelled = async () => {
    try {
      const r = await storage.get(cancelKey)
      return !!r?.[cancelKey]
    } catch { return false }
  }

  const doWork = async () => {
    const items = []
    const errors = []
    let cancelled = false
    for (const url of urls) {
      if (signal?.aborted) break
      if (await isCancelled()) { cancelled = true; break }
      try {
        const envelope = await extract(url, { fetch: fetchFn, signal })
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
      if (storageQuotaHit || signal?.aborted) break
      if (await isCancelled()) { cancelled = true; break }
      await new Promise((r) => setTimeout(r, batchItemDelayMs(url)))
    }
    await storage.set({ [storageKey]: { stored_at: Date.now(), total, completed: items.length + errors.length, items, errors, done: true, cancelled } })
    // Clean up the cancel flag if it was set.
    await storage.remove(cancelKey).catch(() => {})
    // Don't open the analyzer if the batch was cancelled with no items.
    if (!cancelled || items.length > 0) {
      await tabs.create({ url: `${analyzerUrl}#batch=${key}` })
    }
  }

  doWork().catch(() => {
    // Swallow — the storage entry will be left with done:false and will expire.
  })

  return { type: 'batch-started', key, total }
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
  return { type: 'cancel-acknowledged', key }
}

export const BBO_USERNAME_KEY = 'bbo-username'

export async function getBboUsername(deps) {
  const { storage } = deps
  const result = await storage.get(BBO_USERNAME_KEY)
  return { username: result?.[BBO_USERNAME_KEY] ?? null }
}

async function cacheBboUsername(url, storage) {
  try {
    const u = new URL(url)
    if (u.hostname === 'webutil.bridgebase.com') {
      const username = u.searchParams.get('u') ?? u.searchParams.get('U')
      if (username) await storage.set({ [BBO_USERNAME_KEY]: username })
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
