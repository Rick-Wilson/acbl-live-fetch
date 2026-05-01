// Parse the BBO multi-tourney history listing page:
//   hands.php?username=<user>&start_time=<unix>&end_time=<unix>
//
// The page embeds one tr.tourneySummary row per tournament, each containing
// a link to the tview.php page for that tournament. Individual board rows
// (tr.tourney) are also present but ignored here — we only need the entry
// points for batch extraction.
//
// Returns an array of event objects, one per tourneySummary row.

import { ParseError } from '../../../lib/parseError.js'

export function parseBboHistoryList(htmlString) {
  if (typeof htmlString !== 'string' || htmlString.length === 0) {
    throw new ParseError('parseBboHistoryList expects a non-empty HTML string')
  }
  const doc = new DOMParser().parseFromString(htmlString, 'text/html')
  const events = []

  for (const row of doc.querySelectorAll('tr.tourneySummary')) {
    const nameLink = row.querySelector('td.tourneyName a')
    if (!nameLink) continue

    const href = nameLink.getAttribute('href') ?? nameLink.getAttribute('HREF')
    if (!href) continue

    // href is already absolute: "https://webutil.bridgebase.com/v2/tview.php?..."
    const url = href.startsWith('http') ? href : new URL(href, 'https://www.bridgebase.com').href

    const placeCell = row.querySelector('td.tourneyPlace')
    const pointsCell = row.querySelector('td.tourneyPoints')
    const scoreCell = row.querySelector('td.tourneyScore')

    events.push({
      url,
      name: nameLink.textContent.trim(),
      place: placeCell?.textContent.trim() ?? null,
      points: parseFloat(pointsCell?.textContent.trim()) || null,
      score: scoreCell?.textContent.trim() ?? null,
    })
  }

  if (events.length === 0) {
    throw new ParseError(
      'No tourneySummary rows found in BBO history listing — has the page format changed?'
    )
  }

  return events
}
