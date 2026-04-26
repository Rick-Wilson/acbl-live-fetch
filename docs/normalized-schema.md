# Normalized Schema

Every adapter emits this JSON schema regardless of source. The downstream analyzer (bridge-classroom.com Game Analysis tool) consumes this format.

## Top-level

```jsonc
{
  "schema_version": "2.1",
  "source": "acbl-live",          // "acbl-live" | "club-game-bws" | "bbo" | ...
  "fetched_at": "2026-04-26T18:30:00Z",
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
    // tricks against the actual declarer.
    "N": { "C": 4, "D": 1, "H": 3, "S": 5, "NT": 5 },
    "S": { "C": 5, "D": 1, "H": 3, "S": 5, "NT": 5 },
    "E": { "C": 2, "D": 6, "H": 3, "S": 2, "NT": 2 },
    "W": { "C": 2, "D": 6, "H": 3, "S": 2, "NT": 2 }
  },

  "par": {
    "score": 460,                 // signed integer; positive = NS gain
    "contract": "5NT",            // canonical contract string
    "declarer": "N"               // best declarer for par
  },

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
  "players": [Player, Player]
}
```

## Player

```jsonc
{
  "name": "Weilong Shen",
  "acbl_id": "4833511", // null if not an ACBL member
  "external_ids": {}, // future: BBO username, etc.
}
```

## Schema versioning

`schema_version` follows semver-ish:

- Patch (`2.1.1`): bugfixes, no field changes
- Minor (`2.2`): new optional fields added
- Major (`3.0`): breaking changes (renames, removals, type changes)

The analyzer should validate `schema_version` and refuse data from unknown major versions.

### What changed in 2.1

- **`Board.double_dummy` is now per-declarer** — `{ N: {...}, S: {...}, E: {...}, W: {...} }`, replacing the per-side `{ NS, EW }` shape. Each value is a `{ C, D, H, S, NT }` strain map of tricks. Opening-lead direction can change DD tricks for some layouts, so collapsing N+S into a single number lost information. Adapters that only have per-side source data should populate both seats of each side with the same value. This is technically a breaking shape change inside `Board`, but since 2.0 was never consumed by the analyzer, the bump is minor and consumers require ≥ 2.1.
- Added optional `Event.name` — human-readable label like `"Wednesday Afternoon Pairs"`. Useful for sources where the descriptive name lives at the event level rather than the tournament level (e.g., club games). Analyzers fall back: `event.name` → `tournament.name` → `event.date`.
- Added optional `Session.pairs` — a `{ "<pair_number>": [Player, Player] }` map covering every pair in the session. Adapters with comprehensive on-page name data (ACBL Live) omit this; adapters whose source can be missing names (BWS files) populate it so analyzers can overlay pasted recap data.
- Tightened the doc comment on `Result.tricks`: adapters should populate tricks whenever score + contract are both known (deterministic for non-doubled contracts), since downstream trick-difference / DD-comparison logic degrades when this is null.

### What changed in 2.0

- Top-level wrapper is now `tournaments: [Tournament, ...]` (an array of trees) rather than a single `session: Session`. This unifies "single session", "whole tournament", and "player history" extractions under one shape.
- Renamed `event_id → sanction` at the top of the tree (it was always the tournament-level identifier; the URL-segment naming was misleading).
- Added `tournament.schedule_url` (canonical link to the tournament's schedule page).
- Added `tournament.name` for the human-readable tournament name (previously emitted as `event_name`).
- Removed the composite `session_id` (e.g., `"2501-2"`); replaced with `session_number` (integer, unique under each event).
- New intermediate `Event` node between tournament and session, holding `event_id`, `event_type`, `date`, and `scoring`.

## Worked example (truncated)

```json
{
  "schema_version": "2.1",
  "source": "acbl-live",
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
                    "N": { "C": 4, "D": 1, "H": 3, "S": 5, "NT": 5 },
                    "S": { "C": 5, "D": 1, "H": 3, "S": 5, "NT": 5 },
                    "E": { "C": 2, "D": 6, "H": 3, "S": 2, "NT": 2 },
                    "W": { "C": 2, "D": 6, "H": 3, "S": 2, "NT": 2 }
                  },
                  "par": { "score": 460, "contract": "5NT", "declarer": "NS" },
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
