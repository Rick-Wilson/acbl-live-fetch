# Architecture

## Design principles

1. **Pluggable sources.** Every supported site is an adapter with a uniform interface. Adding a new source means writing a new adapter, not touching core code.

2. **Parsers are pure functions.** `parse(htmlString) → structuredData`. They have no side effects, no DOM access beyond `DOMParser`. This makes them trivially testable and lets the same parser code run in service workers or content scripts.

3. **Service worker is the orchestrator.** It receives the user's intent from the UI, picks the adapter, fetches everything in parallel (rate-limited), and assembles the final output.

4. **Normalize early.** Each adapter emits the same JSON schema. Downstream code (the analyzer) only knows the schema, not the source.

5. **Resilience over cleverness.** ACBL Live's HTML could change. Parsers should validate their assumptions and throw clear errors when structure doesn't match expectations, rather than silently producing wrong output.

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

## Handoff to bridge-classroom.com

Two options to evaluate:

**Option A — POST + redirect:**

1. Background POSTs JSON to `https://bridge-classroom.com/api/import-session`
2. Server stores it, returns an ID
3. Background opens `https://bridge-classroom.com/analyze/{id}` in a new tab

**Option B — chrome.storage + externally_connectable:**

1. Background writes data to `chrome.storage.local` under a known key
2. Background opens `https://bridge-classroom.com/analyze` in a new tab
3. The site's JS reads from extension storage via `chrome.runtime.sendMessage`

Option A is simpler. Option B avoids server-side storage if the user only wants ephemeral analysis. Start with A; add B later if needed.

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

## Future considerations

- **Player history** (`/player-results/{id}`) — adds longitudinal data. Big in scope, save for Phase 3.
- **Cross-section results** — board-detail only shows one section. To get all results across sections, need to fetch each section separately. Add when needed.
- **Caching** — past sessions don't change. Cache parsed data by `(source, event_id, session_id)` in `chrome.storage.local`.
- **Progress UI** — for long extractions, show progress in the injected button or a popup.
