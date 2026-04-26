// ACBL Live adapter facade. Implements the adapter interface from
// docs/architecture.md and emits the tournaments-tree envelope from
// docs/normalized-schema.md.

import { fetchSession } from './fetcher.js'
import { parseBoardDetail } from './parsers/boardDetail.js'

export const SCHEMA_VERSION = '1.0'
export const SOURCE_NAME = 'acbl-live'
export const TOURNAMENT_SCHEDULE_BASE = 'https://tournaments.acbl.org/schedule.php'

export function matchesUrl(url) {
  try {
    const u = new URL(url)
    return u.hostname === 'live.acbl.org'
  } catch {
    return false
  }
}

export function classifyPage(url) {
  if (!matchesUrl(url)) return 'unknown'
  const path = new URL(url).pathname
  if (/^\/event\/\d+\/\d+\/\d+\/scores\/[A-Z]+\/[NESW]\/\d+\/?$/.test(path)) {
    return 'pair-scorecard'
  }
  if (/^\/event\/\d+\/\d+\/\d+\/board-detail\/[A-Z]+\/?$/.test(path)) {
    return 'board-detail'
  }
  if (/^\/player-results\/\d+\/?$/.test(path)) {
    return 'player-history'
  }
  return 'unknown'
}

export async function extractSession(url, options = {}) {
  const {
    fetch,
    signal,
    concurrency = 4,
    delayMs = 0,
    now = () => new Date().toISOString(),
  } = options

  const pageType = classifyPage(url)
  if (pageType !== 'pair-scorecard') {
    throw new Error(
      `extractSession requires a pair-scorecard URL; got '${pageType}' for ${url}. ` +
        `Player-history support is a Phase 3 feature.`
    )
  }

  // 1. Fetch the URL the user clicked from. We need its parsed scorecard to
  //    discover all sibling sessions for the same event/pair.
  const initial = await fetchSession(url, { fetch, signal, concurrency, delayMs })
  const initialSc = initial.scorecard

  // 2. For every other session listed in the page's session-select dropdown,
  //    fetch its scorecard + boards. Resolve relative URLs against the URL
  //    the user clicked from. Skip the entry that matches the initial fetch.
  const baseUrl = new URL(url)
  const otherSessionUrls = (initialSc.available_sessions ?? [])
    .filter((s) => s.number !== initialSc.session_number && s.url)
    .map((s) => new URL(s.url, baseUrl).toString())

  const otherFetches = await Promise.all(
    otherSessionUrls.map(async (sessionUrl) => {
      try {
        return await fetchSession(sessionUrl, { fetch, signal, concurrency, delayMs })
      } catch {
        // Couldn't fetch this sibling session's scorecard. Skip it; the
        // sessions we did fetch still ship cleanly.
        return null
      }
    })
  )

  // 3. Build a Session for every successful fetch (initial + others).
  const allFetched = [initial, ...otherFetches.filter((f) => f !== null)]
  const sessions = allFetched
    .map(({ scorecard, boardHtmls }) => buildSession(scorecard, boardHtmls))
    .sort((a, b) => a.session_number - b.session_number)

  // 4. Tournament/event metadata comes from the initial scorecard. All
  //    sibling sessions are under the same tournament + event by construction.
  const event = {
    event_id: initialSc.event_id,
    event_type: initialSc.event_type,
    date: initialSc.date,
    scoring: initialSc.scoring,
    sessions,
  }
  const tournament = {
    sanction: initialSc.sanction,
    schedule_url: `${TOURNAMENT_SCHEDULE_BASE}?sanction=${initialSc.sanction}`,
    name: initialSc.tournament_name,
    events: [event],
  }
  return {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_NAME,
    fetched_at: now(),
    tournaments: [tournament],
  }
}

function buildSession(scorecard, boardHtmls) {
  const warnings = []
  let partial = false
  const boards = []

  for (const sb of scorecard.boards) {
    const html = boardHtmls.get(sb.number)
    if (html instanceof Error) {
      partial = true
      warnings.push(`board ${sb.number}: fetch failed (${html.message})`)
      continue
    }
    let board
    try {
      board = parseBoardDetail(html, {
        boardNumber: sb.number,
        section: scorecard.user_pair.section,
      })
    } catch (err) {
      partial = true
      warnings.push(`board ${sb.number}: parse failed (${err.message})`)
      continue
    }
    board.user_result_index = findUserResultIndex(board, scorecard.user_pair)
    if (board.user_result_index == null) {
      warnings.push(
        `board ${sb.number}: could not locate user pair ` +
          `${scorecard.user_pair.pair_number}${scorecard.user_pair.direction} in result rows`
      )
    }
    boards.push(board)
  }

  return {
    session_number: scorecard.session_number,
    time: scorecard.time,
    user_pair: scorecard.user_pair,
    boards,
    partial,
    warnings,
  }
}

function findUserResultIndex(board, userPair) {
  const userIds = userPair.players.map((p) => p.acbl_id).filter(Boolean)
  const idx = board.results.findIndex((r) => {
    const pair = userPair.direction === 'NS' ? r.ns_pair : r.ew_pair
    if (pair.number !== userPair.pair_number) return false
    if (userIds.length === 0) return true
    const pairIds = pair.players.map((p) => p.acbl_id).filter(Boolean)
    if (pairIds.length === 0) return true
    return userIds.some((id) => pairIds.includes(id))
  })
  return idx === -1 ? null : idx
}

const acblLiveAdapter = {
  name: SOURCE_NAME,
  matchesUrl,
  classifyPage,
  extractSession,
}
export default acblLiveAdapter
