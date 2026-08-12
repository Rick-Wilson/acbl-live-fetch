# Submission answers — paste-ready

Every field the four consoles ask for, in the words to paste. The reasoning
behind each lives in [store-review.md](store-review.md); this file is only the
text, so nothing has to be rewritten at 1am with an upload half-finished.

Keep the two in step: if a justification changes here, change it there too.

---

## Store listing

**Name**

```
Bridge Classroom Fetch
```

**Short summary / subtitle** — 130 chars, inside Chrome's 132 limit

```
Send your bridge results from ACBL Live, ACBL Live for Clubs and Bridge Base Online to Bridge Classroom for analysis in one click.
```

**Description**

```
Bridge results are easy to look at and hard to learn from. This extension takes the game you are already looking at — an ACBL tournament, a club game, or a Bridge Base Online session — and sends it to Bridge Classroom, where it can be analysed properly.

Click the button on any supported results page. The extension reads that game's boards, contracts, scores and comparisons, and opens Bridge Classroom with them. No downloading files, no uploading them again.

Supported sites:
• live.acbl.org — tournament results
• my.acbl.org — club game results
• Bridge Base Online — tournament results and single deals

On Bridge Base Online it also captures the cardplay for your own table, so your play can be reviewed hand by hand. Other players' real names are deliberately not collected from BBO.

The extension only runs on those sites, only when you click it, and sends results only to Bridge Classroom. No analytics, no tracking, no accounts.

Open source and public domain:
https://github.com/bridge-craftwork/bridge-classroom-fetch
```

**Category** — Productivity (Chrome, Edge) · Other (Firefox) · Utilities (Mac App Store)

**Language** — English (United States)

**Official URL** — leave blank unless the domain is verified in the dashboard.

**Promo tiles** — both optional. The small one is worth supplying: without it
the listing looks thinner than its neighbours in a category grid. The marquee
is only used if Google features the extension editorially. Regenerate either
with `node scripts/render-promo.mjs`; the mark is lifted from `icons/icon.svg`
so they cannot drift from the icon.

**Homepage / support**

```
https://github.com/bridge-craftwork/bridge-classroom-fetch
```

**Privacy policy**

```
https://bridge-classroom.org/privacy#extension
```

---

## Single purpose

Chrome asks for one sentence. Keep it narrow — a broad answer invites the
"does more than one thing" rejection.

```
Send the bridge game results the user is currently viewing on ACBL Live, ACBL Live for Clubs or Bridge Base Online to Bridge Classroom for analysis.
```

---

## Permission justifications

One per permission. Paste verbatim — `scripting` is the one most likely to draw
a question, and the reason is specific rather than general.

**storage**

```
Holds the extracted results briefly, with a one-hour expiry, between extraction and hand-off to the Bridge Classroom page, plus the user's preferences. Nothing is transmitted anywhere else.
```

**tabs**

```
Opens the Bridge Classroom page with the extracted results, and locates an already-open results tab to read from.
```

**scripting**

```
Both ACBL sites reject requests made from the extension's background service worker with HTTP 403. The fetch is therefore issued from inside one of the user's own tabs on that site, so the site's own protections are satisfied: an authenticated session on live.acbl.org, and bot-protection clearance on my.acbl.org. No code is injected into pages beyond this same-origin fetch.
```

**Host permissions** — Chrome asks for a single justification covering all
hosts, not one per host. Paste this whole block.

```
The extension reads the user's own bridge results from the sites that publish them, and only those sites:

• live.acbl.org and my.acbl.org — the user's tournament and club game results.
• www.bridgebase.com and webutil.bridgebase.com — the user's Bridge Base Online results: the hands list, the travellers for boards they played, and the tournament summary.
• tinyurl.bridgebase.com — BBO's lobby does not hand over a deal directly. Its Export ▸ Handviewer menu mints a tinyurl.bridgebase.com short link, so the redirect has to be followed to reach the deal it points at. This host is used for nothing else.

No other origin is requested. Nothing is read until the user clicks the extension's button on one of those pages, and results are sent only to bridge-classroom.org — the analyser the user chose by clicking. There is no analytics, no telemetry and no third-party endpoint.
```

**Content script on `bridge-classroom.org` / `.com`** — no host permission is
requested for these; the content-script match is sufficient. If a field asks:

```
Delivering the extracted results to the page the user is taken to, which forwards them to whichever Bridge Classroom tool the user picks.
```

**Remote code** — answer **No**. Everything executed ships in the package;
nothing is fetched and evaluated. No `eval`, no remotely-hosted scripts, no
`<script src>` to an external origin. The one runtime dependency, linkedom, is
bundled into the package at build time.

### The in-depth review warning

Requesting host permissions triggers Chrome's warning that the extension "may
require an in-depth review which will delay publishing". This is expected and
unavoidable: reading the user's results from four sites is what the extension
does, and there is no narrower permission that would allow it. `activeTab`
would not, because the extension fetches further pages of the same site — the
board details behind a scorecard — not only the tab in front of the user.

Nothing needs changing in response to the warning. Expect a longer review than
a no-permission extension gets, and answer the justification precisely rather
than broadly — the single-purpose statement and the host justification are what
the reviewer reads.

---

## Data use

**Collected** — tick **both *Website content* and *Personally identifiable
information***.

PII is not optional here, and an earlier version of this file said to tick only
*Website content*. That was wrong. `Player` in the envelope is:

```jsonc
{ "name": "Weilong Shen", "acbl_id": "4833511", ... }
```

— a real name and a national-body identification number, transmitted off the
user's device to `bridge-classroom.org`. That is exactly what both stores mean
by *name … or identification number*. The schema says so itself: `coverage
.player_names` can be `"real"`.

The mistake was reading "collect" as "collect for ourselves" — no server, no
telemetry — when the stores mean "transmit off the device". Under-declaring PII
is the kind of thing that gets an extension pulled after the fact, so it is
worth being conservative.

Not ticked, each for a reason:

| | Why not |
|---|---|
| Health, Financial | never touched |
| Authentication | relies on the user's existing session cookies; never reads or transmits credentials |
| Personal communications | no |
| Location | no city or region field exists in the schema |
| Web history | reads the page the user is on; never enumerates visited pages |
| User activity | no clicks, scroll, keystrokes or network monitoring |

**Check this against the schema on every submission.** If `Player` ever grows a
field, or a new adapter captures something the current ones do not, this answer
changes.

**Certifications** — all three are true and can be affirmed:

- Not being sold to third parties
- Not being used or transferred for purposes unrelated to the single purpose
- Not being used or transferred to determine creditworthiness or for lending

**If a free-text field is offered**

```
The extension reads bridge game results from pages the user is already viewing — contracts, scores, comparisons, and the user's own cardplay — and sends them only to bridge-classroom.org, the analyser the user chose by clicking the button. There is no analytics, no telemetry and no third-party endpoint.

Real player names are deliberately not collected from Bridge Base Online: the tournament summary is fetched without credentials precisely so that BBO withholds identities. ACBL sources do publish real names and player numbers, and those are captured, because on a club game the user generally knows the players and the names are the point.
```

---

## Search terms (Edge)

Up to 7 terms, 30 characters each, 21 words in total across all of them. These
use 14 words; the longest is 20 characters.

```
bridge results
ACBL
BBO
Bridge Base Online
duplicate bridge
bridge hand analysis
bridge scores
```

Two acronyms because those are what bridge players actually type; the expanded
form for those who do not. `bridge` alone is deliberately absent — highest
volume, but ambiguous with dental and network bridges, and already the first
word of three other terms.

---

## Additional instructions (Chrome) — 500 char limit

497 characters. The hand viewer URL is ~900 on its own, since the deal is
encoded in it, so `demo/deal` is a self-hosted redirect to it — not a
third-party shortener, which hides its destination and reads badly beside a
justification that names every host we touch.

```
No account needed for most testing:

BBO deal: https://bridge-craftwork.github.io/bridge-classroom-fetch/demo/deal
ACBL club game: https://my.acbl.org/club-results/details/1455416

Click our button on each to extract and open the analysis. A Cloudflare check may appear on the ACBL link and clears itself.

BBO history and ACBL Live need logins we cannot share (BBO allows one session per account). Recordings, and a third test link: https://bridge-craftwork.github.io/bridge-classroom-fetch/demo/
```

The third test link is the BBO tournament summary, on the demo page. It is left
out of the box deliberately: it is the weakest of the three tests, and the one
page showing unblurred real names.

BBO can mint its own `tinyurl.bridgebase.com` links from the v3 lobby's
Export ▸ Handviewer menu — that is the mechanism the extension resolves — but
those point at deals in BBO's system, so the link would carry real opponent
handles. The test deal uses seat names on purpose.

---

## Notes for reviewers

Chrome's console has no general reviewer-notes field — its justifications are
per-permission, above. Firefox and Apple do; paste this there.

```
No account is needed to test this extension end to end. Three of the four supported sources are fully public, including a real club game with a complete field of results. The procedure below takes about a minute and exercises the whole pipeline: injection, extraction, and hand-off.

1. Open this URL — a complete bridge deal encoded in the URL itself, requiring no network request and no login:

https://www.bridgebase.com/tools/handviewer.html?bbo=y&lin=pn%7CSouth%2CWest%2CNorth%2CEast%7Cst%7C%7Cmd%7C3S789TQH5KD2C2478T%2CS2456JAH6TD57TKC6%2CS3H78JD4689JQC39J%2C%7Crh%7C%7Cah%7CBoard%201%7Csv%7Co%7Cmb%7Cp%7Cmb%7C2C%7Cmb%7C2S%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7C3H%7Cmb%7Cp%7Cmb%7C3N%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7Cp%7Cpc%7CDQ%7Cpc%7CD3%7Cpc%7CD2%7Cpc%7CDK%7Cpc%7CHT%7Cpc%7CH7%7Cpc%7CH2%7Cpc%7CHK%7Cpc%7CST%7Cpc%7CS2%7Cpc%7CS3%7Cpc%7CSK%7Cpc%7CHA%7Cpc%7CH5%7Cpc%7CH6%7Cpc%7CH8%7Cpc%7CHQ%7Cpc%7CS7%7Cpc%7CS4%7Cpc%7CHJ%7Cpc%7CH9%7Cpc%7CS8%7Cpc%7CS5%7Cpc%7CD4%7Cpc%7CH4%7Cpc%7CS9%7Cpc%7CS6%7Cpc%7CD6%7Cpc%7CH3%7Cpc%7CSQ%7Cpc%7CSJ%7Cpc%7CD8%7Cpc%7CDA%7Cpc%7CC2%7Cpc%7CD5%7Cpc%7CD9%7Cpc%7CCA%7Cpc%7CC4%7Cpc%7CC6%7Cpc%7CC3%7Cpc%7CCK%7Cpc%7CC7%7Cpc%7CD7%7Cpc%7CC9%7Cpc%7CCQ%7Cpc%7CC8%7Cpc%7CDT%7Cpc%7CCJ%7Cpc%7CC5%7Cpc%7CCT%7Cpc%7CSA%7Cpc%7CDJ%7C

2. A "Bridge Classroom" button appears in BBO's row of controls at the bottom of the page, beside Rewind / Previous / Next / Options / DD / Play, which are BBO's own.
3. Click it. A new tab opens at bridge-classroom.org showing the deal's analysis. No login is requested at any point.

Also public, needing no account:
• A real club game with a full field: https://my.acbl.org/club-results/details/1455416
• A BBO tournament summary: https://webutil.bridgebase.com/v2/tview.php?t=30567-1785967200&u=kemistry

A Cloudflare check may appear on the ACBL links. It clears by itself and is not part of the extension; if a fetch is refused the extension says so and asks you to reload.

Two further sources need a third-party login (Bridge Base Online, ACBL Live) and we cannot supply credentials. BBO permits only one active session per account, so a shared login would sign reviewers out of one another; and a newly created account has no played history for those features to read. The ACBL login is a personal membership record.

Short recordings of both authenticated paths are here:
https://bridge-craftwork.github.io/bridge-classroom-fetch/demo/

Other players' names are obscured in those recordings, for the same reason the extension does not collect them.
```

**For addons.mozilla.org, add** — paste this into the reviewer-notes field at
submission, rather than waiting to be asked. It is the difference between a
note and a round-trip:

```
Build: npm ci && BROWSER=firefox npm run build — output in dist/firefox. We have verified that this reproduces the uploaded package byte for byte from the attached source archive.

addons-linter reports two UNSAFE_VAR_ASSIGNMENT warnings for innerHTML in the bundled background chunk. Both are inside linkedom, a pure-JS DOM implementation bundled because MV3 service workers do not expose DOMParser and our HTML parsers require one (see src/background.js, which installs it on globalThis before any parser runs). linkedom is a declared dependency in package.json and is present in the source archive.

The two flagged sites are linkedom's own code:

• The first is linkedom's fragment parser: it creates a detached element and assigns to its innerHTML to turn an HTML string into nodes.
• The second is linkedom's Element class *defining the accessor itself* — `set innerHTML(t){...}`. The linter is flagging the implementation of innerHTML, not a use of it.

Neither touches a live document. The parsers run in the service worker against strings fetched from the user's own results pages, never against the DOM of a page.

Nothing in our own source assigns to innerHTML at all: `grep -rn innerHTML src/` returns no matches. We are happy to answer any question about either site.
```

If a reviewer follows up, the two coordinates in the 1.0.0 build were
`assets/background.js-*.js` line 2 col 8296 and line 7 col 443. The hash in that
filename changes with every build, so cite the line and column rather than the
name.

---

## Assets

| Field | File |
|---|---|
| Package (Chrome) | `dist/packages/bridge-classroom-fetch-1.0.0-chrome.zip` |
| Package (Edge) | `…-edge.zip` |
| Package (Firefox) | `…-firefox.zip` **and** `…-source.zip` |
| Store icon 128×128 | `icons/icon-128.png` |
| Store logo 300×300 (Edge) | `icons/icon-300.png` |
| Small promo tile 440×280 | `icons/promo-440x280.png` |
| Marquee promo tile 1400×560 | `icons/promo-1400x560.png` |
| Screenshots | `screenshots/` — 2560×1600 masters |

Downscale for Chrome, Edge and AMO, which take **1280×800**; Apple takes the
masters as they are:

```bash
mkdir -p screenshots/store-1280
for f in screenshots/*.png; do sips -z 800 1280 "$f" --out "screenshots/store-1280/$(basename $f)"; done
```

The full set is one before/after pair per injection point — a record of 1.0.0,
larger than any single listing. See [screenshot-set.md](screenshot-set.md) for
what each is and what is still to be captured.

**Suggested five for Chrome**, which caps at five: `bbo-handviewer-before`,
`acbl-club-list-menu`, `acbl-club-list-fetching`, `acbl-club-list-after`,
`bbo-hands-list-before`. That is the whole arc — button, choose a range, fetch,
result — plus a second source. Edge takes six and Apple ten, so
`acbl-club-game-before`/`-after` can be added there.
