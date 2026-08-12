// Service worker entry point. Wires the real WebExtension APIs into the pure
// handler logic in src/background/handlers.js. Keep this file minimal —
// anything non-trivial belongs in handlers.js where it can be tested without
// a browser.
//
// We use `webextension-polyfill` (browser.* namespace) so the same source runs
// on Chrome / Edge / Firefox / Safari without per-browser shims. Per-browser
// build artifacts (under dist/<browser>/) only differ in manifest details.
//
// The service worker is event-driven and stateless: handlers may be invoked
// after the SW has been suspended and re-spun by the browser, so we never
// keep state in module-level variables — everything goes through
// browser.storage.local. See docs/architecture.md.
//
// MV3 service workers don't expose DOMParser, so we polyfill it on globalThis
// with linkedom (a pure-JS DOM, drop-in compatible with parser usage). The
// polyfill must run before any module that calls `new DOMParser()`.

import { DOMParser as LinkedomDOMParser } from 'linkedom'
if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = LinkedomDOMParser
}

import browser from 'webextension-polyfill'
import { handleMessage, sweepExpired, batchItemDelayMs } from './background/handlers.js'
import bboAdapter from './adapters/bbo/index.js'

// Fetch via chrome.scripting.executeScript inside a same-origin tab so
// SameSite=Lax cookies attach. As of May 2026, my.acbl.org rejects direct SW
// fetches (HTTP 403) even with credentials:'include' and host_permissions —
// because the SW is cross-site, Chrome doesn't attach Lax cookies. Running
// the fetch from inside a my.acbl.org tab's main world IS same-site, so the
// browser's cookie jar applies normally.
// Among same-origin tabs, pick the one we can actually inject into. A blind
// tabs[0] can land on a stale tab — discarded by Chrome's memory saver, left
// mid-navigation, or sitting on a login/error page — and executeScript then
// fails with "Cannot access contents of the page" even though a usable tab is
// open. Rank by: the tab the user is looking at (active), still loaded (not
// discarded), and finished loading (status complete).
function pickInjectableTab(tabs) {
  const score = (t) =>
    (t.active ? 4 : 0) + (t.discarded ? 0 : 2) + (t.status === 'complete' ? 1 : 0)
  return [...tabs].sort((a, b) => score(b) - score(a))[0]
}

// Run the credentialed fetch inside a tab's main world (same-site, so the
// browser attaches SameSite=Lax cookies). Returns a minimal Response-like.
// Chrome drops executeScript results when too many injections hit one tab at
// once. The ACBL adapter fetches boards 16-wide and every one of those is a
// separate injection into the *same* user tab, so a 3-month batch produced 173
// empty results out of 435. Each one fell back to a temp window: minutes
// slower, and a window flashing behind the browser per board.
//
// Two guards. A queue keeps only a few injections in flight per tab, which is
// not a throughput loss — the fetches inside the page still overlap, and it
// was never the network that was slow. And an empty result is retried on the
// same tab before giving up on it, because it is transient rather than a
// statement that the tab is unusable.
const MAX_CONCURRENT_INJECTIONS = 4
const INJECTION_ATTEMPTS = 3
let injectionsInFlight = 0
const injectionQueue = []

// Adaptive spacing between in-page fetches.
//
// live.acbl.org starts refusing under sustained load: a 4-event batch saw 180
// of ~445 board fetches reject with "Failed to fetch", while Chrome dropped no
// injections at all. It recovers — the fourth event ran at full speed again
// after two slow ones — so a fixed delay would be either too slow when the
// site is happy or too fast when it is not.
//
// Same shape as tools/fetch-replays.js uses against BBO, and for the same
// reason: additive on both sides, so a burst of refusals cannot ratchet the
// delay somewhere it takes hundreds of clean requests to climb back from.
const PACE = { stepUpMs: 250, stepDownMs: 40, maxMs: 4000, speedupAfter: 12 }
let injectionDelayMs = 0
let cleanRun = 0

function paceAfterFailure() {
  cleanRun = 0
  injectionDelayMs = Math.min(injectionDelayMs + PACE.stepUpMs, PACE.maxMs)
  fetchPathStats.pacingMs = injectionDelayMs
}

function paceAfterSuccess() {
  cleanRun += 1
  if (cleanRun >= PACE.speedupAfter && injectionDelayMs > 0) {
    cleanRun = 0
    injectionDelayMs = Math.max(injectionDelayMs - PACE.stepDownMs, 0)
    fetchPathStats.pacingMs = injectionDelayMs
  }
}

function acquireInjectionSlot() {
  if (injectionsInFlight < MAX_CONCURRENT_INJECTIONS) {
    injectionsInFlight += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => injectionQueue.push(resolve))
}

function releaseInjectionSlot() {
  const next = injectionQueue.shift()
  if (next) next()
  else injectionsInFlight -= 1
}

async function runFetchInTab(tabId, url) {
  await acquireInjectionSlot()
  try {
    if (injectionDelayMs > 0) await new Promise((r) => setTimeout(r, injectionDelayMs))
    const res = await injectFetch(tabId, url)
    paceAfterSuccess()
    return res
  } finally {
    releaseInjectionSlot()
  }
}

async function injectFetch(tabId, url) {
  let results
  for (let attempt = 0; attempt < INJECTION_ATTEMPTS; attempt++) {
    results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      // Catch inside the page. A rejected promise reaches us as `result:
      // undefined`, which is indistinguishable from the injection itself
      // failing — so a fetch the *site* refused looked like an unscriptable
      // tab, and we opened a window to retry something the network had
      // already declined. Returning the error keeps the two apart.
      func: (u) =>
        fetch(u, { credentials: 'include' })
          .then(async (r) => ({
            ok: r.ok,
            status: r.status,
            statusText: r.statusText,
            body: await r.text(),
          }))
          .catch((e) => ({ pageFetchError: String(e?.message ?? e) })),
      args: [url],
    })
    const value = results?.[0]?.result
    if (value?.pageFetchError) {
      fetchPathStats.pageFetchErrors += 1
      fetchPathStats.lastPageFetchError = value.pageFetchError
      paceAfterFailure()
      // The site refused this request. Opening a temp window to ask again
      // costs a page load and adds load to a server already saying no — and
      // the caller's own retry/backoff is the right place to try again.
      const err = new Error(`fetch failed inside the page: ${value.pageFetchError}`)
      err.pageFetchRefused = true
      throw err
    }
    if (value) break
    fetchPathStats.injectionRetries += 1
    if (results?.[0]?.error) fetchPathStats.lastInjectionError = String(results[0].error)
    await new Promise((r) => setTimeout(r, 120 * (attempt + 1)))
  }
  const r = results?.[0]?.result
  if (!r) throw new Error('executeScript returned no result')
  return {
    ok: r.ok,
    status: r.status,
    statusText: r.statusText,
    text: async () => r.body,
    headers: { get: () => null },
  }
}

// Open a minimized off-screen window on the target URL (a real, permitted
// same-origin page) and wait for it to load. We point it at the target rather
// than the origin root because the root can redirect to an off-origin login,
// which would be unscriptable. Returns { tabId, windowId }.
async function openTempTab(url) {
  const win =
    (await browser.windows
      .create({
        url,
        type: 'popup',
        focused: false,
        state: 'minimized',
        top: -2000,
        left: -2000,
        width: 200,
        height: 200,
      })
      .catch(() => null)) ||
    (await browser.windows.create({
      url,
      type: 'normal',
      focused: false,
      state: 'minimized',
    }))
  const tabId = win.tabs?.[0]?.id
  await Promise.race([
    new Promise((resolve) => {
      const listener = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          browser.tabs.onUpdated.removeListener(listener)
          resolve()
        }
      }
      browser.tabs.onUpdated.addListener(listener)
    }),
    new Promise((resolve) => setTimeout(resolve, 15000)),
  ])
  return { tabId, windowId: win.id }
}

// Counts why each fetch took the path it did. A batch that falls back to a
// temp window per board is minutes slower than one that reuses the user's tab,
// and looks like a flashing window behind the browser — but the reason was
// being swallowed by an empty catch, so it could not be diagnosed from the
// symptom. Read it from the service-worker console with `bcFetchStats()`.
const fetchPathStats = {
  reusedTab: 0,
  noTabFound: 0,
  tabFailed: 0,
  injectionRetries: 0,
  pageFetchErrors: 0,
  pacingMs: 0,
  lastError: null,
  lastPageFetchError: null,
  lastInjectionError: null,
}
globalThis.bcFetchStats = () => ({ ...fetchPathStats })

async function fetchViaTab(url) {
  const matchPattern = new URL(url).origin + '/*'
  const tabs = await browser.tabs.query({ url: matchPattern })
  // Prefer an already-open same-origin tab (no flicker, no extra page load).
  if (tabs.length > 0) {
    const tab = pickInjectableTab(tabs)
    try {
      const res = await runFetchInTab(tab.id, url)
      fetchPathStats.reusedTab += 1
      return res
    } catch (err) {
      // A refusal by the site is not a bad tab. Let it out to the caller's
      // retry and backoff instead of paying for a window that will be told
      // the same thing.
      if (err?.pageFetchRefused) throw err
      // The chosen tab was unscriptable after all — fall through to a
      // dedicated temp window rather than failing the whole extraction.
      fetchPathStats.tabFailed += 1
      fetchPathStats.lastError = `${err?.message ?? err} (tab ${tab?.id}, ${tab?.status}${tab?.discarded ? ', discarded' : ''})`
    }
  } else {
    fetchPathStats.noTabFound += 1
  }
  const { tabId, windowId } = await openTempTab(url)
  try {
    return await runFetchInTab(tabId, url)
  } finally {
    if (windowId != null) browser.windows.remove(windowId).catch(() => {})
  }
}

// Hosts that reject a direct service-worker fetch with HTTP 403. Routing the
// request through a same-origin tab fixes both, but for different reasons —
// worth keeping straight, because it changes what a user (or a store reviewer)
// needs in order to use each one:
//
//   live.acbl.org  genuinely requires an ACBL session. Logged out, the site
//                  serves a Cloudflare check and then a sign-in prompt.
//   my.acbl.org    club results are PUBLIC — logged out, the same Cloudflare
//                  check is followed by the results themselves. What the worker
//                  lacks here is the site's bot-protection clearance, not a login.
//
// Either way the fix is the same: issue the fetch from a browsing context that
// has already satisfied the site, i.e. one of the user's own tabs.
const TAB_FETCH_HOSTS = new Set(['my.acbl.org', 'live.acbl.org'])

async function smartFetch(url, opts) {
  try {
    const host = new URL(url).hostname
    if (TAB_FETCH_HOSTS.has(host)) {
      return fetchViaTab(url, opts)
    }
  } catch {
    /* fall through to direct fetch */
  }
  return globalThis.fetch(url, opts)
}

// Ship one dev-bulk envelope to the tab that's assembling the output file.
// Serializing here (rather than passing the object) keeps the structured-clone
// step cheap and lets the tab concatenate strings straight into a Blob.
// Returns 1 on success, 0 if the tab rejected it — a dropped envelope should
// cost one tournament, not abort a run that may be an hour deep.
async function sendEnvelope(tabId, envelope) {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: 'dev-bulk-file-chunk',
      json: JSON.stringify(envelope),
    })
    return 1
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log('[acbl-fetch] dev-bulk-extract: chunk delivery failed', err?.message ?? err)
    return 0
  }
}


// How long to leave between events in a batch.
//
// A single event's ~96 board fetches complete cleanly; it is the running total
// across events that live.acbl.org starts refusing, and it recovers if left
// alone — the fourth event of a batch ran at full speed after two slow ones.
// So the gap belongs between events, where it costs nothing in the common case
// of extracting one, rather than between boards, where it taxes every
// extraction to protect against a state most never reach.
//
// Asked for after each event, and only long when that event was actually
// refused, so a clean batch stays quick.
const EVENT_GAP_CLEAN_MS = 1000
const EVENT_GAP_AFTER_REFUSAL_MS = 20000
let refusalsAtEventStart = 0

const pacer = {
  eventGapMs(url) {
    const refused = fetchPathStats.pageFetchErrors - refusalsAtEventStart
    refusalsAtEventStart = fetchPathStats.pageFetchErrors
    if (refused > 0) {
      fetchPathStats.lastEventRefusals = refused
      return EVENT_GAP_AFTER_REFUSAL_MS
    }
    return batchItemDelayMs(url)
  },
}

const deps = () => ({
  storage: browser.storage.local,
  tabs: browser.tabs,
  crypto: globalThis.crypto,
  fetch: smartFetch,
  pacer,
})

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // dev-bulk-extract: developer-only bulk extraction triggered via the
  // `#bcdev-mega` URL hash on the BBO lobby. Iterates a list of tournament
  // URLs, runs each through the BBO adapter (with credentialed fetches), and
  // streams each envelope to the requesting lobby tab, which assembles them
  // into a single JSON file and saves it. Bypasses the analyzer entirely —
  // this is for offline analysis of long-range history (years), too big for
  // sessionStorage. Intentionally not surfaced in the production UI.
  //
  // The tab does the saving because an MV3 service worker has no
  // URL.createObjectURL, and the data: URL workaround this used to rely on
  // silently caps out: Chrome rejects URLs over ~2MB, so a few hundred
  // tournaments produced a 0-byte `download.json` with no error raised.
  // A blob URL from a page context has no such limit.
  if (message?.type === 'dev-bulk-extract') {
    const urls = Array.isArray(message.urls) ? message.urls : []
    const filename = message.filename ?? `bbo-history-${new Date().toISOString().slice(0, 10)}.json`
    const progressKey = 'dev-bulk-progress'
    const cancelKey = 'dev-bulk-cancel'
    // The requesting lobby tab assembles and saves the file. See the
    // dev-bulk-file-* messages below for why the SW can't do it itself.
    const tabId = sender?.tab?.id
    sendResponse({ type: 'dev-bulk-started', total: urls.length })
    ;(async () => {
      const errors = []
      const startedAt = Date.now()
      let sent = 0
      await browser.storage.local.set({ [progressKey]: { total: urls.length, completed: 0, errors: 0, done: false, startedAt } })
      await browser.storage.local.remove(cancelKey).catch(() => {})
      await browser.tabs.sendMessage(tabId, { type: 'dev-bulk-file-begin' }).catch(() => {})
      let cancelled = false
      for (let i = 0; i < urls.length; i++) {
        const cancelCheck = await browser.storage.local.get(cancelKey).catch(() => null)
        if (cancelCheck?.[cancelKey]) { cancelled = true; break }
        const url = urls[i]
        try {
          // Call the BBO adapter directly to skip runExtraction's analyzer-tab
          // opening — we don't want a tab per game in bulk mode.
          const env = await bboAdapter.extractSession(url, {
            fetch: globalThis.fetch.bind(globalThis),
            log: () => {},
          })
          // Hand each envelope off as soon as it's built rather than banking
          // them here: SW memory stays flat over a multi-hundred-tournament
          // run, and an SW eviction can't take the whole batch with it.
          sent += await sendEnvelope(tabId, env)
        } catch (err) {
          errors.push({ url, error: err?.message ?? String(err) })
        }
        await browser.storage.local.set({ [progressKey]: { total: urls.length, completed: i + 1, errors: errors.length, done: false, startedAt } })
        // Brief pause between tournaments to be nice to BBO.
        await new Promise((r) => setTimeout(r, 250))
      }
      // Tell the tab to assemble and save. The header travels separately from
      // the envelopes so the tab can write it without re-serializing them.
      let saveError = null
      try {
        const res = await browser.tabs.sendMessage(tabId, {
          type: 'dev-bulk-file-finish',
          filename,
          header: {
            generated_at: new Date().toISOString(),
            envelope_count: sent,
            error_count: errors.length,
            cancelled,
            errors,
          },
        })
        if (res?.error) saveError = res.error
        // eslint-disable-next-line no-console
        console.log('[acbl-fetch] dev-bulk-extract: saved', { filename, envelopes: sent, bytes: res?.bytes, errors: errors.length })
      } catch (err) {
        saveError = err?.message ?? String(err)
        // eslint-disable-next-line no-console
        console.log('[acbl-fetch] dev-bulk-extract: save failed', saveError)
      }
      await browser.storage.local.set({ [progressKey]: { total: urls.length, completed: urls.length, errors: errors.length, done: true, cancelled, startedAt, finishedAt: Date.now(), saveError } })
      await browser.storage.local.remove(cancelKey).catch(() => {})
    })().catch(() => {})
    return true
  }

  // open-bbo-batch-tab: open the BBO hands.php listing so the browser handles
  // authentication properly (timezone redirect, session cookies). Our content
  // script on that tab will parse the DOM and store the results.
  //
  // We open the helper window far off-screen (and minimized) so the user
  // doesn't see flashes when BBO's redirect chain (timezone -> hands.php ->
  // possibly login flow) navigates and may unminimize the window on some
  // platforms. The window closes itself after parsing.
  if (message?.type === 'open-bbo-batch-tab') {
    browser.windows.create({
      url: message.url,
      type: 'popup',
      focused: false,
      state: 'minimized',
      top: -2000,
      left: -2000,
      width: 200,
      height: 200,
    }).catch(() => {
      // Some platforms may reject `state: 'minimized'` with off-screen
      // coords; fall back to a basic minimized normal window.
      browser.windows.create({
        url: message.url,
        type: 'normal',
        focused: false,
        state: 'minimized',
      }).catch(() => {})
    })
    sendResponse({ type: 'tab-opened' })
    return true
  }

  // close-current-tab: called by the hands.php content script after it has
  // parsed and stored the batch URLs. Closes the entire window if the tab
  // is the only one in its window (which it is for our minimized helper).
  if (message?.type === 'close-current-tab') {
    const tabId = sender?.tab?.id
    const windowId = sender?.tab?.windowId
    if (tabId && windowId != null) {
      // Prefer closing the window since open-bbo-batch-tab created a dedicated
      // minimized window for this fetch.
      browser.windows.remove(windowId).catch(() => {
        // Fallback: just close the tab.
        browser.tabs.remove(tabId).catch(() => {})
      })
    } else if (tabId) {
      browser.tabs.remove(tabId).catch(() => {})
    }
    sendResponse({ type: 'tab-closed' })
    return true
  }

  handleMessage(message, deps())
    .then(sendResponse)
    .catch((err) => {
      sendResponse({
        type: 'extraction-error',
        error: { code: 'unexpected', message: err?.message ?? String(err) },
      })
    })
  return true // keep the response channel open for async work
})

// Garbage-collect stale pending-session entries on startup and install.
// (browser.runtime.onStartup may not fire on Firefox event-page reloads, but
// onInstalled covers the install path either way.)
browser.runtime.onStartup?.addListener?.(() => {
  sweepExpired({ storage: browser.storage.local }).catch(() => {})
})
browser.runtime.onInstalled.addListener(() => {
  sweepExpired({ storage: browser.storage.local }).catch(() => {})
})
