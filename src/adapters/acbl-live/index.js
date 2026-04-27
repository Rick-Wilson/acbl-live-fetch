// ACBL Live adapter facade. Implements the adapter interface from
// docs/architecture.md and emits the tournaments-tree envelope from
// docs/normalized-schema.md.

import { fetchAll } from '../../lib/rateLimiter.js'
import { parseBoardDetail } from './parsers/boardDetail.js'
import { parsePairScorecard } from './parsers/pairScorecard.js'

export const SCHEMA_VERSION = '1.0'
export const SOURCE_NAME = 'acbl-live'
export const TOURNAMENT_SCHEDULE_BASE = 'https://tournaments.acbl.org/schedule.php'

// Default concurrency for extractSession's bulk fetches. Higher than the
// rate-limiter's library default (4) because the orchestrator now shares one
// concurrency budget across every (session × section × board) fetch instead
// of multiplying it via parallel fetchAll calls. Empirically: with 108-board
// extractions, bumping from 8 → 16 cut phase5 (board-details) wall time
// roughly in half with no observed 429s. The retry/backoff in fetchAll
// handles rate limiting if ACBL ever does push back.
const DEFAULT_CONCURRENCY = 16

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
    concurrency = DEFAULT_CONCURRENCY,
    delayMs = 0,
    maxRetries,
    now = () => new Date().toISOString(),
    log = defaultLog,
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
  const timer = newTimer(log)
  timer.startTotal()

  // ── Phase 1: initial scorecard ───────────────────────────────────────────
  timer.start()
  const initialMap = await fetchAll([url], { ...fetchOpts, concurrency: 1 })
  const initialHtml = initialMap.get(url)
  if (initialHtml instanceof Error) throw initialHtml
  const initialSc = parsePairScorecard(initialHtml)
  const userIdentity = identifyUser(initialSc.user_pair)
  timer.mark('phase1.initialScorecard', { fetches: 1 })

  // ── Phase 2: sibling session scorecards (one fetchAll, shared budget) ───
  timer.start()
  const siblingEntries = (initialSc.available_sessions ?? []).filter(
    (s) => s.number !== initialSc.session_number && s.url
  )
  const siblingUrls = siblingEntries.map((s) => new URL(s.url, baseUrl).toString())
  const siblingMap = siblingUrls.length ? await fetchAll(siblingUrls, fetchOpts) : new Map()

  const sessions = [{ url, html: initialHtml, sc: initialSc }]
  for (const sUrl of siblingUrls) {
    const html = siblingMap.get(sUrl)
    if (html instanceof Error) continue
    let sc
    try {
      sc = parsePairScorecard(html)
    } catch {
      continue
    }
    sessions.push({ url: sUrl, html, sc })
  }
  timer.mark('phase2.siblingScorecards', { fetches: siblingUrls.length })

  // ── Phase 3: follow the user across sessions ────────────────────────────
  // For any sibling whose user_pair isn't us (the user changed sections),
  // find our entry in pair_directory and re-fetch that URL. Single fetchAll
  // for any corrected URLs.
  timer.start()
  const corrections = []
  for (let i = 1; i < sessions.length; i++) {
    if (userPairMatchesIdentity(sessions[i].sc.user_pair, userIdentity)) continue
    const userEntry = findUserInPairDirectory(sessions[i].sc.pair_directory, userIdentity)
    if (!userEntry) continue
    const correctedUrl = new URL(userEntry.url, baseUrl).toString()
    if (correctedUrl !== sessions[i].url) {
      corrections.push({ idx: i, url: correctedUrl })
    }
  }
  if (corrections.length > 0) {
    const correctedMap = await fetchAll(
      corrections.map((c) => c.url),
      fetchOpts
    )
    for (const { idx, url: cUrl } of corrections) {
      const html = correctedMap.get(cUrl)
      if (html instanceof Error) continue
      let sc
      try {
        sc = parsePairScorecard(html)
      } catch {
        continue
      }
      sessions[idx] = { url: cUrl, html, sc }
    }
  }

  timer.mark('phase3.corrections', { fetches: corrections.length })

  // Drop sibling sessions where we still can't locate the user.
  const usableSessions = sessions.filter(
    (s, i) => i === 0 || userPairMatchesIdentity(s.sc.user_pair, userIdentity)
  )

  // ── Phase 4: build the full board-detail fetch plan ─────────────────────
  // For each session, derive every section from pair_directory; for each
  // section, build a board-detail URL per board. One big list.
  const plan = [] // { sessionIdx, section, boardNumber, url }
  for (let i = 0; i < usableSessions.length; i++) {
    const { sc, url: sUrl } = usableSessions[i]
    const userSection = sc.user_pair.section
    const sections = uniqueSections(sc.pair_directory, userSection)
    const sBase = new URL(sUrl)
    for (const section of sections) {
      for (const board of sc.boards) {
        const swapped = board.board_detail_url.replace(
          /\/board-detail\/[A-Z]+/,
          `/board-detail/${section}`
        )
        plan.push({
          sessionIdx: i,
          section,
          boardNumber: board.number,
          url: new URL(swapped, sBase).toString(),
        })
      }
    }
  }

  // ── Phase 5: single fetchAll for every board-detail ─────────────────────
  // This is the bulk of the work — typically 26 boards × N sessions × M
  // sections. One concurrency budget, no parallel fetchAll multiplication.
  timer.start()
  const boardMap = plan.length ? await fetchAll(plan.map((p) => p.url), fetchOpts) : new Map()
  timer.mark('phase5.boardDetails', {
    fetches: plan.length,
    sessions: usableSessions.length,
  })

  // ── Phase 6: distribute results into per-session, per-section maps ─────
  const sessionBoardHtmls = usableSessions.map(() => new Map())
  for (const p of plan) {
    let sectionMap = sessionBoardHtmls[p.sessionIdx].get(p.section)
    if (!sectionMap) {
      sectionMap = new Map()
      sessionBoardHtmls[p.sessionIdx].set(p.section, sectionMap)
    }
    sectionMap.set(p.boardNumber, boardMap.get(p.url))
  }

  // ── Phase 7: build Sessions and assemble the envelope ───────────────────
  // This is where every board-detail HTML is parsed via linkedom — typically
  // CPU-bound and a meaningful chunk of total wall time, so it gets its own
  // timing.
  timer.start()
  const builtSessions = usableSessions
    .map(({ sc }, i) => buildSession(sc, sessionBoardHtmls[i]))
    .sort((a, b) => a.session_number - b.session_number)
  timer.mark('phase7.parseAndBuild', {
    boardsParsed: builtSessions.reduce((n, s) => n + s.boards.length, 0),
  })

  const event = {
    event_id: initialSc.event_id,
    event_type: initialSc.event_type,
    date: initialSc.date,
    scoring: initialSc.scoring,
    sessions: builtSessions,
  }
  const tournament = {
    sanction: initialSc.sanction,
    schedule_url: `${TOURNAMENT_SCHEDULE_BASE}?sanction=${initialSc.sanction}`,
    name: initialSc.tournament_name,
    events: [event],
  }
  timer.endTotal()
  return {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_NAME,
    fetched_at: now(),
    tournaments: [tournament],
  }
}

// --- timing instrumentation ---------------------------------------------------

function newTimer(log) {
  let phaseStart = 0
  let totalStart = 0
  return {
    startTotal() {
      totalStart = Date.now()
    },
    endTotal() {
      log('extractSession.total', { ms: Date.now() - totalStart })
    },
    start() {
      phaseStart = Date.now()
    },
    mark(phase, extra = {}) {
      log(phase, { ms: Date.now() - phaseStart, ...extra })
    },
  }
}

function defaultLog(phase, data) {
  // Single-line console output keyed by phase name. Visible in
  // chrome://extensions → service worker (inspect views) → Console.
  // Pass `log: () => {}` in options to silence.
  // eslint-disable-next-line no-console
  console.info(`[acbl-live] ${phase}`, data)
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

// --- session assembly ---------------------------------------------------------

function uniqueSections(pairDirectory, fallbackSection) {
  const set = new Set(pairDirectory.map((p) => p.section).filter(Boolean))
  if (set.size === 0 && fallbackSection) set.add(fallbackSection)
  return [...set].sort()
}

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
      if (html == null) continue
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
