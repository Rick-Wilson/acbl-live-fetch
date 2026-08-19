# Bridge Classroom Fetch

Browser extension that extracts bridge results from the page you are already
looking at and hands them to [Bridge Classroom](https://bridge-classroom.org)
for board-by-board cause analysis — why a result was good or bad, in the
bidding, the play or the defence.

No downloading PBN and BWS files and uploading them again. On tournament
results, which offer no downloadable files at all, no clicking through every
board by hand.

## Supported sources

| Site | What it yields | Login |
|---|---|---|
| `live.acbl.org` | Tournament results — one event per click, your own section | ACBL |
| `my.acbl.org` | Club game results, every board and section | none |
| Bridge Base Online | A session, a whole tournament, a single deal, or a date range of your history — up to all of it | BBO, except the hand viewer and `tview.php` |

Three of the four are usable with no account at all.

**Two ACBL Live limits are deliberate, not unfinished.** One event per click,
and your own section only — `live.acbl.org` serves roughly 110 requests per
sign-in and a section fan-out could spend all of it on one event. See
[docs/acbl-rate-limit.md](docs/acbl-rate-limit.md).

**ACBL Live team events are not supported yet** — the entry point is a
pair-scorecard link, and a team event's summary has none.

## Usage

Open a results page on a supported site. The extension adds a button or a link
to the page itself — there is no popup, and the toolbar icon is only a badge:

- **ACBL Live results listings** — `Analyze in Bridge Classroom` in each row's
  Links column. On a tournament's event list, which names no player, it asks
  which pair first.
- **`my.acbl.org`** — in the page navigation.
- **BBO** — merged into the hands-list header, above the lobby's history list,
  as an overlay on a tournament view, or in the hand viewer's own control row.

Click it. The extension reads that game's boards, contracts, scores and
comparisons and opens Bridge Classroom with them.

## Installation

Published on the **Chrome Web Store**, **Microsoft Edge Add-ons** and
**addons.mozilla.org**.

The Safari version is built and not submitted yet. It covers **macOS, iPad and
iPhone** — and Safari is the only browser engine on iPad and iPhone, so it is
the only way to reach those users at all. See
[docs/store-review.md](docs/store-review.md) for the state of each store.

On iPhone and iPad, enabling the extension in Settings is not enough on its own:
Safari also grants page access per site. Until that is granted the extension is
installed, enabled, and does nothing at all — no button and no error. Open the
page menu (on iPhone the address bar is usually at the *bottom*), allow
Bridge Classroom Fetch, and reload.

To run from source, load unpacked from `dist/chrome/` in `chrome://extensions`
(Developer mode on), having built first:

```bash
npm install
npm run build:chrome
```

## Development

### Local analyzer target

Results go to `https://bridge-classroom.org/ingest/?v=1`, which forwards them to
whichever Bridge Classroom tool the user picks — see
[docs/ingest-protocol.md](docs/ingest-protocol.md).

Pointing that at a local server takes **two** steps, not one. The runtime
override says where to send the results:

```js
// background service worker console, from chrome://extensions
chrome.storage.local.set({ devIngestUrl: 'http://localhost:3001/ingest/?v=1' })
chrome.storage.local.remove('devIngestUrl')   // back to production
```

But the results are delivered by a content script, and the shipped manifest
matches `bridge-classroom.org` and `.com` only — deliberately, since a localhost
permission in a store listing invites reviewer questions for no user benefit.
So a **local target also needs the test build**, which adds localhost,
`127.0.0.1` and the GitHub Pages origin to both the content-script matches and
the host permissions:

```bash
npm run build:test          # INGEST_TEST=1 → dist/test
```

Load `dist/test` unpacked rather than `dist/chrome`. Without it the override
sends the payload to a page that has no content script listening, and the
hand-off hangs with nothing in the console to say why. `scripts/package-stores.sh`
refuses to package any build carrying those origins.

Start the local analyzer with:

```bash
cd ../Bridge-Game-Analysis
python3 -m http.server 3001
```

### Build targets

```bash
npm run build:chrome    # Chrome
npm run build:edge      # Edge
npm run build:firefox   # Firefox
npm run build:safari    # source for the Xcode project
npm run build:all       # all four
```

Output lands in `dist/<browser>/`. `scripts/package-stores.sh` builds all of
them into store-ready archives, plus the source archive Firefox review requires,
and refreshes the Safari project's resources.

### Tests

```bash
npm test         # 470 unit tests
npm run test:e2e # 5 Playwright tests over the ingest hand-off
```

Unit tests cover adapters, parsers, background message handling and the injected
UI. Parsers are pure functions over HTML strings, so they run identically in a
service worker and a content script.

### Where to read next

- [docs/architecture.md](docs/architecture.md) — the adapter pattern, and the
  cross-browser builds
- [docs/data-sources.md](docs/data-sources.md) — what each site yields and how
  it has to be fetched; three of them broke a naive `fetch()` differently
- [docs/normalized-schema.md](docs/normalized-schema.md) — the one envelope all
  sources produce

## Licence

The Unlicense — public domain. See [LICENSE](LICENSE).
