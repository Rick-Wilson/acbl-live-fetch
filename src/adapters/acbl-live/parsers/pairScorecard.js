import { ParseError } from '../../../lib/parseError.js'

const SUIT_CLASS_TO_LETTER = {
  spades: 'S',
  hearts: 'H',
  diams: 'D',
  clubs: 'C',
}

const MONTHS = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
}

// Output shape (PairScorecard) — flat fields the orchestrator nests into the
// tournaments/events/sessions tree from docs/normalized-schema.md.
//
// {
//   sanction,                 // tournament identifier (the misleading first
//                             //   "/event/" URL segment; ACBL's canonical id)
//   event_id,                 // event-within-tournament identifier
//   session_number,           // integer; unique within event
//   event_type,
//   tournament_name,          // human-readable, nullable
//   date,
//   time,
//   scoring,
//   user_pair: { section, direction, pair_number, players, session_score, session_percentage, carryover },
//   available_sessions: [     // every session listed in the page's session-select
//     { number, url }         //   dropdown — orchestrator uses this to fetch all
//   ],                        //   sessions of the same event for the same pair
//   boards: [
//     {
//       number, board_detail_url,
//       user_result: {
//         contract, declarer,
//         score,               // signed, NS perspective (per schema)
//         matchpoints, percentage,
//         opponents: { number, players }
//       }
//     }
//   ]
// }
export function parsePairScorecard(htmlString) {
  if (typeof htmlString !== 'string' || htmlString.length === 0) {
    throw new ParseError('parsePairScorecard expects a non-empty HTML string')
  }

  const doc = new DOMParser().parseFromString(htmlString, 'text/html')

  const { date, time } = parseDateTimeFromHeader(doc)
  const { event_type, scoring } = parseEventTypeAndScoring(doc)
  const userPairHeader = parseUserPairHeader(doc)
  const overall = parseOverallTable(doc)
  const boards = parseBoardsTable(doc, userPairHeader.direction)
  const { sanction, event_id, session_number, section } = deriveIdsFromBoardUrls(boards)
  const tournament_name = parseTournamentNameFromBboUrl(doc)
  const available_sessions = parseAvailableSessions(doc, session_number)

  return {
    sanction,
    event_id,
    session_number,
    event_type,
    tournament_name,
    date,
    time,
    scoring,
    user_pair: {
      section,
      direction: userPairHeader.direction,
      pair_number: userPairHeader.pair_number,
      players: userPairHeader.players,
      session_score: overall.session_score,
      session_percentage: overall.session_percentage,
      carryover: overall.carryover,
    },
    available_sessions,
    boards,
  }
}

function parseAvailableSessions(doc, currentSessionNumber) {
  // <select id="session-select"><option data-url="/event/.../1/scores/...">1</option> ...</select>
  // Each option is a different session of the same event for the same pair.
  // If the dropdown isn't present (e.g., a single-session event), return
  // just the current session so the caller can treat the result uniformly.
  const select = doc.querySelector('select#session-select')
  if (!select) {
    return Number.isInteger(currentSessionNumber)
      ? [{ number: currentSessionNumber, url: null }]
      : []
  }
  const options = [...select.querySelectorAll('option')]
  const out = []
  for (const opt of options) {
    const text = collapse(opt.textContent)
    const number = Number.parseInt(text, 10)
    const url = opt.getAttribute('data-url')
    if (!Number.isInteger(number) || !url) continue
    if (out.some((s) => s.number === number)) continue
    out.push({ number, url })
  }
  // Defensive: if the dropdown was empty / unparseable but we know the current
  // session number, surface at least that one.
  if (out.length === 0 && Number.isInteger(currentSessionNumber)) {
    return [{ number: currentSessionNumber, url: null }]
  }
  out.sort((a, b) => a.number - b.number)
  return out
}

function parseDateTimeFromHeader(doc) {
  const h1 = doc.querySelector('h1')
  if (!h1) throw new ParseError('Could not find <h1> with date/time', { selector: 'h1' })
  const text = collapse(h1.textContent)
  // Example: 'Apr 25, 2026 - Saturday 2:30 pm'
  const m = text.match(
    /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s*-\s*\S+\s+(\d{1,2}):(\d{2})\s*(am|pm)/i
  )
  if (!m) {
    throw new ParseError(`Could not parse date/time from h1: '${text}'`, {
      selector: 'h1',
      html: h1.outerHTML,
    })
  }
  const [, monthRaw, dayRaw, yearRaw, hourRaw, minRaw, ampm] = m
  const month = MONTHS[monthRaw.slice(0, 3).toLowerCase()]
  if (!month) throw new ParseError(`Unknown month abbreviation '${monthRaw}'`)
  const day = dayRaw.padStart(2, '0')
  const date = `${yearRaw}-${month}-${day}`
  const time = to24Hour(Number.parseInt(hourRaw, 10), Number.parseInt(minRaw, 10), ampm)
  return { date, time }
}

function to24Hour(hour, minute, ampm) {
  let h = hour % 12
  if (ampm.toLowerCase() === 'pm') h += 12
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseEventTypeAndScoring(doc) {
  const h2 = doc.querySelector('h2')
  if (!h2) throw new ParseError('Could not find <h2> with event type', { selector: 'h2' })
  const text = collapse(h2.textContent).toLowerCase()
  // Examples: 'Open Pairs Scores', 'Swiss Teams Scores', etc.
  let event_type = 'unknown'
  if (/open\s+pairs/.test(text)) event_type = 'open_pairs'
  else if (/swiss\s+teams/.test(text)) event_type = 'swiss_teams'
  else if (/knockout/.test(text)) event_type = 'knockout'

  // Scoring: imps for swiss/KO, matchpoints for pairs by default.
  // (Future: read column headers to confirm.)
  const scoring = event_type === 'open_pairs' ? 'matchpoints' : 'imps'

  return { event_type, scoring }
}

function parseUserPairHeader(doc) {
  const h4 = doc.querySelector('h4')
  if (!h4) {
    throw new ParseError('Could not find <h4> with user pair header', { selector: 'h4' })
  }
  // <h4 title="3506177 | 5550076"><span class="orange-text">4EW</span> - Name1 & Name2</h4>
  const span = h4.querySelector('span')
  if (!span) {
    throw new ParseError('Could not find pair-direction <span> inside h4', {
      selector: 'h4 span',
      html: h4.outerHTML,
    })
  }
  const spanText = collapse(span.textContent)
  const m = spanText.match(/^(\d+)(NS|EW|N|E|S|W)$/i)
  if (!m) {
    throw new ParseError(`Could not parse pair number/direction from '${spanText}'`, {
      selector: 'h4 span',
      html: h4.outerHTML,
    })
  }
  const pair_number = Number.parseInt(m[1], 10)
  const direction = normalizeDirection(m[2])

  // Names: text after the span, after the leading '-' or '–'.
  const fullText = collapse(h4.textContent)
  const namesPart = fullText.slice(spanText.length).replace(/^[\s\-–]+/, '')
  const names = namesPart
    .split(/\s*&\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (names.length !== 2) {
    throw new ParseError(`Expected 2 player names in h4, got ${names.length}: '${namesPart}'`, {
      selector: 'h4',
      html: h4.outerHTML,
    })
  }

  // ACBL IDs from title="ID1 | ID2" (may be missing for unregistered players).
  const title = h4.getAttribute('title') ?? ''
  const ids = title.split('|').map((s) => s.trim())
  const players = names.map((name, i) => ({
    name,
    acbl_id: ids[i] && /^\d+$/.test(ids[i]) ? ids[i] : null,
    external_ids: {},
  }))

  return { pair_number, direction, players }
}

function normalizeDirection(raw) {
  const v = raw.toUpperCase()
  if (v === 'NS' || v === 'N' || v === 'S') return 'NS'
  if (v === 'EW' || v === 'E' || v === 'W') return 'EW'
  return v
}

function parseOverallTable(doc) {
  // The first <table> (NOT a tablesorter) is the overall summary. Map header
  // text to column indices, then read the single data row.
  const tables = [...doc.querySelectorAll('table')]
  const overall = tables.find((t) => !t.classList.contains('tablesorter'))
  if (!overall) {
    throw new ParseError('Could not find overall summary table', { selector: 'table' })
  }

  // The thead has two rows; rowspan="2" headers belong to col positions
  // determined by their own row. Build column-index → header-text map by
  // walking the leaf header row.
  const headerCells = collectHeaderColumns(overall)
  const dataRow = overall.querySelector('tbody > tr')
  if (!dataRow) {
    throw new ParseError('Overall table has no tbody row', {
      selector: 'table tbody tr',
      html: overall.outerHTML,
    })
  }
  const cells = [...dataRow.children].filter((c) => c.tagName === 'TD')

  const norm = (s) => s.replace(/\s+/g, '').toLowerCase()
  const get = (header) => {
    const want = norm(header)
    // 'Carry<br>Over' collapses to 'CarryOver' in textContent, so compare with
    // all whitespace stripped (header HTML uses <br> for visual line breaks).
    const idx = headerCells.findIndex((h) => norm(h) === want)
    if (idx === -1 || idx >= cells.length) return null
    return collapse(cells[idx].textContent)
  }

  const session_score = parseFloatOrNull(get('Score'))
  const session_percentage = parseFloatOrNull(get('%'))
  const carryover = parseFloatOrNull(get('Carry Over'))

  if (session_score == null) {
    throw new ParseError('Could not extract session_score from overall table', {
      selector: 'table thead',
      html: overall.outerHTML.slice(0, 500),
    })
  }

  return { session_score, session_percentage, carryover }
}

function collectHeaderColumns(table) {
  // The overall table uses rowspan="2" to span both header rows. Reconstruct
  // the leaf-level column header text in column order.
  const headerRows = [...table.querySelectorAll('thead > tr')]
  if (headerRows.length === 0) return []

  // Track which column slots are already "filled" by rowspan from a prior row.
  const slots = []
  for (let r = 0; r < headerRows.length; r++) {
    let col = 0
    const ths = [...headerRows[r].children].filter((c) => c.tagName === 'TH')
    for (const th of ths) {
      while (slots[col]?.remaining > 0) {
        col++
      }
      const colspan = Number.parseInt(th.getAttribute('colspan') ?? '1', 10)
      const rowspan = Number.parseInt(th.getAttribute('rowspan') ?? '1', 10)
      const text = collapse(th.textContent)
      for (let c = 0; c < colspan; c++) {
        slots[col + c] = { text, remaining: rowspan - 1 }
      }
      col += colspan
    }
    // Decrement remaining for any slot not touched by this row.
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].remaining > 0 && !ths.some(() => false)) {
        // We already wrote to slots in this iteration; only decrement those
        // not written. Tracking that precisely is complex — instead, after each
        // row, decrement all slots that have remaining > 0 but weren't just set.
      }
    }
  }
  // Simplified: take leaf-level (last header row) priority; if a slot's text
  // came from an earlier-row rowspan it's still correct. The walk above already
  // overwrites slot text whenever a th covers it, so the final slots[] holds
  // the deepest header text per column.
  return slots.map((s) => s?.text ?? '')
}

function parseFloatOrNull(text) {
  if (text == null) return null
  const t = collapse(text)
  if (!t || t === '-' || t === '—') return null
  const n = Number.parseFloat(t)
  return Number.isNaN(n) ? null : n
}

function parseBoardsTable(doc, userDirection) {
  const table = doc.querySelector('table.tablesorter.scorecard')
  if (!table) {
    throw new ParseError('Could not find table.tablesorter.scorecard', {
      selector: 'table.tablesorter.scorecard',
    })
  }
  const headers = [...table.querySelectorAll('thead th')].map((th) => collapse(th.textContent))
  const idxBoard = headers.findIndex((h) => /board/i.test(h))
  const idxContract = headers.findIndex((h) => /^contract$/i.test(h))
  const idxBy = headers.findIndex((h) => /^by$/i.test(h))
  const idxPlus = headers.findIndex((h) => /^plus$/i.test(h))
  const idxMinus = headers.findIndex((h) => /^minus$/i.test(h))
  const idxMP = headers.findIndex((h) => /matchpoints/i.test(h))
  const idxPct = headers.findIndex((h) => /^%$/.test(h))
  const idxVs = headers.findIndex((h) => /^vs$/i.test(h))

  for (const [name, idx] of Object.entries({
    Board: idxBoard,
    Contract: idxContract,
    By: idxBy,
    Plus: idxPlus,
    Minus: idxMinus,
    Matchpoints: idxMP,
    Vs: idxVs,
  })) {
    if (idx === -1) {
      throw new ParseError(`Could not find '${name}' header in scorecard table`, {
        selector: 'table.tablesorter.scorecard thead',
      })
    }
  }

  const rows = [...table.querySelectorAll('tbody > tr')]
  return rows.map((row, i) =>
    parseBoardRow(row, i, userDirection, {
      idxBoard,
      idxContract,
      idxBy,
      idxPlus,
      idxMinus,
      idxMP,
      idxPct,
      idxVs,
    })
  )
}

function parseBoardRow(row, rowIdx, userDirection, idx) {
  const cells = [...row.children].filter((c) => c.tagName === 'TD')

  const boardCell = cells[idx.idxBoard]
  const link = boardCell?.querySelector('a')
  const board_detail_url = link?.getAttribute('href') ?? null
  const number = parseBoardNumber(boardCell, board_detail_url, rowIdx)

  const contract = parseContractCellText(cells[idx.idxContract])
  const declarer = collapse(cells[idx.idxBy].textContent).toUpperCase() || null

  const plus = parseFloatOrNull(cells[idx.idxPlus]?.textContent)
  const minus = parseFloatOrNull(cells[idx.idxMinus]?.textContent)
  const userPerspectiveScore = computeSignedScore(plus, minus)
  const score =
    userPerspectiveScore == null
      ? null
      : userDirection === 'EW'
        ? -userPerspectiveScore
        : userPerspectiveScore

  const matchpoints = parseFloatOrNull(cells[idx.idxMP]?.textContent)
  const percentage = idx.idxPct >= 0 ? parseFloatOrNull(cells[idx.idxPct]?.textContent) : null
  const opponents = parseOpponentsCell(cells[idx.idxVs])

  return {
    number,
    board_detail_url,
    user_result: {
      contract,
      declarer,
      score,
      matchpoints,
      percentage,
      opponents,
    },
  }
}

function parseBoardNumber(cell, url, rowIdx) {
  if (url) {
    const m = url.match(/board_num=(\d+)/)
    if (m) return Number.parseInt(m[1], 10)
  }
  if (cell) {
    const m = collapse(cell.textContent).match(/(\d+)/)
    if (m) return Number.parseInt(m[1], 10)
  }
  throw new ParseError(`Row ${rowIdx}: could not extract board number`, {
    selector: 'tr td (Board)',
    html: cell?.outerHTML,
  })
}

function parseContractCellText(cell) {
  if (!cell) return null
  const text = collapse(decorateSuitSymbols(cell))
  if (!text) return null
  if (/^pass/i.test(text)) return 'PASS'
  // Scorecard uses lowercase 'x'/'xx' for double/redouble; board-detail uses
  // uppercase. Match both, but normalize output to uppercase.
  const m = text.match(/^(\d)\s*(NT|[CDHS])\s*(XX|X|xx|x)?$/)
  if (!m) {
    throw new ParseError(`Could not parse scorecard contract cell: '${text}'`, {
      selector: 'td (Contract)',
      html: cell.outerHTML,
    })
  }
  const dbl = m[3] ? m[3].toUpperCase() : ''
  return `${m[1]}${m[2]}${dbl}`
}

function decorateSuitSymbols(el) {
  const clone = el.cloneNode(true)
  for (const sym of [...clone.querySelectorAll('span.symbol')]) {
    const cls = [...sym.classList].find((c) => SUIT_CLASS_TO_LETTER[c])
    if (cls) {
      sym.replaceWith(clone.ownerDocument.createTextNode(SUIT_CLASS_TO_LETTER[cls]))
    }
  }
  return clone.textContent
}

function computeSignedScore(plus, minus) {
  if (plus != null) return Math.abs(plus)
  if (minus != null) return -Math.abs(minus)
  return null
}

function parseOpponentsCell(cell) {
  if (!cell) return null
  // '9 - William Watson - Bonnie Macbride' with title="ID1 | ID2"
  const text = collapse(cell.textContent)
  const m = text.match(/^(\d+)\s*-\s*(.+?)\s*-\s*(.+)$/)
  if (!m) {
    return { number: null, players: [{ name: text, acbl_id: null, external_ids: {} }] }
  }
  const number = Number.parseInt(m[1], 10)
  const names = [m[2].trim(), m[3].trim()]
  const title = cell.getAttribute('title') ?? ''
  const ids = title.split('|').map((s) => s.trim())
  const players = names.map((name, i) => ({
    name,
    acbl_id: ids[i] && /^\d+$/.test(ids[i]) ? ids[i] : null,
    external_ids: {},
  }))
  return { number, players }
}

function deriveIdsFromBoardUrls(boards) {
  // Board-detail URLs look like:
  //   /event/{sanction}/{event_id}/{session_number}/board-detail/{section}?board_num={n}
  // The first URL segment is named "event" but actually identifies the
  // tournament (ACBL's term: sanction). See docs/acbl-live-format.md.
  const sample = boards.find((b) => b.board_detail_url)?.board_detail_url
  if (!sample) {
    throw new ParseError(
      'No board-detail URL available to derive sanction / event_id / session_number / section'
    )
  }
  const m = sample.match(/\/event\/(\d+)\/(\d+)\/(\d+)\/board-detail\/([A-Z]+)/)
  if (!m) {
    throw new ParseError(
      `Could not parse sanction/event_id/session_number/section from URL: '${sample}'`
    )
  }
  return {
    sanction: m[1],
    event_id: m[2],
    session_number: Number.parseInt(m[3], 10),
    section: m[4],
  }
}

function parseTournamentNameFromBboUrl(doc) {
  // The BBO handviewer URL on each row embeds 'Event: <Name>, <Type>, <Date>'
  // (URL-encoded) inside the p={...} parameter. Despite the 'Event:' label,
  // <Name> is actually the tournament name (e.g., 'Palo Alto Bridge Sectional')
  // — same misleading nomenclature as the URL-segment naming. The tournament
  // name doesn't appear in the visible page text otherwise.
  const link = doc.querySelector('a[href*="bridgebase.com/tools/handviewer.html"]')
  if (!link) return null
  const href = link.getAttribute('href') ?? ''
  // The tournament name in the BBO 'p={...}' block is followed by '%2C' (URL-encoded
  // comma) before the next field. Capture up to that, the literal ',', or '<'.
  const m = href.match(/<b>Event:<\/b>\s*(.+?)(?:%2C|,|<)/i)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]).trim() || null
  } catch {
    return m[1].trim() || null
  }
}

function collapse(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}
