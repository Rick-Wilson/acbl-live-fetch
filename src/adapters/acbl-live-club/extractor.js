// Extract the club-game data blob from a my.acbl.org/club-results/details/{id}
// page's HTML. The page's server-rendered HTML embeds the entire game
// payload as a Vue prop on a custom element:
//
//   <result-details v-bind:data="{...HTML-encoded JSON...}">
//
// The original spec described a `var data = {...};` script-tag form, but in
// practice every script on this page is wrapped by Cloudflare Rocket Loader
// (type="...-text/javascript") and the actual data lives in this Vue
// attribute. linkedom's DOMParser decodes the &quot; entities for us; we
// just JSON.parse what comes back.

import { ParseError } from '../../lib/parseError.js'

export function extractClubGameData(htmlString) {
  if (typeof htmlString !== 'string' || htmlString.length === 0) {
    throw new ParseError('extractClubGameData expects a non-empty HTML string')
  }
  const doc = new DOMParser().parseFromString(htmlString, 'text/html')
  const el = doc.querySelector('result-details')
  if (!el) {
    throw new ParseError(
      'Could not find <result-details> element — has my.acbl.org changed?',
      { selector: 'result-details' }
    )
  }
  // The Vue binding name is literally `v-bind:data` (colon-prefixed). DOM
  // attribute names with colons are valid in HTML; getAttribute treats them
  // as a raw string.
  const raw = el.getAttribute('v-bind:data') ?? el.getAttribute(':data')
  if (raw == null || raw === '') {
    throw new ParseError(
      "Found <result-details> but no v-bind:data attribute on it",
      { selector: 'result-details', html: el.outerHTML?.slice(0, 200) }
    )
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new ParseError(`Failed to JSON.parse v-bind:data attribute: ${err.message}`, {
      selector: 'result-details',
      html: raw.slice(0, 200),
    })
  }
}
