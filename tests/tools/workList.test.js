import { describe, it, expect } from 'vitest'
import { buildWorkList } from '../../tools/fetch-replays.js'

// Minimal envelope tree: one board, one user row plus `others`.
// userTricks defaults to null — only the --worse-than-field cases need it.
function doc(userContract, userDeclarer, others, userTricks = null) {
  return {
    envelopes: [{
      tournaments: [{
        events: [{
          sessions: [{
            boards: [{
              number: 1,
              user_result_index: 0,
              results: [
                {
                  contract: userContract,
                  declarer: userDeclarer,
                  tricks: userTricks,
                  play: ['S2'],
                  handviewer_url: 'x?myhand=M-1000-99',
                },
                ...others.map((o, i) => ({
                  contract: o.contract,
                  declarer: o.declarer,
                  tricks: o.tricks ?? null,
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

  describe('--worse-than-field', () => {
    // Peers all in 4S by N so they're comparable; your tricks vary per case.
    const peers = (...tricks) => tricks.map((t) => ({ contract: '4S', declarer: 'N', tricks: t }))

    const opts = (mode) => ({ worseThanField: mode, sameContract: true })

    it('keeps a board where you trail the field', () => {
      const d = doc('4S', 'N', peers(10, 10, 11), 10)      // mean 10.33
      expect(ids(buildWorkList(d, opts('mean')))).toHaveLength(3)
    })

    it('drops a board where you match the field', () => {
      const d = doc('4S', 'N', peers(10, 10, 10), 10)
      for (const mode of ['mean', 'median', 'best']) {
        expect(buildWorkList(d, opts(mode))).toEqual([])
      }
    })

    // The distinction that motivates not defaulting to `best`: a single table
    // beating the field is an outlier, and an extreme-order statistic reacts to
    // it where a robust one doesn't.
    it('best reacts to a lone outlier where median does not', () => {
      const d = doc('4S', 'N', peers(10, 10, 10, 10, 13), 10)
      expect(buildWorkList(d, opts('best'))).not.toEqual([])
      expect(buildWorkList(d, opts('median'))).toEqual([])
      // mean is 10.6, so one outlier does drag it above your 10 — median is the
      // more robust choice when that matters.
      expect(buildWorkList(d, opts('mean'))).not.toEqual([])
    })

    it('skips boards with no comparable table or no trick count', () => {
      const noPeers = doc('4S', 'N', [{ contract: '3NT', declarer: 'S', tricks: 9 }], 10)
      expect(buildWorkList(noPeers, { worseThanField: 'mean' })).toEqual([])

      const noTricks = doc('4S', 'N', peers(11), null)
      expect(buildWorkList(noTricks, { worseThanField: 'mean' })).toEqual([])
    })
  })

  describe('--player', () => {
    // doc() names every seat 'x' by default, so give specific rows real seats.
    const seated = (names) => ({
      contract: '4S',
      declarer: 'N',
      ns: names.slice(0, 2),
      ew: names.slice(2, 4),
    })

    const withSeats = (rows) => {
      const d = doc('4S', 'N', rows)
      const results = d.envelopes[0].tournaments[0].events[0].sessions[0].boards[0].results
      rows.forEach((row, i) => {
        if (!row.ns) return
        results[i + 1].ns_pair = { players: row.ns.map((name) => ({ name })) }
        results[i + 1].ew_pair = { players: row.ew.map((name) => ({ name })) }
      })
      return d
    }

    it('keeps only tables where the player sat', () => {
      const d = withSeats([
        seated(['gavin', 'Nazinator', 'a', 'b']),
        seated(['c', 'd', 'e', 'f']),
        seated(['g', 'h', 'gavin', 'i']),
      ])
      expect(ids(buildWorkList(d, { players: ['gavin'] }))).toEqual(['2000', '2002'])
    })

    // BBO stores usernames as typed but treats them as case-insensitive, so
    // 'EMWNY' and 'emwny' are one person.
    it('matches case-insensitively', () => {
      const d = withSeats([seated(['GAVIN', 'x', 'y', 'z'])])
      expect(ids(buildWorkList(d, { players: ['gavin'] }))).toEqual(['2000'])
      expect(ids(buildWorkList(d, { players: ['GaViN'] }))).toEqual(['2000'])
    })

    it('accepts several players', () => {
      const d = withSeats([
        seated(['gavin', 'a', 'b', 'c']),
        seated(['d', 'e', 'f', 'g']),
        seated(['h', 'nazinator', 'i', 'j']),
      ])
      expect(ids(buildWorkList(d, { players: ['gavin', 'Nazinator'] }))).toEqual(['2000', '2002'])
    })

    it('matches whole names, not substrings', () => {
      const d = withSeats([seated(['gavinx', 'a', 'b', 'c'])])
      expect(buildWorkList(d, { players: ['gavin'] })).toEqual([])
    })
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
