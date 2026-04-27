import { describe, expect, it, vi } from 'vitest'
import { fetchAll, FetchError } from '../../src/lib/rateLimiter.js'

function ok(body) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
}
function status(code, headers = {}) {
  return new Response('', { status: code, headers })
}

describe('fetchAll', () => {
  it('fetches every URL and returns a Map keyed by URL', async () => {
    const fetchFn = vi.fn(async (url) => ok(`body-of-${url}`))
    const urls = ['https://x/1', 'https://x/2', 'https://x/3']
    const result = await fetchAll(urls, { fetch: fetchFn, concurrency: 2 })

    expect(result.size).toBe(3)
    for (const u of urls) expect(result.get(u)).toBe(`body-of-${u}`)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('returns an empty map for an empty input', async () => {
    const fetchFn = vi.fn()
    const result = await fetchAll([], { fetch: fetchFn })
    expect(result.size).toBe(0)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('respects bounded concurrency (never more than N in flight)', async () => {
    let inFlight = 0
    let peak = 0
    const fetchFn = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return ok('hi')
    })
    const urls = Array.from({ length: 10 }, (_, i) => `https://x/${i}`)
    await fetchAll(urls, { fetch: fetchFn, concurrency: 3 })
    expect(peak).toBeLessThanOrEqual(3)
    expect(fetchFn).toHaveBeenCalledTimes(10)
  })

  it('stores per-URL errors in the map (does not throw)', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url.endsWith('/bad')) return status(404)
      return ok(`ok-${url}`)
    })
    const urls = ['https://x/good', 'https://x/bad']
    const result = await fetchAll(urls, { fetch: fetchFn, maxRetries: 0 })

    expect(result.get('https://x/good')).toBe('ok-https://x/good')
    expect(result.get('https://x/bad')).toBeInstanceOf(FetchError)
    expect(result.get('https://x/bad').status).toBe(404)
  })

  it('does not retry on 4xx (other than 429)', async () => {
    const fetchFn = vi.fn(async () => status(404))
    await fetchAll(['https://x/'], { fetch: fetchFn, maxRetries: 2 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('retries 503 then succeeds', async () => {
    let calls = 0
    const fetchFn = vi.fn(async () => {
      calls++
      if (calls < 2) return status(503)
      return ok('eventually')
    })
    const result = await fetchAll(['https://x/'], { fetch: fetchFn, maxRetries: 2 })
    expect(result.get('https://x/')).toBe('eventually')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('retries on a thrown network error then succeeds', async () => {
    let calls = 0
    const fetchFn = vi.fn(async () => {
      calls++
      if (calls === 1) throw new TypeError('network down')
      return ok('recovered')
    })
    const result = await fetchAll(['https://x/'], { fetch: fetchFn, maxRetries: 2 })
    expect(result.get('https://x/')).toBe('recovered')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('honors Retry-After (in seconds) on 429', async () => {
    let calls = 0
    const headers = { 'Retry-After': '0' }
    const fetchFn = vi.fn(async () => {
      calls++
      if (calls === 1) return status(429, headers)
      return ok('after-429')
    })
    const result = await fetchAll(['https://x/'], { fetch: fetchFn, maxRetries: 1 })
    expect(result.get('https://x/')).toBe('after-429')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('surfaces a FetchError after exhausting retries', async () => {
    const fetchFn = vi.fn(async () => status(500))
    const result = await fetchAll(['https://x/'], { fetch: fetchFn, maxRetries: 1 })
    expect(result.get('https://x/')).toBeInstanceOf(FetchError)
    expect(result.get('https://x/').status).toBe(500)
    expect(fetchFn).toHaveBeenCalledTimes(2) // initial + 1 retry
  })

  it('invokes onResult per URL with the resolved value (lets callers overlap CPU work with later fetches)', async () => {
    const observed = []
    const fetchFn = vi.fn(async (url) => {
      // Stagger response timing so we can assert callbacks fire as each one
      // resolves rather than after the whole batch.
      const delay = url.endsWith('/3') ? 5 : url.endsWith('/2') ? 15 : 25
      await new Promise((r) => setTimeout(r, delay))
      return ok(`body-${url}`)
    })
    const result = await fetchAll(['https://x/1', 'https://x/2', 'https://x/3'], {
      fetch: fetchFn,
      concurrency: 3,
      onResult: (url, value) => observed.push({ url, value }),
    })

    expect(observed).toHaveLength(3)
    // Fastest one (/3) called first, then /2, then /1.
    expect(observed[0].url).toBe('https://x/3')
    expect(observed[1].url).toBe('https://x/2')
    expect(observed[2].url).toBe('https://x/1')
    expect(observed[0].value).toBe('body-https://x/3')
    // result Map still populated identically to the no-callback case.
    expect(result.size).toBe(3)
  })

  it('passes errors through onResult and swallows callback exceptions', async () => {
    const observed = []
    const fetchFn = vi.fn(async (url) => {
      if (url.endsWith('/bad')) return status(404)
      return ok(`ok-${url}`)
    })
    await fetchAll(['https://x/good', 'https://x/bad'], {
      fetch: fetchFn,
      maxRetries: 0,
      onResult: (url, value) => {
        observed.push({ url, isError: value instanceof Error })
        if (url.endsWith('/good')) {
          throw new Error('callback bug — should be swallowed, not crash the worker')
        }
      },
    })
    expect(observed).toHaveLength(2)
    expect(observed.find((o) => o.url === 'https://x/bad').isError).toBe(true)
    expect(observed.find((o) => o.url === 'https://x/good').isError).toBe(false)
  })

  it('aborts cleanly when the signal is fired', async () => {
    const controller = new AbortController()
    const fetchFn = vi.fn(async (_, { signal } = {}) => {
      // Long-running request that listens to abort.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000)
        signal?.addEventListener?.('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
      return ok('never')
    })
    const urls = Array.from({ length: 5 }, (_, i) => `https://x/${i}`)
    setTimeout(() => controller.abort(), 5)
    await expect(
      fetchAll(urls, { fetch: fetchFn, signal: controller.signal, concurrency: 2 })
    ).rejects.toThrow(/abort/i)
  })
})
