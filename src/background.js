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
import { handleMessage, sweepExpired } from './background/handlers.js'
import bboAdapter from './adapters/bbo/index.js'

const deps = () => ({
  storage: browser.storage.local,
  tabs: browser.tabs,
  crypto: globalThis.crypto,
  fetch: globalThis.fetch.bind(globalThis),
})

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // dev-bulk-extract: developer-only bulk extraction triggered via the
  // `#bcdev-mega` URL hash on the BBO lobby. Iterates a list of tournament
  // URLs, runs each through the BBO adapter (with credentialed fetches),
  // accumulates the envelopes in memory, and downloads the aggregate as a
  // single JSON file. Bypasses the analyzer entirely — this is for offline
  // analysis of long-range history (years), too big for sessionStorage.
  // Intentionally not surfaced in the production UI.
  if (message?.type === 'dev-bulk-extract') {
    const urls = Array.isArray(message.urls) ? message.urls : []
    const filename = message.filename ?? `bbo-history-${new Date().toISOString().slice(0, 10)}.json`
    const progressKey = 'dev-bulk-progress'
    const cancelKey = 'dev-bulk-cancel'
    sendResponse({ type: 'dev-bulk-started', total: urls.length })
    ;(async () => {
      const envelopes = []
      const errors = []
      const startedAt = Date.now()
      await browser.storage.local.set({ [progressKey]: { total: urls.length, completed: 0, errors: 0, done: false, startedAt } })
      await browser.storage.local.remove(cancelKey).catch(() => {})
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
          envelopes.push(env)
        } catch (err) {
          errors.push({ url, error: err?.message ?? String(err) })
        }
        await browser.storage.local.set({ [progressKey]: { total: urls.length, completed: i + 1, errors: errors.length, done: false, startedAt } })
        // Brief pause between tournaments to be nice to BBO.
        await new Promise((r) => setTimeout(r, 250))
      }
      // Build the output file. Wrap envelopes in a small header so the file
      // self-describes (counts, generation timestamp, source URL ranges).
      const output = {
        generated_at: new Date().toISOString(),
        envelope_count: envelopes.length,
        error_count: errors.length,
        cancelled,
        errors,
        envelopes,
      }
      // MV3 service workers don't expose URL.createObjectURL, so we encode the
      // payload as a base64 data URL and feed that to chrome.downloads.
      const json = JSON.stringify(output, null, 2)
      const bytes = new TextEncoder().encode(json)
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
      }
      const dataUrl = `data:application/json;base64,${btoa(binary)}`
      // eslint-disable-next-line no-console
      console.log('[acbl-fetch] dev-bulk-extract: downloading', { filename, bytes: bytes.length, envelopes: envelopes.length, errors: errors.length })
      try {
        // saveAs:false → goes straight into Downloads folder. Avoids the
        // dialog timeout/SW-suspension risk for long-running extracts where
        // the user may not be at the computer when the file is ready.
        await browser.downloads.download({ url: dataUrl, filename, saveAs: false })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log('[acbl-fetch] dev-bulk-extract: download failed', err?.message ?? err)
      }
      await browser.storage.local.set({ [progressKey]: { total: urls.length, completed: urls.length, errors: errors.length, done: true, cancelled, startedAt, finishedAt: Date.now() } })
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
