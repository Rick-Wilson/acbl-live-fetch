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

The service worker holds an ordered registry of adapters in `src/background/handlers.js`. When an `extract-session` message arrives, the dispatcher picks the first adapter whose `matchesUrl(url)` returns true and delegates the rest of the work to it. New sources are added by writing an adapter and appending it to the registry — no other code path needs to change.

Adapters today:

| Adapter | Hostname | Page types | Output `source` |
|---|---|---|---|
| `acbl-live` | `live.acbl.org` | `pair-scorecard`, `board-detail`, `event-summary`, `player-history` | `"acbl-live"` |
| `acbl-live-club` | `my.acbl.org` | `club-game-result` | `"acbl-live-club"` |

Both emit the same envelope shape (top-level `tournaments[]`, `Tournament > Event > Session > Board > Result`); only the `source` field differs. See [normalized-schema.md](normalized-schema.md).

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

Content script sends to background:

```js
{
  type: 'extract-session',
  url: 'https://live.acbl.org/event/2604321/2501/2/scores/A/E/4',
  options: { /* future: deep / shallow modes */ }
}
```

Background responds:

```js
{ type: 'extraction-progress', completed: 3, total: 27 }
{ type: 'extraction-progress', completed: 27, total: 27 }
{ type: 'extraction-complete', data: NormalizedSession }
// or
{ type: 'extraction-error', error: { code, message } }
```

## Handoff to the analyzer

The session payload is handed to the analyzer SPA (`club-game-analysis.bridge-classroom.com`) via the user's own `window.sessionStorage`, bridged by a second content script. No server round-trip; data is ephemeral and per-tab.

Sketch of the flow:

1. Service worker finishes extraction → generates a UUID → writes `{ <uuid>: NormalizedSession }` to `chrome.storage.local` under a `pending-sessions:` namespace.
2. Service worker opens `https://club-game-analysis.bridge-classroom.com/analyze#sid=<uuid>` via `chrome.tabs.create`.
3. The analyzer content script (`src/ui/analyzerContent.js`, `run_at: "document_start"`) reads the fragment, requests the session from the service worker via `chrome.runtime.sendMessage`, writes the JSON envelope to `window.sessionStorage` under the key `pending-session`, and the service worker deletes the `chrome.storage.local` entry.
4. The SPA reads `sessionStorage.getItem('pending-session')` on mount, removes the key, and renders.

Why this shape:

- **No server endpoint required** — the analyzer is a static SPA today, and we don't want to provision storage/auth for ephemeral data.
- **Same-origin** — `sessionStorage` is partitioned per origin and per tab, so the payload never crosses tabs and dies when the tab closes.
- **Per-tab navigation works** — opening the same URL in a new tab triggers a fresh handoff via the new fragment.

Full protocol — message types, JSON envelope shape, SPA contract, error states, and timing notes — in [docs/handoff-protocol.md](handoff-protocol.md).

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
├── background/handlers.js     │
├── ui/                        │  Extension shell — chrome.* / browser.* APIs,
│   ├── sourceContent.js       │  page injection, message routing. Runs in
│   └── analyzerContent.js     │  the browser-extension sandbox.
│
├── adapters/                  ┐
│   ├── acbl-live/             │  ACBL Live tournament source: per-pair
│   │   ├── index.js           │  scorecards on live.acbl.org, multi-fetch
│   │   ├── fetcher.js         │  across sessions × sections × boards.
│   │   └── parsers/           │
│   │
│   └── acbl-live-club/        │  ACBL my.acbl.org club-game source:
│       ├── index.js           │  single fetch, data embedded as a Vue prop
│       ├── extractor.js       │  on a <result-details> element.
│       └── parsers/           │
│
├── lib/                       ┐  Extraction utilities (rateLimiter,
│   ├── parseError.js          │  parseError, etc.). Shared across adapters.
│   └── rateLimiter.js         ┘
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

The base `manifest.json` is Chrome-compatible (Manifest V3, `service_worker`). Per-browser manifest overrides live in `vite.config.js` under `PER_BROWSER_OVERRIDES`. They're empty today — every target uses the Chrome manifest unmodified — but the structure is in place for when Firefox / Safari quirks force divergence (e.g., Firefox MV3's `background.scripts` event-page form, Safari's `browser_specific_settings`).

Source files use `browser.*` via `webextension-polyfill`:

- The polyfill is a runtime dep (`dependencies`, not `devDependencies`).
- Service worker imports it directly at the top.
- Content scripts dynamic-import it inside the entry-point branch — keeps test imports of those modules clean (no extension-API dependency surfaces during `vitest run`).

Today only Chrome is published. Firefox / Safari are local-smoke-test targets until they're explicitly QA'd.

## Future considerations

- **Cross-section results** — board-detail only shows one section. To get all results across sections, need to fetch each section separately. Add when needed.
- **Caching** — past sessions don't change. Cache parsed data by `(source, sanction, event_id, session_number)` in `browser.storage.local`.
- **Progress UI** — for long extractions, show progress in the injected button or a popup.
- **Plugin loader for analysis** — when the analyzer side is ready to ship inside the extension instead of as a separate website, it'll land under `src/analysis/` with a stable `(envelope) → renderable` interface. The shell stays untouched.
