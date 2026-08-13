import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
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
  PAIR_FILTER_CLASS,
  watchExtractionProgress,
  ROW_MESSAGE_CLASS,
  resultRows,
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

  it('sorts by name across the whole event, not section by section', () => {
    // The point of the flat list: someone hunting for a student does not know
    // which section that student is in, and should not have to scan each one.
    // A-names and D-names interleave.
    expect(sortPairsForPicker(PAIRS).map((e) => e.players_text)).toEqual([
      'Al Young & Mia Zhu',            // D
      'Ann Baker & Cy Dunn',           // A
      'Rick Wilson & Andrew Rowberg',  // A
      'Zoe Adams & Bob Carter',        // D
    ])
  })

  it('sorts case-insensitively, so upper-cased names do not clump', () => {
    const mixed = [
      { players_text: 'zoe adams', section: 'A' },
      { players_text: 'ANN BAKER', section: 'A' },
      { players_text: 'Mia Zhu', section: 'A' },
    ]
    expect(sortPairsForPicker(mixed).map((e) => e.players_text)).toEqual([
      'ANN BAKER',
      'Mia Zhu',
      'zoe adams',
    ])
  })

  it('renders one flat row per pair, name first and location trailing', () => {
    const picker = buildPairPicker(document, PAIRS, () => {})
    document.body.appendChild(picker)
    const items = [...picker.querySelectorAll('button')]
    expect(items).toHaveLength(4)
    // No section headings to scroll past.
    expect(picker.textContent).not.toContain('Section A')
    // Name leads, because that is what is being scanned.
    expect(items[0].firstChild.textContent).toBe('Al Young & Mia Zhu')
    // Location still shown, so the choice can be checked against the page.
    expect(items[0].lastChild.textContent).toBe('D-EW7')
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
    const sorted = sortPairsForPicker([{ players_text: 'Nemo', pair_number: 1 }])
    expect(sorted).toHaveLength(1)
    const picker = buildPairPicker(document, sorted, () => {})
    expect(picker.querySelectorAll('button')).toHaveLength(1)
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

describe('pair picker filter', () => {
  const PAIRS = [
    { section: 'A', direction: 'NS', pair_number: 1, players_text: 'John Jones & Bob Smith', url: '/a1' },
    { section: 'A', direction: 'EW', pair_number: 4, players_text: 'Rick Wilson & Andrew Rowberg', url: '/a4' },
    { section: 'D', direction: 'NS', pair_number: 2, players_text: "Mary O'Brien & Sue Chen", url: '/d2' },
  ]

  function open(onSelect = () => {}) {
    document.body.innerHTML = ''
    const picker = buildPairPicker(document, PAIRS, onSelect)
    document.body.appendChild(picker)
    return { picker, filter: picker.querySelector(`.${PAIR_FILTER_CLASS}`) }
  }

  const visible = (picker) =>
    [...picker.querySelectorAll('button')].filter((b) => b.style.display !== 'none')

  it('finds a player listed second in their pair', () => {
    // The gap sorting alone cannot close: alphabetical order files this pair
    // under "John", so a search for the student is the only way to reach them.
    const { picker, filter } = open()
    filter.value = 'smith'
    filter.dispatchEvent(new Event('input'))
    expect(visible(picker)).toHaveLength(1)
    expect(visible(picker)[0].textContent).toContain('Bob Smith')
  })

  it('ignores case and punctuation', () => {
    // Punctuation is removed, not replaced with a space: substituting turns
    // "O'Brien" into "o brien", which fails the exact query it exists to serve.
    for (const q of ['obrien', "O'BRIEN", 'OBrien']) {
      const { picker, filter } = open()
      filter.value = q
      filter.dispatchEvent(new Event('input'))
      expect(visible(picker), `query ${q}`).toHaveLength(1)
    }
  })

  it('matches the section and pair number too', () => {
    const { picker, filter } = open()
    filter.value = 'EW4'
    filter.dispatchEvent(new Event('input'))
    expect(visible(picker)).toHaveLength(1)
    expect(visible(picker)[0].textContent).toContain('Rick Wilson')
  })

  it('restores the full list when the box is cleared', () => {
    const { picker, filter } = open()
    filter.value = 'smith'
    filter.dispatchEvent(new Event('input'))
    filter.value = ''
    filter.dispatchEvent(new Event('input'))
    expect(visible(picker)).toHaveLength(3)
  })

  it('says so when nothing matches, rather than showing an empty box', () => {
    const { picker, filter } = open()
    filter.value = 'nobody'
    filter.dispatchEvent(new Event('input'))
    expect(visible(picker)).toHaveLength(0)
    expect(picker.textContent).toContain('No one by that name')
  })

  it('picks the pair on Enter once exactly one is left', () => {
    const chosen = []
    const { filter } = open((p) => chosen.push(p))
    filter.value = 'wilson'
    filter.dispatchEvent(new Event('input'))
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(chosen).toHaveLength(1)
    expect(chosen[0].url).toBe('/a4')
  })

  it('does nothing on Enter while the choice is still ambiguous', () => {
    const chosen = []
    const { filter } = open((p) => chosen.push(p))
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(chosen).toEqual([])
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
