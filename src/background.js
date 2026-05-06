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

const deps = () => ({
  storage: browser.storage.local,
  tabs: browser.tabs,
  crypto: globalThis.crypto,
  fetch: globalThis.fetch.bind(globalThis),
})

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
