// BBO (Bridge Base Online) adapter. Implements the adapter interface from
// docs/architecture.md and emits the tournaments-tree envelope from
// docs/normalized-schema.md.
//
// Two entry-point URL types are accepted:
//   tournament-view: webutil.bridgebase.com/v2/tview.php?t=<id>&u=<username>
//   hands-list:      www.bridgebase.com/myhands/hands.php?tourney=<id>-&username=<user>
//
// Both converge on the same pipeline: fetch the hands list, then fetch all
// traveller pages in parallel.  See docs/bbo-format.md for the full reference.

import { fetchAll } from '../../lib/rateLimiter.js'
import { parseHandsList } from './parsers/handsList.js'
import { parseTraveller, parseResultText } from './parsers/traveller.js'

export const SCHEMA_VERSION = '1.0'
export const SOURCE_NAME = 'bbo'

const DEFAULT_CONCURRENCY = 4

export function matchesUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'webutil.bridgebase.com') return true
    if (u.hostname === 'www.bridgebase.com' && u.pathname.startsWith('/myhands/')) return true
    return false
  } catch {
    return false
  }
}

export function classifyPage(url) {
  if (!matchesUrl(url)) return 'unknown'
  const u = new URL(url)
  if (
    u.hostname === 'webutil.bridgebase.com' &&
    u.pathname.startsWith('/v2/tview.php') &&
    u.searchParams.get('t')
  ) {
    return 'tournament-view'
  }
  if (u.hostname === 'www.bridgebase.com' && u.pathname === '/myhands/hands.php') {
    if (u.searchParams.get('tourney')) return 'hands-list'
    if (u.searchParams.get('traveller')) return 'traveller'
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
  if (pageType !== 'tournament-view' && pageType !== 'hands-list') {
    throw new Error(
      `${SOURCE_NAME}: extractSession requires a tournament-view or hands-list URL; ` +
        `got '${pageType}' for ${url}`
    )
  }

  // BBO's hands.php and traveller pages require the user's session cookie to
  // return the full game HTML. Wrap fetch with credentials:'include' so the
  // SW sends the browser's stored BBO cookies (host_permissions allows this).
  const fetchFn = fetch ?? globalThis.fetch
  const credentialedFetch = (url, opts) => fetchFn(url, { ...opts, credentials: 'include' })
  const fetchOpts = { fetch: credentialedFetch, signal, concurrency, delayMs, maxRetries }
  let t0 = Date.now()
  let phaseStart = t0

  // ── Phase 1: fetch the hands list ───────────────────────────────────────────
  const handsListUrl = deriveHandsListUrl(url)
  const phase1Map = await fetchAll([handsListUrl], { ...fetchOpts, concurrency: 1 })
  const handsListHtml = phase1Map.get(handsListUrl)
  if (handsListHtml instanceof Error) throw handsListHtml
  log('phase1.fetchHandsList', { ms: Date.now() - phaseStart, bytes: handsListHtml.length })
  phaseStart = Date.now()

  // ── Phase 2: parse the hands list ───────────────────────────────────────────
  const handsList = parseHandsList(handsListHtml)
  log('phase2.parseHandsList', { ms: Date.now() - phaseStart, boards: handsList.boards.length })
  phaseStart = Date.now()

  // ── Phase 3: fetch all travellers in parallel ────────────────────────────────
  const travellerUrls = handsList.boards
    .map((b) => b.travellerUrl)
    .filter(Boolean)

  const travellerMap = travellerUrls.length
    ? await fetchAll(travellerUrls, fetchOpts)
    : new Map()
  log('phase3.fetchTravellers', { ms: Date.now() - phaseStart, fetches: travellerUrls.length })
  phaseStart = Date.now()

  // ── Phase 4: assemble boards ─────────────────────────────────────────────────
  const warnings = []
  let partial = false
  const boards = []

  for (const handsListBoard of handsList.boards) {
    const tHtml = travellerMap.get(handsListBoard.travellerUrl)
    if (!tHtml || tHtml instanceof Error) {
      partial = true
      const reason = !tHtml ? 'no traveller URL' : tHtml.message
      warnings.push(`board ${handsListBoard.number}: traveller fetch failed (${reason})`)
      continue
    }

    let travellerData
    try {
      travellerData = parseTraveller(tHtml)
    } catch (err) {
      partial = true
      warnings.push(`board ${handsListBoard.number}: traveller parse failed (${err.message})`)
      continue
    }

    boards.push(assembleBoard(handsListBoard, travellerData, handsList.scoring))
  }

  log('phase4.assemble', {
    ms: Date.now() - phaseStart,
    boards: boards.length,
    partial,
  })
  log('extractSession.total', { ms: Date.now() - t0 })

  // ── Assemble normalized envelope ─────────────────────────────────────────────
  const session = {
    session_number: 1,
    time: null,
    user_pair: buildUserPair(handsList),
    boards,
    partial,
    warnings,
  }

  const tourneyId = handsList.tourneyId ?? ''
  const sanction = tourneyId.split('-')[0] ?? tourneyId
  const date = timestampToDate(tourneyId)

  const event = {
    event_id: tourneyId,
    event_type: 'open_pairs',
    name: handsList.tourneyName,
    date,
    scoring: handsList.scoring,
    sessions: [session],
  }

  const tournament = {
    sanction,
    schedule_url: null,
    name: handsList.tourneyName,
    events: [event],
  }

  return {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_NAME,
    fetched_at: now(),
    source_url: url,
    tournaments: [tournament],
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Derive the hands list URL from either a tournament-view or hands-list URL.
function deriveHandsListUrl(url) {
  const u = new URL(url)
  if (u.hostname === 'webutil.bridgebase.com') {
    const tourneyId = u.searchParams.get('t')
    const username = u.searchParams.get('u')
    return `https://www.bridgebase.com/myhands/hands.php?tourney=${tourneyId}-&username=${username}`
  }
  // Already a hands-list URL.
  return url
}

// Convert the Unix timestamp portion of a BBO tourney ID to an ISO date string.
// "81382-1777478400" → timestamp 1777478400 → "2026-04-29"
function timestampToDate(tourneyId) {
  if (!tourneyId) return null
  const parts = tourneyId.split('-')
  const ts = Number.parseInt(parts[parts.length - 1], 10)
  if (Number.isNaN(ts)) return null
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

// Build the normalized UserPair object from parsed hands list data.
function buildUserPair(handsList) {
  const { username, partner, direction, sessionScore, scoring, overallRank } = handsList
  return {
    section: null,
    direction,
    // BBO has no explicit pair numbers. Use the user's overall rank as a
    // surrogate so the analyzer receives a non-null integer.
    pair_number: overallRank ?? 1,
    players: [
      { name: username, acbl_id: null, external_ids: { bbo: username } },
      { name: partner ?? null, acbl_id: null, external_ids: partner ? { bbo: partner } : {} },
    ],
    session_score: sessionScore,
    session_percentage: scoring === 'matchpoints' ? sessionScore : null,
    carryover: null,
  }
}

// Combine one hands-list board entry with its parsed traveller into a Board object.
function assembleBoard(handsListBoard, travellerData, scoring) {
  const { linData, number } = handsListBoard
  const { userResultIndex, results: travellerRows } = travellerData

  const results = travellerRows.map((row, idx) => {
    const r = buildResult(row, scoring, idx)
    // Populate auction + play only for the user's specific result row,
    // sourced from the hands list LIN (same game, same table).
    if (idx === userResultIndex && linData) {
      r.auction = linData.auction?.length ? linData.auction : null
      r.play = linData.play?.length ? linData.play : null
    }
    return r
  })

  return {
    number,
    section: null,
    dealer: linData?.dealer ?? null,
    vulnerability: linData?.vulnerability ?? null,
    deal: linData?.deal ?? null,
    double_dummy: null,
    par: [],
    results,
    user_result_index: userResultIndex,
  }
}

// Build a normalized Result object from one traveller row.
// rowIndex is the 0-based position within this board's results array; used
// as a synthetic pair number since BBO travellers don't expose pair numbers.
function buildResult(row, scoring, rowIndex) {
  const { contract, declarer, tricks } = parseResultText(row.resultText)

  // BBO labels the column "EW Points" but the sign is unreliable for
  // NS-declared contracts (BBO appears to emit |amount| there rather than a
  // consistently EW-perspective signed value). Derive the NS-perspective
  // sign from declarer + made/down so the score is correct regardless:
  //   - declarer is NS and made the contract → NS gained (positive)
  //   - declarer is NS and went down         → NS lost   (negative)
  //   - declarer is EW and made              → NS lost   (negative)
  //   - declarer is EW and went down         → NS gained (positive)
  let score = null
  if (row.ewPoints != null) {
    const magnitude = Math.abs(row.ewPoints)
    const contractLevel = contract ? Number.parseInt(contract, 10) : null
    const declarerIsNS = declarer === 'N' || declarer === 'S'
    const made = tricks != null && contractLevel != null && tricks >= contractLevel + 6
    // For passed-out boards (no declarer / contract) magnitude is 0, sign moot.
    const nsGained = declarer == null ? false : (declarerIsNS ? made : !made)
    score = nsGained ? magnitude : -magnitude
  }

  // Comparison score: IMP or matchpoints earned by EW at this table.
  // Positive = EW outperformed the field average on this board.
  const compScore = row.comparisonScore

  // BBO has no explicit pair numbers. Use row index + 1 so the analyzer
  // receives a non-null integer for every pair in the results.
  const syntheticPairNumber = rowIndex + 1

  return {
    contract,
    declarer,
    tricks,
    score,
    matchpoints: scoring === 'matchpoints' ? compScore : null,
    percentage: null,
    imps: scoring === 'imps' ? compScore : null,
    ns_pair: {
      number: syntheticPairNumber,
      section: null,
      strat: null,
      strat_ranks: [],
      players: [
        { name: row.players.N, acbl_id: null, external_ids: { bbo: row.players.N }, masterpoints_earned: [] },
        { name: row.players.S, acbl_id: null, external_ids: { bbo: row.players.S }, masterpoints_earned: [] },
      ],
    },
    ew_pair: {
      number: syntheticPairNumber,
      section: null,
      strat: null,
      strat_ranks: [],
      players: [
        { name: row.players.E, acbl_id: null, external_ids: { bbo: row.players.E }, masterpoints_earned: [] },
        { name: row.players.W, acbl_id: null, external_ids: { bbo: row.players.W }, masterpoints_earned: [] },
      ],
    },
    auction: null,
    play: null,
    handviewer_url: row.handviewerUrl,
  }
}

function defaultLog(phase, data) {
  // eslint-disable-next-line no-console
  console.info(`[${SOURCE_NAME}] ${phase}`, data)
}

const bboAdapter = {
  name: SOURCE_NAME,
  matchesUrl,
  classifyPage,
  extractSession,
}
export default bboAdapter
