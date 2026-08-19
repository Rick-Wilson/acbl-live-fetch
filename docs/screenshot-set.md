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
| 7 | ACBL Live tournament | ⬜ | ⬜ | needs an ACBL login, real Chrome; **four shots**, see § 7 |

Seven shots outstanding, and #7 is the one that matters — see below.

**#7 is the gap worth closing, and 1.1.0 widened it.** ACBL Live has never been
photographed at all, and it is now where the newest and most visible work sits:
one `Analyze in Bridge Classroom` link per row on `/my-results`,
`/player-results/<id>` and `/events/<sanction>`, a searchable pair picker, and a
percentage that climbs while an event is fetched. None of that appears in any
image. The submitted five are ACBL *clubs* and BBO — accurate, and untouched by
the ACBL Live work, but silent about it.

Apple takes ten screenshots against Chrome's five, so the Mac App Store listing
has room for the whole ACBL Live arc without displacing anything. That is why it
is being captured before the Apple submission rather than after.

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

**These five stay as they are for 1.1.0.** They were checked against the ACBL
Live changes rather than assumed stale: every one is ACBL *clubs* or BBO, and
shot 1's date-range picker is the club batch on `my.acbl.org`, which was
deliberately kept. Nothing in them shows behaviour that was removed.

### The Apple set — nine

Apple takes ten, so the Mac App Store listing runs the five above **plus the
four ACBL Live shots** from § 7, in the order a user meets them: the results
list, the picker, the fetch, the analysis. Same masters, no downscale — Apple
takes 2560×1600 as shot.

That leaves Chrome, Edge and AMO on the five they already have. Edge's sixth
slot and a later Chrome update can take 7a, the per-row links, which is the
single most representative of the four.

## Apple's screenshot specifications

Read off [Apple's own screenshot specifications][spec] in August 2026, not from
memory — two earlier guesses in this project about Apple's version matrices were
wrong, and the same care applies here.

[spec]: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/

### The three sets Apple wants

| Platform | Size to supply | Pixels | Why this one |
|---|---|---|---|
| **Mac** | any 16:10 | **2560 × 1600** | One of four accepted 16:10 sizes; our masters already are this |
| **iPad** | 13-inch | **2064 × 2752** portrait, **2752 × 2064** landscape | The single required iPad set; Apple scales it to the smaller iPad classes |
| **iPhone** | 6.9-inch | **1320 × 2868** portrait (or 1290 × 2796, or 1260 × 2736) | Required *because the app claims iPhone support* — see below |

**1–10 images per set**, `.png` / `.jpg` / `.jpeg`.

**No alpha channel.** Apple rejects screenshots carrying one, and four of our
five Mac masters had an opaque alpha channel — harmless everywhere else, fatal
at App Store Connect. They were stripped with `magick -alpha off`, verified at
zero pixel difference first, so the images are unchanged and now upload-safe.
Anything captured from Chrome DevTools is likely to carry one; check before
uploading:

```bash
for f in screenshots/listing/*.png; do
  printf "%-46s " "$(basename "$f")"; sips -g hasAlpha "$f" | tail -1
done
```

### The iPhone set — decided, and iPhone is in

`TARGETED_DEVICE_FAMILY = "1,2"`: the app claims iPhone as well as iPad, so
Apple requires a 6.9-inch iPhone set. **That was briefly an open question and is
now closed — iPhone is supported.**

It was worth asking, because the extension had never been run on a phone: the
11 August testing was on an iPad, and two of the four supported sites are wide
results tables. Shipping an untested phone layout is how a listing earns its
first one-star review. So it was tested rather than assumed.

**Confirmed on a real iPhone, iOS 26.6, 18 August 2026.** On a `my.acbl.org`
club results page the button injects into the site's own navbar and the hand-off
runs, at a 440 px viewport. Nothing needed redesigning, and the reason is
structural rather than lucky: the extension adds one button to chrome the site
already lays out responsively, so it inherits whatever the site does about
narrow screens.

The other paths are **untested on iPhone** — the BBO hand viewer and ACBL Live
tournaments. Nothing suggests they differ; it is the same injection code against
the same anchors. Say untested rather than claiming a sweep that did not happen.

## iOS — what to actually shoot, on both devices

Safari ships to the App Store as **two platforms on one record**, macOS and iOS,
and the iOS half covers iPad *and* iPhone. Safari is the only browser engine on
either, so this is the only route to those users at all.

**Two sets, not one** — 2064 × 2752 for the 13-inch iPad, 1320 × 2868 for the
6.9-inch iPhone. Apple scales within a device class but not across one, so an
iPad set cannot stand in for iPhone.

Shoot the same story on both, so the listing reads consistently.

- Capture on the **real iPad** or in the Simulator, at 2064 × 2752 (or the
  landscape transpose). The 2560×1600 Mac masters do not qualify — wrong
  aspect, wrong class.
- **Shoot the club game first.** No account, most representative, and the one an
  Apple reviewer can reproduce.
- The extension behaves the same there as in Chrome — that was the 11 August
  finding — so nothing needs designing, only photographing.
- **`openTempTab`'s off-screen window never runs on iPad**, so do not go looking
  for it. `fetchViaTab` prefers an already-open same-origin tab, and on iPad the
  user is standing on it.
- Worth shooting: BBO hand viewer, ACBL Live for Clubs, ACBL Live tournaments
  (pair events). Not worth shooting: the BBO hands list and lobby — those users
  are in the BBO app, whose web page has a different DOM entirely.

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

### 7. ACBL Live — four shots, not one

Needs an ACBL login, and **real Chrome** — Cloudflare blocks the Playwright
session there. Use a sized window rather than device mode, so the tab the
hand-off opens matches (device mode is per-tab; the new tab would come out
larger).

**Budget the sign-in before starting.** `live.acbl.org` allows roughly 110
requests under `/event/*` per sign-in and an event costs 27–55, so there are two
or three extractions in a session — see [acbl-rate-limit.md](acbl-rate-limit.md).
Two of the four shots below fetch nothing at all, so shoot in this order and the
allowance is never the reason a shot is missed. If a `Fetching…` link stops and
a red band appears under the row, that is the allowance, not a bug: sign out,
sign back in, resume.

| | Shot | Page | Fetches? |
|---|---|---|---|
| 7a | `acbl-live-results-list-before` | `/my-results` | no |
| 7b | `acbl-live-pair-picker` | `/events/<sanction>` | one summary page |
| 7c | `acbl-live-results-list-fetching` | `/my-results` | **yes — a whole event** |
| 7d | `acbl-live-after` | the analyzer tab 7c opened | no |

**7a — the per-row links.** `https://live.acbl.org/my-results`, signed in. Every
row's Links column ends `… | Analyze in Bridge Classroom`. This is the shot the
set has never had: it is where the extension actually starts for a tournament
player, and it replaced the date-range batch that shot 1 still shows for clubs.
Team-event rows deliberately have no link — if the visible rows are all teams,
scroll to a pairs event rather than shooting a screen of rows with nothing on
them.

**7b — the picker.** Must be a tournament's event list,
`https://live.acbl.org/events/<sanction>` — **not** `/my-results`. The picker
appears only when the page names nobody: `/my-results` and
`/player-results/<id>` head themselves "Rick Wilson's Results", the extension
reads the name out of the `h1` and goes straight to fetching, so no picker is
ever drawn there. An event list is headed by the host city instead, so it has to
ask. Click a row's link, wait for `Loading pairs…` to resolve, and shoot with
the picker open under the row. Type two or three letters into "Type any part of
a name…" first — a filtered list of three shows what the box is *for*, where a
full list of thirty just looks long, and it also cuts how many real names are on
screen to blur.

**7c — mid-fetch.** Back on `/my-results`, click a row and shoot while the link
reads `Fetching… 41%`. Wait for a two-digit percentage: the label starts at
`Fetching…` with no number and a shot of that says nothing a static page could
not. This is the one shot that spends the allowance.

**7d — the payoff.** The analyzer tab 7c opens. Relabel the player and partner
if they are not Rick and a partner who has agreed (see *Anonymising* below).

Blur Player 1 and Player 2 before shooting each of 7a–7c — on ACBL Live those
cells carry hometowns as well as names, and the picker rows carry pair names
too. The snippet below covers the tables; for the picker, blur its rows as well:

```js
document.querySelectorAll('#bridge-classroom-pair-picker button span:first-child')
  .forEach((s) => (s.style.filter = 'blur(6px)'))
```

Leave the section-and-direction column (`A-EW4`) sharp — it is the whole point
of that line, and it identifies nobody.

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
