# Build instructions

For addons.mozilla.org source review. These steps reproduce the uploaded
package exactly; we check that before every submission by extracting this
archive into a clean directory and diffing the result against the artifact.

## Requirements

| | |
|---|---|
| Operating system | Any that runs Node.js. Built and verified on macOS 15 (arm64); nothing in the build is platform-specific |
| Node.js | **20 or newer**. Built and verified with **22.11.0** |
| npm | **10 or newer**. Built and verified with **10.9.0** |
| Network | Needed once, for `npm ci` to fetch the dependencies in `package-lock.json` |

Install Node.js from <https://nodejs.org/> — the LTS installer includes npm.
On macOS `brew install node@22` works equally well. Check with:

```bash
node --version    # v22.11.0
npm --version     # 10.9.0
```

No other tool is required. No global npm packages, no compilers, no native
build steps.

## Build

One command, from the root of this archive:

```bash
./build.sh
```

That script is the whole process. It runs:

```bash
npm ci                            # exact dependency versions from package-lock.json
BROWSER=firefox npx vite build --outDir dist/firefox
```

The output is **`dist/firefox/`**, which is the contents of the uploaded
package — zip that directory and you have the submitted file.

`npm ci` rather than `npm install`: it installs precisely what
`package-lock.json` pins, which is what makes the result reproducible.

## What the build does

- **Vite 6** bundles the ES modules and minifies the result (Rollup underneath).
- **@crxjs/vite-plugin 2** emits the manifest and the content-script loaders.
- `BROWSER=firefox` selects the Firefox manifest details in `vite.config.js`:
  `browser_specific_settings.gecko`, and the event-page `background.scripts`
  form in place of `background.service_worker`. The whole per-browser
  difference is one small literal object in that file.

Nothing is fetched at build time beyond the npm dependencies, and nothing is
fetched at run time: no remote code, no `eval`, no externally hosted scripts.

## Source layout

```
src/                 all first-party source — plain ES modules, not generated
  background.js      MV3 background entry point
  background/        message handling and orchestration
  ui/                the three content scripts
  adapters/          one per site: acbl-live, acbl-live-club, bbo
  lib/               shared utilities
manifest.json        the base manifest; vite.config.js layers per-browser keys on
vite.config.js       build configuration
icons/               committed PNGs, rasterised from icons/icon.svg
tests/               unit tests (vitest) and end-to-end tests (playwright)
fixtures/            saved HTML the parsers are tested against
docs/                design notes, including the data sources and schema
```

`icons/*.png` are committed rather than generated during the build. They are
produced from `icons/icon.svg` by `node scripts/render-icons.mjs`, which needs
Playwright's Chromium; that step is deliberately kept out of the build so no
browser download is required to build the extension.

## Tests, if useful

Not required to build, but they run offline and quickly:

```bash
npm test          # 374 unit tests
npm run test:e2e  # 5 end-to-end tests; downloads Chromium on first run
```

## A note on the two linter warnings

`addons-linter` reports two `UNSAFE_VAR_ASSIGNMENT` warnings for `innerHTML` in
the bundled background chunk. Both are inside **linkedom**, a third-party
pure-JS DOM implementation, declared in `package.json` and bundled because MV3
service workers do not expose `DOMParser` and the HTML parsers require one —
see the top of `src/background.js`, which installs it on `globalThis`.

One flagged site is linkedom's fragment parser; the other is its `Element`
class *defining the accessor itself*, `set innerHTML(t) {...}`. The linter is
flagging the implementation of `innerHTML`, not a use of it.

Neither touches a live document: the parsers run in the service worker against
HTML strings fetched from the user's own results pages.

No first-party source assigns to `innerHTML` at all:

```bash
grep -rn innerHTML src/     # no matches
```
