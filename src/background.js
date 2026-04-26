// Service worker entry point. Wires real chrome.* APIs into the pure handler
// logic in src/background/handlers.js. Keep this file minimal — anything
// non-trivial belongs in handlers.js where it can be tested without a browser.

import { handleMessage, sweepExpired } from './background/handlers.js'

const deps = () => ({
  storage: chrome.storage.local,
  tabs: chrome.tabs,
  crypto: globalThis.crypto,
  fetch: globalThis.fetch.bind(globalThis),
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
chrome.runtime.onStartup.addListener(() => {
  sweepExpired({ storage: chrome.storage.local }).catch(() => {})
})
chrome.runtime.onInstalled.addListener(() => {
  sweepExpired({ storage: chrome.storage.local }).catch(() => {})
})
