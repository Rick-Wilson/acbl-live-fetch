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

async function render(page, size, outPath) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    '<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>' +
    svg.replace('width="64" height="64"', `width="${size}" height="${size}"`)
  )
  await page.locator('svg').screenshot({ path: outPath, omitBackground: true })
}

const browser = await chromium.launch()
const page = await browser.newPage()

fs.mkdirSync(OUT, { recursive: true })
for (const size of EXTENSION_SIZES) {
  await render(page, size, path.join(OUT, `icon-${size}.png`))
}

fs.mkdirSync(SAFARI, { recursive: true })
for (const size of SAFARI_SIZES) {
  await render(page, size, path.join(SAFARI, `icon-${size}.png`))
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
