import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import baseManifest from './manifest.json' with { type: 'json' }

// Cross-browser builds. Today only Chrome is published, but the structure
// supports Edge / Firefox / Safari without source changes — see
// docs/architecture.md § Cross-browser builds. Run `BROWSER=firefox npm run
// build` (etc.) to emit a per-browser bundle.
const BROWSER = process.env.BROWSER ?? 'chrome'

const PER_BROWSER_OVERRIDES = {
  // Chrome and Edge use the base Chromium MV3 manifest unchanged.
  chrome: {},
  edge: {},

  // Firefox MV3 requires a unique extension id under browser_specific_settings.
  // It also uses the event-page background.scripts form rather than
  // background.service_worker (the @crxjs/vite-plugin firefox build path
  // requires this).
  //
  // data_collection_permissions is required for all new Firefox extensions,
  // and Firefox shows it to the user at install time.
  //
  // This said `none` until it was checked against what the envelope actually
  // carries. `none` means "does not collect or transmit any personal data",
  // and the extension does transmit: Player is { name, acbl_id, ... } — a real
  // name and a national-body ID — sent off-device to bridge-classroom.org
  // whenever the source is ACBL. Mozilla's taxonomy has terms for exactly that.
  //
  // There is no server and no telemetry here, which is what made `none` feel
  // right; but "collect" in every store's sense means "leaves the device", not
  // "reaches us". Same error was made on Chrome's disclosure and corrected
  // there. See docs/submission-answers.md § Data use.
  //
  // That key forces the version floors: it landed in Firefox 140 and in
  // Firefox for Android 142, so 121 (which was only ever about MV3
  // service-worker support) would make the declaration a lint error. The two
  // floors differ, hence the separate gecko_android block.
  firefox: {
    background: {
      scripts: ['src/background.js'],
    },
    browser_specific_settings: {
      gecko: {
        id: 'bridge-classroom-fetch@bridge-classroom.org',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['personallyIdentifyingInfo', 'websiteContent'],
        },
      },
      gecko_android: {
        strict_min_version: '142.0',
      },
    },
  },

  // Safari accepts the Chrome MV3 manifest as-is at the build level. Final
  // distribution to the Mac/iOS App Store requires running the build through
  // Xcode's `safari-web-extension-converter`, which wraps it in a native app
  // shell. The dist/safari/ output is the source for that conversion step.
  safari: {},
}

if (!Object.hasOwn(PER_BROWSER_OVERRIDES, BROWSER)) {
  throw new Error(
    `Unknown BROWSER=${BROWSER}. Supported: ${Object.keys(PER_BROWSER_OVERRIDES).join(', ')}.`
  )
}

const manifest = { ...baseManifest, ...PER_BROWSER_OVERRIDES[BROWSER] }

// INGEST_TEST=1 adds origins for the test ingester (local static server and the
// GitHub Pages copy) to the ingest content script and host permissions. Kept
// out of shipped builds: a localhost or github.io permission in a store listing
// invites reviewer questions for no user benefit (ADR 0001).
// Match patterns ignore the port, so http://localhost/* covers any dev port.
if (process.env.INGEST_TEST === '1') {
  const TEST_ORIGINS = [
    'http://localhost/*',
    'http://127.0.0.1/*',
    'https://bridge-craftwork.github.io/*',
  ]
  manifest.content_scripts = manifest.content_scripts.map((cs) =>
    cs.js?.includes('src/ui/ingestContent.js')
      ? { ...cs, matches: [...cs.matches, ...TEST_ORIGINS] }
      : cs
  )
  manifest.host_permissions = [...manifest.host_permissions, ...TEST_ORIGINS]
}

// SHOT_MODE=1 adds a content script that redacts personal data on every load,
// for capturing store screenshots. It is NOT a shipping build: the redactor
// rewrites the page, which is the last thing a real user wants. package-stores.sh
// refuses any build containing it.
//
// It exists because the manual route failed once and once was enough — the
// first iPhone capture went out with a real club manager's name and email on
// screen, because redacting was a step a human had to remember before each
// shot. See docs/screenshot-set.md.
const SHOT_MODE = process.env.SHOT_MODE === '1'

if (SHOT_MODE) {
  manifest.content_scripts = [
    ...manifest.content_scripts,
    {
      matches: [
        'https://live.acbl.org/*',
        'https://my.acbl.org/*',
        'https://webutil.bridgebase.com/*',
        'https://www.bridgebase.com/*',
      ],
      js: ['src/ui/redactContent.js'],
      // document_idle, not document_start. There is nothing to redact before
      // the content exists, and running early bought nothing while making the
      // first pass fire against an empty page.
      run_at: 'document_idle',
    },
  ]
}

export default defineConfig({
  plugins: [crx({ manifest, browser: BROWSER === 'firefox' ? 'firefox' : 'chrome' })],
  define: {
    // Off unless SHOT_HIDE_LOGO=1. The club logo is a photograph rather than
    // identity; hiding it is a framing choice, not a redaction.
    __SHOT_HIDE_LOGO__: JSON.stringify(process.env.SHOT_HIDE_LOGO === '1'),
  },
  build: {
    outDir: `dist/${BROWSER}`,
    emptyOutDir: true,
  },
})
