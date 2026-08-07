import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { extractSession } from '../../../src/adapters/bbo/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (name) => readFileSync(resolve(here, '../../../fixtures/bbo', name), 'utf8')

const HANDS_LIST = fx('hands-list-81382-kemistry.html')
const TRAVELLER = fx('traveller-81382-32138245.html')
const TVIEW = fx('tview-30567-kemistry.html')

const ENTRY = 'https://www.bridgebase.com/myhands/hands.php?tourney=81382-1777478400-&username=kemistry'

function mockFetch(calls) {
  return async (url, opts = {}) => {
    calls.push({ url, credentials: opts.credentials })
    const body = url.includes('tview.php')
      ? TVIEW
      : url.includes('traveller=')
        ? TRAVELLER
        : HANDS_LIST
    return { ok: true, status: 200, text: async () => body }
  }
}

describe('BBO fetch credentials', () => {
  // The whole point of fetching the tournament summary anonymously: BBO
  // withholds real player names from anonymous viewers, so opponents' personal
  // information never enters the archive. Collapsing this into the shared
  // credentialed fetch would start gathering it with no visible signal, which
  // is exactly the kind of regression a test has to catch.
  it('fetches the tournament summary without credentials', async () => {
    const calls = []
    await extractSession(ENTRY, { fetch: mockFetch(calls), log: () => {}, delayMs: 0 })

    const tview = calls.filter((c) => c.url.includes('tview.php'))
    expect(tview.length).toBe(1)
    expect(tview[0].credentials).toBe('omit')
  })

  it('still sends credentials for the hands list and travellers, which require a session', async () => {
    const calls = []
    await extractSession(ENTRY, { fetch: mockFetch(calls), log: () => {}, delayMs: 0 })

    const authed = calls.filter((c) => !c.url.includes('tview.php'))
    expect(authed.length).toBeGreaterThan(1)
    expect(authed.every((c) => c.credentials === 'include')).toBe(true)
  })

  it('reports section labelling only when the summary was obtained', async () => {
    const withTview = await extractSession(ENTRY, {
      fetch: mockFetch([]), log: () => {}, delayMs: 0,
    })
    expect(withTview.coverage.sections_labelled).toBe(true)
    expect(withTview.coverage.player_names).toBe('usernames')

    // Summary unavailable: the extraction still succeeds, but says so honestly.
    const failing = async (url, opts = {}) => {
      if (url.includes('tview.php')) throw new Error('offline')
      return { ok: true, status: 200, text: async () => (url.includes('traveller=') ? TRAVELLER : HANDS_LIST) }
    }
    const without = await extractSession(ENTRY, { fetch: failing, log: () => {}, delayMs: 0 })
    expect(without.coverage.sections_labelled).toBe(false)
    expect(without.tournaments[0].events[0].sessions[0].warnings.join(' ')).toMatch(/summary unavailable/)
  })

  it('prefers the summary’s event name, which the hands list often lacks', async () => {
    const out = await extractSession(ENTRY, { fetch: mockFetch([]), log: () => {}, delayMs: 0 })
    expect(out.tournaments[0].events[0].name).toBe('#30567 ACBL Wed 6PM ET Speedball (GIB)')
  })
})
