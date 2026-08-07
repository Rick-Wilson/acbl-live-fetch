import { describe, it, expect } from 'vitest'
import manifest from '../../manifest.json' with { type: 'json' }
import {
  SCHEMA_VERSION,
  PROVIDER,
  CARDPLAY,
  buildProvenance,
} from '../../src/lib/provenance.js'
import { COVERAGE as BBO_COVERAGE } from '../../src/adapters/bbo/index.js'
import { COVERAGE as ACBL_COVERAGE } from '../../src/adapters/acbl-live/index.js'
import { COVERAGE as CLUB_COVERAGE } from '../../src/adapters/acbl-live-club/index.js'

describe('provenance', () => {
  it('is an additive minor bump, so existing consumers keep working', () => {
    expect(SCHEMA_VERSION).toBe('1.1')
    expect(SCHEMA_VERSION.split('.')[0]).toBe('1')
  })

  it('takes its version from the manifest so the two cannot drift', () => {
    expect(PROVIDER.version).toBe(manifest.version)
    expect(PROVIDER.id).toBe('acbl-live-fetch')
    expect(PROVIDER.kind).toBe('browser-extension')
  })

  it('omits capture entirely when the caller supplies none', () => {
    const p = buildProvenance({ coverage: BBO_COVERAGE })
    expect(p).not.toHaveProperty('capture')
    expect(p.provider).toEqual(PROVIDER)
  })

  it('carries a free-text capture context through', () => {
    const capture = { context: 'last 1 month for kemistry', subject: { bbo: 'kemistry' } }
    expect(buildProvenance({ coverage: BBO_COVERAGE, capture }).capture).toEqual(capture)
  })

  it('copies rather than aliasing the shared constants', () => {
    const p = buildProvenance({ coverage: BBO_COVERAGE })
    p.provider.version = 'mutated'
    p.coverage.cardplay = 'mutated'
    expect(PROVIDER.version).toBe(manifest.version)
    expect(BBO_COVERAGE.cardplay).toBe(CARDPLAY.USER_TABLE)
  })
})

describe('declared coverage matches what the adapters actually produce', () => {
  // BBO embeds the user's own LIN in the hands list; every other row on a
  // traveller is contract/result only.
  it('bbo: cardplay for the user table, results for the whole field', () => {
    expect(BBO_COVERAGE).toEqual({
      cardplay: 'user-table',
      auction: 'user-table',
      results: 'all-tables',
      sections: 'all',
      // BBO handles identify a seat but not a person. The tournament summary is
      // fetched without credentials precisely so real names stay out.
      player_names: 'usernames',
      // The baseline; extractSession raises this to true when the summary
      // fetch succeeds.
      sections_labelled: false,
    })
  })

  it.each([
    ['acbl-live', ACBL_COVERAGE],
    ['acbl-live-club', CLUB_COVERAGE],
  ])('%s: no card-level data, all sections, sections labelled', (_name, coverage) => {
    expect(coverage.cardplay).toBe('none')
    expect(coverage.auction).toBe('none')
    expect(coverage.results).toBe('all-tables')
    expect(coverage.sections).toBe('all')
    expect(coverage.sections_labelled).toBe(true)
    // ACBL sources publish real names and national-body IDs.
    expect(coverage.player_names).toBe('real')
  })

  it('every adapter declares the full coverage shape', () => {
    const keys = ['cardplay', 'auction', 'results', 'sections', 'player_names', 'sections_labelled']
    for (const coverage of [BBO_COVERAGE, ACBL_COVERAGE, CLUB_COVERAGE]) {
      expect(Object.keys(coverage).sort()).toEqual([...keys].sort())
    }
  })

  // Bridgemate can be configured to record the opening lead only, which is
  // neither "no cardplay" nor full play — hence an enum rather than a boolean.
  it('allows a lead-only value for Bridgemate-scored games', () => {
    expect(CARDPLAY.LEAD).toBe('lead')
    expect(Object.values(CARDPLAY)).toEqual(['none', 'lead', 'user-table', 'all-tables'])
  })
})
