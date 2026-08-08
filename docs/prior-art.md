# Prior Art — other BBO/results extensions

Notes from reading three installed Chrome extensions that overlap with this
project, to see whether they use techniques worth adopting. Behavioural
observations only, from their shipped code; nothing here is copied, and all
three are presumably licensed.

Versions read: BBO Extractor 1.4.12, BBO Helper 1.5.4, Bridge Solver 1.42
(August 2026).

---

## 1. What each does

### BBO Extractor 1.4.12

MV3. Permissions: `webNavigation`, `scripting`, `cookies`, `notifications`,
`storage`. Hosts: bridgebase + webutil + `file:///*`.

**Acquisition:** opens a real tab per target URL (`chrome.tabs.create`), lets a
content script parse the live DOM, messages results back, then closes the tab.
No worker-side fetching of HTML at all.

**Cardplay:** reads LIN from the same `hv_popuplin` onclick attribute we do —
the user's own table.

**Double-dummy:** uploads to `dds.bridgewebs.com/bboextractor/calldd.php`;
CSV export via `echocsv.php`.

**Notable:** ships the `cookies` permission, but its only use —
`chrome.cookies.remove()` on BBO's `SRV` and `PHPSESSID` — is **commented out**.
Someone tried clearing the session and abandoned it.

### BBO Helper 1.5.4

MV3. `unlimitedStorage`. Content scripts on `hands.php`, traveller,
`handviewer.html`, `v3/*`, `tview.php`, and EBU's NGS search.

**Acquisition:** the technically distinctive one. Injects into BBO's own page
context at `document_start` and **subclasses `WebSocket` and wraps
`XMLHttpRequest`** to observe live client-server traffic, tracking application
state as you play. Comments credit a WebSocket-sniffer extension as the basis.

**Also carries player databases:** EBU NGS, WBF, and a cheating "rap sheet".

Its `tview.js` reads `sectiontable` and masterpoints — the same page and
structure our own tournament-summary parser uses.

### Bridge Solver 1.42

MV3. Permissions: `scripting`, `contextMenus`, `webNavigation`, `downloads`,
`storage`, `tabs`. Hosts: **16 results sites**, including `live.acbl.org`,
`my.acbl.org`, RealBridge (`kibitz.realbridge.online`), LoveBridge, WBF,
Bridgewebs, Pianola, EBU, ECats, SimPairs, TheCommonGame.

**Acquisition:** not a results extractor. It injects a *generic* hand-finder into
**every frame** of a page (`chrome.webNavigation.getAllFrames`) and reports any
deal it finds. There are no per-site parsers — the breadth comes from a
site-agnostic DOM search plus a wide host list.

**Cardplay:** it does analyse cardplay, card by card — but does **not** bulk
fetch other tables. Its one `fetchlin.php` reference is a page-type test ("does
this page contain LIN links?"), not an enumeration. The cardplay analysed is
whatever replay the user has navigated to.

**Double-dummy:** server-side at
`dds.bridgewebs.com/bridgesolver/invoke_bsol.php`. It also hooks the downloads
API: a downloaded LIN/PBN is fetched and POSTed to the solver.

---

## 2. Techniques worth adopting

**All-frames injection.** Bridge Solver's `getAllFrames` pattern matters as soon
as club sites that embed results in an iframe are supported — Bridgewebs and
Pianola both do. Our content scripts see only the top frame today.

**Tab-navigate-and-parse as a heavy fallback.** BBO Extractor and Bridge Solver
never fetch HTML from the worker; they navigate and read the DOM. Far slower,
but immune to the 403/302/redirect problems documented in
[data-sources.md](data-sources.md). We already use a lighter variant for ACBL —
`executeScript` inside an *existing* same-origin tab — but the full version is
the fallback if BBO ever blocks worker fetches outright.

**Identity resolution, conceptually.** BBO Helper resolves BBO usernames against
EBU and WBF datasets. That is precisely the problem blocking cross-source player
calibration here. Those are third-party datasets with their own terms, so this
is a pointer to the approach, not the data.

---

## 3. Techniques deliberately not adopted

**Cookie manipulation.** BBO Extractor's own commented-out code is the evidence
against it.

**External double-dummy services.** Both BBO Extractor and Bridge Solver upload
hands to `dds.bridgewebs.com`. This project solves locally, and shipping deals to
a third party sits badly against the decision to keep opponents' names out of
the archive (see `coverage.player_names` in
[normalized-schema.md](normalized-schema.md)).

**WebSocket/XHR interception.** Clever, but aimed at observing *live* play. For
post-game archives it adds a fragile main-world injection that breaks whenever
BBO changes its client, and buys nothing that can't be fetched afterwards.

---

## 4. Where this project differs

**Bulk replay fetching.** None of the three enumerates other tables' replays.
BBO Extractor and BBO Helper stop at the user's own table; Bridge Solver
analyses one replay at a time, whichever the user navigated to, and steps
through it card by card. `tools/fetch-replays.js` enumerating every table's
`myhand` ID and fetching the field's cardplay in bulk appears to be new among
these three — which is also why the display problem is worth solving: the
existing tools make you click through replays one at a time.

**Normalized archive.** These are analysis aids that act on the page in front of
you. This project's output is a durable, versioned envelope for multiple
downstream consumers.

**Local-first double-dummy.** Both others depend on a single third-party solver
endpoint.

---

## 5. Correction worth recording

An earlier pass through this concluded that *none* of the three touched
cardplay. That was wrong twice over: the `fetchlin` grep was run against BBO
Helper's directory and the result generalised to all three, and "doesn't bulk
fetch other tables" was stated as "doesn't fetch cardplay". Bridge Solver does
analyse cardplay card by card; what it doesn't do is enumerate the field.
