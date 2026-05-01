import { ParseError } from '../../../lib/parseError.js'

// Unicode suit symbols BBO uses in rendered result cells.
const SUIT_SYMBOL_TO_LETTER = {
  '♠': 'S',
  '♥': 'H',
  '♦': 'D',
  '♣': 'C',
}

// Parse the BBO traveller page (hands.php?traveller=<id>&username=<user>).
// One traveller page = one board; all tables that played that board are listed.
//
// Returns:
// {
//   userResultIndex: number | null  — 0-based index of the tr.highlight row
//   results: [{
//     players:         { N, S, E, W }  — BBO usernames
//     resultText:      string          — normalized result string e.g. "3NW+2"
//     ewPoints:        number          — raw bridge score, EW perspective
//     comparisonScore: number          — IMP or matchpoints comparison score
//     handviewerUrl:   string | null
//   }]
// }
export function parseTraveller(htmlString) {
  if (typeof htmlString !== 'string' || !htmlString) {
    throw new ParseError('parseTraveller expects a non-empty HTML string')
  }
  const doc = new DOMParser().parseFromString(htmlString, 'text/html')

  // All result rows: standard rows (.tourney) and the user's highlighted row (.highlight).
  const rows = [
    ...doc.querySelectorAll('tr.tourney, tr.highlight'),
  ].filter((r) => !r.classList.contains('tourneySummary'))

  if (rows.length === 0) {
    throw new ParseError(
      'No result rows found in traveller — has BBO traveller format changed?',
      { selector: 'tr.tourney, tr.highlight' }
    )
  }

  let userResultIndex = null
  const results = rows.map((row, idx) => {
    if (row.classList.contains('highlight')) userResultIndex = idx
    return parseResultRow(row, idx)
  })

  return { userResultIndex, results }
}

function parseResultRow(row, idx) {
  const cells = [...row.querySelectorAll('td')]
  if (cells.length < 9) {
    throw new ParseError(
      `Traveller row ${idx}: expected at least 9 <td> cells, got ${cells.length}`,
      { selector: 'tr td', html: row.outerHTML }
    )
  }

  // col 0: row number (sequential within traveller, not board number)
  // col 1: datetime
  // col 2: north, col 3: south, col 4: east, col 5: west
  // col 6: result string
  // col 7: EW Points (raw bridge score, EW perspective)
  // col 8: comparison score (IMPs or matchpoints)
  // col 9: movie link

  const players = {
    N: cells[2].textContent.trim(),
    S: cells[3].textContent.trim(),
    E: cells[4].textContent.trim(),
    W: cells[5].textContent.trim(),
  }

  const resultText = normalizeResultText(cells[6])

  // Traveller score cells always use class .score even for negative values;
  // the sign is in the numeric text itself (unlike the hands list's .negscore).
  const ewPoints = parseScoreCell(cells[7])
  const comparisonScore = parseScoreCell(cells[8])

  const movieLink = cells[9]?.querySelector('a')
  const handviewerUrl = movieLink
    ? (movieLink.getAttribute('href') ?? movieLink.getAttribute('HREF'))
    : null

  return { players, resultText, ewPoints, comparisonScore, handviewerUrl }
}

function normalizeResultText(cell) {
  let text = cell.textContent.trim()
  for (const [sym, letter] of Object.entries(SUIT_SYMBOL_TO_LETTER)) {
    text = text.replaceAll(sym, letter)
  }
  return text
}

function parseScoreCell(cell) {
  if (!cell) return null
  const text = cell.textContent.trim()
  if (!text) return null
  const n = Number.parseFloat(text)
  return Number.isNaN(n) ? null : n
}

// Parse a BBO result string into contract, declarer, and tricks.
//
// BBO format: {level}{strain}{double?}{declarer}{result}
//   level:    1–7
//   strain:   N (NT) | S H D C | ♠ ♥ ♦ ♣   (Unicode or letter, already normalized)
//   double:   x | xx (case-insensitive, optional)
//   declarer: N | E | S | W
//   result:   = | +N | -N
//
// Returns { contract, declarer, tricks } or nulls if the text doesn't match.
export function parseResultText(text) {
  if (!text) return { contract: null, declarer: null, tricks: null }
  const t = text.replace(/\s+/g, '')

  const m = t.match(/^(\d)([NSHDC])(x{0,2})?([NESW])(=|[+-]\d+)$/i)
  if (!m) return { contract: null, declarer: null, tricks: null }

  const level = Number.parseInt(m[1], 10)
  const strainChar = m[2].toUpperCase()
  const strain = strainChar === 'N' ? 'NT' : strainChar
  const double = (m[3] ?? '').toUpperCase()
  const declarer = m[4].toUpperCase()
  const resultStr = m[5]

  const contract = `${level}${strain}${double}`

  const base = level + 6
  let tricks
  if (resultStr === '=') {
    tricks = base
  } else {
    tricks = base + Number.parseInt(resultStr, 10)
  }

  return { contract, declarer, tricks }
}
