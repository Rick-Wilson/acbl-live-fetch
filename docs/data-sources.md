# Data Sources and Acquisition Methods

What this project reads, from where, by what mechanism, and under what
authentication. Written because the *how* is unusually load-bearing here: three
different sites each broke a naive `fetch()` in a different way, and the
workarounds are not obvious from reading the adapters alone.

For what the data means once captured, see
[normalized-schema.md](normalized-schema.md); each envelope declares its own
`coverage`, and this document explains why those values are what they are.

---

## 1. Summary

| Source | Host | Auth | Mechanism |
|---|---|---|---|
| ACBL Live tournaments | `live.acbl.org` | Session cookie | **Fetch inside a same-origin tab** |
| ACBL club games | `my.acbl.org` | Session cookie | **Fetch inside a same-origin tab** |
| BBO hands list | `www.bridgebase.com/myhands/` | Session cookie | Service-worker fetch, `credentials: 'include'` |
| BBO traveller | `www.bridgebase.com/myhands/` | Session cookie | Service-worker fetch, `credentials: 'include'` |
| BBO tournament summary | `webutil.bridgebase.com/v2/tview.php` | **None, deliberately** | Service-worker fetch, `credentials: 'omit'` |
| BBO event listing | `www.bridgebase.com/myhands/` | Session cookie | **Off-screen minimized popup window** |
| BBO replay LIN | `www.bridgebase.com/myhands/fetchlin.php` | None | **CLI, outside the browser** |

---

## 2. Acquisition mechanisms

### 2.1 Direct service-worker fetch

The default. Used for both authenticated BBO pages, with
`credentials: 'include'` so the browser attaches its stored BBO cookies;
`host_permissions` allows this cross-origin.

### 2.2 Anonymous service-worker fetch

`credentials: 'omit'` — used for exactly one thing, BBO's tournament summary,
and the omission is the point. See [§ 3.3](#33-bbo-tournament-summary).

### 2.3 Fetch inside a same-origin tab

Both ACBL properties reject direct service-worker fetches with **HTTP 403**,
even with `credentials: 'include'` and `host_permissions` granted. The service
worker is a *cross-site* context, so Chrome withholds `SameSite=Lax` cookies —
and ACBL's 2026 auth change made those cookies mandatory (`my.acbl.org` in May,
`live.acbl.org` in June).

The fix is to run the fetch from inside a tab that is already same-site:

```
chrome.scripting.executeScript({ target: {tabId}, world: 'MAIN',
  func: (u) => fetch(u, { credentials: 'include' }).then(...) })
```

Tab selection is not blind. `pickInjectableTab()` ranks candidates because
`tabs[0]` frequently isn't scriptable — it may be discarded by Chrome's memory
saver, mid-navigation, or sitting on a login page, and `executeScript` then
fails with "Cannot access contents of the page" while a perfectly good tab is
open elsewhere. Ranking prefers the tab the user is looking at, still loaded,
and finished loading.

If no usable tab exists, a temporary window is opened and closed afterwards
(see below). Reusing an open tab is preferred: no flicker, no extra page load.

### 2.4 Off-screen minimized popup window

Used when a page must be *rendered* rather than merely fetched — the BBO event
listing, and as the fallback for §2.3.

```js
browser.windows.create({ url, type: 'popup', focused: false,
  state: 'minimized', top: -2000, left: -2000, width: 200, height: 200 })
```

Both minimized *and* off-screen, because BBO's redirect chain (timezone →
`hands.php` → possibly login) navigates several times and can unminimize the
window on some platforms. A `state: 'minimized'` rejection falls back to a plain
minimized window. The window closes itself once parsing finishes.

### 2.5 Content scripts

Injected UI and in-page parsing, not a fetch mechanism as such:

| Script | Runs on | Job |
|---|---|---|
| `sourceContent.js` | ACBL + BBO result pages | Injects the "Analyze" button |
| `bboLobbyContent.js` | `bridgebase.com/v3/*` | Injects history UI; drives batch and dev bulk export |
| `analyzerContent.js` | `bridge-classroom.{org,com}/game-analysis/*` | Hands the envelope to the analyzer SPA |
| `ingestContent.js` | `bridge-classroom.{org,com}/*` | Hands the envelope to `/ingest` (see [ingest-protocol.md](ingest-protocol.md)) |

The SPA-heavy pages need a `MutationObserver` to re-inject the button, since
navigation destroys it without a page load.

### 2.6 Command-line fetch, outside the browser

`tools/fetch-replays.js` fetches replay LINs directly. It lives outside the
extension because that endpoint needs no authentication and the volume is far
too large for a browser session — see [§ 3.5](#35-bbo-replay-lin).

---

## 3. Per-source detail

### 3.1 ACBL Live tournaments — `live.acbl.org`

**Mechanism:** tab-routed fetch (§2.3). **Concurrency 16**, no delay.

Entry point is a pair scorecard or a `/summary` page. From there:

1. Fetch the initial scorecard.
2. Fetch sibling session scorecards from the session dropdown.
3. Follow the user across sessions — pair numbers change between sessions, so
   the user is re-located in each session's `pair_directory`.
4. Build a fetch plan of **session × section × board**. Every section is
   covered: `uniqueSections()` reads them from the pair directory, since a
   board-detail page shows only one section.
5. Fetch and parse on the fly, overlapping parse with network.

**Yields:** contracts, results, scores, matchpoints/IMPs, strat ranks,
masterpoint awards, real player names, ACBL player IDs, double-dummy data,
section labels.

**No cardplay and no auction.** ACBL Live publishes neither. The auction inside
the BBO handviewer links on board-detail pages is **synthetic — not the auction
played** — and is deliberately not extracted.

### 3.2 ACBL club games — `my.acbl.org`

**Mechanism:** tab-routed fetch (§2.3). Single page fetch.

The page embeds a `<result-details>` element whose attribute carries the entire
game as JSON; there is no per-board fetching. Handles Howell movements, missing
pairs, `#`-prefixed IDs, and normalises player names across scoring software
(RSVP Bridge titles, middle initials, `Last, First` ordering).

**Yields:** as above, all sections, real names. No cardplay, no auction.

### 3.3 BBO tournament summary — `tview.php`

**Mechanism:** service-worker fetch with **`credentials: 'omit'`**.

The only BBO page carrying section identity, and the only reliable source of the
event name — the hands list carries the name on a minority of events (26 of 264
in one real capture), while this page states it every time.

**The anonymous fetch is a privacy decision, not a limitation.** Authenticated,
this page shows real player names for the whole field. Anonymous, BBO withholds
names but still returns sections, directions, strat ranks and masterpoint
awards. Fetching it without cookies therefore yields everything wanted and no
opponents' personal information. A test asserts `credentials: 'omit'` here while
the hands list and travellers keep `'include'` — collapsing the two fetch
wrappers would silently start collecting names.

The viewing player is identified from the username already in hand, **not** from
BBO's `highlight` row class, which is also applied to friends' rows.

**Yields:** event title, table count, sections, directions, strat ranks,
masterpoint awards, pseudonymous usernames.

### 3.4 BBO hands list and travellers — `myhands/`

**Mechanism:** service-worker fetch, `credentials: 'include'`.
**Concurrency 2, 200 ms apart** — at concurrency 4 BBO returns its
timezone-redirect page instead of game HTML for most requests, so failures are
detected by shape and retried sequentially with a longer delay.

- **Hands list** (`hands.php?tourney=<id>-&username=<user>`) — the user's own
  boards, with the full LIN for **their table only** embedded in an `onclick`
  attribute. Cardplay costs no extra fetch.
- **Traveller** (`hands.php?traveller=<id>&username=<user>`) — one per board,
  carrying **one row per table across the entire event**. Verified against
  `tview.php`: a 4-section, 54-table event yields 54 rows on a board. Travellers
  are field-wide, not section-scoped, but carry no section marker.

**Yields:** every table's contract, declarer, tricks, score and MP/IMP
comparison; the user's own auction and cardplay; BBO usernames.

### 3.5 BBO replay LIN — `fetchlin.php`

**Mechanism:** command-line fetch (§2.6). **No authentication.**

Every traveller row carries `handviewer_url` containing
`myhand=M-<handId>-<timestamp>`, whose two components are exactly this
endpoint's parameters — so no discovery step is needed. It returns the full LIN
for any table's play: real auction and all 52 cards.

**Rate limited far more tightly than anything else here:** roughly 0.5 req/s.
Measured — 8 concurrent requests and 1 s spacing both drew HTTP 429 within a
handful of requests; 2 s spacing sustained 150 consecutive requests with none
refused. The limiter answers with a 117-byte HTML page, so responses are
validated by *shape*, not status code, or the error would be stored as though it
were cardplay.

At that rate a full history is a multi-day job, which is why it runs detached
with a resumable journal rather than in the browser.

### 3.6 BBO event listing — `bridgebase.com/v3/*`

**Mechanism:** off-screen minimized popup window (§2.4), driven by
`bboLobbyContent.js`.

BBO caps a listing query at roughly a 30-day range, so multi-year history is
collected in **28-day chunks, newest first**. Between batch items: **250 ms** for
BBO hosts, **1 s** for ACBL hosts, which need more breathing room.

---

## 4. Authentication summary

| Needs a logged-in session | Works anonymously |
|---|---|
| `live.acbl.org` (403 without) | `webutil.bridgebase.com/v2/tview.php` |
| `my.acbl.org` (403 without) | `www.bridgebase.com/myhands/fetchlin.php` |
| `bridgebase.com/myhands/hands.php` (302 to login) | |

The split is what makes the replay backfill practical: the extension does the
~3,660 session-bound fetches for a 264-event history in about 20 minutes, and a
CLI does the ~152,000 public ones over days, with no cookies and no browser.

Note the asymmetry within BBO itself. The *content* of a traveller is not
private — it is the whole field's results — but it sits behind `/myhands/` and
redirects without a session. So the field cannot be enumerated without the
user's login, even though every replay it points to is then freely fetchable.

---

## 5. What is deliberately not collected

- **Opponents' real names from BBO.** Available when authenticated; not
  collected, by fetching the summary anonymously (§3.3).
- **BBO handviewer auctions on ACBL Live pages.** Synthetic, not the auction
  played. Extracting them would produce plausible, wrong analysis.
- **Other tables' cardplay during extraction.** Reachable only at ~0.5 req/s, so
  it belongs in the CLI backfill rather than an interactive fetch.
