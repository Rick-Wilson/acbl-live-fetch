#!/usr/bin/env node
// A browser for taking store screenshots in.
//
// Launches Chromium with the production build loaded, its viewport fixed at
// exactly 1280×800 and its pixel ratio at 2. Drive it by hand — log in, click
// through, open tabs — and capture either way:
//
//   node tools/screenshot-session.js      leave this running
//   ⌃⇧S on any page                       capture it yourself
//   node tools/screenshot-capture.js …    capture from outside the session
//
// The second route is why the remote-debugging port is open: it lets another
// process attach over CDP and shoot a page while you keep driving the browser.
// Handy when someone else is doing the capturing — you handle the logins, they
// take the shots.
//
// Why not just resize a normal Chrome window: the viewport has to be *exactly*
// 1280×800, because the store images are 1280×800 with the browser chrome
// cropped off (see docs/store-review.md § 4). Dragging a window to the right
// content size is guesswork; this emulates it precisely, and page.screenshot
// captures only the page, so there is no chrome to crop in the first place.
//
// 2560×1600 is a valid Apple App Store size as-is and downscales cleanly to
// 1280×800 for Chrome, Edge and AMO. Capture once, export twice.
//
// The profile persists in .screenshot-profile/, so logins survive between runs.
// Note BBO allows only one session per user: signing in here signs you out
// wherever else you are signed in.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXTENSION = path.join(REPO, 'dist/chrome')
const PROFILE = path.join(REPO, '.screenshot-profile')
const OUT = path.join(REPO, 'screenshots')

// The first page to open — the hand viewer test deal from store-review.md § 2.
// Complete deal, seat names rather than real handles, and no login or network.
const START =
  'https://www.bridgebase.com/tools/handviewer.html?bbo=y&lin=pn%7CSouth%2CWest%2CNorth%2CEast%7Cst%7C%7Cmd%7C3S789TQH5KD2C2478T%2CS2456JAH6TD57TKC6%2CS3H78JD4689JQC39J%2C%7Crh%7C%7Cah%7CBoard%201%7Csv%7Co%7Cmb%7Cp%7Cmb%7C2C%7Cmb%7C2S%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7C3H%7Cmb%7Cp%7Cmb%7C3N%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7Cp%7Cpc%7CDQ%7Cpc%7CD3%7Cpc%7CD2%7Cpc%7CDK%7Cpc%7CHT%7Cpc%7CH7%7Cpc%7CH2%7Cpc%7CHK%7Cpc%7CST%7Cpc%7CS2%7Cpc%7CS3%7Cpc%7CSK%7Cpc%7CHA%7Cpc%7CH5%7Cpc%7CH6%7Cpc%7CH8%7Cpc%7CHQ%7Cpc%7CS7%7Cpc%7CS4%7Cpc%7CHJ%7Cpc%7CH9%7Cpc%7CS8%7Cpc%7CS5%7Cpc%7CD4%7Cpc%7CH4%7Cpc%7CS9%7Cpc%7CS6%7Cpc%7CD6%7Cpc%7CH3%7Cpc%7CSQ%7Cpc%7CSJ%7Cpc%7CD8%7Cpc%7CDA%7Cpc%7CC2%7Cpc%7CD5%7Cpc%7CD9%7Cpc%7CCA%7Cpc%7CC4%7Cpc%7CC6%7Cpc%7CC3%7Cpc%7CCK%7Cpc%7CC7%7Cpc%7CD7%7Cpc%7CC9%7Cpc%7CCQ%7Cpc%7CC8%7Cpc%7CDT%7Cpc%7CCJ%7Cpc%7CC5%7Cpc%7CCT%7Cpc%7CSA%7Cpc%7CDJ%7C'

if (!fs.existsSync(EXTENSION)) {
  console.error(`missing ${EXTENSION} — run: npm run build:chrome`)
  process.exit(1)
}
fs.mkdirSync(OUT, { recursive: true })

let n = fs
  .readdirSync(OUT)
  .map((f) => Number(f.slice(0, 2)))
  .filter(Number.isInteger)
  .reduce((a, b) => Math.max(a, b), 0)

export const CDP_PORT = 9222

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: false,
  args: [
    `--disable-extensions-except=${EXTENSION}`,
    `--load-extension=${EXTENSION}`,
    `--remote-debugging-port=${CDP_PORT}`,
  ],
  // Applies to every page in the context, including tabs the page opens itself
  // — which is how the hand-off arrives, so the analyzer tab is sized too.
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
})

// The binding and the init script are context-level, so they are present on
// every page including ones opened later. exposeBinding is not subject to the
// page's CSP, which matters: the analyzer sets a strict one.
await context.exposeBinding('__shot', async ({ page }, name) => {
  const file = path.join(OUT, `${String(++n).padStart(2, '0')}-${name || 'shot'}.png`)
  await page.screenshot({ path: file })
  const { width, height } = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }))
  console.log(`saved ${path.relative(REPO, file)}  (viewport ${width}×${height})`)
  return path.basename(file)
})

await context.addInitScript(() => {
  addEventListener('keydown', async (e) => {
    if (!(e.ctrlKey && e.shiftKey && e.code === 'KeyS')) return
    e.preventDefault()
    const name = prompt('Screenshot name (e.g. handviewer-button):', '')
    if (name === null) return
    const saved = await window.__shot(name.trim().replace(/[^a-z0-9-]+/gi, '-'))
    const note = document.createElement('div')
    note.textContent = `saved ${saved}`
    note.style.cssText =
      'position:fixed;z-index:2147483647;left:50%;top:16px;transform:translateX(-50%);' +
      'background:#1a73e8;color:#fff;font:600 13px system-ui;padding:8px 14px;border-radius:6px'
    document.body.appendChild(note)
    setTimeout(() => note.remove(), 1600)
  })
})

const page = context.pages()[0] ?? (await context.newPage())
await page.goto(START)

console.log(`
Screenshot session ready.

  viewport   1280×800 at 2× → files are 2560×1600
  extension  dist/chrome (production build)
  output     ${path.relative(REPO, OUT)}/
  profile    ${path.relative(REPO, PROFILE)}/  (logins persist between runs)
  CDP        http://127.0.0.1:${CDP_PORT}

  Ctrl+Shift+S on any page to capture. New tabs are sized too, so the
  analyzer tab the hand-off opens is already correct.

  Or, from another terminal while this keeps running:
    node tools/screenshot-capture.js --list
    node tools/screenshot-capture.js <name> [--url <substring>]

Close the browser window to finish.
`)

await context.waitForEvent('close', { timeout: 0 })
console.log('session ended')
process.exit(0)
