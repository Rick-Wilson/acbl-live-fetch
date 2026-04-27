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

  let nsSpan = null
  let ewSpan = null
  for (const span of ddEl.querySelectorAll('span')) {
    const decorated = collapse(decorateSuitSymbols(span))
    if (/^NS:/i.test(decorated)) nsSpan = span
    else if (/^EW:/i.test(decorated)) ewSpan = span
  }

  if (!nsSpan || !ewSpan) {
    throw new ParseError('Could not extract NS/EW double-dummy lines', {
      selector: 'div.double-dummy span',
      html: ddEl.outerHTML,
    })
  }

  // Per docs/normalized-schema.md, double_dummy values are RAW TRICKS (0–13).
  // ACBL renders each strain in one of two visual forms, and the form
  // determines whether the digit is a contract level or a raw trick count:
  //   • Unwrapped (white background): contract level 1–7 → tricks = level + 6
  //   • Wrapped in <div class="reverse"> (blue background): raw tricks 0–6
  // A given line can mix both forms — e.g. EW makes 3♦ as a contract but
  // only 5♥ as a raw trick count. We walk the DOM rather than working from
  // collapsed text so the wrapper context isn't lost.
  const nsTuples = parseDoubleDummyLine(nsSpan)
  const ewTuples = parseDoubleDummyLine(ewSpan)
  const doubleDummy = {
    N: pickSeat(nsTuples, 0),
    S: pickSeat(nsTuples, 1),
    E: pickSeat(ewTuples, 0),
    W: pickSeat(ewTuples, 1),
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

function parseDoubleDummyLine(span) {
  // Walks the children of an NS/EW <span>, distinguishing by structure
  // whether each entry encodes a contract level or a raw trick count:
  //   • Plain text + suit-symbol children: contract-level form (e.g.
  //     "4/5♣", "1♦", "5NT"). Digit is the highest makeable level (1–7);
  //     tricks = level + 6. A digit of 0 means the bucket "<7 tricks" with
  //     no specific value, so we emit null.
  //   • <div class="reverse"> wrapper: raw-trick form (e.g. "♣6", "♥5",
  //     "♣4/5"). Digit is the actual trick count (0–6 typically, since
  //     7+ tricks gets expressed as a real contract level).
  //
  // Output is a per-strain pair [firstSeat, secondSeat]. A single value
  // means both seats of that side take the same number of tricks.
  const out = { C: null, D: null, H: null, S: null, NT: null }
  const levelTextChunks = []

  for (const child of span.childNodes) {
    const isElement = child.nodeType === 1
    if (isElement && child.classList && child.classList.contains('reverse')) {
      // Raw-tricks form: parse the inner content directly. Inner shape is
      // <strain><digit> or <strain><digit>/<digit>.
      const inner = collapse(decorateSuitSymbols(child))
      const m = inner.match(/(NT|[CDHS])\s*(\d+)(?:\s*\/\s*(\d+))?/)
      if (m) {
        const strain = m[1]
        out[strain] = pairFromTricks(m[2], m[3])
      }
    } else if (isElement) {
      // A non-reverse element. Special-case suit-symbol spans (they have
      // no text content, just a class) — decorateSuitSymbols only finds
      // suit symbols inside its argument, never the argument itself.
      if (child.classList && child.classList.contains('symbol')) {
        const cls = [...child.classList].find((c) => SUIT_CLASS_TO_LETTER[c])
        if (cls) levelTextChunks.push(SUIT_CLASS_TO_LETTER[cls])
      } else {
        levelTextChunks.push(decorateSuitSymbols(child))
      }
    } else if (child.nodeType === 3) {
      levelTextChunks.push(child.textContent)
    }
  }

  // Parse the assembled level-form text. Format is digit(/digit)? then
  // strain letter. Skip any strain that was already filled by a reverse
  // wrapper (sanity guard against duplicates).
  const collapsed = collapse(levelTextChunks.join(''))
    .replace(/^NS:\s*/i, '')
    .replace(/^EW:\s*/i, '')
  for (const m of collapsed.matchAll(/(\d+)(?:\s*\/\s*(\d+))?\s*(NT|[CDHS])/g)) {
    if (out[m[3]] != null) continue
    out[m[3]] = pairFromLevels(m[1], m[2])
  }

  if (Object.values(out).every((v) => v == null)) {
    throw new ParseError(`Could not parse double-dummy line`, { html: span.outerHTML })
  }
  return out
}

function pairFromLevels(firstRaw, secondRaw) {
  const first = levelToTricks(Number.parseInt(firstRaw, 10))
  const second = secondRaw == null ? first : levelToTricks(Number.parseInt(secondRaw, 10))
  return [first, second]
}

function pairFromTricks(firstRaw, secondRaw) {
  const first = clampTricks(Number.parseInt(firstRaw, 10))
  const second = secondRaw == null ? first : clampTricks(Number.parseInt(secondRaw, 10))
  return [first, second]
}

function clampTricks(n) {
  if (!Number.isInteger(n)) return null
  if (n < 0 || n > 13) return null
  return n
}

function levelToTricks(level) {
  // Contract-level form: 1–7 → tricks 7–13 via level + 6.
  // 0 means ACBL's "<7 tricks" bucket without a specific count, so null —
  // the reverse-wrapper form would have been used to convey an exact 0–6.
  if (!Number.isInteger(level)) return null
  if (level === 0) return null
  if (level >= 1 && level <= 7) return level + 6
  return null
}

function pickSeat(tuples, idx) {
  const out = { C: null, D: null, H: null, S: null, NT: null }
  for (const strain of Object.keys(out)) {
    const pair = tuples[strain]
    out[strain] = pair ? (pair[idx] ?? null) : null
  }
  return out
}

// Parse the ACBL par-score text into the schema's `par` array.
//
// Returns:
//   - []                                  for passed-out / no-par boards
//   - [{score, contract, declarer}]       for the normal one-contract case
//
// The schema's `par.declarer` is a required single seat (N/E/S/W), so we
// canonicalize 'NS'/'EW' down to the first letter. We never emit a Par
// object with `declarer: null` — if there's no real declarer (PASS), we
// emit an empty array instead, since "no par contract" and "par contract
// with no declarer" mean different things to the analyzer.
function parsePar(text) {
  // Examples: '+460 5NT-NS', '-100 4SX-EW', '+50 3NT-N'
  const m = collapse(text).match(/([+-]?\d+)\s+(\d+(?:NT|[CDHS])(?:XX|X)?)\s*-?\s*(NS|EW|[NESW])?/)
  if (!m) {
    // PASS / passed-out: no optimal contract → empty par array.
    if (/pass/i.test(text)) return []
    throw new ParseError(`Could not parse par from: '${text}'`, { html: text })
  }
  const rawDeclarer = m[3] ?? null
  if (rawDeclarer == null) {
    // No declarer — treat the same as PASS, since the schema requires one.
    return []
  }
  return [
    {
      score: Number.parseInt(m[1], 10),
      contract: m[2],
      declarer: rawDeclarer[0],
    },
  ]
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

  let contract = parseContractCell(cells[1])
  const declarerText = collapse(cells[2].textContent).toUpperCase()
  let declarer = declarerText || null
  const scoreText = collapse(cells[3].textContent)
  let score
  // Passed-out boards: ACBL Live has been seen rendering 'PASS' in the score
  // cell (rather than in the contract cell, where you'd expect it). Treat
  // 'PASS' anywhere in the contract/score columns as a passed-out row, with
  // contract="PASS", declarer=null, score=0 (the bridge convention for
  // passed-out boards: nobody gains, nobody loses).
  if (/^pass$/i.test(scoreText)) {
    score = 0
    if (contract === null) contract = 'PASS'
    declarer = null
  } else {
    score = parseSignedInt(scoreText)
  }
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
