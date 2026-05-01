import { ParseError } from '../../../lib/parseError.js'
import { extractLinFromOnclick, parseLin } from './lin.js'

// Unicode suit symbols BBO uses in rendered result cells.
const SUIT_SYMBOL_TO_LETTER = {
  '♠': 'S', // ♠
  '♥': 'H', // ♥
  '♦': 'D', // ♦
  '♣': 'C', // ♣
}

// Parse the BBO hands list page (hands.php?tourney=<id>-&username=<user>).
//
// Returns:
// {
//   tourneyId:      string  — "81382-1777478400"
//   tourneyName:    string  — "#81382 ACBL Wed Noon ET Speedball (GIB)"
//   tviewUrl:       string  — full URL of the tournament summary page
//   username:       string  — viewing player's BBO username
//   partner:        string  — partner's BBO username
//   direction:      'NS' | 'EW'
//   scoring:        'imps' | 'matchpoints'
//   sessionScore:   number  — total IMP or matchpoints score for the session
//   boards: [{
//     number:        number
//     time:          string  — "09:04"
//     players:       { N, S, E, W }  — BBO usernames
//     resultText:    string  — raw result string, e.g. "3NW+2" or "4♥S+3"
//     ewPoints:      number  — raw bridge score, EW perspective
//     comparisonScore: number — IMP or matchpoints comparison score
//     linData:       object | null  — parsed LIN (dealer, vulnerability, deal, auction, play, tricks)
//     travellerUrl:  string  — absolute URL to this board's traveller page
//     handviewerUrl: string  — BBO handviewer URL
//   }]
// }
export function parseHandsList(htmlString) {
  if (typeof htmlString !== 'string' || !htmlString) {
    throw new ParseError('parseHandsList expects a non-empty HTML string')
  }
  const doc = new DOMParser().parseFromString(htmlString, 'text/html')

  // --- Tournament summary row ---
  const summaryRow = doc.querySelector('tr.tourneySummary')
  if (!summaryRow) {
    throw new ParseError(
      'Could not find tr.tourneySummary — has BBO hands list format changed?',
      { selector: 'tr.tourneySummary' }
    )
  }

  const nameLink = summaryRow.querySelector('td.tourneyName a')
  if (!nameLink) {
    throw new ParseError('Could not find td.tourneyName a in tourneySummary row', {
      selector: 'td.tourneyName a',
    })
  }
  const tourneyName = nameLink.textContent.trim() || null
  const tviewUrl = nameLink.getAttribute('href') ?? nameLink.getAttribute('HREF') ?? null
  const tourneyId = parseTourneyId(tviewUrl)

  const scoreCell = summaryRow.querySelector('td.tourneyScore')
  const sessionScore = scoreCell ? parseFloat(scoreCell.textContent.trim()) : null

  // tourneyPlace is "32/80" — the numerator is the user's overall rank, which
  // we use as a surrogate pair number (BBO has no explicit pair numbers).
  const placeCell = summaryRow.querySelector('td.tourneyPlace')
  const overallRank = parsePlaceRank(placeCell?.textContent.trim())

  // --- Scoring type (from footer th.totals text) ---
  const totalsTexts = [...doc.querySelectorAll('th.totals')].map((th) =>
    th.textContent.toLowerCase()
  )
  const scoring = totalsTexts.some((t) => t.includes('imp')) ? 'imps' : 'matchpoints'

  // --- Username (from span.username in the page header area) ---
  const usernameSpan = doc.querySelector('span.username')
  const username = usernameSpan?.textContent.trim() ?? null
  if (!username) {
    throw new ParseError('Could not find span.username in hands list page', {
      selector: 'span.username',
    })
  }

  // --- Board rows ---
  const boardRows = [...doc.querySelectorAll('tr.tourney')]
  if (boardRows.length === 0) {
    throw new ParseError('No tr.tourney rows found in hands list — has BBO format changed?', {
      selector: 'tr.tourney',
    })
  }

  // Determine direction + partner from the first board row.
  const { direction, partner } = detectDirectionAndPartner(boardRows[0], username)

  const boards = boardRows.map((row, idx) => parseBoardRow(row, idx, username))

  return {
    tourneyId,
    tourneyName,
    tviewUrl,
    username,
    partner,
    direction,
    scoring,
    overallRank,
    sessionScore,
    boards,
  }
}

// Extract tourney ID from the tview URL query string.
// "https://webutil.bridgebase.com/v2/tview.php?t=81382-1777478400&u=kemistry"
// → "81382-1777478400"
function parseTourneyId(tviewUrl) {
  if (!tviewUrl) return null
  try {
    return new URL(tviewUrl).searchParams.get('t') ?? null
  } catch {
    return null
  }
}

// Determine the user's direction (NS or EW) and partner's username from a board row.
function detectDirectionAndPartner(row, username) {
  const north = row.querySelector('td.north')?.textContent.trim() ?? ''
  const south = row.querySelector('td.south')?.textContent.trim() ?? ''
  const east = row.querySelector('td.east')?.textContent.trim() ?? ''
  const west = row.querySelector('td.west')?.textContent.trim() ?? ''

  if (north === username || south === username) {
    const partner = north === username ? south : north
    return { direction: 'NS', partner }
  }
  const partner = east === username ? west : east
  return { direction: 'EW', partner }
}

// Parse one tr.tourney row into a board descriptor.
function parseBoardRow(row, idx, username) {
  const cells = [...row.querySelectorAll('td')]
  if (cells.length < 10) {
    throw new ParseError(
      `Board row ${idx}: expected at least 10 <td> cells, got ${cells.length}`,
      { selector: 'tr.tourney td', html: row.outerHTML }
    )
  }

  const number = Number.parseInt(cells[0].textContent.trim(), 10)
  if (Number.isNaN(number)) {
    throw new ParseError(`Board row ${idx}: could not parse board number from '${cells[0].textContent}'`, {
      selector: 'td.handnum',
      html: cells[0].outerHTML,
    })
  }

  const time = cells[1].textContent.trim()

  const players = {
    N: cells[2].textContent.trim(),
    S: cells[3].textContent.trim(),
    E: cells[4].textContent.trim(),
    W: cells[5].textContent.trim(),
  }

  const resultText = normalizeResultText(cells[6])

  // Two score cells follow result. They use .score or .negscore;
  // the sign is encoded in the numeric text value.
  const ewPoints = parseScoreCell(cells[7])
  const comparisonScore = parseScoreCell(cells[8])

  // LIN data from the movie cell's onclick attribute.
  const movieLink = cells[9].querySelector('a[onclick]')
  const linData = parseLinFromLink(movieLink)

  const handviewerUrl = movieLink
    ? (movieLink.getAttribute('href') ?? movieLink.getAttribute('HREF'))
    : null

  // Traveller URL from the last cell (may be index 10 if trailer td exists).
  const travellerAnchor = row.querySelector('td.traveller a') ?? cells[10]?.querySelector('a')
  // BBO's server HTML uses uppercase HREF; Chrome's service-worker DOMParser
  // does not normalize attribute names to lowercase (unlike jsdom in tests),
  // so getAttribute('href') misses it. Check both cases.
  const rawHref = travellerAnchor
    ? (travellerAnchor.getAttribute('href') ?? travellerAnchor.getAttribute('HREF'))
    : null
  const travellerUrl = rawHref ? absoluteTravellerUrl(rawHref) : null

  return {
    number,
    time,
    players,
    resultText,
    ewPoints,
    comparisonScore,
    linData,
    travellerUrl,
    handviewerUrl,
  }
}

// Get textContent of the result cell, mapping Unicode suit symbols to letters
// so parsers downstream see plain ASCII like "4HW=" rather than "4♥W=".
function normalizeResultText(cell) {
  let text = cell.textContent.trim()
  for (const [sym, letter] of Object.entries(SUIT_SYMBOL_TO_LETTER)) {
    text = text.replaceAll(sym, letter)
  }
  return text
}

// Parse a score cell: return a float from its text content.
// Both .score and .negscore are handled the same way — the sign is in the value.
function parseScoreCell(cell) {
  if (!cell) return null
  const text = cell.textContent.trim()
  if (!text) return null
  const n = Number.parseFloat(text)
  return Number.isNaN(n) ? null : n
}

// Extract and parse LIN data from the movie link's onclick attribute.
// Returns parsed LIN object or null if not available.
function parseLinFromLink(linkEl) {
  if (!linkEl) return null
  const onclick = linkEl.getAttribute('onclick') ?? linkEl.getAttribute('ONCLICK')
  const linStr = extractLinFromOnclick(onclick)
  if (!linStr) return null
  try {
    return parseLin(linStr)
  } catch {
    return null
  }
}

// Resolve a traveller href to an absolute URL.
// BBO uses absolute paths like "/myhands/hands.php?traveller=...".
function absoluteTravellerUrl(href) {
  try {
    return new URL(href, 'https://www.bridgebase.com').toString()
  } catch {
    return href
  }
}

// Parse the numerator from a rank string like "32/80" → 32.
// Returns null if the format is unrecognized.
function parsePlaceRank(text) {
  if (!text) return null
  const m = text.match(/^(\d+)\//)
  return m ? Number.parseInt(m[1], 10) : null
}
