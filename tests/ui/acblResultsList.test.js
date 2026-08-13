import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  injectResultRowLinks,
  setupRowLinks,
  readPlayerName,
  messageForError,
  resultRows,
  isTeamEventLabel,
  ROW_LINK_CLASS,
  ROW_MESSAGE_CLASS,
  SESSION_EXPIRED_MESSAGE,
} from '../../src/ui/acblResultsList.js'

const here = dirname(fileURLToPath(import.meta.url))


describe('ACBL Live results listing: per-row links', () => {
  // Mirrors the real page: a Links column with Summary/Overalls/Recaps, one
  // row per session, and the player's name in the h1.
  // The <base> stands in for the real page's own URL: hrefs in the Links
  // column are root-relative, and jsdom would otherwise resolve them against
  // localhost.
  const listingHtml = `
    <base href="https://live.acbl.org/my-results">
    <h1>Rick Wilson's Results</h1>
    <table>
      <thead><tr><th>Date</th><th>Tournament</th><th>Event</th><th>Links</th></tr></thead>
      <tbody>
      <tr>
        <td>06/27/2026</td><td>Firecracker Sectional</td><td>Open Pairs</td>
        <td class="links">
          <a class="summary" href="/event/2606319/27OP/1/summary">Summary</a> |
          <a href="/event/2606319/27OP/1/results">Overalls</a>
        </td>
      </tr>
      <tr>
        <td>06/26/2026</td><td>Firecracker Sectional</td><td>MidFlight Pairs</td>
        <td class="links">
          <a class="summary" href="/event/2606319/26MP/1/summary">Summary</a>
        </td>
      </tr>
      <tr>
        <td>08/09/2026</td><td>Open &amp; Silver Rush</td><td>Bracketed Teams 2</td>
        <td class="links">
          <a class="summary" href="/event/2607777/26BT/1/summary">Summary</a>
        </td>
      </tr>
      <tr><td colspan="4">a row with no links cell</td></tr>
    </tbody></table>`

  function makeDoc() {
    document.body.innerHTML = listingHtml
    return document
  }

  beforeEach(() => { document.body.innerHTML = '' })

  it('reads the player name out of the heading', () => {
    expect(readPlayerName(makeDoc())).toBe('Rick Wilson')
  })

  it('handles a curly apostrophe, which the page may render either way', () => {
    document.body.innerHTML = '<h1>Rick Wilson’s Results</h1>'
    expect(readPlayerName(document)).toBe('Rick Wilson')
  })

  it('returns null rather than a wrong name when the heading is unexpected', () => {
    document.body.innerHTML = '<h1>Some Other Page</h1>'
    expect(readPlayerName(document)).toBeNull()
  })

  it('adds one link per row that has a Summary link, carrying that row URL', () => {
    const doc = makeDoc()
    expect(injectResultRowLinks({ document: doc })).toBe(2)
    const links = [...doc.querySelectorAll(`.${ROW_LINK_CLASS}`)]
    expect(links).toHaveLength(2)
    expect(links.map((a) => a.dataset.bcUrl)).toEqual([
      'https://live.acbl.org/event/2606319/27OP/1/summary',
      'https://live.acbl.org/event/2606319/26MP/1/summary',
    ])
    expect(links[0].textContent).toBe('Analyze in Bridge Classroom')
  })

  it('is idempotent — a re-render must not stack duplicate links', () => {
    const doc = makeDoc()
    injectResultRowLinks({ document: doc })
    expect(injectResultRowLinks({ document: doc })).toBe(0)
    expect(doc.querySelectorAll(`.${ROW_LINK_CLASS}`)).toHaveLength(2)
  })

  it('sends the row URL and the player name, so the adapter finds the right pair', async () => {
    const doc = makeDoc()
    injectResultRowLinks({ document: doc })
    const sendMessage = vi.fn(async () => ({ type: 'extraction-complete', sid: 'x' }))
    setupRowLinks({ document: doc, sendMessage })

    doc.querySelector(`.${ROW_LINK_CLASS}`).click()
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled())
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      type: 'extract-session',
      url: 'https://live.acbl.org/event/2606319/27OP/1/summary',
      playerName: 'Rick Wilson',
    })
  })

  it('explains the sign-in allowance when the second fetch is refused', async () => {
    // The whole reason per-row links need feedback: they invite a second click,
    // and the second click is the one that usually hits the ceiling.
    const doc = makeDoc()
    injectResultRowLinks({ document: doc })
    setupRowLinks({
      document: doc,
      sendMessage: async () => ({
        type: 'extraction-error',
        error: { code: 'session-expired', message: 'ACBL Live signed us out during the extraction.' },
      }),
    })

    doc.querySelector(`.${ROW_LINK_CLASS}`).click()
    await vi.waitFor(() => expect(doc.querySelector(`.${ROW_MESSAGE_CLASS}`)).not.toBeNull())
    const msg = doc.querySelector(`.${ROW_MESSAGE_CLASS}`)
    expect(msg.textContent).toBe(SESSION_EXPIRED_MESSAGE)
    // Directly beneath the row that was clicked.
    expect(msg.previousElementSibling.textContent).toContain('Open Pairs')
  })

  it('shows only the most recent message, not a column of stale ones', async () => {
    const doc = makeDoc()
    injectResultRowLinks({ document: doc })
    setupRowLinks({
      document: doc,
      sendMessage: async () => ({ type: 'extraction-error', error: { code: 'session-expired' } }),
    })
    const links = [...doc.querySelectorAll(`.${ROW_LINK_CLASS}`)]
    links[0].click()
    await vi.waitFor(() => expect(doc.querySelectorAll(`.${ROW_MESSAGE_CLASS}`)).toHaveLength(1))
    links[1].click()
    await vi.waitFor(() =>
      expect(doc.querySelector(`.${ROW_MESSAGE_CLASS}`).previousElementSibling.textContent)
        .toContain('MidFlight')
    )
    expect(doc.querySelectorAll(`.${ROW_MESSAGE_CLASS}`)).toHaveLength(1)
  })

  it('ignores a second click while one fetch is still running', async () => {
    // Two concurrent extractions would spend the ~110-request allowance
    // mid-flight and fail both.
    const doc = makeDoc()
    injectResultRowLinks({ document: doc })
    let release
    const sendMessage = vi.fn(() => new Promise((r) => { release = () => r({ type: 'extraction-complete' }) }))
    setupRowLinks({ document: doc, sendMessage })

    const links = [...doc.querySelectorAll(`.${ROW_LINK_CLASS}`)]
    links[0].click()
    links[1].click()
    expect(sendMessage).toHaveBeenCalledTimes(1)
    release()
  })

  it('offers no link on a team event, which has no pair scorecards to read', () => {
    const doc = makeDoc()
    injectResultRowLinks({ document: doc })
    const teamRow = [...doc.querySelectorAll('tr')].find((tr) =>
      tr.textContent.includes('Bracketed Teams')
    )
    expect(teamRow.querySelector(`.${ROW_LINK_CLASS}`)).toBeNull()
    // ...and the pair rows either side are unaffected.
    expect(doc.querySelectorAll(`.${ROW_LINK_CLASS}`)).toHaveLength(2)
  })

  it('skips team labels and lets everything else through', () => {
    // Deliberately exclusive rather than inclusive: an unrecognised label we
    // could actually read must not go silently unfetchable.
    for (const label of [
      'Bracketed Teams 2',
      'Swiss Teams',
      'Knockout',
      'Bracketed KO Teams',
      'GNT Open',           // Grand National Teams — says "teams" nowhere
      'Flight A GNT',
    ]) {
      expect(isTeamEventLabel(label)).toBe(true)
    }
    for (const label of [
      'Open Pairs',
      'MidFlight Pairs',
      'Individual',
      'Side Game',
      'NAP Flight B',       // North American PAIRS — same shape, opposite meaning
      '',
    ]) {
      expect(isTeamEventLabel(label)).toBe(false)
    }
  })

  it('passes other errors through unchanged', () => {
    expect(messageForError('parse-failed', 'boom')).toBe('boom')
    expect(messageForError('session-expired', 'boom')).toBe(SESSION_EXPIRED_MESSAGE)
  })
})


describe('tournament event lists', () => {
  // A trimmed slice of the real page — 12 of its 100 rows, chosen so the filter
  // has something to get wrong: Swiss Teams and Bracketed Round Robin Teams to
  // skip, Fast Pairs and Side Games to keep, and North American Pairs, which an
  // abbreviation-based filter would have thrown away. Its h1 is the host city,
  // so no player is knowable here.
  const html = readFileSync(
    resolve(here, '../../fixtures/acbl-live/tournament-events-NABC261.html'),
    'utf8'
  )

  beforeEach(() => { document.body.innerHTML = '' })

  function loadPage() {
    document.body.innerHTML = html
    const base = document.createElement('base')
    base.href = 'https://live.acbl.org/events/NABC261'
    document.body.prepend(base)
    return document
  }

  it('finds the rows, using the same markup as the player listings', () => {
    const doc = loadPage()
    expect(resultRows(doc)).toHaveLength(12)
  })

  it('skips the team events and links the rest', () => {
    const doc = loadPage()
    const added = injectResultRowLinks({ document: doc })
    const rows = resultRows(doc)
    const teams = rows.filter((r) => isTeamEventLabel(r.eventText))
    expect(teams).toHaveLength(4) // 2 Swiss Teams, 2 Bracketed Round Robin Teams
    expect(added).toBe(8)
    // Every linked row is one we can actually read.
    for (const a of doc.querySelectorAll(`.${ROW_LINK_CLASS}`)) {
      expect(isTeamEventLabel(a.closest('tr').textContent)).toBe(false)
    }
  })

  it('keeps North American Pairs, which an abbreviation filter would have lost', () => {
    const doc = loadPage()
    injectResultRowLinks({ document: doc })
    const linked = [...doc.querySelectorAll(`.${ROW_LINK_CLASS}`)].map(
      (a) => a.closest('tr').textContent
    )
    expect(linked.some((t) => /NORTH AMERICAN PAIRS/i.test(t))).toBe(true)
  })

  it('knows nobody, so a click has to ask which pair', () => {
    const doc = loadPage()
    // The heading is the host city, not a player.
    expect(readPlayerName(doc)).toBeNull()
  })

  it('asks for the pairs and shows the picker under the row', async () => {
    const doc = loadPage()
    injectResultRowLinks({ document: doc })
    const sent = []
    const sendMessage = vi.fn(async (msg) => {
      sent.push(msg)
      if (msg.type === 'list-event-pairs') {
        return {
          type: 'event-pairs',
          pairs: [
            { section: 'A', direction: 'NS', pair_number: 1, players_text: 'Ann Baker & Cy Dunn', url: '/a1' },
          ],
        }
      }
      return { type: 'extraction-complete' }
    })
    setupRowLinks({ document: doc, sendMessage })

    const link = doc.querySelector(`.${ROW_LINK_CLASS}`)
    link.click()
    await vi.waitFor(() => expect(doc.querySelector(`.${ROW_MESSAGE_CLASS}`)).not.toBeNull())
    expect(sent[0].type).toBe('list-event-pairs')

    // Choosing a pair extracts that pair's scorecard, not the summary.
    doc.querySelector(`.${ROW_MESSAGE_CLASS} button`).click()
    await vi.waitFor(() => expect(sent.length).toBe(2))
    expect(sent[1]).toMatchObject({ type: 'extract-session', url: '/a1' })
  })
})
