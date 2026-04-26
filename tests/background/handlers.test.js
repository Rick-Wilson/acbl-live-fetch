import { describe, expect, it, vi } from 'vitest'
import {
  handleMessage,
  runExtraction,
  consumePending,
  sweepExpired,
  PENDING_PREFIX,
  PENDING_TTL_MS,
  ANALYZER_URL,
} from '../../src/background/handlers.js'

function makeStorage(initial = {}) {
  const store = { ...initial }
  return {
    store,
    get: vi.fn(async (key) => {
      if (key === null || key === undefined) return { ...store }
      if (Array.isArray(key)) {
        const out = {}
        for (const k of key) if (k in store) out[k] = store[k]
        return out
      }
      return key in store ? { [key]: store[key] } : {}
    }),
    set: vi.fn(async (obj) => {
      Object.assign(store, obj)
    }),
    remove: vi.fn(async (keyOrKeys) => {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]
      for (const k of keys) delete store[k]
    }),
  }
}

function makeCrypto(uuid = '11111111-2222-3333-4444-555555555555') {
  return { randomUUID: vi.fn(() => uuid) }
}

function makeTabs() {
  return { create: vi.fn(async () => ({ id: 99 })) }
}

describe('runExtraction', () => {
  it('extracts, stores under pending-sessions:<uuid>, opens analyzer tab, returns sid', async () => {
    const storage = makeStorage()
    const tabs = makeTabs()
    const crypto = makeCrypto('abc-123')
    const envelope = { schema_version: '1.0', source: 'acbl-live', session: { event_id: '1' } }
    const extract = vi.fn(async () => envelope)

    const result = await runExtraction('https://live.acbl.org/event/1/2/3/scores/A/E/4', {
      storage,
      tabs,
      crypto,
      extract,
    })

    expect(result).toEqual({ type: 'extraction-complete', sid: 'abc-123' })
    expect(extract).toHaveBeenCalledTimes(1)
    expect(storage.set).toHaveBeenCalledTimes(1)

    const stored = storage.store[`${PENDING_PREFIX}abc-123`]
    expect(stored.envelope).toBe(envelope)
    expect(typeof stored.stored_at).toBe('number')

    expect(tabs.create).toHaveBeenCalledWith({ url: `${ANALYZER_URL}#sid=abc-123` })
  })

  it('returns extraction-error on extractor failure (no tab opened)', async () => {
    const storage = makeStorage()
    const tabs = makeTabs()
    const err = new Error('boom')
    err.name = 'FetchError'
    const extract = vi.fn(async () => {
      throw err
    })

    const result = await runExtraction('https://live.acbl.org/foo', {
      storage,
      tabs,
      crypto: makeCrypto(),
      extract,
    })

    expect(result.type).toBe('extraction-error')
    expect(result.error.code).toBe('fetch-failed')
    expect(result.error.message).toBe('boom')
    expect(tabs.create).not.toHaveBeenCalled()
    expect(Object.keys(storage.store)).toHaveLength(0)
  })

  it('rejects missing/empty URL', async () => {
    const result = await runExtraction('', {
      storage: makeStorage(),
      tabs: makeTabs(),
      crypto: makeCrypto(),
      extract: vi.fn(),
    })
    expect(result.type).toBe('extraction-error')
    expect(result.error.code).toBe('bad-request')
  })

  it('classifies ParseError and AbortError', async () => {
    const cases = [
      { err: Object.assign(new Error('p'), { name: 'ParseError' }), expected: 'parse-failed' },
      { err: Object.assign(new Error('a'), { name: 'AbortError' }), expected: 'aborted' },
      { err: new Error('plain'), expected: 'unknown' },
    ]
    for (const { err, expected } of cases) {
      const result = await runExtraction('https://x/', {
        storage: makeStorage(),
        tabs: makeTabs(),
        crypto: makeCrypto(),
        extract: vi.fn(async () => {
          throw err
        }),
      })
      expect(result.error.code).toBe(expected)
    }
  })
})

describe('consumePending', () => {
  it('returns the envelope and deletes the storage entry on success', async () => {
    const envelope = { schema_version: '1.0', source: 'acbl-live' }
    const storage = makeStorage({
      [`${PENDING_PREFIX}abc`]: { stored_at: Date.now(), envelope },
    })

    const result = await consumePending('abc', { storage })

    expect(result).toEqual({ type: 'pending-session', envelope })
    expect(storage.remove).toHaveBeenCalledWith(`${PENDING_PREFIX}abc`)
    expect(storage.store).toEqual({})
  })

  it("returns reason='missing' for an unknown sid", async () => {
    const storage = makeStorage()
    const result = await consumePending('nope', { storage })
    expect(result).toEqual({ type: 'no-pending-session', reason: 'missing' })
  })

  it("returns reason='expired' (and removes the stale entry) for an aged entry", async () => {
    const storage = makeStorage({
      [`${PENDING_PREFIX}old`]: {
        stored_at: Date.now() - PENDING_TTL_MS - 1000,
        envelope: { x: 1 },
      },
    })
    const result = await consumePending('old', { storage })
    expect(result).toEqual({ type: 'no-pending-session', reason: 'expired' })
    expect(storage.store).toEqual({})
  })

  it("returns reason='malformed' when envelope is missing", async () => {
    const storage = makeStorage({
      [`${PENDING_PREFIX}bad`]: { stored_at: Date.now() }, // no envelope
    })
    const result = await consumePending('bad', { storage })
    expect(result).toEqual({ type: 'no-pending-session', reason: 'malformed' })
    expect(storage.store).toEqual({})
  })

  it("returns reason='missing' for empty sid", async () => {
    const storage = makeStorage()
    const result = await consumePending('', { storage })
    expect(result.reason).toBe('missing')
  })
})

describe('sweepExpired', () => {
  it('removes only entries older than TTL under the pending- prefix', async () => {
    const now = Date.now()
    const storage = makeStorage({
      [`${PENDING_PREFIX}fresh`]: { stored_at: now - 1000, envelope: {} },
      [`${PENDING_PREFIX}stale`]: { stored_at: now - PENDING_TTL_MS - 1, envelope: {} },
      'unrelated:key': { stored_at: 0 },
    })

    const removed = await sweepExpired({ storage })

    expect(removed).toEqual([`${PENDING_PREFIX}stale`])
    expect(storage.store).toEqual({
      [`${PENDING_PREFIX}fresh`]: expect.any(Object),
      'unrelated:key': expect.any(Object),
    })
  })
})

describe('handleMessage dispatch', () => {
  it("dispatches 'extract-session' to runExtraction", async () => {
    const storage = makeStorage()
    const tabs = makeTabs()
    const result = await handleMessage(
      { type: 'extract-session', url: 'https://x/' },
      {
        storage,
        tabs,
        crypto: makeCrypto('xyz'),
        extract: vi.fn(async () => ({ schema_version: '1.0' })),
      }
    )
    expect(result.type).toBe('extraction-complete')
    expect(result.sid).toBe('xyz')
  })

  it("dispatches 'consume-pending-session' to consumePending", async () => {
    const storage = makeStorage({
      [`${PENDING_PREFIX}sid`]: { stored_at: Date.now(), envelope: { ok: true } },
    })
    const result = await handleMessage({ type: 'consume-pending-session', sid: 'sid' }, { storage })
    expect(result.type).toBe('pending-session')
    expect(result.envelope).toEqual({ ok: true })
  })

  it('returns extraction-error for unknown message types and missing/invalid messages', async () => {
    const storage = makeStorage()
    expect((await handleMessage({ type: 'foo' }, { storage })).type).toBe('extraction-error')
    expect((await handleMessage(null, { storage })).type).toBe('extraction-error')
    expect((await handleMessage({}, { storage })).type).toBe('extraction-error')
  })
})
