import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  sortPairsForPicker,
  buildPairPicker,
  PAIR_FILTER_CLASS,
} from '../../src/ui/pairPicker.js'


describe('event-summary pair picker', () => {
  // Deliberately out of order, and across two sections, so both the grouping
  // and the sorting have to do real work.
  const PAIRS = [
    { section: 'D', direction: 'NS', pair_number: 2, players_text: 'Zoe Adams & Bob Carter', url: '/d2' },
    { section: 'A', direction: 'EW', pair_number: 4, players_text: 'Rick Wilson & Andrew Rowberg', url: '/a4' },
    { section: 'A', direction: 'NS', pair_number: 1, players_text: 'Ann Baker & Cy Dunn', url: '/a1' },
    { section: 'D', direction: 'EW', pair_number: 7, players_text: 'Al Young & Mia Zhu', url: '/d7' },
  ]

  beforeEach(() => { document.body.innerHTML = '' })

  it('sorts by name across the whole event, not section by section', () => {
    // The point of the flat list: someone hunting for a student does not know
    // which section that student is in, and should not have to scan each one.
    // A-names and D-names interleave.
    expect(sortPairsForPicker(PAIRS).map((e) => e.players_text)).toEqual([
      'Al Young & Mia Zhu',            // D
      'Ann Baker & Cy Dunn',           // A
      'Rick Wilson & Andrew Rowberg',  // A
      'Zoe Adams & Bob Carter',        // D
    ])
  })

  it('sorts case-insensitively, so upper-cased names do not clump', () => {
    const mixed = [
      { players_text: 'zoe adams', section: 'A' },
      { players_text: 'ANN BAKER', section: 'A' },
      { players_text: 'Mia Zhu', section: 'A' },
    ]
    expect(sortPairsForPicker(mixed).map((e) => e.players_text)).toEqual([
      'ANN BAKER',
      'Mia Zhu',
      'zoe adams',
    ])
  })

  it('renders one flat row per pair, name first and location trailing', () => {
    const picker = buildPairPicker(document, PAIRS, () => {})
    document.body.appendChild(picker)
    const items = [...picker.querySelectorAll('button')]
    expect(items).toHaveLength(4)
    // No section headings to scroll past.
    expect(picker.textContent).not.toContain('Section A')
    // Name leads, because that is what is being scanned.
    expect(items[0].firstChild.textContent).toBe('Al Young & Mia Zhu')
    // Location still shown, so the choice can be checked against the page.
    expect(items[0].lastChild.textContent).toBe('D-EW7')
  })

  it('hands back the chosen pair, whose url is the ordinary scorecard entry', () => {
    const chosen = []
    const picker = buildPairPicker(document, PAIRS, (p) => chosen.push(p))
    document.body.appendChild(picker)
    ;[...picker.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Rick Wilson'))
      .click()
    expect(chosen).toHaveLength(1)
    expect(chosen[0].url).toBe('/a4')
  })

  it('survives a pair with no section rather than dropping it', () => {
    const sorted = sortPairsForPicker([{ players_text: 'Nemo', pair_number: 1 }])
    expect(sorted).toHaveLength(1)
    const picker = buildPairPicker(document, sorted, () => {})
    expect(picker.querySelectorAll('button')).toHaveLength(1)
  })
})


describe('pair picker filter', () => {
  const PAIRS = [
    { section: 'A', direction: 'NS', pair_number: 1, players_text: 'John Jones & Bob Smith', url: '/a1' },
    { section: 'A', direction: 'EW', pair_number: 4, players_text: 'Rick Wilson & Andrew Rowberg', url: '/a4' },
    { section: 'D', direction: 'NS', pair_number: 2, players_text: "Mary O'Brien & Sue Chen", url: '/d2' },
  ]

  function open(onSelect = () => {}) {
    document.body.innerHTML = ''
    const picker = buildPairPicker(document, PAIRS, onSelect)
    document.body.appendChild(picker)
    return { picker, filter: picker.querySelector(`.${PAIR_FILTER_CLASS}`) }
  }

  const visible = (picker) =>
    [...picker.querySelectorAll('button')].filter((b) => b.style.display !== 'none')

  it('finds a player listed second in their pair', () => {
    // The gap sorting alone cannot close: alphabetical order files this pair
    // under "John", so a search for the student is the only way to reach them.
    const { picker, filter } = open()
    filter.value = 'smith'
    filter.dispatchEvent(new Event('input'))
    expect(visible(picker)).toHaveLength(1)
    expect(visible(picker)[0].textContent).toContain('Bob Smith')
  })

  it('ignores case and punctuation', () => {
    // Punctuation is removed, not replaced with a space: substituting turns
    // "O'Brien" into "o brien", which fails the exact query it exists to serve.
    for (const q of ['obrien', "O'BRIEN", 'OBrien']) {
      const { picker, filter } = open()
      filter.value = q
      filter.dispatchEvent(new Event('input'))
      expect(visible(picker), `query ${q}`).toHaveLength(1)
    }
  })

  it('matches the section and pair number too', () => {
    const { picker, filter } = open()
    filter.value = 'EW4'
    filter.dispatchEvent(new Event('input'))
    expect(visible(picker)).toHaveLength(1)
    expect(visible(picker)[0].textContent).toContain('Rick Wilson')
  })

  it('restores the full list when the box is cleared', () => {
    const { picker, filter } = open()
    filter.value = 'smith'
    filter.dispatchEvent(new Event('input'))
    filter.value = ''
    filter.dispatchEvent(new Event('input'))
    expect(visible(picker)).toHaveLength(3)
  })

  it('says so when nothing matches, rather than showing an empty box', () => {
    const { picker, filter } = open()
    filter.value = 'nobody'
    filter.dispatchEvent(new Event('input'))
    expect(visible(picker)).toHaveLength(0)
    expect(picker.textContent).toContain('No one by that name')
  })

  it('picks the pair on Enter once exactly one is left', () => {
    const chosen = []
    const { filter } = open((p) => chosen.push(p))
    filter.value = 'wilson'
    filter.dispatchEvent(new Event('input'))
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(chosen).toHaveLength(1)
    expect(chosen[0].url).toBe('/a4')
  })

  it('does nothing on Enter while the choice is still ambiguous', () => {
    const chosen = []
    const { filter } = open((p) => chosen.push(p))
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(chosen).toEqual([])
  })
})
