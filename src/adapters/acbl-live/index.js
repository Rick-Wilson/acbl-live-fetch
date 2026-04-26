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

  const fetched = await fetchSession(url, { fetch, signal, concurrency, delayMs })
  const { scorecard, boardHtmls } = fetched

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

  // v1: one tournament, one event, one session. The schema's tournaments[]
  // top-level is designed to grow in v2 (whole tournament with multiple
  // events) and v3 (player history, multiple tournaments) without changing
  // shape — see docs/architecture.md § Extraction phases.
  const session = {
    session_number: scorecard.session_number,
    time: scorecard.time,
    user_pair: scorecard.user_pair,
    boards,
    partial,
    warnings,
  }
  const event = {
    event_id: scorecard.event_id,
    event_type: scorecard.event_type,
    date: scorecard.date,
    scoring: scorecard.scoring,
    sessions: [session],
  }
  const tournament = {
    sanction: scorecard.sanction,
    schedule_url: `${TOURNAMENT_SCHEDULE_BASE}?sanction=${scorecard.sanction}`,
    name: scorecard.tournament_name,
    events: [event],
  }
  return {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_NAME,
    fetched_at: now(),
    tournaments: [tournament],
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
