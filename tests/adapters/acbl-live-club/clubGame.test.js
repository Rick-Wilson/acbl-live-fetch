import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { extractClubGameData } from '../../../src/adapters/acbl-live-club/extractor.js'
import { parseClubGame } from '../../../src/adapters/acbl-live-club/parsers/clubGame.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(here, '../../../fixtures/my-acbl/sample-club-game.html')
const html = readFileSync(FIXTURE, 'utf8')

const data = extractClubGameData(html)
const tournament = parseClubGame(data)

describe('extractClubGameData', () => {
  it('pulls the JSON object out of the <result-details v-bind:data="..."> attribute', () => {
    expect(typeof data).toBe('object')
    expect(data.id).toBe(1430335)
    expect(data.club_name).toBe('Livermore Bridge Club')
    expect(Array.isArray(data.sessions)).toBe(true)
  })
})

describe('parseClubGame (Livermore Bridge Club, 2026-04-20)', () => {
  it('synthesizes a single tournament with no sanction and the club name', () => {
    expect(tournament.sanction).toBeNull()
    expect(tournament.schedule_url).toBeNull()
    expect(tournament.name).toBe('Livermore Bridge Club')
    expect(tournament.events).toHaveLength(1)
  })

  it('builds one event with the expected metadata', () => {
    const event = tournament.events[0]
    expect(event.event_id).toBe('1430335')
    expect(event.event_type).toBe('open_pairs')
    expect(event.date).toBe('2026-04-20')
    expect(event.scoring).toBe('matchpoints')
    expect(event.sessions).toHaveLength(1)
  })

  it('builds one session with all 26 boards', () => {
    const session = tournament.events[0].sessions[0]
    expect(session.session_number).toBe(1)
    expect(session.user_pair).toBeNull()
    expect(session.boards).toHaveLength(26)
    expect(session.boards.map((b) => b.number)).toEqual(
      Array.from({ length: 26 }, (_, i) => i + 1)
    )
  })

  describe('board 1', () => {
    const board = tournament.events[0].sessions[0].boards.find((b) => b.number === 1)

    it('has the right header fields', () => {
      expect(board.section).toBe('A')
      expect(board.dealer).toBe('N')
      expect(board.vulnerability).toBe('None')
      expect(board.results).toHaveLength(12)
    })

    it("has par '6D'-'N' with score 920 (and the tied 6C contract too)", () => {
      // Source: 'Par: 920 6D-NS/6C-NS' — two tied pars at +920.
      expect(board.par).toHaveLength(2)
      expect(board.par[0]).toEqual({ score: 920, contract: '6D', declarer: 'N' })
      expect(board.par[1]).toEqual({ score: 920, contract: '6C', declarer: 'N' })
    })

    it('passes the per-side double-dummy through (level form, per club-adapter spec)', () => {
      // Source NS line: 'NS: 6C 6D 1H 2S 5NT' → C:6 D:6 H:1 S:2 NT:5
      // Source EW line: 'EW: C1 D0 H6 S5 NT1' → C:1 D:0 H:6 S:5 NT:1
      // The club source provides per-side data; we populate both seats of
      // each side identically.
      expect(board.double_dummy.N).toEqual({ C: 6, D: 6, H: 1, S: 2, NT: 5 })
      expect(board.double_dummy.S).toEqual({ C: 6, D: 6, H: 1, S: 2, NT: 5 })
      expect(board.double_dummy.E).toEqual({ C: 1, D: 0, H: 6, S: 5, NT: 1 })
      expect(board.double_dummy.W).toEqual({ C: 1, D: 0, H: 6, S: 5, NT: 1 })
    })

    it('resolves pair numbers to the right players via the pair index', () => {
      // Round 1, table 1: NS pair 1 vs EW pair 1, contract 5D by N (per fixture).
      const r = board.results.find(
        (r) => r.ns_pair?.number === 1 && r.ew_pair?.number === 1
      )
      expect(r).toBeDefined()
      expect(r.contract).toBe('5D')
      expect(r.declarer).toBe('N')
      expect(r.ns_pair.section).toBe('A')
      expect(r.ns_pair.players.map((p) => p.name)).toEqual([
        'Vondera, Wayne',
        'Gast, Lynn',
      ])
      expect(r.ew_pair.players.map((p) => p.name)).toEqual([
        'Mirin, Arthur',
        'Bergmann, Dan',
      ])
    })

    it('normalizes contract spacing and lowercase doubles in result rows', () => {
      // A board_result.contract like '3 NT' → '3NT'; '4 H x' → '4HX'; etc.
      const rNS3NT = board.results.find((r) => r.contract === '3NT')
      expect(rNS3NT).toBeDefined()
    })

    it('builds a handviewer URL pointing at bridgebase.com', () => {
      const r = board.results[0]
      expect(r.handviewer_url).toBeTruthy()
      expect(r.handviewer_url).toContain('bridgebase.com/tools/handviewer.html')
      expect(r.handviewer_url).toContain('a=-')
    })

    it('computes percentage from ns_match_points / acbl_board_top', () => {
      // top = 11 in this fixture. A row with 6.5 mps → 59.1%.
      const r = board.results.find((r) => r.matchpoints === 6.5)
      expect(r).toBeDefined()
      expect(r.percentage).toBeCloseTo(59.1, 1)
    })
  })

  describe('player ID handling', () => {
    it('treats synthetic tmp:* IDs as null acbl_id', () => {
      // Walk every result; if any player has a 'tmp:'-prefixed source ID,
      // verify it was nulled in the output.
      const tmpsInSource = []
      for (const session of data.sessions) {
        for (const section of session.sections ?? []) {
          for (const ps of section.pair_summaries ?? []) {
            for (const p of ps.players ?? []) {
              if (typeof p.id_number === 'string' && p.id_number.startsWith('tmp:')) {
                tmpsInSource.push({
                  section: section.name,
                  direction: ps.direction,
                  pair_number: ps.pair_number,
                  name: p.name,
                })
              }
            }
          }
        }
      }
      // Verify each tmp player's output shape — only run if the fixture has any.
      if (tmpsInSource.length > 0) {
        const board = tournament.events[0].sessions[0].boards[0]
        for (const s of tmpsInSource) {
          // Find the pair in board.results' ns_pair / ew_pair
          for (const r of board.results) {
            for (const pair of [r.ns_pair, r.ew_pair].filter(Boolean)) {
              for (const p of pair.players) {
                if (p.name === s.name) {
                  expect(p.acbl_id).toBeNull()
                }
              }
            }
          }
        }
      }
    })
  })
})
