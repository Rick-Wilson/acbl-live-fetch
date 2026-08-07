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
  firefox: {
    background: {
      scripts: ['src/background.js'],
    },
    browser_specific_settings: {
      gecko: {
        id: 'acbl-live-fetch@bridge-classroom.org',
        strict_min_version: '121.0',
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

export default defineConfig({
  plugins: [crx({ manifest, browser: BROWSER === 'firefox' ? 'firefox' : 'chrome' })],
  build: {
    outDir: `dist/${BROWSER}`,
    emptyOutDir: true,
  },
})
