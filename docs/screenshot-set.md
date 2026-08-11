# The screenshot set

A record of what the extension looked like at 1.0.0, one **before/after pair per
injection point**. The store listings draw from this; they are not the reason
for it. Chrome takes five, Edge six, Apple ten — the set is larger than any of
them on purpose.

**Before** means *the page with our button on it, not yet clicked*.
**After** means *what clicking produced*. Intermediate states get their own
suffix rather than being squeezed into either.

Names are `<source>-<state>.png`, so the source is legible without a legend.
An earlier set was numbered by store slot, which hid which site each shot came
from and made "before" ambiguous — it had been used to mean *extension not
installed*, which is a different picture and a different point.

All shots: **2560×1600**, page content only, no browser chrome. Downscale to
1280×800 for Chrome, Edge and AMO; Apple takes the masters. See
[store-review.md](store-review.md) § 4.

## Coverage

| # | Source | before | after | notes |
|---|---|:--:|:--:|---|
| 1 | BBO hand viewer | ✅ | ✅ | also `bbo-handviewer-no-extension.png`, the page without us |
| 2 | BBO hands list (`myhands`) | ✅ | ⬜ | blur East/West before shooting |
| 3 | BBO tournament view (`tview`) | ⬜ | ⬜ | heaviest anonymising of the set |
| 4 | BBO lobby (`/v3/`) | ⬜ | ⬜ | needs a BBO login |
| 5 | ACBL club — event list | ✅ | ✅ | plus `-menu` and `-fetching` |
| 6 | ACBL club — single game | ✅ | ✅ | |
| 7 | ACBL Live tournament | ⬜ | ⬜ | needs an ACBL login, real Chrome |

Seven shots outstanding.

## The five submitted to the stores

`screenshots/listing/` holds the set actually uploaded, numbered in the order a
reviewer sees them, with names that say what each is. `screenshots/listing-1280/`
is the same five at 1280×800 for Chrome, Edge and AMO; the Mac App Store takes
the masters.

| | Shot | Why it is here |
|---|---|---|
| 1 | ACBL clubs — choose a date range | The button clicked, showing the choice on offer |
| 2 | ACBL clubs — the analysis | What that produced: five events, error rates over time |
| 3 | BBO session results | The button on a third site, merged into BBO's own header |
| 4 | BBO hand viewer | The button on a single deal, integrating rather than covering |
| 5 | BBO hand viewer — the analysis | The payoff: where the contract went wrong, trick by trick |

1→2 and 4→5 are both complete stories; 3 shows breadth. Chrome caps at five, so
the pairs earn their slots and the remaining sources sit in the record set
above.

## What to capture, and how

Common to all: 1280×800 content area, other bridge extensions disabled (BBO
Helper injects into the same rows — see [store-review.md](store-review.md) § 2),
and the anonymising re-applied immediately before each shot, since none of it
survives a reload.

### 1. BBO hand viewer — `bbo-handviewer-after`

Click the button on the deal already used for `-before`; shoot the analyzer tab
that opens. The URL is in [submission-answers.md](submission-answers.md); it
carries seat names rather than real handles, so nothing needs blurring.

### 2. BBO hands list — `bbo-hands-list-after`

Click through from `-before` and shoot the analyzer. Shows `kemistry` and
`aam135` only, so no anonymising — the opponents are in the source page, not the
result.

### 3. BBO tournament view — `bbo-tview-before` / `-after`

```
https://webutil.bridgebase.com/v2/tview.php?t=30567-1785967200&u=kemistry
```

The heaviest of the set: real full names *with* state, a friends list, and
avatar photographs including a real face. Blur the Username and Player Names
columns and the avatars before shooting:

```js
document.querySelectorAll('table').forEach((t) => {
  const heads = [...t.querySelectorAll('th')].map((h) => h.textContent.trim().toLowerCase())
  const cols = heads.flatMap((h, i) => (/username|player names/.test(h) ? [i] : []))
  if (!cols.length) return
  t.querySelectorAll('tr').forEach((tr) => {
    const c = [...tr.children]
    cols.forEach((i) => c[i] && (c[i].style.filter = 'blur(6px)'))
  })
})
document.querySelectorAll('img').forEach((im) => {
  if (im.width && im.width <= 80) im.style.filter = 'blur(10px)'
})
```

Check the result before shooting — heavily redacted images read worse in a
listing than pages with less to hide, which is why this one is a record shot
rather than a listing candidate.

### 4. BBO lobby — `bbo-lobby-before` / `-after`

The history pane with the date-range menu open, and the batch result. **Needs a
BBO login, and BBO allows one session per account** — signing in signs you out
elsewhere, so do this when that does not matter. The lobby shows tournament
titles and your own handle, no opponents.

### 7. ACBL Live — `acbl-live-before` / `-after`

Needs an ACBL login, and **real Chrome** — Cloudflare blocks the Playwright
session there. Use a sized window rather than device mode, so the tab the
hand-off opens matches (device mode is per-tab; the new tab would come out
larger).

Blur Player 1 and Player 2 before shooting — on ACBL Live those cells carry
hometowns as well as names:

```js
document.querySelectorAll('table').forEach((t) => {
  const headRow = t.querySelector('thead tr') ?? t.querySelector('tr')
  if (!headRow) return
  const heads = [...headRow.children].map((c) => c.textContent)
  const cols = heads.flatMap((h, i) => (/^player\b/i.test(h.trim()) ? [i] : []))
  if (!cols.length) return
  for (const tr of t.querySelectorAll('tr')) {
    if (tr === headRow) continue
    const cells = [...tr.children]
    if (cells.length !== heads.length) continue
    for (const i of cols) if (cells[i]) cells[i].style.filter = 'blur(6px)'
  }
})
```

## Anonymising, as applied

Consistent across the set, and worth keeping consistent in anything added later:

- **Rick's own handle and name stay visible** — `kemistry`, `Rick Wilson`. So do
  partners who have agreed: `aam135`, `Andrew Rowberg`.
- **Everyone else is blurred or relabelled.** Opponents, fields, club managers.
- **Club identity is replaced, not blurred**, on the ACBL club pages: `Your
  Bridge Club`, `123 Main St, Anytown, CA, 00000`, `Manager: Chris`,
  `manager@example.com`. The club is not ours.
- **The analyzer's player and partner are relabelled** where they were third
  parties: `Alex`, `Sam`, `Jamie`.
- `example.com` and ZIP `00000` are reserved and unassigned, so neither can
  land on a real address.
