# ACBL Live HTML Format Reference

This document captures everything we know about `live.acbl.org` HTML structure as of April 2026, gathered via DevTools recon. Update this when the site changes.

## Tech stack

ACBL Live is a server-rendered jQuery app. No JSON API to call — pages are HTML with data baked in. Heavy use of:

- jQuery + jQuery DataTables + jQuery Tablesorter
- Bootstrap (older version)
- Handlebars (client-side templating, but data is mostly server-rendered)
- Cloudflare Rocket Loader (wraps script tags, irrelevant to parsing)

The user's session cookie authenticates them automatically when the extension runs `fetch()` from within their browser context. No additional auth is needed for publicly-viewable results pages.

## URL patterns

```
https://live.acbl.org/event/{event_id}/{session_id}/{view_num}/scores/{section}/{direction}/{pair_num}
https://live.acbl.org/event/{event_id}/{session_id}/{view_num}/board-detail/{section}?board_num={n}
https://live.acbl.org/player-results/{player_id}
```

Examples:

```
Pair scorecard:  https://live.acbl.org/event/2604321/2501/2/scores/A/E/4
Board detail:    https://live.acbl.org/event/2604321/2501/2/board-detail/A?board_num=1
Player history:  https://live.acbl.org/player-results/3506177
```

The `view_num` segment (the `2` in the examples) appears to correspond to the session number within the event (Session 1 vs Session 2). Confirm by experimentation.

`direction` is `N` or `E` (for N-S pair or E-W pair). `section` is a single uppercase letter (`A`, `B`, ...).

## Board-detail page structure

### Board metadata

```html
<div class="board-data">
  <span>Dlr: N</span>
  <span>Vul: None</span>
</div>
```

Vulnerability values: `None`, `N-S`, `E-W`, `Both`.

Board number comes from URL query param `board_num`, not from the DOM (the rendered "1" next to the diagram is decorative).

### Hand diagram

Three `<div class="hand">` elements:

```html
<!-- North -->
<div class="hand">
  <span><span class="spades symbol"></span> 10 9 8 7 5</span>
  <span><span class="hearts symbol"></span> 9 2</span>
  <span><span class="diams symbol"></span> A K Q</span>
  <span><span class="clubs symbol"></span> Q 10 4</span>
</div>

<!-- West and East together -->
<div class="hand middle">
  <div class="inner-slice left">
    <!-- West hand -->
    <span><span class="spades symbol"></span> A</span>
    <span><span class="hearts symbol"></span> K 8 6 3</span>
    <span><span class="diams symbol"></span> J 9 7 4 3</span>
    <span><span class="clubs symbol"></span> K 9 5</span>
  </div>
  <div class="inner-slice right">
    <!-- East hand -->
    <span><span class="spades symbol"></span> J 4</span>
    ...
  </div>
</div>

<!-- South -->
<div class="hand">
  <span><span class="spades symbol"></span> K Q 6 3 2</span>
  ...
</div>
```

Selector strategy:

- North: first `div.hand` that doesn't have class `middle`
- South: last `div.hand` that doesn't have class `middle`
- West: `div.hand.middle div.inner-slice.left`
- East: `div.hand.middle div.inner-slice.right`

Suit identification: child `span.symbol` has one of these classes: `spades`, `hearts`, `diams`, `clubs`.

Voids are rendered as the em-dash character `—` (U+2014), e.g., `<span class="diams symbol"></span> —`.

Ranks are space-separated text following the suit span, with `10` written as `10` (not `T`).

### Results tables

Two tables, both with class `tablesorter table tablesorter-default`:

- **Table 0**: results from N-S perspective. One row per N-S pair.
- **Table 1**: results from E-W perspective. Same data, sorted/oriented differently.

For extraction, **table 0 is sufficient** — every pair's result appears there.

Header columns (in order):

| Column | Header text                  |
| ------ | ---------------------------- |
| 0      | (empty — Play button column) |
| 1      | Contract                     |
| 2      | By                           |
| 3      | Score                        |
| 4      | Matchpoints                  |
| 5      | %                            |
| 6      | Pairs                        |

#### Row structure

```html
<tr class="odd">
  <td>
    <a class="btn btn-sm btn-play" href="https://www.bridgebase.com/tools/handviewer.html?..."
      >Play</a
    >
  </td>
  <td>6<span class="spades symbol contract"></span></td>
  <td>S</td>
  <td>980</td>
  <td>14</td>
  <td>100</td>
  <td>
    10-<span class="name" data-acbl="4833511"><a href="/set-player/4833511">Weilong Shen</a></span
    >-<span class="name" data-acbl="1880438"><a href="/set-player/1880438">Vasisht Ganesh</a></span>
    <i>vs.</i>
    <br />
    6-<span class="name" data-acbl="1357719"><a href="/set-player/1357719">Arthur Mirin</a></span
    >-<span class="name" data-acbl="7844212"
      ><a href="/set-player/7844212">Padmini Sokkappa</a></span
    >
  </td>
</tr>
```

#### Contract field parsing

Three forms encountered:

- `6<span class="spades symbol contract"></span>` → `6S`
- `3NT` → `3NT`
- `4<span class="hearts symbol contract"></span>X` → `4HX` (doubled — confirm format when first encountered)

Strategy: for each cell, replace suit `<span>`s with their letter equivalent (`spades` → `S`, `hearts` → `H`, `diams` → `D`, `clubs` → `C`), then collapse whitespace. Result is a normalized contract string.

#### Score field

Plain integer. Sign convention: positive numbers are N-S scores; negative numbers in N-S column mean N-S went minus (E-W gained).

In Table 1 (E-W view), the sign convention flips. We don't need Table 1 if we always use Table 0.

#### Pairs cell

Format: `{ns_pair_num}-{ns_player1}-{ns_player2} vs. {ew_pair_num}-{ew_player1}-{ew_player2}`

Player names are wrapped in `<span class="name" data-acbl="{id}">`. The `data-acbl` attribute holds the player's ACBL number — extract this for player-tracking features.

The pair numbers (e.g., `10-...` and `6-...`) appear as bare text before the first player span. Parse via regex on cell text.

#### Play button URL (BBO handviewer)

The Play button's `href` is a BBO handviewer URL with all hands, dealer, vulnerability, and an embedded metadata block:

```
https://www.bridgebase.com/tools/handviewer.html?
  n=cq104dakqs109875h92      ← North hand
  &s=ca832d-----skq632haq104  ← South hand
  &e=cj76d108652sj4hj75       ← East hand
  &w=ck95dj9743sahk863        ← West hand
  &d=n                        ← Dealer
  &v=-                        ← Vulnerability
  &b=1                        ← Board number
  &a=pp6sppp                  ← Auction (SYNTHETIC — see note)
  &nn=Weilong Shen&sn=...     ← Player names
  &p={...}                    ← Embedded metadata block (HTML-encoded)
```

**IMPORTANT**: ACBL Live does not capture per-table auctions. The `a=` parameter contains a synthetic minimal auction reverse-engineered to land at the final contract by the correct declarer. **Do not use this for bidding analysis.** The contract and declarer extracted from the table cells are real; the auction is not.

The `p={...}` block contains URL-encoded HTML with par score, double-dummy makes, and event metadata. Useful for cross-validation.

### Double-dummy and par

Rendered as collapsible/linked elements below the hand diagram. Format:

```
Double Dummy Makes
NS: 4/5♣ 1♦ 3♥ 5♠ 5NT
EW: ♣2 ♦6 ♥3 ♠2 NT2

Par Score
+460 5NT-NS
```

Also embedded in the handviewer URL's `p={...}` parameter for redundancy. Either source works.

## Pair-scorecard page structure

(To be documented when fixture is captured. Visible columns from screenshot: Board, Contract, By, Plus, Minus, Matchpoints, %, Vs.)

Each row's Board cell is a link to that board's detail page. Use those `href`s as the authoritative list of boards-to-fetch rather than guessing board numbers.

## Player-history page structure

(To be documented when fixture is captured.)

## Known gotchas

- **Cloudflare Rocket Loader** mangles `<script>` tags but doesn't affect data we care about.
- **DataTables** may transform tables client-side, but since we're parsing fetched HTML (not the live DOM), we see the server-rendered version. Our parser sees the raw `<table>` not the DataTables-decorated version.
- **Em-dash for voids** (`—`, U+2014) — handle this case explicitly when parsing hand contents.
- **Whitespace** — the HTML has lots of irregular whitespace and indentation. Always collapse with `.replace(/\s+/g, ' ').trim()` before string comparisons.
- **`data-acbl` attribute** is sometimes missing for unregistered players. Handle gracefully.
