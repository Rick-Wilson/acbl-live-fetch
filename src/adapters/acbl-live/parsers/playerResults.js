// Parse the ACBL Live player results listing page:
//   live.acbl.org/player-results/<acbl_id>
//
// Each table row represents one event session. We extract the "Summary" link
// (which points to an event-summary URL that our existing adapter already
// handles) and the event date for client-side date filtering.

import { ParseError } from '../../../lib/parseError.js'

export function parsePlayerResults(htmlString) {
  if (typeof htmlString !== 'string' || htmlString.length === 0) {
    throw new ParseError('parsePlayerResults expects a non-empty HTML string')
  }
  const doc = new DOMParser().parseFromString(htmlString, 'text/html')
  const events = []

  for (const row of doc.querySelectorAll('table tbody tr')) {
    // Summary link is in td.links — skip rows without one.
    const summaryLink = row.querySelector('td.links a.summary')
    if (!summaryLink) continue

    const href = summaryLink.getAttribute('href')
    if (!href) continue
    const url = new URL(href, 'https://live.acbl.org').href

    // Event date from first cell — "MM/DD/YYYY".
    const dateText = row.querySelector('td')?.textContent?.trim() ?? ''
    const m = dateText.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    const date_sort = m
      ? Math.floor(new Date(`${m[3]}-${m[1]}-${m[2]}T00:00:00`).getTime() / 1000)
      : null

    events.push({ url, date: dateText, date_sort })
  }

  if (events.length === 0) {
    throw new ParseError(
      'No result rows found in player results page — has live.acbl.org changed?'
    )
  }

  return events
}
