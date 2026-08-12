import { describe, expect, it } from 'vitest'
import { parseDoubleDummyLine } from '../../src/lib/doubleDummy.js'

// live.acbl.org writes a dash where a side cannot make anything at a strain:
// '1/-S' means one side makes 1S and the other makes nothing. The parser
// treated it as an unrecognized token, which failed the board — and because
// parseBoardDetail builds the whole board, that discarded every table that
// played it. Two boards of 26 were lost this way in event 2606319.
describe('parseDoubleDummyLine — dash for "cannot make"', () => {
  it('reads a dash as null rather than warning', () => {
    const r = parseDoubleDummyLine('1/-S')
    expect(r.warnings).toEqual([])
    expect(r.first.S).toBe(7) // 1S = 7 tricks
    expect(r.second.S).toBeNull()
  })

  it('handles no-trump the same way', () => {
    const r = parseDoubleDummyLine('1/-NT')
    expect(r.warnings).toEqual([])
    expect(r.first.NT).toBe(7)
    expect(r.second.NT).toBeNull()
  })

  it('handles a dash on the first side', () => {
    const r = parseDoubleDummyLine('-/4S')
    expect(r.warnings).toEqual([])
    expect(r.first.S).toBeNull()
    expect(r.second.S).toBe(10)
  })

  it('handles both sides dashed', () => {
    const r = parseDoubleDummyLine('-/-H')
    expect(r.warnings).toEqual([])
    expect(r.first.H).toBeNull()
    expect(r.second.H).toBeNull()
  })

  it('joins a slash form split by whitespace, as the HTML renders it', () => {
    // The suit symbol forces "- / 4S" apart in the markup; without joining,
    // '-/' tokenised on its own and warned.
    const r = parseDoubleDummyLine('EW: - / 4S')
    expect(r.warnings).toEqual([])
    expect(r.second.S).toBe(10)
  })

  it('still parses the ordinary forms unchanged', () => {
    const numeric = parseDoubleDummyLine('4/ 5C')
    expect(numeric.warnings).toEqual([])
    expect(numeric.first.C).toBe(10)
    expect(numeric.second.C).toBe(11)

    const rawTricks = parseDoubleDummyLine('C5/6')
    expect(rawTricks.warnings).toEqual([])
    expect(rawTricks.first.C).toBe(5)
    expect(rawTricks.second.C).toBe(6)
  })

  it('still warns on a token it genuinely cannot read', () => {
    const r = parseDoubleDummyLine('wibble')
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/unrecognized DD token/)
  })
})
