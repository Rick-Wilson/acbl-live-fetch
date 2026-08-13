// Source content script. Runs on live.acbl.org/*, my.acbl.org/* and BBO, and
// injects an "Analyze in Bridge Classroom" button on supported pages. Click
// sends the page URL to the service worker; the SW dispatches to the
// matching adapter and opens the analyzer tab with the extracted envelope.
//
// This file owns the button: building it, placing it on five different sites,
// and routing its clicks. Three jobs that used to live here have their own
// modules now, because they are about pages rather than about the button:
//
//   acblResultsList.js  per-row links on ACBL Live's three listing pages
//   pairPicker.js       choosing which pair an event is about
//   extractProgress.js  the live percentage, polled out of storage
//
// What stays is deliberate. placeAtRowEnd and placeInTableHeader measure real
// layout, which jsdom cannot, so they have no tests worth the name and are the
// riskiest code here to move.

import { classifyPage as classifyLive } from '../adapters/acbl-live/index.js'
import { classifyPage as classifyClub } from '../adapters/acbl-live-club/index.js'
import { classifyPage as classifyBbo } from '../adapters/bbo/index.js'
import {
  injectResultRowLinks,
  setupRowLinks,
  messageForError,
} from './acblResultsList.js'
import { buildPairPicker, PAIR_FILTER_CLASS } from './pairPicker.js'
import { watchExtractionProgress, newProgressKey } from './extractProgress.js'

const BUTTON_ID = 'bridge-classroom-analyze-btn'

// Page types that trigger injection — one per supported source. Each adapter
// owns a different hostname today, so the classifyPage calls are mutually
// exclusive.
//   * pair-scorecard    — live.acbl.org per-pair page (the canonical entry)
//   * event-summary     — live.acbl.org event-level page
//   * club-game-result  — my.acbl.org club-game page
//   * tournament-view   — webutil.bridgebase.com/v2/tview.php
//   * hands-list        — www.bridgebase.com/myhands/hands.php?tourney=
//   * handviewer        — www.bridgebase.com/tools/handviewer.html?lin= or ?myhand=
//                         (the most reachable page right after playing a board)
//
// `traveller` (hands.php?traveller=) is classified but deliberately absent, and
// should stay absent. It is BBO's own analysis of one board across the field —
// a view we would be duplicating rather than improving — and it takes several
// clicks to reach, every one of which passes a page that does have a button. A
// user who wanted the whole session has already had three chances to say so.
const INJECT_PAGE_TYPES = new Set([
  'pair-scorecard',
  'event-summary',
  // 'player-history' is deliberately absent. It is a *list* of sessions, so a
  // single page-level button has nothing to extract; each row gets its own link
  // instead (setupRowLinks). It used to open a date-range batch picker, which
  // could not work within live.acbl.org's ~110-request-per-sign-in allowance.
  'club-game-result',
  'club-results-list',
  'tournament-view',
  'hands-list',
  'handviewer',
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

export const CANCEL_BUTTON_ID = 'bridge-classroom-cancel-btn'

export function buildCancelButton(doc) {
  const cx = doc.createElement('button')
  cx.id = CANCEL_BUTTON_ID
  cx.type = 'button'
  cx.textContent = '✕'
  cx.title = 'Cancel'
  Object.assign(cx.style, {
    display: 'none', // hidden until a batch is running
    marginLeft: '4px',
    padding: '8px 10px',
    background: '#c62828',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    flexShrink: '0',
    lineHeight: '1',
  })
  return cx
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
  // The hand viewer is the exception: it has a real control row, and its
  // corners are all taken — the auction sits top-right where the overlay would
  // land, BBO's own controls run along the bottom, and BBO Helper (a commonly
  // installed extension) draws a double-dummy table bottom-left. Joining the
  // control row avoids all three and looks native.
  try {
    const u = new URL(url)
    const host = u.hostname
    if (host === 'my.acbl.org') return 'club-nav'
    if (host === 'www.bridgebase.com' && u.pathname === '/tools/handviewer.html') {
      return 'button-row'
    }
    // The hands list leads with two full-width header rows — the tourney name
    // and the date — above an 11-column table. That is dead space on the right,
    // and the overlay was landing on BBO's own controls at some zoom levels.
    if (host === 'www.bridgebase.com' && u.pathname === '/myhands/hands.php') {
      return 'table-header'
    }
    if (host.endsWith('bridgebase.com')) return 'overlay'
    return 'inline'
  } catch {
    return 'inline'
  }
}

// The listing pages, the pair picker and the progress watcher live in their
// own modules now; this file keeps the button, its placement, and the click
// router that ties them together.

export async function handleClick(deps) {
  const { url, sendMessage, setState, buildMessage, onBatchStarted, storage = null } = deps
  setState('extracting')
  const msg = buildMessage ? buildMessage(url) : { type: 'extract-session', url }

  // Single extractions get a live percentage for the same reason the row links
  // do: an ACBL event is ~50 board pages, and a label that never changes over
  // tens of seconds reads as a stall.
  let stopWatching = () => {}
  if (storage && msg.type === 'extract-session') {
    msg.progressKey = newProgressKey()
    stopWatching = watchExtractionProgress(
      msg.progressKey,
      (pct) => setState('progress', `Fetching… ${pct}%`),
      storage
    )
  }

  let response
  try {
    response = await sendMessage(msg)
  } catch (err) {
    stopWatching()
    setState('error', err?.message ?? 'message channel error')
    return
  }
  stopWatching()
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

export function watchBatchProgress(key, setState, storage, onComplete) {
  // Watches storage for progress updates written by the SW after each game.
  // `storage` must be the chrome.storage.local object.
  const storageKey = `pending-batch:${key}`
  // Ticks the "Waiting 12…" countdown between events. Local, because the
  // worker publishes only the moment the wait ends — it should not have to
  // wake once a second to narrate a pause.
  let countdown = null
  const stopCountdown = () => {
    if (countdown) clearInterval(countdown)
    countdown = null
  }
  const listener = (changes) => {
    const change = changes[storageKey]
    if (!change) return
    const entry = change.newValue
    if (!entry) return
    stopCountdown()
    if (entry.done) {
      storage.onChanged.removeListener(listener)
      onComplete?.(entry)
      if (entry.cancelled) {
        setState('error', `Cancelled (${entry.items?.length ?? 0} of ${entry.total} fetched)`)
      } else {
        setState('success')
        setTimeout(() => setState('idle'), 2000)
      }
    } else {
      // Count the item being worked on, not the ones finished. "0 of 2" for
      // the ten seconds before the first lands reads as nothing happening.
      const working = Math.min(entry.completed + 1, entry.total)
      const waitingUntil = entry.waiting_until ?? 0
      if (waitingUntil > Date.now()) {
        const tick = () => {
          const left = Math.ceil((waitingUntil - Date.now()) / 1000)
          if (left <= 0) {
            stopCountdown()
            setState('progress', `Fetching ${working} of ${entry.total}…`)
            return
          }
          setState('progress', `Waiting ${left}…`)
        }
        tick()
        countdown = setInterval(tick, 1000)
      } else {
        setState('progress', `Fetching ${working} of ${entry.total}…`)
      }
    }
  }
  storage.onChanged.addListener(listener)
}

const DATE_PICKER_ID = 'bridge-classroom-date-picker'

const BATCH_PRESETS = [
  { label: 'Most recent',   months: 1,    max: 1 },
  { label: 'Last month',    months: 1,    max: null },
  { label: 'Last 3 months', months: 3,    max: null },
  { label: 'Last 6 months', months: 6,    max: null },
  { label: 'Last year',     months: 12,   max: null },
  { label: 'All time',      months: null, max: null },
]

// Construct the BBO history listing URL from a tview URL and a month count.
// The listing page uses Unix timestamp range params; server-side filtering
// means we don't need a client-side `since` filter.
export function bboHistoryUrl(tviewUrl, months) {
  try {
    const u = new URL(tviewUrl)
    const username = u.searchParams.get('u') ?? u.searchParams.get('U')
    if (!username) return null
    const endTime = Math.floor(Date.now() / 1000)
    const startTime = months != null
      ? endTime - months * 30 * 24 * 3600
      : 1262304000 // 2010-01-01 — covers all of BBO history
    return `https://www.bridgebase.com/myhands/hands.php?username=${encodeURIComponent(username)}&start_time=${startTime}&end_time=${endTime}`
  } catch {
    return null
  }
}

export function buildDatePicker(doc, onSelect, onSingleGame = null) {
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
    minWidth: '180px',
    overflow: 'hidden',
  })

  const makeItem = (label, bold, onClick) => {
    const item = doc.createElement('button')
    item.type = 'button'
    item.textContent = label
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
      fontWeight: bold ? 'bold' : 'normal',
      boxSizing: 'border-box',
    })
    item.addEventListener('mouseover', () => { item.style.background = '#f5f5f5' })
    item.addEventListener('mouseout', () => { item.style.background = 'none' })
    item.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
    return item
  }

  if (onSingleGame) {
    picker.appendChild(makeItem('Analyze this game', true, onSingleGame))
    const divider = doc.createElement('div')
    Object.assign(divider.style, {
      padding: '4px 16px',
      fontSize: '11px',
      color: '#888',
      background: '#f9f9f9',
      borderBottom: '1px solid #eee',
    })
    divider.textContent = 'Fetch history:'
    picker.appendChild(divider)
  }

  for (const preset of BATCH_PRESETS) {
    picker.appendChild(makeItem(preset.label, false, () => onSelect(preset.months, preset.max ?? null)))
  }
  return picker
}

// Match a sibling control and park the button past the rightmost one.
//
// The hand viewer lays its own row out in JS: hvstyles.css only says
// `position: absolute; height: 100%`, while left, top and font size are assigned
// at layout time and scale with the viewport. Both the geometry and the type
// size therefore have to be copied from a real sibling, once the viewer has run.
//
// Knowing *when* it has run is the hard part, and two earlier attempts failed:
// a backoff timer expired before the viewer finished, and a ResizeObserver on
// the row never fired. The row is the wrong thing to watch — `.buttonDivStyle`
// starts `visibility: hidden` and the row can hold its box while the controls
// inside it are still unsized. What actually changes is each button's own
// geometry, which is also exactly what gets measured here.
export function placeAtRowEnd(row, btn, gap = 14, { log = defaultPlacementLog } = {}) {
  const view = row.ownerDocument?.defaultView
  let placed = false

  const apply = () => {
    let right = 0
    let rightmost = null
    for (const el of row.children) {
      if (el === btn) continue
      const edge = (el.offsetLeft ?? 0) + (el.offsetWidth ?? 0)
      if (edge > right) { right = edge; rightmost = el }
    }
    // Nothing laid out yet. Leave the button alone rather than pinning it to 0,
    // which stacks it on the first control — the original bug.
    if (right <= 0 || !rightmost) return false

    // The siblings are absolutely positioned by an element-qualified rule we
    // can't inherit, so set that ourselves before any offset means anything.
    if (btn.style.position !== 'absolute') btn.style.position = 'absolute'

    const computed = view?.getComputedStyle?.(rightmost)
    if (computed) {
      for (const prop of ['fontSize', 'fontFamily', 'top', 'height', 'paddingTop', 'paddingBottom']) {
        const value = computed[prop]
        // Only write when it differs, so our own edit doesn't retrigger the
        // observers below and loop.
        if (value && btn.style[prop] !== value) btn.style[prop] = value
      }
    }
    const left = `${right + gap}px`
    if (btn.style.left !== left) {
      btn.style.left = left
      if (!placed) { placed = true; log(`placed at ${left}`) }
    }
    return true
  }

  // Wire the observers once per button. Calling this twice would leave two sets
  // running, and if they disagreed — different gaps, say — each one's write
  // would retrigger the other's observer forever.
  if (btn.dataset && btn.dataset.bcRowPlacement === 'wired') {
    apply()
    return btn
  }
  if (btn.dataset) btn.dataset.bcRowPlacement = 'wired'

  // Watch every control, not the container: a button going from unsized to
  // sized is the event we're waiting for.
  const resize = typeof view?.ResizeObserver === 'function'
    ? new view.ResizeObserver(() => apply())
    : null
  const watchChildren = () => {
    if (!resize) return
    for (const el of row.children) if (el !== btn) resize.observe(el)
  }

  // Controls are added and restyled as the viewer builds the row; either is a
  // reason to re-measure, and newly added ones need watching too.
  if (typeof view?.MutationObserver === 'function') {
    new view.MutationObserver(() => { watchChildren(); apply() })
      .observe(row, { attributes: true, childList: true, subtree: true })
  }
  watchChildren()
  view?.addEventListener?.('resize', apply)

  apply()
  return btn
}

function defaultPlacementLog(message) {
  // eslint-disable-next-line no-console
  console.log(`[bridge-classroom] ${message}`)
}

export const BUTTON_CELL_ID = 'bridge-classroom-header-cell'

/** Put the button in the hands list's own header, instead of floating over it.
 *
 *  The table opens with two full-width rows — "Tourney NNN … played by <user>"
 *  and the date — each a single `<th colspan="11">` above an 11-column body.
 *  Carving the right third out of both and merging it into one cell gives a
 *  home that scrolls with the page and cannot cover BBO's controls at any zoom.
 *
 *      before                          after
 *      +---------------------+         +--------------+------+
 *      | Tourney … (11)      |         | Tourney (7)  |      |
 *      +---------------------+   ->    +--------------+ btn  |
 *      | 2026-04-29 (11)     |         | date    (7)  | (4x2)|
 *      +--+--+--+--+--+--+---+         +--+--+--+--+--+------+
 *      |Nº|Time|North| … 11 cols       |Nº|Time|North| … 11 cols
 *
 *  Returns the button, or null if the table isn't the shape described — in
 *  which case the caller falls back to the overlay.
 *
 *  The original column count is stashed on the table so a re-injection splits
 *  from 11 again rather than from the 7 it left behind.
 */
export function placeInTableHeader(doc, btn, cancelBtn) {
  const table = doc.querySelector('table.body')
  if (!table || !table.rows || table.rows.length < 3) return null

  const titleRow = table.rows[0]
  const dateRow = table.rows[1]
  if (titleRow.cells.length !== 1 || dateRow.cells.length !== 1) return null

  const titleCell = titleRow.cells[0]
  const dateCell = dateRow.cells[0]
  // Both must genuinely be header cells spanning the same width. Without this a
  // variant whose second row is already data — a single `<td>` — gets rewritten
  // as though it were the date, skewing the table. Comparing the two colspans
  // rather than checking against the stored total keeps this true on
  // re-injection, when both have already been narrowed.
  if (titleCell.tagName !== 'TH' || dateCell.tagName !== 'TH') return null
  if (titleCell.getAttribute('colspan') !== dateCell.getAttribute('colspan')) return null

  const stored = Number.parseInt(table.dataset?.bcTotalCols ?? '', 10)
  const total = Number.isInteger(stored) && stored > 1
    ? stored
    : Number.parseInt(titleCell.getAttribute('colspan') ?? '', 10)
  if (!Number.isInteger(total) || total < 3) return null
  if (table.dataset) table.dataset.bcTotalCols = String(total)

  // Right third, but never so wide it leaves the title nowhere to sit.
  const span = Math.min(Math.max(Math.round(total / 3), 2), total - 1)
  titleCell.setAttribute('colspan', String(total - span))
  dateCell.setAttribute('colspan', String(total - span))

  const cell = doc.createElement('th')
  cell.id = BUTTON_CELL_ID
  cell.setAttribute('colspan', String(span))
  cell.setAttribute('rowspan', '2')
  Object.assign(cell.style, { textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' })

  // Match the table rather than the overlay: inherit the header's typeface and
  // size, drop the header's bold (this is a control, not a heading), and lose
  // the drop shadow that only made sense floating above the page.
  // Longhands, not the `font` shorthand: `style.font = 'inherit'` is accepted
  // inconsistently (jsdom drops it silently, leaving buildButton's 14px), and a
  // font size that only looks right in the browser is not worth the ambiguity.
  const inheritFont = { fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'normal' }
  Object.assign(btn.style, inheritFont, { padding: '4px 12px', boxShadow: 'none' })
  Object.assign(cancelBtn.style, inheritFont)

  cell.appendChild(btn)
  cell.appendChild(cancelBtn)
  titleRow.appendChild(cell)
  return btn
}

export function injectButton(deps) {
  const { document: doc, location, sendMessage } = deps
  if (!shouldInject(location.href)) return null
  const existing = doc.getElementById(BUTTON_ID)
  if (existing) return existing
  const btn = buildButton(doc)
  const cancelBtn = buildCancelButton(doc)

  // Click handling is done via document-level delegation (see setupClickDelegation)
  // so that Cloudflare Rocket Loader's DOM cloning doesn't strip the listener.

  const strategy = pickInjectionStrategy(location.href)

  if (strategy === 'club-nav') {
    const ul = doc.querySelector('ul.navbar-nav')
    if (!ul) return null
    const li = doc.createElement('li')
    li.appendChild(btn)
    li.appendChild(cancelBtn)
    ul.appendChild(li)
    return btn
  }

  if (strategy === 'button-row') {
    // #buttonDiv holds Rewind / Previous / Next / Options / Play. It exists in
    // the static HTML, but the viewer populates it at runtime, so a null return
    // here just lets the MutationObserver retry.
    const row = doc.getElementById('buttonDiv')
    if (!row) return null

    // "Analyze" is wrong here: a single deal goes to double-dummy, not game
    // analysis, and the ingest page decides which tool anyway.
    btn.textContent = 'Bridge Classroom'

    // Do NOT copy BBO's class. Its controls are <input type="button"> and the
    // rule is element-qualified — `input.buttonStyle` — so a <button> wearing
    // that class matches nothing, stays `position: static`, and ignores any
    // `left` we set. That is exactly how this failed: the placement ran, logged
    // a correct offset, and moved nothing.
    //
    // Instead drop our own chrome and let placeAtRowEnd copy the geometry from a
    // real sibling. cssText is cleared wholesale rather than property by
    // property because shorthands like `background` expand, so
    // removeProperty('background') leaves background-color behind.
    btn.style.cssText = ''
    btn.style.cursor = 'pointer'
    // BBO's own rule says `padding-left: 2` with no unit, which is invalid and
    // so ignored — their controls get the browser default. Give ours a little
    // more room around the label than that.
    btn.style.paddingLeft = '12px'
    btn.style.paddingRight = '12px'
    // No cancel button here: a single deal is instant, so there is nothing to
    // cancel and a second control would only crowd BBO's row.
    row.appendChild(btn)
    placeAtRowEnd(row, btn)
    return btn
  }

  if (strategy === 'table-header') {
    const placed = placeInTableHeader(doc, btn, cancelBtn)
    if (placed) return placed
    // Markup we didn't expect. Costing the user placement is acceptable;
    // costing them the button is not — fall through to the overlay.
  }

  if (strategy === 'overlay' || strategy === 'table-header') {
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
    Object.assign(cancelBtn.style, {
      position: 'fixed',
      // Position cancel button just to the left of the main button.
      top: '12px',
      right: '8px',
      zIndex: '2147483647',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
      marginLeft: '0',
      transform: 'translateX(-100%) translateX(-4px)',
    })
    if (!doc.body) return null
    doc.body.appendChild(btn)
    doc.body.appendChild(cancelBtn)
    return btn
  }

  // In-flow strategy (server-rendered pages like live.acbl.org).
  const anchor = pickAnchor(doc)
  if (!anchor) return null
  if (anchor === doc.body) {
    anchor.appendChild(btn)
    anchor.appendChild(cancelBtn)
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
    const btnGroup = doc.createElement('div')
    btnGroup.style.display = 'flex'
    btnGroup.appendChild(btn)
    btnGroup.appendChild(cancelBtn)
    wrapper.appendChild(btnGroup)
  } else {
    anchor.insertAdjacentElement('afterend', cancelBtn)
    anchor.insertAdjacentElement('afterend', btn)
  }
  return btn
}

// Attach a single delegated click listener to `doc` so that Cloudflare Rocket
// Loader (which clones DOM nodes and strips addEventListener listeners) can't
// break our button. Any click anywhere is checked: if it hit our button we
// handle it; otherwise ignored.
export function setupClickDelegation(deps) {
  const { document: doc, location, sendMessage, storage = null } = deps

  // Cancel button: when an active batch is running, clicking the X sends
  // cancel-batch to the SW. activeBatchKey is set on batch-started and
  // cleared when watchBatchProgress sees the batch finish (done or cancelled).
  let activeBatchKey = null
  doc.addEventListener('click', (e) => {
    const cx = e.target.closest(`#${CANCEL_BUTTON_ID}`)
    if (!cx || !activeBatchKey) return
    cx.disabled = true
    cx.textContent = '…'
    sendMessage({ type: 'cancel-batch', key: activeBatchKey }).catch(() => {})
  })

  doc.addEventListener('click', (e) => {
    const btn = e.target.closest(`#${BUTTON_ID}`)
    if (!btn || btn.disabled) return

    // Club results only. The ACBL Live listing used to offer a date-range
    // batch too, but live.acbl.org allows about 110 requests per sign-in under
    // /event/* — roughly two events — so a batch of five spent the allowance
    // partway through and signed the user out. It now offers one link per row
    // instead; see setupRowLinks and docs/acbl-rate-limit.md. my.acbl.org is a
    // different host with public results and has shown no such ceiling.
    const isBatch = classifyClub(location.href) === 'club-results-list'

    const isBboBatch = classifyBbo(location.href) === 'tournament-view'

    const showCancel = () => {
      const cx = doc.getElementById(CANCEL_BUTTON_ID)
      if (cx) { cx.disabled = false; cx.textContent = '✕'; cx.style.display = 'inline-block' }
    }
    const hideCancel = () => {
      const cx = doc.getElementById(CANCEL_BUTTON_ID)
      if (cx) cx.style.display = 'none'
    }

    // An ACBL Live event summary names nobody, so ask which pair before
    // fetching. Selecting one goes straight to that pair's scorecard — the
    // ordinary entry point, which sets user_pair without any special casing.
    if (classifyLive(location.href) === 'event-summary') {
      const existing = doc.getElementById(PAIR_PICKER_ID)
      if (existing) { existing.remove(); return }

      applyState(btn, 'progress', 'Loading pairs…')
      sendMessage({ type: 'list-event-pairs', url: location.href })
        .then((response) => {
          if (response?.type !== 'event-pairs' || !response.pairs?.length) {
            applyState(btn, 'error', messageForError(
              response?.error?.code,
              response?.error?.message ?? 'no pairs found in this event'
            ))
            return
          }
          applyState(btn, 'idle')
          const picker = buildPairPicker(doc, response.pairs, (entry) => {
            picker.remove()
            doc.removeEventListener('click', closePicker)
            handleClick({
              url: entry.url,
              sendMessage,
              storage,
              setState: (state, msg) => applyState(btn, state, msg),
              buildMessage: (url) => ({ type: 'extract-session', url }),
            })
          })
          const anchor = btn.parentElement ?? btn
          anchor.style.position = 'relative'
          anchor.appendChild(picker)
          picker.querySelector(`.${PAIR_FILTER_CLASS}`)?.focus()
          function closePicker(e2) {
            if (!picker.contains(e2.target) && e2.target !== btn) {
              picker.remove()
              doc.removeEventListener('click', closePicker)
            }
          }
          setTimeout(() => doc.addEventListener('click', closePicker), 0)
        })
        .catch((err) => applyState(btn, 'error', err?.message ?? 'message channel error'))
      return
    }

    if (isBatch || isBboBatch) {
      const existing = doc.getElementById(DATE_PICKER_ID)
      if (existing) { existing.remove(); return }

      const startBatch = (listUrl, since, max = null) => {
        handleClick({
          url: location.href,
          sendMessage,
          setState: (state, msg) => applyState(btn, state, msg),
          buildMessage: () => ({ type: 'extract-batch', listUrl, since, max }),
          onBatchStarted: (key, total) => {
            activeBatchKey = key
            showCancel()
            applyState(btn, 'progress', `Fetching 1 of ${total}…`)
            // eslint-disable-next-line no-undef
            watchBatchProgress(
              key,
              (state, msg) => applyState(btn, state, msg),
              // eslint-disable-next-line no-undef
              chrome.storage.local,
              () => { activeBatchKey = null; hideCancel() },
            )
          },
        })
      }

      const onSingleGame = isBboBatch ? () => {
        picker.remove()
        doc.removeEventListener('click', closeOnOutside)
        handleClick({
          url: location.href,
          sendMessage,
          setState: (state, msg) => applyState(btn, state, msg),
          buildMessage: (url) => ({ type: 'extract-session', url }),
        })
      } : null

      const picker = buildDatePicker(doc, (months, max) => {
        picker.remove()
        doc.removeEventListener('click', closeOnOutside)
        if (isBboBatch) {
          // BBO: construct the history listing URL; server handles date filtering.
          const listUrl = bboHistoryUrl(location.href, months)
          if (!listUrl) { applyState(btn, 'error', 'Could not extract BBO username from URL'); return }
          startBatch(listUrl, null, max)
        } else {
          // ACBL club: pass listing URL + client-side since date.
          const since = months != null ? new Date() : null
          if (since) since.setMonth(since.getMonth() - months)
          startBatch(location.href, since ? since.toISOString().slice(0, 10) : null, max)
        }
      }, onSingleGame)

      // For fixed-position overlay buttons (BBO), anchor the picker to the
      // button itself so it appears below it. For in-flow buttons, anchor to
      // the parent so the picker is positioned within the layout.
      const isOverlay = btn.style.position === 'fixed'
      const anchor = isOverlay ? btn : (btn.parentElement ?? btn)
      if (!isOverlay) anchor.style.position = 'relative'
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
        storage,
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
      // The extraction runs in the service worker and its message does not
      // resolve until it finishes, so progress comes back through storage.
      storage: browser.storage.local,
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

    // BBO batch listing: if the lobby opened this hands.php page to collect
    // the tournament URL list, parse the DOM and return the results rather
    // than injecting a button. The browser's full auth flow means the page
    // renders with the real game data.
    if (window.location.hostname === 'www.bridgebase.com' &&
        window.location.pathname === '/myhands/hands.php') {
      browser.storage.local.get('bbo-batch-pending').then((result) => {
        if (!result?.['bbo-batch-pending']) return

        // BBO returns a timezone-detection redirect page on the first request
        // (its body onload="get_tz()" submits a form to navigate to the real
        // page). If we land on this redirect page, do nothing — let the
        // browser auto-navigate. The next page load will re-run this content
        // script with the pending flag still set so we can parse the real data.
        if (document.querySelector('form[name="tz_form"]')) return

        // BBO rejects date ranges over ~30 days with an "Invalid input" page.
        // Detect that and return an empty list (caller chunks if needed).
        const bodyText = document.body?.textContent ?? ''
        if (/Invalid input/i.test(bodyText)) {
          browser.storage.local.remove('bbo-batch-pending').catch(() => {})
          browser.storage.local.set({ 'bbo-batch-result': { urls: [], invalidInput: true, timestamp: Date.now() } })
            .then(() => browser.runtime.sendMessage({ type: 'close-current-tab' }).catch(() => {}))
            .catch(() => {})
          return
        }

        // Poll for tournament rows. We only get here on the real (post-redirect)
        // page, so they should appear quickly. Allow up to 10 seconds for
        // slow renders.
        const POLL_INTERVAL = 250
        const POLL_DEADLINE = Date.now() + 10000
        const tryParse = () => {
          const rows = document.querySelectorAll('tr.tourneySummary')
          if (rows.length === 0 && Date.now() < POLL_DEADLINE) {
            setTimeout(tryParse, POLL_INTERVAL)
            return
          }
          if (rows.length === 0) {
            // No tournaments in this date range — that's a valid result, not
            // an error. Return empty list so the caller knows to move on.
            browser.storage.local.remove('bbo-batch-pending').catch(() => {})
            browser.storage.local.set({ 'bbo-batch-result': { urls: [], timestamp: Date.now() } })
              .then(() => browser.runtime.sendMessage({ type: 'close-current-tab' }).catch(() => {}))
              .catch(() => {})
            return
          }
          const urls = []
          for (const row of rows) {
            const a = row.querySelector('td.tourneyName a')
            const href = a?.getAttribute('href') ?? a?.getAttribute('HREF')
            if (href) {
              urls.push(href.startsWith('http') ? href : `https://www.bridgebase.com${href}`)
            }
          }
          // hands.php lists oldest-first (chronological by date header);
          // reverse to newest-first so callers can slice(0, max) for "Most recent".
          urls.reverse()
          // Now that we have data, consume the pending flag and store result.
          browser.storage.local.remove('bbo-batch-pending').catch(() => {})
          browser.storage.local.set({ 'bbo-batch-result': { urls, timestamp: Date.now() } })
            .then(() => browser.runtime.sendMessage({ type: 'close-current-tab' }).catch(() => {}))
            .catch(() => {})
        }
        tryParse()
      }).catch(() => {})
    }

    // ACBL Live's listings get a link per row rather than a page-level button:
    // /my-results, /player-results/<id>, and a tournament's /events/<sanction>.
    // Same table markup in all three. Runs independently of injectButton, which
    // declines these pages.
    if (
      classifyLive(window.location.href) === 'player-history' ||
      classifyLive(window.location.href) === 'tournament-events'
    ) {
      injectResultRowLinks({ document })
      setupRowLinks({
        document,
        sendMessage: (msg) => browser.runtime.sendMessage(msg),
        storage: browser.storage.local,
      })
    }

    // Auto-trigger: if the app opened this page with #bc-analyze, extract
    // immediately without requiring the user to click the button.
    if (window.location.hash.includes('bc-analyze')) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
      const autoUrl = window.location.href // clean URL, hash already stripped
      // Poll until the button is injected (may need to wait for Vue/SPA mount),
      // then show progress states as if the user had clicked it.
      const tryAutoAnalyze = () => {
        const btn = document.getElementById(BUTTON_ID)
        if (!btn) { setTimeout(tryAutoAnalyze, 100); return }
        applyState(btn, 'extracting')
        browser.runtime.sendMessage({ type: 'extract-session', url: autoUrl })
          .then((response) => {
            if (response?.type === 'extraction-complete') {
              applyState(btn, 'success')
              setTimeout(() => applyState(btn, 'idle'), 2000)
            } else {
              applyState(btn, 'error', response?.error?.message ?? 'extraction failed')
            }
          })
          .catch((err) => applyState(btn, 'error', err?.message ?? 'message error'))
      }
      tryAutoAnalyze()
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
