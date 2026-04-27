// Shared double-dummy line parser. Both ACBL adapters (live.acbl.org and
// my.acbl.org/club-games) emit the DD makes per side as a string, and the
// digits in those strings encode two distinct things distinguished by
// token order:
//
//   • <digit><strain>  ("1C", "5NT") = highest-makeable-contract LEVEL
//                                      (1..7); tricks = level + 6.
//   • <strain><digit>  ("C5", "NT6") = RAW TRICK COUNT (0..6 typically),
//                                      used when the side can't make a
//                                      1-level contract.
//
// The schema field is raw tricks (0..13), so contract-level form gets the
// `+6` conversion. Slash form ("3/4H" or "C5/6") gives per-seat values:
// the first digit is for the first-listed seat, second digit for the
// second-listed seat. Single-value tokens populate both seats with the
// same number.
//
// Live.acbl.org wraps raw-tricks tokens in `<div class="reverse">` for
// styling but the wrapping is redundant — the token order alone is
// sufficient to disambiguate. Both adapters can therefore feed a flat
// text string through this single parser.

/** Parse one DD line (NS or EW row, possibly with a "NS:"/"EW:" prefix).
 *  Returns:
 *    {
 *      first:  { C, D, H, S, NT },   // first-seat tricks per strain
 *      second: { C, D, H, S, NT },   // second-seat tricks per strain
 *      warnings: string[],           // collected per-token issues
 *    }
 *  All trick values are integers 0..13 or null (unknown / "<7 tricks"
 *  bucket without a specific count).
 */
export function parseDoubleDummyLine(text) {
  const result = { first: emptyStrainMap(), second: emptyStrainMap(), warnings: [] }
  if (text == null || String(text).trim() === '') {
    result.warnings.push('empty double-dummy line')
    return result
  }

  // Strip leading 'NS:'/'EW:' label and collapse whitespace inside slash
  // forms: live.acbl.org's HTML has "4/ 5C" (suit symbol prevents writing
  // it tightly), which would tokenize as ['4/', '5C'] without normalization.
  const cleaned = String(text)
    .replace(/^(?:NS|EW):\s*/i, '')
    .replace(/(\d+)\s*\/\s*(\d+)/g, '$1/$2')
    .trim()

  for (const tok of cleaned.split(/\s+/).filter(Boolean)) {
    const numFirst = tok.match(/^(\d+)(?:\/(\d+))?(NT|[CDHS])$/i)
    const strainFirst = tok.match(/^(NT|[CDHS])(\d+)(?:\/(\d+))?$/i)
    if (numFirst) {
      const strain = numFirst[3].toUpperCase()
      const a = levelToTricks(parseDigit(numFirst[1]))
      const b = numFirst[2] != null ? levelToTricks(parseDigit(numFirst[2])) : a
      result.first[strain] = a
      result.second[strain] = b
    } else if (strainFirst) {
      const strain = strainFirst[1].toUpperCase()
      const a = clampTricks(parseDigit(strainFirst[2]))
      const b = strainFirst[3] != null ? clampTricks(parseDigit(strainFirst[3])) : a
      result.first[strain] = a
      result.second[strain] = b
    } else {
      result.warnings.push(`unrecognized DD token '${tok}'`)
    }
  }
  return result
}

function emptyStrainMap() {
  return { C: null, D: null, H: null, S: null, NT: null }
}

function levelToTricks(level) {
  if (!Number.isInteger(level)) return null
  if (level === 0) return null // ACBL "<7 tricks" bucket without specific count
  if (level >= 1 && level <= 7) return level + 6
  return null
}

function clampTricks(n) {
  if (!Number.isInteger(n)) return null
  if (n < 0 || n > 13) return null
  return n
}

function parseDigit(raw) {
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? null : n
}
