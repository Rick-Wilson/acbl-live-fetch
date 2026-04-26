import { ParseError } from '../../../lib/parseError.js'

const SUIT_CLASS_TO_LETTER = {
  spades: 'S',
  hearts: 'H',
  diams: 'D',
  clubs: 'C',
}

export function parseBoardDetail(htmlString, { boardNumber, section } = {}) {
  if (typeof htmlString !== 'string' || htmlString.length === 0) {
    throw new ParseError('parseBoardDetail expects a non-empty HTML string')
  }

  const doc = new DOMParser().parseFromString(htmlString, 'text/html')

  const { dealer, vulnerability } = parseBoardData(doc)
  const deal = parseHands(doc)
  const { doubleDummy, par } = parseDoubleDummyAndPar(doc)
  const results = parseResults(doc, section ?? null)

  return {
    number: boardNumber ?? null,
    section: section ?? null,
    dealer,
    vulnerability,
    deal,
    double_dummy: doubleDummy,
    par,
    results,
    user_result_index: null,
  }
}

function parseBoardData(doc) {
  const boardData = doc.querySelector('div.board-data')
  if (!boardData) {
    throw new ParseError('Could not find div.board-data — has live.acbl.org changed?', {
      selector: 'div.board-data',
    })
  }
  const text = collapse(boardData.textContent)

  const dealerMatch = text.match(/Dlr:\s*([NESW])/i)
  if (!dealerMatch) {
    throw new ParseError('Could not extract dealer from div.board-data', {
      selector: 'div.board-data',
      html: boardData.outerHTML,
    })
  }

  const vulMatch = text.match(/Vul:\s*(None|N-S|E-W|Both)/i)
  if (!vulMatch) {
    throw new ParseError('Could not extract vulnerability from div.board-data', {
      selector: 'div.board-data',
      html: boardData.outerHTML,
    })
  }

  return {
    dealer: dealerMatch[1].toUpperCase(),
    vulnerability: normalizeVulnerability(vulMatch[1]),
  }
}

function normalizeVulnerability(raw) {
  const v = raw.trim()
  if (/^none$/i.test(v)) return 'None'
  if (/^n-?s$/i.test(v)) return 'NS'
  if (/^e-?w$/i.test(v)) return 'EW'
  if (/^both$/i.test(v)) return 'Both'
  return v
}

function parseHands(doc) {
  const allHands = [...doc.querySelectorAll('div.hand')]
  const nonMiddle = allHands.filter((h) => !h.classList.contains('middle'))
  if (nonMiddle.length < 2) {
    throw new ParseError(
      `Expected at least 2 non-middle div.hand elements, found ${nonMiddle.length}`,
      { selector: 'div.hand' }
    )
  }
  const northEl = nonMiddle[0]
  const southEl = nonMiddle[nonMiddle.length - 1]

  const middle = doc.querySelector('div.hand.middle')
  if (!middle) {
    throw new ParseError('Could not find div.hand.middle for E-W hands', {
      selector: 'div.hand.middle',
    })
  }
  const westEl = middle.querySelector('div.inner-slice.left')
  const eastEl = middle.querySelector('div.inner-slice.right')
  if (!westEl || !eastEl) {
    throw new ParseError('Could not find inner-slice.left/right for W/E hands', {
      selector: 'div.hand.middle div.inner-slice',
    })
  }

  return {
    N: parseHandFromElement(northEl, 'N'),
    E: parseHandFromElement(eastEl, 'E'),
    S: parseHandFromElement(southEl, 'S'),
    W: parseHandFromElement(westEl, 'W'),
  }
}

function parseHandFromElement(el, who) {
  const hand = { S: [], H: [], D: [], C: [] }
  const spans = [...el.querySelectorAll(':scope > span')]
  if (spans.length === 0) {
    throw new ParseError(`Hand ${who}: no <span> children found`, {
      selector: `div.hand (${who})`,
      html: el.outerHTML,
    })
  }
  for (const span of spans) {
    const symbolEl = span.querySelector('span.symbol')
    if (!symbolEl) continue
    const suitClass = [...symbolEl.classList].find((c) => SUIT_CLASS_TO_LETTER[c])
    if (!suitClass) continue
    const suit = SUIT_CLASS_TO_LETTER[suitClass]
    hand[suit] = parseRanks(span.textContent)
  }
  return hand
}

function parseRanks(text) {
  const trimmed = collapse(text)
  if (!trimmed) return []
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  return tokens.filter((t) => t !== '—' && t !== '-')
}

function parseDoubleDummyAndPar(doc) {
  const ddEl = doc.querySelector('div.double-dummy')
  if (!ddEl) {
    throw new ParseError('Could not find div.double-dummy', { selector: 'div.double-dummy' })
  }

  let nsLine = ''
  let ewLine = ''
  for (const span of ddEl.querySelectorAll('span')) {
    const decorated = collapse(decorateSuitSymbols(span))
    if (/^NS:/i.test(decorated)) nsLine = decorated
    else if (/^EW:/i.test(decorated)) ewLine = decorated
  }

  if (!nsLine || !ewLine) {
    throw new ParseError('Could not extract NS/EW double-dummy lines', {
      selector: 'div.double-dummy span',
      html: ddEl.outerHTML,
    })
  }

  const doubleDummy = {
    NS: parseDoubleDummyLine(nsLine.replace(/^NS:\s*/i, '')),
    EW: parseDoubleDummyLine(ewLine.replace(/^EW:\s*/i, '')),
  }

  const parEl = doc.querySelector('div.par-score')
  if (!parEl) {
    throw new ParseError('Could not find div.par-score', { selector: 'div.par-score' })
  }
  const parSpan = parEl.querySelector('span')
  if (!parSpan) {
    throw new ParseError('Could not find par <span> inside div.par-score', {
      selector: 'div.par-score span',
      html: parEl.outerHTML,
    })
  }
  const par = parsePar(collapse(decorateSuitSymbols(parSpan)))

  return { doubleDummy, par }
}

function decorateSuitSymbols(el) {
  const clone = el.cloneNode(true)
  for (const sym of [...clone.querySelectorAll('span.symbol')]) {
    const cls = [...sym.classList].find((c) => SUIT_CLASS_TO_LETTER[c])
    if (cls) {
      sym.replaceWith(clone.ownerDocument.createTextNode(SUIT_CLASS_TO_LETTER[cls]))
    }
  }
  return clone.textContent
}

function parseDoubleDummyLine(line) {
  // ACBL Live shows double-dummy makes per side in two source orientations:
  //   NS: '4/5C 1D 3H 5S 5NT'  — number-then-strain; '4/5' = N makes 4, S makes 5
  //   EW: 'C2 D6 H3 S2 NT2'    — strain-then-number (rendered "reversed" on the page)
  // Detect orientation by whether a strain letter is immediately followed by a
  // digit anywhere in the line; otherwise treat as number-then-strain.
  // The schema collapses N/S splits to one number per strain — we keep the first
  // value (N's count) to match the example in docs/normalized-schema.md.
  const collapsed = collapse(line)
  const out = { C: null, D: null, H: null, S: null, NT: null }
  const strainFirst = /(?:NT|[CDHS])\d/.test(collapsed)

  if (strainFirst) {
    for (const m of collapsed.matchAll(/(NT|[CDHS])(\d+(?:\s*\/\s*\d+)?)/g)) {
      out[m[1]] = pickTricks(m[2])
    }
  } else {
    for (const m of collapsed.matchAll(/(\d+(?:\s*\/\s*\d+)?)\s*(NT|[CDHS])/g)) {
      out[m[2]] = pickTricks(m[1])
    }
  }

  if (Object.values(out).every((v) => v == null)) {
    throw new ParseError(`Could not parse double-dummy line: '${line}'`, { html: line })
  }
  return out
}

function pickTricks(raw) {
  // For the '4/5' slash form (N's count / S's count), use the first number to
  // match the schema example in docs/normalized-schema.md.
  const first = raw.split('/')[0].trim()
  return Number.parseInt(first, 10)
}

function parsePar(text) {
  // Examples: '+460 5NT-NS', '-100 4SX-EW', '+50 3NT-N'
  const m = collapse(text).match(/([+-]?\d+)\s+(\d+(?:NT|[CDHS])(?:XX|X)?)\s*-?\s*(NS|EW|[NESW])?/)
  if (!m) {
    if (/pass/i.test(text)) return { score: 0, contract: 'PASS', declarer: null }
    throw new ParseError(`Could not parse par from: '${text}'`, { html: text })
  }
  return {
    score: Number.parseInt(m[1], 10),
    contract: m[2],
    declarer: m[3] ?? null,
  }
}

function parseResults(doc, section) {
  const tables = doc.querySelectorAll('table.tablesorter')
  if (tables.length === 0) {
    throw new ParseError('Could not find table.tablesorter — has live.acbl.org changed?', {
      selector: 'table.tablesorter',
    })
  }
  const rows = [...tables[0].querySelectorAll('tbody > tr')]
  return rows.map((row, idx) => parseResultRow(row, idx, section))
}

function parseResultRow(row, idx, section) {
  const cells = [...row.children].filter((c) => c.tagName === 'TD')
  if (cells.length < 7) {
    throw new ParseError(`Result row ${idx}: expected 7 <td> cells, got ${cells.length}`, {
      selector: 'tr td',
      html: row.outerHTML,
    })
  }
  const playLink = cells[0].querySelector('a.btn-play')
  const handviewerUrl = playLink?.getAttribute('href') ?? null

  const contract = parseContractCell(cells[1])
  const declarerText = collapse(cells[2].textContent).toUpperCase()
  const declarer = declarerText || null
  const score = parseSignedInt(collapse(cells[3].textContent))
  const matchpoints = parseOptionalNumber(cells[4].textContent)
  const percentage = parseOptionalNumber(cells[5].textContent)
  const { ns_pair, ew_pair } = parsePairsCell(cells[6], section)

  return {
    contract,
    declarer,
    tricks: null,
    score,
    matchpoints,
    percentage,
    imps: null,
    ns_pair,
    ew_pair,
    auction: null,
    play: null,
    handviewer_url: handviewerUrl,
  }
}

function parseContractCell(cell) {
  const text = collapse(decorateSuitSymbols(cell))
  // Empty contract cell = "no result" row (sit-out, averaged score, board not
  // played by this pair). Confirmed in event 2604321 board 6. The row still
  // exists with a pair label and possibly matchpoints, but with no contract,
  // declarer, or score. Return null so downstream callers know to skip it
  // rather than throwing and losing the rest of the table.
  if (!text) return null
  if (/^pass/i.test(text)) return 'PASS'
  // ACBL Live renders doubles as lowercase 'x'/'xx' on both board-detail and
  // scorecard pages (the format doc previously claimed board-detail used
  // uppercase — that was wrong, confirmed against board-3 of event 2604321).
  // Match either case and normalize the output to uppercase X/XX.
  const m = text.match(/^(\d)\s*(NT|[CDHS])\s*(XX|X|xx|x)?$/)
  if (!m) {
    throw new ParseError(`Could not parse contract from cell: '${text}'`, { html: cell.outerHTML })
  }
  const dbl = m[3] ? m[3].toUpperCase() : ''
  return `${m[1]}${m[2]}${dbl}`
}

function parseSignedInt(text) {
  const t = text.trim()
  if (!t) return null // empty score cell (sit-out / averaged result)
  const n = Number.parseInt(t, 10)
  if (Number.isNaN(n)) {
    throw new ParseError(`Expected integer score, got '${text}'`)
  }
  return n
}

function parseOptionalNumber(text) {
  const t = collapse(text)
  if (!t) return null
  const n = Number.parseFloat(t)
  return Number.isNaN(n) ? null : n
}

function parsePairsCell(cell, section) {
  const nameEls = [...cell.querySelectorAll('span.name')]
  if (nameEls.length !== 4) {
    throw new ParseError(`Pairs cell: expected 4 span.name, got ${nameEls.length}`, {
      selector: 'span.name',
      html: cell.outerHTML,
    })
  }
  const fullText = collapse(cell.textContent)
  const halves = fullText.split(/\s*vs\.\s*/i)
  if (halves.length !== 2) {
    throw new ParseError(`Pairs cell: expected 'vs.' separator in '${fullText}'`, {
      selector: 'span.name',
      html: cell.outerHTML,
    })
  }

  return {
    ns_pair: {
      number: pickPairNumber(halves[0]),
      section,
      players: [parsePlayerSpan(nameEls[0]), parsePlayerSpan(nameEls[1])],
    },
    ew_pair: {
      number: pickPairNumber(halves[1]),
      section,
      players: [parsePlayerSpan(nameEls[2]), parsePlayerSpan(nameEls[3])],
    },
  }
}

function pickPairNumber(text) {
  const m = text.match(/^\s*(\d+)\s*-/)
  return m ? Number.parseInt(m[1], 10) : null
}

function parsePlayerSpan(span) {
  const name = collapse(span.textContent)
  const rawId = span.getAttribute('data-acbl')
  const acbl_id = rawId && rawId.trim() !== '' ? String(rawId).trim() : null
  return { name, acbl_id, external_ids: {} }
}

function collapse(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}
