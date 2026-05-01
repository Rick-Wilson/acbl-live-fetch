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
export const ANALYZER_URL = 'https://club-game-analysis.bridge-classroom.com/analyze'
export const UPLOAD_URL = 'https://club-game-analysis.bridge-classroom.com/api/upload-normalized'
export const BATCH_ITEM_DELAY_MS = 1000 // pause between games to avoid rate-limiting my.acbl.org

export async function handleMessage(msg, deps) {
  if (!msg || typeof msg.type !== 'string') {
    return {
      type: 'extraction-error',
      error: { code: 'bad-request', message: 'Missing message type' },
    }
  }
  if (msg.type === 'extract-session') return runExtraction(msg.url, deps)
  if (msg.type === 'consume-pending-session') return consumePending(msg.sid, deps)
  if (msg.type === 'extract-batch') return runBatchExtraction(msg.listUrl, deps, msg.since ?? null)
  if (msg.type === 'consume-pending-batch') return consumePendingBatch(msg.key, deps)
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
  await tabs.create({ url: `${ANALYZER_URL}#sid=${sid}` })
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

async function uploadEnvelope(envelope, fetchFn) {
  const res = await fetchFn(UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`upload failed: ${res.status}${text ? ` — ${text}` : ''}`)
  }
  const json = await res.json()
  if (typeof json.session_id !== 'string') throw new Error('upload response missing session_id')
  return json.session_id
}

export async function runBatchExtraction(listUrl, deps, since = null) {
  const { storage, tabs, crypto, fetch: fetchFn = globalThis.fetch, signal, extract = dispatchExtract } = deps
  if (typeof listUrl !== 'string' || !listUrl) {
    return { type: 'extraction-error', error: { code: 'bad-request', message: 'Missing list URL' } }
  }

  // Fetch and parse the listing page to get the ordered event URL list.
  // BBO listing pages require session credentials; ACBL pages do not.
  let eventList
  try {
    const isBbo = new URL(listUrl).hostname === 'www.bridgebase.com'
    const listFetch = isBbo
      ? (u) => fetchFn(u, { credentials: 'include' }).then((r) => r.text())
      : (u) => fetchFn(u).then((r) => r.text())
    const html = await listFetch(listUrl)
    eventList = isBbo
      ? parseBboHistoryList(html)
      : parseClubResultsList(html, new URL(listUrl).origin)
  } catch (err) {
    return { type: 'extraction-error', error: { code: classifyError(err), message: err?.message ?? 'Failed to fetch event list' } }
  }

  // Filter by date if requested. date_sort is a Unix timestamp in seconds.
  const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : null
  const filtered = sinceTs ? eventList.filter((e) => e.date_sort >= sinceTs) : eventList
  if (filtered.length === 0) {
    return { type: 'extraction-error', error: { code: 'bad-request', message: 'No events found in the selected date range' } }
  }

  const urls = filtered.map((e) => e.url)
  const key = crypto.randomUUID()
  const storageKey = `${PENDING_BATCH_PREFIX}${key}`
  const total = urls.length

  await storage.set({ [storageKey]: { stored_at: Date.now(), total, completed: 0, items: [], errors: [], done: false } })

  // Return the key immediately so the UI can start showing progress, then
  // continue processing in the background (network requests keep the SW alive).
  const doWork = async () => {
    const items = []
    const errors = []
    for (const url of urls) {
      if (signal?.aborted) break
      try {
        const envelope = await extract(url, { fetch: fetchFn, signal })
        const session_id = await uploadEnvelope(envelope, fetchFn)
        items.push({ session_id, source_url: url })
      } catch (err) {
        errors.push({ url, error: err?.message ?? 'failed' })
      }
      await storage.set({ [storageKey]: { stored_at: Date.now(), total, completed: items.length + errors.length, items, errors, done: false } })
      if (!signal?.aborted) await new Promise((r) => setTimeout(r, BATCH_ITEM_DELAY_MS))
    }
    await storage.set({ [storageKey]: { stored_at: Date.now(), total, completed: total, items, errors, done: true } })
    await tabs.create({ url: `${ANALYZER_URL}#batch=${key}` })
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

export async function sweepExpired(deps) {
  const { storage } = deps
  const all = await storage.get(null)
  const toRemove = []
  for (const [key, value] of Object.entries(all ?? {})) {
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
