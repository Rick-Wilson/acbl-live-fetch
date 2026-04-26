// Bridge content script. Runs at document_start on
// club-game-analysis.bridge-classroom.com/analyze*.
// Reads `#sid=<uuid>` from the URL fragment, asks the service worker to hand
// over the pending session, and writes it into window.sessionStorage under
// the key the SPA will read on mount.
//
// Protocol details: docs/handoff-protocol.md.

export const PENDING_SESSION_KEY = 'pending-session'

export function parseSid(hash) {
  if (typeof hash !== 'string') return null
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash
  if (!fragment) return null
  const params = new URLSearchParams(fragment)
  const sid = params.get('sid')
  if (!sid) return null
  // Light validation — UUIDv4-ish: 8-4-4-4-12 hex chars. Anything else,
  // ignore so we don't end up making round-trips for stray fragments.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) {
    return null
  }
  return sid
}

export async function runHandoff(deps) {
  const { location, history, sessionStorage, sendMessage } = deps
  const sid = parseSid(location?.hash)
  if (!sid) return { state: 'no-sid' }

  let response
  try {
    response = await sendMessage({ type: 'consume-pending-session', sid })
  } catch (err) {
    return { state: 'send-failed', error: err?.message ?? String(err) }
  }

  // Always clear the fragment so reloads don't re-trigger consumption.
  try {
    history.replaceState(null, '', location.pathname + (location.search ?? ''))
  } catch {
    // history may not be available in some test contexts; non-fatal.
  }

  if (!response || typeof response !== 'object') {
    return { state: 'malformed-response' }
  }
  if (response.type !== 'pending-session') {
    return { state: 'no-session', reason: response.reason ?? 'unknown' }
  }
  if (!response.envelope || typeof response.envelope !== 'object') {
    return { state: 'malformed-response' }
  }

  try {
    sessionStorage.setItem(PENDING_SESSION_KEY, JSON.stringify(response.envelope))
  } catch (err) {
    return { state: 'storage-failed', error: err?.message ?? String(err) }
  }
  return { state: 'written', sid }
}

// Entry point — only runs when loaded as a content script (chrome present).
if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
  runHandoff({
    location: window.location,
    history: window.history,
    sessionStorage: window.sessionStorage,
    sendMessage: (msg) => chrome.runtime.sendMessage(msg),
  }).catch(() => {
    // Swallow — there's nothing user-facing to do; the SPA falls back to its
    // empty state.
  })
}
