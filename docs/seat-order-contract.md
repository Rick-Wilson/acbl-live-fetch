# Seat Order Contract

What binds a player to a seat, across every producer and every consumer of a
normalized envelope. A companion to
[ingest-protocol.md](ingest-protocol.md) — that one governs how a payload
travels, this one governs what one field of it *means*.

It exists because the meaning is carried by array order and nothing else, which
makes it invisible in the payload, unfalsifiable by inspection, and wrong twice
so far. Both times the error survived review because the reasoning was sound;
only a deal settled it.

- **Implementing a consumer?** [§ Consumer rule](#consumer-rule) and nothing else.
- **Writing or changing an adapter?** [§ Producer rule](#producer-rule), then
  [§ Verifying a change](#verifying-a-change) before you commit it.

## The rule

```
ns_pair.players = [North, South]
ew_pair.players = [West,  East ]
```

Normative for every envelope at `schema_version` ≥ `1.3`, whatever the source.

Three shapes are legal, and only three:

| `players` | Means |
|---|---|
| two entries | seats, in the order above |
| two entries, `name: null` on one | that seat's player is unknown; the other is not |
| `[]` | no player information at all — a phantom pair, or a pair the source didn't index |

An array of length 1 is **not** legal and never has a defined seat. A consumer
that meets one must treat both seats as unknown rather than guess which it holds.

`[W, E]` rather than PBN's `[East]`/`[West]` tag order because that is what every
consumer already reads: `builder.rs` in the parser service, and `findPlayerSeat`,
`partnerOf` and the seat tags in the Game Analysis app. PBN's order is a
tempting thing to reason from and has now caused one of the two flips below.

## Why order carries the seat, and not a field

Because no ACBL source records a seat. Not the club JSON, not the tournament
HTML: verified by scanning every key at every depth of three real club payloads
— two ACBLScore uploads and one RSVP Bridge — and the only direction fields are
the pair-level `NS`/`EW` and the hand-record's own suit fields. A pair arrives as
two names in an order, and the order is the whole signal.

This is worth restating whenever someone proposes to "just read the seat from
the source": for two of the three producers, there is nothing to read. See
[§ Open question](#open-question-an-explicit-seat-field) for what to do about
that.

## Producer rule

An adapter converts its source's order into the contract's order. What each
source publishes, and how we know:

| Producer | Source order | Adapter does | Evidence |
|---|---|---|---|
| `acbl-live-club` | `[N, S]` / `[E, W]` | passes NS, reverses EW | **Deal-proved**, Livermore 24 Aug 2026 |
| `acbl-live` | `[N, S]` / `[E, W]` | passes NS, reverses EW | Confirmed against a habitual-seat player, plus two corroborating games |
| `bbo` | LIN `pn|` = `S, W, N, E` | maps by name | Names all four seats explicitly; confirmed against BBO's own hand viewer |
| BWS + PBN file upload | per-seat player numbers | *not part of this contract* | **Unverified, and suspected of a flip of its own** |

**ACBL publishes a pair in the order its direction label reads** — `N-S` gives
`[North, South]`, `E-W` gives `[East, West]`. One convention, both sites, which
is why the two ACBL adapters are the same shape.

The evidence, since this is the part that keeps getting re-derived:

- Livermore, 24 Aug 2026. EW pair 7 arrived as `[Arthur Mirin, Dan Bergmann]`,
  and Mirin held the **East** hand on both boards he wrote in about — a 15-count
  opening 1NT on board 26, seven spades opening 1S on board 22, with Bergmann
  declaring from West both times. The deal proves the seat; nothing else could.
- The tournament fixture's cell reads `Rick Wilson, Andrew Rowberg`, and Rowberg
  only ever sits North or West. First name is East again, on the other site.
- Two more that agree without proving: Mirin (who sits East or South) is listed
  first among an E-W pair on both sites, and Sokkappa (North or West) is listed
  first among an N-S pair on both. The second of those is the only positive
  evidence anyone has ever produced that **`ns_pair` is `[N, S]`** — an order
  that was never questioned and, until August 2026, never checked either.

The file-upload path is deliberately outside this contract. It is a different
producer with real per-seat data (BWS records player numbers by seat), it emits
no `schema_version`, and it must never be put through the consumer workaround
below. It also has an open flip of its own — see [§ History](#history).

## The same order, in the double-dummy line

Pair players are not the only field ACBL carries as bare order. Both sites
publish the double-dummy makes as two strings, `NS:` and `EW:`, and a strain
where the two seats differ is written with a slash — `3/4H`, `C5/6`. The two
digits are seats, in the order the row's own label reads:

```
NS: … 4/5C …    →  North 10 tricks, South 11
EW: … 3/4H …    →  East   9 tricks, West  10
```

One convention, so a reader who knows `E-W` means `[East, West]` for players
already knows it here. Unlike the players field, this one can be checked without
finding a person: solve the deal.

That was done for every distinct deal in `fixtures/my-acbl` — 88 of them, run
through `bridge-solver` — and of the tokens whose two seats differ, **22 of 22
match East-first on the EW row and 14 of 14 match North-first on the NS row**,
with no deal contradicting either. Board 4 of `sample-club-game.html` is the
one to read: `EW: 5C 3/4H 5S D6 NT6`, on a deal where East makes nine hearts and
West makes ten.

Both adapters mapped this row West-first until September 2026 — see
[§ History](#history).

## Consumer rule

Envelopes whose `source` starts with `acbl-live` get E and W the wrong way round
in two places, and the two were fixed at different times, so they have different
boundaries. A consumer corrects each on its own gate:

| `schema_version` | `bbo` | `acbl-live`, `acbl-live-club` |
|---|---|---|
| `1.1`, `1.2` | correct | **swap `ew_pair.players`** *and* **swap `double_dummy` E/W** |
| `1.3` | correct | players correct; **swap `double_dummy` E/W** |
| `1.4` and up | correct | correct |
| absent | not an extension envelope — leave alone | |

In the wild the affected build is extension 1.0.1, published in all three
browser stores around 14 August 2026 and emitting `1.1`. (The 1.1.0 build
carried `1.2` but was corrected before submission, so it never reached anyone.)
Store updates are slow and optional, so this is permanent furniture rather than
a temporary patch — which is the whole point: the correction reaches every
current user on the next site deploy, weeks before a store review does.

### `1.3` is ours, and no producer may emit it

There has never been a published build at `1.3`. Every `1.3` envelope in
existence was stamped by this correction's first version, which fixed
`ew_pair.players` and knew nothing about the table — and Bridge Classroom's
ingest page archives what it corrects, so the `club_games` store is full of
`1.3` games whose double-dummy table is still transposed.

That is why the table has a boundary of its own rather than sharing the players'
one. Folding it in under `< 1.3` would have skipped every already-archived game
permanently, which is the silent half of this bug: those rows would keep serving
a backwards table forever, and nothing would ever look wrong at the door.

The cost is one reserved number. `provenance.js` goes `1.2` → `1.4`, and a
producer that published `1.3` would be read as "table already correct" and have
its correct table swapped into a wrong one. There is a test for it.

```js
// Apply once, on ingest, before anything reads the arrays or the table.
const PLAYERS_FIXED_AT = 3
const DOUBLE_DUMMY_FIXED_AT = 4

const isBelow = (v, minor) => {
  const [maj, min] = String(v ?? '').split('.').map(Number)
  return !Number.isFinite(maj) || maj < 1 || (maj === 1 && (!Number.isFinite(min) || min < minor))
}

function fixEwSeatOrder(envelope) {
  const v = envelope.schema_version
  if (v == null || String(v).trim() === '') return envelope       // file-upload path
  if (!String(envelope.source ?? '').startsWith('acbl-live')) return envelope
  if (!isBelow(v, DOUBLE_DUMMY_FIXED_AT)) return envelope

  if (isBelow(v, PLAYERS_FIXED_AT)) {
    for (const result of everyResult(envelope)) {
      const p = result.ew_pair?.players
      if (Array.isArray(p) && p.length === 2) p.reverse()
    }
  }
  for (const board of everyBoard(envelope)) {
    const t = board.double_dummy
    if (!t || t.E == null || t.W == null) continue
    const east = t.E; t.E = t.W; t.W = east
  }
  envelope.schema_version = '1.4'   // see "swap exactly once"
  return envelope
}
```

Five things that are easy to get wrong:

- **Gate the two corrections separately.** A `1.3` envelope needs the table
  fixed and its players left alone. One combined gate gets one of them wrong
  whichever boundary it picks.
- **Scope by `source`.** `startsWith('acbl-live')` catches both ACBL sources.
  Never touch `bbo` at any version — its seats come from LIN's `pn|`, which
  names all four, and its boards carry no `double_dummy` at all.
- **Leave `ns_pair` and the table's N/S rows alone.** Those have always been
  `[N, S]` and North-first.
- **Swap exactly once.** If envelopes are persisted, the hazard is a stored copy
  fixed on write and fixed again on read, which lands everything back where it
  started and looks like the workaround silently failing. Choose one: fix on
  read and store the original untouched, or fix on write *and* restamp
  `schema_version` to `1.4` so a second pass is a no-op.
- **Fix at the door.** Seat attribution, opponent display, the double-dummy
  table and any rebuild of a BBO `pn|` LIN URL (whose own order is `S, W, N, E`)
  all read these. Fix the envelope once on arrival, not at each use site.

### What a consumer-side fix cannot reach

A copy already handed on and stored elsewhere. A game sitting in the Game
Analysis app's `sessionStorage` or its local event cache was corrected — or not
— when it arrived, and re-reading it applies nothing. Re-sending the game from
the extension is what refreshes it. The server-side `club_games` archive is
fine: it is corrected on read.

## Verifying a change

Any change to a producer's seat handling — a new adapter, a new source format,
or a claim that one of the tables above is wrong — is verified **against a deal
or a person, never against a document**. The two flips below were both argued
from documents and both passed review.

In descending order of strength:

1. **A deal that identifies its own seat.** Get a player to say what they bid,
   then find which hand could have bid it. A 15-count balanced hand that opened
   1NT is not the 12-count 5-7 hand across the table. This is proof, and it is
   available from any player who will answer an email.
2. **A habitual-seat player.** Many players always sit the same way. "Andrew
   always sits N or W" settled `live.acbl.org` in one line.
3. **A second source for the same game.** A BBO virtual club game carries real
   seats in its LIN; the ACBL copy of the same game does not.

What does **not** count, because each has already produced a wrong answer:
PBN tag order, another consumer's convention, symmetry with the other pair, or
a side-by-side against a path whose own seat handling is unverified.

Record the evidence in the code comment at the point of the reversal, not only
in the commit message. Both flips were re-argued by someone reading the parser.

## History

**Until 8 Aug 2026** — both ACBL adapters reversed EW, with a comment saying the
analyzer wanted PBN's `[East]`/`[West]` order. Under this contract that output
was correct, for a stated reason that was wrong.

**8 Aug 2026** (`2805737`) — the reversal was removed. Half of that commit was
verified and remains true: the consumer end reads `[W, E]`, and the BBO adapter
genuinely was emitting `[E, W]` and was fixed. The other half — that the ACBL
sources publish `[W, E]` — was assumed, and shipped in 1.0.0, 1.0.1 and the
built-but-unsubmitted 1.1.0.

**24 Aug 2026** — a player's own account of two boards falsified it. The
reversal is back, on deal-proved evidence, and `schema_version` went to `1.3` so
consumers can tell the two apart.

**7 Sep 2026** — the same flip, found in a second field. Both ACBL adapters were
mapping the `EW:` double-dummy row West-first, on a comment that cited "the
analyzer's seat-display ordering elsewhere" — another consumer's convention,
which [§ Verifying a change](#verifying-a-change) already lists as evidence that
does not count. It reached a user as a backwards E/W row in the Game Analysis
double-dummy table, against a correct table from the solver on the same deal.
Fixed to East-first on the 88-deal check above. Boards ingested before this
carry the swapped table and are not corrected by re-reading — only by
re-importing the game.

**Open: the file uploader.** A Livermore club game was seen months earlier with
its E-W pair reversed, at a time when the extension's club adapter was already
emitting the correct order — so that sighting has a different cause, and the
BWS+PBN upload path is the likeliest one. That path has real per-seat data to be
right or wrong about. Until someone checks it, the two routes may disagree about
the same club game depending on how it arrived.

## Open question: an explicit seat field

Everything above exists because a seat is carried by position. A field would end
the entire class of bug:

```jsonc
"players": [
  { "seat": "W", "name": "Dan Bergmann",  /* ... */ },
  { "seat": "E", "name": "Arthur Mirin",  /* ... */ }
]
```

It is self-describing, it survives a consumer that sorts or filters the array,
and a mistake in it is visible in the payload instead of only on screen.

Not adopted, because it is a schema change across three repos and every consumer
would have to read both forms for as long as pre-`1.3` envelopes exist — which
is the same tail this contract's workaround already has to carry. The honest
statement is that it should be done when something else forces a schema bump of
that size, and that adding it does not remove the need for
[§ Verifying a change](#verifying-a-change): a `seat` field the adapter fills in
from the wrong end of the source array is exactly as wrong, just more legible.
