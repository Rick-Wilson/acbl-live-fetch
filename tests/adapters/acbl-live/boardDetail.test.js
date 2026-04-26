import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseBoardDetail } from '../../../src/adapters/acbl-live/parsers/boardDetail.js'
import { ParseError } from '../../../src/lib/parseError.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(
  here,
  '../../../fixtures/acbl-live/board-detail-event2604321-session2-A-board1.html'
)
const html = readFileSync(FIXTURE, 'utf8')

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

  it('extracts par: 460 for 5NT by NS', () => {
    expect(board.par.score).toBe(460)
    expect(board.par.contract).toBe('5NT')
    // ACBL Live renders par with a side suffix ('NS' / 'EW') rather than a single
    // direction. Accept either form so the schema's example ('N') stays valid.
    expect(['NS', 'N', 'S']).toContain(board.par.declarer)
  })

  it('extracts double-dummy makes for both sides', () => {
    expect(board.double_dummy.NS).toEqual({ C: 4, D: 1, H: 3, S: 5, NT: 5 })
    expect(board.double_dummy.EW).toEqual({ C: 2, D: 6, H: 3, S: 2, NT: 2 })
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
