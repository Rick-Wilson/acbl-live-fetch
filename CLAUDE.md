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

Working and merged to `main`. 470 unit tests, 5 Playwright e2e tests, all passing.

**Four entry points**, each with an injected button. Five injection points, since
BBO takes three:

| Source | Notes | Button goes |
|---|---|---|
| `live.acbl.org` | Tournaments. **One event, one section** — see the allowance below. Needs an ACBL login | In flow, beside the `h1`; a summary page asks which pair |
| `live.acbl.org/my-results` | The results listing, pre-filtered to you. One event per row, no batch | A link in each row's Links column |
| `live.acbl.org/events/<sanction>` | Every event in one tournament. Names nobody, so a row asks which pair | A link in each row's Links column |
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
- `docs/acbl-rate-limit.md` — the ~110-request-per-sign-in allowance on
  live.acbl.org, how it was measured, and the four theories it killed
- `docs/prior-art.md` — what three other bridge extensions do

### Next up: store release — 1.1.0

Packaging is done — `scripts/package-stores.sh` builds Chrome, Edge, Firefox and
refreshes the Safari resources. All four 1.1.0 packages are built and verified.

**1.1.0, not 1.0.2, and the bump was forced.** 1.0.1 went to AMO on 11 August;
PRs #5–#9 landed on the 12th and 13th. The working tree and the build in AMO's
queue were both calling themselves 1.0.1 while differing by a removed feature.
Minor rather than patch because the ACBL Live date-range batch was removed and
replaced with per-row links, the pair picker is new, section coverage narrowed
to the user's own, and the envelope went 1.1 → 1.2.

Four places carry the version; `docs/store-review.md` § 6a has the table.
**Xcode's `MARKETING_VERSION` is edited in `project.pbxproj` directly** —
`agvtool new-marketing-version` substitutes a key the Info.plists do not
contain, leaves `MARKETING_VERSION` alone, and reports success anyway.
`CURRENT_PROJECT_VERSION` stays at 1: nothing has ever reached App Store Connect.

Verified for this release rather than assumed:

- The Safari `.appex` bundles exactly what is on disk (`diff -rq`, no
  differences) at 1.1.0 / build 1. The three UI modules added in 1.1.0 needed
  no Xcode change — Vite folds them into the existing `assets/` folder
  reference. New **entry points** are the thing that would need registering, not
  new source files.
- 470 unit tests, 5 e2e, `addons-linter` 0 errors / 2 warnings — the same two
  linkedom `innerHTML` sites, now at line 2 col 8311 and line 7 col 443.

Done: icons (a mortarboard — `icons/icon.svg`, rendered by
`scripts/render-icons.mjs`; deliberately not a spade, see `docs/store-review.md`),
the toolbar `action`, the published privacy URL, the version, the artwork
sign-off, and the five screenshots (in `screenshots/`, 2560x1600, one set for
all four stores).

All four browsers are QA'd against both no-account paths — see
`docs/architecture.md` § Cross-browser builds.

**The ACBL Live behaviour changed after those submissions, but the listings did
not need to.** Checked rather than assumed: all five submitted screenshots are
ACBL *clubs* and BBO, and the date-range picker in shot 1 is the club one on
`my.acbl.org`, whose batch is untouched. The listing copy says only
"live.acbl.org — tournament results", which is still true.

What is missing is not wrong, only absent: no shot has ever covered ACBL Live
tournaments (`docs/screenshot-set.md` § Coverage has it outstanding), so the
per-row links and the pair picker are unphotographed. Adding one is an
opportunity, not a correction — and it is being taken for 1.1.0, as four shots
rather than one. `docs/screenshot-set.md` § 7 has the recipe, ordered so the two
shots that fetch nothing come first and the sign-in allowance is never what
costs a shot.

`demo/acbl-live-tournament.mp4` is the one asset that *is* a release behind: it
predates the pair picker and the percentage. Being re-recorded in the same
session as the shots.

### Submission log

| Store | Submitted | Status |
|---|---|---|
| Chrome Web Store | 11 Aug 2026 | **published** — 1.0.1, ~14 Aug. No approval email arrived; the dashboard said so first |
| Edge Add-ons | 11 Aug 2026 | **published** — 1.0.1 |
| addons.mozilla.org | 11 Aug 2026 | **published** — 1.0.1, approved 14 Aug |
| Mac App Store | — | 1.1.0 build 1 ready; never submitted |

**All three browser stores now ship 1.0.1, and that changes the order.** As of
18 August, Chrome and AMO have both published — so every Chrome, Edge and
Firefox user has the ACBL Live date-range batch that exhausts the sign-in
allowance and can sign them out of ACBL Live for real. It is no longer one
store's problem.

It also removes the reason to stagger them. While 1.0.1 was *pending*,
resubmitting Chrome and AMO meant replacing a submission mid-review and
restarting its clock, which was a real cost. Published versions stay live while
an update is reviewed, so 1.1.0 now costs nothing to submit anywhere and none of
the three waits on the others.

**So: Chrome, Edge and AMO together, as soon as the branch is pushed.** None of
them needs a new screenshot — all five are ACBL clubs and BBO, both untouched.
Apple still follows the capture session, and Apple is the only store whose users
are unaffected, because nothing has ever shipped there.

Watch the Chrome dashboard rather than the inbox. Chrome published without
sending an approval email; the status was only visible in the developer
dashboard.

**Permission tightening is deferred to 1.2.0.** `docs/store-review.md` § 5 has
the two candidates — dropping `tabs`, path-scoping the BBO hosts. Both were
considered for 1.1.0 and both were declined: neither is visible to a user, both
rewrite justification text that has been through review once, and both want a
four-browser QA pass that this release should not be carrying.

### iOS is worth more than it looks, and iPhone is in

Safari is the only browser engine on iOS, so a Safari extension is the *only*
way to reach iPad and iPhone users — there is no Chrome or Firefox to fall back
on. That raises iOS above its apparent share.

**iPhone is supported.** `TARGETED_DEVICE_FAMILY` is `1,2` and stays that way.
Confirmed working on a real iPhone, iOS 26.6, 18 Aug 2026, against a club
results page: the button injects into `my.acbl.org`'s own navbar and the
hand-off runs. The injected UI is one button in the page's existing chrome, so
there was nothing to redesign for a 440px viewport.

That decision has a cost worth knowing: claiming iPhone obliges a **6.9-inch
iPhone screenshot set** (1320 × 2868) on top of the iPad and Mac sets. See
`docs/screenshot-set.md`.

Tested on a real iPad, 11 Aug 2026. **It behaves the same as Chrome does** —
and that is the point worth remembering: *both* failures found during iPad
testing turned out to be nothing to do with the iPad.

The first was team events, which fail everywhere. The second was the ACBL Live
batch, which appears never to have been exercised on any platform until someone
tried it on an iPad; it turned out to exceed what live.acbl.org allows per
sign-in, and cost several days to chase. Neither was reproducible *because* of
Safari or iPadOS, and looking there first was the wrong instinct twice.

The lesson is not about the iPad. It is that testing on an unfamiliar platform
exercises paths nobody had exercised before, and the platform gets the blame for
what those paths turn up.

| Path | iPad | iPhone |
|---|---|---|
| ACBL Live for Clubs | ✅ works | ✅ works — the path confirmed on 18 Aug |
| BBO hand viewer | ✅ works | ⬜ untested |
| ACBL Live tournaments | ✅ for pair events; team events fail everywhere, not just here | ⬜ untested |
| ACBL Live batch | removed — exceeded the per-sign-in allowance on every platform, not just here | — |
| BBO hands list / lobby | n/a — those users are in the BBO app, whose web page has a different DOM entirely | n/a, same reason |

**Untested is not the same as broken**, and nothing suggests the untested rows
differ — the injection is the same code and the anchors are the same elements.
But say which is which rather than claiming a platform sweep that did not happen.

`openTempTab`'s off-screen window never runs on iOS: `fetchViaTab` prefers an
already-open same-origin tab, and there the user is standing on it. The
desktop-only path is only the fallback, which is why everything works.

**Enabling the extension in Settings does not make it run.** Safari grants page
access per site, separately, and until that is granted no content script
injects — no button, no error, no prompt, indistinguishable from a broken build.
It cost an hour on a device we own. iPad shows a puzzle-piece in the toolbar;
iPhone has no room for one and folds the same controls into the page menu, which
on iPhone sits at the *bottom* of the screen. `docs/store-review.md` § 7 has the
table, and the Apple reviewer notes walk through it — a reviewer who misses this
sees an app that does nothing.

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

### ACBL Live: one event at a time, one section

The two limits worth knowing before touching this adapter:

- **One event per fetch.** A multi-session event is fine — all its sessions come
  together — but there is no batch. Two events means two clicks, and roughly
  two or three fit in a sign-in before the allowance runs out.
- **The user's own section only**, regardless. Not configurable. A summary or
  tournament page asks which pair, and that pair's section is what gets fetched.

Both fall out of the request allowance below. Neither is a placeholder waiting
to be widened: widening either is what got users signed out of ACBL Live.

### ACBL Live has a per-sign-in request allowance

**Solved.** `live.acbl.org` serves roughly **110 requests per sign-in** under
`/event/*`, then 302s everything to `https://web3.acbl.org/login`. It counts
requests — measured across 0–15 MB, 18–55s, 1–16 concurrent, GET and HEAD alike,
and only the count holds still. Full evidence in `docs/acbl-rate-limit.md`.

Why it took four wrong theories: a *navigation* follows that 302 and silently
re-authenticates, so the page never looks signed out and the next run works. A
*fetch* dies at the cross-origin check. `redirect: 'manual'` made the redirect
visible; the page console named its destination.

**We do not work around it.** A navigation would re-authenticate, but doing that
against an exhausted session was observed to log the user out of ACBL Live for
real — a credentials prompt, not a silent refresh. Losing someone's login to
fetch a second event is not a trade worth making. Continuing to request after
the wall also escalates the block from a 302 to an edge-served `403`.

So the extension fits inside the allowance:

| | |
|---|---|
| One event per fetch | The results listing gets one `Analyze in Bridge Classroom` link per row (`setupRowLinks`), not a page-level button. The date-range batch is gone — its smallest useful run was ~250 requests |
| User's own section only | `COVERAGE.sections` is `user-only`. A two-section event cost 96 board fetches; it now costs 48. That is also the field they were scored against |
| Enter through the user's own pair | The listing is one player's page, so the content script reads the name from the `h1` and the adapter picks that player out of the summary. This is what keeps `user_pair` / `user_result_index` populated |
| Say what happened | A sign-out has its own error code, `session-expired`, and the listing explains it under the row that was clicked |

An event costs ~27 requests (one session, 24 boards) to ~55 (two sessions of
26), so two to three fit in a sign-in. Observed: three events fetched cleanly,
the fourth showed the message, and a sign-out/sign-in restored it.

`bcFetchStats()` in the service-worker console still counts `reusedTab`,
`tabFailed`, `pageFetchErrors`, `authRedirects`, `botChecks`,
`injectionRetries`. The heavier instrumentation that established the above was
removed once it had answered its question — including two instruments that
corrupted their own measurement, both recorded in the doc so they are not
rebuilt.

Fixed along the way, all with tests, all found in real data rather than reasoned:

| | |
|---|---|
| `NS` in the score column | threw, and one bad row discarded the whole board — 22 of 24 boards lost |
| Double-dummy `1/-S` | the dash means "cannot make"; it threw, costing 2 more boards |
| Team games | no board data; skipped before fetching, with a count rather than silently |
| `/my-results` | classified and given per-row links |
| Stop button | only read between events; now aborts the batch signal mid-event |
| "Fetching 0 of 2" | labels count the item in progress, not the ones finished |

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
- **Section coverage.** A board-detail page shows one section. The ACBL Live adapter fetches the *user's own section* only — `session × board`, not `session × section × board` — because `live.acbl.org` allows about 110 requests per sign-in and the section fan-out could spend that on one event. `COVERAGE.sections` says `user-only` so the envelope does not overclaim. BBO differs: its events have sections too, but a traveller carries one row per table across the whole event, so all sections arrive without extra fetches — while section *identity* stays null, because it lives on `tview.php`, which the adapter doesn't fetch. Each adapter declares this in `coverage` (see `docs/normalized-schema.md`).
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

**That override alone is not enough, and this used to say it was.** The shipped
manifest matches `bridge-classroom.org` and `.com` only — the localhost entry
was removed when the `/game-analysis/` hand-off was retired — so on a local page
the ingest content script never runs and the hand-off hangs silently. A local
target needs the test build too:

```bash
npm run build:test    # INGEST_TEST=1 → dist/test, adds localhost to matches and host_permissions
```

Load `dist/test` unpacked, not `dist/chrome`. This is the same build the
Playwright e2e tests load, for the same reason. Run the local analyzer with:

```bash
cd /Users/rick/Development/GitHub/Bridge-Game-Analysis
python3 -m http.server 3001
```

The local server serves the static SPA; extension-path analysis is fully client-side. BWS+PBN file upload still calls the production backend (`game-parser.bridge-craftwork.com`).

## Capturing store screenshots

`npm run build:shots` (`SHOT_MODE=1` → `dist/shots`) is an ordinary build plus a
content script that redacts personal data on every page load —
`src/ui/redactContent.js` running `src/lib/redact.js`. **It never ships**;
`package-stores.sh` refuses any build containing it, the same way it refuses
test origins.

It is a build rather than a console snippet because the snippet worked and was
forgotten once: the first iPhone capture went out carrying a real club manager's
name and email. A build cannot forget.

`tools/capture-ios.sh iphone|ipad` drives the Simulator end to end — clean
status bar, right pixel size, alpha stripped. Two setup steps per simulator
cannot be scripted (enable the extension in Settings; grant website permission
in Safari) and both persist per device. See `docs/screenshot-set.md`.

## When unsure

- Prefer asking before making architecture changes that span multiple files.
- Prefer small, well-tested commits over big sweeping ones.
- If you encounter HTML structure that doesn't match `docs/acbl-live-format.md`, update the doc as part of your fix.
- Update `README.md` status section as you complete phases.
