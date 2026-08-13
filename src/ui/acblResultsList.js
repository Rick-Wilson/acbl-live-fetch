// ACBL Live's listing pages: one Analyze link per row.
//
// Covers /my-results, /player-results/<id> and a tournament's
// /events/<sanction> — all three share the same table markup.
//
// Extracted from sourceContent.js. Behaviour unchanged.

import { buildPairPicker, PAIR_FILTER_CLASS } from './pairPicker.js'
import { watchExtractionProgress, newProgressKey } from './extractProgress.js'

// ── ACBL Live results listing: one link per row ────────────────────────────
//
// /my-results and /player-results/<id> list a player's sessions, each with a
// Links column ("Summary | Overalls | Recaps | Hands"). We add one more entry
// to that column rather than putting a single button at the top of the page,
// because there is nothing sensible for a page-level button to extract here —
// the page is a list, and the user means one row of it.
//
// This replaced a date-range batch. live.acbl.org allows roughly 110 requests
// per sign-in under /event/*, which is about two events; a batch of five spent
// the allowance mid-run and got the user signed out. See docs/acbl-rate-limit.md.
//
// Per-row links invite clicking one after another, so the second click has to
// explain itself when it fails — that is what rowMessage is for.
export const ROW_LINK_CLASS = 'bridge-classroom-row-link'
export const ROW_MESSAGE_CLASS = 'bridge-classroom-row-message'

export const SESSION_EXPIRED_MESSAGE =
  'ACBL Live limits how much can be fetched per sign-in, and this one is spent. ' +
  'Sign out of ACBL Live and sign back in, then fetch the next event.'

export function messageForError(code, message) {
  if (code === 'session-expired') return SESSION_EXPIRED_MESSAGE
  return message ?? 'extraction failed'
}

// "Rick Wilson's Results" → "Rick Wilson". Both listing pages title themselves
// this way, and it is the only place the player's name appears in full — which
// the adapter needs in order to enter through their own scorecard rather than
// whichever pair the summary page happens to list first.
export function readPlayerName(doc) {
  const heading = doc.querySelector('h1')?.textContent ?? ''
  const m = heading.match(/^\s*(.+?)['’]s\s+Results\s*$/i)
  return m ? m[1].trim() : null
}

// Skip team events. A team event's summary page has no pair-scorecard link —
// there are no pairs — so the extraction fails with "could not find any
// pair-scorecard link", which is accurate and useless. Better not to offer the
// click. See CLAUDE.md § ACBL Live team events are not supported.
//
// Excluding teams rather than requiring "Pairs" is the deliberate direction.
// The two failure modes are not symmetrical: an unrecognised label that we
// nevertheless *could* read would be silently unfetchable, with nothing on
// screen to explain why, whereas an unrecognised label we cannot read costs one
// click and shows an error. Losing a fetchable event is the worse of the two.
//
// Matches the shape of isTeamEvent in handlers.js, plus the team events that
// do not say "teams" anywhere in their name: knockouts, and GNT — the Grand
// National Teams, which appear as "GNT" and nothing else.
//
// Deliberately not here: NAP. Same shape of abbreviation, opposite meaning —
// North American *Pairs* — and excluding it would silently hide an event we
// can read perfectly well.
export function isTeamEventLabel(text) {
  return /\bteams?\b|\bknockout\b|\bgnt\b/i.test(text ?? '')
}

// Which column holds the event name. Found by header text rather than by
// position: this listing renders in two forms with different column orders, so
// "column 3" is not reliable.
function eventColumnIndex(table) {
  const headers = [...table.querySelectorAll('thead th')].map((th) =>
    (th.textContent ?? '').trim().toLowerCase()
  )
  return headers.indexOf('event')
}

// Every row that carries a Summary link, paired with the URL it points at and
// the text of its Event cell.
export function resultRows(doc) {
  const rows = []
  const eventIdxByTable = new Map()
  for (const cell of doc.querySelectorAll('td.links')) {
    const summary = cell.querySelector('a.summary')
    const href = summary?.getAttribute('href')
    if (!href) continue
    let url
    try {
      url = new URL(href, doc.baseURI ?? 'https://live.acbl.org').toString()
    } catch {
      continue
    }
    const row = cell.closest ? cell.closest('tr') : cell.parentElement
    const table = row?.closest?.('table')
    if (table && !eventIdxByTable.has(table)) {
      eventIdxByTable.set(table, eventColumnIndex(table))
    }
    const idx = table ? eventIdxByTable.get(table) : -1
    const cells = row ? [...row.children].filter((c) => c.tagName === 'TD') : []
    const eventText = idx >= 0 ? (cells[idx]?.textContent ?? '').trim() : ''
    rows.push({ cell, url, row, eventText })
  }
  return rows
}

export function injectResultRowLinks(deps) {
  const { document: doc } = deps
  const rows = resultRows(doc)
  let added = 0
  for (const { cell, url, eventText } of rows) {
    if (isTeamEventLabel(eventText)) continue
    if (cell.querySelector(`.${ROW_LINK_CLASS}`)) continue // idempotent
    cell.appendChild(doc.createTextNode(' | '))
    const a = doc.createElement('a')
    a.className = ROW_LINK_CLASS
    a.href = '#'
    a.textContent = 'Analyze in Bridge Classroom'
    a.dataset.bcUrl = url
    cell.appendChild(a)
    added += 1
  }
  return added
}

// Everything we may have inserted beneath a row — a message or an open picker.
// One at a time: a column of stale errors and half-open pickers from earlier
// clicks would be worse than none.
export function clearRowExtras(doc) {
  for (const el of doc.querySelectorAll(`.${ROW_MESSAGE_CLASS}`)) el.remove()
}

// The pair picker, rendered under the row instead of floating from a button.
// Same widget; only the positioning differs, since here it belongs to a row
// rather than to a control in the page header.
export function showRowPicker(doc, row, pairs, onSelect) {
  clearRowExtras(doc)
  if (!row?.parentElement) return null
  const tr = doc.createElement('tr')
  tr.className = ROW_MESSAGE_CLASS
  const td = doc.createElement('td')
  td.colSpan = Math.max(1, row.children.length)
  td.style.padding = '8px 12px'
  const picker = buildPairPicker(doc, pairs, onSelect)
  Object.assign(picker.style, { position: 'static', boxShadow: 'none', maxHeight: '40vh' })
  td.appendChild(picker)
  tr.appendChild(td)
  row.insertAdjacentElement('afterend', tr)
  picker.querySelector(`.${PAIR_FILTER_CLASS}`)?.focus()
  return tr
}

// A message under the row that was clicked, spanning the table. Only one at a
// time: a column of stale errors from earlier clicks would be worse than none.
export function showRowMessage(doc, row, text, kind = 'error') {
  clearRowExtras(doc)
  if (!row?.parentElement) return null
  const tr = doc.createElement('tr')
  tr.className = ROW_MESSAGE_CLASS
  const td = doc.createElement('td')
  td.colSpan = Math.max(1, row.children.length)
  td.textContent = text
  Object.assign(td.style, {
    padding: '10px 12px',
    background: kind === 'error' ? '#fdecea' : '#e8f4ea',
    color: kind === 'error' ? '#7f231c' : '#1d5b2b',
    borderLeft: `4px solid ${kind === 'error' ? '#c0392b' : '#2e7d43'}`,
    fontSize: '14px',
  })
  tr.appendChild(td)
  row.insertAdjacentElement('afterend', tr)
  return tr
}

// Wire the row links. Delegated for the same reason the main button is:
// Cloudflare Rocket Loader clones nodes and drops their listeners.
export function setupRowLinks(deps) {
  const { document: doc, sendMessage, storage = null } = deps
  let busy = false

  doc.addEventListener('click', (e) => {
    const link = e.target.closest?.(`.${ROW_LINK_CLASS}`)
    if (!link) return
    e.preventDefault()
    // One at a time. Each fetch is ~50 requests out of an allowance of ~110,
    // and two at once would spend it mid-flight and fail both.
    if (busy) return
    busy = true

    const row = link.closest('tr')
    const original = link.textContent
    const playerName = readPlayerName(doc)
    link.textContent = 'Fetching…'
    link.style.pointerEvents = 'none'
    clearRowExtras(doc)

    // An event is ~50 board pages and takes tens of seconds. A label that never
    // changes over that long reads as a stall, so show the count climbing.
    const progressKey = newProgressKey()
    const stopWatching = storage
      ? watchExtractionProgress(
          progressKey,
          (pct) => {
            link.textContent = `Fetching… ${pct}%`
          },
          storage
        )
      : () => {}

    const done = (text) => {
      busy = false
      stopWatching()
      link.textContent = text ?? original
      link.style.pointerEvents = ''
    }

    const extract = (url) =>
      sendMessage({ type: 'extract-session', url, playerName, progressKey })
        .then((response) => {
          if (response?.type === 'extraction-complete') {
            done('Opening…')
            setTimeout(() => done(original), 2000)
            return
          }
          showRowMessage(doc, row, messageForError(response?.error?.code, response?.error?.message))
          done(original)
        })
        .catch((err) => {
          showRowMessage(doc, row, err?.message ?? 'message channel error')
          done(original)
        })

    // A tournament's event list names no player — its heading is the host city
    // — so there is nobody to fetch for. Ask which pair instead of picking one,
    // because the extractor covers a single section now and the wrong pair
    // means the wrong section and none of the intended boards.
    if (!playerName) {
      link.textContent = 'Loading pairs…'
      sendMessage({ type: 'list-event-pairs', url: link.dataset.bcUrl })
        .then((response) => {
          if (response?.type !== 'event-pairs' || !response.pairs?.length) {
            showRowMessage(
              doc,
              row,
              messageForError(response?.error?.code, response?.error?.message ?? 'no pairs in this event')
            )
            done(original)
            return
          }
          // Released while the picker is open so another row can be clicked;
          // taken again by extract() once a pair is chosen.
          busy = false
          link.textContent = original
          link.style.pointerEvents = ''
          showRowPicker(doc, row, response.pairs, (entry) => {
            clearRowExtras(doc)
            busy = true
            link.textContent = 'Fetching…'
            link.style.pointerEvents = 'none'
            extract(entry.url)
          })
        })
        .catch((err) => {
          showRowMessage(doc, row, err?.message ?? 'message channel error')
          done(original)
        })
      return
    }

    extract(link.dataset.bcUrl)
  })
}
