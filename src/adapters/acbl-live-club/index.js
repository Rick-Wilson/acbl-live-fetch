// ACBL my.acbl.org club-game adapter. Mirrors the interface of the
// tournament adapter (src/adapters/acbl-live/index.js) and emits the same
// envelope shape — only the source identifier and tournament-tree contents
// differ.
//
// Unlike the tournament adapter (which fans out across many board-detail
// pages), this adapter does a single fetch: every club-game's data is
// embedded in one page as a Vue prop, so extractSession just fetches the
// page, extracts the JSON, and runs the pure parser.

import { fetchAll } from '../../lib/rateLimiter.js'
import { extractClubGameData } from './extractor.js'
import { parseClubGame } from './parsers/clubGame.js'

export const SCHEMA_VERSION = '1.0'
export const SOURCE_NAME = 'acbl-live-club'

export function matchesUrl(url) {
  try {
    const u = new URL(url)
    return u.hostname === 'my.acbl.org'
  } catch {
    return false
  }
}

export function classifyPage(url) {
  if (!matchesUrl(url)) return 'unknown'
  const path = new URL(url).pathname
  if (/^\/club-results\/details\/\d+\/?$/.test(path)) {
    return 'club-game-result'
  }
  return 'unknown'
}

export async function extractSession(url, options = {}) {
  const {
    fetch,
    signal,
    maxRetries,
    delayMs = 0,
    now = () => new Date().toISOString(),
    log = defaultLog,
  } = options

  const pageType = classifyPage(url)
  if (pageType !== 'club-game-result') {
    throw new Error(
      `${SOURCE_NAME}: extractSession requires a /club-results/details/{id} URL; ` +
        `got '${pageType}' for ${url}.`
    )
  }

  const t0 = Date.now()
  let phaseStart = t0

  // Phase 1: fetch the page.
  const fetched = await fetchAll([url], {
    fetch,
    signal,
    maxRetries,
    delayMs,
    concurrency: 1,
  })
  const html = fetched.get(url)
  if (html instanceof Error) throw html
  log('phase1.fetchPage', { ms: Date.now() - phaseStart, fetches: 1 })
  phaseStart = Date.now()

  // Phase 2: extract the data blob and parse it.
  const data = extractClubGameData(html)
  log('phase2.extract', { ms: Date.now() - phaseStart })
  phaseStart = Date.now()

  // Phase 3: transform to the tournament tree.
  const tournament = parseClubGame(data)
  log('phase3.transform', {
    ms: Date.now() - phaseStart,
    boards: tournament.events[0]?.sessions?.reduce((n, s) => n + s.boards.length, 0) ?? 0,
  })

  log('extractSession.total', { ms: Date.now() - t0 })

  return {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_NAME,
    fetched_at: now(),
    tournaments: [tournament],
  }
}

function defaultLog(phase, data) {
  // eslint-disable-next-line no-console
  console.info(`[${SOURCE_NAME}] ${phase}`, data)
}

const acblLiveClubAdapter = {
  name: SOURCE_NAME,
  matchesUrl,
  classifyPage,
  extractSession,
}
export default acblLiveClubAdapter
