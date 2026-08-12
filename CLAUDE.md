# Instructions for Claude Code

This is a new browser extension project. Read this file first, then read all files in `docs/` for context. Then read `START_HERE.md` for the immediate first task.

## Project context

The owner (Rick) is a bridge teacher and software developer. He maintains [bridge-classroom.com](https://bridge-classroom.com), a free open-source suite of bridge education tools. One of those tools is **Bridge Club Game Analysis**, which reads PBN and BWS files from a club game and explains why a player got good and bad results — characterizing bidding, declarer, and defense quality.

Two friction points motivate this extension:

1. Users have to manually download PBN and BWS files from their club's results system before uploading them to the analyzer.
2. Tournament results (e.g., on `live.acbl.org`) don't expose downloadable files at all — users would have to click through every board's detail page by hand.

This extension solves both: one click on the user's results page, and the extension fetches and parses everything in the background, then hands normalized JSON to the analyzer.

## Tech and conventions

- **Vanilla JavaScript** (ES2022+). No framework. No TypeScript for now.
- **Manifest V3** Chrome extension. Service worker for background logic, content script for UI injection.
- **ES modules** throughout (`import` / `export`). Use a build step (Vite or esbuild) to bundle for the extension.
- **Vitest** for tests. Pure functions are easy to test; mock `fetch` for orchestration tests.
- **No runtime dependencies beyond what's strictly needed.** The smaller the extension, the better.
- **Code style:** Prettier defaults. 2-space indent. Single quotes for strings. No semicolons except where required.
- **License:** The Unlicense (`LICENSE` file at repo root, mirror Rick's other repos under `github.com/Rick-Wilson`).

## Architecture summary

Read `docs/architecture.md` for full detail. Key points:

- **Adapter pattern** for sources. ACBL Live is adapter #1. Club games will be adapter #2.
- **Parsers are pure functions** taking HTML strings and returning structured data. They use `DOMParser`, never the global `document`. This way they work in service workers (on fetched HTML) and content scripts (on live pages) identically.
- **Service worker orchestrates**: takes a request from the UI, picks the adapter, fetches all needed pages with bounded concurrency, runs parsers, assembles the normalized JSON.
- **One JSON schema** for all sources (`docs/normalized-schema.md`).

## Current state (August 2026)

Working and merged to `main`. 348 unit tests, 5 Playwright e2e tests, all passing.

**Four entry points**, each with an injected button. Five injection points, since
BBO takes three:

| Source | Notes | Button goes |
|---|---|---|
| `live.acbl.org` | Tournaments. All sections. Needs an ACBL login | In flow, beside the `h1` |
| `my.acbl.org` | Club games. Results are public | The navbar (`ul.navbar-nav`) |
| BBO lobby (`/v3/*`) | Multi-event batch. Needs a BBO login | Above the history list |
| BBO hands list (`hands.php?tourney=`) | One session | Merged into the table's header rows |
| BBO tournament view (`tview.php?t=`) | Whole-event batch | Floating overlay |
| BBO hand viewer | One deal, straight out of the URL — no network at all | BBO's control row |

`hands.php?traveller=` is matched and classified but deliberately gets **no**
button: BBO already analyses that board across the field, and every route to it
passes a page that does have one. Don't "fix" it. The overlay is the fallback
elsewhere, not the preference — see `docs/data-sources.md` § 3.6a.

**Hand-off**: results go to `bridge-classroom.{org,com}/ingest/?v=1`, which
forwards them to whichever Bridge Classroom tool the user picks. This is the
*only* path — the old `sessionStorage` hand-off to `/game-analysis/` and its
`analyzerContent.js` were removed. See `docs/ingest-protocol.md` and
`docs/adr/0001-*.md`.

**`tools/fetch-replays.js`** backfills other tables' cardplay from BBO's public
`fetchlin.php`, outside the browser, at roughly 0.5 req/s. Resumable via a
journal; filters compose and are *nested*, so widening a run only adds work.

### Read these before changing anything

- `docs/data-sources.md` — what each site yields and how it is fetched. The
  *how* matters: three sites each broke a naive `fetch()` differently
- `docs/normalized-schema.md` — the envelope, including `coverage` and the
  deliberate decision not to collect BBO opponents' real names
- `docs/adr/0001-*.md` — why the ingest route exists
- `docs/store-review.md` — store submission, test procedures, blockers
- `docs/prior-art.md` — what three other bridge extensions do

### Next up: store release

Packaging is done — `scripts/package-stores.sh` builds Chrome, Edge, Firefox and
refreshes the Safari resources. Submitted to three of four; Safari remains.

Done: icons (a mortarboard — `icons/icon.svg`, rendered by
`scripts/render-icons.mjs`; deliberately not a spade, see `docs/store-review.md`),
the toolbar `action`, the published privacy URL, the version, the artwork
sign-off, and the five screenshots (in `screenshots/`, 2560x1600, one set for
all four stores).

All four browsers are QA'd against both no-account paths — see
`docs/architecture.md` § Cross-browser builds.

### Submission log

| Store | Submitted | Status |
|---|---|---|
| Chrome Web Store | 11 Aug 2026 | awaiting review |
| Edge Add-ons | 11 Aug 2026 | **published** — first store live |
| addons.mozilla.org | 11 Aug 2026 | awaiting review — **1.0.1** |
| Mac App Store | — | ready, will be 1.0.1 |

### iPad is worth more than it looks

Safari is the only browser engine on iPad, so a Safari extension is the *only*
way to reach those users — there is no Chrome or Firefox to fall back on. That
raises iPadOS above its apparent share.

Tested on a real iPad, 11 Aug 2026. **It behaves the same as Chrome does**; the
one failure seen there was not an iPad problem at all (see below).

| Path | iPad |
|---|---|
| BBO hand viewer | ✅ works |
| ACBL Live for Clubs | ✅ works |
| ACBL Live tournaments | ✅ for pair events; team events fail everywhere, not just here |
| BBO hands list / lobby | n/a — iPad users are in the BBO app, and its web page has a different DOM entirely |

`openTempTab`'s off-screen window never runs on iPad: `fetchViaTab` prefers an
already-open same-origin tab, and there the user is standing on it. The
desktop-only path is only the fallback, which is why everything works.

### ACBL Live team events are not supported

The tournament path finds its way in by looking for a **pair-scorecard** link on
the event summary (`findScorecardUrlInSummary`, `a[href*="/scores/"]`). A team
event's summary has none — there are no pairs — so it fails with:

> could not find any pair-scorecard link on summary page

Measured on a real team event: 109 KB of healthy server-rendered HTML, 72
anchors, and the string `/scores/` absent entirely. Not an SPA, not a login
wall, not a mobile variant. There is simply nothing of that shape to find.

Two things follow, and they are separable:

1. **Say so.** The message blames the page shape when the cause is knowable —
   the fourth instance of that pattern in this project, after the Cloudflare
   403, the lapsed BBO session, and the stale-tab error. It should read
   something like "this is a team event; only pair events are supported on ACBL
   Live so far".
2. **Support them, or decide not to.** `swiss_teams` is already a known
   `event_type` in `pairScorecard.js` and the club parser, so the schema is not
   the obstacle; the entry point is. Worth checking what a team event's results
   URLs look like before committing.

A team event in a batch does **not** kill the run — `runBatch` wraps each URL in
its own try/catch and collects failures into `errors` — but it does mean the
event is silently missing from the analysis, with the reason buried.

### Working style that has paid off here

Verify against real data rather than reasoning from documentation. Several
confident conclusions in this project turned out wrong and were only caught by
checking: BBO events *do* have sections, `pn|` seat order, whether ACBL sites
need a login, and which extension fetches cardplay. When a claim is checkable in
a minute, check it.

## Things to be careful about

- **The auction in BBO handviewer URLs is synthetic, not real.** ACBL Live does not capture per-table auctions. Do not extract or use it for analysis. The `auction` field in the normalized schema must be `null` for ACBL Live data.
- **Em-dash for voids.** Hand parser must handle `—` (U+2014) as void.
- **Two tables per board-detail page.** Table 0 is N-S view, Table 1 is E-W view. Use Table 0 only — it contains every result.
- **Section coverage.** A board-detail page shows one section, so the ACBL Live adapter derives every section from the pair directory and fetches session × section × board. Multi-section is built, not pending. BBO differs: its events have sections too, but a traveller carries one row per table across the whole event, so all sections arrive without extra fetches — while section *identity* stays null, because it lives on `tview.php`, which the adapter doesn't fetch. Each adapter declares this in `coverage` (see `docs/normalized-schema.md`).
- **Player IDs may be missing** for unregistered players. Handle the absence of `data-acbl` gracefully (`acbl_id: null`).
- **HTML changes.** When ACBL Live updates their HTML, parsers should fail loudly with specific error messages, not produce silently-wrong data. Validate structural assumptions.

## Development: targeting a local analyzer

The extension hands results to a runtime-configurable URL (default: `https://bridge-classroom.org/ingest/?v=1`). That page receives the payload and forwards it to whichever Bridge Classroom tool the user picks — see `docs/ingest-protocol.md`. To point it at a local dev server instead, open the background service worker console in `chrome://extensions` and run:

```js
chrome.storage.local.set({ devIngestUrl: 'http://localhost:3001/ingest/?v=1' })
```

To revert to production:

```js
chrome.storage.local.remove('devIngestUrl')
```

The manifest already includes `http://localhost:3001/*` in `host_permissions` and the content script `matches`, so no rebuild is needed when switching. Run the local analyzer with:

```bash
cd /Users/rick/Development/GitHub/Bridge-Game-Analysis
python3 -m http.server 3001
```

The local server serves the static SPA; extension-path analysis is fully client-side. BWS+PBN file upload still calls the production backend (`game-parser.bridge-craftwork.com`).

## When unsure

- Prefer asking before making architecture changes that span multiple files.
- Prefer small, well-tested commits over big sweeping ones.
- If you encounter HTML structure that doesn't match `docs/acbl-live-format.md`, update the doc as part of your fix.
- Update `README.md` status section as you complete phases.
