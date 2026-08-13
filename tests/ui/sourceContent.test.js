import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  shouldInject,
  buildButton,
  applyState,
  pickAnchor,
  handleClick,
  injectButton,
} from '../../src/ui/sourceContent.js'

const here = dirname(fileURLToPath(import.meta.url))

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
