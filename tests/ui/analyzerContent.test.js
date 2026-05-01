import { describe, expect, it, vi } from 'vitest'
import { parseSid, runHandoff, PENDING_SESSION_KEY, PENDING_BATCH_KEY, HANDOFF_ERROR_KEY } from '../../src/ui/analyzerContent.js'

const VALID = '11111111-2222-4333-8444-555555555555'

describe('parseSid', () => {
  it('extracts a UUID from a valid #sid= fragment', () => {
    expect(parseSid(`#sid=${VALID}`)).toBe(VALID)
  })

  it('handles fragments without the leading #', () => {
    expect(parseSid(`sid=${VALID}`)).toBe(VALID)
  })

  it('returns null for missing or non-UUID values', () => {
    expect(parseSid('')).toBeNull()
    expect(parseSid(null)).toBeNull()
    expect(parseSid('#')).toBeNull()
    expect(parseSid('#foo=bar')).toBeNull()
    expect(parseSid('#sid=not-a-uuid')).toBeNull()
    expect(parseSid('#sid=12345678-1234-1234-1234-12345')).toBeNull() // wrong length
  })
})

function makeStorage() {
  const store = new Map()
  return {
    store,
    setItem: vi.fn((k, v) => store.set(k, v)),
    getItem: vi.fn((k) => (store.has(k) ? store.get(k) : null)),
    removeItem: vi.fn((k) => store.delete(k)),
  }
}

function makeLocation(hash) {
  return { hash, pathname: '/analyze', search: '' }
}

function makeHistory() {
  return { replaceState: vi.fn() }
}

describe('runHandoff', () => {
  it('returns no-sid when fragment is missing or invalid', async () => {
    const result = await runHandoff({
      location: makeLocation(''),
      history: makeHistory(),
      sessionStorage: makeStorage(),
      sendMessage: vi.fn(),
    })
    expect(result).toEqual({ state: 'no-sid' })
  })

  it('writes the envelope into sessionStorage and clears the fragment on success', async () => {
    const envelope = { schema_version: '1.0', source: 'acbl-live', session: {} }
    const sendMessage = vi.fn(async () => ({ type: 'pending-session', envelope }))
    const sessionStorage = makeStorage()
    const history = makeHistory()
    const location = makeLocation(`#sid=${VALID}`)

    const result = await runHandoff({ location, history, sessionStorage, sendMessage })

    expect(result).toEqual({ state: 'written', sid: VALID })
    expect(sendMessage).toHaveBeenCalledWith({ type: 'consume-pending-session', sid: VALID })
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      PENDING_SESSION_KEY,
      JSON.stringify(envelope)
    )
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/analyze')
  })

  it('returns no-session when SW reports the entry is missing', async () => {
    const sendMessage = vi.fn(async () => ({ type: 'no-pending-session', reason: 'expired' }))
    const sessionStorage = makeStorage()
    const result = await runHandoff({
      location: makeLocation(`#sid=${VALID}`),
      history: makeHistory(),
      sessionStorage,
      sendMessage,
    })
    expect(result).toEqual({ state: 'no-session', reason: 'expired' })
    expect(sessionStorage.setItem).not.toHaveBeenCalled()
  })

  it('returns send-failed if sendMessage rejects', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('disconnected')
    })
    const result = await runHandoff({
      location: makeLocation(`#sid=${VALID}`),
      history: makeHistory(),
      sessionStorage: makeStorage(),
      sendMessage,
    })
    expect(result.state).toBe('send-failed')
    expect(result.error).toBe('disconnected')
  })

  it('returns malformed-response for an unexpected response shape', async () => {
    for (const bad of [null, undefined, 'string', { type: 'pending-session' /* no envelope */ }]) {
      const sendMessage = vi.fn(async () => bad)
      const result = await runHandoff({
        location: makeLocation(`#sid=${VALID}`),
        history: makeHistory(),
        sessionStorage: makeStorage(),
        sendMessage,
      })
      expect(result.state).toBe('malformed-response')
    }
  })

  it('returns storage-failed and writes error key when sessionStorage is full (single-game)', async () => {
    const envelope = { schema_version: '1.0', source: 'acbl-live' }
    const sendMessage = vi.fn(async () => ({ type: 'pending-session', envelope }))
    const sessionStorage = makeStorage()
    const storageError = new Error('QuotaExceededError')
    sessionStorage.setItem.mockImplementation((k) => {
      if (k === PENDING_SESSION_KEY) throw storageError
    })
    const dispatchEvent = vi.fn()

    const result = await runHandoff({
      location: makeLocation(`#sid=${VALID}`),
      history: makeHistory(),
      sessionStorage,
      sendMessage,
      dispatchEvent,
    })

    expect(result).toEqual({ state: 'storage-failed', error: storageError.message })
    expect(sessionStorage.setItem).toHaveBeenCalledWith(HANDOFF_ERROR_KEY, storageError.message)
    expect(dispatchEvent).toHaveBeenCalled()
  })

  it('returns storage-failed and writes error key when sessionStorage is full (batch)', async () => {
    const sendMessage = vi.fn(async () => ({
      type: 'pending-batch',
      items: [{ compressed: 'abc', source_url: 'https://example.com' }],
      total: 1,
      errors: [],
    }))
    const sessionStorage = makeStorage()
    const storageError = new Error('QuotaExceededError')
    sessionStorage.setItem.mockImplementation((k) => {
      if (k === PENDING_BATCH_KEY) throw storageError
    })
    const dispatchEvent = vi.fn()
    const batchKey = '22222222-2222-4333-8444-555555555555'

    const result = await runHandoff({
      location: makeLocation(`#batch=${batchKey}`),
      history: makeHistory(),
      sessionStorage,
      sendMessage,
      dispatchEvent,
    })

    expect(result).toEqual({ state: 'storage-failed', error: storageError.message })
    expect(sessionStorage.setItem).toHaveBeenCalledWith(HANDOFF_ERROR_KEY, storageError.message)
    expect(dispatchEvent).toHaveBeenCalled()
  })
})
