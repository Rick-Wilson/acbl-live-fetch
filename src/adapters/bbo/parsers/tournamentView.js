// Parser for BBO's tournament summary — webutil.bridgebase.com/v2/tview.php.
//
// The hands list and travellers carry results but no section identity: a
// traveller is field-wide, one row per table, with nothing saying which section
// a table belonged to. This page is the only place that mapping exists, and it
// also carries the strat ranks, ACBL masterpoint awards and real player names
// that are otherwise absent from BBO data entirely.
//
// Pure function over an HTML string, per docs/architecture.md — uses DOMParser
// so it runs identically in the service worker (on fetched HTML) and in a
// content script (on the live page the user is already looking at).
//
// Page shape:
//   <b>Section 2 N/S</b>
//   <table>
//     <tr><th>Username</th><th>Score (IMPs)</th><th class='rank'>Rank …</th>
//         <th>ACBL Points</th><th>Player Names</th></tr>
//     <tr class='odd|even|highlight'>
//       <td class='username'>kemistry+aam135</td>
//       <td><a href="…hands.php?tourney=…&username=kemistry">-0.63</a></td>
//       <td class='rank'><table><tr><td>8</td><td>5</td><td>&nbsp;</td></tr></table></td>
//       <td>Rick Wilson (CA) - Arthur Mirin (CA)</td>
//       <td class="pts">0.90</td>
//     </tr>
//
// Note the rank cell contains a *nested* table, which is why this is a DOM
// parser and not a regex — naive matching stops at the inner </table>.

import { ParseError } from '../../../lib/parseError.js'

const SECTION_RE = /^\s*Section\s+(\w+)\s+(N\/S|E\/W)\s*$/i

// "Rick Wilson (CA) - Arthur Mirin (CA)" → ['Rick Wilson', 'Arthur Mirin'].
// A missing half is written as "?" by BBO; a robot partner leaves an emoji or
// nothing at all. Either way the seat yields null rather than a junk name.
//
// Only present for an authenticated viewer — BBO omits real names entirely for
// anonymous requests, so an unauthenticated fetch yields an empty cell here
// while still carrying ranks and masterpoints.
export function splitPlayerNames(text) {
  if (!text) return [null, null]
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return [null, null]
  // Split on a hyphen that separates the two halves, tolerating a trailing one
  // when the partner is a robot ("Marcia Hengehold (FL) -").
  const halves = cleaned.split(/\s+-\s*/)
  const norm = (s) => {
    if (!s) return null
    const name = s
      .replace(/\([^)]*\)/g, ' ')                 // region markers, wherever they sit
      .replace(/[^\p{L}\p{N}.'\- ]/gu, ' ')       // emoji and other decoration
      .replace(/\s+/g, ' ')
      .replace(/^[-\s]+|[-\s]+$/g, '')
      .trim()
    if (!name || name === '?') return null
    return name
  }
  if (halves.length === 1) return [norm(halves[0]), null]
  return [norm(halves[0]), norm(halves[1])]
}

// Region suffix, kept separately — it's the only geographic hint BBO gives and
// it helps disambiguate common names when matching against ACBL data.
export function splitRegions(text) {
  if (!text) return [null, null]
  const out = [...text.matchAll(/\(([^)]{1,24})\)/g)].map((m) => m[1].trim())
  return [out[0] ?? null, out[1] ?? null]
}

function cellText(el) {
  return (el?.textContent ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

// The A/B/C strat ranks live in a nested table of three cells; blank means the
// pair wasn't eligible for that stratum.
function parseRanks(cell) {
  if (!cell) return []
  const cells = [...cell.querySelectorAll('td')]
  const strats = ['A', 'B', 'C']
  const out = []
  cells.slice(0, 3).forEach((td, i) => {
    const n = Number.parseInt(cellText(td), 10)
    if (Number.isFinite(n)) out.push({ strat: strats[i], rank: n, scope: 'Section' })
  })
  return out
}

export function parseTournamentView(html) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new ParseError('parseTournamentView requires a non-empty HTML string')
  }
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // The header is a label/value table: <td>Title</td><td>#30567 …</td>.
  const labelled = (label) => {
    for (const td of doc.querySelectorAll('td')) {
      if (new RegExp(`^${label}$`, 'i').test(cellText(td))) {
        return cellText(td.nextElementSibling) || null
      }
    }
    return null
  }

  // Table count is stated outright here; prefer it over anything derived, since
  // it's authoritative for the event as run.
  const tablesRaw = labelled('Tables')
  const tableCount = Number.isFinite(Number.parseInt(tablesRaw, 10))
    ? Number.parseInt(tablesRaw, 10)
    : null

  // The hands list only sometimes carries the tournament name — it was null on
  // 238 of 264 events in a real capture. This page states it every time.
  const name = labelled('Title')

  // Each section is a `div.sectionbreak` heading followed by a sibling
  // `table.sectiontable`. Walk both in document order and pair them up, rather
  // than assuming a fixed nesting that BBO could change independently.
  const sections = []
  let current = null
  for (const el of doc.querySelectorAll('div.sectionbreak, table.sectiontable')) {
    if (el.classList.contains('sectionbreak')) {
      const m = SECTION_RE.exec(cellText(el))
      if (m) current = { section: m[1], direction: m[2] === 'N/S' ? 'NS' : 'EW' }
      continue
    }
    if (!current) continue

    const rows = [...el.querySelectorAll('tr')].filter((tr) => tr.querySelector('td.username'))
    if (rows.length === 0) continue

    const pairs = []
    for (const tr of rows) {
      const usernames = cellText(tr.querySelector('td.username'))
        .split('+')
        .map((u) => u.trim())
        .filter(Boolean)
      if (usernames.length === 0) continue

      const cells = [...tr.children]
      const rankCell = tr.querySelector("td.rank, td[class='rank']")
      const ptsCell = tr.querySelector('td.pts')
      // Player names sit between the rank cell and the points cell. Identify it
      // positionally rather than by class, since it carries none.
      const rankIdx = cells.indexOf(rankCell)
      const nameCell = rankIdx >= 0 ? cells[rankIdx + 1] : null

      const score = Number.parseFloat(cellText(tr.querySelector('a')))
      const mp = Number.parseFloat(cellText(ptsCell))
      const nameText = cellText(nameCell)

      pairs.push({
        usernames,
        score: Number.isFinite(score) ? score : null,
        strat_ranks: parseRanks(rankCell),
        masterpoints: Number.isFinite(mp) ? mp : null,
        names: splitPlayerNames(nameText),
        regions: splitRegions(nameText),
        is_user: tr.className?.includes('highlight') ?? false,
      })
    }
    if (pairs.length) sections.push({ ...current, pairs })
    current = null // one table per heading
  }

  if (sections.length === 0) {
    throw new ParseError(
      'parseTournamentView found no "Section N N/S" blocks — tview.php layout may have changed'
    )
  }

  return { name, table_count: tableCount, sections }
}

// Flatten to a lookup keyed by BBO username. Usernames are case-insensitive to
// log in but stored as typed, so fold case or the same person splits in two.
export function indexByUsername(parsed) {
  const index = new Map()
  for (const { section, direction, pairs } of parsed.sections ?? []) {
    for (const pair of pairs) {
      pair.usernames.forEach((username, seat) => {
        index.set(username.toLowerCase(), {
          section,
          direction,
          strat_ranks: pair.strat_ranks,
          // BBO awards masterpoints per pair; ACBL records them per player, and
          // both partners receive the same amount.
          masterpoints: pair.masterpoints,
          name: pair.names[seat] ?? null,
          region: pair.regions[seat] ?? null,
          partner: pair.usernames[1 - seat] ?? null,
        })
      })
    }
  }
  return index
}
