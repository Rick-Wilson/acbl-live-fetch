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

**Host: `live.acbl.org`, `my.acbl.org`**

```
Reading the user's own tournament and club game results, which is the purpose of the extension.
```

**Host: `www.bridgebase.com`, `webutil.bridgebase.com`**

```
Reading the user's own Bridge Base Online results — the hands list, travellers and tournament summary for sessions the user played.
```

**Host: `tinyurl.bridgebase.com`**

```
BBO's lobby does not hand over a deal directly: its Export ▸ Handviewer menu mints a tinyurl.bridgebase.com short link, so the redirect must be followed to reach the deal it points at. Used only to resolve those links.
```

**Content script on `bridge-classroom.org` / `.com`**

```
Delivering the results to the page the user is taken to, which forwards them to whichever Bridge Classroom tool the user picks. No host permission is requested for these domains; the content-script match is sufficient.
```

**Remote code** — answer **No**. Everything executed ships in the package;
nothing is fetched and evaluated.

---

## Data use

**Collected** — tick only *Website content*.

Not: personally identifiable information, health, financial, authentication,
personal communications, location, web history, or user activity.

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

**For addons.mozilla.org, add:**

```
Build: npm ci && BROWSER=firefox npm run build — output in dist/firefox.

addons-linter reports two UNSAFE_VAR_ASSIGNMENT warnings for innerHTML in the bundled background chunk. Both are inside linkedom, a pure-JS DOM implementation we bundle because MV3 service workers do not expose DOMParser and the HTML parsers require one. Nothing in our own source assigns to innerHTML: `grep -rn innerHTML src/` returns nothing.
```

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
| Screenshots, Chrome/Edge/AMO | `screenshots/store-1280/` — **1280×800** |
| Screenshots, Mac App Store | `screenshots/` — 2560×1600 |

**The five to submit**, in order: `01-handviewer-after`, `02-club-event-list-menu`,
`03-fetching-progress`, `04-analysis-batch`, `05-bbo-hands-list`. Chrome caps at
five; Edge takes six and Apple ten, so `02alt` or `04alt` can be added there.
