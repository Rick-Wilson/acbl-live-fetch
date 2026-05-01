import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseTraveller, parseResultText } from '../../../src/adapters/bbo/parsers/traveller.js'

const fixtureDir = join(import.meta.dirname, '../../../fixtures/bbo')
const html = readFileSync(join(fixtureDir, 'traveller-81382-32138245.html'), 'utf8')

describe('parseTraveller — fixture 81382-32138245 (board 1)', () => {
  let result
  beforeEach(() => {
    result = parseTraveller(html)
  })

  it('finds 31 result rows', () => {
    expect(result.results).toHaveLength(31)
  })

  it('identifies user result index (0-based row 16 = HTML row 17)', () => {
    expect(result.userResultIndex).toBe(16)
  })

  describe('row 0 — 6NE= (best result)', () => {
    let r
    beforeEach(() => { r = result.results[0] })

    it('has correct players', () => {
      expect(r.players).toEqual({ N: 'rmatthias', S: 'Minkyg1', E: 'fasteddie3', W: 'fastkaren' })
    })

    it('has normalized result text', () => {
      expect(r.resultText).toBe('6NE=')
    })

    it('has EW points 990 (EW gained)', () => {
      expect(r.ewPoints).toBe(990)
    })

    it('has positive comparison score', () => {
      expect(r.comparisonScore).toBeCloseTo(11.23)
    })

    it('has handviewer URL', () => {
      expect(r.handviewerUrl).toContain('handviewer.html')
    })
  })

  describe('row 16 — user result 3NW+2', () => {
    let r
    beforeEach(() => { r = result.results[16] })

    it('has correct players', () => {
      expect(r.players).toEqual({ N: 'kaodul', S: 'norreb', E: 'kemistry', W: 'aam135' })
    })

    it('has result text 3NW+2', () => {
      expect(r.resultText).toBe('3NW+2')
    })

    it('has EW points 460', () => {
      expect(r.ewPoints).toBe(460)
    })

    it('has comparison score 3.00', () => {
      expect(r.comparisonScore).toBeCloseTo(3.0)
    })
  })

  describe('row 25 — 6HE-1 (negative score)', () => {
    let r
    beforeEach(() => { r = result.results[25] })

    it('has negative EW points', () => {
      expect(r.ewPoints).toBe(-50)
    })

    it('has negative comparison score', () => {
      expect(r.comparisonScore).toBeCloseTo(-6.31)
    })
  })
})

describe('parseResultText', () => {
  it('parses 3NW+2 → 3NT by West, 11 tricks', () => {
    const r = parseResultText('3NW+2')
    expect(r.contract).toBe('3NT')
    expect(r.declarer).toBe('W')
    expect(r.tricks).toBe(11)
  })

  it('parses 6NE= → 6NT by East, 12 tricks', () => {
    const r = parseResultText('6NE=')
    expect(r.contract).toBe('6NT')
    expect(r.declarer).toBe('E')
    expect(r.tricks).toBe(12)
  })

  it('parses 4HW= → 4H by West, 10 tricks', () => {
    const r = parseResultText('4HW=')
    expect(r.contract).toBe('4H')
    expect(r.declarer).toBe('W')
    expect(r.tricks).toBe(10)
  })

  it('parses 1NW-1 → 1NT by West, 6 tricks taken', () => {
    const r = parseResultText('1NW-1')
    expect(r.contract).toBe('1NT')
    expect(r.declarer).toBe('W')
    expect(r.tricks).toBe(6)
  })

  it('parses 6SE+1 → 6S by East, 13 tricks', () => {
    const r = parseResultText('6SE+1')
    expect(r.contract).toBe('6S')
    expect(r.declarer).toBe('E')
    expect(r.tricks).toBe(13)
  })

  it('parses doubled contract 3NxS=', () => {
    const r = parseResultText('3NxS=')
    expect(r.contract).toBe('3NTX')
    expect(r.declarer).toBe('S')
    expect(r.tricks).toBe(9)
  })

  it('parses redoubled contract 2CxxN=', () => {
    const r = parseResultText('2CxxN=')
    expect(r.contract).toBe('2CXX')
    expect(r.declarer).toBe('N')
    expect(r.tricks).toBe(8)
  })

  it('returns nulls for unrecognized input', () => {
    const r = parseResultText('PASS')
    expect(r.contract).toBeNull()
    expect(r.declarer).toBeNull()
    expect(r.tricks).toBeNull()
  })

  it('returns nulls for empty string', () => {
    const r = parseResultText('')
    expect(r.contract).toBeNull()
  })
})

describe('parseTraveller — error cases', () => {
  it('throws on empty string', () => {
    expect(() => parseTraveller('')).toThrow('non-empty')
  })

  it('throws when no result rows found', () => {
    expect(() =>
      parseTraveller('<html><body><table class="body"><tr class="tourneySummary"></tr></table></body></html>')
    ).toThrow('No result rows')
  })
})
