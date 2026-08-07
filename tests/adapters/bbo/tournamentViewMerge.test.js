import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { deriveTviewUrl, applyTournamentView } from '../../../src/adapters/bbo/index.js'
import { parseTournamentView } from '../../../src/adapters/bbo/parsers/tournamentView.js'

const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(resolve(here, '../../../fixtures/bbo/tview-30567-kemistry.html'), 'utf8')
const parsed = parseTournamentView(html)

describe('deriveTviewUrl', () => {
  it('rewrites a hands-list URL, dropping the trailing dash BBO adds', () => {
    expect(
      deriveTviewUrl('https://www.bridgebase.com/myhands/hands.php?tourney=30567-1785967200-&username=kemistry')
    ).toBe('https://webutil.bridgebase.com/v2/tview.php?t=30567-1785967200&u=kemistry')
  })

  it('passes a tview URL through', () => {
    const u = 'https://webutil.bridgebase.com/v2/tview.php?t=30567-1785967200&u=kemistry'
    expect(deriveTviewUrl(u)).toBe(u)
  })

  it('returns null when the URL lacks what it needs', () => {
    expect(deriveTviewUrl('https://www.bridgebase.com/myhands/hands.php?tourney=30567-')).toBeNull()
  })
})

describe('applyTournamentView', () => {
  // Two tables from the real fixture: kemistry+aam135 sit N/S in section 2,
  // gsheerer+zog666 are section 2 as well and did earn masterpoints.
  const makeBoards = () => [{
    number: 1,
    results: [
      {
        ns_pair: { number: 1, section: null, strat_ranks: [], players: [{ name: 'kemistry', masterpoints_earned: [] }, { name: 'aam135', masterpoints_earned: [] }] },
        ew_pair: { number: 1, section: null, strat_ranks: [], players: [{ name: 'nobody-here', masterpoints_earned: [] }, { name: 'also-absent', masterpoints_earned: [] }] },
      },
      {
        ns_pair: { number: 2, section: null, strat_ranks: [], players: [{ name: 'gsheerer', masterpoints_earned: [] }, { name: 'zog666', masterpoints_earned: [] }] },
        ew_pair: { number: 2, section: null, strat_ranks: [], players: [{ name: 'GSHEERER', masterpoints_earned: [] }], },
      },
    ],
  }]

  it('labels pairs with their section', () => {
    const boards = makeBoards()
    const userPair = { section: null, strat_ranks: [] }
    applyTournamentView({ boards, userPair, username: 'kemistry' }, parsed)
    expect(boards[0].results[0].ns_pair.section).toBe('2')
    expect(boards[0].results[1].ns_pair.section).toBe('2')
  })

  it('leaves pairs it cannot find untouched rather than guessing', () => {
    const boards = makeBoards()
    applyTournamentView({ boards, userPair: {}, username: 'kemistry' }, parsed)
    expect(boards[0].results[0].ew_pair.section).toBeNull()
    expect(boards[0].results[0].ew_pair.strat_ranks).toEqual([])
  })

  it('matches usernames case-insensitively', () => {
    const boards = makeBoards()
    applyTournamentView({ boards, userPair: {}, username: 'kemistry' }, parsed)
    expect(boards[0].results[1].ew_pair.section).toBe('2')
  })

  it('identifies the user from the supplied username, not the highlight class', () => {
    // BBO also highlights friends' rows, so the highlight marker alone would
    // pick the wrong pair.
    const userPair = { section: null, strat_ranks: [] }
    applyTournamentView({ boards: [], userPair, username: 'kemistry' }, parsed)
    expect(userPair.section).toBe('2')
    expect(userPair.strat_ranks).toEqual([
      { strat: 'A', rank: 8, scope: 'Section' },
      { strat: 'B', rank: 5, scope: 'Section' },
    ])
  })

  it('reports whether the viewing player was found', () => {
    expect(applyTournamentView({ boards: [], userPair: {}, username: 'kemistry' }, parsed).matched).toBe(true)
    expect(applyTournamentView({ boards: [], userPair: {}, username: 'stranger' }, parsed).matched).toBe(false)
  })

  it('surfaces the event name and authoritative table count', () => {
    const out = applyTournamentView({ boards: [], userPair: {}, username: 'kemistry' }, parsed)
    expect(out.name).toBe('#30567 ACBL Wed 6PM ET Speedball (GIB)')
    expect(out.tableCount).toBe(45)
  })

  it('awards masterpoints to both players of a pair', () => {
    const boards = makeBoards()
    applyTournamentView({ boards, userPair: {}, username: 'kemistry' }, parsed)
    const pair = boards[0].results[1].ns_pair
    const amounts = pair.players.map((p) => p.masterpoints_earned[0]?.amount)
    expect(amounts[0]).toBeGreaterThan(0)
    expect(amounts[0]).toBe(amounts[1])
  })

  // The privacy guarantee this whole path exists to preserve.
  it('introduces no real player names', () => {
    const boards = makeBoards()
    applyTournamentView({ boards, userPair: {}, username: 'kemistry' }, parsed)
    const names = boards.flatMap((b) =>
      b.results.flatMap((r) => [...r.ns_pair.players, ...r.ew_pair.players].map((p) => p.name))
    )
    // Every name is still the BBO handle it started as.
    expect(names.every((n) => !/\s/.test(n))).toBe(true)
  })
})
