import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parsePairScorecard } from '../../../src/adapters/acbl-live/parsers/pairScorecard.js'
import { ParseError } from '../../../src/lib/parseError.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(
  here,
  '../../../fixtures/acbl-live/scorecard-event2604321-session2-A-EW-4.html'
)
const html = readFileSync(FIXTURE, 'utf8')
const sc = parsePairScorecard(html)

describe('parsePairScorecard (acbl-live, sanction 2604321 / event 2501 / session 2 / A-EW-4)', () => {
  it('extracts sanction, event_id, and session_number from the board-detail URLs', () => {
    // The first '/event/' URL segment is the tournament's sanction (ACBL term),
    // not the event id — see docs/acbl-live-format.md.
    expect(sc.sanction).toBe('2604321')
    expect(sc.event_id).toBe('2501')
    expect(sc.session_number).toBe(2)
  })

  it('extracts event_type and scoring', () => {
    expect(sc.event_type).toBe('open_pairs')
    expect(sc.scoring).toBe('matchpoints')
  })

  it('extracts date and time in ISO/24-hour form', () => {
    expect(sc.date).toBe('2026-04-25')
    expect(sc.time).toBe('14:30')
  })

  it("extracts tournament_name from the embedded BBO 'Event:' field", () => {
    // 'Palo Alto Bridge Sectional' is actually the tournament name (BBO's
    // 'Event:' label here matches ACBL Live's own URL/labeling oddities).
    // It lives only in the BBO handviewer URL's p={...} parameter, not in
    // the visible page text.
    expect(sc.tournament_name).toBe('Palo Alto Bridge Sectional')
  })

  it('extracts available_sessions from the session-select dropdown', () => {
    // The fixture's <select id="session-select"> lists sessions 1 and 2 of
    // this event for the same pair. The orchestrator uses these URLs to
    // fetch every session for the event, not just the one the user clicked.
    expect(sc.available_sessions).toEqual([
      { number: 1, url: '/event/2604321/2501/1/scores/A/E/4' },
      { number: 2, url: '/event/2604321/2501/2/scores/A/E/4' },
    ])
  })

  describe('user_pair', () => {
    it('extracts pair number, direction, and section', () => {
      expect(sc.user_pair.pair_number).toBe(4)
      expect(sc.user_pair.direction).toBe('EW')
      expect(sc.user_pair.section).toBe('A')
    })

    it('extracts both players with names and ACBL IDs', () => {
      expect(sc.user_pair.players).toEqual([
        { name: 'Rick Wilson', acbl_id: '3506177', external_ids: {} },
        { name: 'Andrew Rowberg', acbl_id: '5550076', external_ids: {} },
      ])
    })

    it('extracts session_score, session_percentage, and carryover', () => {
      expect(sc.user_pair.session_score).toBeCloseTo(411.5, 5)
      expect(sc.user_pair.session_percentage).toBeCloseTo(60.3, 5)
      expect(sc.user_pair.carryover).toBeCloseTo(192.0, 5)
    })
  })

  describe('boards index', () => {
    it('lists all 26 boards in order', () => {
      expect(sc.boards).toHaveLength(26)
      expect(sc.boards.map((b) => b.number)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1))
    })

    it('each board has a board-detail URL pointing at the right event/session/section', () => {
      for (const b of sc.boards) {
        expect(b.board_detail_url).toMatch(
          /^\/event\/2604321\/2501\/2\/board-detail\/A\?board_num=\d+$/
        )
      }
    })

    it('parses the user result for board 1 (Rick & Andrew vs pair 9, NS made 4S)', () => {
      const b1 = sc.boards[0]
      expect(b1.number).toBe(1)
      expect(b1.user_result.contract).toBe('4S')
      expect(b1.user_result.declarer).toBe('S')
      // User is EW and recorded -420 (Minus column). Schema says NS perspective,
      // so we flip the sign: NS made 4S = +420. Matches the board-detail fixture.
      expect(b1.user_result.score).toBe(420)
      expect(b1.user_result.matchpoints).toBe(7)
      expect(b1.user_result.percentage).toBe(50)
      expect(b1.user_result.opponents.number).toBe(9)
      expect(b1.user_result.opponents.players.map((p) => p.name)).toEqual([
        'William Watson',
        'Bonnie Macbride',
      ])
      expect(b1.user_result.opponents.players.map((p) => p.acbl_id)).toEqual(['8099464', '7714424'])
    })

    it('parses board 26 (user declared 3NT making for +600 from EW perspective)', () => {
      const b26 = sc.boards[25]
      expect(b26.number).toBe(26)
      expect(b26.user_result.contract).toBe('3NT')
      expect(b26.user_result.declarer).toBe('E')
      // User (EW) got +600 in the Plus column. NS perspective is -600.
      expect(b26.user_result.score).toBe(-600)
      expect(b26.user_result.opponents.number).toBe(1)
      expect(b26.user_result.opponents.players.map((p) => p.name)).toEqual([
        'Tim Benoit',
        'Michael Fleisher',
      ])
    })

    it('handles a doubled contract (board 12: 3NT-doubled, scorecard shows lowercase x)', () => {
      const b12 = sc.boards[11]
      expect(b12.number).toBe(12)
      expect(b12.user_result.contract).toBe('3NTX')
      expect(b12.user_result.declarer).toBe('E')
      // User (EW) recorded -800. NS perspective: +800.
      expect(b12.user_result.score).toBe(800)
    })

    it('every result row has a contract, declarer, signed score and opponents pair number', () => {
      for (const b of sc.boards) {
        expect(b.user_result.contract).toBeTruthy()
        expect(b.user_result.declarer).toMatch(/^[NESW]$/)
        expect(typeof b.user_result.score).toBe('number')
        expect(typeof b.user_result.opponents.number).toBe('number')
      }
    })
  })
})

describe('parsePairScorecard error handling', () => {
  it('throws ParseError on empty input', () => {
    expect(() => parsePairScorecard('')).toThrow(ParseError)
  })

  it('throws ParseError when the user-pair header is missing', () => {
    expect(() =>
      parsePairScorecard(
        '<html><body><h1>Apr 25, 2026 - Saturday 2:30 pm</h1><h2>Open Pairs Scores</h2></body></html>'
      )
    ).toThrow(ParseError)
  })
})
