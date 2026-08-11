// Render the Chrome Web Store promo tiles.
//
//   node scripts/render-promo.mjs
//
//   icons/promo-440x280.png    small tile — category listings and search
//   icons/promo-1400x560.png   marquee — only used if Google features us
//
// Both are optional fields. The small one is worth having: without it the
// listing looks thinner than its neighbours in a category grid.
//
// Composed here rather than drawn in an editor for the same reason the macOS
// icon is: the mark is lifted out of icons/icon.svg, so the tiles cannot drift
// away from the icon they sit beside. Chromium does the rendering, via the
// Playwright already installed for the e2e tests.
//
// Design: the tile is the same #1a73e8 as the icon and as the button the
// extension injects, so a user who has seen the button recognises the listing.
// The mark sits on a white roundel rather than bleeding into the tile — at
// 440x280 a full-bleed cap on blue loses its silhouette, which is the one
// thing that distinguishes it from Bridge Solver's spade.

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const SRC = 'icons/icon.svg'
const OUT = 'icons'
const BLUE = '#1a73e8'
const GLYPH_GRID = 64

const svg = fs.readFileSync(SRC, 'utf8')
const glyph = svg.match(/<g id="glyph">([\s\S]*?)<\/g>\s*<\/svg>/)
if (!glyph) throw new Error('icon.svg has no <g id="glyph"> to lift — did the source change?')

// The mark alone, white on transparent, at whatever size the tile wants.
function markSvg(size) {
  const scale = size / GLYPH_GRID
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <g transform="scale(${scale})">${glyph[1]}</g>
  </svg>`
}

// Tiles are laid out in HTML rather than SVG so the type sets properly —
// SVG text has no wrapping and no optical alignment worth the name.
function tile({ width, height, roundel, mark, title, tagline, gap, pad, copy }) {
  return `<!doctype html>
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${width}px; height: ${height}px;
    background: ${BLUE};
    display: flex; align-items: center; justify-content: center; gap: ${gap}px;
    padding: 0 ${pad}px;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #fff;
    overflow: hidden;
  }
  .roundel {
    flex: 0 0 auto;
    width: ${roundel}px; height: ${roundel}px;
    border-radius: 50%;
    background: rgba(255,255,255,0.14);
    display: grid; place-items: center;
  }
  .text { min-width: 0; }
  h1 {
    margin: 0;
    font-size: ${title}px;
    line-height: 1.05;
    font-weight: 700;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }
  p {
    margin: ${Math.round(title * 0.36)}px 0 0;
    font-size: ${tagline}px;
    line-height: 1.35;
    font-weight: 400;
    color: rgba(255,255,255,0.86);
  }
</style>
<div class="roundel">${markSvg(Math.round(roundel * 0.62))}</div>
<div class="text">
  <h1>Bridge&nbsp;Classroom<br>Fetch</h1>
  <p>${copy}</p>
</div>`
}

const TILES = [
  // Small: displayed a few hundred pixels wide in a category grid, so the
  // title is set to fit on two lines without touching the edge, and the
  // tagline says one thing rather than three.
  {
    file: 'promo-440x280.png',
    width: 440, height: 280,
    roundel: 100, gap: 20, pad: 24,
    title: 29, tagline: 14,
    copy: 'Results to analysis, in one click.',
  },
  // Marquee: same composition with more air. Centred, because Google crops
  // this in some placements and a left-weighted layout loses the mark first.
  // The tagline is sized to hold one line — an orphaned word reads as an
  // accident at this size.
  {
    file: 'promo-1400x560.png',
    width: 1400, height: 560,
    roundel: 240, gap: 56, pad: 80,
    title: 76, tagline: 29,
    copy: 'Send your bridge results to Bridge Classroom for analysis.',
  },
]

const browser = await chromium.launch()
const page = await browser.newPage()
fs.mkdirSync(OUT, { recursive: true })

for (const t of TILES) {
  await page.setViewportSize({ width: t.width, height: t.height })
  await page.setContent(tile(t))
  await page.screenshot({ path: path.join(OUT, t.file) })
  console.log(`${t.file}  ${t.width}x${t.height}`)
}

await browser.close()
