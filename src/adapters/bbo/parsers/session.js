import { ParseError } from '../../../lib/parseError.js'

// BBO's myhands pages are session-bound. When the session lapses — the common
// case being a tab left open overnight — the request 302s to
// myhands_login.php, `fetch` follows it, and the parser is handed a login page.
//
// Without this check the parser reports the first selector it cannot find,
// which reads as "has BBO changed their HTML?" That sent us looking for a
// format change that had not happened. The page is fine; the session is stale.
//
// Detect on a password field. It is the one thing a results page never has,
// and unlike the redirect target it is actually present in the delivered HTML:
// `myhands_login.php` appears only in the URL, because the login form posts to
// itself with no action attribute. Matching on that string would never fire.
// The prompt text is a second, independent signal in case the markup changes.
const LOGIN_PROMPT = /please login with your bbo username/i

export function assertSession(htmlString, doc) {
  const hasPasswordField =
    !!doc?.querySelector?.('input[type="password"], input[name="password"]')

  if (hasPasswordField || LOGIN_PROMPT.test(htmlString)) {
    throw new ParseError(
      'BBO returned its sign-in page instead of your results. Reload this page and ' +
        'try again — sign in to BBO again if that does not clear it.',
      { sessionExpired: true }
    )
  }
}
