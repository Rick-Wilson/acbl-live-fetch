#!/usr/bin/env node
// Capture a page from a running `screenshot-session.js`, from outside it.
//
//   node tools/screenshot-capture.js --list
//   node tools/screenshot-capture.js handviewer-button
//   node tools/screenshot-capture.js analysis-result --url bridge-classroom
//   node tools/screenshot-capture.js handviewer --pair
//
// --pair takes the before/after shot in one go: it hides everything the
// extension injected, captures `NN-<name>-before.png`, restores it, and
// captures `NN-<name>-after.png`. Both frames are otherwise identical — same
// page, same scroll, same state — so the only difference between them is what
// the extension put there. Every injected element carries a
// `bridge-classroom-` id prefix, which is what makes this exact rather than a
// matter of reloading and hoping the page looks the same.
//
// Attaches over CDP to the browser the session opened, so you keep driving that
// window — logging in, clicking through — while this takes the shots. Without
// --url it picks the last page, which is the most recently opened tab; that is
// usually what you just navigated to. Use --url to be explicit.
//
// The viewport is re-asserted at 1280×800 before each shot rather than trusted:
// this process did not launch the browser, so it cannot assume what emulation a
// given tab carries. Files land in screenshots/ at 2560×1600 — see
// docs/store-review.md § 4 for why that size.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(REPO, 'screenshots')
const CDP = 'http://127.0.0.1:9222'

const argv = process.argv.slice(2)
const list = argv.includes('--list')
const pair = argv.includes('--pair')
const urlIdx = argv.indexOf('--url')
const urlMatch = urlIdx === -1 ? null : argv[urlIdx + 1]
const name = argv.filter((a, i) => !a.startsWith('--') && i !== urlIdx + 1)[0]

// Everything the content scripts inject is id'd `bridge-classroom-*`.
const INJECTED = '[id^="bridge-classroom-"]'

if (!list && !name) {
  console.error('usage: screenshot-capture.js <name> [--url <substring>] | --list')
  process.exit(1)
}

let browser
try {
  browser = await chromium.connectOverCDP(CDP)
} catch {
  console.error(`no session on ${CDP} — start one with: node tools/screenshot-session.js`)
  process.exit(1)
}

const pages = browser.contexts().flatMap((c) => c.pages())
if (!pages.length) {
  console.error('session has no open pages')
  process.exit(1)
}

if (list) {
  for (const [i, p] of pages.entries()) {
    const { w, h } = await p.evaluate(() => ({ w: innerWidth, h: innerHeight })).catch(() => ({}))
    console.log(`${i}  ${w ?? '?'}×${h ?? '?'}  ${await p.title().catch(() => '')}`)
    console.log(`   ${p.url().slice(0, 120)}`)
  }
  await browser.close()
  process.exit(0)
}

const page = urlMatch ? pages.findLast((p) => p.url().includes(urlMatch)) : pages.at(-1)
if (!page) {
  console.error(`no open page matching "${urlMatch}" — try --list`)
  process.exit(1)
}

// Not page.setViewportSize: over CDP that rewrites the device metrics override
// and drops deviceScaleFactor back to 1, so the capture comes out 1280×800
// instead of 2560×1600. Setting the override directly keeps the pixel ratio.
const cdp = await page.context().newCDPSession(page)
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 800,
  deviceScaleFactor: 2,
  mobile: false,
})
await page.bringToFront()

fs.mkdirSync(OUT, { recursive: true })
const n =
  fs
    .readdirSync(OUT)
    .map((f) => Number(f.slice(0, 2)))
    .filter(Number.isInteger)
    .reduce((a, b) => Math.max(a, b), 0) + 1

const stem = path.join(OUT, `${String(n).padStart(2, '0')}-${name}`)
const shoot = (suffix) =>
  // scale: 'device' honours the 2× pixel ratio set above, giving 2560×1600.
  page.screenshot({ path: `${stem}${suffix}.png`, scale: 'device' })

if (pair) {
  const found = await page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)]
    els.forEach((el) => {
      el.dataset.bcPrevVisibility = el.style.visibility
      // visibility rather than display: the element keeps its box, so nothing
      // around it reflows and the two frames stay pixel-comparable.
      el.style.visibility = 'hidden'
    })
    return els.length
  }, INJECTED)

  if (!found) {
    console.error(`no injected elements on this page — is the extension active here?`)
    process.exit(1)
  }
  await shoot('-before')

  await page.evaluate((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.visibility = el.dataset.bcPrevVisibility ?? ''
      delete el.dataset.bcPrevVisibility
    })
  }, INJECTED)
  await shoot('-after')

  console.log(`saved ${path.relative(REPO, stem)}-{before,after}.png  (${found} element(s) hidden)`)
} else {
  await shoot('')
  console.log(`saved ${path.relative(REPO, stem)}.png`)
}
console.log(`  from ${page.url().slice(0, 100)}`)

// Detach without closing — the session's browser must survive this process.
await browser.close()
