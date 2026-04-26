// Source content script. Runs on live.acbl.org/* and injects an "Analyze in
// Bridge Classroom" button on supported pages. Click sends the page URL to
// the service worker; the SW does the extraction and opens the analyzer tab.

import { classifyPage } from '../adapters/acbl-live/index.js'

const BUTTON_ID = 'bridge-classroom-analyze-btn'

export function shouldInject(url) {
  return classifyPage(url) === 'pair-scorecard'
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
  // proper theming.
  Object.assign(btn.style, {
    display: 'inline-block',
    padding: '8px 14px',
    margin: '12px 0',
    background: '#1a73e8',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
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
  // Place the button near the user-pair header; falls back to the document body.
  return doc.querySelector('h4') ?? doc.body
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
  } else {
    anchor.insertAdjacentElement('afterend', btn)
  }
  return btn
}

// Entry point — only runs when loaded as a content script (chrome present).
if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
  const start = () =>
    injectButton({
      document,
      location: window.location,
      sendMessage: (msg) => chrome.runtime.sendMessage(msg),
    })
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
