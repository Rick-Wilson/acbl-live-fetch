# Normalized Schema

Every adapter emits this JSON schema regardless of source. The downstream analyzer (bridge-classroom.com Game Analysis tool) consumes this format.

## Top-level

```jsonc
{
  "schema_version": "1.4",
  "source": "acbl-live",          // "acbl-live" | "club-game-bws" | "bbo" | ...

  // Who produced this envelope. Present so a consumer can tell extension
  // output from a results site exporting directly from its own server.
  "provider": {
    "id": "bridge-classroom-fetch",
    "version": "1.0.0",
    "kind": "browser-extension"   // "browser-extension" | "server" | "manual"
  },

  // Who and what this envelope is about. Free text, plus whatever identifies
  // the subject. Optional — omitted when the caller supplies nothing and the
  // adapter cannot infer it.
  //
  // `players` and `pair` are the machine-readable form of `context`. The same
  // names are in every session's `user_pair`, but a consumer should not have to
  // walk tournaments -> events -> sessions to learn whose results these are:
  // after choosing a pair from ACBL Live's picker, an analyzer was still asking
  // which player to analyse, because nothing said so at the top.
  //
  // Adapters derive these from the pair they actually resolved, so they cannot
  // drift from `user_pair`. Both are absent when no user was identified — an
  // event-wide extraction names nobody, and must not appear to.
  "capture": {
    "context": "Rick Wilson & Arthur Mirin (A-NS2)",
    "players": ["Rick Wilson", "Arthur Mirin"],
    "pair": "A-NS2",
    "subject": { "acbl": ["3506177", "1357719"] }
  },

  // What this data covers, declared rather than left to be re-derived by
  // scanning. See § Coverage.
  "coverage": {
    "cardplay": "user-table",     // none | lead | user-table | all-tables
    "auction": "user-table",      // none | user-table | all-tables
    "results": "all-tables",      // user-table | section | all-tables
    "sections": "all",            // all | user-only | not-applicable
    "player_names": "usernames",  // none | usernames | real
    "sections_labelled": false    // is section identity known for pairs?
  },
  "fetched_at": "2026-04-26T18:30:00Z",
  "source_url": "https://liveresults.acbl.org/...",  // URL scraped from; omitted for file uploads
  "tournaments": [Tournament, ...]
}
```

The `tournaments` array is a top-level container designed to accommodate three kinds of extractions without further schema changes:

- **v1 — single event with all its sessions** (today). The user clicks "Analyze" on a pair scorecard. We emit one tournament containing one event containing one or more sessions.
- **v2 — whole tournament** (future). Multiple events under one sanction, fetched from the tournament's schedule page.
- **v3 — player history** (future). Multiple tournaments fetched from a player's history page.

In every case the structure is the same nested tree; the only difference is the count of children at each level.

## Tournament

```jsonc
{
  "sanction": "2604321",          // ACBL sanction number — the canonical tournament identifier
  "schedule_url": "https://tournaments.acbl.org/schedule.php?sanction=2604321",
  "name": "Palo Alto Bridge Sectional",   // human-readable tournament name; null if not extractable
  "events": [Event, ...]
}
```

`sanction` is ACBL's official term for a sanctioned tournament (a unique number assigned by ACBL). The `schedule_url` is the canonical page listing all events held under that sanction.

## Event

```jsonc
{
  "event_id": "2501",             // identifier of one event within the tournament
  "event_type": "open_pairs",     // "open_pairs" | "swiss_teams" | "knockout" | ...
  "name": "Wednesday Afternoon Pairs", // optional human-readable label; null/absent if not available
  "date": "2026-04-25",           // event date (ISO YYYY-MM-DD)
  "scoring": "matchpoints",       // "matchpoints" | "imps" | "btw" | ...
  "sessions": [Session, ...]
}
```

`event_id` is unique within the tournament (sanction). One event has one or more sessions. `name` is optional — for ACBL Live tournament data the human-readable label lives on the tournament; for club games (single-event, no real "tournament" wrapper) the descriptive name lives on the event. Analyzers should fall back: `event.name` → `tournament.name` → `event.date`.

## Session

```jsonc
{
  "session_number": 2,            // 1-based; unique within the event
  "time": "14:30",                // 24-hour local start time
  "user_pair": UserPair,          // present only if a pair scorecard initiated this session's extraction
  "pairs": {                      // optional: full pair-number → players map for the session
    "4": [Player, Player],        //   keys are stringified pair numbers (since JSON object keys are strings)
    "10": [Player, Player]        //   players echo the Player shape used elsewhere
  },
  "table_count": 54,              // tables in play this session; null if not derivable
  "boards": [Board, ...],
  "partial": false,               // true if some boards failed to fetch or parse
  "warnings": []                  // human-readable issues encountered during extraction
}
```

`session_number` alone identifies a session — no separate composite ID is needed because uniqueness is scoped under the event.

`pairs` is optional. ACBL Live's board-detail pages already include player names on every result row, so the ACBL Live adapter omits this field. Adapters reading sources that don't always carry full names (e.g., a BWS file without the ACBL name database loaded) populate `pairs` so analyzer-side overlay flows can map pair numbers to players.

## UserPair

```jsonc
{
  "section": "A",
  "direction": "EW",              // "NS" | "EW"
  "pair_number": 4,
  "players": [Player, Player],
  "session_score": 411.50,
  "session_percentage": 60.30,
  "carryover": 192.00
}
```


`table_count` is derived rather than reported by any source: every table plays a
board once, so the result rows for a board number — summed across sections, since
a board number recurs once per section — give the table count. The maximum across
board numbers is used so a board that some tables sat out doesn't undercount.
Validated against BBO's own summary: `tview.php` reports 54 tables for a
4-section event whose busiest board carries exactly 54 rows.

## Board

```jsonc
{
  "number": 1,
  "section": "A",                 // section the user played in (or null if cross-section)
  "dealer": "N",                  // "N" | "E" | "S" | "W"
  "vulnerability": "None",        // "None" | "NS" | "EW" | "Both"

  "deal": {
    "N": Hand,
    "E": Hand,
    "S": Hand,
    "W": Hand
  },

  "double_dummy": {
    // Tricks each declarer can make in each strain, optimal play by both sides.
    // Per-declarer (4 seats × 5 strains = 20 values), because opening-lead
    // direction can change DD tricks for some layouts and the analyzer matches
    // tricks against the actual declarer. Values are raw trick counts (0–13);
    // null when the source can't disambiguate (e.g., ACBL Live collapses
    // 0–6 tricks into a single "can't make 1-level" bucket, which we emit as
    // null rather than guessing an exact count).
    "N": { "C": 10, "D": 7, "H": 9, "S": 11, "NT": 11 },
    "S": { "C": 11, "D": 7, "H": 9, "S": 11, "NT": 11 },
    "E": { "C": 8, "D": 12, "H": 9, "S": 8, "NT": 8 },
    "W": { "C": 8, "D": 12, "H": 9, "S": 8, "NT": 8 }
  },

  "par": [
    // Array of par contracts (typically one entry, more when ties exist).
    // Empty `[]` when there is no par data (e.g. passed-out boards).
    // All entries share the same `score` by definition.
    {
      "score": 460,               // signed integer; positive = NS gain
      "contract": "5NT",          // canonical contract string
      "declarer": "N"             // best declarer for par ("N"/"E"/"S"/"W")
    }
    // Tied example:
    //   { "score": 420, "contract": "4H", "declarer": "N" },
    //   { "score": 420, "contract": "4S", "declarer": "S" }
  ],

  "results": [Result, ...],       // every table that played this board
  "user_result_index": 5          // index into `results` for the user's row (or null)
}
```

## Hand

```jsonc
{
  "S": ["K", "Q", "6", "3", "2"],
  "H": ["A", "Q", "10", "4"],
  "D": [], // empty array for void
  "C": ["A", "8", "3", "2"],
}
```

Ranks: `A`, `K`, `Q`, `J`, `10`, `9`, `8`, `7`, `6`, `5`, `4`, `3`, `2`. Always uppercase, always `10` (not `T`). Order: high to low within each suit.

## Result

```jsonc
{
  "contract": "6S",               // canonical: digit + strain (C/D/H/S/NT) + optional X or XX. "PASS" for passed-out boards. null for "no result" rows (sit-out / averaged / not played).
  "declarer": "S",                // "N" | "E" | "S" | "W". null when contract is null or "PASS".
  "tricks": 12,                   // tricks taken (0–13). Should be populated whenever score and contract are both known; the analyzer's trick-difference and DD-comparison logic degrades when this is null. Adapters should derive tricks from score when possible (deterministic for non-doubled contracts; for doubled/redoubled, ambiguity may force null in rare cases — emit a warning when this happens).
  "score": 980,                   // signed integer; positive = NS gain. null when no result was recorded for this row.

  "matchpoints": 14,              // null if scoring is not matchpoints
  "percentage": 100.0,            // 0–100; null if not available
  "imps": null,                   // present only for IMP scoring

  "ns_pair": Pair,
  "ew_pair": Pair,

  "auction": null,                // array of bids if real auction is known; null if not (ACBL Live tournament data does NOT have real auctions)
  "play": null,                   // array of cards played if known; null otherwise

  "handviewer_url": "https://www.bridgebase.com/tools/handviewer.html?..."
                                  // optional; UX convenience for "click to replay"
}
```

### Contract canonical form

`{level}{strain}{double?}` where:

- `level`: `1`–`7`
- `strain`: `C`, `D`, `H`, `S`, or `NT`
- `double`: `X` (doubled), `XX` (redoubled), or absent

Examples: `1NT`, `4H`, `6SX`, `7NTXX`, `PASS` (passed out).

### Score sign convention

Always from N-S perspective. `+980` = N-S won 980. `-100` = N-S lost 100 (E-W gained 100).

## Pair

```jsonc
{
  "number": 10,                   // pair number within the section (or null if unknown)
  "section": "A",                 // optional, if known
  "strat": 1,                     // strat tier the pair played in (1-based integer); null if not available
  "strat_ranks": [                // their placements; can span multiple strats (lower-strat players
                                  //   can also place within higher strats); empty array if no awards
    { "strat": 1, "rank": 1, "scope": "Section" },
    { "strat": 1, "rank": 3, "scope": "Event" }
  ],
  "players": [Player, Player]
}
```

Adapters that don't have strat/placement data (ACBL Live tournament, BBO) emit `strat: null` and `strat_ranks: []`.

### Player order is seat order: `[N, S]` and `[W, E]`

`players[0]` and `players[1]` are **seats, not a list** — `ns_pair` is
`[North, South]` and `ew_pair` is `[West, East]`. Nothing in the payload records
a player's seat, so this order is the only thing that does. Get it backwards and
every consumer silently attributes each result to the wrong opponent.

`[W, E]` rather than PBN's `[East]`/`[West]` tag order because that is what every
consumer reads: `builder.rs` in the parser service, and `findPlayerSeat`,
`partnerOf` and the seat tags in the Game Analysis app.

**[seat-order-contract.md](seat-order-contract.md) is normative** for everything
else about this field: what each source publishes and how we know, the legal
shapes of `players`, how to verify a change, and — required reading for any
consumer — the swaps that older envelopes need, because `acbl-live` and
`acbl-live-club` emitted E-W East-first up to and including extension 1.0.1 in
two separate places: `ew_pair.players` below `schema_version` 1.3, and the
board's `double_dummy` table below 1.4.

## Player

```jsonc
{
  "name": "Weilong Shen",
  "acbl_id": "4833511",           // null if not an ACBL member
  "external_ids": {},             // future: BBO username, etc.
  "masterpoints_earned": [        // masterpoints awarded for this session, broken down by pigment color;
                                  //   empty array if none awarded or data not available
    { "amount": 2.42, "color": "Black" }
  ]
}
```

`masterpoints_earned` is per-player (not per-pair) because ACBL awards are individual. Both players in a pair typically earn the same amount. Adapters without award data emit `[]`. Color values match ACBL pigment names: `"Black"`, `"Red"`, `"Silver"`, `"Gold"`, `"Platinum"`, etc.

## Coverage

`coverage` states what the data contains so a consumer doesn't have to scan a
large archive to find out. It describes the envelope as delivered — the replay
backfill in `tools/fetch-replays.js` legitimately promotes `cardplay` from
`user-table` to `all-tables` when it merges.

**`cardplay`** is an enum, not a boolean, because "some cardplay" spans cases
that are consumed differently:

| Value | Meaning |
|---|---|
| `none` | No card-level data. |
| `lead` | Opening lead only. Bridgemate can be configured to record it, usually for every table. |
| `user-table` | Full play, but only for the seat captured for. Supports "how did I play this". |
| `all-tables` | Full play for every table on the board. Supports "how did the field play this". |

A boolean would make a BBO export look identical before and after a replay
backfill, which is the distinction that matters most for analysis.

**`player_names`** declares whether the envelope carries personally identifying
names or only the pseudonymous handles a site assigns, so a consumer — or a
backend sync with privacy obligations — can tell which envelopes hold PI without
scanning them.

| Value | Meaning |
|---|---|
| `none` | No player identification at all. |
| `usernames` | Site handles only, e.g. BBO's `kemistry`. Identifies a seat, not a person. |
| `real` | Real names, and possibly national-body IDs. |

BBO is `usernames` by deliberate choice, not limitation. `tview.php` shows real
names to an authenticated viewer, so the adapter fetches it **without
credentials**: BBO then withholds names while still returning sections, strat
ranks and masterpoint awards. Opponents' personal information never enters the
archive. ACBL Live and club games are `real` — those sources publish names, and
in a club game you generally know the players, which is the point.

**`sections` vs `sections_labelled`** are separate guarantees. `sections: "all"`
means every section's results are present; `sections_labelled` means you can
tell *which* section a pair was in. BBO is `all` but not labelled: a traveller
carries one row per table across the whole event — verified against `tview.php`,
where a 4-section, 54-table event yields 54 rows on a board — but section
identity is only on `tview.php`. The adapter now fetches that page, so
`sections_labelled` is `true` whenever the fetch succeeds and `false` when it
doesn't — the value describes the run, not the adapter's best case. Note that
`Board.section` stays null for BBO even then: a traveller spans the whole field,
so a board isn't in one section. It is `Pair.section` that gets labelled.

### What each adapter declares

| Adapter | cardplay | auction | results | sections | labelled |
|---|---|---|---|---|---|
| `bbo` | `user-table` | `user-table` | `all-tables` | `all` | `true` when the summary fetch succeeds |
| `acbl-live` | `none` | `none` | `all-tables` | `all` | `true` |
| `acbl-live-club` | `none` | `none` | `all-tables` | `all` | `true` |

ACBL Live publishes no card-level data at all. The auction in the BBO
handviewer links on its board-detail pages is synthetic rather than the auction
played, so it is deliberately not extracted.


## Schema versioning

`schema_version` follows semver-ish:

**1.4** did not change any field. It marks the point where `acbl-live` and
`acbl-live-club` started emitting the board's `double_dummy` table with its E
and W rows on the right seats. Together with 1.3 — which marks the same
correction for `ew_pair.players` — these are the only bumps here that a consumer
must branch on to read *older* data correctly, and they are gated separately:
see [seat-order-contract.md](seat-order-contract.md) § Consumer rule.

**1.3 is never published by this extension.** Bridge Classroom stamps it on
envelopes it has half-corrected at its ingest door, and reads it back as "the
table is still transposed". A build emitting 1.3 would have a correct table
swapped into a wrong one.

**1.2** added `capture.players`, `capture.pair` and per-provider id arrays in
`capture.subject`. Additive and optional: a 1.1 consumer reads a 1.2 envelope
unchanged.

- Patch (`1.0.1`): bugfixes, no field changes
- Minor (`1.1`): new optional fields added
- Major (`2.0`): breaking changes (renames, removals, type changes)

The analyzer should validate `schema_version` and refuse data from unknown major versions.

## Worked example (truncated)

```json
{
  "schema_version": "1.4",
  "source": "acbl-live",
  "provider": { "id": "bridge-classroom-fetch", "version": "1.0.0", "kind": "browser-extension" },
  "coverage": {
    "cardplay": "none", "auction": "none", "results": "all-tables",
    "sections": "all", "sections_labelled": true
  },
  "fetched_at": "2026-04-26T18:30:00Z",
  "tournaments": [
    {
      "sanction": "2604321",
      "schedule_url": "https://tournaments.acbl.org/schedule.php?sanction=2604321",
      "name": "Palo Alto Bridge Sectional",
      "events": [
        {
          "event_id": "2501",
          "event_type": "open_pairs",
          "name": null,
          "date": "2026-04-25",
          "scoring": "matchpoints",
          "sessions": [
            {
              "session_number": 2,
              "time": "14:30",
              "user_pair": {
                "section": "A",
                "direction": "EW",
                "pair_number": 4,
                "players": [
                  { "name": "Rick Wilson", "acbl_id": "3506177", "external_ids": {} },
                  { "name": "Andrew Rowberg", "acbl_id": "5550076", "external_ids": {} }
                ],
                "session_score": 411.5,
                "session_percentage": 60.3,
                "carryover": 192.0
              },
              "boards": [
                {
                  "number": 1,
                  "section": "A",
                  "dealer": "N",
                  "vulnerability": "None",
                  "deal": {
                    "N": {
                      "S": ["10", "9", "8", "7", "5"],
                      "H": ["9", "2"],
                      "D": ["A", "K", "Q"],
                      "C": ["Q", "10", "4"]
                    },
                    "E": {
                      "S": ["J", "4"],
                      "H": ["J", "7", "5"],
                      "D": ["10", "8", "6", "5", "2"],
                      "C": ["J", "7", "6"]
                    },
                    "S": {
                      "S": ["K", "Q", "6", "3", "2"],
                      "H": ["A", "Q", "10", "4"],
                      "D": [],
                      "C": ["A", "8", "3", "2"]
                    },
                    "W": {
                      "S": ["A"],
                      "H": ["K", "8", "6", "3"],
                      "D": ["J", "9", "7", "4", "3"],
                      "C": ["K", "9", "5"]
                    }
                  },
                  "double_dummy": {
                    "N": { "C": 10, "D": 7, "H": 9, "S": 11, "NT": 11 },
                    "S": { "C": 11, "D": 7, "H": 9, "S": 11, "NT": 11 },
                    "E": { "C": 8, "D": 12, "H": 9, "S": 8, "NT": 8 },
                    "W": { "C": 8, "D": 12, "H": 9, "S": 8, "NT": 8 }
                  },
                  "par": [{ "score": 460, "contract": "5NT", "declarer": "N" }],
                  "results": [
                    {
                      "contract": "6S",
                      "declarer": "S",
                      "tricks": 12,
                      "score": 980,
                      "matchpoints": 14,
                      "percentage": 100.0,
                      "imps": null,
                      "ns_pair": {
                        "number": 10,
                        "section": "A",
                        "players": [
                          { "name": "Weilong Shen", "acbl_id": "4833511", "external_ids": {} },
                          { "name": "Vasisht Ganesh", "acbl_id": "1880438", "external_ids": {} }
                        ]
                      },
                      "ew_pair": {
                        "number": 6,
                        "section": "A",
                        "players": [
                          { "name": "Arthur Mirin", "acbl_id": "1357719", "external_ids": {} },
                          { "name": "Padmini Sokkappa", "acbl_id": "7844212", "external_ids": {} }
                        ]
                      },
                      "auction": null,
                      "play": null,
                      "handviewer_url": "https://www.bridgebase.com/tools/handviewer.html?n=cq104dakqs109875h92&..."
                    }
                  ],
                  "user_result_index": 5
                }
              ],
              "partial": false,
              "warnings": []
            }
          ]
        }
      ]
    }
  ]
}
```
