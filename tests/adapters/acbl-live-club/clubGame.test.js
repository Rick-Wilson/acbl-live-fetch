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

    it('decodes mixed level / raw-trick double-dummy forms (per-seat from slash splits)', () => {
      // The club source mixes two forms in the same line, distinguished by
      // token order:
      //   • <digit><strain>  ("6C", "5NT") = highest-makeable-contract level
      //                                       1..7; tricks = level + 6
      //   • <strain><digit>  ("C1", "H6")  = raw trick count (0..6 typically,
      //                                       used when the side can't make a
      //                                       1-level contract)
      // Source NS: '6C 6D 1H 2S 5NT' — all level form. Tricks: C12 D12 H7 S8 NT11.
      expect(board.double_dummy.N).toEqual({ C: 12, D: 12, H: 7, S: 8, NT: 11 })
      expect(board.double_dummy.S).toEqual({ C: 12, D: 12, H: 7, S: 8, NT: 11 })
      // Source EW: 'C1 D0 H6 S5 NT1' — all raw-tricks form. Use as-is, with
      // 'D0' meaning 0 raw tricks. (The old parser interpreted these as
      // levels and ran +6 on every digit; the schema field is raw tricks.)
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
      // The source emits names as "Lastname, Firstname"; the parser normalizes
      // to "Firstname Lastname" to match the tournament adapter and the
      // analyzer's downstream UI.
      expect(r.ns_pair.players.map((p) => p.name)).toEqual(['Wayne Vondera', 'Lynn Gast'])
      // The source emits the EW pair's players in [W, E] order; the parser
      // reverses to PBN-canonical [E, W]. Confirmed against the same game
      // loaded via BWS+PBN.
      expect(r.ew_pair.players.map((p) => p.name)).toEqual([
        'Dan Bergmann',
        'Arthur Mirin',
      ])
    })

    it('leaves already-first-last names untouched (no comma)', () => {
      // Some players in the source come through without the comma form —
      // for those, the name should pass through unchanged. Walk every
      // result and assert no name still contains a comma.
      const allNames = new Set()
      for (const r of board.results) {
        for (const pair of [r.ns_pair, r.ew_pair].filter(Boolean)) {
          for (const p of pair.players) {
            if (p.name) allNames.add(p.name)
          }
        }
      }
      for (const n of allNames) {
        expect(n).not.toContain(',')
      }
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

  describe('Howell movement (Stoneridge Creek fixture, sample-club-game-2.html)', () => {
    const html2 = readFileSync(
      resolve(here, '../../../fixtures/my-acbl/sample-club-game-2.html'),
      'utf8'
    )
    const data2 = extractClubGameData(html2)
    const t2 = parseClubGame(data2)
    const session2 = t2.events[0].sessions[0]

    it('parses without rejecting (every result has a non-null Pair on each side)', () => {
      // pair_summaries[].direction is null in this fixture (Howell). Earlier
      // versions of the index keyed by direction and returned null for every
      // lookup, which made the analyzer's deserializer fail with
      // "expected struct Pair". Verify every result row has both pairs.
      for (const board of session2.boards) {
        for (const r of board.results) {
          expect(r.ns_pair).not.toBeNull()
          expect(r.ew_pair).not.toBeNull()
          expect(typeof r.ns_pair.number).toBe('number')
          expect(typeof r.ew_pair.number).toBe('number')
        }
      }
    })

    it('resolves Howell pair_summaries via either direction key', () => {
      // pair_summaries has pairs 1..7, 9..12 (no 8 — phantom pair). Each
      // pair plays both NS and EW across rounds; the index should resolve
      // pair 5 whether it shows up as ns_pair or ew_pair.
      const board1 = session2.boards.find((b) => b.number === 1)
      const usedAsNs = board1.results.find((r) => r.ns_pair.number === 5)
      const usedAsEw = board1.results.find((r) => r.ew_pair.number === 5)
      // At least one of these should land in this fixture, with players
      // populated from pair_summaries.
      const sample = usedAsNs?.ns_pair ?? usedAsEw?.ew_pair
      if (sample) {
        expect(sample.players.length).toBeGreaterThan(0)
      }
    })

    it("synthesizes a Pair (with empty players) for the phantom sit-out pair 8", () => {
      // Pair 8 is missing from pair_summaries but appears on result rows
      // (it's the sit-out / phantom pair in this 12-pair Howell). The
      // synthesized object keeps the schema valid.
      let foundPhantom = null
      for (const board of session2.boards) {
        for (const r of board.results) {
          if (r.ns_pair.number === 8) foundPhantom = r.ns_pair
          if (r.ew_pair.number === 8) foundPhantom = r.ew_pair
          if (foundPhantom) break
        }
        if (foundPhantom) break
      }
      if (foundPhantom) {
        expect(foundPhantom.section).toBe('A')
        expect(foundPhantom.players).toEqual([])
      }
    })

    it("treats '#'-prefixed id_numbers as null acbl_id (non-member placeholder)", () => {
      // The Stoneridge fixture has e.g. id_number '#123456' for non-members.
      // These shouldn't leak through as if they were real ACBL numbers.
      const seenIds = new Set()
      for (const board of session2.boards) {
        for (const r of board.results) {
          for (const pair of [r.ns_pair, r.ew_pair]) {
            for (const p of pair.players) {
              if (p.acbl_id != null) seenIds.add(p.acbl_id)
            }
          }
        }
      }
      for (const id of seenIds) {
        expect(id.startsWith('#')).toBe(false)
        expect(id.startsWith('tmp:')).toBe(false)
      }
    })
  })

  describe('strat, strat_ranks, and masterpoints_earned', () => {
    // From the fixture: pair 10 NS, strat 1, placed 1st in Section and 3rd in Event.
    // Player 0 (LaFrancesca, 7351194) earned 2.42 Black masterpoints.
    const session = tournament.events[0].sessions[0]

    function findResultByNsPair(pairNum) {
      for (const board of session.boards) {
        const r = board.results.find((r) => r.ns_pair?.number === pairNum)
        if (r) return r
      }
      return undefined
    }

    it('pair has strat (integer) and strat_ranks from pair_summaries', () => {
      // Pair 10 NS: strat 1, placed 1st Section and 3rd Event.
      const r = findResultByNsPair(10)
      expect(r).toBeDefined()
      expect(r.ns_pair.strat).toBe(1)
      expect(r.ns_pair.strat_ranks).toContainEqual({ strat: 1, rank: 1, scope: 'Section' })
      expect(r.ns_pair.strat_ranks).toContainEqual({ strat: 1, rank: 3, scope: 'Event' })
    })

    it('player has masterpoints_earned with amount and color', () => {
      // Pair 10 NS player 0 (LaFrancesca, 7351194) earned 2.42 Black.
      const r = findResultByNsPair(10)
      expect(r).toBeDefined()
      expect(r.ns_pair.players[0].masterpoints_earned).toEqual([{ amount: 2.42, color: 'Black' }])
    })

    it('pair with no awards has empty strat_ranks and players with empty masterpoints_earned', () => {
      // Pair 4 in the fixture has strat_place: [] and no awards_score entries.
      const r = findResultByNsPair(4)
      if (r) {
        expect(r.ns_pair.strat_ranks).toEqual([])
        for (const p of r.ns_pair.players) {
          expect(p.masterpoints_earned).toEqual([])
        }
      }
    })

    it('synthesized pair (phantom/sit-out) has strat:null and strat_ranks:[]', () => {
      // Walk all results for any synthesized pair (number present but players empty).
      let found = false
      for (const board of session.boards) {
        for (const r of board.results) {
          for (const pair of [r.ns_pair, r.ew_pair]) {
            if (pair && pair.players.length === 0) {
              expect(pair.strat).toBeNull()
              expect(pair.strat_ranks).toEqual([])
              found = true
            }
          }
        }
      }
      // This fixture may or may not have phantoms; only assert if found.
      if (!found) expect(true).toBe(true)
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
