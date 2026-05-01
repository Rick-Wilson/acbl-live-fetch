// BBO lobby content script. Runs on www.bridgebase.com/v3/*.
// Watches for the "Recent tournaments" history panel to appear, then injects
// a "Fetch History" button above the column headers. Click opens a date-range
// picker that sends an extract-batch message to the service worker using the
// same hands.php listing URL that the tview-page picker uses.

const BUTTON_ID = 'bridge-classroom-history-btn'
const PICKER_ID = 'bridge-classroom-history-picker'

const PRESETS = [
  { label: 'Most recent',   months: 1,  max: 1 },
  { label: 'Last month',    months: 1,  max: null },
  { label: 'Last 3 months', months: 3,  max: null },
  { label: 'Last 6 months', months: 6,  max: null },
  { label: 'Last year',     months: 12, max: null },
  { label: 'All time',      months: null, max: null },
]

// ── Username resolution ──────────────────────────────────────────────────────

// Try to resolve the BBO username in priority order:
//   1. Cached value from a prior tview extraction (stored by the tview content script)
//   2. span.username on the current page (appears on some BBO pages)
//   3. Ask the service worker (which may have seen a tview URL recently)
async function resolveUsername(sendMessage) {
  // 1. BBO lobby nav bar: name-tag > button > span.mat-button-wrapper
  //    The username is a text node inside that span (" kemistry ").
  const wrapper = document.querySelector('name-tag span.mat-button-wrapper')
  if (wrapper) {
    for (const node of wrapper.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        return node.textContent.trim()
      }
    }
  }

  // 2. Cached from a prior tview extraction (stored when user clicked our
  //    button on a tview page).
  const stored = await sendMessage({ type: 'get-bbo-username' })
  if (stored?.username) return stored.username

  return null
}

// ── Date-range picker ────────────────────────────────────────────────────────

function buildPicker(onSelect) { // onSelect(months, max)
  const picker = document.createElement('div')
  picker.id = PICKER_ID
  Object.assign(picker.style, {
    position: 'absolute',
    top: '100%',
    left: '0',
    marginTop: '2px',
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    zIndex: '2147483647',
    minWidth: '220px',
    overflow: 'hidden',
  })
  for (const preset of PRESETS) {
    const item = document.createElement('button')
    item.type = 'button'
    item.textContent = preset.label
    Object.assign(item.style, {
      display: 'block',
      width: '100%',
      padding: '6px 14px',
      background: 'none',
      border: 'none',
      borderBottom: '1px solid #eee',
      textAlign: 'left',
      cursor: 'pointer',
      fontSize: '19px',
      fontWeight: '500',
      color: '#333',
      boxSizing: 'border-box',
    })
    item.addEventListener('mouseover', () => { item.style.background = '#f5f5f5' })
    item.addEventListener('mouseout', () => { item.style.background = 'none' })
    item.addEventListener('click', (e) => { e.stopPropagation(); onSelect(preset.months, preset.max) })
    picker.appendChild(item)
  }
  return picker
}

// ── Button ───────────────────────────────────────────────────────────────────

function buildButton() {
  const btn = document.createElement('button')
  btn.id = BUTTON_ID
  btn.type = 'button'
  btn.textContent = 'Analyze in Bridge Classroom'
  Object.assign(btn.style, {
    display: 'inline-block',
    margin: '4px 0 4px 6px',
    padding: '6px 14px',
    background: '#1a73e8',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '19px',
    fontWeight: '500',
    cursor: 'pointer',
    position: 'relative',
  })
  return btn
}

function setState(btn, state, msg) {
  const labels = {
    idle: 'Fetch History',
    working: msg ?? 'Fetching…',
    success: 'Done — opening analyzer…',
  }
  btn.textContent = labels[state] ?? 'Fetch History'
  btn.disabled = state !== 'idle' && state !== 'error'
  if (state === 'error') {
    btn.textContent = `Error: ${msg ?? 'failed'}`
    btn.style.background = '#c62828'
    setTimeout(() => {
      btn.textContent = 'Fetch History'
      btn.style.background = '#1a73e8'
      btn.disabled = false
    }, 3000)
  }
}

// ── Injection ────────────────────────────────────────────────────────────────

export function injectHistoryButton(sendMessage, storage) {
  if (document.getElementById(BUTTON_ID)) return

  // Find the list container inside the history panel.
  const listClass = document.querySelector('historic-tournament-list .listClass')
  if (!listClass) return

  const btn = buildButton()

  btn.addEventListener('click', () => {
    if (btn.disabled) return
    const existingPicker = document.getElementById(PICKER_ID)
    if (existingPicker) { existingPicker.remove(); return }

    const picker = buildPicker(async (months, max) => {
      picker.remove()
      document.removeEventListener('click', closeOnOutside)

      const username = await resolveUsername(sendMessage)
      if (!username) {
        setState(btn, 'error', 'Could not find BBO username — open a game result first')
        return
      }

      const endTime = Math.floor(Date.now() / 1000)
      const startTime = months != null
        ? endTime - months * 30 * 24 * 3600
        : 1262304000 // 2010-01-01
      const listUrl = `https://www.bridgebase.com/myhands/hands.php?username=${encodeURIComponent(username)}&start_time=${startTime}&end_time=${endTime}`

      setState(btn, 'working', 'Starting…')
      let response
      try {
        response = await sendMessage({ type: 'extract-batch', listUrl, since: null, max })
      } catch (err) {
        setState(btn, 'error', err?.message)
        return
      }
      if (!response || typeof response !== 'object') {
        setState(btn, 'error', 'unexpected response')
        return
      }
      if (response.type === 'extraction-error') {
        setState(btn, 'error', response.error?.message)
        return
      }
      if (response.type === 'batch-started') {
        // Watch progress via storage.
        const key = `pending-batch:${response.key}`
        const listener = (changes) => {
          const entry = changes[key]?.newValue
          if (!entry) return
          if (entry.done) {
            storage.onChanged.removeListener(listener)
            setState(btn, 'success')
            setTimeout(() => setState(btn, 'idle'), 3000)
          } else {
            setState(btn, 'working', `Fetching ${entry.completed} of ${entry.total}…`)
          }
        }
        storage.onChanged.addListener(listener)
        setState(btn, 'working', `Fetching 0 of ${response.total}…`)
      }
    })

    btn.appendChild(picker)

    function closeOnOutside(e) {
      if (!picker.contains(e.target) && e.target !== btn) {
        picker.remove()
        document.removeEventListener('click', closeOnOutside)
      }
    }
    setTimeout(() => document.addEventListener('click', closeOnOutside), 0)
  })

  // Wrap in a centered flex row and insert before the column headers.
  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, {
    display: 'flex',
    justifyContent: 'center',
    padding: '4px 0',
  })
  wrapper.appendChild(btn)

  const header = listClass.querySelector('celled-rectangle.headerClass')
  if (header) {
    listClass.insertBefore(wrapper, header)
  } else {
    listClass.prepend(wrapper)
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

if (typeof globalThis.chrome !== 'undefined' || typeof globalThis.browser !== 'undefined') {
  import('webextension-polyfill').then(({ default: browser }) => {
    const sendMessage = (msg) => browser.runtime.sendMessage(msg)
    // eslint-disable-next-line no-undef
    const storage = chrome.storage.local

    const tryInject = () => injectHistoryButton(sendMessage, storage)

    // Watch for the history panel to mount or its content to change.
    const observer = new MutationObserver(() => {
      if (!document.getElementById(BUTTON_ID)) tryInject()
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Also try immediately in case the panel is already rendered.
    tryInject()
  }).catch(() => {})
}
