import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import adapter, {
  matchesUrl,
  classifyPage,
  extractSession,
} from '../../../src/adapters/acbl-live/index.js'

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

describe('adapter export', () => {
  it('exposes the architecture.md adapter interface', () => {
    expect(adapter.name).toBe('acbl-live')
    expect(typeof adapter.matchesUrl).toBe('function')
    expect(typeof adapter.classifyPage).toBe('function')
    expect(typeof adapter.extractSession).toBe('function')
  })
})

describe('matchesUrl', () => {
  it('matches live.acbl.org URLs', () => {
    expect(matchesUrl('https://live.acbl.org/event/123/456/2/scores/A/E/4')).toBe(true)
    expect(matchesUrl('https://live.acbl.org/player-results/3506177')).toBe(true)
  })

  it('rejects non-ACBL-Live URLs', () => {
    expect(matchesUrl('https://www.acbl.org/foo')).toBe(false)
    expect(matchesUrl('https://example.com/event/1/2/3/scores/A/E/4')).toBe(false)
    expect(matchesUrl('not-a-url')).toBe(false)
    expect(matchesUrl('')).toBe(false)
  })
})

describe('classifyPage', () => {
  it('classifies pair-scorecard URLs', () => {
    expect(classifyPage('https://live.acbl.org/event/2604321/2501/2/scores/A/E/4')).toBe(
      'pair-scorecard'
    )
    expect(classifyPage('https://live.acbl.org/event/1/2/3/scores/B/N/12')).toBe('pair-scorecard')
  })

  it('classifies pair-scorecard URLs with alphanumeric event_id (older events)', () => {
    // Confirmed against sanction 2601343 (Jan 2026): older ACBL Live events
    // use mixed-case event_ids like '17OP' instead of all digits.
    expect(classifyPage('https://live.acbl.org/event/2601343/17OP/2/scores/A/E/4')).toBe(
      'pair-scorecard'
    )
  })

  it('classifies board-detail URLs', () => {
    expect(classifyPage('https://live.acbl.org/event/2604321/2501/2/board-detail/A')).toBe(
      'board-detail'
    )
    expect(classifyPage('https://live.acbl.org/event/1/2/3/board-detail/A?board_num=1')).toBe(
      'board-detail'
    )
    // Alphanumeric event_id form
    expect(classifyPage('https://live.acbl.org/event/2601343/17OP/2/board-detail/A')).toBe(
      'board-detail'
    )
  })

  it("classifies the per-event /summary page as 'event-summary'", () => {
    // The summary page lives at the event level (not pair level) — the user
    // typically clicks through it to a pair scorecard. We classify it so the
    // URL is recognized, even though the extension doesn't extract from it.
    expect(classifyPage('https://live.acbl.org/event/2601343/17OP/2/summary')).toBe(
      'event-summary'
    )
    expect(classifyPage('https://live.acbl.org/event/2604321/2501/2/summary')).toBe(
      'event-summary'
    )
  })

  it('classifies player-history URLs', () => {
    expect(classifyPage('https://live.acbl.org/player-results/3506177')).toBe('player-history')
  })

  it("returns 'unknown' for unrecognized paths", () => {
    expect(classifyPage('https://live.acbl.org/')).toBe('unknown')
    expect(classifyPage('https://live.acbl.org/event/2604321/recap')).toBe('unknown')
    expect(classifyPage('https://example.com/anything')).toBe('unknown')
  })
})

describe('extractSession', () => {
  // Silence per-phase timing logs in tests; the SW console gets them in real use.
  const silentLog = () => {}

  it('rejects non-pair-scorecard URLs (player-history is Phase 3)', async () => {
    await expect(
      extractSession('https://live.acbl.org/player-results/3506177', {
        fetch: vi.fn(),
        log: silentLog,
      })
    ).rejects.toThrow(/pair-scorecard/i)
  })

  // The fixture's session-select dropdown lists session 1 and session 2. The
  // orchestrator now fetches both. We make session 1's mock return scorecard
  // HTML with the board-detail URLs rewritten so it parses as session_number 1
  // (otherwise both sessions would parse with session_number 2 and we'd miss
  // a class of bugs in the multi-session merge).
  const SESSION_1_URL = 'https://live.acbl.org/event/2604321/2501/1/scores/A/E/4'
  const session1ScorecardHtml = scorecardHtml.replaceAll(
    '/event/2604321/2501/2/board-detail/',
    '/event/2604321/2501/1/board-detail/'
  )

  it('fetches every session listed in the dropdown and merges into one event', async () => {
    const seenUrls = []
    const fetchFn = vi.fn(async (url) => {
      seenUrls.push(url)
      if (url === SCORECARD_URL) return ok(scorecardHtml)
      if (url === SESSION_1_URL) return ok(session1ScorecardHtml)
      if (url.includes('/board-detail/')) return ok(board1Html)
      throw new Error(`unexpected URL: ${url}`)
    })
    const fixedNow = '2026-04-26T18:30:00.000Z'

    const out = await extractSession(SCORECARD_URL, {
      fetch: fetchFn,
      now: () => fixedNow,
      log: silentLog,
    })

    // Top-level wrapper
    expect(out.schema_version).toBe('1.0')
    expect(out.source).toBe('acbl-live')
    expect(out.fetched_at).toBe(fixedNow)
    expect(out.tournaments).toHaveLength(1)

    // Tournament
    const tournament = out.tournaments[0]
    expect(tournament.sanction).toBe('2604321')
    expect(tournament.schedule_url).toBe(
      'https://tournaments.acbl.org/schedule.php?sanction=2604321'
    )
    expect(tournament.name).toBe('Palo Alto Bridge Sectional')
    expect(tournament.events).toHaveLength(1)

    // Event with two sessions, sorted ascending by session_number.
    const event = tournament.events[0]
    expect(event.event_id).toBe('2501')
    expect(event.event_type).toBe('open_pairs')
    expect(event.date).toBe('2026-04-25')
    expect(event.scoring).toBe('matchpoints')
    expect(event.sessions).toHaveLength(2)
    expect(event.sessions.map((s) => s.session_number)).toEqual([1, 2])

    // Both sessions populated correctly. user_pair carries through both.
    for (const session of event.sessions) {
      expect(session.partial).toBe(false)
      expect(session.warnings).toEqual([])
      expect(session.boards).toHaveLength(26)
      expect(session.user_pair.pair_number).toBe(4)
      expect(session.user_pair.direction).toBe('EW')
    }

    // Both session URLs were fetched (initial + sibling).
    expect(seenUrls).toContain(SCORECARD_URL)
    expect(seenUrls).toContain(SESSION_1_URL)
    // 2 scorecards + 2 × 26 board-detail = 54 fetches.
    expect(fetchFn).toHaveBeenCalledTimes(54)
  })

  it("marks partial=true on the affected session when a board fetch fails", async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === SCORECARD_URL) return ok(scorecardHtml)
      if (url === SESSION_1_URL) return ok(session1ScorecardHtml)
      // Fail board 13 only on session 2's URLs.
      if (url.includes('/2/board-detail/') && url.includes('board_num=13')) return status(404)
      if (url.includes('/board-detail/')) return ok(board1Html)
      throw new Error(`unexpected URL: ${url}`)
    })

    const out = await extractSession(SCORECARD_URL, { fetch: fetchFn, maxRetries: 0, log: silentLog })
    const session2 = out.tournaments[0].events[0].sessions.find((s) => s.session_number === 2)
    const session1 = out.tournaments[0].events[0].sessions.find((s) => s.session_number === 1)

    expect(session2.partial).toBe(true)
    expect(session2.boards).toHaveLength(25) // 26 - 1
    expect(session2.warnings.some((w) => /board 13/.test(w))).toBe(true)

    // Session 1 unaffected.
    expect(session1.partial).toBe(false)
    expect(session1.boards).toHaveLength(26)
  })

  it('marks partial=true on the affected session when a board parse fails', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === SCORECARD_URL) return ok(scorecardHtml)
      if (url === SESSION_1_URL) return ok(session1ScorecardHtml)
      if (url.includes('/2/board-detail/') && url.includes('board_num=5'))
        return ok('<html><body>nope</body></html>')
      return ok(board1Html)
    })

    const out = await extractSession(SCORECARD_URL, { fetch: fetchFn, log: silentLog })
    const session2 = out.tournaments[0].events[0].sessions.find((s) => s.session_number === 2)

    expect(session2.partial).toBe(true)
    expect(session2.boards).toHaveLength(25)
    expect(session2.warnings.some((w) => /board 5.*parse failed/.test(w))).toBe(true)
  })

  it('fetches every section in each session and combines results per board', async () => {
    // The fixture's pair-select only lists section A. Inject a synthetic
    // section B option so the orchestrator discovers a second section and
    // fetches /board-detail/B?board_num=N for every board. We anchor on the
    // last A-EW option in the dropdown — appending after it.
    const lastAEWOption =
      '<option value="" data-url="/event/2604321/2501/2/scores/A/E/15">(A-EW) 15-Jennifer Kuhn &amp; Philip Kuhn</option>'
    const multiSectionScorecard = scorecardHtml.replace(
      lastAEWOption,
      lastAEWOption +
        '<option value="" data-url="/event/2604321/2501/2/scores/B/N/1">(B-NS) 1-Synthetic NS &amp; Synthetic NS</option>' +
        '<option value="" data-url="/event/2604321/2501/2/scores/B/E/1">(B-EW) 1-Synthetic EW &amp; Synthetic EW</option>'
    )
    expect(multiSectionScorecard).not.toBe(scorecardHtml) // sanity: replacement matched

    const sectionBBoardUrls = []
    const fetchFn = vi.fn(async (url) => {
      if (url === SCORECARD_URL) return ok(multiSectionScorecard)
      if (url === SESSION_1_URL) return ok(session1ScorecardHtml)
      if (url.includes('/board-detail/B')) {
        sectionBBoardUrls.push(url)
        return ok(board1Html)
      }
      if (url.includes('/board-detail/')) return ok(board1Html)
      throw new Error(`unexpected URL: ${url}`)
    })

    const out = await extractSession(SCORECARD_URL, { fetch: fetchFn, log: silentLog })
    const session = out.tournaments[0].events[0].sessions.find((s) => s.session_number === 2)

    // Section B board-detail was fetched for every board (1..26).
    expect(sectionBBoardUrls).toHaveLength(26)
    for (let n = 1; n <= 26; n++) {
      expect(sectionBBoardUrls).toContain(
        `https://live.acbl.org/event/2604321/2501/2/board-detail/B?board_num=${n}`
      )
    }

    // Each board's results combine section A + section B (30 rows total —
    // 15 from each section's parsed board-detail).
    expect(session.boards).toHaveLength(26)
    expect(session.boards[0].results).toHaveLength(30)

    // The user's row is still found correctly: A-EW-4.
    expect(session.boards[0].user_result_index).not.toBeNull()
    const userResult = session.boards[0].results[session.boards[0].user_result_index]
    expect(userResult.ew_pair.section).toBe('A')
    expect(userResult.ew_pair.number).toBe(4)
  })

  it("ships the sessions it could fetch when a sibling session's scorecard fails", async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === SCORECARD_URL) return ok(scorecardHtml)
      if (url === SESSION_1_URL) return status(500) // sibling scorecard down
      if (url.includes('/board-detail/')) return ok(board1Html)
      throw new Error(`unexpected URL: ${url}`)
    })

    const out = await extractSession(SCORECARD_URL, { fetch: fetchFn, maxRetries: 0, log: silentLog })
    const event = out.tournaments[0].events[0]

    // Only session 2 made it; the failed sibling is silently dropped.
    expect(event.sessions.map((s) => s.session_number)).toEqual([2])
    expect(event.sessions[0].partial).toBe(false)
    expect(event.sessions[0].boards).toHaveLength(26)
  })
})
