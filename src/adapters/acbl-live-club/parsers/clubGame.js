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
import { parseDoubleDummyLine } from '../../../lib/doubleDummy.js'

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

function reverseEwPlayers(pair) {
  if (!pair || !Array.isArray(pair.players) || pair.players.length !== 2) return pair
  return { ...pair, players: [pair.players[1], pair.players[0]] }
}

function synthesizePair(number, sectionName) {
  // Used when the pair index doesn't carry an entry for a pair_number that
  // appears on a result row. Players aren't recoverable in this case, but
  // the analyzer needs at minimum a Pair-shaped object with the number.
  if (number == null) {
    return { number: null, section: sectionName, players: [] }
  }
  return { number, section: sectionName, players: [] }
}

function buildPairIndex(session) {
  // Keyed by `${section}|${direction}|${pair_number}` → Pair object.
  //
  // Movement handling:
  //   * Mitchell-ish movements: pair_summaries[].direction is "NS" or "EW",
  //     and (NS pair 5) is a different pair from (EW pair 5). Index each
  //     under its own direction.
  //   * Howell-ish movements: pair_summaries[].direction is null. The same
  //     pair plays both directions across rounds. Index it under both NS
  //     and EW keys so direction-specific lookups still resolve.
  const idx = new Map()
  for (const section of session.sections ?? []) {
    for (const ps of section.pair_summaries ?? []) {
      const direction = normalizeDirection(ps.direction)
      const number = parseIntOrNull(ps.pair_number)
      if (number == null) continue
      const pair = {
        number,
        section: section.name,
        players: (ps.players ?? []).map(toPlayer),
      }
      if (direction) {
        idx.set(`${section.name}|${direction}|${number}`, pair)
      } else {
        idx.set(`${section.name}|NS|${number}`, pair)
        idx.set(`${section.name}|EW|${number}`, pair)
      }
    }
  }
  return idx
}

function toPlayer(p) {
  // Source emits placeholder IDs for non-members under at least two forms:
  //   * 'tmp:<uuid>'  — synthetic UUID for entry without an ACBL number.
  //   * '#<digits>'   — local-club placeholder, often paired with
  //                     is_valid_member: 0 in the source.
  // Real ACBL numbers are pure digits. Emit acbl_id: null for any placeholder
  // so downstream code doesn't try to match these across events.
  const rawId = p?.id_number
  const looksLikeAcblId =
    typeof rawId === 'string' &&
    rawId !== '' &&
    !rawId.startsWith('tmp:') &&
    !rawId.startsWith('#')
  return {
    name: normalizePlayerName(p?.name),
    acbl_id: looksLikeAcblId ? rawId : null,
    external_ids: {},
  }
}

function normalizePlayerName(name) {
  // The club source emits names as "Lastname, Firstname" (e.g. "Vondera,
  // Wayne"). The tournament adapter and the analyzer's downstream UI both
  // expect "Firstname Lastname". Normalize here so all sources agree.
  // Names without a comma (already first-last, e.g. "Bruno Jahn") pass
  // through unchanged.
  if (typeof name !== 'string') return name ?? null
  const parts = name.split(',')
  if (parts.length !== 2) return name
  const last = parts[0].trim()
  const first = parts[1].trim()
  if (!last || !first) return name
  return `${first} ${last}`
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
  const empty = () => ({ C: null, D: null, H: null, S: null, NT: null })
  if (!hr) return { N: empty(), S: empty(), E: empty(), W: empty() }

  const ns = parseLine(hr.double_dummy_ns, warnings, boardNumber, 'NS')
  const ew = parseLine(hr.double_dummy_ew, warnings, boardNumber, 'EW')
  // Slash form ("3/4H" or "C5/6") gives per-seat values: first listed → N,
  // second listed → S (and W, E for the EW line — matches the analyzer's
  // seat-display ordering elsewhere). Single-value tokens populate both
  // seats with the same number via parseDoubleDummyLine.
  return {
    N: { ...ns.first },
    S: { ...ns.second },
    W: { ...ew.first },
    E: { ...ew.second },
  }
}

/** Thin wrapper that scopes the shared parser's warnings to a board+side
 *  for the existing per-board warning surface. */
function parseLine(line, warnings, boardNumber, side) {
  if (line == null) {
    warnings.push(`board ${boardNumber} ${side} double-dummy: missing`)
    return { first: {}, second: {} }
  }
  const result = parseDoubleDummyLine(line)
  for (const w of result.warnings) {
    warnings.push(`board ${boardNumber} ${side} double-dummy: ${w}`)
  }
  return result
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
  const nsNum = parseIntOrNull(br.ns_pair)
  const ewNum = parseIntOrNull(br.ew_pair)
  // Schema requires Pair objects (not null) on every result. If the pair
  // isn't in the index — e.g., a sit-out / phantom pair, or pair_summaries
  // is missing entries — synthesize a minimal Pair with empty players.
  const ns = pairIndex.get(`${sectionName}|NS|${nsNum}`) ?? synthesizePair(nsNum, sectionName)
  const ewRaw = pairIndex.get(`${sectionName}|EW|${ewNum}`) ?? synthesizePair(ewNum, sectionName)
  // my.acbl.org's pair_summaries[].players is in [N, S] order for NS pairs
  // (matches PBN [North]/[South] tags) but in [W, E] order for EW pairs.
  // The analyzer's seat convention (and PBN's [East]/[West] tags) is [E, W],
  // so reverse the EW pair's players. Confirmed against a side-by-side
  // comparison with the same game loaded via BWS+PBN files.
  const ew = reverseEwPlayers(ewRaw)

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
