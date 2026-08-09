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
import { parseTournamentView, indexByUsername } from './parsers/tournamentView.js'
import { parseLin, parseLinPlayers, deriveContract } from './parsers/lin.js'
import {
  SCHEMA_VERSION,
  buildProvenance,
  CARDPLAY,
  AUCTION,
  RESULTS,
  SECTIONS,
  PLAYER_NAMES,
} from '../../lib/provenance.js'
import { countTables } from '../../lib/tableCount.js'

export { SCHEMA_VERSION }
export const SOURCE_NAME = 'bbo'

export const COVERAGE = {
  // Auction and play come from the LIN embedded in the user's own hands list,
  // which holds only their seat. Every other table is contract/result only.
  cardplay: CARDPLAY.USER_TABLE,
  auction: AUCTION.USER_TABLE,
  // A traveller carries one row per table across the whole event: verified
  // against tview.php, where a 4-section/54-table event yields 54 rows on a
  // board. BBO events do have sections, but the traveller is not scoped to one.
  results: RESULTS.ALL_TABLES,
  sections: SECTIONS.ALL,
  // Section identity lives on tview.php, which this adapter does not fetch, so
  // Board.section and Pair.section are null throughout.
  player_names: PLAYER_NAMES.USERNAMES,
  sections_labelled: false,
}

// BBO seems to rate-limit traveller fetches when too many fire in parallel:
// some return real game HTML, others return BBO's timezone-redirect page,
// even within the same already-warmed session. Empirically, concurrency=2
// with a 200ms delay between requests gives ~12/12 success on speedball
// tournaments, while concurrency=4 was returning 1-5/12.
const DEFAULT_CONCURRENCY = 2
const DEFAULT_DELAY_MS = 200

export function matchesUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'webutil.bridgebase.com') return true
    if (u.hostname === 'www.bridgebase.com' && u.pathname.startsWith('/myhands/')) return true
    // The hand viewer carries a whole deal in its own URL — the most reachable
    // page right after playing a board.
    if (u.hostname === 'www.bridgebase.com' && u.pathname === '/tools/handviewer.html') return true
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
  if (u.hostname === 'www.bridgebase.com' && u.pathname === '/tools/handviewer.html') {
    // Two forms: lin= carries the deal inline (no fetch needed at all), while
    // myhand= is an ID that fetchlin.php resolves.
    if (u.searchParams.get('lin') || u.searchParams.get('myhand')) return 'handviewer'
    return 'unknown'
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
    delayMs = DEFAULT_DELAY_MS,
    maxRetries,
    now = () => new Date().toISOString(),
    log = defaultLog,
    // Describes the request that produced this envelope (e.g. "last 1 month
    // for kemistry"). Supplied by the caller — an adapter can't know whether it
    // was asked for one session or a year of history.
    capture,
  } = options

  const pageType = classifyPage(url)
  if (pageType !== 'tournament-view' && pageType !== 'hands-list' && pageType !== 'handviewer') {
    throw new Error(
      `${SOURCE_NAME}: extractSession requires a tournament-view, hands-list or ` +
        `handviewer URL; got '${pageType}' for ${url}`
    )
  }

  if (pageType === 'handviewer') {
    const u = new URL(url)
    let linStr = u.searchParams.get('lin')
    if (!linStr) {
      // myhand=M-<id>-<ts> resolves through fetchlin.php, which needs no auth.
      const m = /M-(\d+)-(\d+)/.exec(u.searchParams.get('myhand') ?? '')
      if (!m) throw new Error(`${SOURCE_NAME}: handviewer URL has no lin= or myhand=`)
      const fetchFn0 = fetch ?? globalThis.fetch
      const res = await fetchFn0(
        `https://www.bridgebase.com/myhands/fetchlin.php?id=${m[1]}&when_played=${m[2]}`,
        { credentials: 'omit', signal }
      )
      if (!res?.ok) throw new Error(`${SOURCE_NAME}: fetchlin failed (HTTP ${res?.status})`)
      linStr = (await res.text()).trim()
    }
    return buildHandviewerEnvelope(url, linStr, { now, capture })
  }

  // BBO's hands.php and traveller pages require the user's session cookie to
  // return the full game HTML. Wrap fetch with credentials:'include' so the
  // SW sends the browser's stored BBO cookies (host_permissions allows this).
  const fetchFn = fetch ?? globalThis.fetch
  const credentialedFetch = (url, opts) => fetchFn(url, { ...opts, credentials: 'include' })
  const fetchOpts = { fetch: credentialedFetch, signal, concurrency, delayMs, maxRetries }
  // Explicitly cookie-less. Keep this distinct from credentialedFetch: if the
  // two are ever collapsed, opponents' real names start flowing into the
  // archive with no visible signal.
  const anonymousFetch = (u, opts) => fetchFn(u, { ...opts, credentials: 'omit' })
  const warnings = []
  let partial = false
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

  // ── Phase 2b: tournament summary, fetched WITHOUT credentials ───────────────
  // The only page carrying section identity, and the only reliable source of
  // the event name (the hands list omits it on most events). Fetched
  // anonymously on purpose: BBO withholds real player names from anonymous
  // viewers, which is exactly the outcome we want — section, ranks and
  // masterpoints without gathering opponents' personal information.
  // Best-effort: a failure costs enrichment, not the extraction.
  let tview = null
  const tviewUrl = deriveTviewUrl(url)
  if (tviewUrl) {
    try {
      const res = await anonymousFetch(tviewUrl, { signal })
      if (res?.ok) tview = parseTournamentView(await res.text())
    } catch (err) {
      warnings.push(`tournament summary unavailable (${err?.message ?? err})`)
    }
    log('phase2b.tournamentView', { ms: Date.now() - phaseStart, ok: !!tview })
    phaseStart = Date.now()
  }

  // ── Phase 3: fetch all travellers in parallel ────────────────────────────────
  const travellerUrls = handsList.boards
    .map((b) => b.travellerUrl)
    .filter(Boolean)

  const travellerMap = travellerUrls.length
    ? await fetchAll(travellerUrls, fetchOpts)
    : new Map()
  log('phase3.fetchTravellers', { ms: Date.now() - phaseStart, fetches: travellerUrls.length })
  phaseStart = Date.now()

  // ── Phase 3b: retry travellers whose HTML doesn't parse ─────────────────────
  // BBO sometimes returns its timezone-redirect page instead of the real
  // traveller HTML when too many requests fire close together. Identify
  // those, wait briefly, and retry sequentially with a longer delay.
  const failedUrls = []
  for (const handsListBoard of handsList.boards) {
    const tHtml = travellerMap.get(handsListBoard.travellerUrl)
    if (!tHtml || tHtml instanceof Error) {
      failedUrls.push(handsListBoard.travellerUrl)
      continue
    }
    try { parseTraveller(tHtml) } catch { failedUrls.push(handsListBoard.travellerUrl) }
  }
  if (failedUrls.length > 0) {
    log('phase3b.retryFailedTravellers', { count: failedUrls.length })
    await new Promise((r) => setTimeout(r, 500))
    const retryMap = await fetchAll(failedUrls, { ...fetchOpts, concurrency: 1, delayMs: 400 })
    for (const url of failedUrls) {
      const html = retryMap.get(url)
      if (html && !(html instanceof Error)) {
        try { parseTraveller(html); travellerMap.set(url, html) } catch { /* still bad — leave original */ }
      }
    }
    log('phase3b.retryFailedTravellers.done', { ms: Date.now() - phaseStart })
    phaseStart = Date.now()
  }

  // ── Phase 4: assemble boards ─────────────────────────────────────────────────
  const boards = []

  for (const handsListBoard of handsList.boards) {
    const tHtml = travellerMap.get(handsListBoard.travellerUrl)
    let travellerData = null
    if (tHtml && !(tHtml instanceof Error)) {
      try {
        travellerData = parseTraveller(tHtml)
      } catch (err) {
        partial = true
        warnings.push(`board ${handsListBoard.number}: traveller parse failed (${err.message})`)
      }
    } else if (tHtml instanceof Error) {
      partial = true
      warnings.push(`board ${handsListBoard.number}: traveller fetch failed (${tHtml.message})`)
    } else {
      partial = true
      warnings.push(`board ${handsListBoard.number}: no traveller URL`)
    }

    // If we couldn't get the per-table traveller, synthesize one from the
    // hands list so the board still appears with the user's own result.
    // We lose other tables' rows, but the user's data (deal, contract,
    // result, MP/IMP comparison, auction, play) is all in the hands list.
    if (!travellerData) {
      travellerData = syntheticTravellerFromHandsList(handsListBoard)
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
  const userPair = buildUserPair(handsList)

  // Fold in the tournament summary, if we got one.
  let tviewName = null
  let tviewTables = null
  if (tview) {
    const applied = applyTournamentView(
      { boards, userPair, username: handsList.username },
      tview
    )
    tviewName = applied.name
    tviewTables = applied.tableCount
    if (!applied.matched) {
      warnings.push('tournament summary did not contain the viewing player')
    }
  }

  const session = {
    session_number: 1,
    time: null,
    user_pair: userPair,
    // tview states the table count outright; countTables() only sees the
    // tables whose results we captured.
    table_count: tviewTables ?? countTables(boards),
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
    // The hands list carries the name only sometimes (null on 238 of 264
    // events in a real capture); tview states it every time.
    name: tviewName ?? handsList.tourneyName,
    date,
    scoring: handsList.scoring,
    sessions: [session],
  }

  const tournament = {
    sanction,
    schedule_url: null,
    name: tviewName ?? handsList.tourneyName,
    events: [event],
  }

  return {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_NAME,
    ...buildProvenance({
      // Declare what this run actually achieved, not what the adapter can do
      // at best: without the summary, section identity is absent.
      coverage: { ...COVERAGE, sections_labelled: !!tview },
      capture,
    }),
    fetched_at: now(),
    source_url: url,
    tournaments: [tournament],
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// A single deal from the hand viewer. The LIN is usually in the URL itself, so
// this needs no network at all; the myhand= form resolves via fetchlin.php,
// which is public. Coverage says user-table throughout: there is no field here,
// just the one table.
export const HANDVIEWER_COVERAGE = {
  cardplay: CARDPLAY.USER_TABLE,
  auction: AUCTION.USER_TABLE,
  results: RESULTS.USER_TABLE,
  sections: SECTIONS.NOT_APPLICABLE,
  player_names: PLAYER_NAMES.USERNAMES,
  sections_labelled: false,
}

export function buildHandviewerEnvelope(url, linStr, { now, capture } = {}) {
  const lin = parseLin(linStr)
  const players = parseLinPlayers(linStr) ?? { N: null, E: null, S: null, W: null }
  const { contract, declarer } = deriveContract(lin.auction, lin.dealer)

  // BBO writes the board number as free text, e.g. "Board 7".
  const boardLabel = /(?:^|\|)ah\|([^|]*)\|/.exec(linStr)?.[1] ?? ''
  const boardNumber = Number.parseInt(/(\d+)/.exec(boardLabel)?.[1] ?? '', 10)

  const seat = (s) => ({ name: players[s], acbl_id: null,
    external_ids: players[s] ? { bbo: players[s] } : {}, masterpoints_earned: [] })

  const board = {
    number: Number.isFinite(boardNumber) ? boardNumber : null,
    section: null,
    dealer: lin.dealer,
    vulnerability: lin.vulnerability,
    deal: lin.deal,
    double_dummy: null,
    par: [],
    user_result_index: 0,
    results: [{
      contract,
      declarer,
      tricks: lin.tricks,
      score: null,
      matchpoints: null,
      percentage: null,
      imps: null,
      ns_pair: { number: 1, section: null, strat: null, strat_ranks: [], players: [seat('N'), seat('S')] },
      ew_pair: { number: 2, section: null, strat: null, strat_ranks: [], players: [seat('E'), seat('W')] },
      auction: lin.auction?.length ? lin.auction : null,
      play: lin.play?.length ? lin.play : null,
      handviewer_url: url,
    }],
  }

  return {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_NAME,
    ...buildProvenance({ coverage: HANDVIEWER_COVERAGE, capture }),
    fetched_at: now(),
    source_url: url,
    tournaments: [{
      sanction: null,
      schedule_url: null,
      name: null,
      events: [{
        event_id: null,
        event_type: 'open_pairs',
        name: boardLabel || null,
        date: null,
        scoring: null,
        sessions: [{
          session_number: 1,
          time: null,
          user_pair: null,
          table_count: 1,
          boards: [board],
          partial: false,
          warnings: [],
        }],
      }],
    }],
  }
}

// Derive the tournament-summary URL from either entry-point form.
export function deriveTviewUrl(url) {
  const u = new URL(url)
  if (u.hostname === 'webutil.bridgebase.com') return u.toString()
  // hands.php?tourney=<id>-&username=<user> → tview.php?t=<id>&u=<user>
  const tourney = (u.searchParams.get('tourney') ?? '').replace(/-$/, '')
  const username = u.searchParams.get('username')
  if (!tourney || !username) return null
  return `https://webutil.bridgebase.com/v2/tview.php?t=${tourney}&u=${encodeURIComponent(username)}`
}

// Fold the tournament summary into the boards and user pair.
//
// Deliberately identity-free: the summary is fetched WITHOUT credentials, so
// BBO returns pseudonymous usernames and withholds real names. That keeps
// opponents' personal information out of the archive while still yielding
// section, direction, strat ranks and masterpoint awards. See coverage
// .player_names in docs/normalized-schema.md.
//
// Self-identification keys off the username the caller already has, not the
// row BBO marks as highlighted — that class is also applied to friends.
export function applyTournamentView({ boards, userPair, username }, parsed) {
  const index = indexByUsername(parsed)
  const lookup = (name) => (name ? index.get(String(name).toLowerCase()) : undefined)

  const label = (pair) => {
    if (!pair) return
    for (const player of pair.players ?? []) {
      const hit = lookup(player.name)
      if (!hit) continue
      pair.section = hit.section
      if (hit.strat_ranks?.length) pair.strat_ranks = hit.strat_ranks
      // BBO awards masterpoints per pair; ACBL records them per player, and
      // both partners receive the same amount.
      if (hit.masterpoints != null) {
        for (const p of pair.players ?? []) {
          p.masterpoints_earned = [{ amount: hit.masterpoints, color: null }]
        }
      }
      return
    }
  }

  for (const board of boards ?? []) {
    for (const result of board.results ?? []) {
      label(result.ns_pair)
      label(result.ew_pair)
    }
  }

  const me = lookup(username)
  if (me && userPair) {
    userPair.section = me.section
    if (me.strat_ranks?.length) userPair.strat_ranks = me.strat_ranks
  }

  return { name: parsed.name ?? null, tableCount: parsed.table_count ?? null, matched: !!me }
}

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

// Build a single-row "traveller" from just the hands-list board. Used as a
// fallback when the per-table traveller fetch / parse fails (BBO sometimes
// rejects the SW's session for traveller URLs even when the hands list itself
// succeeded). The single row is the user's own table, so userResultIndex=0.
// Other tables' results will be missing, but the board is no longer dropped.
function syntheticTravellerFromHandsList(handsListBoard) {
  return {
    userResultIndex: 0,
    results: [{
      players: handsListBoard.players,
      resultText: handsListBoard.resultText,
      ewPoints: handsListBoard.ewPoints,
      comparisonScore: handsListBoard.comparisonScore,
      handviewerUrl: handsListBoard.handviewerUrl,
    }],
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
