// The pair picker: which of an event's pairs is meant.
//
// Extracted from sourceContent.js. Behaviour unchanged.

// ── Event summary: which pair? ─────────────────────────────────────────────
//
// A summary page names nobody, and the extractor fetches one section, so a
// guess costs the user a stranger's section and none of their own boards. It
// used to be harmless — every section was fetched anyway — and it is not any
// more: a MidFlight event came back with 36 players from section C when the
// user had played in D.
//
// So ask. One flat list sorted by name, because the person looking is scanning
// for a name they know — their own, or a student's — and does not know which
// section that name is in. Grouping by section first meant searching every
// group in turn, which is the thing they came here to avoid. The section stays
// on each row, as an answer rather than as a heading to hunt through.
export const PAIR_PICKER_ID = 'bridge-classroom-pair-picker'

// Case-insensitive, so a listing that upper-cases some names does not sort them
// into a block of their own away from the rest.
export function sortPairsForPicker(pairs) {
  return [...(pairs ?? [])].sort((a, b) =>
    (a.players_text ?? '').localeCompare(b.players_text ?? '', undefined, {
      sensitivity: 'base',
    })
  )
}

export const PAIR_FILTER_CLASS = 'bridge-classroom-pair-filter'

// Lowercase, punctuation removed, whitespace collapsed — so "obrien" finds
// "O'Brien" and "smith jones" finds "Smith-Jones".
//
// Removed rather than replaced with a space: substituting turns "O'Brien" into
// "o brien", which then fails to match the very query the normalisation exists
// to support.
function normalizeForSearch(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// "A-EW4" — where the pair sat, for checking the choice against the page behind.
export function pairLocation(entry) {
  return `${entry.section ?? ''}${entry.section ? '-' : ''}${entry.direction ?? ''}${entry.pair_number ?? ''}`
}

export function buildPairPicker(doc, pairs, onSelect) {
  const box = doc.createElement('div')
  box.id = PAIR_PICKER_ID
  Object.assign(box.style, {
    position: 'absolute',
    zIndex: '2147483647',
    right: '0',
    marginTop: '4px',
    maxHeight: '60vh',
    overflowY: 'auto',
    minWidth: '260px',
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: '4px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
    fontSize: '14px',
    textAlign: 'left',
  })

  const heading = doc.createElement('div')
  heading.textContent = 'Whose results?'
  Object.assign(heading.style, {
    padding: '8px 12px',
    borderBottom: '1px solid #eee',
    fontWeight: '600',
    color: '#333',
  })
  box.appendChild(heading)

  // Sorting alone only half-solves finding someone: players_text reads
  // "John Jones & Bob Smith", so alphabetical order files a pair under its
  // *first* player. A student who is the second name is nowhere near where you
  // would look for them. Matching against the whole string fixes that, and on
  // a thirty-pair event it beats scrolling either way.
  const filter = doc.createElement('input')
  filter.type = 'search'
  filter.className = PAIR_FILTER_CLASS
  filter.placeholder = 'Type any part of a name…'
  Object.assign(filter.style, {
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
    padding: '6px 12px',
    border: 'none',
    borderBottom: '1px solid #eee',
    fontSize: '14px',
    outline: 'none',
  })
  box.appendChild(filter)

  const rows = []

  for (const entry of sortPairsForPicker(pairs)) {
    const item = doc.createElement('button')
    item.type = 'button'
    Object.assign(item.style, {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '16px',
      width: '100%',
      padding: '6px 12px',
      border: 'none',
      background: 'transparent',
      textAlign: 'left',
      cursor: 'pointer',
      fontSize: '14px',
    })

    // Name first, because that is what is being scanned. The location trails,
    // greyed, so it is there when wanted and out of the way when not.
    const name = doc.createElement('span')
    name.textContent = entry.players_text ?? ''
    item.appendChild(name)

    const where = doc.createElement('span')
    where.textContent = pairLocation(entry)
    Object.assign(where.style, { color: '#777', whiteSpace: 'nowrap' })
    item.appendChild(where)

    item.addEventListener('mouseenter', () => { item.style.background = '#eaf1fb' })
    item.addEventListener('mouseleave', () => { item.style.background = 'transparent' })
    item.addEventListener('click', () => onSelect(entry))
    box.appendChild(item)
    // Search the location too, so "D-EW7" or even "EW7" finds a pair whose name
    // you cannot spell.
    rows.push({ entry, item, haystack: normalizeForSearch(`${entry.players_text ?? ''} ${pairLocation(entry)}`) })
  }

  const empty = doc.createElement('div')
  empty.textContent = 'No one by that name in this event.'
  Object.assign(empty.style, { display: 'none', padding: '8px 12px', color: '#777' })
  box.appendChild(empty)

  const applyFilter = () => {
    const q = normalizeForSearch(filter.value)
    let visible = 0
    for (const row of rows) {
      const show = !q || row.haystack.includes(q)
      row.item.style.display = show ? 'flex' : 'none'
      if (show) visible += 1
    }
    empty.style.display = visible === 0 ? 'block' : 'none'
  }
  filter.addEventListener('input', applyFilter)

  // Enter picks the row when the filter has narrowed to exactly one — the
  // common case once a surname is typed, and it saves reaching for the mouse.
  filter.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const visible = rows.filter((r) => r.item.style.display !== 'none')
    if (visible.length === 1) {
      e.preventDefault()
      onSelect(visible[0].entry)
    }
  })

  return box
}
