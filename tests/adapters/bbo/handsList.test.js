import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseHandsList } from '../../../src/adapters/bbo/parsers/handsList.js'

const fixtureDir = join(import.meta.dirname, '../../../fixtures/bbo')
const html = readFileSync(join(fixtureDir, 'hands-list-81382-kemistry.html'), 'utf8')

describe('parseHandsList — fixture 81382 kemistry', () => {
  let result
  beforeEach(() => {
    result = parseHandsList(html)
  })

  it('extracts the tournament ID', () => {
    expect(result.tourneyId).toBe('81382-1777478400')
  })

  it('extracts the tournament name', () => {
    expect(result.tourneyName).toBe('#81382 ACBL Wed Noon ET Speedball (GIB)')
  })

  it('extracts the tview URL', () => {
    expect(result.tviewUrl).toContain('tview.php')
    expect(result.tviewUrl).toContain('t=81382-1777478400')
  })

  it('extracts the username', () => {
    expect(result.username).toBe('kemistry')
  })

  it('detects direction EW', () => {
    expect(result.direction).toBe('EW')
  })

  it('detects partner', () => {
    expect(result.partner).toBe('aam135')
  })

  it('detects IMP scoring', () => {
    expect(result.scoring).toBe('imps')
  })

  it('extracts session score', () => {
    expect(result.sessionScore).toBeCloseTo(4.98)
  })

  it('finds 12 boards', () => {
    expect(result.boards).toHaveLength(12)
  })

  describe('board 1', () => {
    let b
    beforeEach(() => { b = result.boards[0] })

    it('has board number 1', () => {
      expect(b.number).toBe(1)
    })

    it('has time', () => {
      expect(b.time).toBe('09:04')
    })

    it('has correct players', () => {
      expect(b.players).toEqual({ N: 'kaodul', S: 'norreb', E: 'kemistry', W: 'aam135' })
    })

    it('has normalized result text', () => {
      expect(b.resultText).toBe('3NW+2')
    })

    it('has EW points (positive = EW gained)', () => {
      expect(b.ewPoints).toBe(460)
    })

    it('has comparison score', () => {
      expect(b.comparisonScore).toBeCloseTo(3.0)
    })

    it('has traveller URL pointing to board 1 traveller', () => {
      expect(b.travellerUrl).toContain('traveller=81382-1777478400-32138245')
      expect(b.travellerUrl).toContain('username=kemistry')
    })

    it('has parsed LIN data', () => {
      expect(b.linData).not.toBeNull()
      expect(b.linData.dealer).toBe('N')
      expect(b.linData.vulnerability).toBe('None')
    })

    it('LIN deal has 52 cards total', () => {
      const d = b.linData.deal
      const total = ['N', 'E', 'S', 'W'].reduce(
        (sum, seat) => sum + d[seat].S.length + d[seat].H.length + d[seat].D.length + d[seat].C.length,
        0
      )
      expect(total).toBe(52)
    })
  })

  describe('board 3 (4H suit symbol)', () => {
    it('normalizes heart symbol to H', () => {
      const b = result.boards[2]
      expect(b.resultText).toBe('4HW=')
    })
  })

  describe('board 4 (negative score — negscore class)', () => {
    it('parses negative EW points', () => {
      const b = result.boards[3]
      expect(b.ewPoints).toBe(-710)
    })

    it('parses positive comparison score despite negative bridge score', () => {
      const b = result.boards[3]
      expect(b.comparisonScore).toBeCloseTo(3.08)
    })
  })

  describe('board 5 (negative comparison score)', () => {
    it('parses negative comparison score', () => {
      const b = result.boards[4]
      expect(b.comparisonScore).toBeCloseTo(-4.28)
    })
  })

  it('last board traveller URL is correct', () => {
    const last = result.boards[11]
    expect(last.travellerUrl).toContain('traveller=81382-1777478400-32138256')
  })
})

describe('parseHandsList — error cases', () => {
  it('throws on empty string', () => {
    expect(() => parseHandsList('')).toThrow('non-empty')
  })

  it('throws when tourneySummary row is absent', () => {
    expect(() => parseHandsList('<html><body><table class="body"></table></body></html>')).toThrow(
      'tourneySummary'
    )
  })
})
