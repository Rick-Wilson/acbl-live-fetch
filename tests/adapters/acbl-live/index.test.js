import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import adapter, {
  matchesUrl,
  classifyPage,
  extractSession,
} from '../../../src/adapters/acbl-live/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(here, '../../../fixtures/acbl-live')
const SCORECARD_URL = 'https://live.acbl.org/event/2604321/2501/2/scores/A/E/4'

const scorecardHtml = readFileSync(
  resolve(FIXTURES, 'scorecard-event2604321-session2-A-EW-4.html'),
  'utf8'
)
const board1Html = readFileSync(
  resolve(FIXTURES, 'board-detail-event2604321-session2-A-board1.html'),
  'utf8'
)

function ok(body) {
  return new Response(body, { status: 200 })
}
function status(code) {
  return new Response('', { status: code })
}

describe('adapter export', () => {
  it('exposes the architecture.md adapter interface', () => {
    expect(adapter.name).toBe('acbl-live')
    expect(typeof adapter.matchesUrl).toBe('function')
    expect(typeof adapter.classifyPage).toBe('function')
    expect(typeof adapter.extractSession).toBe('function')
  })
})

describe('matchesUrl', () => {
  it('matches live.acbl.org URLs', () => {
    expect(matchesUrl('https://live.acbl.org/event/123/456/2/scores/A/E/4')).toBe(true)
    expect(matchesUrl('https://live.acbl.org/player-results/3506177')).toBe(true)
  })

  it('rejects non-ACBL-Live URLs', () => {
    expect(matchesUrl('https://www.acbl.org/foo')).toBe(false)
    expect(matchesUrl('https://example.com/event/1/2/3/scores/A/E/4')).toBe(false)
    expect(matchesUrl('not-a-url')).toBe(false)
    expect(matchesUrl('')).toBe(false)
  })
})

describe('classifyPage', () => {
  it('classifies pair-scorecard URLs', () => {
    expect(classifyPage('https://live.acbl.org/event/2604321/2501/2/scores/A/E/4')).toBe(
      'pair-scorecard'
    )
    expect(classifyPage('https://live.acbl.org/event/1/2/3/scores/B/N/12')).toBe('pair-scorecard')
  })

  it('classifies board-detail URLs', () => {
    expect(classifyPage('https://live.acbl.org/event/2604321/2501/2/board-detail/A')).toBe(
      'board-detail'
    )
    expect(classifyPage('https://live.acbl.org/event/1/2/3/board-detail/A?board_num=1')).toBe(
      'board-detail'
    )
  })

  it('classifies player-history URLs', () => {
    expect(classifyPage('https://live.acbl.org/player-results/3506177')).toBe('player-history')
  })

  it("returns 'unknown' for unrecognized paths", () => {
    expect(classifyPage('https://live.acbl.org/')).toBe('unknown')
    expect(classifyPage('https://live.acbl.org/event/2604321/recap')).toBe('unknown')
    expect(classifyPage('https://example.com/anything')).toBe('unknown')
  })
})

describe('extractSession', () => {
  it('rejects non-pair-scorecard URLs (player-history is Phase 3)', async () => {
    await expect(
      extractSession('https://live.acbl.org/player-results/3506177', { fetch: vi.fn() })
    ).rejects.toThrow(/pair-scorecard/i)
  })

  it('assembles a NormalizedSession from scorecard + board fixtures', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === SCORECARD_URL) return ok(scorecardHtml)
      if (url.includes('/board-detail/')) return ok(board1Html)
      throw new Error(`unexpected URL: ${url}`)
    })
    const fixedNow = '2026-04-26T18:30:00.000Z'

    const out = await extractSession(SCORECARD_URL, {
      fetch: fetchFn,
      now: () => fixedNow,
    })

    // Top-level wrapper
    expect(out.schema_version).toBe('1.0')
    expect(out.source).toBe('acbl-live')
    expect(out.fetched_at).toBe(fixedNow)

    // Session metadata
    expect(out.session.event_id).toBe('2604321')
    expect(out.session.session_id).toBe('2501-2')
    expect(out.session.event_type).toBe('open_pairs')
    expect(out.session.event_name).toBe('Palo Alto Bridge Sectional')
    expect(out.session.date).toBe('2026-04-25')
    expect(out.session.time).toBe('14:30')
    expect(out.session.scoring).toBe('matchpoints')

    // user_pair carried through from scorecard
    expect(out.session.user_pair.pair_number).toBe(4)
    expect(out.session.user_pair.direction).toBe('EW')
    expect(out.session.user_pair.section).toBe('A')
    expect(out.session.user_pair.session_score).toBeCloseTo(411.5, 5)

    // 26 boards (every board parsed into the same shape since we mock with board-1 html)
    expect(out.session.boards).toHaveLength(26)
    expect(out.session.partial).toBe(false)
    expect(out.session.warnings).toEqual([])

    // First board has the real board-1 data
    const b1 = out.session.boards[0]
    expect(b1.number).toBe(1)
    expect(b1.section).toBe('A')
    expect(b1.dealer).toBe('N')
    expect(b1.vulnerability).toBe('None')
    expect(b1.results).toHaveLength(15)
    expect(b1.par.contract).toBe('5NT')

    // user_result_index points at Rick's row in the results table.
    expect(b1.user_result_index).not.toBeNull()
    const userResult = b1.results[b1.user_result_index]
    expect(userResult.ew_pair.number).toBe(4)
    expect(userResult.ew_pair.players.map((p) => p.name)).toEqual(['Rick Wilson', 'Andrew Rowberg'])
  })

  it('marks partial=true and pushes a warning when a board fetch fails', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === SCORECARD_URL) return ok(scorecardHtml)
      if (url.includes('board_num=13')) return status(404)
      return ok(board1Html)
    })

    const out = await extractSession(SCORECARD_URL, { fetch: fetchFn, maxRetries: 0 })

    expect(out.session.partial).toBe(true)
    expect(out.session.boards).toHaveLength(25) // 26 - 1
    expect(out.session.warnings.some((w) => /board 13/.test(w))).toBe(true)
  })

  it('marks partial=true when a board parse fails', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === SCORECARD_URL) return ok(scorecardHtml)
      if (url.includes('board_num=5')) return ok('<html><body>nope</body></html>')
      return ok(board1Html)
    })

    const out = await extractSession(SCORECARD_URL, { fetch: fetchFn })

    expect(out.session.partial).toBe(true)
    expect(out.session.boards).toHaveLength(25)
    expect(out.session.warnings.some((w) => /board 5.*parse failed/.test(w))).toBe(true)
  })
})
