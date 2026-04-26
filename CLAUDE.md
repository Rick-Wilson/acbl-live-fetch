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

## What's been done

- Project structure and docs are scaffolded.
- HTML format for ACBL Live's board-detail page is well-documented in `docs/acbl-live-format.md`.
- Normalized JSON schema is defined in `docs/normalized-schema.md`.
- HTML fixtures will be saved by Rick in `fixtures/acbl-live/` — confirm they exist before writing parsers.

## What to do (read `START_HERE.md`)

The first concrete task is in `START_HERE.md`. Do not skip it — it sets up the testing harness and gets you a working `parseBoardDetail()` against a real fixture before you build anything else.

## Things to be careful about

- **The auction in BBO handviewer URLs is synthetic, not real.** ACBL Live does not capture per-table auctions. Do not extract or use it for analysis. The `auction` field in the normalized schema must be `null` for ACBL Live data.
- **Em-dash for voids.** Hand parser must handle `—` (U+2014) as void.
- **Two tables per board-detail page.** Table 0 is N-S view, Table 1 is E-W view. Use Table 0 only — it contains every result.
- **Section coverage.** The board-detail page only shows results from one section. For multi-section events, fetching all sections is a future feature; document this limitation but don't build it yet.
- **Player IDs may be missing** for unregistered players. Handle the absence of `data-acbl` gracefully (`acbl_id: null`).
- **HTML changes.** When ACBL Live updates their HTML, parsers should fail loudly with specific error messages, not produce silently-wrong data. Validate structural assumptions.

## When unsure

- Prefer asking before making architecture changes that span multiple files.
- Prefer small, well-tested commits over big sweeping ones.
- If you encounter HTML structure that doesn't match `docs/acbl-live-format.md`, update the doc as part of your fix.
- Update `README.md` status section as you complete phases.
