# Architecture

## Design principles

1. **Pluggable sources.** Every supported site is an adapter with a uniform interface. Adding a new source means writing a new adapter, not touching core code.

2. **Parsers are pure functions.** `parse(htmlString) → structuredData`. They have no side effects, no DOM access beyond `DOMParser`. This makes them trivially testable and lets the same parser code run in service workers or content scripts.

3. **Service worker is the orchestrator.** It receives the user's intent from the UI, picks the adapter, fetches everything in parallel (rate-limited), and assembles the final output.

4. **Normalize early.** Each adapter emits the same JSON schema. Downstream code (the analyzer) only knows the schema, not the source.

5. **Resilience over cleverness.** ACBL Live's HTML could change. Parsers should validate their assumptions and throw clear errors when structure doesn't match expectations, rather than silently producing wrong output.

6. **Cross-browser by default.** All extension entry points use the WebExtension `browser.*` namespace via `webextension-polyfill`, never `chrome.*` directly. The same source bundle runs on Chrome, Edge, Firefox, and Safari; the build emits per-browser artifacts that differ only in manifest details.

7. **Event-driven, stateless service worker.** Handlers may run after the SW has been suspended and re-spun by the browser, so we never keep state in module-level variables. Anything that needs to survive between handler invocations lives in `browser.storage.local`. This keeps Firefox's event-page semantics and Safari's SW model honest.

8. **Extension shell is separable from analysis logic.** The code in this repo is the _extension shell_ — extraction adapters, fetchers, content scripts, service worker. Analysis logic (the bridge-classroom analyzer) lives elsewhere and consumes the normalized envelope. A future plugin loader (likely GitHub-Pages-hosted) will let the analyzer side evolve without going through extension-store reviews; today the boundary is enforced by directory layout — see [§ Repo layout](#repo-layout) — so the loader can land cleanly later.

## Adapter registry

The service worker holds an ordered registry of adapters in
`src/background/handlers.js`. When an `extract-session` message arrives, the
dispatcher picks the first adapter whose `matchesUrl(url)` returns true and
delegates the rest of the work to it. New sources are added by writing an
adapter and appending it to the registry — no other code path needs to change.

Adapters today, in registry order:

| Adapter | Hostname | Page types | `source` |
|---|---|---|---|
| `acbl-live-club` | `my.acbl.org` | `club-game-result`, `club-results-list` | `"acbl-live-club"` |
| `acbl-live` | `live.acbl.org` | `pair-scorecard`, `board-detail`, `event-summary`, `player-history` | `"acbl-live"` |
| `bbo` | `bridgebase.com` | `handviewer`, `hands-list`, `traveller`, `tournament-view` | `"bbo"` |

Order matters only where match patterns could overlap; today they are disjoint
by hostname, so the registry order is not load-bearing.

All three emit the same envelope shape (top-level `tournaments[]`,
`Tournament > Event > Session > Board > Result`); only `source` and `coverage`
differ. Each adapter exports its own `COVERAGE` describing what it can and
cannot see — BBO cannot name sections, ACBL Live derives them from the pair
directory. See [normalized-schema.md](normalized-schema.md).

Each adapter also classifies pages it will not extract. `bbo` matches
`hands.php?traveller=` and returns `traveller`, but the UI deliberately injects
no button there — see [data-sources.md](data-sources.md) § 3.6a.

## Component contracts

### Adapter interface

Each adapter exports:

```js
{
  // Identifying info
  name: 'acbl-live',
  matchesUrl(url) { return boolean },        // does this adapter handle this URL?

  // Page-type detection
  classifyPage(url) {
    return 'pair-scorecard' | 'board-detail' | 'player-history' | 'unknown';
  },

  // Main entry point — given a URL on this source, return normalized data
  async extractSession(url, { fetch, signal }) {
    return NormalizedSession;  // see normalized-schema.md
  }
}
```

### Parser contract

Each parser is a pure function:

```js
parseBoardDetail(htmlString) → BoardDetail
parsePairScorecard(htmlString) → Scorecard
```

They throw `ParseError` if expected structure isn't found. They never use the global `document`.

### Fetcher contract

```js
async fetchAll(urls, { concurrency = 4, delayMs = 0, signal }) {
  // Returns: Map<url, htmlString | Error>
}
```

Bounded concurrency. Polite delays between batches. Honors AbortSignal.

## Service worker message protocol

Content scripts talk to the background over `browser.runtime.sendMessage`.
Every message is an object with a `type`. The main ones:

| From the page side | Purpose |
|---|---|
| `extract-session` | Extract the one session at `url` |
| `extract-batch` | Extract many events — the ACBL club list and BBO lobby paths |
| `extract-shortlink` | Resolve a BBO shortlink, then extract |
| `cancel-batch` | Stop an in-flight batch, keyed by its batch key |
| `get-bbo-username` | Ask the worker who is signed in to BBO |
| `open-bbo-batch-tab`, `close-current-tab` | Tab plumbing for the lobby flow |

The worker replies with `extraction-complete` (carrying the envelope),
`extraction-error`, or `batch-started` for the batch paths. Batch progress is
**not** pushed as messages — it is written to `browser.storage.local` under a
progress key and polled by the button, because the worker may be suspended and
respun between updates and a message would be delivered to nobody. This is the
same reason nothing is kept in module-level variables (design principle 7).

`extraction-error` carries a `code`: `bad-request` for a malformed message,
`parse-error` when a parser rejects the page's structure, `unknown-message-type`
for an unrecognised `type`, and `unexpected` for anything else. The message
text is user-facing — it is what the injected button displays — so it should
say what to do, not just what failed. See the Cloudflare-challenge case in
`src/lib/rateLimiter.js` for the shape to aim for.

The ingest bridge (`begin` / `chunk` / `finish` / `ack` / `ready`) is a separate
`postMessage` channel between page and content script, not this one — see
[ingest-protocol.md](ingest-protocol.md).

There is also `dev-bulk-extract`, a developer-only path triggered by the
`#bcdev-mega` hash on the BBO lobby. It bypasses the analyzer and saves raw
JSON for offline work; it is deliberately not surfaced in the production UI.

## Handoff to the analyzer

Results go to a versioned ingest page, which forwards them to whichever Bridge
Classroom tool the user picks:

```
https://bridge-classroom.{org,com}/ingest?v=1#sid=<uuid>     one session
https://bridge-classroom.{org,com}/ingest?v=1#batch=<uuid>   many events
```

`?v=1` versions the **transport**, not the payload: every envelope carries its
own `schema_version`, and the page dispatches on that for shape. Bump `v` only
when the message sequence changes.

The service worker stores the envelope in `browser.storage.local` under a
pending key, opens the ingest URL with the reference in the fragment, and
`src/ui/ingestContent.js` bridges page and worker over `window.postMessage`.
Every message carries `channel: 'bc-ingest'`, `v: 1`, a `type`, and the `ref`.

**The page speaks first.** It emits `ready`, and only then does the content
script request the payload and stream it back as `begin` → `chunk`* → `finish`,
with the page replying `ack`. `postMessage` has no delivery guarantee to a
listener that is not yet attached, so the content script waits rather than
firing blind. Two rules keep the handshake alive across startup ordering, both
added after an end-to-end test found it stranded: the page repeats `ready`
every 250 ms until `begin` arrives, and the content script attaches its
listener synchronously at `document_start`, before any `await`.

The fragment is cleared only after `ready` arrives — clearing earlier races the
page's own read of the hash, and the page cannot recover a `ref` it never saw.

Full protocol — message shapes, chunking, timeouts, security checks and the
page contract — in [ingest-protocol.md](ingest-protocol.md). Why this replaced
the earlier `sessionStorage` handoff is [ADR 0001](adr/0001-ingest-endpoint-and-postmessage-handoff.md).

> **Historical note.** Until mid-2026 the payload was written directly into the
> page's `sessionStorage` by an `analyzerContent.js` content script, targeting
> `club-game-analysis.bridge-classroom.com`. That script and that path are
> gone; the ingest route is the only one. If you find a reference to either,
> it is stale.

## Rate limiting policy

Default: 4 concurrent requests, no delay between requests within a batch.

For player-history deep fetches (potentially hundreds of sessions): 2 concurrent, 100ms jitter.

Honor 429 / 503 responses with exponential backoff. Cancel everything if the user closes the tab or aborts.

## Error handling philosophy

Parsing errors should be **loud and specific** — better to show "Could not find results table on board-detail page; ACBL Live HTML may have changed" than to silently emit incomplete data.

Fetch errors should be **retried twice with backoff** before surfacing.

Network errors during a partial extraction: emit what's available, mark the session as `partial: true`.

## Testing strategy

Saved HTML fixtures in `fixtures/`. Each parser has a corresponding test that:

1. Loads a fixture
2. Parses it
3. Asserts on specific fields (board number, dealer, hand contents, all expected results present)

When ACBL Live changes their HTML, capture a new fixture, update the parser, the tests confirm both old and new fixtures parse correctly.

For the orchestrator, mock `fetch` to return canned fixtures.

## Extraction phases (v1 / v2 / v3)

The schema's top-level `tournaments: [...]` array (see [normalized-schema.md](normalized-schema.md)) is the same shape across three extraction modes; only the count of children at each level grows. This lets the analyzer side handle one schema regardless of which mode the user invoked.

- **v1 — single event with all its sessions** (today's scope). Click "Analyze" on a pair scorecard. We emit one tournament containing one event containing one session — and, when the scorecard's session-select dropdown lists more, all sibling sessions for the same pair under that event.
- **v2 — whole tournament**. Driven from the tournament's schedule page (`https://tournaments.acbl.org/schedule.php?sanction={sanction}`), which lists every event held under that sanction. The adapter discovers each event's pair-scorecard URLs and runs v1's session-fetch per event. Output: one tournament with multiple events.
- **v3 — player history**. Driven from `live.acbl.org/player-results/{player_id}`. Each entry is a tournament the player attended; we walk to each one and run v2 (or v1 if only one event). Output: many tournaments.

The currently implemented extractor only does the v1 single-session case (`extractSession` in `src/adapters/acbl-live/index.js`). Multi-session-per-event, then v2, then v3 are explicit follow-on phases.

## Repo layout

The boundary between **extension shell** and **analysis** is enforced by directory:

```
src/
├── background.js              ┐
├── background/handlers.js     │  Extension shell — browser.* APIs, page
├── ui/                        │  injection, message routing, ingest bridge.
│   ├── sourceContent.js       │  Runs in the browser-extension sandbox.
│   ├── bboLobbyContent.js     │
│   └── ingestContent.js       ┘
│
├── adapters/                  ┐
│   ├── acbl-live/             │  live.acbl.org tournaments: per-pair
│   │   ├── index.js           │  scorecards, multi-fetch across
│   │   ├── fetcher.js         │  sessions x sections x boards.
│   │   └── parsers/           │
│   │                          │
│   ├── acbl-live-club/        │  my.acbl.org club games: single fetch,
│   │   ├── index.js           │  data embedded as a Vue prop on a
│   │   ├── extractor.js       │  <result-details> element.
│   │   └── parsers/           │
│   │                          │
│   └── bbo/                   │  bridgebase.com: hand viewer, hands list,
│       ├── index.js           │  travellers, tournament view. LIN parsing
│       └── parsers/           ┘  lives here.
│
├── lib/                       ┐  Extraction utilities — rateLimiter,
│   ├── doubleDummy.js         │  parseError, provenance, tableCount,
│   ├── parseError.js          │  doubleDummy. Shared across adapters.
│   ├── provenance.js          │
│   ├── rateLimiter.js         │
│   └── tableCount.js          ┘
│
└── analysis/                  ─  Reserved. Analysis logic lives elsewhere
   (does not exist yet)           today; will be added as a plugin loader.
```

**Rules:**

- Code under `adapters/` and `lib/` must not import from `background/`, `ui/`, or any browser-extension API. It should run in plain Node tests.
- Code under `background/` and `ui/` may import from `adapters/` and `lib/`.
- Nothing imports from `analysis/` yet. When the plugin loader arrives, it will fetch analysis modules at runtime (likely from a GitHub-Pages bucket) and route normalized envelopes into them. The extraction code shouldn't change shape.

## Cross-browser builds

Same source, per-browser artifacts. Vite reads `BROWSER` from the environment (defaults to `chrome`) and emits to `dist/<browser>/`:

```
npm run build:chrome   → dist/chrome/
npm run build:firefox  → dist/firefox/
npm run build:edge     → dist/edge/
npm run build:safari   → dist/safari/
npm run build:all      → all four
```

The base `manifest.json` is Chrome-compatible (Manifest V3, `service_worker`). Per-browser manifest overrides live in `vite.config.js` under `PER_BROWSER_OVERRIDES`:

- **Chrome / Edge** — no overrides; the base Chromium MV3 manifest is used unchanged.
- **Firefox** — adds `browser_specific_settings.gecko.id` (required) and replaces `background.service_worker` with `background.scripts: ['src/background.js']` (the form `@crxjs/vite-plugin` requires for Firefox builds). `strict_min_version: 121.0` ensures full MV3 service-worker support at runtime.
- **Safari** — uses the base manifest. Distribution to the Mac/iOS App Store requires running `dist/safari/` through Xcode's `safari-web-extension-converter`, which wraps it in a native app shell.

Source files use `browser.*` via `webextension-polyfill`:

- The polyfill is a runtime dep (`dependencies`, not `devDependencies`).
- Service worker imports it directly at the top.
- Content scripts dynamic-import it inside the entry-point branch — keeps test imports of those modules clean (no extension-API dependency surfaces during `vitest run`).

All four browsers are QA'd as of August 2026. Chrome is the only one published
so far; the other three are built, loaded, and exercised.

Each was run against both no-account paths in [store-review.md](store-review.md)
§ 2 — the hand viewer, and the `my.acbl.org` club game. The club game is the one
that matters: it is the only path that exercises the **`scripting`** machinery,
because both ACBL sites return 403 to a background-worker fetch, so the request
is issued from inside one of the user's own tabs instead. That is the most
platform-sensitive code in the extension, and the hand viewer reaches none of it
— it makes no network request at all, reading the deal from the URL.

| | How it was loaded | Hand viewer | Club game |
|---|---|---|---|
| Chrome | unpacked | ✓ | ✓ |
| Edge | unpacked, on Windows under Parallels | ✓ | ✓ |
| Firefox | `web-ext run` | ✓ | ✓ |
| Safari | *Add Temporary Extension…* | ✓ | ✓ |

Notes worth carrying forward:

- **Edge** was tested on Windows rather than macOS, which is where the great
  majority of Edge users are. `dist/edge` is byte-for-byte identical to
  `dist/chrome` — its entry in `PER_BROWSER_OVERRIDES` is `{}` — and to the
  contents of the packaged `-edge.zip`, so loading the directory tested exactly
  the bytes that go to Partner Center.
- **Firefox** reports 0 errors from `web-ext lint`; the 2 remaining warnings are
  false positives inside linkedom. See [store-review.md](store-review.md) § 3c,
  which also records why `strict_min_version` is 140.
- **Safari** shipped a manifest declaring icon paths that were not inside the
  `.appex`, because Xcode bundles only what `project.pbxproj` references and
  `icons/` was never registered. Fixed; see § 3bb there for the diff command
  that catches it recurring.

One gap remains, and it is Safari's alone: **whether the packaged app registers
its extension with Safari.** The temporary-extension route loads `dist/safari`
directly, which is byte-identical to what the `.appex` bundles, so it proves the
extension's behaviour but not the app's registration — and the App Store ships
an app. A build run from a temporary directory did not appear under Installed;
whether that was the path or an unticked "Allow unsigned extensions" is untested.

## Future considerations

- **Cross-section results** — board-detail only shows one section. To get all results across sections, need to fetch each section separately. Add when needed.
- **Caching** — past sessions don't change. Cache parsed data by `(source, sanction, event_id, session_number)` in `browser.storage.local`.
- **Progress UI** — for long extractions, show progress in the injected button or a popup.
- **Plugin loader for analysis** — when the analyzer side is ready to ship inside the extension instead of as a separate website, it'll land under `src/analysis/` with a stable `(envelope) → renderable` interface. The shell stays untouched.
