// Pure transform from a club-game data object (the JSON blob extracted from
// my.acbl.org/club-results/details/{id}) to one Tournament tree per
// docs/normalized-schema.md. The orchestrator wraps this into the top-level
// envelope.
//
// Source schema reference (subset of fields we touch):
//
//   {
//     id, name, club_name, type, start_date, board_scoring_method,
//     acbl_board_top, bboGameLinks: { '<n>': { n,s,e,w,d,v,b,p, ... } },
//     sessions: [{
//       number,
//       hand_records: [{ board, dealer, vulnerability,
//                        north_spades..., east_..., south_..., west_...,
//                        double_dummy_ns, double_dummy_ew, par }],
//       sections: [{ name, pair_summaries: [{ pair_number, direction,
//                                             players: [{name, id_number}] }],
//                    boards: [{ board_number, board_results: [...] }] }]
//     }]
//   }

import { ParseError } from '../../../lib/parseError.js'

const HANDVIEWER_BASE = 'https://www.bridgebase.com/tools/handviewer.html'

export function parseClubGame(data) {
  if (!data || typeof data !== 'object') {
    throw new ParseError('parseClubGame expects a parsed club-game data object')
  }
  if (!Array.isArray(data.sessions) || data.sessions.length === 0) {
    throw new ParseError('club-game data has no sessions array')
  }

  const sessions = data.sessions.map((s) => buildSession(s, data))

  const event = {
    event_id: String(data.id),
    event_type: mapEventType(data.type),
    date: parseDate(data.start_date),
    scoring: mapScoring(data.board_scoring_method),
    sessions,
  }

  return {
    sanction: null,
    schedule_url: null,
    name: data.club_name ?? null,
    events: [event],
  }
}

// --- session ----------------------------------------------------------------

function buildSession(session, data) {
  const warnings = []
  const handRecordsByBoard = new Map(
    (session.hand_records ?? []).map((hr) => [hr.board, hr])
  )
  const top = parseAcblBoardTop(data.acbl_board_top)

  const pairIndex = buildPairIndex(session)
  const boards = []
  for (const section of session.sections ?? []) {
    for (const sectionBoard of section.boards ?? []) {
      // board numbers may have gaps and arrive out of order — iterate as-given
      const hr = handRecordsByBoard.get(sectionBoard.board_number) ?? null
      if (hr === null) {
        warnings.push(
          `board ${sectionBoard.board_number} (section ${section.name}): no matching hand record`
        )
      }
      boards.push(
        buildBoard(sectionBoard, section.name, hr, pairIndex, top, data, warnings)
      )
    }
  }

  return {
    session_number: session.number ?? null,
    time: null,
    user_pair: null,
    boards,
    partial: false,
    warnings,
  }
}

function buildPairIndex(session) {
  // Keyed by `${section}|${direction}|${pair_number}` → Pair object.
  // Direction is normalized to NS / EW; source uses "NS"/"EW" already in
  // pair_summaries[].direction in the fixture, but tolerate single-letter
  // variants defensively.
  const idx = new Map()
  for (const section of session.sections ?? []) {
    for (const ps of section.pair_summaries ?? []) {
      const direction = normalizeDirection(ps.direction)
      const number = parseIntOrNull(ps.pair_number)
      if (direction == null || number == null) continue
      idx.set(`${section.name}|${direction}|${number}`, {
        number,
        section: section.name,
        players: (ps.players ?? []).map(toPlayer),
      })
    }
  }
  return idx
}

function toPlayer(p) {
  // Synthetic IDs like "tmp:0a0e36e4-..." are placeholders for non-members —
  // emit acbl_id: null so downstream code doesn't try to match them across
  // events.
  const rawId = p?.id_number
  const acbl_id = typeof rawId === 'string' && !rawId.startsWith('tmp:') ? rawId : null
  return {
    name: p?.name ?? null,
    acbl_id,
    external_ids: {},
  }
}

// --- board ------------------------------------------------------------------

function buildBoard(sectionBoard, sectionName, hr, pairIndex, top, data, warnings) {
  const boardNumber = sectionBoard.board_number
  const dd = parseDoubleDummy(hr, warnings, boardNumber)
  return {
    number: boardNumber,
    section: sectionName,
    dealer: hr?.dealer ?? null,
    vulnerability: mapVulnerability(hr?.vulnerability),
    deal: hr ? buildDeal(hr) : null,
    double_dummy: dd,
    par: parsePar(hr?.par, warnings, boardNumber),
    results: (sectionBoard.board_results ?? []).map((br) =>
      buildResult(br, sectionName, pairIndex, top, data.bboGameLinks, boardNumber)
    ),
    user_result_index: null,
  }
}

function buildDeal(hr) {
  return {
    N: {
      S: parseHand(hr.north_spades),
      H: parseHand(hr.north_hearts),
      D: parseHand(hr.north_diamonds),
      C: parseHand(hr.north_clubs),
    },
    E: {
      S: parseHand(hr.east_spades),
      H: parseHand(hr.east_hearts),
      D: parseHand(hr.east_diamonds),
      C: parseHand(hr.east_clubs),
    },
    S: {
      S: parseHand(hr.south_spades),
      H: parseHand(hr.south_hearts),
      D: parseHand(hr.south_diamonds),
      C: parseHand(hr.south_clubs),
    },
    W: {
      S: parseHand(hr.west_spades),
      H: parseHand(hr.west_hearts),
      D: parseHand(hr.west_diamonds),
      C: parseHand(hr.west_clubs),
    },
  }
}

function parseHand(s) {
  if (s == null) return []
  const t = String(s).trim()
  if (t === '' || t === '-----') return []
  return t.split(/\s+/).filter((tok) => tok && tok !== '-----')
}

function mapVulnerability(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (/^none$/i.test(s)) return 'None'
  if (/^n-?s$/i.test(s)) return 'NS'
  if (/^e-?w$/i.test(s)) return 'EW'
  if (/^all$/i.test(s) || /^both$/i.test(s)) return 'Both'
  return s
}

// --- double-dummy parsing ---------------------------------------------------

function parseDoubleDummy(hr, warnings, boardNumber) {
  const empty = () => ({ C: 0, D: 0, H: 0, S: 0, NT: 0 })
  if (!hr) return { N: empty(), S: empty(), E: empty(), W: empty() }

  const ns = parseDoubleDummyLine(hr.double_dummy_ns, warnings, boardNumber, 'NS')
  const ew = parseDoubleDummyLine(hr.double_dummy_ew, warnings, boardNumber, 'EW')
  // The club-game source provides per-side data, not per-declarer. Populate
  // both seats of each side identically. Values are left in the source's
  // level form (highest-makeable-contract level, 0–7) per Rick's spec for
  // this adapter — note this differs from the tournament adapter, which
  // converts level → tricks.
  return {
    N: { ...ns },
    S: { ...ns },
    E: { ...ew },
    W: { ...ew },
  }
}

function parseDoubleDummyLine(line, warnings, boardNumber, side) {
  const out = { C: 0, D: 0, H: 0, S: 0, NT: 0 }
  if (line == null) {
    warnings.push(`board ${boardNumber} ${side} double-dummy: missing`)
    return out
  }
  // Strip leading 'NS:'/'EW:' if present.
  const text = String(line).replace(/^(?:NS|EW):\s*/i, '').trim()
  if (text === '') {
    warnings.push(`board ${boardNumber} ${side} double-dummy: empty`)
    return out
  }
  // Tokens are space-separated. Each token is one of:
  //   number+strain   '1C', '5NT'
  //   strain+number   'C1', 'NT5'
  //   range+strain    '3/4H' (use lower)
  //   strain+range    'C6/5'  (use lower)
  // Numbers can be 0..7 (level form). Missing strains stay 0.
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const numFirst = tok.match(/^(\d+)(?:\/(\d+))?(NT|[CDHS])$/i)
    const strainFirst = tok.match(/^(NT|[CDHS])(\d+)(?:\/(\d+))?$/i)
    if (numFirst) {
      out[numFirst[3].toUpperCase()] = lowerOf(numFirst[1], numFirst[2])
    } else if (strainFirst) {
      out[strainFirst[1].toUpperCase()] = lowerOf(strainFirst[2], strainFirst[3])
    } else {
      warnings.push(
        `board ${boardNumber} ${side} double-dummy: unrecognized token '${tok}'`
      )
    }
  }
  return out
}

function lowerOf(aRaw, bRaw) {
  // For ranges like '3/4H' or 'C6/5', use the lower value (conservative).
  // The schema field is a single integer; the upper value is discarded.
  const a = Number.parseInt(aRaw, 10)
  if (bRaw == null) return Number.isNaN(a) ? 0 : a
  const b = Number.parseInt(bRaw, 10)
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : b
  if (Number.isNaN(b)) return a
  return Math.min(a, b)
}

// --- par parsing ------------------------------------------------------------

function parsePar(parString, warnings, boardNumber) {
  if (parString == null || String(parString).trim() === '') return []
  // Format examples:
  //   'Par: 920 6D-NS/6C-NS'
  //   'Par: -650 4S-EW+1'
  //   'Par: 0' (passed out)
  const m = String(parString).match(/^Par:\s*(-?\d+)\s*(.*)$/i)
  if (!m) {
    warnings.push(`board ${boardNumber} par: unrecognized format '${parString}'`)
    return []
  }
  const score = Number.parseInt(m[1], 10)
  const rest = m[2].trim()
  if (rest === '') {
    if (score === 0) return [] // passed-out / no par contract
    warnings.push(`board ${boardNumber} par: score ${score} but no contract`)
    return []
  }
  // rest can be e.g. '6D-NS/6C-NS' or '4S-EW+1'. Tied pars split on '/'.
  const out = []
  for (const segment of rest.split('/').map((s) => s.trim()).filter(Boolean)) {
    const c = segment.match(/^(\d)(NT|[CDHS])(XX|X|xx|x)?-(NS|EW|[NESW])(?:[+-]\d+)?$/)
    if (!c) {
      warnings.push(`board ${boardNumber} par: unrecognized segment '${segment}'`)
      continue
    }
    const dbl = c[3] ? c[3].toUpperCase() : ''
    out.push({
      score,
      contract: `${c[1]}${c[2]}${dbl}`,
      // Schema wants a single seat. When the source gives a side ('NS'/'EW'),
      // pick a canonical seat (N for NS, E for EW) — the par contract doesn't
      // depend on which partner declares.
      declarer: c[4].length === 1 ? c[4] : c[4][0],
    })
  }
  return out
}

// --- result -----------------------------------------------------------------

function buildResult(br, sectionName, pairIndex, top, bboGameLinks, boardNumber) {
  const ns = pairIndex.get(`${sectionName}|NS|${parseIntOrNull(br.ns_pair)}`) ?? null
  const ew = pairIndex.get(`${sectionName}|EW|${parseIntOrNull(br.ew_pair)}`) ?? null

  const contract = parseContract(br.contract)

  // No contract → treat as sit-out / averaged: contract, declarer, score all
  // null. (Real passed-out boards in this source would presumably set
  // contract='Pass' or similar; we'll handle that explicitly when first seen.)
  const isUnplayed = contract == null
  const tricksRaw = parseIntOrNull(br.tricks_taken)
  const scoreRaw = parseIntOrNull(br.ns_score)

  const matchpoints = parseFloatOrNull(br.ns_match_points)
  const percentage =
    top != null && matchpoints != null
      ? Math.round((matchpoints / top) * 1000) / 10
      : null

  return {
    contract,
    declarer: !isUnplayed && contract !== 'PASS' ? br.declarer ?? null : null,
    tricks: isUnplayed ? null : tricksRaw,
    score: isUnplayed ? null : scoreRaw,
    matchpoints,
    percentage,
    imps: null,
    ns_pair: ns,
    ew_pair: ew,
    auction: null,
    play: null,
    handviewer_url: buildHandviewerUrl(bboGameLinks, boardNumber),
  }
}

function parseContract(raw) {
  if (raw == null) return null
  const cleaned = String(raw).replace(/\s+/g, '').toUpperCase()
  if (cleaned === '' || cleaned === 'PASS' || cleaned === 'PASSEDOUT') {
    return cleaned === '' ? null : 'PASS'
  }
  const m = cleaned.match(/^(\d)(NT|[CDHS])(XX|X)?$/)
  if (!m) return null
  return `${m[1]}${m[2]}${m[3] ?? ''}`
}

function buildHandviewerUrl(bboGameLinks, boardNumber) {
  if (!bboGameLinks || typeof bboGameLinks !== 'object') return null
  const link = bboGameLinks[String(boardNumber)] ?? bboGameLinks[boardNumber]
  if (!link) return null
  const params = new URLSearchParams()
  if (link.n) params.set('n', link.n)
  if (link.s) params.set('s', link.s)
  if (link.e) params.set('e', link.e)
  if (link.w) params.set('w', link.w)
  if (link.d) params.set('d', link.d)
  if (link.v) params.set('v', link.v)
  if (link.b != null) params.set('b', String(link.b))
  // Source's `a` field is the placeholder '_' (no auction). The handviewer
  // expects '-' for "no auction"; pass that explicitly.
  params.set('a', '-')
  if (link.p) params.set('p', link.p)
  return `${HANDVIEWER_BASE}?${params.toString()}`
}

// --- helpers ----------------------------------------------------------------

function mapEventType(type) {
  if (type == null) return 'unknown'
  const t = String(type).toUpperCase()
  if (t === 'PAIRS') return 'open_pairs'
  if (t === 'TEAMS') return 'swiss_teams'
  return String(type).toLowerCase()
}

function mapScoring(s) {
  if (s == null) return 'unknown'
  if (s === 'MATCH_POINTS') return 'matchpoints'
  if (s === 'IMPS') return 'imps'
  return String(s).toLowerCase()
}

function parseDate(mmddyyyy) {
  if (mmddyyyy == null) return null
  const m = String(mmddyyyy).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null
}

function normalizeDirection(d) {
  if (d == null) return null
  const v = String(d).toUpperCase()
  if (v === 'NS' || v === 'N' || v === 'S') return 'NS'
  if (v === 'EW' || v === 'E' || v === 'W') return 'EW'
  return null
}

function parseIntOrNull(v) {
  if (v == null) return null
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? null : n
}

function parseFloatOrNull(v) {
  if (v == null || v === '') return null
  const n = Number.parseFloat(v)
  return Number.isNaN(n) ? null : n
}

function parseAcblBoardTop(v) {
  const n = parseIntOrNull(v)
  return n != null && n > 0 ? n : null
}
