# BBO (Bridge Base Online) Page Format

This document describes the three BBO URL types that the `bbo` adapter uses, their HTML structure, and how the adapter maps their fields to the normalized schema.

## Entry points

The adapter accepts two entry-point URL types. Both resolve to the same extraction pipeline: parse the hands list, then fetch every board's traveller page.

| URL pattern | Adapter page type |
|---|---|
| `https://webutil.bridgebase.com/v2/tview.php?t=<id>&u=<username>` | `tournament-view` |
| `https://www.bridgebase.com/myhands/hands.php?tourney=<id>-&username=<username>` | `hands-list` |

The traveller page (`hands.php?traveller=<id>&username=<user>`) is fetched internally; the user is never expected to land there as an entry point, and no button is injected on traveller pages.

---

## 1. Tournament Summary — `tview.php`

### URL structure

```
https://webutil.bridgebase.com/v2/tview.php?t=81382-1777478400&u=kemistry
```

| Parameter | Meaning |
|---|---|
| `t` | Tournament ID: `{tournament_number}-{unix_timestamp}`. `81382` is the unique tournament number; the timestamp identifies the specific session. |
| `u` | BBO username of the viewing player. |

### Key HTML elements

```
table.bbo_t_l                 — metadata table (Title, Host, Tables, Boards rows)
  tr > td.bbo_tll + td.bbo_tlv — label/value pairs; Title row has the name

div.bbo_hero                  — user's overall result line
  span.nobreak                — "Score: 4.98 IMPs", "Rank: 32/80" etc.

div.sectionbreak              — section label, e.g. "Section 3 E/W"
div.onesection                — immediately follows sectionbreak; contains per-section ranking
  table.sectiontable
    tr.highlight              — the viewing user's row; id="row-N"
      td.username             — "user+partner", the two handles joined by "+"
      td > a                  — link to user's hands page; href contains tourney id & username
      td.score                — session score (IMP total or matchpoints total)
      td.pts                  — masterpoints earned

div.bbo_tr_o                  — overall honor (top-N) ranking table
  table > tr                  — rows with rank, username pair, score, points, stratum
    tr.highlight              — viewing user's global ranking row
```

### What this page provides (not currently fetched by the adapter)

- Human-readable tournament name
- All pair rankings with sections and directions
- User's section (e.g. "Section 3") and direction (N/S vs E/W)
- Stratum (A/B/C)

### Current limitation

The adapter derives everything it needs from the hands list page and traveller pages. The tournament summary is **not fetched** in the current implementation. This means `user_pair.section` and `user_pair.pair_number` are always `null`. Fetching `tview.php` is the natural path to populate them.

---

## 2. Hands List — `hands.php?tourney=`

### URL structure

```
https://www.bridgebase.com/myhands/hands.php?tourney=81382-1777478400-&username=kemistry
```

Note the **trailing dash** on the `tourney` parameter — this is BBO's convention that distinguishes the per-user hands list from the raw traveller page.

### Key HTML elements

```
table.body
  tr (no class)               — column headers
  tr.tourneySummary           — one row; tournament-level summary
    td.tourneyName > a        — link to tview.php; text = "#81382 ACBL Wed Noon ET..."
    td.tourneyPlace           — "32/80" (rank/field)
    td.tourneyPoints          — masterpoints earned this event
    td.tourneyScore.score     — session IMP or matchpoints total (e.g. "4.98")

  tr.tourney                  — one row per board played
    td.handnum                — board number (integer)
    td                        — time played, e.g. "09:04"
    td.north                  — North player's BBO username
    td.south                  — South player's BBO username
    td.east                   — East player's BBO username
    td.west                   — West player's BBO username
    td.result                 — result string (see §Result string format below)
    td.score / td.negscore    — raw bridge score, EW perspective
                                  .score = positive value (EW gained)
                                  .negscore = negative value (EW lost)
    td.score / td.negscore    — IMP or matchpoints comparison score for this board
    td.movie > a              — handviewer link; onclick contains the LIN string
    td.traveller > a          — link to this board's traveller page

  tr.even / tr.odd            — footer rows
    th.totals                 — "IMPs Total" or "Matchpoints Total" → scoring type
```

### Score convention

Both score cells use EW perspective: positive = EW gained. The adapter negates to produce NS perspective for `result.score`. The IMP/matchpoints comparison score is stored as-is (EW perspective: positive = EW did better than field average on that board).

### What the adapter reads from this page

| Schema field | Source |
|---|---|
| `tournament.name` | `td.tourneyName > a` text |
| `tournament.sanction` | `t` param in the tview URL from `td.tourneyName > a` href |
| `event.date` | Unix timestamp portion of tourney ID, converted to ISO date |
| `event.scoring` | `th.totals` text ("IMPs" → `"imps"`, else `"matchpoints"`) |
| `session.user_pair.players` | Username from `span.username`; partner from opposite same-direction seat in board rows |
| `session.user_pair.direction` | Which column (`.east`/`.west` vs `.north`/`.south`) the username appears in |
| `session.user_pair.session_score` | `td.tourneyScore` |
| `board[i].travellerUrl` | `td.traveller > a` href |
| `board[i].linData` | LIN string from `td.movie > a` onclick → `parseLin()` |

---

## 3. Traveller — `hands.php?traveller=`

### URL structure

```
https://www.bridgebase.com/myhands/hands.php?traveller=81382-1777478400-32138245&username=kemistry
```

The `traveller` parameter is an opaque ID (`{tourney_id}-{board_id}`) that BBO uses internally; the adapter obtains it from the `td.traveller > a` href in the hands list.

**One traveller page = one board.** For a 12-board game, the adapter fetches 12 traveller pages in parallel (concurrency = 4 by default).

### Key HTML elements

```
table.body
  tr (no class)               — column headers
    th                        — "N°", "Time", "North", "South", "East", "West",
                                 "Result", "EW Points", "Score", "Movie"

  tr.tourneySummary           — same tournament-level summary row as hands list

  tr.tourney                  — one row per table that played this board
    td.handnum                — sequential row index within this traveller (not board number)
    td                        — datetime, e.g. "2026-04-29 09:04"
    td.north                  — North player BBO username
    td.south                  — South player BBO username
    td.east                   — East player BBO username
    td.west                   — West player BBO username
    td.result                 — result string
    td.score                  — EW Points: raw bridge score, EW perspective (always .score,
                                 sign is in the numeric value; no .negscore class here)
    td.score                  — IMP/matchpoints comparison score for this table
    td.movie > a              — handviewer link; onclick contains LIN string

  tr.highlight                — the viewing user's result row (replaces tr.tourney class)
```

### Score convention (traveller)

Unlike the hands list (which uses `.negscore` for negative values), the traveller uses `.score` for all rows with the sign embedded in the text. Both are EW perspective; adapter negates for `result.score`.

### What the adapter reads from each traveller

| Schema field | Source |
|---|---|
| `board.results[]` | All `tr.tourney` and `tr.highlight` rows |
| `board.user_result_index` | 0-based index of `tr.highlight` row |
| `result.score` | First `.score` cell value × −1 (convert EW → NS perspective) |
| `result.imps` or `result.matchpoints` | Second `.score` cell value (EW perspective, positive = EW outperformed field) |
| `result.ns_pair.players` | `.north` and `.south` cell text |
| `result.ew_pair.players` | `.east` and `.west` cell text |
| `result.contract`, `.declarer`, `.tricks` | Parsed from result string |
| `result.handviewer_url` | `td.movie > a` href |

---

## 4. Result string format

BBO renders result strings like `3NW+2`, `4♥S+3`, `6♠E+1`, `1NW-1` directly in result cells. After `DOMParser` processes the page, HTML entities become Unicode:

| BBO renders | DOMParser textContent |
|---|---|
| `&hearts;` | ♥ (U+2665) |
| `&diams;` | ♦ (U+2666) |
| `&spades;` | ♠ (U+2660) |
| `&clubs;` | ♣ (U+2663) |
| `N` | N (used for NT, no entity) |

### Parsing

Pattern: `{level}{strain}{double?}{declarer}{result}`

| Token | Values | Notes |
|---|---|---|
| `level` | 1–7 | |
| `strain` | N / ♠ ♥ ♦ ♣ / S H D C | N → NT; symbols map to S H D C |
| `double` | x / xx (optional) | case-insensitive; normalize to X / XX |
| `declarer` | N E S W | |
| `result` | = / +N / −N | `=` = made exactly; `+N` = N overtricks; `−N` = down N |

Tricks taken = `level + 6 + overtricks` (overtricks negative for undertricks).

---

## 5. LIN format

BBO's `hv_popuplin()` onclick attribute contains a URL-encoded LIN string with the full hand record. After URL-decoding, LIN is a flat sequence of `key|value|` pairs (keys can repeat):

```
pn|south,west,north,east|st||md|{dealer}{S_hand},{W_hand},{N_hand},{E_hand}|rh||ah|Board N|sv|{vul}|mb|p|mb|2C|an|Strong|mb|2D|...|pc|DQ|pc|D3|...|mc|11|
```

### Key tokens

| Token | Meaning |
|---|---|
| `pn` | Player names: South, West, North, East (comma-separated) |
| `md` | Deal: first char = dealer (1=S 2=W 3=N 4=E); then `S_hand,W_hand,N_hand,E_hand` |
| `sv` | Vulnerability: `o`=None, `n`=NS, `e`=EW, `b`=Both |
| `mb` | Bid: `p`=PASS, `x`=X (double), `r`=XX (redouble), else level+strain (e.g. `1N` = 1NT) |
| `an` | Alert annotation for the preceding `mb` token (ignored for auction array) |
| `pc` | Card played: `{suit}{rank}` (e.g. `DQ`=diamond queen, `HT`=heart ten) |
| `mc` | Tricks made (total, 0–13): present when play is complete |
| `rh` | Reset hand (always empty, ignored) |
| `st` | Start (always empty, ignored) |
| `ah` | Board annotation, e.g. "Board 1" (ignored; board number comes from the hands list) |

### Hand encoding in `md|`

```
md|3S789TQH5KD2C2478T,S2456JAH6TD57TKC6,S3H78JD4689JQC39J,|
     ^ dealer=N
      ^ South hand         ^ West hand         ^ North hand   ^ East (empty = compute remainder)
```

Each hand is `S{spades}H{hearts}D{diamonds}C{clubs}` with ranks A K Q J T 9 8 7 6 5 4 3 2. `T` = ten. East's hand is omitted when all 52 cards are accounted for by S/W/N; the adapter computes it from the remaining cards.

### Robot players

BBO's GiB robots appear as `GiB` in the `.north/.south/.east/.west` cells but as `~~M{id}` codes in the LIN `pn|` token. The adapter uses the DOM cell names (human-readable) rather than the LIN player names.

---

## 6. Fetch plan

For a game with N boards:

| Phase | Fetches | Concurrency |
|---|---|---|
| 1. Hands list | 1 | — |
| 2. Travellers | N | 4 (configurable) |
| **Total** | **N + 1** | |

For a 12-board game: **13 fetches**. All travellers are fetched in a single parallel batch after the hands list is parsed.

Authentication is handled by the user's existing BBO session cookie, which the extension's service worker includes automatically via `credentials: 'include'` fetch semantics.

---

## 7. Known limitations

- **`user_pair.section` is null** — the section label (e.g. "Section 3 E/W") lives only on `tview.php`, which is not currently fetched.
- **`user_pair.pair_number` is null** — BBO does not expose pair numbers on traveller or hands-list pages.
- **`double_dummy` is null** — BBO does not provide DD analysis in page HTML. An external computation service would be required.
- **`par` is `[]`** — same reason as double dummy.
- **`event.event_type` is `"open_pairs"`** — BBO page HTML does not expose the event type; this is a hardcoded default.
- **Robot players** — GiB and other robot players have BBO usernames like `GiB`; their `acbl_id` is always `null`.
- **`result.auction` and `result.play`** — populated only for the user's own result row (from the hands list LIN). All other result rows have `null` for these fields.
