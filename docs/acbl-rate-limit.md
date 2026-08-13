# live.acbl.org's request allowance

`live.acbl.org` serves roughly **110 requests per sign-in** under `/event/*` and
then 302s every further one to `https://web3.acbl.org/login`. It counts
**requests** — not bytes, not elapsed time, not rate, not our concurrency.

The extension does not try to get around this. It fits inside it: one event per
fetch, the user's own section only, and a clear message when the allowance is
spent. What follows is the evidence, because the symptom is misleading enough
that four rounds of theories died on it.

## Why it looks like something else

A **navigation** follows the 302, completes the SSO round trip, and comes back
with a fresh session. A **fetch** cannot — it dies at the cross-origin check
with an opaque response carrying no status and no `Location`.

So ordinary browsing silently repairs what fetching cannot: the page never
appears signed out, the user is never prompted, and the next run works. Seeing
the failure at all required `redirect: 'manual'` to notice a redirect had
happened, and the *page* console to learn where it went.

## The measurements

| source | requests | MB | seconds | req/s | concurrency |
|---|---|---|---|---|---|
| real batch | 110 | 15.33 | 18.1 | 9.0 | 16 |
| two probes, interleaved | 111 | 14.94 | ~35 | ~4 | 2 |
| HEAD probe, sequential | 111 | **0.00** | 50.6 | 2.2 | 1 |
| GET probe, sequential | 115, 119 | ~16 | 52–55 | 2.2 | 1 |
| batch runs | 115, 115, 116 | ~16 | 22–27 | ~5 | 16 |

Bytes range from 15 MB to zero. Duration varies threefold, rate fourfold,
concurrency sixteenfold. Only the count holds still, at 110–119.

## What is ruled out, and should not be re-derived

| theory | killed by |
|---|---|
| rate limiting | identical ceiling at 2.2/s and at 9.0/s |
| a transfer budget | a HEAD run transferring 0.00 MB hit the same wall |
| our own concurrency | identical at 1 in flight and at 16 |
| a Cloudflare bot check | a `__cf_chl_tk` token *does* appear on `/my-results`, but that is the page's own challenge. Our fetches get a plain 302 to the SSO login |
| renewing before the wall | a navigation against a *live* session is just a page load. Renewing at 100 requests let exactly 17 more through: 100 + 17 = 117. The counter carried on, and the navigation spent one of the 110 |

**Scope.** `/board-detail/` and `/scores/` share one counter — probes
interleaving both signed out at the same instant with 111 requests between them.
`/my-results` is exempt: 150 requests and 35 MB there tripped nothing.

## Two things that make this worse if you push on it

**Continuing to ask escalates the block.** After the wall, the app answers 302
for about a minute; keep asking and it becomes a hard `403` served in 0.0s —
an edge block that never reaches the application. Two requests every twenty
seconds was enough to trigger that escalation.

**Re-authenticating an exhausted session can log the user out for real.** After
one exhaustion followed by a renewal navigation, the next page load demanded
credentials. Not a silent SSO refresh — a login form. An extension that costs
users their ACBL login in order to fetch a second event is worse than one that
fetches a single event.

Both are reasons the code no longer retries, polls or renews. On a sign-out it
stops.

## What the extension does

- **One event per fetch.** The results listing (`/my-results`,
  `/player-results/<id>`) carries one `Analyze in Bridge Classroom` link per
  row instead of a page-level button. The date-range batch was removed: its
  smallest useful run was five events, or roughly 250 requests.
- **The user's own section only.** `COVERAGE.sections` is `user-only` and says
  so in the envelope. Fetching every section multiplied an event by its section
  count — a two-section, two-session event cost 96 board fetches where it now
  costs 48. Their own section is also the field they were scored against.
- **Enter through the user's own scorecard.** The listing is one player's page,
  so the content script reads the name from the `h1` and passes it along; the
  adapter picks that player's pair out of the summary. This is what keeps
  `user_pair` and `user_result_index` populated, and it is what tells us which
  section to fetch.
- **Say what happened.** A sign-out surfaces as its own error code,
  `session-expired`, and the listing shows the reason under the row that was
  clicked rather than a generic failure.

An event now costs roughly 27 requests (one session, 24 boards) to 55 (two
sessions, 26 boards each), so **two to three events fit in a sign-in**. Observed
in use: three events fetched cleanly, the fourth showed the message, and after
signing out and back in the next one worked. That is the design behaving as
intended rather than a failure.

How many fit is not worth predicting in the UI — it depends on sessions and
board count, and being told "you have about 2 left" and then getting 3 is worse
than being told nothing and getting a clear message at the end.

## Where the numbers came from

`bcFetchStats()` in the service-worker console still reports why each fetch took
the path it did. The heavier instrumentation used to establish the above — a
per-request ring buffer, a segment table, `bcProbeBudget`, `bcRecoveryCurve`,
`bcTune` — was removed once it had answered its question. Two of those
instruments corrupted their own measurement before they were understood, and
both are worth remembering:

**`followProbe`** re-issued a redirecting URL with `redirect: 'follow'` to learn
its destination. That lands on the login endpoint, which mints a fresh OAuth
`state` — clobbering the handshake our own renewal window was in the middle of,
and producing *Invalid or missing state parameter* pages.

**`bcTune({ renewAfter: null })` did not clear the setting**, because the merge
used `??`, which treats `null` as "not supplied". A whole run reported a
proactive renewal nobody had asked for.
