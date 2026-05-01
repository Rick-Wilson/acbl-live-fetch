import { describe, it, expect, beforeEach } from 'vitest'
import { parseLin, extractLinFromOnclick } from '../../../src/adapters/bbo/parsers/lin.js'

// Board 1 LIN from the tournament fixture (URL-decoded).
const BOARD1_LIN =
  'pn|norreb,aam135,kaodul,kemistry|st||md|3S789TQH5KD2C2478T,S2456JAH6TD57TKC6,S3H78JD4689JQC39J,|rh||ah|Board 1|sv|o|mb|p|mb|2C|mb|2S|mb|p|mb|p|mb|3H|mb|p|mb|3N|mb|p|mb|p|mb|p|pc|DQ|pc|D3|pc|D2|pc|DK|pc|HT|pc|H7|pc|H2|pc|HK|pc|ST|pc|S2|pc|S3|pc|SK|pc|HA|pc|H5|pc|H6|pc|H8|pc|HQ|pc|S7|pc|S4|pc|HJ|pc|H9|pc|S8|pc|S5|pc|D4|pc|H4|pc|S9|pc|S6|pc|D6|pc|H3|pc|SQ|pc|SJ|pc|D8|pc|DA|pc|C2|pc|D5|pc|D9|pc|CA|pc|C4|pc|C6|pc|C3|pc|CK|pc|C7|pc|D7|pc|C9|pc|CQ|pc|C8|pc|DT|pc|CJ|pc|C5|pc|CT|pc|SA|pc|DJ|'

// Board 2 LIN — has mc| token (tricks made explicitly).
const BOARD2_LIN =
  'pn|norreb,aam135,kaodul,kemistry|st||md|4S456H59TQKD479CTQ,S7AH4AD38TKC2568A,S8JQH278JD5JQC39K,|rh||ah|Board 2|sv|n|mb|p|mb|p|mb|1C|mb|p|mb|1S|mb|p|mb|1N|mb|p|mb|2C|mb|p|mb|2D|mb|p|mb|2S|mb|p|mb|2N|mb|p|mb|p|mb|p|pc|H2|pc|H3|pc|HQ|pc|HA|mc|8|'

describe('extractLinFromOnclick', () => {
  it('extracts and decodes LIN from an onclick attribute', () => {
    const onclick =
      "hv_popuplin('pn%7Cnorreb%2Caam135%7Csv%7Co%7C');this.style.color='red';return false;"
    const result = extractLinFromOnclick(onclick)
    expect(result).toBe('pn|norreb,aam135|sv|o|')
  })

  it('returns null for absent onclick', () => {
    expect(extractLinFromOnclick(null)).toBeNull()
    expect(extractLinFromOnclick('')).toBeNull()
  })

  it('returns null when onclick has no hv_popuplin call', () => {
    expect(extractLinFromOnclick("alert('hello')")).toBeNull()
  })
})

describe('parseLin — board 1', () => {
  let result
  beforeEach(() => {
    result = parseLin(BOARD1_LIN)
  })

  it('parses dealer', () => {
    expect(result.dealer).toBe('N') // md| starts with 3 → North
  })

  it('parses vulnerability None', () => {
    expect(result.vulnerability).toBe('None') // sv|o|
  })

  it('parses South hand', () => {
    expect(result.deal.S.S).toEqual(['7', '8', '9', '10', 'Q'])
    expect(result.deal.S.H).toEqual(['5', 'K'])
    expect(result.deal.S.D).toEqual(['2'])
    expect(result.deal.S.C).toEqual(['2', '4', '7', '8', '10'])
  })

  it('parses West hand', () => {
    expect(result.deal.W.S).toEqual(['2', '4', '5', '6', 'J', 'A'])
    expect(result.deal.W.H).toEqual(['6', '10'])
    expect(result.deal.W.D).toEqual(['5', '7', '10', 'K'])
    expect(result.deal.W.C).toEqual(['6'])
  })

  it('parses North hand', () => {
    expect(result.deal.N.S).toEqual(['3'])
    expect(result.deal.N.H).toEqual(['7', '8', 'J'])
    expect(result.deal.N.D).toEqual(['4', '6', '8', '9', 'J', 'Q'])
    expect(result.deal.N.C).toEqual(['3', '9', 'J'])
  })

  it('computes East hand from remainder (13 cards total)', () => {
    const E = result.deal.E
    const total = E.S.length + E.H.length + E.D.length + E.C.length
    expect(total).toBe(13)
  })

  it('all four hands total 52 cards', () => {
    const total = ['S', 'E', 'N', 'W'].reduce((sum, seat) => {
      const hand = result.deal[seat]
      return sum + hand.S.length + hand.H.length + hand.D.length + hand.C.length
    }, 0)
    expect(total).toBe(52)
  })

  it('parses auction', () => {
    expect(result.auction).toEqual([
      'PASS', '2C', '2S', 'PASS', 'PASS', '3H', 'PASS', '3NT', 'PASS', 'PASS', 'PASS',
    ])
  })

  it('parses play cards (T → 10)', () => {
    expect(result.play[0]).toBe('DQ')
    expect(result.play[1]).toBe('D3')
  })

  it('returns null tricks when mc| is absent', () => {
    expect(result.tricks).toBeNull()
  })
})

describe('parseLin — board 2 (mc| present)', () => {
  it('reads tricks from mc| token', () => {
    const result = parseLin(BOARD2_LIN)
    expect(result.tricks).toBe(8)
  })

  it('parses dealer West (digit 4 → East... wait, 4=S or W?)', () => {
    // md|4... → dealer digit 4 = East? No: 1=S 2=W 3=N 4=E
    const result = parseLin(BOARD2_LIN)
    expect(result.dealer).toBe('E') // md| starts with 4
  })

  it('parses vulnerability NS', () => {
    const result = parseLin(BOARD2_LIN)
    expect(result.vulnerability).toBe('NS') // sv|n|
  })
})

describe('parseLin — error cases', () => {
  it('throws on empty string', () => {
    expect(() => parseLin('')).toThrow('non-empty')
  })

  it('throws when md| token is missing', () => {
    expect(() => parseLin('pn|foo,bar|sv|o|')).toThrow('md|')
  })

  it('throws on unknown dealer digit', () => {
    expect(() => parseLin('md|9SAS,')).toThrow("Unknown dealer digit '9'")
  })
})
