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
const INJECT_PAGE_TYPES = new Set(['pair-scorecard', 'club-game-result'])

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
  const anchor = pickAnchor(doc)
  if (!anchor) return null
  const btn = buildButton(doc)
  btn.addEventListener('click', () => {
    handleClick({
      url: location.href,
      sendMessage,
      setState: (state, msg) => applyState(btn, state, msg),
    })
  })
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
    const start = () =>
      injectButton({
        document,
        location: window.location,
        sendMessage: (msg) => browser.runtime.sendMessage(msg),
      })
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true })
    } else {
      start()
    }
  })
}
