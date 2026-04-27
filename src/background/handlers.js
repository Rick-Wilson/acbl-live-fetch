// Pure message-handling logic for the service worker. All chrome.* APIs are
// passed in via the `deps` parameter so this file is testable without a
// browser. The thin wrapper in src/background.js wires real chrome APIs in.
//
// Message protocol: see docs/handoff-protocol.md.

import acblLiveAdapter from '../adapters/acbl-live/index.js'
import acblLiveClubAdapter from '../adapters/acbl-live-club/index.js'

// Adapter registry. The first adapter whose matchesUrl(url) returns true
// owns that URL. Order matters when adapters could overlap; today they
// don't (different hostnames), but list more-specific ones first.
export const ADAPTERS = [acblLiveClubAdapter, acblLiveAdapter]

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
export const PENDING_TTL_MS = 60 * 60 * 1000 // 1 hour
export const ANALYZER_URL = 'https://club-game-analysis.bridge-classroom.com/analyze'

export async function handleMessage(msg, deps) {
  if (!msg || typeof msg.type !== 'string') {
    return {
      type: 'extraction-error',
      error: { code: 'bad-request', message: 'Missing message type' },
    }
  }
  if (msg.type === 'extract-session') return runExtraction(msg.url, deps)
  if (msg.type === 'consume-pending-session') return consumePending(msg.sid, deps)
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

export async function sweepExpired(deps) {
  const { storage } = deps
  const all = await storage.get(null)
  const toRemove = []
  for (const [key, value] of Object.entries(all ?? {})) {
    if (!key.startsWith(PENDING_PREFIX)) continue
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
