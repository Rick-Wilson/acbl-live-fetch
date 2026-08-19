// SHOT_MODE only. Redacts the page as soon as it loads, so a screenshot can
// never be taken of un-redacted personal data.
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
// photograph, not identity. It is worth hiding only for framing, when it pushes
// the results table below the fold on a phone.
const HIDE_LOGO = __SHOT_HIDE_LOGO__

let running = false
let queued = false

// The observer must not react to our own edits — redactPage rewrites text nodes
// and sets styles, which would retrigger it forever. Disconnect around the run
// and coalesce anything that arrives while we are busy.
const observer = new MutationObserver(() => schedule())

function schedule() {
  if (running) {
    queued = true
    return
  }
  running = true
  observer.disconnect()
  try {
    const changed = redactPage({ hideLogo: HIDE_LOGO })
    console.log('[shot-mode] redacted:', changed)
  } catch (err) {
    // Loud, because a silent failure here is the failure mode that matters.
    console.error('[shot-mode] REDACTION FAILED — do not screenshot this page', err)
  } finally {
    running = false
    observer.observe(document.documentElement, { childList: true, subtree: true })
    if (queued) {
      queued = false
      setTimeout(schedule, 50)
    }
  }
}

schedule()

// my.acbl.org is a Vue SPA and live.acbl.org rewrites its tables, so rows can
// arrive after document_idle — and a row that arrives late is a real name in a
// screenshot. The observer catches most of it; these catch the rest.
for (const ms of [500, 1500, 3000]) setTimeout(schedule, ms)
