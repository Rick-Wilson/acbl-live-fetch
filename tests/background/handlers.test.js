import { describe, expect, it, vi } from 'vitest'
import {
  handleMessage,
  runExtraction,
  consumePending,
  sweepExpired,
  PENDING_PREFIX,
  PENDING_TTL_MS,
  DEFAULT_INGEST_URL,
  getIngestUrl,
  getBboUsername,
  isTeamEvent,
  cancelBatch,
  BBO_USERNAME_KEY,
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

    expect(tabs.create).toHaveBeenCalledWith({ url: `${DEFAULT_INGEST_URL}#sid=abc-123` })
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

describe('getIngestUrl', () => {
  const store = (data) => ({ get: async () => data })

  it('falls back to .org', async () => {
    expect(await getIngestUrl(store({}))).toBe(DEFAULT_INGEST_URL)
  })

  it('honours the tracked TLD', async () => {
    expect(await getIngestUrl(store({ preferredTld: 'com' })))
      .toBe('https://bridge-classroom.com/ingest/?v=1')
  })

  // An install that predates the rename must not silently change destination.
  it('still reads the pre-rename keys', async () => {
    expect(await getIngestUrl(store({ preferredAnalyzerTld: 'com' })))
      .toBe('https://bridge-classroom.com/ingest/?v=1')
    const legacy = 'https://example.test/ingest/?v=1'
    expect(await getIngestUrl(store({ devAnalyzerUrl: legacy }))).toBe(legacy)
  })

  it('prefers the current key over the legacy one', async () => {
    const current = 'https://current.test/ingest/'
    expect(await getIngestUrl(store({ devIngestUrl: current, devAnalyzerUrl: 'https://old.test/' })))
      .toBe(current)
  })

  // The ingest route is the default destination: it receives the payload and
  // forwards it to whichever tool the user picks, so adding a consumer doesn't
  // need an extension release (ADR 0001). The trailing slash avoids the 301.
  it('defaults to the versioned ingest route', async () => {
    const url = await getIngestUrl(store({}))
    expect(url).toBe('https://bridge-classroom.org/ingest/?v=1')
    expect(new URL(url).pathname).toBe('/ingest/')
  })

  // How the extension is pointed at the GitHub Pages test ingester: the
  // override is returned verbatim, with no host restriction, so an operator can
  // redirect the hand-off without a rebuild.
  it('returns devIngestUrl verbatim, including a Pages ingest URL', async () => {
    const pages = 'https://bridge-craftwork.github.io/bridge-classroom-fetch/ingest/?v=1'
    expect(await getIngestUrl(store({ devIngestUrl: pages }))).toBe(pages)
  })

  it('lets the override win over a tracked TLD', async () => {
    const pages = 'https://bridge-craftwork.github.io/bridge-classroom-fetch/ingest/?v=1'
    expect(await getIngestUrl(store({ devIngestUrl: pages, preferredTld: 'com' })))
      .toBe(pages)
  })
})

describe('identifying caches expire', () => {
  const HOUR = 60 * 60 * 1000
  const fakeStorage = (data) => {
    const store = { ...data }
    return {
      get: async (k) => (k === null ? { ...store } : { [k]: store[k] }),
      set: async (obj) => Object.assign(store, obj),
      remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
      _dump: () => store,
    }
  }

  it('keeps a fresh username', async () => {
    const storage = fakeStorage({ [BBO_USERNAME_KEY]: { username: 'kemistry', stored_at: Date.now() } })
    expect((await getBboUsername({ storage })).username).toBe('kemistry')
  })

  it('does not return a username past the TTL', async () => {
    const storage = fakeStorage({
      [BBO_USERNAME_KEY]: { username: 'kemistry', stored_at: Date.now() - 2 * HOUR },
    })
    expect((await getBboUsername({ storage })).username).toBeNull()
  })

  // Nothing personally identifying should outlive the game data, so the sweep
  // has to reach these two as well as the pending- prefixes.
  it('sweeps a stale username and batch result', async () => {
    const storage = fakeStorage({
      [BBO_USERNAME_KEY]: { username: 'kemistry', stored_at: Date.now() - 2 * HOUR },
      'bbo-batch-result': { urls: ['https://x'], timestamp: Date.now() - 2 * HOUR },
      preferredTld: 'org',
    })
    await sweepExpired({ storage })
    expect(storage._dump()).toEqual({ preferredTld: 'org' })
  })

  it('leaves fresh ones alone', async () => {
    const storage = fakeStorage({
      [BBO_USERNAME_KEY]: { username: 'kemistry', stored_at: Date.now() },
      'bbo-batch-result': { urls: [], timestamp: Date.now() },
    })
    await sweepExpired({ storage })
    expect(Object.keys(storage._dump()).sort()).toEqual(['bbo-batch-result', 'bbo-username'])
  })

  // Earlier versions stored a bare string with no timestamp; it can't be aged,
  // so it goes and is re-derived from any BBO page.
  it('sweeps a legacy bare-string username', async () => {
    const storage = fakeStorage({ [BBO_USERNAME_KEY]: 'kemistry' })
    await sweepExpired({ storage })
    expect(storage._dump()).toEqual({})
  })
})

// A team game's results pages carry no board detail, so extracting one fails
// and occupies a slot in the batch for nothing. Event 2608344 surfaced this:
// a team game at the top of a month's range, and the run looked like it had
// done nothing.
describe('isTeamEvent', () => {
  it('recognises the event list Type column', () => {
    expect(isTeamEvent({ type: 'TEAMS' })).toBe(true)
    expect(isTeamEvent({ type: 'Teams' })).toBe(true)
    expect(isTeamEvent({ type: 'PAIRS' })).toBe(false)
  })

  it('falls back to the event name when Type is absent', () => {
    expect(isTeamEvent({ name: 'Saturday Swiss Teams' })).toBe(true)
    expect(isTeamEvent({ name: 'Open Pairs' })).toBe(false)
  })

  it('does not mistake a pairs game whose name merely contains "team"', () => {
    // "Teammates" would false-positive on a bare substring match.
    expect(isTeamEvent({ type: 'PAIRS', name: 'Teammates Charity Pairs' })).toBe(false)
  })

  it('tolerates missing fields', () => {
    expect(isTeamEvent({})).toBe(false)
    expect(isTeamEvent(null)).toBe(false)
  })
})

// Stop was only consulted between events. An ACBL event runs for a minute or
// more, so pressing it mid-event did nothing visible and the button looked
// broken. cancelBatch now aborts the batch's signal as well as setting the
// storage flag.
describe('cancelBatch', () => {
  it('acknowledges and sets the cancel flag', async () => {
    const store = {}
    const storage = {
      set: vi.fn(async (o) => Object.assign(store, o)),
      get: vi.fn(async (k) => ({ [k]: store[k] })),
      remove: vi.fn(async () => {}),
    }
    const res = await cancelBatch('abc', { storage })
    expect(res).toEqual({ type: 'cancel-acknowledged', key: 'abc' })
    expect(store['cancel-batch:abc']).toBe(true)
  })

  it('rejects a missing key rather than cancelling everything', async () => {
    const res = await cancelBatch('', { storage: { set: vi.fn() } })
    expect(res.type).toBe('cancel-error')
  })
})
