// Redact a results page before screenshotting it.
//
// Loaded as a content script by the SHOT_MODE build only — see vite.config.js
// and `npm run build:shots`. It never ships: package-stores.sh refuses any
// build carrying it.
//
//   • my.acbl.org           club name, street address, manager name and email
//   • live.acbl.org         the Player columns (names AND hometowns)
//   • tview.php (BBO)       Username / Player Names columns, and avatars
//
// It picks the right treatment from the URL, so one build covers every page.
//
// This runs on every load rather than being pasted before each shot, which is
// the point: the first iPhone capture went out carrying a real club manager's
// name and email because the redaction was a thing a human had to remember.
//
// Two rules this encodes, from docs/screenshot-set.md § Anonymising:
//
//   Club identity is REPLACED, not blurred. A blurred block reads as something
//   hidden; "Your Bridge Club" reads as an example. example.com and ZIP 00000
//   are reserved, so neither can land on a real address.
//
//   People are blurred. Rick's own handle and agreed partners stay visible;
//   everyone else does not.
//
// The club LOGO is not identity and is left alone by default — it is a
// photograph with no searchable text. { hideLogo: true } hides it anyway, as a
// framing option: on a phone it can push the results table below the fold.

// The club name is remembered across calls, and that is load-bearing rather
// than an optimisation.
//
// Its only source is document.title, and the first pass *replaces* the title —
// so a second pass has nothing left to look up. That is not hypothetical: under
// SHOT_MODE this runs from document_start and again on every mutation, and
// my.acbl.org is a Vue SPA whose <h1> renders after the first pass. The result
// was a screenshot with the address, manager and email correctly replaced and
// the club's name still in 48pt type, because those are found by regex and the
// name is not.
let rememberedClub = null

// Tests only — each case needs a clean slate.
export function resetClubMemo() {
  rememberedClub = null
}

export function redactPage(opts = {}) {
  const doc = opts.document ?? document
  const href = opts.href ?? doc.defaultView?.location?.href ?? location.href
  const host = new URL(href).hostname
  const changed = { club: 0, town: 0, address: 0, manager: 0, email: 0, logos: 0, cells: 0, avatars: 0 }

  const textNodes = (root) => {
    // NodeFilter.SHOW_TEXT is 4; spelled numerically so this runs anywhere.
    const walk = doc.createTreeWalker(root, 4)
    const out = []
    for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n)
    return out
  }

  // ── my.acbl.org — replace identity outright ─────────────────────────────
  if (host === 'my.acbl.org') {
    // Two sources, because neither covers both pages. The club-results LIST
    // page titles itself with the club name; a GAME page titles itself with the
    // game, and carries the club name only as a link back to the list.
    const titleNow = (doc.title ?? '').trim()

    // The back-link, and only the one carrying a club id. "Back to main page"
    // points at /club-results with no id, and using its text as the club name
    // would replace the wrong thing everywhere.
    const linkNow = [...doc.querySelectorAll('a[href]')]
      .filter((a) => /\/club-results\/\d+/.test(a.getAttribute('href') ?? ''))
      .map((a) => (a.textContent ?? '').trim())
      .find((t) => t && !/back to|main page/i.test(t)) ?? ''

    // Link first. A game page titles itself with the GAME — preferring the
    // title there renamed the event to "Your Bridge Club" and left the actual
    // club name untouched in the link beside it. The list page has no such
    // link, so it falls through to the title, which is the club name there.
    for (const candidate of [linkNow, titleNow]) {
      if (candidate && candidate !== 'Your Bridge Club') {
        rememberedClub = candidate
        break
      }
    }
    const club = (opts.club ?? rememberedClub ?? '').trim()

    // The town leaks separately from the club name. "Livermore Bridge Club"
    // became "Your Bridge Club", and the event beside it was still called
    // "Livermore Monday Club Champion". Replace the distinctive leading word
    // too — it is the half that identifies anybody.
    const town = club.replace(/\s+(duplicate\s+)?bridge\s+club\s*$/i, '').trim()
    const ADDRESS = /\d+\s+[^,]+,\s*[^,]+,\s*[A-Z]{2},\s*\d{5}(,\s*US)?/g
    const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
    const MANAGER = /Manager:\s*[^,<]+/g

    for (const n of textNodes(doc.body)) {
      const before = n.nodeValue
      if (!before.trim()) continue
      let t = before
      if (club) {
        const split = t.split(club)
        if (split.length > 1) changed.club += split.length - 1
        t = split.join('Your Bridge Club')
      }
      // After the full name, so "Livermore Bridge Club" is not turned into
      // "Anytown Bridge Club" before it can match.
      if (town && town !== club) {
        const split = t.split(town)
        if (split.length > 1) changed.town += split.length - 1
        t = split.join('Anytown')
      }
      if (ADDRESS.test(t)) changed.address++
      t = t.replace(ADDRESS, '123 Main St, Anytown, CA, 00000')
      if (MANAGER.test(t)) changed.manager++
      t = t.replace(MANAGER, 'Manager: Chris')
      if (EMAIL.test(t)) changed.email++
      t = t.replace(EMAIL, 'manager@example.com')
      if (t !== before) n.nodeValue = t
    }
    // The title itself shows in some captures (and in the tab strip on desktop).
    if (club) doc.title = 'Your Bridge Club'

    // Opt-in, and NOT a redaction — the club logo stays by default.
    //
    // It was briefly hidden as identity. That was wrong: it is a photograph
    // with no searchable text, and nothing about a generic one ties it to a
    // particular club. Text is what identifies a club, and the text is handled
    // above. We show ACBL's and BBO's pages throughout this listing; a club's
    // picture is not a different kind of thing.
    //
    // What it is good for is framing. On a phone the logo can occupy a third
    // of the screen and push the results table below the fold, so the shot
    // ends up showing a club page rather than the extension doing anything.
    // Pass { hideLogo: true } when that is the problem.
    if (opts.hideLogo) {
      for (const im of doc.querySelectorAll('img')) {
        if (im.closest?.('nav, .navbar, header')) continue
        const w = im.width || im.naturalWidth || 0
        if (w && w < 100) continue // small UI glyphs, not artwork
        im.style.display = 'none'
        changed.logos++
      }
    }
  }

  // ── Column blurring, by header name ─────────────────────────────────────
  // live.acbl.org's Player cells carry hometowns as well as names; BBO's
  // tview.php carries usernames, full names and states.
  // A club game page is a full field of real players. Its column is headed
  // "Names"; live.acbl.org says "Player 1"/"Player 2"; BBO says "Username" and
  // "Player Names". Missing my.acbl.org here put four real pairs into a
  // capture — the redactor had replaced the club around them and left the
  // people alone.
  // Blur text without touching layout.
  //
  // `filter: blur()` on a table cell changes the row's height — it creates a
  // stacking context and the cell stops laying out as a table cell — so short
  // rows grew tall and the table looked broken in a screenshot. Transparent
  // text with a shadow blurs the glyphs while keeping their metrics exactly,
  // so the row is the height it always was.
  //
  // Applied to descendants too: a name in the cell is often a link, and a link
  // carries its own colour that a rule on the cell will not override.
  const blurText = (el) => {
    for (const node of [el, ...el.querySelectorAll('*')]) {
      node.style.color = 'transparent'
      node.style.textShadow = '0 0 9px rgba(0,0,0,0.55)'
      // Safari honours this over `color` for text fill.
      node.style.webkitTextFillColor = 'transparent'
    }
  }

  // Matched loosely, and anchored patterns were a mistake. These headers are
  // rendered by the site's own table widget: they carry sort arrows, nbsp,
  // screen-reader spans and stray whitespace, so `^names?$` matched the mock in
  // the tests and nothing on the real page. The fixture could not have warned
  // us — my.acbl.org is a Vue SPA and the fixture is the server shell, with no
  // <table> in it at all.
  //
  // Over-blurring a column is a wasted screenshot. Under-blurring one publishes
  // a field of real names, so this errs loose deliberately.
  const columnPattern =
    host === 'my.acbl.org' ? /\bnames?\b|\bplayers?\b/i
    : host === 'live.acbl.org' ? /\bplayer\b/i
    : /\busername\b|\bplayer names\b|\bnames\b/i

  if (host === 'my.acbl.org' || host === 'live.acbl.org' || /bridgebase\.com$/.test(host)) {
    for (const table of doc.querySelectorAll('table')) {
      const headRow = table.querySelector('thead tr') ?? table.querySelector('tr')
      if (!headRow) continue
      const heads = [...headRow.children].map((c) =>
        (c.textContent ?? '')
          .replace(/[\u2191\u2193\u21c5\u25b2\u25bc\u00a0]/g, ' ') // sort arrows, nbsp
          .replace(/\s+/g, ' ')
          .trim()
      )
      const cols = heads.flatMap((h, i) => (columnPattern.test(h) ? [i] : []))
      if (!cols.length) continue
      for (const tr of table.querySelectorAll('tr')) {
        if (tr === headRow) continue
        const cells = [...tr.children]
        // Separator rows span the table and would put the blur on the wrong
        // column, so skip those. Requiring an exact cell count instead was too
        // strict: a responsive table with one extra action cell silently
        // skipped every row, which fails in the direction that publishes names.
        if (cells.length < heads.length) continue
        if (cells.some((c) => Number(c.getAttribute?.('colspan') ?? 1) > 1)) continue
        for (const i of cols) {
          if (!cells[i]) continue
          blurText(cells[i])
          changed.cells++
        }
      }
    }
    // Avatars: small images only, so club logos and the site header survive.
    // Not on my.acbl.org, whose small images are UI chrome rather than faces.
    for (const im of host === 'my.acbl.org' ? [] : doc.querySelectorAll('img')) {
      if (im.width && im.width <= 80) {
        im.style.filter = 'blur(10px)'
        changed.avatars++
      }
    }
  }

  return { host, ...changed }
}
