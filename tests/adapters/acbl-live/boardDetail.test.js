import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseBoardDetail } from '../../../src/adapters/acbl-live/parsers/boardDetail.js'
import { ParseError } from '../../../src/lib/parseError.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(here, '../../../fixtures/acbl-live')
const loadFixture = (name) => readFileSync(resolve(FIXTURES, name), 'utf8')

const html = loadFixture('board-detail-event2604321-session2-A-board1.html')
const board3Html = loadFixture('board-detail-event2604321-session2-A-board3.html')
const board6Html = loadFixture('board-detail-event2604321-session2-A-board6.html')

const board = parseBoardDetail(html, { boardNumber: 1, section: 'A' })

describe('parseBoardDetail (acbl-live, event 2604321 / board 1)', () => {
  it('passes board number and section through', () => {
    expect(board.number).toBe(1)
    expect(board.section).toBe('A')
  })

  it('extracts dealer and vulnerability', () => {
    expect(board.dealer).toBe('N')
    expect(board.vulnerability).toBe('None')
  })

  it('extracts the four hands with the correct shape', () => {
    expect(board.deal.N.S).toEqual(['10', '9', '8', '7', '5'])
    expect(board.deal.N.H).toEqual(['9', '2'])
    expect(board.deal.N.D).toEqual(['A', 'K', 'Q'])
    expect(board.deal.N.C).toEqual(['Q', '10', '4'])

    expect(board.deal.S.S).toEqual(['K', 'Q', '6', '3', '2'])
    expect(board.deal.S.H).toEqual(['A', 'Q', '10', '4'])
    expect(board.deal.S.D).toEqual([]) // void rendered as em-dash
    expect(board.deal.S.C).toEqual(['A', '8', '3', '2'])

    expect(board.deal.W.S).toEqual(['A'])
    expect(board.deal.W.H).toEqual(['K', '8', '6', '3'])
    expect(board.deal.W.D).toEqual(['J', '9', '7', '4', '3'])
    expect(board.deal.W.C).toEqual(['K', '9', '5'])

    expect(board.deal.E.S).toEqual(['J', '4'])
    expect(board.deal.E.H).toEqual(['J', '7', '5'])
    expect(board.deal.E.D).toEqual(['10', '8', '6', '5', '2'])
    expect(board.deal.E.C).toEqual(['J', '7', '6'])
  })

  it('every card is a string (e.g. "10", not 10)', () => {
    for (const seat of ['N', 'E', 'S', 'W']) {
      for (const suit of ['S', 'H', 'D', 'C']) {
        for (const card of board.deal[seat][suit]) {
          expect(typeof card).toBe('string')
        }
      }
    }
  })

  it('extracts 15 result rows (one per N-S pair that played the board)', () => {
    expect(board.results).toHaveLength(15)
  })

  it('extracts par: 460 for 5NT, declarer collapsed to a single seat', () => {
    expect(board.par).toHaveLength(1)
    expect(board.par[0].score).toBe(460)
    expect(board.par[0].contract).toBe('5NT')
    // ACBL renders par with a side suffix ('5NT-NS') because either seat on
    // that side can declare the par contract. The parser canonicalizes to the
    // first seat to match the schema's single-seat declarer field.
    expect(board.par[0].declarer).toBe('N')
  })

  it('extracts per-declarer double-dummy makes as raw tricks', () => {
    // ACBL Live emits the DD section in two structurally-distinct forms:
    //   • Plain text "4/5♣ 1♦ 3♥ 5♠ 5NT" → contract-level form (1–7),
    //     converts to raw tricks via `level + 6`.
    //   • <div class="reverse">♣2</div> → raw-trick form (0–6), used
    //     when the side can't make a 1-level contract; the digit is the
    //     actual trick count, NOT a level.
    //
    // Board 1 NS row is plain text (level form): '4/5♣ 1♦ 3♥ 5♠ 5NT'.
    // The '4/5' slash means N makes 4-level (10 tricks), S makes 5-level
    // (11 tricks); other strains share one value.
    expect(board.double_dummy.N).toEqual({ C: 10, D: 7, H: 9, S: 11, NT: 11 })
    expect(board.double_dummy.S).toEqual({ C: 11, D: 7, H: 9, S: 11, NT: 11 })
    // Board 1 EW row is entirely in <div class="reverse"> wrappers
    // (raw-trick form): ♣2, ♦6, ♥3, ♠2, NT2. Digits stay as-is.
    // Sanity check: NS+EW per strain ≈ 13 (clubs 10+2=12 / 11+2=13,
    // diamonds 7+6=13, etc.) — matches DD-trick conservation.
    expect(board.double_dummy.E).toEqual({ C: 2, D: 6, H: 3, S: 2, NT: 2 })
    expect(board.double_dummy.W).toEqual({ C: 2, D: 6, H: 3, S: 2, NT: 2 })

    // Self-consistency: par 5NT-NS = 11 tricks, and N.NT == S.NT == 11.
    expect(board.par[0].score).toBe(460)
    expect(board.par[0].contract).toBe('5NT')
    expect(board.double_dummy[board.par[0].declarer].NT).toBeGreaterThanOrEqual(11)
  })

  it("includes the user's row (Rick Wilson & Andrew Rowberg, EW pair 4)", () => {
    const userRow = board.results.find((r) =>
      r.ew_pair.players.some((p) => p.name === 'Rick Wilson')
    )
    expect(userRow).toBeDefined()
    expect(userRow.contract).toBe('4S')
    expect(userRow.declarer).toBe('S')
    // Schema dictates score is from the N-S perspective. NS made 4S = +420.
    // (Rick is E-W, so from his perspective the score is -420 — the analyzer
    // can flip sign if it needs the user's perspective.)
    expect(userRow.score).toBe(420)
    expect(userRow.ew_pair.number).toBe(4)
    expect(userRow.ew_pair.section).toBe('A')
    expect(userRow.ew_pair.players.map((p) => p.name)).toEqual(['Rick Wilson', 'Andrew Rowberg'])
  })

  it('result rows include matchpoints, percentage, and pair player names', () => {
    const first = board.results[0]
    expect(first.contract).toBe('6S')
    expect(first.declarer).toBe('S')
    expect(first.score).toBe(980)
    expect(first.matchpoints).toBe(14)
    expect(first.percentage).toBe(100)
    expect(first.ns_pair.number).toBe(10)
    expect(first.ns_pair.players.map((p) => p.name)).toEqual(['Weilong Shen', 'Vasisht Ganesh'])
    expect(first.ew_pair.number).toBe(6)
    expect(first.ew_pair.players.map((p) => p.name)).toEqual(['Arthur Mirin', 'Padmini Sokkappa'])
  })

  it('includes a non-empty handviewer URL pointing at bridgebase.com', () => {
    const url = board.results[0].handviewer_url
    expect(url).toBeTruthy()
    expect(url).toContain('bridgebase.com')
  })

  it('every extracted ACBL ID is a non-empty string', () => {
    let seen = 0
    for (const r of board.results) {
      for (const pair of [r.ns_pair, r.ew_pair]) {
        for (const p of pair.players) {
          if (p.acbl_id !== null) {
            expect(typeof p.acbl_id).toBe('string')
            expect(p.acbl_id.length).toBeGreaterThan(0)
            seen++
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('auction and play fields are null (ACBL Live tournament data has no real auction)', () => {
    for (const r of board.results) {
      expect(r.auction).toBeNull()
      expect(r.play).toBeNull()
    }
  })

  it('user_result_index is null at parse time (orchestration sets it)', () => {
    expect(board.user_result_index).toBeNull()
  })
})

describe('parseBoardDetail (acbl-live, board 3 — has doubled contracts)', () => {
  // Board 3 of event 2604321 is the regression case for the lowercase-x
  // doubled-contract bug. Table 0 includes at least one '2Dx' result row.
  const result = parseBoardDetail(board3Html, { boardNumber: 3, section: 'A' })

  it('parses cleanly with 15 result rows', () => {
    expect(result.results).toHaveLength(15)
  })

  it('normalizes lowercase doubled contracts to uppercase X', () => {
    const doubles = result.results.filter((r) => /X$/.test(r.contract ?? ''))
    expect(doubles.length).toBeGreaterThan(0)
    for (const r of doubles) {
      expect(r.contract).toMatch(/^[1-7](NT|[CDHS])XX?$/)
    }
  })

  it('contains the specific 2DX row that originally surfaced this bug', () => {
    const twoDX = result.results.find((r) => r.contract === '2DX')
    expect(twoDX).toBeDefined()
    expect(twoDX.declarer).toMatch(/^[NESW]$/)
    expect(typeof twoDX.score).toBe('number')
  })
})

describe('parseBoardDetail (acbl-live, board 6 — has passed-out rows)', () => {
  // Board 6 of event 2604321 is the regression case for passed-out boards
  // rendered with 'PASS' in the score column and empty contract / declarer
  // cells. Table 0 has at least two such rows.
  const result = parseBoardDetail(board6Html, { boardNumber: 6, section: 'A' })

  it('parses cleanly with 15 result rows', () => {
    expect(result.results).toHaveLength(15)
  })

  it("normalizes passed-out rows to contract='PASS', declarer=null, score=0", () => {
    const passes = result.results.filter((r) => r.contract === 'PASS')
    expect(passes.length).toBeGreaterThan(0)
    for (const r of passes) {
      expect(r.declarer).toBeNull()
      expect(r.score).toBe(0)
      // Pair labels are still extracted on passed-out rows.
      expect(typeof r.ns_pair.number).toBe('number')
      expect(typeof r.ew_pair.number).toBe('number')
    }
  })

  it('still extracts the played rows around the passed-out ones', () => {
    const played = result.results.filter((r) => r.contract && r.contract !== 'PASS')
    expect(played.length).toBeGreaterThan(0)
    for (const r of played) {
      expect(r.declarer).toMatch(/^[NESW]$/)
      expect(typeof r.score).toBe('number')
    }
  })
})

describe('parseBoardDetail error handling', () => {
  it('throws ParseError on empty input', () => {
    expect(() => parseBoardDetail('')).toThrow(ParseError)
  })

  it('throws ParseError when board-data is missing', () => {
    expect(() =>
      parseBoardDetail('<html><body><p>nothing here</p></body></html>', {
        boardNumber: 1,
        section: 'A',
      })
    ).toThrow(/board-data/)
  })
})
