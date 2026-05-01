// Parse the event-listing table from a my.acbl.org/club-results/<clubId> page.
// Returns an array of event objects, one per row that has a Results link,
// sorted newest-first (as the page renders them).

import { ParseError } from '../../../lib/parseError.js'

export function parseClubResultsList(htmlString, baseUrl = 'https://my.acbl.org') {
  if (typeof htmlString !== 'string' || htmlString.length === 0) {
    throw new ParseError('parseClubResultsList expects a non-empty HTML string')
  }
  const doc = new DOMParser().parseFromString(htmlString, 'text/html')
  const events = []

  for (const row of doc.querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 7) continue
    if (!cells[0].hasAttribute('data-sort')) continue

    const resultsLink = cells[6].querySelector('a[href*="/club-results/details/"]')
    if (!resultsLink) continue

    const href = resultsLink.getAttribute('href')
    const url = new URL(href, baseUrl).href

    const dateSortRaw = cells[0].getAttribute('data-sort')
    // data-sort is a Unix timestamp in seconds
    const date_sort = dateSortRaw ? Number(dateSortRaw) : null

    events.push({
      url,
      date_sort,
      date: cells[0].textContent.trim(),
      name: cells[1].textContent.trim(),
      type: cells[2].textContent.trim(),
      rating: cells[3].textContent.trim(),
      session: cells[4].textContent.trim(),
      tables: Number(cells[5].textContent.trim()) || null,
    })
  }

  if (events.length === 0) {
    throw new ParseError(
      'No result rows found in club-results listing — has my.acbl.org changed?'
    )
  }

  return events
}
