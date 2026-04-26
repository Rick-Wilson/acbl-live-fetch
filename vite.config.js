import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import baseManifest from './manifest.json' with { type: 'json' }

// Cross-browser builds. Today only Chrome is published, but the structure
// supports Edge / Firefox / Safari without source changes — see
// docs/architecture.md § Cross-browser builds. Run `BROWSER=firefox npm run
// build` (etc.) to emit a per-browser bundle.
const BROWSER = process.env.BROWSER ?? 'chrome'

const PER_BROWSER_OVERRIDES = {
  chrome: {},
  edge: {},
  // Firefox / Safari overrides will land here when those targets are first
  // published. Today they fall back to the Chrome manifest, which is good
  // enough for local smoke-testing on those browsers.
  firefox: {},
  safari: {},
}

if (!Object.hasOwn(PER_BROWSER_OVERRIDES, BROWSER)) {
  throw new Error(
    `Unknown BROWSER=${BROWSER}. Supported: ${Object.keys(PER_BROWSER_OVERRIDES).join(', ')}.`
  )
}

const manifest = { ...baseManifest, ...PER_BROWSER_OVERRIDES[BROWSER] }

export default defineConfig({
  plugins: [crx({ manifest, browser: BROWSER === 'firefox' ? 'firefox' : 'chrome' })],
  build: {
    outDir: `dist/${BROWSER}`,
    emptyOutDir: true,
  },
})
