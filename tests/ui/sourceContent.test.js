import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  shouldInject,
  buildButton,
  applyState,
  pickAnchor,
  handleClick,
  injectButton,
} from '../../src/ui/sourceContent.js'

describe('shouldInject', () => {
  it('returns true on pair-scorecard URLs', () => {
    expect(shouldInject('https://live.acbl.org/event/2604321/2501/2/scores/A/E/4')).toBe(true)
  })

  it('returns false on board-detail and player-history pages', () => {
    expect(shouldInject('https://live.acbl.org/event/2604321/2501/2/board-detail/A')).toBe(false)
    expect(shouldInject('https://live.acbl.org/player-results/3506177')).toBe(false)
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
  it('transitions idle → extracting → success on extraction-complete', async () => {
    const states = []
    await handleClick({
      url: 'https://live.acbl.org/x',
      sendMessage: vi.fn(async () => ({ type: 'extraction-complete', sid: 'abc' })),
      setState: (s, m) => states.push([s, m]),
    })
    expect(states.map((s) => s[0])).toEqual(['extracting', 'success'])
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
    // h1 still leftmost, button rightmost — no extra row added.
    expect(wrapper.firstElementChild).toBe(h1)
    expect(wrapper.lastElementChild).toBe(btn)
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

  it('does nothing on non-scorecard pages', () => {
    document.body.innerHTML = '<h1>Apr 25</h1><h4>4EW</h4>'
    const btn = injectButton({
      document,
      location: { href: 'https://live.acbl.org/player-results/123' },
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
