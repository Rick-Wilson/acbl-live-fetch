# Normalized Schema

Every adapter emits this JSON schema regardless of source. The downstream analyzer (bridge-classroom.com Game Analysis tool) consumes this format.

## Top-level

```jsonc
{
  "schema_version": "1.0",
  "source": "acbl-live",          // "acbl-live" | "club-game-bws" | "bbo" | ...
  "fetched_at": "2026-04-26T18:30:00Z",
  "session": Session
}
```

## Session

```jsonc
{
  "event_id": "2604321",          // source-specific event identifier
  "session_id": "2501-2",         // source-specific session identifier
  "event_name": "Palo Alto Bridge Sectional",
  "event_type": "open_pairs",     // "open_pairs" | "swiss_teams" | "knockout" | ...
  "date": "2026-04-25",
  "time": "14:30",                // 24-hour local time
  "scoring": "matchpoints",       // "matchpoints" | "imps" | "btw" | ...

  "user_pair": {                  // present only if a pair scorecard initiated extraction
    "section": "A",
    "direction": "EW",            // "NS" | "EW"
    "pair_number": 4,
    "players": [Player, Player],
    "session_score": 411.50,
    "session_percentage": 60.30,
    "carryover": 192.00
  },

  "boards": [Board, ...],
  "partial": false,               // true if some boards failed to fetch
  "warnings": []                  // human-readable issues encountered during extraction
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
    // Tricks each declarer can make in each strain, optimal play both sides
    // Format: { "NS": { "C": 4, "D": 1, "H": 3, "S": 5, "NT": 5 }, "EW": { ... } }
    "NS": { "C": 4, "D": 1, "H": 3, "S": 5, "NT": 5 },
    "EW": { "C": 2, "D": 6, "H": 3, "S": 2, "NT": 2 }
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
  "contract": "6S",               // canonical: digit + strain (C/D/H/S/NT) + optional X or XX
  "declarer": "S",                // "N" | "E" | "S" | "W"
  "tricks": null,                 // tricks taken if available; null if only score is known
  "score": 980,                   // signed integer; positive = NS gain

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

- Patch (`1.0.1`): bugfixes, no field changes
- Minor (`1.1`): new optional fields added
- Major (`2.0`): breaking changes (renames, removals, type changes)

The analyzer should validate `schema_version` and refuse data from unknown major versions.

## Worked example (truncated)

```json
{
  "schema_version": "1.0",
  "source": "acbl-live",
  "fetched_at": "2026-04-26T18:30:00Z",
  "session": {
    "event_id": "2604321",
    "session_id": "2501-2",
    "event_name": "Palo Alto Bridge Sectional",
    "event_type": "open_pairs",
    "date": "2026-04-25",
    "time": "14:30",
    "scoring": "matchpoints",
    "user_pair": {
      "section": "A",
      "direction": "EW",
      "pair_number": 4,
      "players": [
        { "name": "Rick Wilson", "acbl_id": "3506177", "external_ids": {} },
        { "name": "Andrew Rowberg", "acbl_id": null, "external_ids": {} }
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
          "NS": { "C": 4, "D": 1, "H": 3, "S": 5, "NT": 5 },
          "EW": { "C": 2, "D": 6, "H": 3, "S": 2, "NT": 2 }
        },
        "par": { "score": 460, "contract": "5NT", "declarer": "N" },
        "results": [
          {
            "contract": "6S",
            "declarer": "S",
            "tricks": null,
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
}
```
