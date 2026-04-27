// ACBL Live adapter facade. Implements the adapter interface from
// docs/architecture.md and emits the tournaments-tree envelope from
// docs/normalized-schema.md.

import { fetchSession } from './fetcher.js'
import { fetchAll } from '../../lib/rateLimiter.js'
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

// Event IDs in ACBL Live URLs are usually all digits ('2501') but older events
// use a mixed alphanumeric form ('17OP') — confirmed against sanction 2601343
// in January 2026. Keep the second URL segment (event_id) permissive.
const EVENT_ID_PAT = '[A-Za-z0-9]+'

export function classifyPage(url) {
  if (!matchesUrl(url)) return 'unknown'
  const path = new URL(url).pathname
  if (
    new RegExp(`^/event/\\d+/${EVENT_ID_PAT}/\\d+/scores/[A-Z]+/[NESW]/\\d+/?$`).test(path)
  ) {
    return 'pair-scorecard'
  }
  if (new RegExp(`^/event/\\d+/${EVENT_ID_PAT}/\\d+/board-detail/[A-Z]+/?$`).test(path)) {
    return 'board-detail'
  }
  if (new RegExp(`^/event/\\d+/${EVENT_ID_PAT}/\\d+/summary/?$`).test(path)) {
    return 'event-summary'
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
    maxRetries,
    now = () => new Date().toISOString(),
  } = options

  const pageType = classifyPage(url)
  if (pageType !== 'pair-scorecard') {
    throw new Error(
      `extractSession requires a pair-scorecard URL; got '${pageType}' for ${url}. ` +
        `Player-history support is a Phase 3 feature.`
    )
  }

  const fetchOpts = { fetch, signal, concurrency, delayMs, maxRetries }
  const baseUrl = new URL(url)

  // 1. Fetch the URL the user clicked from. We need its parsed scorecard to
  //    discover all sibling sessions and identify the user.
  const initial = await fetchSession(url, fetchOpts)
  const initialSc = initial.scorecard
  const userIdentity = identifyUser(initialSc.user_pair)

  // 2. For every other session listed in the session-select dropdown, locate
  //    the user's scorecard for that session. Players can move sections
  //    between sessions, so the dropdown URL (which keeps the current
  //    section/direction/pair slot) might point at a *different* pair in
  //    the sibling session. We follow the user via pair_directory.
  const otherSessionEntries = (initialSc.available_sessions ?? []).filter(
    (s) => s.number !== initialSc.session_number && s.url
  )
  const otherSessions = await Promise.all(
    otherSessionEntries.map(async (s) => {
      const sessionUrl = new URL(s.url, baseUrl).toString()
      return findUserScorecardForSession(sessionUrl, userIdentity, baseUrl, fetchOpts)
    })
  )

  // 3. For every successful session fetch (initial + corrected siblings),
  //    additionally fetch board-detail for *every* section that played in
  //    that session, so the analyzer sees the whole event.
  const allInitialFetches = [initial, ...otherSessions.filter((s) => s !== null)]
  const sessionsWithAllSections = await Promise.all(
    allInitialFetches.map((s) => augmentWithOtherSections(s, baseUrl, fetchOpts))
  )

  // 4. Build a Session for each, combining results across sections.
  const sessions = sessionsWithAllSections
    .map((s) => buildSession(s.scorecard, s.boardHtmlsBySection))
    .sort((a, b) => a.session_number - b.session_number)

  // 5. Tournament/event metadata comes from the initial scorecard.
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

// --- user identification + cross-session tracking -----------------------------

function identifyUser(userPair) {
  return {
    acbl_ids: userPair.players.map((p) => p.acbl_id).filter(Boolean),
    player_names_lower: userPair.players.map((p) => p.name.toLowerCase()),
  }
}

function userPairMatchesIdentity(userPair, identity) {
  const ids = userPair.players.map((p) => p.acbl_id).filter(Boolean)
  if (ids.length > 0 && identity.acbl_ids.length > 0) {
    return ids.some((id) => identity.acbl_ids.includes(id))
  }
  // Fall back to name match if either side lacks IDs.
  const names = userPair.players.map((p) => p.name.toLowerCase())
  return names.some((n) => identity.player_names_lower.includes(n))
}

function findUserInPairDirectory(directory, identity) {
  // pair_directory entries don't carry ACBL IDs (the dropdown only exposes
  // names), so match on player names.
  return directory.find((entry) => {
    const text = entry.players_text.toLowerCase()
    return identity.player_names_lower.some((n) => text.includes(n))
  })
}

async function findUserScorecardForSession(sessionUrl, identity, baseUrl, fetchOpts) {
  let fetched
  try {
    fetched = await fetchSession(sessionUrl, fetchOpts)
  } catch {
    return null
  }
  if (userPairMatchesIdentity(fetched.scorecard.user_pair, identity)) {
    return fetched
  }
  // The dropdown URL points at a different pair (the user changed sections).
  // Walk pair_directory to find them, then re-fetch.
  const userEntry = findUserInPairDirectory(fetched.scorecard.pair_directory, identity)
  if (!userEntry) return null
  const correctedUrl = new URL(userEntry.url, baseUrl).toString()
  if (correctedUrl === sessionUrl) return fetched
  try {
    return await fetchSession(correctedUrl, fetchOpts)
  } catch {
    return null
  }
}

// --- multi-section board fetching --------------------------------------------

async function augmentWithOtherSections(sessionFetch, baseUrl, fetchOpts) {
  // Returns the session fetch annotated with a boardHtmlsBySection map:
  //   Map<sectionLetter, Map<boardNumber, htmlString | Error>>
  const { scorecard } = sessionFetch
  const userSection = scorecard.user_pair.section
  const allSections = uniqueSections(scorecard.pair_directory, userSection)

  const boardHtmlsBySection = new Map()
  boardHtmlsBySection.set(userSection, sessionFetch.boardHtmls)

  const otherSections = allSections.filter((s) => s !== userSection)
  await Promise.all(
    otherSections.map(async (section) => {
      const sectionMap = await fetchSectionBoardDetails(scorecard, section, baseUrl, fetchOpts)
      boardHtmlsBySection.set(section, sectionMap)
    })
  )

  return { ...sessionFetch, boardHtmlsBySection }
}

function uniqueSections(pairDirectory, fallbackSection) {
  const set = new Set(pairDirectory.map((p) => p.section).filter(Boolean))
  if (set.size === 0 && fallbackSection) set.add(fallbackSection)
  return [...set].sort()
}

async function fetchSectionBoardDetails(scorecard, section, baseUrl, fetchOpts) {
  // Build one board-detail URL per board for this section by swapping the
  // section letter in the user's section URL template.
  const urls = scorecard.boards.map((b) => {
    const url = b.board_detail_url.replace(
      /\/board-detail\/[A-Z]+/,
      `/board-detail/${section}`
    )
    return new URL(url, baseUrl).toString()
  })
  const fetched = await fetchAll(urls, fetchOpts)
  const map = new Map()
  scorecard.boards.forEach((b, i) => {
    map.set(b.number, fetched.get(urls[i]))
  })
  return map
}

// --- session assembly ---------------------------------------------------------

function buildSession(scorecard, boardHtmlsBySection) {
  const sections = [...boardHtmlsBySection.keys()].sort()
  const warnings = []
  let partial = false
  const boards = []

  for (const sb of scorecard.boards) {
    const combinedResults = []
    let representativeBoard = null

    for (const section of sections) {
      const sectionMap = boardHtmlsBySection.get(section)
      const html = sectionMap?.get(sb.number)
      if (html == null) {
        // Section didn't return data for this board (typical when a section
        // didn't play this board, e.g., differing movements). Skip silently.
        continue
      }
      if (html instanceof Error) {
        partial = true
        warnings.push(`board ${sb.number} section ${section}: fetch failed (${html.message})`)
        continue
      }
      let parsed
      try {
        parsed = parseBoardDetail(html, { boardNumber: sb.number, section })
      } catch (err) {
        partial = true
        warnings.push(`board ${sb.number} section ${section}: parse failed (${err.message})`)
        continue
      }
      if (representativeBoard === null) representativeBoard = parsed
      combinedResults.push(...parsed.results)
    }

    if (representativeBoard === null) {
      partial = true
      warnings.push(`board ${sb.number}: no section returned a parseable result`)
      continue
    }

    representativeBoard.results = combinedResults
    representativeBoard.section = scorecard.user_pair.section
    representativeBoard.user_result_index = findUserResultIndex(
      representativeBoard,
      scorecard.user_pair
    )
    if (representativeBoard.user_result_index == null) {
      warnings.push(
        `board ${sb.number}: could not locate user pair ` +
          `${scorecard.user_pair.section}-${scorecard.user_pair.direction}` +
          `${scorecard.user_pair.pair_number} in combined result rows`
      )
    }
    boards.push(representativeBoard)
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
    // With multi-section results combined into one array, two different
    // sections can have the same pair_number — section must match too.
    if (pair.section != null && pair.section !== userPair.section) return false
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
