import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  injectResultRowLinks,
  setupRowLinks,
  ROW_LINK_CLASS,
} from '../../src/ui/acblResultsList.js'
import { watchExtractionProgress } from '../../src/ui/extractProgress.js'


describe('extraction progress', () => {
  function makeStorage(entries = {}) {
    return { get: vi.fn(async (k) => (k in entries ? { [k]: entries[k] } : {})) }
  }

  beforeEach(() => { document.body.innerHTML = '' })

  it('reports a percentage as boards land', async () => {
    const storage = makeStorage({
      'extract-progress:abc': { done: 13, total: 52, stored_at: Date.now() },
    })
    const seen = []
    const stop = watchExtractionProgress('abc', (pct, done, total) => seen.push([pct, done, total]), storage, 5)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))
    stop()
    expect(seen[0]).toEqual([25, 13, 52])
  })

  it('stops polling once told to, so a finished fetch leaves no timer behind', async () => {
    const storage = makeStorage({ 'extract-progress:abc': { done: 1, total: 4 } })
    const stop = watchExtractionProgress('abc', () => {}, storage, 5)
    await vi.waitFor(() => expect(storage.get).toHaveBeenCalled())
    stop()
    const callsAtStop = storage.get.mock.calls.length
    await new Promise((r) => setTimeout(r, 30))
    expect(storage.get.mock.calls.length).toBe(callsAtStop)
  })

  it('says nothing until a total is known, rather than showing 0%', async () => {
    const storage = makeStorage({ 'extract-progress:abc': { done: 0, total: 0 } })
    const seen = []
    const stop = watchExtractionProgress('abc', (p) => seen.push(p), storage, 5)
    await vi.waitFor(() => expect(storage.get).toHaveBeenCalled())
    stop()
    expect(seen).toEqual([])
  })

  it('sends a progress key with the row-link extraction', async () => {
    document.body.innerHTML = `
      <base href="https://live.acbl.org/my-results">
      <h1>Rick Wilson's Results</h1>
      <table><thead><tr><th>Date</th><th>Event</th><th>Links</th></tr></thead><tbody>
        <tr><td>06/27</td><td>Open Pairs</td>
            <td class="links"><a class="summary" href="/event/1/2/1/summary">Summary</a></td></tr>
      </tbody></table>`
    injectResultRowLinks({ document })
    const sendMessage = vi.fn(async () => ({ type: 'extraction-complete' }))
    setupRowLinks({ document, sendMessage, storage: makeStorage() })
    document.querySelector(`.${ROW_LINK_CLASS}`).click()
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled())
    expect(sendMessage.mock.calls[0][0].progressKey).toEqual(expect.any(String))
  })
})
