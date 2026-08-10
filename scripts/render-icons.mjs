// Rasterise icons/icon.svg into every size the four stores want.
//
//   node scripts/render-icons.mjs
//
// Chromium does the rendering, via the Playwright already installed for the e2e
// tests. That is deliberate: ImageMagick here has only its own internal SVG
// renderer (no librsvg), and the icon should be rasterised by the engine that
// will display it. There is no other build-time dependency to add.
//
// Outputs, all from the one source:
//   icons/icon-{16,24,32,48,128,300}.png   manifest, toolbar action, Edge listing
//   safari/…/AppIcon.appiconset/*.png      the macOS app wrapper's icon set
//
// Re-run after editing icon.svg and commit the PNGs — they are build inputs the
// stores consume, not build output, so they are tracked.

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const SRC = 'icons/icon.svg'
const OUT = 'icons'
const SAFARI = 'safari/Bridge Classroom Fetch/Shared (App)/Assets.xcassets/AppIcon.appiconset'

// 16/32/48/128 are the manifest set; 24 is for the toolbar action on some
// display scales; 300 is Edge's store logo.
const EXTENSION_SIZES = [16, 24, 32, 48, 128, 300]

// The catalog's 13 slots collapse to these distinct pixel sizes once @2x is
// resolved (a 512@2x asset is a 1024px file).
const SAFARI_SIZES = [16, 32, 64, 128, 256, 512, 1024]

const svg = fs.readFileSync(SRC, 'utf8')

// ── The macOS variant ────────────────────────────────────────────────────────
//
// A browser toolbar icon is full-bleed; a Mac app icon is not. Apple's grid
// puts the rounded square at 824x824 inside a 1024 canvas — a 100px margin all
// round — with a 185.4 corner radius. Shipping the toolbar tile as the app icon
// would leave it visibly larger and squarer than everything beside it in the
// Dock, which is the tell of an extension that was ported rather than built.
//
// The mark is lifted out of icon.svg rather than redrawn, so the two icons
// cannot drift apart.
const MACOS_CANVAS = 1024
const MACOS_INSET = 100
const MACOS_SIDE = MACOS_CANVAS - MACOS_INSET * 2   // 824
const MACOS_RADIUS = 185.4
const GLYPH_GRID = 64                               // icon.svg's viewBox

function macosSvg() {
  const glyph = svg.match(/<g id="glyph">([\s\S]*?)<\/g>\s*<\/svg>/)
  if (!glyph) throw new Error('icon.svg has no <g id="glyph"> to lift — did the source change?')
  const scale = MACOS_SIDE / GLYPH_GRID
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MACOS_CANVAS} ${MACOS_CANVAS}" width="${MACOS_CANVAS}" height="${MACOS_CANVAS}">
  <rect x="${MACOS_INSET}" y="${MACOS_INSET}" width="${MACOS_SIDE}" height="${MACOS_SIDE}" rx="${MACOS_RADIUS}" fill="#1a73e8"/>
  <g transform="translate(${MACOS_INSET} ${MACOS_INSET}) scale(${scale})">${glyph[1]}</g>
</svg>
`
}

async function render(page, size, outPath, source = svg, grid = GLYPH_GRID) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    '<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>' +
    source.replace(`width="${grid}" height="${grid}"`, `width="${size}" height="${size}"`)
  )
  await page.locator('svg').screenshot({ path: outPath, omitBackground: true })
}

const browser = await chromium.launch()
const page = await browser.newPage()

fs.mkdirSync(OUT, { recursive: true })
for (const size of EXTENSION_SIZES) {
  await render(page, size, path.join(OUT, `icon-${size}.png`))
}

// The Mac app icon is the inset variant, written out beside the source so it
// can be opened and looked at rather than only existing inside this script.
const macos = macosSvg()
fs.writeFileSync(path.join(OUT, 'icon-macos.svg'), macos)

fs.mkdirSync(SAFARI, { recursive: true })
for (const size of SAFARI_SIZES) {
  await render(page, size, path.join(SAFARI, `icon-${size}.png`), macos, MACOS_CANVAS)
}

await browser.close()

// Point the asset catalog at what we just wrote. Xcode resolves a slot by
// size × scale, so a 32x32 @2x slot needs the 64px file.
const contentsPath = path.join(SAFARI, 'Contents.json')
const contents = JSON.parse(fs.readFileSync(contentsPath, 'utf8'))
let filled = 0
for (const image of contents.images) {
  // Leave the dark and tinted iOS variants empty: those want their own artwork,
  // and pointing them at the light one would claim a design we have not made.
  if (image.appearances) continue
  const base = Number.parseInt(image.size, 10)
  const scale = Number.parseInt(image.scale ?? '1', 10)
  const px = base * scale
  if (!SAFARI_SIZES.includes(px)) continue
  image.filename = `icon-${px}.png`
  filled++
}
fs.writeFileSync(contentsPath, JSON.stringify(contents, null, 2) + '\n')

console.log(`icons: ${EXTENSION_SIZES.length} extension, ${SAFARI_SIZES.length} safari, ${filled} catalog slots filled`)
