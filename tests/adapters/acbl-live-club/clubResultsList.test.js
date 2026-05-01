import { describe, it, expect } from 'vitest'
import { parseClubResultsList } from '../../../src/adapters/acbl-live-club/parsers/clubResultsList.js'

// Minimal HTML representative of the my.acbl.org/club-results/<id> listing page.
const LISTING_HTML = `
<!DOCTYPE html>
<html>
<body>
<table>
  <thead>
    <tr><th>Date</th><th>Event</th><th>Type</th><th>Rating</th><th>Session</th><th>Tables</th><th></th></tr>
  </thead>
  <tbody>
    <tr>
      <td data-sort="1745712000">04/27/2026</td>
      <td>Monday Morning Pairs</td>
      <td>PAIRS</td>
      <td>Club Charity Championship</td>
      <td>Mon Mor</td>
      <td>12</td>
      <td>
        <a href="/club-results/details/99001">Results</a>
      </td>
    </tr>
    <tr>
      <td data-sort="1745107200">04/20/2026</td>
      <td>Monday Morning Pairs</td>
      <td>PAIRS</td>
      <td>Club Charity Championship</td>
      <td>Mon Mor</td>
      <td>12.5</td>
      <td>
        <a href="/club-results/details/99002">Results</a>
        <a href="https://s3.amazonaws.com/results-gateway/production/hand_records/fake.pdf"> Hands(PDF)</a>
      </td>
    </tr>
    <tr>
      <td data-sort="1572480000">10/31/2019</td>
      <td>Swiss Club Appreciation</td>
      <td>TEAMS</td>
      <td>Club Appreciation Team (Gold)</td>
      <td>Thu Mor</td>
      <td>8</td>
      <td>
        <a href="/club-results/details/31223">Results</a>
      </td>
    </tr>
    <tr>
      <td data-sort="1572220800">10/28/2019</td>
      <td>Stratified Open Pairs</td>
      <td>PAIRS</td>
      <td>Club Appreciation</td>
      <td>Mon Mor</td>
      <td>9.5</td>
      <td>
        <!-- no Results link — cancelled game or missing data -->
      </td>
    </tr>
  </tbody>
</table>
</body>
</html>
`

describe('parseClubResultsList', () => {
  it('extracts rows that have a Results link', () => {
    const events = parseClubResultsList(LISTING_HTML)
    expect(events).toHaveLength(3) // row 4 has no Results link — skipped
  })

  it('builds absolute URLs from relative hrefs', () => {
    const events = parseClubResultsList(LISTING_HTML)
    expect(events[0].url).toBe('https://my.acbl.org/club-results/details/99001')
    expect(events[1].url).toBe('https://my.acbl.org/club-results/details/99002')
    expect(events[2].url).toBe('https://my.acbl.org/club-results/details/31223')
  })

  it('parses date_sort as a number', () => {
    const events = parseClubResultsList(LISTING_HTML)
    expect(events[0].date_sort).toBe(1745712000)
    expect(typeof events[0].date_sort).toBe('number')
  })

  it('parses display date, name, type, rating, session, tables', () => {
    const events = parseClubResultsList(LISTING_HTML)
    expect(events[0].date).toBe('04/27/2026')
    expect(events[0].name).toBe('Monday Morning Pairs')
    expect(events[0].type).toBe('PAIRS')
    expect(events[0].rating).toBe('Club Charity Championship')
    expect(events[0].session).toBe('Mon Mor')
    expect(events[0].tables).toBe(12)
  })

  it('handles fractional table counts', () => {
    const events = parseClubResultsList(LISTING_HTML)
    expect(events[1].tables).toBe(12.5)
  })

  it('ignores the PDF link when picking the Results url', () => {
    const events = parseClubResultsList(LISTING_HTML)
    expect(events[1].url).toBe('https://my.acbl.org/club-results/details/99002')
  })

  it('accepts a custom baseUrl', () => {
    const events = parseClubResultsList(LISTING_HTML, 'https://example.com')
    expect(events[0].url).toBe('https://example.com/club-results/details/99001')
  })

  it('throws ParseError on empty input', () => {
    expect(() => parseClubResultsList('')).toThrow('non-empty HTML string')
  })

  it('throws ParseError when no result rows are found', () => {
    expect(() => parseClubResultsList('<html><body><table></table></body></html>')).toThrow(
      'No result rows found'
    )
  })
})
