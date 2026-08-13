import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  shouldInject,
  buildButton,
  applyState,
  pickAnchor,
  handleClick,
  injectButton,
  injectResultRowLinks,
  setupRowLinks,
  readPlayerName,
  messageForError,
  ROW_LINK_CLASS,
  isTeamEventLabel,
  sortPairsForPicker,
  buildPairPicker,
  watchExtractionProgress,
  ROW_MESSAGE_CLASS,
  SESSION_EXPIRED_MESSAGE,
} from '../../src/ui/sourceContent.js'

describe('shouldInject', () => {
  it('returns true on pair-scorecard URLs', () => {
    expect(shouldInject('https://live.acbl.org/event/2604321/2501/2/scores/A/E/4')).toBe(true)
  })

  it('returns true on event-summary URLs (orchestrator resolves to a scorecard)', () => {
    expect(shouldInject('https://live.acbl.org/event/NABC261/08FP/2/summary')).toBe(true)
  })

  it('returns true on club-game-result URLs', () => {
    expect(shouldInject('https://my.acbl.org/club-results/details/1430335')).toBe(true)
  })

  it('returns false on board-detail pages', () => {
    expect(shouldInject('https://live.acbl.org/event/2604321/2501/2/board-detail/A')).toBe(false)
  })

  it('returns false on player-history pages, which get per-row links instead', () => {
    // A listing of sessions has nothing for a page-level button to extract.
    // Each row carries its own link — see injectResultRowLinks.
    expect(shouldInject('https://live.acbl.org/player-results/3506177')).toBe(false)
    expect(shouldInject('https://live.acbl.org/my-results')).toBe(false)
  })

  it('returns false on unrelated origins', () => {
    expect(shouldInject('https://example.com/anything')).toBe(false)
  })
})

describe('button helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('builds a button with the idle label', () => {
    const btn = buildButton(document)
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.id).toBe('bridge-classroom-analyze-btn')
    expect(btn.textContent).toMatch(/Analyze/i)
    expect(btn.disabled).toBe(false)
  })

  it('applies states: extracting, success, error, idle', () => {
    const btn = buildButton(document)
    applyState(btn, 'extracting')
    expect(btn.textContent).toMatch(/extracting/i)
    expect(btn.disabled).toBe(true)

    applyState(btn, 'success')
    expect(btn.textContent).toMatch(/opening/i)
    expect(btn.disabled).toBe(true)

    applyState(btn, 'error', 'boom')
    expect(btn.textContent).toMatch(/error: boom/i)
    expect(btn.disabled).toBe(false)

    applyState(btn, 'idle')
    expect(btn.textContent).toMatch(/Analyze/i)
    expect(btn.disabled).toBe(false)
  })

  it('picks the h4 anchor when present, else the body', () => {
    const h4 = document.createElement('h4')
    document.body.appendChild(h4)
    expect(pickAnchor(document)).toBe(h4)

    document.body.innerHTML = ''
    expect(pickAnchor(document)).toBe(document.body)
  })
})

describe('handleClick', () => {
  it('transitions idle → extracting → success → idle on extraction-complete', async () => {
    vi.useFakeTimers()
    try {
      const states = []
      await handleClick({
        url: 'https://live.acbl.org/x',
        sendMessage: vi.fn(async () => ({ type: 'extraction-complete', sid: 'abc' })),
        setState: (s, m) => states.push([s, m]),
      })
      // Immediately after the click resolves, we've shown success.
      expect(states.map((s) => s[0])).toEqual(['extracting', 'success'])
      // After the reset delay, the button returns to idle.
      await vi.advanceTimersByTimeAsync(2000)
      expect(states.map((s) => s[0])).toEqual(['extracting', 'success', 'idle'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('transitions to error on extraction-error', async () => {
    const states = []
    await handleClick({
      url: 'https://live.acbl.org/x',
      sendMessage: vi.fn(async () => ({
        type: 'extraction-error',
        error: { code: 'parse-failed', message: 'bad html' },
      })),
      setState: (s, m) => states.push([s, m]),
    })
    expect(states[1][0]).toBe('error')
    expect(states[1][1]).toBe('bad html')
  })

  it('transitions to error if sendMessage throws', async () => {
    const states = []
    await handleClick({
      url: 'https://live.acbl.org/x',
      sendMessage: vi.fn(async () => {
        throw new Error('disconnected')
      }),
      setState: (s, m) => states.push([s, m]),
    })
    expect(states[1][0]).toBe('error')
    expect(states[1][1]).toBe('disconnected')
  })
})

describe('injectButton', () => {
  const SCORECARD_URL = 'https://live.acbl.org/event/1/2/3/scores/A/E/4'
  const CLUB_URL = 'https://my.acbl.org/club-results/details/1430335'

  it('injects into ul.navbar-nav on my.acbl.org once Vue has mounted', () => {
    document.body.innerHTML =
      '<nav><div class="container"><ul class="navbar-nav d-flex flex-row gap-5"><li><a href="/login">Login</a></li></ul></div></nav>'
    const btn = injectButton({
      document,
      location: { href: CLUB_URL },
      sendMessage: vi.fn(),
    })
    expect(btn).not.toBeNull()
    // Button is inside a new <li> appended to the navbar ul — not fixed.
    expect(btn.style.position).toBe('')
    const ul = document.querySelector('ul.navbar-nav')
    expect(btn.parentElement.tagName).toBe('LI')
    expect(btn.parentElement.parentElement).toBe(ul)
    expect(ul.children).toHaveLength(2)
  })

  it('returns null on my.acbl.org when Vue has not yet mounted the navbar', () => {
    document.body.innerHTML = '<div id="app"></div>'
    const btn = injectButton({
      document,
      location: { href: CLUB_URL },
      sendMessage: vi.fn(),
    })
    expect(btn).toBeNull()
  })

  it('wraps the h1 in a flex row and right-justifies the button', () => {
    document.body.innerHTML =
      '<h1>Apr 25, 2026 - Saturday 2:30 pm</h1><h4>4EW - Rick &amp; Andrew</h4>'
    const btn = injectButton({
      document,
      location: { href: SCORECARD_URL },
      sendMessage: vi.fn(),
    })
    expect(btn).not.toBeNull()
    const h1 = document.querySelector('h1')
    const wrapper = h1.parentElement
    expect(wrapper.tagName).toBe('DIV')
    expect(wrapper.style.display).toBe('flex')
    expect(wrapper.style.justifyContent).toBe('space-between')
    // h1 leftmost; button + cancel-X grouped on the right edge.
    expect(wrapper.firstElementChild).toBe(h1)
    const btnGroup = wrapper.lastElementChild
    expect(btnGroup.tagName).toBe('DIV')
    expect(btnGroup.contains(btn)).toBe(true)
  })

  it('falls back to inserting after h4 when no h1 is present', () => {
    document.body.innerHTML = '<h4>4EW - Rick &amp; Andrew</h4>'
    const btn = injectButton({
      document,
      location: { href: SCORECARD_URL },
      sendMessage: vi.fn(),
    })
    expect(btn).not.toBeNull()
    const h4 = document.querySelector('h4')
    expect(h4.nextElementSibling).toBe(btn)
  })

  it('does nothing on board-detail pages', () => {
    document.body.innerHTML = '<h1>Board 1</h1>'
    const btn = injectButton({
      document,
      location: { href: 'https://live.acbl.org/event/2604321/2501/2/board-detail/A' },
      sendMessage: vi.fn(),
    })
    expect(btn).toBeNull()
    expect(document.getElementById('bridge-classroom-analyze-btn')).toBeNull()
  })

  it('is idempotent — does not double-inject', () => {
    document.body.innerHTML = '<h1>Apr 25</h1>'
    const opts = {
      document,
      location: { href: SCORECARD_URL },
      sendMessage: vi.fn(),
    }
    const a = injectButton(opts)
    const b = injectButton(opts)
    expect(a).toBe(b)
    expect(document.querySelectorAll('#bridge-classroom-analyze-btn')).toHaveLength(1)
  })
})

describe('hands-list header injection', () => {
  // The real page: two full-width header rows above an 11-column body. Kept in
  // sync with fixtures/bbo/hands-list-81382-kemistry.html.
  const HANDS_URL =
    'https://www.bridgebase.com/myhands/hands.php?tourney=81382-1777478400&username=kemistry'

  function handsListPage(totalCols = 11) {
    const heads = Array.from({ length: totalCols }, (_, i) => `<th>c${i}</th>`).join('')
    document.body.innerHTML = `
      <table class="body">
        <tr><th colspan="${totalCols}">Tourney 81382 - played by kemistry</th></tr>
        <tr><th colspan="${totalCols}">2026-04-29</th></tr>
        <tr>${heads}</tr>
        <tr class="tourney"><td>1</td></tr>
      </table>`
    return document.querySelector('table.body')
  }

  const opts = () => ({ document, location: { href: HANDS_URL }, sendMessage: vi.fn() })

  it('merges the right third of the two header rows into one cell', () => {
    const table = handsListPage()
    const btn = injectButton(opts())

    expect(btn.closest('th').id).toBe('bridge-classroom-header-cell')
    expect(table.rows[0].cells[0].getAttribute('colspan')).toBe('7')
    expect(table.rows[1].cells[0].getAttribute('colspan')).toBe('7')

    const cell = table.rows[0].cells[1]
    expect(cell.getAttribute('colspan')).toBe('4')
    expect(cell.getAttribute('rowspan')).toBe('2')
    // 7 + 4 must still equal the body's column count, or the table skews.
    expect(table.rows[2].cells).toHaveLength(11)
  })

  it('inherits the table\'s typeface instead of imposing its own', () => {
    handsListPage()
    const btn = injectButton(opts())
    expect(btn.style.fontFamily).toBe('inherit')
    expect(btn.style.fontSize).toBe('inherit')
    expect(btn.style.position).not.toBe('fixed')
  })

  it('re-splits from the original width, not the width it left behind', () => {
    // A re-render can drop our cell while leaving the narrowed colspans. Without
    // remembering the original 11 the next split would compound to 5 + 2.
    const table = handsListPage()
    injectButton(opts())
    document.getElementById('bridge-classroom-header-cell').remove()
    document.getElementById('bridge-classroom-analyze-btn')?.remove()

    injectButton(opts())
    expect(table.rows[0].cells[0].getAttribute('colspan')).toBe('7')
    expect(table.rows[0].cells[1].getAttribute('colspan')).toBe('4')
  })

  it('falls back to the overlay rather than losing the button', () => {
    // Only one header row — not the shape we know how to split.
    document.body.innerHTML = `
      <table class="body">
        <tr><th colspan="11">Tourney</th></tr>
        <tr><td>1</td></tr>
        <tr><td>2</td></tr>
      </table>`
    const btn = injectButton(opts())
    expect(btn).not.toBeNull()
    expect(btn.style.position).toBe('fixed')
  })
})

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

describe('event-summary pair picker', () => {
  // Deliberately out of order, and across two sections, so both the grouping
  // and the sorting have to do real work.
  const PAIRS = [
    { section: 'D', direction: 'NS', pair_number: 2, players_text: 'Zoe Adams & Bob Carter', url: '/d2' },
    { section: 'A', direction: 'EW', pair_number: 4, players_text: 'Rick Wilson & Andrew Rowberg', url: '/a4' },
    { section: 'A', direction: 'NS', pair_number: 1, players_text: 'Ann Baker & Cy Dunn', url: '/a1' },
    { section: 'D', direction: 'EW', pair_number: 7, players_text: 'Al Young & Mia Zhu', url: '/d7' },
  ]

  beforeEach(() => { document.body.innerHTML = '' })

  it('groups by section and sorts names alphabetically within each', () => {
    const grouped = sortPairsForPicker(PAIRS)
    expect(grouped.map((g) => g.section)).toEqual(['A', 'D'])
    expect(grouped[0].entries.map((e) => e.players_text)).toEqual([
      'Ann Baker & Cy Dunn',
      'Rick Wilson & Andrew Rowberg',
    ])
    // Alphabetical by name, not by pair number: D7 sorts above D2.
    expect(grouped[1].entries.map((e) => e.pair_number)).toEqual([7, 2])
  })

  it('renders a section heading per section and a row per pair', () => {
    const picker = buildPairPicker(document, PAIRS, () => {})
    document.body.appendChild(picker)
    const text = picker.textContent
    expect(text).toContain('Section A')
    expect(text).toContain('Section D')
    const items = picker.querySelectorAll('button')
    expect(items).toHaveLength(4)
    // Direction and number stay visible so the choice can be checked against
    // the page behind it.
    expect(items[0].textContent).toBe('NS1 — Ann Baker & Cy Dunn')
  })

  it('hands back the chosen pair, whose url is the ordinary scorecard entry', () => {
    const chosen = []
    const picker = buildPairPicker(document, PAIRS, (p) => chosen.push(p))
    document.body.appendChild(picker)
    ;[...picker.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Rick Wilson'))
      .click()
    expect(chosen).toHaveLength(1)
    expect(chosen[0].url).toBe('/a4')
  })

  it('survives a pair with no section rather than dropping it', () => {
    const grouped = sortPairsForPicker([{ players_text: 'Nemo', pair_number: 1 }])
    expect(grouped).toHaveLength(1)
    expect(grouped[0].entries).toHaveLength(1)
  })
})

describe('extraction progress', () => {
  function makeStorage(entries = {}) {
    return { get: vi.fn(async (k) => (k in entries ? { [k]: entries[k] } : {})) }
  }

  beforeEach(() => { document.body.innerHTML = '' })

  it('reports a percentage as boards land', async () => {
    const storage = makeStorage({
      'extract-progress:abc': { done: 13, total: 52, stored_at: Date.now() },
    })
    const seen = []
    const stop = watchExtractionProgress('abc', (pct, done, total) => seen.push([pct, done, total]), storage, 5)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))
    stop()
    expect(seen[0]).toEqual([25, 13, 52])
  })

  it('stops polling once told to, so a finished fetch leaves no timer behind', async () => {
    const storage = makeStorage({ 'extract-progress:abc': { done: 1, total: 4 } })
    const stop = watchExtractionProgress('abc', () => {}, storage, 5)
    await vi.waitFor(() => expect(storage.get).toHaveBeenCalled())
    stop()
    const callsAtStop = storage.get.mock.calls.length
    await new Promise((r) => setTimeout(r, 30))
    expect(storage.get.mock.calls.length).toBe(callsAtStop)
  })

  it('says nothing until a total is known, rather than showing 0%', async () => {
    const storage = makeStorage({ 'extract-progress:abc': { done: 0, total: 0 } })
    const seen = []
    const stop = watchExtractionProgress('abc', (p) => seen.push(p), storage, 5)
    await vi.waitFor(() => expect(storage.get).toHaveBeenCalled())
    stop()
    expect(seen).toEqual([])
  })

  it('sends a progress key with the row-link extraction', async () => {
    document.body.innerHTML = `
      <base href="https://live.acbl.org/my-results">
      <h1>Rick Wilson's Results</h1>
      <table><thead><tr><th>Date</th><th>Event</th><th>Links</th></tr></thead><tbody>
        <tr><td>06/27</td><td>Open Pairs</td>
            <td class="links"><a class="summary" href="/event/1/2/1/summary">Summary</a></td></tr>
      </tbody></table>`
    injectResultRowLinks({ document })
    const sendMessage = vi.fn(async () => ({ type: 'extraction-complete' }))
    setupRowLinks({ document, sendMessage, storage: makeStorage() })
    document.querySelector(`.${ROW_LINK_CLASS}`).click()
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled())
    expect(sendMessage.mock.calls[0][0].progressKey).toEqual(expect.any(String))
  })
})

describe('handleClick progress', () => {
  it('shows a climbing percentage while a single extraction runs', async () => {
    const storage = {
      get: vi.fn(async (k) => ({ [k]: { done: 26, total: 52 } })),
    }
    const states = []
    let resolve
    const sendMessage = vi.fn(() => new Promise((r) => { resolve = r }))
    const click = handleClick({
      url: 'https://live.acbl.org/event/1/2/3/scores/A/E/4',
      sendMessage,
      storage,
      setState: (s, m) => states.push([s, m]),
    })
    await vi.waitFor(() => expect(states.some((s) => s[1]?.includes('50%'))).toBe(true))
    resolve({ type: 'extraction-complete' })
    await click
    // And it stops once the extraction is done, rather than polling forever.
    const callsAtEnd = storage.get.mock.calls.length
    await new Promise((r) => setTimeout(r, 400))
    expect(storage.get.mock.calls.length).toBe(callsAtEnd)
  })

  it('works without storage — progress is an enhancement, not a dependency', async () => {
    const states = []
    await handleClick({
      url: 'https://live.acbl.org/x',
      sendMessage: vi.fn(async () => ({ type: 'extraction-complete' })),
      setState: (s, m) => states.push([s, m]),
    })
    expect(states.map((s) => s[0])).toContain('success')
  })
})
