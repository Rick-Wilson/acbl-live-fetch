import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { classifyPage, matchesUrl, extractSession, buildHandviewerEnvelope } from '../../../src/adapters/bbo/index.js'
import { parseLinPlayers, deriveContract } from '../../../src/adapters/bbo/parsers/lin.js'
import {
  shouldInject,
  pickInjectionStrategy,
  injectButton,
  placeAtRowEnd,
  CANCEL_BUTTON_ID,
} from '../../../src/ui/sourceContent.js'

// The user's real URL: a passed-out board 7, LIN inline.
const PASSED_OUT_URL =
  'https://www.bridgebase.com/tools/handviewer.html?bbo=y&lin=pn|bassenbill,stevew13,archin3531,zapnow|' +
  'st%7C%7Cmd%7C1S468AH4KD378JQC49%2CS279QKH38TJD6AC38%2CS3TJH79QD49C7TJQK%2C%7Crh%7C%7Cah%7CBoard%207%7Csv%7Cb%7C' +
  'mb%7Cp%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7Cp%7C'

const now = () => '2026-08-07T00:00:00.000Z'

describe('handviewer page type', () => {
  it('recognises the hand viewer', () => {
    expect(matchesUrl(PASSED_OUT_URL)).toBe(true)
    expect(classifyPage(PASSED_OUT_URL)).toBe('handviewer')
  })

  it('recognises the myhand= form too', () => {
    expect(classifyPage('https://www.bridgebase.com/tools/handviewer.html?bbo=y&myhand=M-4700063665-1785550200'))
      .toBe('handviewer')
  })

  it('ignores a hand viewer with no deal in it', () => {
    expect(classifyPage('https://www.bridgebase.com/tools/handviewer.html')).toBe('unknown')
  })

  it('injects the button there', () => {
    expect(shouldInject(PASSED_OUT_URL)).toBe(true)
  })

  // Every corner of the hand viewer is taken: the auction occupies top-right
  // where the fixed overlay would land, BBO's own controls run along the
  // bottom, and BBO Helper draws a double-dummy table bottom-left. The control
  // row is the one place that collides with none of them.
  it('joins the control row rather than floating over the auction', () => {
    expect(pickInjectionStrategy(PASSED_OUT_URL)).toBe('button-row')
  })

  it('still uses the overlay on other BBO pages', () => {
    expect(pickInjectionStrategy('https://www.bridgebase.com/myhands/hands.php?tourney=1-2&username=x'))
      .toBe('overlay')
    expect(pickInjectionStrategy('https://webutil.bridgebase.com/v2/tview.php?t=1-2&u=x'))
      .toBe('overlay')
  })
})

describe('button-row injection', () => {
  // BBO's controls are <input type="button">, not <button>.
  function pageWithControlRow() {
    const dom = new JSDOM(
      '<!doctype html><body><div id="buttonDiv"><input type="button" class="buttonStyle" value="Rewind"></div></body>',
      { url: 'https://www.bridgebase.com/' }
    )
    return dom.window.document
  }

  // BBO styles its row with `input.buttonStyle` — element-qualified — so a
  // <button> carrying that class matches nothing and stays position:static,
  // silently ignoring the left we compute. Position has to be set directly.
  it('positions itself absolutely rather than relying on BBO\'s class', () => {
    const doc = pageWithControlRow()
    const btn = injectButton({ document: doc, location: { href: PASSED_OUT_URL }, sendMessage: () => {} })
    const sib = doc.querySelector('input.buttonStyle')
    Object.defineProperty(sib, 'offsetLeft', { value: 10 })
    Object.defineProperty(sib, 'offsetWidth', { value: 90 })
    placeAtRowEnd(doc.getElementById('buttonDiv'), btn, undefined, { log: () => {} })
    expect(btn.style.position).toBe('absolute')
    expect(btn.style.left).toBe('114px')
  })

  // injectButton already wires the placement, and the re-injection observer can
  // call it again. A second set of observers with a different gap would leave
  // the two writing over each other forever.
  it('wires its observers only once per button', () => {
    const doc = pageWithControlRow()
    const row = doc.getElementById('buttonDiv')
    const btn = injectButton({ document: doc, location: { href: PASSED_OUT_URL }, sendMessage: () => {} })
    const sib = doc.querySelector('input.buttonStyle')
    Object.defineProperty(sib, 'offsetLeft', { value: 10 })
    Object.defineProperty(sib, 'offsetWidth', { value: 90 })

    let created = 0
    doc.defaultView.ResizeObserver = class { constructor() { created++ } observe() {} }
    placeAtRowEnd(row, btn, 8, { log: () => {} })
    placeAtRowEnd(row, btn, 8, { log: () => {} })
    expect(created).toBe(0)   // already wired by injectButton
  })

  it('appends into #buttonDiv, styled like its siblings', () => {
    const doc = pageWithControlRow()
    const btn = injectButton({ document: doc, location: { href: PASSED_OUT_URL }, sendMessage: () => {} })
    expect(btn).not.toBeNull()
    expect(btn.parentElement.id).toBe('buttonDiv')
    // Our own chrome is stripped so the button matches its neighbours.
    expect(btn.style.background).toBe('')
    expect(btn.style.border).toBe('')
    expect(btn.style.borderRadius).toBe('')
    // BBO's own `padding-left: 2` is unit-less and therefore ignored, so their
    // controls sit at the browser default; ours gets a little more room.
    expect(btn.style.paddingLeft).toBe('12px')
    expect(btn.style.paddingRight).toBe('12px')
  })

  // "Analyze" is wrong for one deal — it goes to double-dummy, and the ingest
  // page picks the tool regardless.
  it('is labelled for the hand viewer, not the analyzer', () => {
    const doc = pageWithControlRow()
    const btn = injectButton({ document: doc, location: { href: PASSED_OUT_URL }, sendMessage: () => {} })
    expect(btn.textContent).toBe('Bridge Classroom')
  })

  it('adds no cancel button — a single deal is instant', () => {
    const doc = pageWithControlRow()
    injectButton({ document: doc, location: { href: PASSED_OUT_URL }, sendMessage: () => {} })
    expect(doc.getElementById(CANCEL_BUTTON_ID)).toBeNull()
  })

  it('returns null when the row has not rendered yet, so the observer retries', () => {
    const dom = new JSDOM('<!doctype html><body></body>')
    expect(injectButton({ document: dom.window.document, location: { href: PASSED_OUT_URL }, sendMessage: () => {} }))
      .toBeNull()
  })

  it('does not add a second button on re-injection', () => {
    const doc = pageWithControlRow()
    const loc = { href: PASSED_OUT_URL }
    injectButton({ document: doc, location: loc, sendMessage: () => {} })
    injectButton({ document: doc, location: loc, sendMessage: () => {} })
    expect(doc.querySelectorAll('#buttonDiv button').length).toBe(1) // just ours
  })

  // BBO positions its controls absolutely and assigns each a `left` in JS, so
  // an appended button with no left of its own sits at 0 — on top of Rewind.
  describe('placeAtRowEnd', () => {
    const rowWith = (widths) => {
      const dom = new JSDOM('<!doctype html><body><div id="r"></div></body>')
      const row = dom.window.document.getElementById('r')
      widths.forEach(([left, width]) => {
        const b = dom.window.document.createElement('button')
        Object.defineProperty(b, 'offsetLeft', { value: left })
        Object.defineProperty(b, 'offsetWidth', { value: width })
        row.appendChild(b)
      })
      const ours = dom.window.document.createElement('button')
      row.appendChild(ours)
      return { row, ours }
    }

    // BBO scales its controls' type to the viewport, so an inserted button that
    // keeps the default size reads as visibly smaller than its neighbours.
    it('copies the type size and vertical placement of a sibling', () => {
      const dom = new JSDOM('<!doctype html><body><div id="r"></div></body>')
      const { document: d, window: w } = dom.window.document.defaultView
        ? { document: dom.window.document, window: dom.window }
        : {}
      const row = d.getElementById('r')
      const sib = d.createElement('button')
      Object.defineProperty(sib, 'offsetLeft', { value: 10 })
      Object.defineProperty(sib, 'offsetWidth', { value: 90 })
      sib.style.fontSize = '28px'
      sib.style.top = '6px'
      row.appendChild(sib)
      const ours = d.createElement('button')
      row.appendChild(ours)

      w.getComputedStyle = () => ({ fontSize: '28px', fontFamily: 'arial', top: '6px', height: '40px' })
      placeAtRowEnd(row, ours)

      expect(ours.style.fontSize).toBe('28px')
      expect(ours.style.top).toBe('6px')
      expect(ours.style.left).toBe('114px')
    })

    it('sits past the rightmost sibling', () => {
      const { row, ours } = rowWith([[0, 60], [70, 80], [160, 50]])
      placeAtRowEnd(row, ours)
      expect(ours.style.left).toBe('224px')   // 160 + 50 + 14
    })

    it('ignores its own width when measuring', () => {
      const { row, ours } = rowWith([[0, 60]])
      Object.defineProperty(ours, 'offsetLeft', { value: 999 })
      Object.defineProperty(ours, 'offsetWidth', { value: 999 })
      placeAtRowEnd(row, ours)
      expect(ours.style.left).toBe('74px')
    })

    // Before layout every offset is 0. Setting left:0 then would stack us on
    // the first control, which is the bug this whole function exists to avoid.
    it('leaves the button alone when nothing has been laid out yet', () => {
      const { row, ours } = rowWith([[0, 0], [0, 0]])
      placeAtRowEnd(row, ours)
      expect(ours.style.left).toBe('')
    })

    // Real numbers from the live page: BBO's six controls end at 414+55=469,
    // and the row also contains a whitespace node with zero dimensions.
    it('places correctly against the real hand viewer row', () => {
      const { row, ours } = rowWith([[7, 81], [98, 92], [199, 57], [266, 83], [359, 45], [414, 55], [0, 0]])
      placeAtRowEnd(row, ours)
      expect(ours.style.left).toBe('483px')
    })

    // The viewer finishes laying out after we inject. Watching each control's
    // own geometry catches that; watching the container did not.
    it('places once a control reports real dimensions', () => {
      const dom = new JSDOM('<!doctype html><body><div id="r"></div></body>')
      const d = dom.window.document
      const row = d.getElementById('r')
      const sib = d.createElement('button')
      let left = 0, width = 0
      Object.defineProperty(sib, 'offsetLeft', { get: () => left })
      Object.defineProperty(sib, 'offsetWidth', { get: () => width })
      row.appendChild(sib)
      const ours = d.createElement('button')
      row.appendChild(ours)

      const callbacks = []
      dom.window.ResizeObserver = class {
        constructor(cb) { callbacks.push(cb) }
        observe() {}
      }
      placeAtRowEnd(row, ours, 8, { log: () => {} })
      expect(ours.style.left).toBe('')          // nothing laid out yet

      callbacks.forEach((cb) => cb())           // fires while still unsized
      expect(ours.style.left).toBe('')

      left = 300; width = 60                    // the control gets its geometry
      callbacks.forEach((cb) => cb())
      expect(ours.style.left).toBe('368px')
    })

    it('watches each control rather than the container', () => {
      const dom = new JSDOM('<!doctype html><body><div id="r"></div></body>', { url: 'https://www.bridgebase.com/' })
      const d = dom.window.document
      const row = d.getElementById('r')
      const a = d.createElement('button'); const b = d.createElement('button')
      row.appendChild(a); row.appendChild(b)
      const ours = d.createElement('button'); row.appendChild(ours)

      const observed = []
      dom.window.ResizeObserver = class {
        constructor() {}
        observe(el) { observed.push(el) }
      }
      placeAtRowEnd(row, ours, 8, { log: () => {} })
      expect(observed).toContain(a)
      expect(observed).toContain(b)
      expect(observed).not.toContain(ours)
      expect(observed).not.toContain(row)
    })
  })
})

describe('parseLinPlayers', () => {
  // pn| order is South, West, North, East — confirmed against a hands list
  // whose traveller names each seat, and against BBO's own rendering.
  it('maps seats in South, West, North, East order', () => {
    expect(parseLinPlayers('pn|bassenbill,stevew13,archin3531,zapnow|st||md|3S4|'))
      .toEqual({ S: 'bassenbill', W: 'stevew13', N: 'archin3531', E: 'zapnow' })
  })

  it('returns null when the LIN has no pn| token', () => {
    expect(parseLinPlayers('st||md|3S4|')).toBeNull()
  })

  it('nulls seats the LIN leaves blank', () => {
    expect(parseLinPlayers('pn|a,,c,|')).toEqual({ S: 'a', W: null, N: 'c', E: null })
  })
})

describe('deriveContract', () => {
  it('returns nulls for a passed-out board', () => {
    expect(deriveContract(['PASS', 'PASS', 'PASS', 'PASS'], 'S')).toEqual({ contract: null, declarer: null })
  })

  // The mistake worth guarding: declarer is whoever named the strain FIRST for
  // the declaring side, not whoever made the final bid.
  it('credits the partner who first named the strain', () => {
    // N opens 1S, E overcalls 2H, S raises to 4S. North declares.
    expect(deriveContract(['1S', '2H', '4S', 'PASS', 'PASS', 'PASS'], 'N'))
      .toEqual({ contract: '4S', declarer: 'N' })
  })

  it('handles a simple auction where the last bidder declares', () => {
    expect(deriveContract(['PASS', '1NT', 'PASS', '3NT', 'PASS', 'PASS', 'PASS'], 'N'))
      .toEqual({ contract: '3NT', declarer: 'E' })
  })

  it('carries a double through to the contract', () => {
    expect(deriveContract(['4S', 'X', 'PASS', 'PASS', 'PASS'], 'N').contract).toBe('4SX')
    expect(deriveContract(['4S', 'X', 'XX', 'PASS', 'PASS', 'PASS'], 'N').contract).toBe('4SXX')
  })

  it('drops a double that a later bid wiped out', () => {
    expect(deriveContract(['1S', 'X', '2H', 'PASS', 'PASS', 'PASS'], 'N').contract).toBe('2H')
  })
})

describe('buildHandviewerEnvelope', () => {
  const lin = decodeURIComponent(new URL(PASSED_OUT_URL).searchParams.get('lin'))
  const env = buildHandviewerEnvelope(PASSED_OUT_URL, lin, { now })
  const board = env.tournaments[0].events[0].sessions[0].boards[0]

  it('reads the board number from the ah| label', () => {
    expect(board.number).toBe(7)
  })

  it('seats the players as BBO renders them', () => {
    // Seat order, not a list: [N, S] and [W, E]. See docs/normalized-schema.md.
    expect(board.results[0].ns_pair.players.map((p) => p.name)).toEqual(['archin3531', 'bassenbill'])
    expect(board.results[0].ew_pair.players.map((p) => p.name)).toEqual(['stevew13', 'zapnow'])
  })

  it('records a passed-out board as such rather than failing', () => {
    expect(board.results[0].contract).toBeNull()
    expect(board.results[0].declarer).toBeNull()
    expect(board.results[0].play).toBeNull()
  })

  it('still carries the deal and dealer', () => {
    expect(board.dealer).toBe('S')
    expect(board.vulnerability).toBe('Both')
    // Ascending, because parseHand preserves LIN's own order. BBO renders this
    // hand as J103.
    expect(board.deal.N.S).toEqual(['3', '10', 'J'])
  })

  // Pre-existing quirk, pinned so it's visible rather than surprising: the
  // three hands LIN states explicitly keep its ascending order, but the fourth
  // is *computed* as the remainder via ALL_RANKS, which is descending. One deal
  // object can therefore carry both orders. Consumers should sort, not assume.
  it('computes the fourth hand in the opposite order to the stated three', () => {
    expect(board.deal.N.H).toEqual(['7', '9', 'Q'])        // stated, ascending
    expect(board.deal.E.H).toEqual(['A', '6', '5', '2'])   // computed, descending
  })

  it('declares a single-table coverage with no field', () => {
    expect(env.coverage).toMatchObject({
      cardplay: 'user-table',
      results: 'user-table',
      sections: 'not-applicable',
      player_names: 'usernames',
    })
  })
})

// A full board: 1S by East, all 52 cards played.
const PLAYED_URL =
  'https://www.bridgebase.com/tools/handviewer.html?v3b=web&v3v=6.60.1&lin=' +
  'pn%7CFairways4%2Caam135%2Cbrosh%2Ckemistry%7Cst%7C%7Cmd%7C4ST543HQT73DAJ875C%2C' +
  'S976H92DT3CJ87432%2CSQHAJ64DQ94CKQT65%2CSAKJ82HK85DK62CA9%7Csv%7Cn%7Crh%7C%7C' +
  'ah%7CBoard+2%7Cmb%7C1S%7Cmb%7CP%7Cmb%7CP%7Cmb%7CP%7C' +
  'pc%7CDA%7Cpc%7CD3%7Cpc%7CD4%7Cpc%7CD6%7Cpc%7CD5%7Cpc%7CDT%7Cpc%7CDQ%7Cpc%7CDK%7C' +
  'pc%7CD2%7Cpc%7CD7%7Cpc%7CS6%7Cpc%7CD9%7Cpc%7CH2%7Cpc%7CHA%7Cpc%7CH8%7Cpc%7CH3%7C' +
  'pc%7CC5%7Cpc%7CCA%7Cpc%7CS3%7Cpc%7CC2%7Cpc%7CH7%7Cpc%7CH9%7Cpc%7CHJ%7Cpc%7CHK%7C' +
  'pc%7CH5%7Cpc%7CHT%7Cpc%7CS7%7Cpc%7CH4%7Cpc%7CS9%7Cpc%7CSQ%7Cpc%7CSA%7Cpc%7CS4%7C' +
  'pc%7CSK%7Cpc%7CS5%7Cpc%7CC3%7Cpc%7CH6%7Cpc%7CSJ%7Cpc%7CST%7Cpc%7CC4%7Cpc%7CC6%7C' +
  'pc%7CS8%7Cpc%7CD8%7Cpc%7CC7%7Cpc%7CCT%7Cpc%7CS2%7Cpc%7CDJ%7Cpc%7CC8%7Cpc%7CCQ%7C' +
  'pc%7CC9%7Cpc%7CHQ%7Cpc%7CCJ%7Cpc%7CCK%7C'

describe('a played board from the hand viewer', () => {
  const lin = decodeURIComponent(new URL(PLAYED_URL).searchParams.get('lin'))
  const env = buildHandviewerEnvelope(PLAYED_URL, lin, { now })
  const board = env.tournaments[0].events[0].sessions[0].boards[0]
  const result = board.results[0]

  it('reads the board number even with a + for the space', () => {
    expect(board.number).toBe(2)
  })

  it('derives the contract and declarer BBO displays', () => {
    // BBO's own footer reads "1♠ E".
    expect(result.contract).toBe('1S')
    expect(result.declarer).toBe('E')
    expect(board.dealer).toBe('E')
  })

  it('captures the whole auction and all 52 cards', () => {
    expect(result.auction).toEqual(['1S', 'PASS', 'PASS', 'PASS'])
    expect(result.play).toHaveLength(52)
    expect(result.play.slice(0, 4)).toEqual(['DA', 'D3', 'D4', 'D6'])
  })

  it('seats the players as BBO renders them', () => {
    // [W, E] — matches how BBO's own hand viewer renders this deal.
    expect(board.results[0].ns_pair.players.map((p) => p.name)).toEqual(['brosh', 'Fairways4'])
    expect(board.results[0].ew_pair.players.map((p) => p.name)).toEqual(['aam135', 'kemistry'])
  })

  it('needs no network', async () => {
    const fetch = () => { throw new Error('should not fetch') }
    const out = await extractSession(PLAYED_URL, { fetch, now, log: () => {} })
    expect(out.tournaments[0].events[0].sessions[0].boards[0].results[0].play).toHaveLength(52)
  })
})

describe('extractSession on a handviewer URL', () => {
  it('needs no network when the LIN is in the URL', async () => {
    const fetch = () => { throw new Error('should not fetch') }
    const env = await extractSession(PASSED_OUT_URL, { fetch, now, log: () => {} })
    expect(env.source).toBe('bbo')
    expect(env.tournaments[0].events[0].sessions[0].boards[0].number).toBe(7)
  })

  it('resolves the myhand= form through fetchlin, without credentials', async () => {
    const calls = []
    const fetch = async (url, opts = {}) => {
      calls.push({ url, credentials: opts.credentials })
      return { ok: true, status: 200, text: async () => 'pn|a,b,c,d|st||md|1S468AH4KD378JQC49,S279QKH38TJD6AC38,S3TJH79QD49C7TJQK,|rh||ah|Board 3|sv|o|mb|p|mb|p|mb|p|mb|p|' }
    }
    const env = await extractSession(
      'https://www.bridgebase.com/tools/handviewer.html?bbo=y&myhand=M-4700063665-1785550200',
      { fetch, now, log: () => {} }
    )
    expect(calls[0].url).toContain('fetchlin.php?id=4700063665&when_played=1785550200')
    expect(calls[0].credentials).toBe('omit')
    expect(env.tournaments[0].events[0].sessions[0].boards[0].number).toBe(3)
  })
})
