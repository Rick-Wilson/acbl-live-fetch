// Redact a results page before screenshotting it.
//
// Paste the whole file into the browser console on the page you are about to
// shoot, then take the shot. Returns a summary of what it changed, so you can
// see it worked before spending the capture.
//
//   • my.acbl.org           club name, street address, manager name and email
//   • live.acbl.org         the Player columns (names AND hometowns)
//   • tview.php (BBO)       Username / Player Names columns, and avatars
//
// It picks the right treatment from the URL, so there is one thing to paste
// rather than three to choose between.
//
// redactPage({ hideLogo: true }) additionally hides the club's logo. That is a
// framing option, not a redaction — see the note beside it.
//
// Nothing here survives a reload — re-run it before every shot. That is
// deliberate: a redaction that persisted would be one you could forget you were
// relying on.
//
// Two rules this encodes, from docs/screenshot-set.md § Anonymising:
//
//   Club identity is REPLACED, not blurred. A blurred block reads as something
//   hidden; "Your Bridge Club" reads as an example. example.com and ZIP 00000
//   are reserved, so neither can land on a real address.
//
//   People are blurred. Rick's own handle and agreed partners stay visible;
//   everyone else does not.

function redactPage(opts = {}) {
  const doc = opts.document ?? document
  const href = opts.href ?? doc.defaultView?.location?.href ?? location.href
  const host = new URL(href).hostname
  const changed = { club: 0, address: 0, manager: 0, email: 0, logos: 0, cells: 0, avatars: 0 }

  const textNodes = (root) => {
    // NodeFilter.SHOW_TEXT is 4; spelled numerically so this runs anywhere.
    const walk = doc.createTreeWalker(root, 4)
    const out = []
    for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n)
    return out
  }

  // ── my.acbl.org — replace identity outright ─────────────────────────────
  if (host === 'my.acbl.org') {
    // The club name is the page title on both the club list and a game page,
    // which saves hand-editing a name into this script per club.
    const club = (opts.club ?? doc.title ?? '').trim()
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
  const columnPattern =
    host === 'live.acbl.org' ? /^player\b/i
    : /username|player names/i

  if (host === 'live.acbl.org' || /bridgebase\.com$/.test(host)) {
    for (const table of doc.querySelectorAll('table')) {
      const headRow = table.querySelector('thead tr') ?? table.querySelector('tr')
      if (!headRow) continue
      const heads = [...headRow.children].map((c) => (c.textContent ?? '').trim())
      const cols = heads.flatMap((h, i) => (columnPattern.test(h) ? [i] : []))
      if (!cols.length) continue
      for (const tr of table.querySelectorAll('tr')) {
        if (tr === headRow) continue
        const cells = [...tr.children]
        // Skip rows that don't line up with the header — colspan'd separators
        // would otherwise blur the wrong column.
        if (cells.length !== heads.length) continue
        for (const i of cols) {
          if (!cells[i]) continue
          cells[i].style.filter = 'blur(6px)'
          changed.cells++
        }
      }
    }
    // Avatars: small images only, so club logos and the site header survive.
    for (const im of doc.querySelectorAll('img')) {
      if (im.width && im.width <= 80) {
        im.style.filter = 'blur(10px)'
        changed.avatars++
      }
    }
  }

  return { host, ...changed }
}

if (typeof window !== 'undefined' && !globalThis.__BC_REDACT_TEST) {
  console.log('redacted:', redactPage())
}
