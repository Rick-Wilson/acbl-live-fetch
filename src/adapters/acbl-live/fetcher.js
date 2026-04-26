// Two-phase fetch for ACBL Live: scorecard, then every board-detail page.
//
// fetchSession(scorecardUrl, opts) → {
//   scorecardUrl,         // absolute URL the user supplied
//   scorecardHtml,        // raw HTML
//   scorecard,            // result of parsePairScorecard(scorecardHtml)
//   boardHtmls,           // Map<boardNumber, htmlString | Error>
// }
//
// The orchestrator (adapter facade) takes this output, runs parseBoardDetail
// over each board HTML, and assembles the normalized session.

import { fetchAll, FetchError } from '../../lib/rateLimiter.js'
import { parsePairScorecard } from './parsers/pairScorecard.js'

export async function fetchSession(scorecardUrl, options = {}) {
  const {
    fetch: fetchFn = globalThis.fetch,
    signal,
    concurrency = 4,
    delayMs = 0,
    maxRetries = 2,
  } = options

  if (typeof scorecardUrl !== 'string' || !scorecardUrl) {
    throw new TypeError('fetchSession requires a scorecard URL')
  }

  const scorecardHtml = await fetchSingle(scorecardUrl, fetchFn, { signal, maxRetries })
  const scorecard = parsePairScorecard(scorecardHtml)

  const baseUrl = new URL(scorecardUrl)
  const boardUrls = scorecard.boards.map((b) => {
    if (!b.board_detail_url) {
      throw new FetchError(`Board ${b.number} has no board_detail_url in scorecard`, {
        url: scorecardUrl,
      })
    }
    return new URL(b.board_detail_url, baseUrl).toString()
  })

  const fetched = await fetchAll(boardUrls, {
    fetch: fetchFn,
    signal,
    concurrency,
    delayMs,
    maxRetries,
  })

  const boardHtmls = new Map()
  scorecard.boards.forEach((b, i) => {
    boardHtmls.set(b.number, fetched.get(boardUrls[i]))
  })

  return { scorecardUrl, scorecardHtml, scorecard, boardHtmls }
}

async function fetchSingle(url, fetchFn, opts) {
  const result = await fetchAll([url], { fetch: fetchFn, ...opts, concurrency: 1 })
  const value = result.get(url)
  if (value instanceof Error) throw value
  return value
}
