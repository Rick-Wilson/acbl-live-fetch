# Start Here

Welcome. Read `CLAUDE.md` and the files in `docs/` first. Then come back here.

## Phase 1, Step 1: Get a parser working against a real fixture

This is the entry point. Don't write the manifest, don't set up the service worker, don't think about UI yet. Build one parser that works on real HTML, with tests that prove it works. Everything else flows from this.

### Confirm fixtures exist

Rick will save HTML fixtures from real `live.acbl.org` pages in `fixtures/acbl-live/`. Expected files:

- `fixtures/acbl-live/board-detail-event2604321-session2-A-board1.html`
- `fixtures/acbl-live/scorecard-event2604321-session2-A-EW-4.html`

If those files don't exist yet, stop and tell Rick. Do not invent fixtures or scrape the live site yourself.

### Set up the project skeleton

```bash
npm init -y
npm install --save-dev vitest jsdom prettier
```

Create:

- `package.json` scripts: `test`, `test:watch`, `format`
- `.prettierrc.json` with 2-space indent, single quotes, no semicolons
- `.gitignore`: `node_modules/`, `dist/`, `.DS_Store`
- `vitest.config.js`: use `jsdom` environment so `DOMParser` works in tests
- `LICENSE`: The Unlicense (full text)

### Write `src/adapters/acbl-live/parsers/boardDetail.js`

A pure function:

```js
export function parseBoardDetail(htmlString, { boardNumber, section } = {}) {
  // Returns a Board object per docs/normalized-schema.md
  // Throws ParseError if expected structure is missing
}
```

The parser should extract:

- Board number (from passed argument; the page itself doesn't reliably contain it)
- Section (from passed argument)
- Dealer and vulnerability from `div.board-data`
- All four hands from the `div.hand` elements
- All result rows from Table 0 (the first `table.tablesorter`), including:
  - Contract (canonical form: e.g., `6S`, `3NT`, `4HX`)
  - Declarer
  - Score (signed, N-S perspective)
  - Matchpoints
  - Percentage
  - Both pairs with player names and ACBL IDs
  - Handviewer URL (kept as a UX convenience field — see CLAUDE.md warning about synthetic auctions)
- Double-dummy makes and par from the page (NOT from the handviewer URL — extract from the visible DOM)

Read `docs/acbl-live-format.md` carefully before writing. It documents every selector and edge case.

Use `DOMParser` from the `jsdom` environment. Do NOT use the global `document`.

### Write `src/lib/parseError.js`

```js
export class ParseError extends Error {
  constructor(message, { selector, html } = {}) {
    super(message)
    this.name = 'ParseError'
    this.selector = selector
    this.htmlSnippet = html?.slice(0, 200)
  }
}
```

Throw this from the parser when expected elements are missing, with enough context to debug.

### Write `tests/adapters/acbl-live/boardDetail.test.js`

Use Vitest. Load the fixture from disk, parse it, assert on:

- Dealer is `"N"`, vulnerability is `"None"`
- North hand has spades `["10","9","8","7","5"]`
- South hand has diamonds `[]` (the void)
- Number of result rows equals the number of N-S pairs that played the board
- The result for the user's pair (Rick Wilson & Andrew Rowberg, EW pair 4) is present and has contract `"4S"`, declarer `"S"`, score `-420`
- Par score is `460` for `5NT` by `N` (or `NS` — confirm format)
- One sample handviewer URL is non-empty and contains `bridgebase.com`
- All ACBL IDs that appear in the fixture are extracted as strings (not numbers — they can have leading characters)

Run with `npm test`. Iterate until green.

### Then commit

```bash
git init
git add .
git commit -m "Initial scaffolding + boardDetail parser with tests"
```

## What's next (don't do this yet)

Once `boardDetail` parses cleanly:

- `parsePairScorecard()` — same shape, parses the pair scorecard page
- `src/adapters/acbl-live/fetcher.js` — given a scorecard URL, fetch all board-detail HTMLs in parallel (use a small bounded concurrency, e.g., 4)
- `src/lib/rateLimiter.js` — bounded concurrent fetch helper
- `src/adapters/acbl-live/index.js` — adapter facade exporting the interface from `docs/architecture.md`
- `src/background.js` — service worker entry; receives messages, dispatches to adapter
- `src/manifest.json` — Manifest V3 declaration
- `src/ui/content.js` — content script that injects "Analyze this session" button on scorecard pages

But again: prove the parser works first. Everything else assumes that foundation.

## Tips

- When you're not sure about HTML structure, ask Rick to run a probe in the browser console and paste output. He's been doing this throughout the recon phase and is comfortable with it.
- If the fixture has more pairs/sections than you expect, treat it as a feature: your parser should handle variable numbers of result rows.
- Keep the parser's output strictly aligned with `docs/normalized-schema.md`. If you find you need a field that isn't in the schema, update the schema doc as part of your change.
- Prefer specific failure messages: `"Could not find div.board-data — has live.acbl.org changed?"` is far more useful than `"Cannot read property 'textContent' of null"`.
