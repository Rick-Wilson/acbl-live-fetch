import { describe, it, expect } from 'vitest'
import { buildWorkList } from '../../tools/fetch-replays.js'

// Minimal envelope tree: one board, one user row plus `others`.
function doc(userContract, userDeclarer, others) {
  return {
    envelopes: [{
      tournaments: [{
        events: [{
          sessions: [{
            boards: [{
              number: 1,
              user_result_index: 0,
              results: [
                { contract: userContract, declarer: userDeclarer, play: ['S2'], handviewer_url: 'x?myhand=M-1000-99' },
                ...others.map((o, i) => ({
                  contract: o.contract,
                  declarer: o.declarer,
                  play: o.play ?? null,
                  handviewer_url: `x?myhand=M-${2000 + i}-99`,
                })),
              ],
            }],
          }],
        }],
      }],
    }],
  }
}

const ids = (work) => work.map((w) => w.id)

describe('buildWorkList', () => {
  const rows = [
    { contract: '4S', declarer: 'N' },
    { contract: '3NT', declarer: 'S' },
    { contract: '4S', declarer: 'N' },
    { contract: '4S', declarer: 'S' },
    { contract: '4SX', declarer: 'N' },
    { contract: '4S', declarer: 'N' },
  ]

  it('takes every other table by default', () => {
    expect(ids(buildWorkList(doc('4S', 'N', rows)))).toEqual(
      ['2000', '2001', '2002', '2003', '2004', '2005']
    )
  })

  it('skips rows that already have play', () => {
    const withPlay = rows.map((r, i) => (i === 1 ? { ...r, play: ['H3'] } : r))
    expect(ids(buildWorkList(doc('4S', 'N', withPlay)))).not.toContain('2001')
  })

  // Rerunning against an already-merged file must not slide the cap onto rows
  // a narrower run never intended to take.
  it('a cap selects the same rows whether or not earlier ones are filled', () => {
    const opts = { sameContract: true, maxPerBoard: 2 }
    const fresh = ids(buildWorkList(doc('4S', 'N', rows), opts))
    const merged = rows.map((r, i) => (i === 0 ? { ...r, play: ['H3'] } : r))
    // 2000 is already filled, so it drops out — but 2002 does not get replaced
    // by the next eligible row (2005); the cap still covers the same two rows.
    expect(fresh).toEqual(['2000', '2002'])
    expect(ids(buildWorkList(doc('4S', 'N', merged), opts))).toEqual(['2002'])
  })

  describe('--min-per-board', () => {
    it('drops boards with too few comparable tables', () => {
      const opts = { sameContract: true, minPerBoard: 4 }
      // Only three tables match 4S by N, so the whole board is skipped.
      expect(buildWorkList(doc('4S', 'N', rows), opts)).toEqual([])
    })

    it('keeps boards that clear the bar', () => {
      const opts = { sameContract: true, minPerBoard: 3 }
      expect(ids(buildWorkList(doc('4S', 'N', rows), opts))).toEqual(['2000', '2002', '2005'])
    })

    it('counts comparable tables before any cap is applied', () => {
      // The gate asks how broad the comparison is; the cap only limits how much
      // of it we fetch. A cap below the minimum must not disqualify the board.
      const opts = { sameContract: true, minPerBoard: 3, maxPerBoard: 1 }
      expect(ids(buildWorkList(doc('4S', 'N', rows), opts))).toEqual(['2000'])
    })

    it('counts comparable tables regardless of what is already fetched', () => {
      const filled = rows.map((r) => ({ ...r, play: ['H3'] }))
      const opts = { sameContract: true, minPerBoard: 3 }
      // All filled, so nothing to fetch — but the board still qualified.
      expect(buildWorkList(doc('4S', 'N', filled), opts)).toEqual([])
      // And lowering the bar can't resurrect rows that are already filled.
      expect(buildWorkList(doc('4S', 'N', filled), { sameContract: true })).toEqual([])
    })

    it('lowering the minimum is a superset', () => {
      const hi = ids(buildWorkList(doc('4S', 'N', rows), { sameContract: true, minPerBoard: 3 }))
      const lo = ids(buildWorkList(doc('4S', 'N', rows), { sameContract: true, minPerBoard: 1 }))
      for (const id of hi) expect(lo).toContain(id)
    })
  })

  it('same-contract keeps only your exact contract and declarer seat', () => {
    // 2003 is 4S from the other seat, 2004 is doubled — both excluded.
    expect(ids(buildWorkList(doc('4S', 'N', rows), { sameContract: true }))).toEqual(
      ['2000', '2002', '2005']
    )
  })

  it('same-contract yields nothing when the board was passed out at your table', () => {
    expect(buildWorkList(doc(null, null, rows), { sameContract: true })).toEqual([])
  })

  // The property the resumable workflow depends on: a narrower run's selection
  // must be a subset of a wider one, so raising the cap or dropping the filter
  // only ever adds work rather than shifting which rows get fetched.
  describe('selection is nested', () => {
    it('raising the cap is a superset of a lower cap', () => {
      const cap2 = ids(buildWorkList(doc('4S', 'N', rows), { maxPerBoard: 2 }))
      const cap4 = ids(buildWorkList(doc('4S', 'N', rows), { maxPerBoard: 4 }))
      const uncapped = ids(buildWorkList(doc('4S', 'N', rows)))
      expect(cap4.slice(0, cap2.length)).toEqual(cap2)
      expect(uncapped.slice(0, cap4.length)).toEqual(cap4)
    })

    it('dropping same-contract is a superset of keeping it', () => {
      const filtered = ids(buildWorkList(doc('4S', 'N', rows), { sameContract: true }))
      const all = ids(buildWorkList(doc('4S', 'N', rows)))
      for (const id of filtered) expect(all).toContain(id)
    })

    it('cap composes with same-contract as a prefix', () => {
      const opts = { sameContract: true }
      const cap1 = ids(buildWorkList(doc('4S', 'N', rows), { ...opts, maxPerBoard: 1 }))
      const cap2 = ids(buildWorkList(doc('4S', 'N', rows), { ...opts, maxPerBoard: 2 }))
      const full = ids(buildWorkList(doc('4S', 'N', rows), opts))
      expect(cap1).toEqual(['2000'])
      expect(cap2).toEqual(['2000', '2002'])
      expect(full.slice(0, 2)).toEqual(cap2)
    })
  })
})
