// ACBL Live adapter facade. Implements the adapter interface from
// docs/architecture.md and emits the tournaments-tree envelope from
// docs/normalized-schema.md.

import { fetchAll } from '../../lib/rateLimiter.js'
import { parseBoardDetail } from './parsers/boardDetail.js'
import { parsePairScorecard } from './parsers/pairScorecard.js'
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
export const SOURCE_NAME = 'acbl-live'

export const COVERAGE = {
  // ACBL Live publishes no card-level data. The auction in the BBO handviewer
  // links on board-detail pages is synthetic, not the auction played, so it is
  // deliberately not extracted (see CLAUDE.md).
  cardplay: CARDPLAY.NONE,
  auction: AUCTION.NONE,
  results: RESULTS.ALL_TABLES,
  // Only the user's own section. live.acbl.org allows roughly 110 requests per
  // sign-in under /event/*, and fetching every section multiplied the cost of an
  // event by the number of sections — enough to cross that ceiling on a single
  // extraction, which signs the user out mid-run. Their own section is the field
  // they actually played against. See docs/acbl-rate-limit.md.
  sections: SECTIONS.USER_ONLY,
  player_names: PLAYER_NAMES.REAL,
  sections_labelled: true,
}
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

// URL segments are usually all digits for sectional/regional events
// (sanction '2604321', event '2501') but mixed alphanumerics show up in the
// wild for older events ('17OP') and for NABC tournaments where the sanction
// is 'NABC261' or similar. Keep both the first segment (sanction) and the
// second (event_id) permissive.
const SANCTION_PAT = '[A-Za-z0-9]+'
const EVENT_ID_PAT = '[A-Za-z0-9]+'

export function classifyPage(url) {
  if (!matchesUrl(url)) return 'unknown'
  const path = new URL(url).pathname
  if (
    new RegExp(
      `^/event/${SANCTION_PAT}/${EVENT_ID_PAT}/\\d+/scores/[A-Z]+/[NESW]/\\d+/?$`
    ).test(path)
  ) {
    return 'pair-scorecard'
  }
  if (
    new RegExp(
      `^/event/${SANCTION_PAT}/${EVENT_ID_PAT}/\\d+/board-detail/[A-Z]+/?$`
    ).test(path)
  ) {
    return 'board-detail'
  }
  if (
    new RegExp(`^/event/${SANCTION_PAT}/${EVENT_ID_PAT}/\\d+/summary/?$`).test(path)
  ) {
    return 'event-summary'
  }
  // /my-results is the same listing as /player-results/<id>, pre-filtered to
  // the signed-in player. Same markup, same Summary links, so it takes the
  // same path.
  if (/^\/(player-results\/\d+|my-results)\/?$/.test(path)) {
    return 'player-history'
  }
  // /events/<sanction> — every event in one tournament. Note the plural: the
  // singular /event/<sanction>/... paths above are a single event.
  //
  // Same table markup as the player listings (td.links > a.summary, an Event
  // column), so the per-row links work unchanged. What differs is that it names
  // no player — the h1 is the tournament's location — so a row here has to ask
  // which pair rather than assume one.
  if (new RegExp(`^/events/${SANCTION_PAT}/?$`).test(path)) {
    return 'tournament-events'
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
    // Called as board-detail pages land: (done, total). An ACBL extraction is
    // ~50 requests and takes tens of seconds, which is long enough that a
    // static "Extracting…" reads as a stall.
    onProgress = null,
    // Describes the request that produced this envelope (e.g. "last 1 month
    // for kemistry"). Supplied by the caller — an adapter can't know whether it
    // was asked for one session or a year of history. When the caller says
    // nothing, we fill in who the envelope is about; see captureForPair.
    capture,
  } = options

  const pageType = classifyPage(url)

  // The user often lands on /summary first, and every per-row link on
  // /my-results points at one. Resolve to a pair-scorecard URL by parsing a
  // /scores/... link out of the summary HTML, then run the standard
  // extraction. Given options.playerName we pick that player's own scorecard
  // and the envelope keeps user_pair; without it we take the first link going
  // and blank user_pair, since whoever that pair is, it is not the user.
  if (pageType === 'event-summary') {
    return extractFromSummary(url, options)
  }

  if (pageType !== 'pair-scorecard') {
    throw new Error(
      `extractSession requires a pair-scorecard or event-summary URL; got '${pageType}' for ${url}. ` +
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

  // ── Phase 4: build the board-detail fetch plan ──────────────────────────
  // One board-detail URL per board, for the user's own section only.
  //
  // This used to fan out across every section in pair_directory, which
  // multiplied an event's cost by the section count: a two-section, two-session
  // event took 96 board fetches where it now takes 48. That mattered because
  // live.acbl.org allows about 110 requests per sign-in and then bounces
  // everything to the SSO login — a ceiling a single wide extraction could
  // cross on its own. Their own section is also the field they were scored
  // against, so what the extra sections bought was mostly cost.
  const plan = [] // { sessionIdx, section, boardNumber, url }
  for (let i = 0; i < usableSessions.length; i++) {
    const { sc, url: sUrl } = usableSessions[i]
    const sections = [sc.user_pair.section]
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

  // ── Phase 5: fetch every board-detail AND parse on-the-fly ──────────────
  // Each fetch worker, the moment its HTML lands, calls parseBoardDetail in
  // the onResult callback. While that worker's CPU is parsing, the other
  // (concurrency - 1) workers' fetches are still in flight against ACBL.
  // Net effect: parsing time is hidden inside the fetch window instead of
  // being a separate phase 7 of equal cost.
  timer.start()
  const planByUrl = new Map(plan.map((p) => [p.url, p]))
  const parsedByUrl = new Map() // url → parsed Board | Error
  if (plan.length > 0) {
    await fetchAll(plan.map((p) => p.url), {
      ...fetchOpts,
      onResult: (url, value) => {
        onProgress?.(parsedByUrl.size + 1, plan.length)
        if (value instanceof Error) {
          parsedByUrl.set(url, value)
          return
        }
        const item = planByUrl.get(url)
        try {
          parsedByUrl.set(
            url,
            parseBoardDetail(value, { boardNumber: item.boardNumber, section: item.section })
          )
        } catch (err) {
          parsedByUrl.set(url, err)
        }
      },
    })
  }
  timer.mark('phase5.fetchAndParse', {
    fetches: plan.length,
    sessions: usableSessions.length,
  })

  // ── Phase 6: distribute parsed boards into per-session, per-section maps ─
  const sessionBoards = usableSessions.map(() => new Map())
  for (const p of plan) {
    let sectionMap = sessionBoards[p.sessionIdx].get(p.section)
    if (!sectionMap) {
      sectionMap = new Map()
      sessionBoards[p.sessionIdx].set(p.section, sectionMap)
    }
    sectionMap.set(p.boardNumber, parsedByUrl.get(p.url))
  }

  // ── Phase 7: assemble Sessions from already-parsed boards ───────────────
  // Pure data-manipulation now; no parsing left to do.
  timer.start()
  const builtSessions = usableSessions
    .map(({ sc }, i) => buildSession(sc, sessionBoards[i]))
    .sort((a, b) => a.session_number - b.session_number)
  timer.mark('phase7.assemble', {
    boardsBuilt: builtSessions.reduce((n, s) => n + s.boards.length, 0),
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
    ...buildProvenance({
      coverage: COVERAGE,
      capture: capture ?? captureForPair(initialSc.user_pair),
    }),
    fetched_at: now(),
    source_url: url,
    tournaments: [tournament],
  }
}

// The canonical spelling of the player we were asked for, as it appears in the
// resolved pair. Returns null if they are not in it, so a mismatch omits the
// field rather than asserting something the data does not support.
function matchedPlayerName(envelope, playerName) {
  const needle = normalizeName(playerName)
  if (!needle) return null
  for (const tournament of envelope.tournaments ?? []) {
    for (const event of tournament.events ?? []) {
      for (const session of event.sessions ?? []) {
        for (const p of session.user_pair?.players ?? []) {
          if (normalizeName(p.name).includes(needle)) return p.name
        }
      }
    }
  }
  return null
}

// Who this envelope is about, at the top level.
//
// The names were always in the tree — user_pair.players on every session,
// user_result_index on every board — but a consumer had to walk
// tournaments → events → sessions to find out whose results these are. After
// choosing a pair from the picker, the analyzer was still asking which player
// to analyse, because nothing said so in one place.
//
// Derived from the pair we actually resolved rather than from whatever the
// caller typed, so the two cannot drift apart.
export function captureForPair(userPair) {
  if (!userPair?.players?.length) return undefined
  const names = userPair.players.map((p) => p.name).filter(Boolean)
  const seat = `${userPair.section ?? ''}${userPair.section ? '-' : ''}${userPair.direction ?? ''}${userPair.pair_number ?? ''}`
  const acblIds = userPair.players.map((p) => p.acbl_id).filter(Boolean)
  return {
    context: seat ? `${names.join(' & ')} (${seat})` : names.join(' & '),
    players: names,
    ...(seat ? { pair: seat } : {}),
    // Keyed by provider, matching the schema's { "bbo": "kemistry" } example.
    // Absent for unregistered players, who have no number.
    ...(acblIds.length ? { subject: { acbl: acblIds } } : {}),
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

// --- summary-page entry point -------------------------------------------------

async function extractFromSummary(summaryUrl, options) {
  const {
    fetch,
    signal,
    concurrency = DEFAULT_CONCURRENCY,
    delayMs = 0,
    maxRetries,
    log = defaultLog,
    // Who the user is, when the caller knows. The per-row links on
    // /my-results and /player-results/<id> do: that listing is one player's
    // results, so the content script reads the name off the page and passes it
    // here. With it we can enter through *their* scorecard instead of an
    // arbitrary pair, which keeps user_pair and user_result_index populated and
    // — since the fetch plan now covers one section — picks the right section
    // to fetch.
    playerName = null,
  } = options
  const fetchOpts = { fetch, signal, concurrency: 1, delayMs, maxRetries }

  // 1. Fetch the summary page.
  const phaseStart = Date.now()
  const fetched = await fetchAll([summaryUrl], fetchOpts)
  const html = fetched.get(summaryUrl)
  if (html instanceof Error) throw html
  log('summary.fetchPage', { ms: Date.now() - phaseStart })

  // 2. Find a pair-scorecard link. The summary lists per-pair rankings, each
  //    linking to /scores/{section}/{direction}/{pair}.
  //
  //    Which one we pick used not to matter, because the extractor fanned out
  //    across every section anyway. It matters entirely now: the plan covers
  //    one section, so picking the wrong pair returns a stranger's section and
  //    none of the user's boards. That is exactly what happened on a two-session
  //    MidFlight event — the name match missed, the first link was section C,
  //    and the envelope came back with 36 players and no sign of the user.
  let { url: scorecardUrl, isUser } = findScorecardUrlInSummary(
    html,
    summaryUrl,
    playerName
  )
  if (!scorecardUrl) {
    throw new Error(
      `Could not find any pair-scorecard link on summary page ${summaryUrl}`
    )
  }

  // 2b. Second try, via the pair directory. The summary page's markup varies —
  //     a name may be laid out somewhere rowTextFor cannot see — but every
  //     scorecard carries a #pair-select dropdown listing every pair in every
  //     section in one predictable format, "(A-NS) 2-Rick Wilson & Arthur
  //     Mirin". So fetch the pair we did find, and look the user up there.
  //     Costs one extra fetch, and only when the cheap match missed.
  if (playerName && !isUser) {
    const scMap = await fetchAll([scorecardUrl], fetchOpts)
    const scHtml = scMap.get(scorecardUrl)
    if (!(scHtml instanceof Error)) {
      try {
        const directory = parsePairScorecard(scHtml).pair_directory
        const entry = findUserInPairDirectory(directory, {
          player_names_lower: [playerName.toLowerCase()],
          acbl_ids: [],
        })
        if (entry?.url) {
          scorecardUrl = new URL(entry.url, summaryUrl).toString()
          isUser = true
          log('summary.foundViaPairDirectory', { url: scorecardUrl })
        }
      } catch {
        /* unparseable scorecard — fall through to the check below */
      }
    }
  }

  // 2c. Refuse rather than mislead. A caller that named a player wants that
  //     player's results; handing back an arbitrary pair's section instead
  //     looks like a successful extraction and is not one.
  if (playerName && !isUser) {
    const err = new Error(
      `Could not find ${playerName} in this event. If you played under a ` +
        `different name, open your own scorecard and use the button there.`
    )
    err.name = 'ParseError'
    throw err
  }

  log('summary.foundScorecard', { url: scorecardUrl, isUser })

  // 3. Recurse into the standard extraction with that URL. Since the second
  //    invocation sees a pair-scorecard URL, it follows the existing
  //    sessions / sections / boards path.
  const envelope = await extractSession(scorecardUrl, {
    ...options,
    concurrency,
  })

  // 4. source_url should reflect the page the user was on, not the internal
  //    scorecard URL the extractor resolved to.
  envelope.source_url = summaryUrl

  //    And when a specific person was asked for, say which of the pair that
  //    was. capture.players is both of them in page order, which is all the
  //    picker can know — you chose a pair, not a person. This path knows more:
  //    /my-results is one player's page, so the name we matched is the subject.
  //    A consumer with a watched-players list can go straight there instead of
  //    asking when neither name is on its list.
  //
  //    Taken from user_pair rather than from the caller's string, so it is
  //    spelled the way ACBL spells it.
  if (isUser && playerName && envelope.capture) {
    const matched = matchedPlayerName(envelope, playerName)
    if (matched) envelope.capture.player = matched
  }

  // 5. If we entered through an arbitrary pair rather than the user's own,
  //    null out user_pair and user_result_index across the tree: whatever pair
  //    happened to be first in the summary is not the user, and leaving their
  //    details in the "user" slot would be worse than leaving it empty.
  //    session_score / session_percentage / carryover live under user_pair, so
  //    they go too. Matches the schema's "user_pair is present only if a pair
  //    scorecard initiated this session's extraction".
  if (!isUser) {
    delete envelope.capture
    for (const tournament of envelope.tournaments ?? []) {
      for (const event of tournament.events ?? []) {
        for (const session of event.sessions ?? []) {
          session.user_pair = null
          for (const board of session.boards ?? []) {
            board.user_result_index = null
          }
        }
      }
    }
  }
  return envelope
}

// Find a pair-scorecard link on the summary page, preferring the named
// player's own. Returns { url, isUser }.
//
// isUser is what decides whether the envelope keeps user_pair: entering through
// somebody else's scorecard still yields the whole field, but nothing in it is
// "the user", and saying otherwise would put a stranger's name in that slot.
export function findScorecardUrlInSummary(html, baseUrl, playerName = null) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const candidates = []
  // Every anchor with a /scores/ href that really is a pair scorecard.
  // Defensive because the summary page may also carry unrelated /scores/ links.
  for (const a of doc.querySelectorAll('a[href*="/scores/"]')) {
    const href = a.getAttribute('href')
    if (!href) continue
    let abs
    try {
      abs = new URL(href, baseUrl).toString()
    } catch {
      continue
    }
    if (classifyPage(abs) === 'pair-scorecard') candidates.push({ a, abs })
  }
  if (candidates.length === 0) return { url: null, isUser: false }

  const needle = normalizeName(playerName)
  if (needle) {
    for (const { a, abs } of candidates) {
      if (normalizeName(rowTextFor(a)).includes(needle)) return { url: abs, isUser: true }
    }
  }
  return { url: candidates[0].abs, isUser: false }
}

// The player's name lives in the row, not in the link — the link text is a pair
// number. Walk up to the containing row rather than using closest(), which the
// service worker's linkedom DOM does not implement the same way as a browser.
function rowTextFor(anchor) {
  let el = anchor
  for (let depth = 0; el && depth < 6; depth++) {
    if (el.tagName === 'TR') return el.textContent ?? ''
    el = el.parentElement
  }
  return anchor.parentElement?.textContent ?? anchor.textContent ?? ''
}

// ACBL Live renders names in mixed case and sometimes with extra whitespace;
// the listing page they come from may render them upper case. Compare on
// lowercase with runs of whitespace collapsed.
function normalizeName(value) {
  if (typeof value !== 'string') return ''
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
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


function buildSession(scorecard, parsedBoardsBySection) {
  // parsedBoardsBySection: Map<sectionLetter, Map<boardNumber, Board | Error>>
  // Each Board is the output of parseBoardDetail — already parsed during the
  // fetch phase via the onResult callback. Errors here can be either fetch
  // failures or parse failures; both are surfaced as warnings.
  const sections = [...parsedBoardsBySection.keys()].sort()
  const warnings = []
  let partial = false
  const boards = []

  for (const sb of scorecard.boards) {
    const combinedResults = []
    let representativeBoard = null

    for (const section of sections) {
      const sectionMap = parsedBoardsBySection.get(section)
      const value = sectionMap?.get(sb.number)
      if (value == null) continue
      if (value instanceof Error) {
        partial = true
        const kind = value.name === 'ParseError' ? 'parse failed' : 'fetch failed'
        warnings.push(`board ${sb.number} section ${section}: ${kind} (${value.message})`)
        continue
      }
      if (representativeBoard === null) representativeBoard = value
      combinedResults.push(...value.results)
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
    table_count: countTables(boards),
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
