# ACBL Live Fetch

Browser extension that extracts bridge results from supported sites and hands them to [Bridge Game Analysis](https://game-analysis.bridge-classroom.com) for board-by-board cause analysis.

## Supported sources

- **ACBL Live** (`live.acbl.org`) — tournament results
- **My ACBL** (`my.acbl.org`) — club game results
- **BBO** (`bridgebase.com`) — hand records

## Installation

Load unpacked from `dist/chrome/` in `chrome://extensions` (Developer mode on).

Build first:

```bash
npm install
npm run build:chrome
```

## Usage

Navigate to a results page on a supported site. Click the extension icon, then click **Extract**. The extension opens the analyzer in a new tab and hands off the data automatically.

## Development

### Local analyzer target

By default the extension opens `https://game-analysis.bridge-classroom.org/analyze`. To target a local dev server instead, open the background service worker console in `chrome://extensions` and run:

```js
chrome.storage.local.set({ devAnalyzerUrl: 'http://localhost:3001/analyze' })
```

Revert to production:

```js
chrome.storage.local.remove('devAnalyzerUrl')
```

No rebuild needed. Start the local analyzer with:

```bash
cd ../Bridge-Game-Analysis
python3 -m http.server 3001
```

### Build targets

```bash
npm run build:chrome    # Chrome / Edge
npm run build:firefox   # Firefox
npm run build:all       # All browsers
```

Output lands in `dist/<browser>/`.

### Tests

```bash
npm test
```

210 unit tests covering adapters, parsers, and background message handling.
