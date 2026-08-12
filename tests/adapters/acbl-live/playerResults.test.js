import { describe, expect, it } from 'vitest'
import { parsePlayerResults } from '../../../src/adapters/acbl-live/parsers/playerResults.js'
import { classifyPage } from '../../../src/adapters/acbl-live/index.js'
import { isTeamEvent } from '../../../src/background/handlers.js'

// live.acbl.org/my-results is the same listing as /player-results/<id>,
// pre-filtered to the signed-in player — same columns, same Summary links.
const page = (rows) => `<html><body><table>
  <thead><tr>
    <th>Date</th><th>Tournament</th><th>Event</th><th>Session</th>
    <th>Last Updated</th><th>%</th><th>mps</th><th>Color</th><th>Links</th>
  </tr></thead>
  <tbody>${rows}</tbody></table></body></html>`

const row = (date, tournament, event) => `<tr>
  <td>${date}</td><td>${tournament}</td><td>${event}</td><td>10:00 am</td>
  <td>08/10/2026 12:25 AM</td><td>51.15</td><td>0.87</td><td>Silver</td>
  <td class="links"><a class="summary" href="/event/2608344/08OP/1/summary">Summary</a></td>
</tr>`

describe('classifyPage — my-results', () => {
  it('treats /my-results as a player history listing', () => {
    expect(classifyPage('https://live.acbl.org/my-results')).toBe('player-history')
    expect(classifyPage('https://live.acbl.org/my-results/')).toBe('player-history')
  })

  it('still recognises the explicit player-results form', () => {
    expect(classifyPage('https://live.acbl.org/player-results/1234567')).toBe('player-history')
  })

  it('does not over-match', () => {
    expect(classifyPage('https://live.acbl.org/my-results/extra')).toBe('unknown')
  })
})

describe('parsePlayerResults', () => {
  const html = page(
    row('08/09/2026', 'Palo Alto Sectional', 'Bracketed Teams 2') +
      row('06/27/2026', 'Firecracker Sectional', 'Open Pairs')
  )
  const events = parsePlayerResults(html)

  it('returns one entry per row, with the summary URL', () => {
    expect(events).toHaveLength(2)
    expect(events[0].url).toBe('https://live.acbl.org/event/2608344/08OP/1/summary')
  })

  it('captures the event name', () => {
    // Without this a batch cannot tell a team game from a pairs game: this
    // listing has no Type column, so the Event cell is the only signal.
    expect(events[0].name).toBe('Bracketed Teams 2')
    expect(events[1].name).toBe('Open Pairs')
  })

  it('captures the tournament name', () => {
    expect(events[0].tournament).toBe('Palo Alto Sectional')
  })

  it('gives a batch enough to skip team games before fetching', () => {
    expect(isTeamEvent(events[0])).toBe(true)
    expect(isTeamEvent(events[1])).toBe(false)
  })

  it('parses the date for range filtering', () => {
    expect(events[1].date).toBe('06/27/2026')
    expect(typeof events[1].date_sort).toBe('number')
  })

  it('throws when the page has no result rows at all', () => {
    expect(() => parsePlayerResults(page(''))).toThrow(/No result rows/)
  })
})
