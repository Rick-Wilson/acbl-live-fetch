// BBO lobby content script. Runs on www.bridgebase.com/v3/*.
// Watches for the "Recent tournaments" history panel to appear, then injects
// a "Fetch History" button above the column headers. Click opens a date-range
// picker that sends an extract-batch message to the service worker using the
// same hands.php listing URL that the tview-page picker uses.

const BUTTON_ID = 'bridge-classroom-history-btn'
const CANCEL_ID = 'bridge-classroom-history-cancel'
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
async function resolveUsername(sendMessage, { pollMs = 0, onWait } = {}) {
  // Synchronous reads (DOM + cached). Tries DOM first, then cache.
  function tryNow() {
    const wrapper = document.querySelector('name-tag span.mat-button-wrapper')
    if (wrapper) {
      for (const node of wrapper.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          return node.textContent.trim()
        }
      }
    }
    return null
  }

  // First: try DOM right now.
  let name = tryNow()
  if (name) return name

  // Then: cached from a prior tview extraction.
  const stored = await sendMessage({ type: 'get-bbo-username' })
  if (stored?.username) return stored.username

  // Optionally poll the DOM — useful for the mega export which fires before
  // BBO's nav bar has finished rendering after login.
  if (pollMs > 0) {
    const deadline = Date.now() + pollMs
    while (Date.now() < deadline) {
      onWait?.()
      await new Promise((r) => setTimeout(r, 500))
      name = tryNow()
      if (name) return name
    }
  }
  return null
}

// Open the hands.php listing in a minimized browser window so the browser
// handles BBO's auth + timezone redirect properly. The hands.php content
// script parses the rendered DOM and stores the URLs in extension storage,
// which we read back here. Returns { urls, invalidInput }: urls is newest-first;
// invalidInput is true when BBO rejected the date range (>~30 days).
async function openTabAndCollect(sendMessage, storage, listUrl) {
  await storage.set({ 'bbo-batch-pending': { listUrl, timestamp: Date.now() } })
  await sendMessage({ type: 'open-bbo-batch-tab', url: listUrl })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      storage.onChanged.removeListener(listener)
      storage.remove('bbo-batch-pending').catch(() => {})
      reject(new Error('Timed out loading BBO game list'))
    }, 15000)
    function listener(changes) {
      if (!changes['bbo-batch-result']) return
      clearTimeout(timer)
      storage.onChanged.removeListener(listener)
      const result = changes['bbo-batch-result'].newValue
      storage.remove('bbo-batch-result').catch(() => {})
      resolve({ urls: result?.urls ?? [], invalidInput: !!result?.invalidInput })
    }
    storage.onChanged.addListener(listener)
  })
}

// BBO's hands.php rejects ranges over ~30 days. Chunk longer ranges into
// 28-day windows (newest-first) and combine. Stops early if a chunk hits
// "Invalid input" (shouldn't happen at this size) or returns empty (no
// games before this point — common at the bottom of "All time").
async function openTabAndCollectChunked({ sendMessage, storage, username, startTime, endTime, onProgress, isCancelled, targetCount }) {
  const CHUNK_SECONDS = 28 * 24 * 3600
  const out = []
  const seen = new Set()
  let chunkEnd = endTime
  let chunkIndex = 0
  while (chunkEnd > startTime) {
    if (isCancelled && (await isCancelled())) break
    // Stop chunking early once we've collected enough URLs for the caller's
    // target count. Useful for testing (limit=4) and "Most recent" presets.
    if (targetCount != null && out.length >= targetCount) break
    const chunkStart = Math.max(startTime, chunkEnd - CHUNK_SECONDS)
    chunkIndex++
    onProgress?.(chunkIndex)
    const url = `https://www.bridgebase.com/myhands/hands.php?username=${encodeURIComponent(username)}&start_time=${chunkStart}&end_time=${chunkEnd}`
    const { urls, invalidInput } = await openTabAndCollect(sendMessage, storage, url)
    if (invalidInput) {
      // Shouldn't happen at 28 days; if it does, halve and retry once.
      // For now, just stop.
      break
    }
    for (const u of urls) {
      if (!seen.has(u)) { seen.add(u); out.push(u) }
    }
    chunkEnd = chunkStart
    // Small breath between chunks so we don't hammer BBO.
    if (chunkEnd > startTime) await new Promise((r) => setTimeout(r, 250))
  }
  return out
}

const LISTING_CANCEL_KEY = 'bbo-listing-cancel'

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

function buildCancelButton() {
  const cx = document.createElement('button')
  cx.id = CANCEL_ID
  cx.type = 'button'
  cx.textContent = '✕'
  cx.title = 'Cancel'
  Object.assign(cx.style, {
    display: 'none', // hidden until a batch is running
    margin: '4px 0 4px 4px',
    padding: '6px 10px',
    background: '#c62828',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '19px',
    fontWeight: '500',
    cursor: 'pointer',
    lineHeight: '1',
  })
  return cx
}

function setState(btn, state, msg) {
  const labels = {
    idle: 'Analyze in Bridge Classroom',
    working: msg ?? 'Fetching…',
    success: 'Done — opening analyzer…',
  }
  btn.textContent = labels[state] ?? labels.idle
  btn.disabled = state !== 'idle' && state !== 'error'
  if (state === 'error') {
    btn.textContent = `Error: ${msg ?? 'failed'}`
    btn.style.background = '#c62828'
    setTimeout(() => {
      btn.textContent = labels.idle
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
  const cancelBtn = buildCancelButton()

  // The cancel button appears in two phases:
  //   1. Listing phase — sets bbo-listing-cancel so the chunked loop breaks.
  //   2. Batch phase   — sends cancel-batch with the active batch key.
  let activeBatchKey = null
  let listingActive = false
  cancelBtn.addEventListener('click', async () => {
    cancelBtn.disabled = true
    cancelBtn.textContent = '…'
    if (listingActive) {
      await storage.set({ [LISTING_CANCEL_KEY]: true }).catch(() => {})
    }
    if (activeBatchKey) {
      await sendMessage({ type: 'cancel-batch', key: activeBatchKey }).catch(() => {})
    }
  })

  btn.addEventListener('click', () => {
    if (btn.disabled) return
    const existingPicker = document.getElementById(PICKER_ID)
    if (existingPicker) { existingPicker.remove(); return }

    const picker = buildPicker(async (months, max) => {
      picker.remove()
      document.removeEventListener('click', closeOnOutside)

      const username = await resolveUsername(sendMessage)
      if (!username) {
        setState(btn, 'error', 'Could not find BBO username')
        return
      }

      const endTime = Math.floor(Date.now() / 1000)
      const startTime = months != null
        ? endTime - months * 30 * 24 * 3600
        : 1262304000

      // Step 1: get the list of tournament URLs by opening hands.php in a
      // minimized window, letting the browser handle BBO's auth + timezone
      // redirect, and reading the rendered DOM. BBO rejects date ranges >
      // ~30 days, so chunk into 28-day windows newest-first.
      setState(btn, 'working', 'Loading game list…')
      // Show cancel-X for the listing phase too — long ranges (Last year,
      // All time) can take many minutes here before the batch even starts.
      await storage.remove(LISTING_CANCEL_KEY).catch(() => {})
      listingActive = true
      cancelBtn.disabled = false
      cancelBtn.textContent = '✕'
      cancelBtn.style.display = 'inline-block'
      let urls
      try {
        urls = await openTabAndCollectChunked({
          sendMessage,
          storage,
          username,
          startTime,
          endTime,
          onProgress: (i) => setState(btn, 'working', `Loading game list (chunk ${i})…`),
          isCancelled: async () => {
            const r = await storage.get(LISTING_CANCEL_KEY).catch(() => null)
            return !!r?.[LISTING_CANCEL_KEY]
          },
        })
      } catch (err) {
        listingActive = false
        cancelBtn.style.display = 'none'
        setState(btn, 'error', err?.message ?? 'Failed to load game list')
        return
      }
      listingActive = false
      // Check if user cancelled during listing.
      const listingCancelled = (await storage.get(LISTING_CANCEL_KEY).catch(() => null))?.[LISTING_CANCEL_KEY]
      await storage.remove(LISTING_CANCEL_KEY).catch(() => {})
      if (listingCancelled) {
        cancelBtn.style.display = 'none'
        setState(btn, 'error', `Cancelled during listing (${urls.length} found)`)
        return
      }
      if (!urls.length) {
        cancelBtn.style.display = 'none'
        setState(btn, 'error', 'No tournaments found in this date range')
        return
      }
      if (max != null) urls = urls.slice(0, max)

      // Step 2: kick off the batch.
      setState(btn, 'working', 'Starting…')
      let response
      try {
        response = await sendMessage({ type: 'extract-batch', urls, since: null, max: null })
      } catch (err) {
        setState(btn, 'error', err?.message)
        return
      }
      if (response?.type === 'extraction-error') {
        setState(btn, 'error', response.error?.message)
        return
      }
      if (response?.type === 'batch-started') {
        activeBatchKey = response.key
        cancelBtn.disabled = false
        cancelBtn.textContent = '✕'
        cancelBtn.style.display = 'inline-block'
        const key = `pending-batch:${response.key}`
        const listener = (changes) => {
          const entry = changes[key]?.newValue
          if (!entry) return
          if (entry.done) {
            storage.onChanged.removeListener(listener)
            cancelBtn.style.display = 'none'
            activeBatchKey = null
            if (entry.cancelled) {
              setState(btn, 'idle')
              setState(btn, 'error', `Cancelled (${entry.items?.length ?? 0} of ${entry.total} fetched)`)
            } else {
              setState(btn, 'success')
              setTimeout(() => setState(btn, 'idle'), 3000)
            }
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
  wrapper.appendChild(cancelBtn)

  const header = listClass.querySelector('celled-rectangle.headerClass')
  if (header) {
    listClass.insertBefore(wrapper, header)
  } else {
    listClass.prepend(wrapper)
  }
}

// ── Deal menu: Export ▸ Bridge Classroom ─────────────────────────────────────
//
// The History panel's deal view has a hamburger whose Export submenu offers
// "Handviewer link". Reaching our analysis from there took four clicks: Export,
// Handviewer link, the link in the dialog, then our button on the page that
// finally loads. This adds a seventh item that does all of it at once.
//
// The deal itself is not readable from the page — the v3 client is a production
// Angular build with no component handles, and its globals carry only config.
// The short link is the only route to a LIN, so this drives BBO's own menu item
// and reads the dialog it opens. That makes the label text and dialog markup
// load-bearing; both are checked rather than assumed, and failure is reported
// rather than swallowed.

export const DEAL_MENU_ITEM_ID = 'bridge-classroom-deal-menu-item'
const SHORTLINK_SELECTOR = 'a[href*="tinyurl.bridgebase.com"]'

/** The visible Export submenu, identified by its contents rather than its class.
 *
 *  The page carries several `.menuClass` containers — the account menu, the deal
 *  menu, and others — so the class identifies nothing, and `offsetParent` is
 *  what says which is on screen. The deal menu then *reuses one container* for
 *  both levels: choosing Export swaps its rows from the four top-level entries
 *  to the six export ones. Only the contents distinguish them. */
export function findExportMenu(doc) {
  return [...doc.querySelectorAll('.menuClass')].find((menu) =>
    menu.offsetParent !== null &&
    [...menu.children].some((item) => /handviewer link/i.test(item.textContent || ''))
  ) ?? null
}

function menuItemLabel(item) {
  return item.querySelector('div') ?? item
}

/** Poll until `fn()` returns something truthy, or give up. */
function waitFor(fn, { timeoutMs = 8000, intervalMs = 100 } = {}) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const tick = () => {
      let hit = null
      try { hit = fn() } catch { hit = null }
      if (hit) return resolve(hit)
      if (Date.now() >= deadline) return resolve(null)
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

/** Drive BBO's own "Handviewer link" and read the short link out of the dialog.
 *
 *  Returns the URL, or throws with something the user can act on. The dialog is
 *  closed either way — leaving BBO's modal open over the app after a failure
 *  would be worse than the failure. */
export async function grabHandviewerShortlink(doc, { timeoutMs = 8000 } = {}) {
  const menu = findExportMenu(doc)
  if (!menu) throw new Error('the Export menu closed')

  const hvItem = [...menu.children].find((i) => /handviewer link/i.test(i.textContent || ''))
  if (!hvItem) throw new Error('BBO has renamed its "Handviewer link" item')

  // Angular binds the click to the inner div, not the <menu-item> host.
  menuItemLabel(hvItem).click()

  const anchor = await waitFor(() => {
    const a = doc.querySelector(SHORTLINK_SELECTOR)
    return a && a.offsetParent !== null ? a : null
  }, { timeoutMs })

  const href = anchor?.href ?? null
  // Close whatever opened, found or not.
  const closer = [...doc.querySelectorAll('button, div')].find(
    (e) => e.offsetParent !== null && e.textContent.trim() === 'Close'
  )
  closer?.click()

  if (!href) throw new Error("BBO didn't return a hand viewer link")
  return href
}

function showToast(doc, text) {
  const el = doc.createElement('div')
  el.textContent = text
  Object.assign(el.style, {
    position: 'fixed', bottom: '16px', right: '16px', zIndex: '2147483647',
    background: '#333', color: '#fff', padding: '10px 16px', borderRadius: '4px',
    font: '14px sans-serif', maxWidth: '320px', boxShadow: '0 2px 8px rgba(0,0,0,.3)',
  })
  doc.body.appendChild(el)
  setTimeout(() => el.remove(), 6000)
}

/** Add or remove our item so it appears on the Export submenu and nowhere else.
 *
 *  Removal is the whole point of this being a sync rather than an inject.
 *  Angular swaps the container's rows in place when the menu changes level, and
 *  it only manages the nodes it created — ours survives the swap and strands on
 *  the top-level menu, where it looks like a fifth entry and cannot work,
 *  because the "Handviewer link" it needs is no longer there. So every mutation
 *  re-answers the question rather than injecting once and trusting it to stay.
 *
 *  Idempotent: when the item is already on the right menu this does nothing,
 *  which is what makes the observer's constant firing free. */
export function syncDealMenuItem(doc, sendMessage) {
  const menu = findExportMenu(doc)
  const existing = doc.getElementById(DEAL_MENU_ITEM_ID)

  if (!menu) {
    existing?.remove()
    return null
  }
  if (existing) {
    if (existing.parentElement === menu) return existing
    existing.remove()
  }

  // Clone one of BBO's own items rather than building one: Angular's scoped
  // styles key off `_ngcontent-*` attributes, so a hand-rolled element would
  // inherit none of the menu's appearance. Cloning copies the attributes and
  // the inline styling, and drops BBO's click handler in the process.
  const template = menu.querySelector('menu-item')
  if (!template) return null

  const item = template.cloneNode(true)
  item.id = DEAL_MENU_ITEM_ID
  const label = menuItemLabel(item)
  label.textContent = 'Bridge Classroom'

  label.addEventListener('click', async (event) => {
    event.stopPropagation()
    try {
      const shortlink = await grabHandviewerShortlink(doc)
      const res = await sendMessage({ type: 'extract-shortlink', url: shortlink })
      if (res?.type === 'extraction-error') {
        showToast(doc, `Bridge Classroom: ${res.error?.message ?? 'extraction failed'}`)
      }
    } catch (err) {
      showToast(doc, `Bridge Classroom: ${err?.message ?? 'could not read the deal'}`)
    }
  })

  menu.appendChild(item)
  return item
}

// ── Entry point ──────────────────────────────────────────────────────────────

if (typeof globalThis.chrome !== 'undefined' || typeof globalThis.browser !== 'undefined') {
  import('webextension-polyfill').then(({ default: browser }) => {
    const sendMessage = (msg) => browser.runtime.sendMessage(msg)
    // eslint-disable-next-line no-undef
    const storage = chrome.storage.local

    const tryInject = () => injectHistoryButton(sendMessage, storage)

    // Watch for the history panel to mount or its content to change. The deal
    // menu rides the same observer: it is created and destroyed on every open,
    // so there is nothing to hook but the mutation itself.
    const observer = new MutationObserver(() => {
      if (!document.getElementById(BUTTON_ID)) tryInject()
      syncDealMenuItem(document, sendMessage)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Also try immediately in case the panel is already rendered.
    tryInject()

    // Developer-only: bulk-export tournament history. Triggered by:
    //   ?bcdev=mega                 — full export from default 2024-01-01
    //   ?bcdev=mega&since=2024-06-01 — earlier date
    //   ?bcdev=mega&limit=4          — only first 4 tournaments (testing)
    //   ?bcdev=mega&since=...&limit=4
    //   #bcdev-mega                  — hash form also accepted (params via &)
    let megaTriggered = false
    function checkMegaTrigger() {
      if (megaTriggered) return
      const search = new URLSearchParams(window.location.search)
      const hash = window.location.hash
      const hashTriggered = hash.startsWith('#bcdev-mega')
      const queryTriggered = search.get('bcdev') === 'mega'
      if (!hashTriggered && !queryTriggered) return
      megaTriggered = true
      // Parse `since` and `limit` from query params (preferred) and hash.
      const opts = {
        since: search.get('since'),
        limit: search.get('limit') != null ? parseInt(search.get('limit'), 10) : null,
      }
      const hashSince = hash.match(/since=(\d{4}-\d{2}-\d{2})/)
      if (hashSince) opts.since = opts.since ?? hashSince[1]
      const hashLimit = hash.match(/limit=(\d+)/)
      if (hashLimit) opts.limit = opts.limit ?? parseInt(hashLimit[1], 10)
      // eslint-disable-next-line no-console
      console.log('[acbl-fetch] mega-export triggered', { via: hashTriggered ? 'hash' : 'query', opts })
      // Strip mega params so a reload doesn't re-trigger.
      try {
        const cleanSearch = new URLSearchParams(window.location.search)
        cleanSearch.delete('bcdev')
        cleanSearch.delete('since')
        cleanSearch.delete('limit')
        const sStr = cleanSearch.toString() ? `?${cleanSearch.toString()}` : ''
        history.replaceState(null, '', window.location.pathname + sStr)
      } catch {}
      runMegaExport(sendMessage, storage, opts).catch((e) => showMegaStatus(`Failed: ${e?.message ?? e}`))
    }
    // eslint-disable-next-line no-console
    console.log('[acbl-fetch] lobby ready; hash=', window.location.hash, 'search=', window.location.search)
    checkMegaTrigger()
    window.addEventListener('hashchange', checkMegaTrigger)
    setTimeout(checkMegaTrigger, 1000)
    setTimeout(checkMegaTrigger, 3000)
  }).catch(() => {})
}

// ── Dev: bulk-export entire BBO history ──────────────────────────────────────
async function runMegaExport(sendMessage, storage, opts = {}) {
  let sinceTs = Math.floor(new Date('2024-01-01T00:00:00Z').getTime() / 1000)
  if (opts.since) {
    const t = Math.floor(new Date(`${opts.since}T00:00:00Z`).getTime() / 1000)
    if (!Number.isNaN(t)) sinceTs = t
  }
  let limit = null
  if (opts.limit && Number.isFinite(opts.limit) && opts.limit > 0) limit = opts.limit

  showMegaStatus('Waiting for BBO login + lobby to render…')
  showMegaCancelButton(async () => {
    await storage.set({ [LISTING_CANCEL_KEY]: true }).catch(() => {})
    await storage.set({ 'dev-bulk-cancel': true }).catch(() => {})
    showMegaStatus('Cancelling…')
  })
  // Poll up to 60s for the username — gives the user time to log in if BBO
  // hasn't auto-restored their session yet.
  const username = await resolveUsername(sendMessage, {
    pollMs: 60000,
    onWait: () => showMegaStatus('Waiting for BBO login + lobby to render…'),
  })
  if (!username) {
    showMegaStatus('Could not resolve BBO username after 60s — log in to BBO first, then refresh with the same URL')
    hideMegaCancelButton()
    return
  }

  showMegaStatus(`Mega export starting for ${username} (since ${new Date(sinceTs * 1000).toISOString().slice(0, 10)})…`)

  // Step 1: get all tournament URLs via chunked listing.
  await storage.remove(LISTING_CANCEL_KEY).catch(() => {})
  let urls
  try {
    urls = await openTabAndCollectChunked({
      sendMessage,
      storage,
      username,
      startTime: sinceTs,
      endTime: Math.floor(Date.now() / 1000),
      onProgress: (i) => showMegaStatus(`Fetching listing chunk ${i}…`),
      isCancelled: async () => {
        const r = await storage.get(LISTING_CANCEL_KEY).catch(() => null)
        return !!r?.[LISTING_CANCEL_KEY]
      },
      // Stop chunking once we have enough URLs to satisfy the limit.
      targetCount: limit,
    })
  } catch (err) {
    showMegaStatus(`Listing failed: ${err?.message ?? err}`)
    hideMegaCancelButton()
    return
  }
  if (!urls.length) {
    showMegaStatus('No tournaments found in date range')
    hideMegaCancelButton()
    return
  }
  const listingCancelled = (await storage.get(LISTING_CANCEL_KEY).catch(() => null))?.[LISTING_CANCEL_KEY]
  await storage.remove(LISTING_CANCEL_KEY).catch(() => {})
  if (listingCancelled) {
    showMegaStatus(`Cancelled during listing (${urls.length} URLs collected; not extracting)`)
    hideMegaCancelButton()
    return
  }
  if (limit != null && urls.length > limit) {
    showMegaStatus(`Found ${urls.length} tournaments; limit=${limit} so extracting first ${limit}…`)
    urls = urls.slice(0, limit)
  } else {
    showMegaStatus(`Found ${urls.length} tournaments. Starting bulk extract…`)
  }

  // Step 2: fire bulk extract in the SW. It returns immediately with
  // dev-bulk-started; progress is tracked via storage. Envelopes stream back
  // to the receiver below, which writes the file when the SW says it's done —
  // so it has to be listening before the extract starts.
  const filename = `bbo-history-${username}-${new Date().toISOString().slice(0, 10)}.json`
  installMegaFileReceiver()
  await sendMessage({ type: 'dev-bulk-extract', urls, filename })

  // Watch progress.
  const listener = (changes) => {
    const p = changes['dev-bulk-progress']?.newValue
    if (!p) return
    if (p.done) {
      storage.onChanged.removeListener(listener)
      const elapsed = Math.round((p.finishedAt - p.startedAt) / 1000)
      const status = p.cancelled ? 'Cancelled' : 'Done'
      const where = p.saveError
        ? `SAVE FAILED: ${p.saveError}`
        : 'saved to your Downloads folder.'
      showMegaStatus(`${status} — ${p.completed - p.errors}/${p.total} fetched in ${elapsed}s; ${where}`)
      hideMegaCancelButton()
    } else {
      showMegaStatus(`Bulk extract: ${p.completed}/${p.total} (${p.errors} errors)`)
    }
  }
  storage.onChanged.addListener(listener)
}

// ── Dev: file assembly for the mega export ───────────────────────────────────
// The SW streams envelope JSON here one tournament at a time; we hold the
// strings and splice them into a single JSON document at the end. Assembly
// lives in the page context because only here can we build a blob URL — the
// service worker has no URL.createObjectURL, and its data: URL alternative is
// capped near 2MB by Chrome, which silently truncated multi-hundred-tournament
// exports to an empty file.
function installMegaFileReceiver() {
  const parts = []
  // eslint-disable-next-line no-undef
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'dev-bulk-file-begin') {
      parts.length = 0
      sendResponse({ ok: true })
      return
    }
    if (msg?.type === 'dev-bulk-file-chunk') {
      parts.push(msg.json)
      sendResponse({ ok: true })
      return
    }
    if (msg?.type === 'dev-bulk-file-finish') {
      try {
        const bytes = saveMegaFile(msg.filename, msg.header, parts)
        parts.length = 0
        sendResponse({ ok: true, bytes })
      } catch (err) {
        sendResponse({ error: err?.message ?? String(err) })
      }
      return
    }
  })
}

// Stitch the header and the accumulated envelope strings into one JSON
// document and hand it to the browser as a download. Building the Blob from an
// array of string pieces avoids ever materializing the whole file as a single
// JS string, which matters at hundreds of MB.
function saveMegaFile(filename, header, parts) {
  const pieces = ['{\n']
  for (const [key, value] of Object.entries(header)) {
    pieces.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)},\n`)
  }
  pieces.push('  "envelopes": [\n')
  parts.forEach((json, i) => {
    pieces.push(json)
    if (i < parts.length - 1) pieces.push(',\n')
  })
  pieces.push('\n  ]\n}\n')

  const blob = new Blob(pieces, { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the download a beat to latch onto the blob before we drop it.
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return blob.size
}

function ensureMegaBanner() {
  const id = 'bridge-classroom-mega-status'
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('div')
    el.id = id
    Object.assign(el.style, {
      position: 'fixed',
      top: '12px',
      left: '12px',
      zIndex: '2147483647',
      background: '#1a73e8',
      color: '#fff',
      padding: '8px 14px',
      borderRadius: '4px',
      fontSize: '14px',
      fontWeight: '500',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
      maxWidth: '500px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    })
    const text = document.createElement('span')
    text.id = id + '-text'
    el.appendChild(text)
    document.body.appendChild(el)
  }
  return el
}

function showMegaStatus(msg) {
  ensureMegaBanner()
  const text = document.getElementById('bridge-classroom-mega-status-text')
  if (text) text.textContent = `[bcdev-mega] ${msg}`
  // eslint-disable-next-line no-console
  console.log(`[acbl-fetch] mega-export: ${msg}`)
}

function showMegaCancelButton(onClick) {
  const banner = ensureMegaBanner()
  const id = 'bridge-classroom-mega-cancel'
  let cx = document.getElementById(id)
  if (!cx) {
    cx = document.createElement('button')
    cx.id = id
    cx.type = 'button'
    cx.textContent = '✕'
    cx.title = 'Cancel mega export'
    Object.assign(cx.style, {
      padding: '4px 10px',
      background: '#c62828',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      fontSize: '14px',
      fontWeight: '700',
      cursor: 'pointer',
      lineHeight: '1',
    })
    banner.appendChild(cx)
  }
  cx.onclick = onClick
}

function hideMegaCancelButton() {
  document.getElementById('bridge-classroom-mega-cancel')?.remove()
}
