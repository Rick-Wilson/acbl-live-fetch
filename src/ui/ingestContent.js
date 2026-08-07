// Ingest content script — the extension half of docs/ingest-protocol.md.
//
// Matched origin-wide (ADR 0001 Decision 1) but only activates on the /ingest
// route. That gate matters: analyzerContent.js consumes the same `#sid=`
// fragment on /game-analysis/, and both scripts calling consume-pending-session
// would race for an entry that the first call deletes.
//
// Runs at document_start so the message listener is attached before any page
// script can post `ready`. The page speaks first — see the protocol doc for why
// a handshake replaced the old sessionStorage write.

export const CHANNEL = 'bc-ingest'
export const PROTOCOL_VERSION = 1
export const READY_TIMEOUT_MS = 10_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Returns {kind, ref} or null. Mirrors analyzerContent's parsing, but returns
// which flavour was found so the caller picks the right consume message.
export function parseRef(hash) {
  if (typeof hash !== 'string') return null
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash
  if (!fragment) return null
  const params = new URLSearchParams(fragment)
  for (const [key, kind] of [['sid', 'session'], ['batch', 'batch']]) {
    const value = params.get(key)
    if (value && UUID_RE.test(value)) return { kind, ref: value }
  }
  return null
}

export function isIngestPath(pathname) {
  return typeof pathname === 'string' && pathname.replace(/\/+$/, '').endsWith('/ingest')
}

// Turn a consumed payload into the chunk list the protocol sends. Sessions are
// a single JSON chunk; batch items are already gzip+base64 in storage
// (handlers.js compressEnvelope) and are forwarded as-is rather than being
// inflated here only for the page to re-parse.
export function toChunks(kind, response) {
  if (kind === 'session') {
    return [{ encoding: 'json', data: JSON.stringify(response.envelope) }]
  }
  return (response.items ?? []).map((item) => ({
    encoding: 'gzip+base64',
    data: item.compressed,
  }))
}

// Attach the `ready` listener. Must be called synchronously at document_start,
// before any await — the page posts `ready` from an inline script that can run
// before a dynamic import resolves, and a missed `ready` strands the handoff.
export function listenForReady(deps, ref) {
  const { addMessageListener, origin, self, timeoutMs = READY_TIMEOUT_MS } = deps
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    addMessageListener((event) => {
      if (event.source !== undefined && event.source !== self) return
      if (event.origin !== origin) return
      const m = event.data
      if (m?.channel !== CHANNEL || m.v !== PROTOCOL_VERSION || m.ref !== ref) return
      if (m.type === 'ready') {
        clearTimeout(timer)
        resolve(true)
      }
    })
  })
}

export async function runIngest(deps) {
  const { location, history, postMessage, sendMessage, readyPromise } = deps

  if (!isIngestPath(location?.pathname)) return { state: 'not-ingest-path' }
  const parsed = parseRef(location?.hash)
  if (!parsed) return { state: 'no-ref' }
  const { kind, ref } = parsed

  const origin = location.origin
  const send = (msg) => postMessage({ channel: CHANNEL, v: PROTOCOL_VERSION, ref, ...msg }, origin)

  const ready = await (readyPromise ?? listenForReady({ ...deps, origin }, ref))
  // Silence is the common case here — the user navigated away. Nothing is lost:
  // the payload stays in chrome.storage.local until the TTL expires.
  if (!ready) return { state: 'ready-timeout', ref }

  // Clear the fragment only now. Doing it earlier races the page's own read of
  // the hash — `ready` arriving proves the page already has the ref. A reload
  // then finds no fragment, which is correct: the payload is consumed below.
  try {
    history.replaceState(null, '', location.pathname + (location.search ?? ''))
  } catch {
    // non-fatal in test contexts
  }

  let response
  try {
    response = await sendMessage({
      type: kind === 'session' ? 'consume-pending-session' : 'consume-pending-batch',
      ...(kind === 'session' ? { sid: ref } : { key: ref }),
    })
  } catch (err) {
    send({ type: 'error', reason: 'send-failed', detail: err?.message ?? String(err) })
    return { state: 'send-failed', ref }
  }

  const expected = kind === 'session' ? 'pending-session' : 'pending-batch'
  if (!response || typeof response !== 'object' || response.type !== expected) {
    const reason = response?.reason === 'expired' ? 'expired' : 'not-found'
    send({ type: 'error', reason, detail: response?.reason ?? 'unknown' })
    return { state: 'no-session', ref, reason }
  }
  if (kind === 'session' && (!response.envelope || typeof response.envelope !== 'object')) {
    send({ type: 'error', reason: 'malformed', detail: 'envelope missing' })
    return { state: 'malformed', ref }
  }

  const chunks = toChunks(kind, response)
  const bytes = chunks.reduce((n, c) => n + c.data.length, 0)
  send({ type: 'begin', kind, parts: chunks.length, bytes })
  chunks.forEach((chunk, seq) => send({ type: 'chunk', seq, ...chunk }))
  send({ type: 'finish', parts: chunks.length, errors: response.errors ?? [] })

  return { state: 'delivered', ref, kind, parts: chunks.length }
}

// Entry point — only when loaded as a content script.
//
// Ordering is load-bearing: the listener is attached synchronously, before the
// polyfill import, because the page's inline script can post `ready` while that
// import is still resolving.
if (typeof globalThis.chrome !== 'undefined' || typeof globalThis.browser !== 'undefined') {
  const parsed = isIngestPath(window.location.pathname) ? parseRef(window.location.hash) : null
  if (parsed) {
    const shared = {
      location: window.location,
      history: window.history,
      self: window,
      origin: window.location.origin,
      postMessage: (msg, origin) => window.postMessage(msg, origin),
      addMessageListener: (fn) => window.addEventListener('message', fn),
    }
    const readyPromise = listenForReady(shared, parsed.ref)
    import('webextension-polyfill').then(({ default: browser }) => {
      runIngest({
        ...shared,
        readyPromise,
        sendMessage: (msg) => browser.runtime.sendMessage(msg),
      }).catch(() => {})
    }).catch(() => {})
  }
}
