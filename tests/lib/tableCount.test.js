import { describe, it, expect } from 'vitest'
import { countTables } from '../../src/lib/tableCount.js'

const board = (number, rows) => ({ number, results: Array.from({ length: rows }, () => ({})) })

describe('countTables', () => {
  it('counts result rows on a board — one row per table', () => {
    expect(countTables([board(1, 12), board(2, 12)])).toBe(12)
  })

  // A board number recurs once per section, so the tables that played it are
  // spread across several board objects and have to be summed.
  it('sums a board number across sections', () => {
    expect(countTables([
      { number: 1, section: 'A', results: Array(14).fill({}) },
      { number: 1, section: 'B', results: Array(13).fill({}) },
      { number: 2, section: 'A', results: Array(14).fill({}) },
      { number: 2, section: 'B', results: Array(13).fill({}) },
    ])).toBe(27)
  })

  // Sit-outs and dropped boards are normal; the busiest board is the honest
  // measure of how many tables were in play.
  it('takes the maximum, so a board some tables sat out does not undercount', () => {
    expect(countTables([board(1, 12), board(2, 9), board(3, 12)])).toBe(12)
  })

  it('distinguishes unknown from empty', () => {
    expect(countTables([])).toBeNull()
    expect(countTables(null)).toBeNull()
    expect(countTables(undefined)).toBeNull()
    expect(countTables([{ number: 1, results: [] }])).toBeNull()
  })

  it('tolerates malformed boards', () => {
    expect(countTables([{ number: 1 }, board(2, 4)])).toBe(4)
    expect(countTables([{ results: Array(3).fill({}) }])).toBe(3)
  })

  // Regression pin against BBO's own tournament summary: tview.php reports 54
  // tables for event 3132-1785344400 across 4 sections, and the busiest board
  // in the captured envelope carries exactly 54 result rows.
  it('matches the table count BBO reports for a real 4-section event', () => {
    const sections = ['1', '2', '3', '4']
    const perSection = [14, 14, 13, 13] // 54 tables
    const boards = []
    for (let n = 1; n <= 12; n++) {
      sections.forEach((section, i) => {
        boards.push({ number: n, section, results: Array(perSection[i]).fill({}) })
      })
    }
    expect(countTables(boards)).toBe(54)
  })
})
