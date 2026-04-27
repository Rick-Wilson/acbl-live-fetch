// Bounded-concurrency HTTP fetch helper.
//
// Per docs/architecture.md:
//   fetchAll(urls, { concurrency = 4, delayMs = 0, signal }) → Map<url, htmlString | Error>
//
// Retries fetch errors twice with exponential backoff. Honors 429 / 503 with
// Retry-After when present; falls back to 2^attempt * 500ms (capped at 8s).
// Other 4xx responses are surfaced immediately without retry.

export class FetchError extends Error {
  constructor(message, { url, status, cause } = {}) {
    super(message)
    this.name = 'FetchError'
    this.url = url
    this.status = status ?? null
    if (cause !== undefined) this.cause = cause
  }
}

export async function fetchAll(urls, options = {}) {
  const {
    concurrency = 4,
    delayMs = 0,
    signal,
    fetch: fetchFn = globalThis.fetch,
    maxRetries = 2,
    // Optional callback invoked synchronously per worker as soon as each URL's
    // fetch resolves (or fails) — before the next fetch in that worker starts.
    // Use this to overlap CPU work (parsing / processing) with network time:
    // while one worker calls onResult, other workers' fetches are still in
    // flight. Errors thrown from onResult are swallowed so they can't poison
    // the worker loop.
    onResult,
  } = options

  if (!Array.isArray(urls)) throw new TypeError('urls must be an array')
  if (typeof fetchFn !== 'function') {
    throw new TypeError('No fetch function available (pass options.fetch in non-browser envs)')
  }

  const result = new Map()
  if (urls.length === 0) return result

  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, concurrency), urls.length)

  async function worker() {
    while (nextIndex < urls.length) {
      throwIfAborted(signal)
      const myIdx = nextIndex++
      const url = urls[myIdx]
      let value
      try {
        value = await fetchOne(url, fetchFn, { signal, maxRetries })
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        value = err
      }
      result.set(url, value)
      if (typeof onResult === 'function') {
        try {
          onResult(url, value)
        } catch {
          // swallow — caller's bug shouldn't kill the worker loop
        }
      }
      if (delayMs > 0 && nextIndex < urls.length) {
        await sleep(delayMs, signal)
      }
    }
  }

  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
  return result
}

async function fetchOne(url, fetchFn, { signal, maxRetries }) {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(signal)
    let res = null
    let networkErr = null
    try {
      res = await fetchFn(url, { signal })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      networkErr = err
    }

    if (res?.ok) return await res.text()

    const status = res?.status ?? null
    const retriable = !!networkErr || status === 429 || (status >= 500 && status < 600)
    if (!retriable || attempt >= maxRetries) {
      const msg = networkErr
        ? `Fetch failed for ${url}: ${networkErr.message}`
        : `HTTP ${status} for ${url}`
      throw new FetchError(msg, { url, status, cause: networkErr ?? undefined })
    }

    const retryAfterMs = parseRetryAfter(res?.headers?.get?.('Retry-After'))
    const backoffMs = retryAfterMs ?? Math.min(2 ** attempt * 500, 8000)
    await sleep(backoffMs, signal)
  }
}

function parseRetryAfter(value) {
  if (!value) return null
  const seconds = Number.parseInt(value, 10)
  if (!Number.isNaN(seconds) && /^\s*\d+\s*$/.test(value)) {
    return seconds * 1000
  }
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return null
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}
