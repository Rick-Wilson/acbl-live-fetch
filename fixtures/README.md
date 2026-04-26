# Fixtures

Saved HTML pages used for parser tests. These let us iterate on parsers without hitting `live.acbl.org` repeatedly, and they form a regression test suite — when ACBL Live changes their HTML, we capture a new fixture, update the parser, and verify both old and new fixtures still parse correctly.

## Naming convention

```
fixtures/{adapter}/{page-type}-{descriptive-suffix}.html
```

Examples:

```
fixtures/acbl-live/board-detail-event2604321-session2-A-board1.html
fixtures/acbl-live/scorecard-event2604321-session2-A-EW-4.html
fixtures/acbl-live/player-history-3506177.html
```

## How to capture a fixture

1. Navigate to the page in your browser (logged in if it's a player-specific view)
2. Open DevTools console (Cmd+Opt+I on Mac, Ctrl+Shift+I elsewhere)
3. Run:
   ```js
   copy(document.documentElement.outerHTML)
   ```
4. Paste into a new file in this directory with the appropriate name

That's it — the entire rendered page is now in your clipboard, including all data baked into the HTML. (We're capturing the rendered HTML rather than `view-source:` because some content may be Handlebars-rendered client-side.)

## What to capture (Phase 1)

Minimum needed to start:

- [ ] One board-detail page from a session you played
- [ ] The pair scorecard page for that same session

Nice to have for parser robustness:

- [ ] A board-detail page from a different event (different number of pairs, different vulnerability)
- [ ] A board with a doubled or redoubled contract
- [ ] A board with a passed-out result (if any exist in your data)
- [ ] A board where someone went down many tricks (`-1100`, `-1430`, etc.)
- [ ] A board from a multi-section event (to confirm cross-section behavior)

## Privacy note

These fixtures contain real player names and ACBL numbers from public results pages. They're already public data on `live.acbl.org`, so committing them to a public repo is fine — but be aware they will be included.
