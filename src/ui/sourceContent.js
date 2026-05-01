// Source content script. Runs on live.acbl.org/* and my.acbl.org/* and
// injects an "Analyze in Bridge Classroom" button on supported pages. Click
// sends the page URL to the service worker; the SW dispatches to the
// matching adapter and opens the analyzer tab with the extracted envelope.

import { classifyPage as classifyLive } from '../adapters/acbl-live/index.js'
import { classifyPage as classifyClub } from '../adapters/acbl-live-club/index.js'
import { classifyPage as classifyBbo } from '../adapters/bbo/index.js'

const BUTTON_ID = 'bridge-classroom-analyze-btn'

// Page types that trigger injection — one per supported source. Each adapter
// owns a different hostname today, so the classifyPage calls are mutually
// exclusive.
//   * pair-scorecard    — live.acbl.org per-pair page (the canonical entry)
//   * event-summary     — live.acbl.org event-level page
//   * club-game-result  — my.acbl.org club-game page
//   * tournament-view   — webutil.bridgebase.com/v2/tview.php
//   * hands-list        — www.bridgebase.com/myhands/hands.php?tourney=
const INJECT_PAGE_TYPES = new Set([
  'pair-scorecard',
  'event-summary',
  'club-game-result',
  'club-results-list',
  'tournament-view',
  'hands-list',
])

export function shouldInject(url) {
  return (
    INJECT_PAGE_TYPES.has(classifyLive(url)) ||
    INJECT_PAGE_TYPES.has(classifyClub(url)) ||
    INJECT_PAGE_TYPES.has(classifyBbo(url))
  )
}

export function buttonStates() {
  return {
    idle: { label: 'Analyze in Bridge Classroom', disabled: false },
    extracting: { label: 'Extracting…', disabled: true },
    progress: { label: 'Fetching…', disabled: true },
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
  else if (state === 'progress') next = { label: message ?? 'Fetching…', disabled: true }
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
  // live.acbl.org is server-rendered; use the in-flow strategy.
  // my.acbl.org is a Vue SPA: inject into the navbar ul alongside Login.
  //   If Vue hasn't mounted yet, injectButton returns null and the
  //   MutationObserver retries once the nav appears.
  // BBO pages (bridgebase.com) have no obvious anchor; use a fixed overlay.
  try {
    const host = new URL(url).hostname
    if (host === 'my.acbl.org') return 'club-nav'
    if (host.endsWith('bridgebase.com')) return 'overlay'
    return 'inline'
  } catch {
    return 'inline'
  }
}

export async function handleClick(deps) {
  const { url, sendMessage, setState, buildMessage, onBatchStarted } = deps
  setState('extracting')
  const msg = buildMessage ? buildMessage(url) : { type: 'extract-session', url }
  let response
  try {
    response = await sendMessage(msg)
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
    setTimeout(() => setState('idle'), 2000)
    return
  }
  if (response.type === 'batch-started') {
    onBatchStarted?.(response.key, response.total)
    return
  }
  setState('error', response.error?.message ?? 'extraction failed')
}

export function watchBatchProgress(key, setState, storage) {
  // Watches storage for progress updates written by the SW after each game.
  // `storage` must be the chrome.storage.local object.
  const storageKey = `pending-batch:${key}`
  const listener = (changes) => {
    const change = changes[storageKey]
    if (!change) return
    const entry = change.newValue
    if (!entry) return
    if (entry.done) {
      storage.onChanged.removeListener(listener)
      setState('success')
      setTimeout(() => setState('idle'), 2000)
    } else {
      setState('progress', `Fetching ${entry.completed} of ${entry.total}…`)
    }
  }
  storage.onChanged.addListener(listener)
}

const DATE_PICKER_ID = 'bridge-classroom-date-picker'

const BATCH_PRESETS = [
  { label: 'Last month',    months: 1 },
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'Last year',     months: 12 },
  { label: 'All time',      months: null },
]

export function buildDatePicker(doc, onSelect) {
  const picker = doc.createElement('div')
  picker.id = DATE_PICKER_ID
  Object.assign(picker.style, {
    position: 'absolute',
    top: '100%',
    right: '0',
    marginTop: '4px',
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    zIndex: '2147483647',
    minWidth: '160px',
    overflow: 'hidden',
  })
  for (const preset of BATCH_PRESETS) {
    const item = doc.createElement('button')
    item.type = 'button'
    item.textContent = preset.label
    Object.assign(item.style, {
      display: 'block',
      width: '100%',
      padding: '8px 16px',
      background: 'none',
      border: 'none',
      borderBottom: '1px solid #eee',
      textAlign: 'left',
      cursor: 'pointer',
      fontSize: '14px',
      color: '#333',
      boxSizing: 'border-box',
    })
    item.addEventListener('mouseover', () => { item.style.background = '#f5f5f5' })
    item.addEventListener('mouseout', () => { item.style.background = 'none' })
    item.addEventListener('click', (e) => { e.stopPropagation(); onSelect(preset.months) })
    picker.appendChild(item)
  }
  return picker
}

export function injectButton(deps) {
  const { document: doc, location, sendMessage } = deps
  if (!shouldInject(location.href)) return null
  const existing = doc.getElementById(BUTTON_ID)
  if (existing) return existing
  const btn = buildButton(doc)

  // Click handling is done via document-level delegation (see setupClickDelegation)
  // so that Cloudflare Rocket Loader's DOM cloning doesn't strip the listener.

  const strategy = pickInjectionStrategy(location.href)

  if (strategy === 'club-nav') {
    const ul = doc.querySelector('ul.navbar-nav')
    if (!ul) return null
    const li = doc.createElement('li')
    li.appendChild(btn)
    ul.appendChild(li)
    return btn
  }

  if (strategy === 'overlay') {
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

// Attach a single delegated click listener to `doc` so that Cloudflare Rocket
// Loader (which clones DOM nodes and strips addEventListener listeners) can't
// break our button. Any click anywhere is checked: if it hit our button we
// handle it; otherwise ignored.
export function setupClickDelegation(deps) {
  const { document: doc, location, sendMessage } = deps
  doc.addEventListener('click', (e) => {
    const btn = e.target.closest(`#${BUTTON_ID}`)
    if (!btn || btn.disabled) return

    const isBatch = classifyClub(location.href) === 'club-results-list'

    if (isBatch && btn.textContent === buttonStates().idle.label) {
      btn.textContent = 'Fetch History'
    } else if (!isBatch && btn.textContent === 'Fetch History') {
      btn.textContent = buttonStates().idle.label
    }

    if (isBatch) {
      const existing = doc.getElementById(DATE_PICKER_ID)
      if (existing) { existing.remove(); return }

      const picker = buildDatePicker(doc, (months) => {
        picker.remove()
        doc.removeEventListener('click', closeOnOutside)
        const since = months != null ? new Date() : null
        if (since) since.setMonth(since.getMonth() - months)
        handleClick({
          url: location.href,
          sendMessage,
          setState: (state, msg) => applyState(btn, state, msg),
          buildMessage: (url) => ({
            type: 'extract-batch',
            listUrl: url,
            since: since ? since.toISOString().slice(0, 10) : null,
          }),
          onBatchStarted: (key, total) => {
            applyState(btn, 'progress', `Fetching 0 of ${total}…`)
            // eslint-disable-next-line no-undef
            watchBatchProgress(key, (state, msg) => applyState(btn, state, msg), chrome.storage.local)
          },
        })
      })

      const anchor = btn.parentElement ?? btn
      anchor.style.position = 'relative'
      anchor.appendChild(picker)

      function closeOnOutside(e2) {
        if (!picker.contains(e2.target) && e2.target !== btn) {
          picker.remove()
          doc.removeEventListener('click', closeOnOutside)
        }
      }
      setTimeout(() => doc.addEventListener('click', closeOnOutside), 0)
    } else {
      handleClick({
        url: location.href,
        sendMessage,
        setState: (state, msg) => applyState(btn, state, msg),
        buildMessage: (url) => ({ type: 'extract-session', url }),
      })
    }
  })
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

    // Delegation is set up after initial injection so a throw here can't
    // prevent the button from appearing.
    setupClickDelegation(opts)

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
