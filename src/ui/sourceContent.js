// Source content script. Runs on live.acbl.org/* and my.acbl.org/* and
// injects an "Analyze in Bridge Classroom" button on supported pages. Click
// sends the page URL to the service worker; the SW dispatches to the
// matching adapter and opens the analyzer tab with the extracted envelope.

import { classifyPage as classifyLive } from '../adapters/acbl-live/index.js'
import { classifyPage as classifyClub } from '../adapters/acbl-live-club/index.js'

const BUTTON_ID = 'bridge-classroom-analyze-btn'

// Page types that trigger injection — one per supported source. Each adapter
// owns a different hostname today, so the classifyPage calls are mutually
// exclusive.
//   * pair-scorecard    — live.acbl.org per-pair page (the canonical entry)
//   * event-summary     — live.acbl.org event-level page; the user often
//                         lands here. We fetch the summary, find a pair
//                         scorecard link, and run the standard extraction
//                         (with user_pair: null since no pair is implied).
//   * club-game-result  — my.acbl.org club-game page
const INJECT_PAGE_TYPES = new Set(['pair-scorecard', 'event-summary', 'club-game-result'])

export function shouldInject(url) {
  return INJECT_PAGE_TYPES.has(classifyLive(url)) || INJECT_PAGE_TYPES.has(classifyClub(url))
}

export function buttonStates() {
  return {
    idle: { label: 'Analyze in Bridge Classroom', disabled: false },
    extracting: { label: 'Extracting…', disabled: true },
    success: { label: 'Opening analyzer…', disabled: true },
    error: (msg) => ({ label: `Error: ${msg ?? 'extraction failed'}`, disabled: false }),
  }
}

export function buildButton(doc) {
  const btn = doc.createElement('button')
  btn.id = BUTTON_ID
  btn.type = 'button'
  btn.textContent = buttonStates().idle.label
  // Inline minimal styling so the button is recognizable without depending on
  // the host page's CSS. Kept small on purpose — a future polish pass can do
  // proper theming. No vertical margin so the button sits flush within the
  // h1 row when wrapped in a flex container.
  Object.assign(btn.style, {
    display: 'inline-block',
    padding: '8px 14px',
    background: '#1a73e8',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    flexShrink: '0',
  })
  return btn
}

export function applyState(btn, state, message) {
  const states = buttonStates()
  let next
  if (state === 'error') next = states.error(message)
  else next = states[state] ?? states.idle
  btn.textContent = next.label
  btn.disabled = next.disabled
}

export function pickAnchor(doc) {
  // Prefer placing the button on the same row as the date <h1> (right-justified
  // via a flex wrapper) so it doesn't add to the page's vertical height.
  // Fall back to the user-pair <h4>, then the document body.
  return doc.querySelector('h1') ?? doc.querySelector('h4') ?? doc.body
}

export function pickInjectionStrategy(url) {
  // my.acbl.org is a Vue SPA: at document_idle the DOM is just a noscript
  // shell, then Vue mounts and replaces it. An in-flow injection anchored to
  // the static <h1> would get clobbered. Use a fixed-position overlay button
  // there so it doesn't depend on the page's DOM structure.
  // live.acbl.org is server-rendered; use the in-flow strategy that puts the
  // button on the date row.
  try {
    return new URL(url).hostname === 'my.acbl.org' ? 'overlay' : 'inline'
  } catch {
    return 'inline'
  }
}

export async function handleClick(deps) {
  const { url, sendMessage, setState } = deps
  setState('extracting')
  let response
  try {
    response = await sendMessage({ type: 'extract-session', url })
  } catch (err) {
    setState('error', err?.message ?? 'message channel error')
    return
  }
  if (!response || typeof response !== 'object') {
    setState('error', 'unexpected service worker response')
    return
  }
  if (response.type === 'extraction-complete') {
    setState('success')
    // The analyzer tab has opened; restore the button to idle so this page
    // is ready for another click (e.g., to extract a different scorecard)
    // without leaving stale "Opening analyzer…" state behind.
    setTimeout(() => setState('idle'), 2000)
    return
  }
  setState('error', response.error?.message ?? 'extraction failed')
}

export function injectButton(deps) {
  const { document: doc, location, sendMessage } = deps
  if (!shouldInject(location.href)) return null
  if (doc.getElementById(BUTTON_ID)) return doc.getElementById(BUTTON_ID)
  const btn = buildButton(doc)
  btn.addEventListener('click', () => {
    handleClick({
      url: location.href,
      sendMessage,
      setState: (state, msg) => applyState(btn, state, msg),
    })
  })

  if (pickInjectionStrategy(location.href) === 'overlay') {
    // Fixed-position floating button. Resilient to SPA re-renders because
    // it doesn't depend on any specific anchor element. zIndex is
    // intentionally extreme so the host page's stacking can't hide it.
    Object.assign(btn.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: '2147483647',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
    })
    if (!doc.body) return null
    doc.body.appendChild(btn)
    return btn
  }

  // In-flow strategy (server-rendered pages like live.acbl.org).
  const anchor = pickAnchor(doc)
  if (!anchor) return null
  if (anchor === doc.body) {
    anchor.appendChild(btn)
  } else if (anchor.tagName === 'H1') {
    // Wrap the h1 in a flex row and put the button on the right edge —
    // same vertical row, no added page height.
    const wrapper = doc.createElement('div')
    Object.assign(wrapper.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '12px',
    })
    anchor.parentElement.insertBefore(wrapper, anchor)
    wrapper.appendChild(anchor)
    wrapper.appendChild(btn)
  } else {
    anchor.insertAdjacentElement('afterend', btn)
  }
  return btn
}

// Entry point — only runs when loaded as a content script. The polyfill is
// imported lazily (via dynamic import + .then) so test imports of this module
// don't drag in extension APIs that don't exist in jsdom, and so we avoid
// top-level await (not available in our build target).
if (typeof globalThis.chrome !== 'undefined' || typeof globalThis.browser !== 'undefined') {
  import('webextension-polyfill').then(({ default: browser }) => {
    const opts = {
      document,
      location: window.location,
      sendMessage: (msg) => browser.runtime.sendMessage(msg),
    }
    const start = () => injectButton(opts)

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true })
    } else {
      start()
    }

    // SPAs (e.g., my.acbl.org's Vue page) mount after document_idle and may
    // wipe the body when they render. Watch for our button disappearing and
    // re-inject. injectButton is idempotent, so we can call it freely; we
    // only re-call when the button is missing.
    if (typeof MutationObserver !== 'undefined' && document.body) {
      let scheduled = false
      const reinject = () => {
        if (scheduled) return
        if (document.getElementById('bridge-classroom-analyze-btn')) return
        scheduled = true
        // Defer to next microtask to coalesce mutation bursts.
        Promise.resolve().then(() => {
          scheduled = false
          start()
        })
      }
      const observer = new MutationObserver(reinject)
      observer.observe(document.documentElement, { childList: true, subtree: true })
    }
  })
}
