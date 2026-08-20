// SHOT_MODE only. Redacts the page before a screenshot is taken, so a capture
// can never contain un-redacted personal data.
//
// This exists because the manual route failed exactly once and that was
// enough: the first iPhone capture was taken with a real club manager's name
// and email address on screen, because redacting was a step someone had to
// remember. A build that cannot forget is worth more than a snippet that works.
//
// Never shipped. vite.config.js only registers this content script when
// SHOT_MODE=1, and package-stores.sh refuses to package a build containing it.

import { redactPage } from '../lib/redact.js'

// Set at build time by SHOT_HIDE_LOGO=1. Off by default — the club logo is a
// photograph, not identity. Worth hiding only for framing, when it pushes the
// results table below the fold on a phone.
const HIDE_LOGO = __SHOT_HIDE_LOGO__

// Debounced, and that is the whole design.
//
// The first version ran on every mutation batch. redactPage walks every text
// node and every table, so on a club game page — a full field, hundreds of
// rows, rendered incrementally by Vue — each batch triggered another whole-
// document pass, and the page never finished loading. Seventy-five seconds in
// it was still blank. Nothing on that page justifies a wait like that; we were
// starving it.
//
// So: wait for the DOM to go quiet, then run once. A screenshot only needs the
// finished page to be clean, not every intermediate frame.
const QUIET_MS = 300

let timer = null
let running = false

const observer = new MutationObserver(() => schedule())

function schedule() {
  if (running) return
  clearTimeout(timer)
  timer = setTimeout(run, QUIET_MS)
}

function run() {
  running = true
  // Our own edits must not retrigger us.
  observer.disconnect()
  try {
    console.log('[shot-mode] redacted:', redactPage({ hideLogo: HIDE_LOGO }))
  } catch (err) {
    // Loud, because a silent failure here is the failure mode that matters.
    console.error('[shot-mode] REDACTION FAILED — do not screenshot this page', err)
  } finally {
    running = false
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }
}

// Open the batch menu for a screenshot, when asked via #bc-shot-menu.
//
// The button is the entirety of our work on these pages, so a shot must not
// scroll it out of frame — and a shot of the button alone says only that it
// exists. The menu it opens says what it *does*: a date range, up to all time.
//
// Deliberately not "bc-analyze", which the extension already uses to trigger a
// real extraction. This only opens the menu; nothing is fetched until an option
// is chosen, and nothing chooses one.
function openMenuIfAsked() {
  if (!location.hash.includes('bc-shot-menu')) return
  let tries = 0
  const click = () => {
    const btn = document.getElementById('bridge-classroom-analyze-btn')
    if (btn) {
      btn.click()
      console.log('[shot-mode] opened the batch menu')
      return
    }
    // The button arrives with the Vue mount, so poll rather than assume.
    if (tries++ < 60) setTimeout(click, 100)
    else console.error('[shot-mode] no button to open a menu on')
  }
  click()
}

// document_idle, so there is something to redact when the first pass runs.
schedule()
observer.observe(document.documentElement, { childList: true, subtree: true })
openMenuIfAsked()
