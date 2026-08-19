import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'

// The script is meant to be pasted into a console, so it is a plain script
// rather than a module. Load it the way a console would, with the auto-run
// suppressed.
let redactPage
beforeAll(() => {
  globalThis.__BC_REDACT_TEST = true
  const src = readFileSync(resolve(process.cwd(), 'tools/redact-page.js'), 'utf8')
  redactPage = new Function(`${src}; return redactPage`)()
})

const clubPage = () =>
  parseHTML(`<!doctype html><html><head><title>Livermore Bridge Club</title></head><body>
    <nav class="navbar"><img class="live_image" id="acbl-banner" width="600">
      <a>Login</a><button id="bridge-classroom-analyze-btn">Analyze in Bridge Classroom</button></nav>
    <img id="club-logo" width="650">
    <img id="ui-glyph" width="16">
    <h1>Livermore Bridge Club</h1>
    <p>2160 First St, Livermore, CA, 94550, US <a href="#">(Club Website)</a></p>
    <h3>Message from Club:</h3>
    <p>Manager: Don Garka, dgarka@comcast.net</p>
    <table><tr><td>2026-04-25</td><td>Tuesday Open Pairs</td></tr></table>
  </body></html>`).document

describe('redactPage — my.acbl.org', () => {
  it('replaces every piece of club identity', () => {
    const doc = clubPage()
    redactPage({ document: doc, href: 'https://my.acbl.org/club-results/233437' })
    const text = doc.body.textContent
    for (const leak of ['Livermore', 'Don Garka', 'dgarka', 'comcast', '2160 First St', '94550']) {
      expect(text, `leaked ${leak}`).not.toContain(leak)
    }
    expect(text).toContain('Your Bridge Club')
    expect(text).toContain('123 Main St, Anytown, CA, 00000')
    expect(text).toContain('Manager: Chris')
    expect(text).toContain('manager@example.com')
  })

  it('leaves our button and the game data alone', () => {
    const doc = clubPage()
    redactPage({ document: doc, href: 'https://my.acbl.org/club-results/233437' })
    expect(doc.getElementById('bridge-classroom-analyze-btn')).toBeTruthy()
    expect(doc.body.textContent).toContain('Tuesday Open Pairs')
    expect(doc.body.textContent).toContain('2026-04-25')
  })

  it('leaves the club logo alone by default', () => {
    const doc = clubPage()
    const r = redactPage({ document: doc, href: 'https://my.acbl.org/club-results/233437' })
    // A photograph carries no searchable text and does not identify a club.
    expect(doc.getElementById('club-logo').style.display).toBeFalsy()
    expect(r.logos).toBe(0)
  })

  it('hides it when asked, for framing, but keeps the ACBL banner', () => {
    const doc = clubPage()
    const r = redactPage({
      document: doc,
      href: 'https://my.acbl.org/club-results/233437',
      hideLogo: true,
    })
    expect(doc.getElementById('club-logo').style.display).toBe('none')
    // The site banner is the point of the shot, and lives in the navbar.
    expect(doc.getElementById('acbl-banner').style.display).toBeFalsy()
    // Small glyphs are UI, not artwork.
    expect(doc.getElementById('ui-glyph').style.display).toBeFalsy()
    expect(r.logos).toBe(1)
  })

  it('replaces the document title too', () => {
    const doc = clubPage()
    redactPage({ document: doc, href: 'https://my.acbl.org/club-results/233437' })
    expect(doc.title).toBe('Your Bridge Club')
  })

  it('reports what it changed', () => {
    const doc = clubPage()
    const r = redactPage({ document: doc, href: 'https://my.acbl.org/club-results/233437' })
    expect(r.host).toBe('my.acbl.org')
    expect(r.club).toBeGreaterThan(0)
    expect(r.email).toBeGreaterThan(0)
  })
})

describe('redactPage — live.acbl.org', () => {
  const livePage = () =>
    parseHTML(`<!doctype html><html><body><table>
      <thead><tr><th>Score</th><th>Player 1</th><th>Player 2</th><th>Scores</th></tr></thead>
      <tbody>
        <tr><td>439.50</td><td>Mary Grant, Dublin CA</td><td>Jon Jewett, Reno NV</td><td>Scores</td></tr>
        <tr><td colspan="4">Section A</td></tr>
      </tbody></table></body></html>`).document

  it('blurs both Player columns and nothing else', () => {
    const doc = livePage()
    const r = redactPage({ document: doc, href: 'https://live.acbl.org/event/x/1/summary' })
    const cells = [...doc.querySelectorAll('tbody tr')][0].children
    expect(cells[1].style.filter).toBe('blur(6px)')
    expect(cells[2].style.filter).toBe('blur(6px)')
    expect(cells[0].style.filter).toBeFalsy()
    expect(cells[3].style.filter).toBeFalsy()
    expect(r.cells).toBe(2)
  })

  it('skips rows whose cell count does not match the header', () => {
    const doc = livePage()
    redactPage({ document: doc, href: 'https://live.acbl.org/event/x/1/summary' })
    const spanRow = [...doc.querySelectorAll('tbody tr')][1]
    expect(spanRow.children[0].style.filter).toBeFalsy()
  })
})

describe('redactPage — BBO tview', () => {
  it('blurs the identity columns and small avatars, not big images', () => {
    const doc = parseHTML(`<!doctype html><html><body>
      <img id="logo" width="300">
      <table>
        <tr><th>Rank</th><th>Username</th><th>Player Names</th></tr>
        <tr><td>1</td><td>someone</td><td>A Real Name, CA</td></tr>
      </table>
      <img id="face" width="40">
    </body></html>`).document
    const r = redactPage({ document: doc, href: 'https://webutil.bridgebase.com/v2/tview.php?t=1' })
    const row = [...doc.querySelectorAll('tr')][1]
    expect(row.children[1].style.filter).toBe('blur(6px)')
    expect(row.children[2].style.filter).toBe('blur(6px)')
    expect(row.children[0].style.filter).toBeFalsy()
    expect(doc.getElementById('face').style.filter).toBe('blur(10px)')
    expect(doc.getElementById('logo').style.filter).toBeFalsy()
    expect(r.avatars).toBe(1)
  })
})
