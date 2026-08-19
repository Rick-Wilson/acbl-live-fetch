import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { redactPage, resetClubMemo } from '../../src/lib/redact.js'

beforeEach(() => resetClubMemo())

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

describe('redactPage — a club GAME page', () => {
  // Regression, from a capture that could not be used: four real pairs were
  // listed under a "Names" column the redactor did not know about, the club
  // name came through as a link because the page titles itself with the game,
  // and the event name carried the town.
  const href = 'https://my.acbl.org/club-results/details/1455416'
  const gamePage = () =>
    parseHTML(`<!doctype html><html><head><title>Livermore Monday Club Champion</title></head><body>
      <a href="/club-results/233437">Livermore Bridge Club</a>
      <h2>Livermore Monday Club Champion</h2>
      <p>06/01/2026 - Monday Morning</p>
      <table>
        <thead><tr><th>Pair</th><th>Names</th><th>Strat</th></tr></thead>
        <tbody>
          <tr><td>6-NS</td><td>Padmini Sokkappa - Dr Arthur A Mirin</td><td>A</td></tr>
          <tr><td>4-NS</td><td>Frank L Codd - Mr George Y Yeh</td><td>B</td></tr>
        </tbody>
      </table>
    </body></html>`).document

  it('takes the club name from the back-link when the title is the game', () => {
    const doc = gamePage()
    redactPage({ document: doc, href })
    expect(doc.body.textContent).not.toContain('Livermore Bridge Club')
    expect(doc.body.textContent).toContain('Your Bridge Club')
  })

  it('replaces the town, which the event name carries separately', () => {
    const doc = gamePage()
    redactPage({ document: doc, href })
    // "Livermore Monday Club Champion" would otherwise survive intact.
    expect(doc.body.textContent).not.toContain('Livermore')
    expect(doc.body.textContent).toContain('Anytown Monday Club Champion')
  })

  it('blurs the Names column — a club game is a full field of real people', () => {
    const doc = gamePage()
    const r = redactPage({ document: doc, href })
    const rows = [...doc.querySelectorAll('tbody tr')]
    expect(rows[0].children[1].style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
    expect(rows[1].children[1].style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
    // Pair number and strat are not identifying and stay sharp.
    expect(rows[0].children[0].style.textShadow).toBeFalsy()
    expect(rows[0].children[2].style.textShadow).toBeFalsy()
    expect(r.cells).toBe(2)
  })

  it('does not blur the club logo as if it were an avatar', () => {
    const doc = gamePage()
    const img = doc.createElement('img')
    img.id = 'logo'
    img.width = 60
    doc.body.appendChild(img)
    redactPage({ document: doc, href })
    expect(doc.getElementById('logo').style.filter).toBeFalsy()
  })
})

describe('redactPage — headers as real table widgets render them', () => {
  // The mock in the test above had tidy <th>Names</th>. The live page does not:
  // my.acbl.org builds its table in Vue, its headers carry sort arrows and
  // non-breaking spaces, and rows can have an extra action cell. An anchored
  // /^names?$/ matched the mock and nothing real, so a capture went out with a
  // full field of players unblurred.
  const href = 'https://my.acbl.org/club-results/details/1'
  const build = (headerHtml, rowHtml) =>
    parseHTML(`<!doctype html><html><head><title>X</title></head><body><table>
      <thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table></body></html>`).document

  const NAMES = 'Ann Example - Bob Example'

  it('matches a header carrying a sort arrow', () => {
    const doc = build('<td>Pair</td><td>Names \u21c5</td><td>Strat</td>',
                      `<tr><td>6-NS</td><td>${NAMES}</td><td>A</td></tr>`)
    redactPage({ document: doc, href })
    expect(doc.querySelector('tbody td:nth-child(2)').style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
  })

  it('matches a header carrying a non-breaking space', () => {
    const doc = build('<td>Pair</td><td>\u00a0Names\u00a0</td><td>Strat</td>',
                      `<tr><td>6-NS</td><td>${NAMES}</td><td>A</td></tr>`)
    redactPage({ document: doc, href })
    expect(doc.querySelector('tbody td:nth-child(2)').style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
  })

  it('matches "Player Names" as well as "Names"', () => {
    const doc = build('<td>Rank</td><td>Player Names</td>',
                      `<tr><td>1</td><td>${NAMES}</td></tr>`)
    redactPage({ document: doc, href })
    expect(doc.querySelector('tbody td:nth-child(2)').style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
  })

  it('still blurs when a row has an extra action cell', () => {
    const doc = build('<td>Pair</td><td>Names</td>',
                      `<tr><td>6-NS</td><td>${NAMES}</td><td><a>Scores</a></td></tr>`)
    redactPage({ document: doc, href })
    expect(doc.querySelector('tbody td:nth-child(2)').style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
  })

  it('still skips a colspanned separator row', () => {
    const doc = build('<td>Pair</td><td>Names</td>',
                      '<tr><td colspan="2">Section A</td></tr>')
    const r = redactPage({ document: doc, href })
    expect(doc.querySelector('tbody td').style.textShadow).toBeFalsy()
    expect(r.cells).toBe(0)
  })
})

describe('redactPage — blurring must not change layout', () => {
  // filter: blur() on a table cell creates a stacking context and the cell
  // stops laying out as a table cell, which made short rows grow tall and the
  // table look broken in a capture. Transparent text plus a shadow blurs the
  // glyphs while keeping their metrics.
  const href = 'https://my.acbl.org/club-results/details/1'

  it('never sets filter on a table cell', () => {
    const doc = parseHTML(`<!doctype html><html><head><title>X</title></head><body><table>
      <thead><tr><td>Pair</td><td>Names</td></tr></thead>
      <tbody><tr><td>6-NS</td><td>Ann Example - Bob Example</td></tr></tbody>
    </table></body></html>`).document
    redactPage({ document: doc, href })
    const cell = doc.querySelector('tbody td:nth-child(2)')
    expect(cell.style.filter).toBeFalsy()
    expect(cell.style.color).toBe('transparent')
    expect(cell.style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
  })

  it('blurs a link inside the cell, which carries its own colour', () => {
    const doc = parseHTML(`<!doctype html><html><head><title>X</title></head><body><table>
      <thead><tr><td>Pair</td><td>Names</td></tr></thead>
      <tbody><tr><td>6-NS</td><td><a href="/p/1">Ann Example</a></td></tr></tbody>
    </table></body></html>`).document
    redactPage({ document: doc, href })
    const link = doc.querySelector('tbody a')
    expect(link.style.color).toBe('transparent')
    expect(link.style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
  })
})

describe('redactPage — repeated passes on an SPA', () => {
  // Regression. Under SHOT_MODE this runs from document_start and again on
  // every mutation. The first pass replaces document.title, which is the only
  // source of the club's name — so without a memo the second pass, the one that
  // finally sees the Vue-rendered <h1>, has nothing to look up. The captured
  // screenshot had the address, manager and email replaced and the club name
  // still in the heading.
  const href = 'https://my.acbl.org/club-results/233437'

  it('still replaces the club name when the heading arrives after the first pass', () => {
    const { document: doc } = parseHTML(
      `<!doctype html><html><head><title>Livermore Bridge Club</title></head><body></body></html>`
    )
    redactPage({ document: doc, href })
    expect(doc.title).toBe('Your Bridge Club')

    doc.body.innerHTML = `<h1>Livermore Bridge Club</h1><p>Manager: Don Garka, x@y.com</p>`
    redactPage({ document: doc, href })

    expect(doc.body.textContent).not.toContain('Livermore')
    expect(doc.body.textContent).toContain('Your Bridge Club')
  })

  it('does not remember the replacement as if it were a club name', () => {
    const { document: doc } = parseHTML(
      `<!doctype html><html><head><title>Your Bridge Club</title></head><body><h1>Real Club</h1></body></html>`
    )
    const r = redactPage({ document: doc, href })
    // Nothing to match, and crucially it must not blank out unrelated text.
    expect(doc.body.textContent).toContain('Real Club')
    expect(r.club).toBe(0)
  })

  it('is idempotent across many passes', () => {
    const { document: doc } = parseHTML(
      `<!doctype html><html><head><title>Livermore Bridge Club</title></head>
       <body><h1>Livermore Bridge Club</h1><p>Manager: Don Garka, x@y.com</p></body></html>`
    )
    for (let i = 0; i < 5; i++) redactPage({ document: doc, href })
    const text = doc.body.textContent
    expect(text).toContain('Your Bridge Club')
    expect(text).toContain('Manager: Chris')
    expect(text).not.toContain('Your Your')
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
    expect(cells[1].style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
    expect(cells[2].style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
    expect(cells[0].style.textShadow).toBeFalsy()
    expect(cells[3].style.textShadow).toBeFalsy()
    expect(r.cells).toBe(2)
  })

  it('skips rows whose cell count does not match the header', () => {
    const doc = livePage()
    redactPage({ document: doc, href: 'https://live.acbl.org/event/x/1/summary' })
    const spanRow = [...doc.querySelectorAll('tbody tr')][1]
    expect(spanRow.children[0].style.textShadow).toBeFalsy()
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
    expect(row.children[1].style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
    expect(row.children[2].style.textShadow).toMatch(/rgba\(0,\s*0,\s*0/)
    expect(row.children[0].style.textShadow).toBeFalsy()
    expect(doc.getElementById('face').style.filter).toBe('blur(10px)')
    expect(doc.getElementById('logo').style.filter).toBeFalsy()
    expect(r.avatars).toBe(1)
  })
})
