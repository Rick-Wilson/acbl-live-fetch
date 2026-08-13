// Extraction progress, from the service worker to the page.
//
// Extracted from sourceContent.js, which was doing five jobs in 1200 lines.
// Behaviour unchanged; only the file boundary is new.

// Watch an extraction's progress. The message that started it does not resolve
// until it is finished, so storage is the only channel back mid-flight.
//
// Returns a stop function. Poll rather than onChanged because the content
// script may be re-injected under it, and a stray listener that outlives its
// button is harder to reason about than a timer someone owns.
export const EXTRACT_PROGRESS_PREFIX = 'extract-progress:'

export function newProgressKey() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `p${Date.now()}${Math.random().toString(36).slice(2)}`
}

export function watchExtractionProgress(key, onPercent, storage, intervalMs = 300) {
  const storageKey = `${EXTRACT_PROGRESS_PREFIX}${key}`
  let stopped = false
  const tick = () => {
    if (stopped) return
    storage
      .get(storageKey)
      .then((result) => {
        const entry = result?.[storageKey]
        if (!stopped && entry?.total > 0) {
          onPercent(Math.round((entry.done / entry.total) * 100), entry.done, entry.total)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, intervalMs)
      })
  }
  let timer = setTimeout(tick, intervalMs)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
