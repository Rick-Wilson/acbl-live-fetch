import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseHandsList } from '../../../src/adapters/bbo/parsers/handsList.js'
import { parseTraveller } from '../../../src/adapters/bbo/parsers/traveller.js'
import { parseBboHistoryList } from '../../../src/adapters/bbo/parsers/historyList.js'

const fixtureDir = join(import.meta.dirname, '../../../fixtures/bbo')
const loginPage = readFileSync(join(fixtureDir, 'myhands-login-page.html'), 'utf8')
const handsList = readFileSync(join(fixtureDir, 'hands-list-81382-kemistry.html'), 'utf8')

// A myhands request with a lapsed session 302s to myhands_login.php and fetch
// follows it, so the parser receives a login page. Before this check it
// reported the first missing selector, which reads as "has BBO changed their
// HTML?" — and cost real time chasing a format change that had not happened.
describe('lapsed BBO session', () => {
  const parsers = [
    ['parseHandsList', parseHandsList],
    ['parseTraveller', parseTraveller],
    ['parseBboHistoryList', parseBboHistoryList],
  ]

  for (const [name, parse] of parsers) {
    it(`${name} blames the session, not the page format`, () => {
      let err
      try {
        parse(loginPage)
      } catch (e) {
        err = e
      }
      expect(err, `${name} accepted a login page`).toBeDefined()
      expect(err.message).toMatch(/sign-in page/i)
      expect(err.message).toMatch(/reload/i)
      // The misleading phrasing must not reach the user for this case.
      expect(err.message).not.toMatch(/format (may have )?changed/i)
      expect(err.message).not.toMatch(/tourneySummary/)
    })
  }

  it('detects the login page by its password field, not the redirect URL', () => {
    // myhands_login.php appears only in the URL — the form posts to itself with
    // no action attribute — so matching that string would never fire.
    expect(loginPage).not.toMatch(/myhands_login/)
    expect(loginPage).toMatch(/type="password"/)
  })

  it('does not misread a real hands list as a login page', () => {
    expect(() => parseHandsList(handsList)).not.toThrow()
  })
})
