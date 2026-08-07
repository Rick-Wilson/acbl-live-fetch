import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseTournamentView, indexByUsername, splitPlayerNames } from '../../../src/adapters/bbo/parsers/tournamentView.js'

const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(resolve(here, '../../../fixtures/bbo/tview-30567-kemistry.html'), 'utf8')

describe('parseTournamentView', () => {
  const parsed = parseTournamentView(html)

  it('reads the header the hands list usually lacks', () => {
    expect(parsed.name).toBe('#30567 ACBL Wed 6PM ET Speedball (GIB)')
    expect(parsed.table_count).toBe(45)
  })

  it('finds every section and direction', () => {
    const keys = parsed.sections.map((s) => `${s.section}${s.direction}`).sort()
    expect(keys).toEqual(['1EW', '1NS', '2EW', '2NS', '3EW', '3NS'])
  })

  it('covers the whole field', () => {
    const pairs = parsed.sections.reduce((n, s) => n + s.pairs.length, 0)
    expect(pairs).toBe(90)          // 45 tables x 2 directions
  })
})

describe('indexByUsername', () => {
  const index = indexByUsername(parseTournamentView(html))

  it('places the viewing player in their real section', () => {
    expect(index.get('kemistry')).toMatchObject({
      section: '2',
      direction: 'NS',
      partner: 'aam135',
    })
  })

  it('captures strat ranks', () => {
    expect(index.get('kemistry').strat_ranks).toEqual([
      { strat: 'A', rank: 8, scope: 'Section' },
      { strat: 'B', rank: 5, scope: 'Section' },
    ])
  })

  it('folds username case, since BBO stores as typed but matches case-insensitively', () => {
    for (const key of index.keys()) expect(key).toBe(key.toLowerCase())
  })

  it('recovers masterpoint awards', () => {
    const withMp = [...index.values()].filter((v) => v.masterpoints != null)
    expect(withMp.length).toBeGreaterThan(20)
    expect(withMp.every((v) => v.masterpoints > 0)).toBe(true)
  })

  // This fixture was captured unauthenticated. BBO shows ranks and masterpoints
  // to anyone but withholds real player names, so every name is null here even
  // though a logged-in viewer sees "Rick Wilson (CA) - Arthur Mirin (CA)".
  // Pins the observed behaviour so an authenticated fixture, when added, has to
  // change this test deliberately rather than silently.
  it('has no real names, because the fixture is an anonymous capture', () => {
    expect([...index.values()].every((v) => v.name === null)).toBe(true)
  })
})

describe('splitPlayerNames', () => {
  it('splits a pair and drops the region suffix', () => {
    expect(splitPlayerNames('Rick Wilson (CA) - Arthur Mirin (CA)')).toEqual(['Rick Wilson', 'Arthur Mirin'])
  })

  it('treats BBO’s "?" placeholder as unknown', () => {
    expect(splitPlayerNames('? - Beverly Sturman (CA)')).toEqual([null, 'Beverly Sturman'])
  })

  it('handles a robot partner leaving one half blank', () => {
    expect(splitPlayerNames('Marcia Hengehold (FL) -')).toEqual(['Marcia Hengehold', null])
  })

  it('strips decoration BBO appends to names', () => {
    expect(splitPlayerNames('Jeff Smith⭐ (ON) - Gunnar Þórðarson🅀 (Iceland)'))
      .toEqual(['Jeff Smith', 'Gunnar Þórðarson'])
  })

  it('returns nulls for an empty cell', () => {
    expect(splitPlayerNames('')).toEqual([null, null])
    expect(splitPlayerNames(null)).toEqual([null, null])
  })
})
