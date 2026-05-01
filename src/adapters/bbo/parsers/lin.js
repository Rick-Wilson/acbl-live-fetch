import { ParseError } from '../../../lib/parseError.js'

// Dealer digit in md| token → seat letter.
const DEALER_MAP = { '1': 'S', '2': 'W', '3': 'N', '4': 'E' }

// Vulnerability code in sv| token → normalized string.
const VUL_MAP = { o: 'None', n: 'NS', e: 'EW', b: 'Both' }

// All ranks in high-to-low order, using '10' (not 'T') as the schema requires.
const ALL_RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = ['S', 'H', 'D', 'C']

// Extract and URL-decode the LIN string from a BBO hv_popuplin() onclick attribute.
// Returns null if the attribute is absent or malformed.
export function extractLinFromOnclick(onclickAttr) {
  if (!onclickAttr) return null
  const m = onclickAttr.match(/hv_popuplin\('([^']+)'\)/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return null
  }
}

// Parse a URL-decoded LIN string into structured bridge data.
//
// Returns:
//   { dealer, vulnerability, deal, auction, play, tricks }
//
// dealer:        'N' | 'E' | 'S' | 'W'
// vulnerability: 'None' | 'NS' | 'EW' | 'Both'
// deal:          { N: Hand, E: Hand, S: Hand, W: Hand }
// auction:       string[] — canonical bid strings (PASS / X / XX / 1NT / 2C / …)
// play:          string[] — card strings like 'DQ', 'H10', 'S2'
// tricks:        number | null — tricks taken (from mc| if present, else null)
export function parseLin(linStr) {
  if (typeof linStr !== 'string' || !linStr) {
    throw new ParseError('parseLin requires a non-empty string')
  }
  const tokens = tokenize(linStr)

  const md = tokens.md?.[0]
  if (!md) throw new ParseError('LIN missing md| token')

  const { dealer, deal } = parseDeal(md)
  const vulnerability = parseVulnerability(tokens.sv?.[0])
  const auction = buildAuction(tokens.mb ?? [])
  const play = (tokens.pc ?? []).map(parseLINCard)

  const mcRaw = tokens.mc?.[0]
  const tricks = mcRaw != null ? Number.parseInt(mcRaw, 10) : null

  return { dealer, vulnerability, deal, auction, play, tricks }
}

// Collect LIN key|value| pairs. Keys can repeat (mb, pc, an) — values are
// accumulated in order. Odd trailing parts (malformed LIN) are silently dropped.
function tokenize(linStr) {
  const result = {}
  const parts = linStr.split('|')
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const key = parts[i]
    const val = parts[i + 1]
    if (!key) continue
    if (!result[key]) result[key] = []
    result[key].push(val)
  }
  return result
}

// Parse the md| value into dealer and all four hands.
// md format: "{dealer_digit}{S_hand},{W_hand},{N_hand},{E_hand}"
// East may be omitted (empty or absent) — computed from the remaining cards.
function parseDeal(md) {
  const dealerChar = md[0]
  const dealer = DEALER_MAP[dealerChar]
  if (!dealer) {
    throw new ParseError(`Unknown dealer digit '${dealerChar}' in LIN md| token`)
  }

  const handStrs = md.slice(1).split(',')
  const south = parseHand(handStrs[0] ?? '')
  const west = parseHand(handStrs[1] ?? '')
  const north = parseHand(handStrs[2] ?? '')
  const east = handStrs[3] ? parseHand(handStrs[3]) : computeRemainder(south, west, north)

  return { dealer, deal: { N: north, E: east, S: south, W: west } }
}

// Parse a LIN hand string like "S789TQH5KD2C2478T" into
// { S: ['7','8','9','10','Q'], H: ['5','K'], D: ['2'], C: ['2','4','7','8','10'] }.
//
// Characters S/H/D/C switch the active suit; all other characters are ranks.
// 'T' is ten (BBO's representation); we normalize to '10'.
function parseHand(str) {
  const hand = { S: [], H: [], D: [], C: [] }
  if (!str) return hand
  let suit = null
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (SUITS.includes(ch)) {
      suit = ch
    } else if (suit) {
      hand[suit].push(ch === 'T' ? '10' : ch)
    }
  }
  return hand
}

// Compute East's hand as the cards not held by South, West, or North.
function computeRemainder(south, west, north) {
  const used = { S: new Set(), H: new Set(), D: new Set(), C: new Set() }
  for (const hand of [south, west, north]) {
    for (const suit of SUITS) {
      for (const rank of hand[suit]) used[suit].add(rank)
    }
  }
  const east = {}
  for (const suit of SUITS) {
    east[suit] = ALL_RANKS.filter((r) => !used[suit].has(r))
  }
  return east
}

function parseVulnerability(sv) {
  return VUL_MAP[sv?.toLowerCase()] ?? 'None'
}

// Convert LIN bid tokens to canonical bid strings.
// LIN uses: 'p'=pass, 'x'=double, 'r'=redouble, '1N'=1NT, '2C'=2♣, etc.
function buildAuction(mbTokens) {
  return mbTokens.map((bid) => {
    const lower = bid.toLowerCase()
    if (lower === 'p') return 'PASS'
    if (lower === 'x') return 'X'
    if (lower === 'r') return 'XX'
    // Natural bid: LIN uses 'N' for NT, schema uses 'NT'.
    return bid.replace(/n$/i, 'NT').toUpperCase()
  })
}

// Convert a LIN card token (e.g. "DQ", "HT", "S2") to canonical form.
// 'T' → '10'; all other characters are passed through.
function parseLINCard(cardStr) {
  if (!cardStr || cardStr.length < 2) return cardStr
  const suit = cardStr[0]
  const rankChars = cardStr.slice(1)
  return suit + (rankChars === 'T' ? '10' : rankChars)
}
