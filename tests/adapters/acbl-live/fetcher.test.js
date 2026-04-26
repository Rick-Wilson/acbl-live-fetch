import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fetchSession } from '../../../src/adapters/acbl-live/fetcher.js'
import { FetchError } from '../../../src/lib/rateLimiter.js'

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

describe('fetchSession', () => {
  it('fetches the scorecard, then all 26 board-detail pages', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === SCORECARD_URL) return ok(scorecardHtml)
      if (url.includes('/board-detail/')) return ok(board1Html) // any board content for the test
      throw new Error(`unexpected URL: ${url}`)
    })

    const result = await fetchSession(SCORECARD_URL, { fetch: fetchFn, concurrency: 4 })

    expect(result.scorecardUrl).toBe(SCORECARD_URL)
    expect(result.scorecardHtml).toBe(scorecardHtml)
    expect(result.scorecard.boards).toHaveLength(26)
    expect(result.boardHtmls.size).toBe(26)
    for (let n = 1; n <= 26; n++) {
      expect(result.boardHtmls.get(n)).toBe(board1Html)
    }
    // 1 scorecard + 26 boards = 27 fetches
    expect(fetchFn).toHaveBeenCalledTimes(27)
  })

  it('resolves relative board-detail URLs against the scorecard URL origin', async () => {
    const seen = []
    const fetchFn = vi.fn(async (url) => {
      seen.push(url)
      if (url === SCORECARD_URL) return ok(scorecardHtml)
      return ok(board1Html)
    })

    await fetchSession(SCORECARD_URL, { fetch: fetchFn })

    const boardUrls = seen.filter((u) => u.includes('/board-detail/'))
    expect(boardUrls).toHaveLength(26)
    for (const u of boardUrls) {
      expect(u).toMatch(
        /^https:\/\/live\.acbl\.org\/event\/2604321\/2501\/2\/board-detail\/A\?board_num=\d+$/
      )
    }
  })

  it('records per-board fetch errors in the boardHtmls map (does not throw)', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === SCORECARD_URL) return ok(scorecardHtml)
      if (url.includes('board_num=7')) return status(404)
      return ok(board1Html)
    })

    const result = await fetchSession(SCORECARD_URL, { fetch: fetchFn, maxRetries: 0 })
    expect(result.boardHtmls.get(7)).toBeInstanceOf(FetchError)
    expect(result.boardHtmls.get(7).status).toBe(404)
    expect(result.boardHtmls.get(1)).toBe(board1Html)
  })

  it('throws if the scorecard fetch itself fails', async () => {
    const fetchFn = vi.fn(async () => status(500))
    await expect(fetchSession(SCORECARD_URL, { fetch: fetchFn, maxRetries: 0 })).rejects.toThrow(
      FetchError
    )
  })

  it('rejects an empty scorecard URL', async () => {
    await expect(fetchSession('', { fetch: vi.fn() })).rejects.toThrow(TypeError)
  })
})
