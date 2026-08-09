# ADR 0001 — Versioned ingest endpoint and postMessage handoff

- **Status:** Accepted — implemented 2026-08-08, except Decision 6
  (`unlimitedStorage`), which is still outstanding
- **Date:** 2026-08-01
- **Supersedes:** [handoff-protocol.md](../handoff-protocol.md), now retired
  along with `src/ui/analyzerContent.js`

## Context

The extension is approaching store submission (Chrome, Firefox, Safari). Once
published, every change to it costs a review cycle per store — days to weeks,
and not under our control. That makes the extension the most expensive place in
the ecosystem to put logic that is likely to change.

At the same time the number of consumers for this data is growing. Today the
club game analysis SPA reads it. In progress: a double-dummy solver analysis,
and Bridge Classroom's replay capability. Each of those wants the same
normalized envelope, and none of them wants to be gated on extension review.

### How the handoff works today

1. The service worker runs an adapter and stashes the envelope in
   `chrome.storage.local` under a UUID. Batch envelopes are gzipped and base64'd
   first ([handlers.js:78-96](../../src/background/handlers.js#L78-L96)).
2. It opens `bridge-classroom.{org,com}/game-analysis/#sid=<uuid>` (or
   `#batch=<key>`).
3. [analyzerContent.js](../../src/ui/analyzerContent.js), a content script matched
   on that path, reads the fragment, asks the service worker for the payload, and
   writes it into `window.sessionStorage`.
4. The SPA reads a known `sessionStorage` key on mount.

### What actually constrains it

Three limits are commonly conflated. They are independent, and only one is
removed by changing the transport:

| Limit | Where it binds | Evidence |
|---|---|---|
| `sessionStorage` ~5 MB/origin | Step 3, the page write | `storage-failed` state, [analyzerContent.js:100-107](../../src/ui/analyzerContent.js#L100-L107) |
| `chrome.storage.local` quota (~10 MB in current Chrome) | Step 1, the durable buffer | gzip runs *before* `storage.set`; `storageQuotaHit` breaks the batch loop, [handlers.js:241-252](../../src/background/handlers.js#L241-L252) |
| FIFO cache of 10 events | The **SPA's** own cache, not storage at all | [handlers.js:212-213](../../src/background/handlers.js#L212-L213) — the extension slices and reverses to feed it oldest-first |

So gzip exists to fit `chrome.storage.local`, not `sessionStorage`, and the
10-event cap is not an extension concern. A transport change alone leaves batch
capacity exactly where it is.

Separately, a lesson from the `#bcdev-mega` export: a single large payload fails
*silently* at scale. Encoding ~120 MB as a `data:` URL produced a 0-byte file
with no error raised, because Chrome caps URLs near 2 MB. Anything carrying a
full history has to be chunked, and chunking has to be verified at real size.

## Decision

**1. Match content scripts on the whole origin, not a path.**

`https://bridge-classroom.org/*` rather than `.../game-analysis/*`. Chrome's
permission warning is host-granular, so both produce the identical "Read and
change your data on bridge-classroom.org" string — the broader pattern costs
nothing at review or in user-facing scariness. Once the origin is matched, any
future landing page, ingest route or same-origin tool is reachable with no
manifest change ever again.

Include `bridge-classroom.com` and the staging origin *now*. Adding a host later
is a full review cycle per store to fix a development inconvenience.

**2. Land on a versioned ingest route: `/ingest?v=1`.**

`?v=1` versions the *transport contract*. Payload shape is versioned separately
by the envelope's own `schema_version`, which we already emit — the page
dispatches on that. Two places recording the same fact can disagree; they
shouldn't both describe the payload.

**3. Replace the `sessionStorage` write with a `postMessage` handshake.**

The page posts `ready` with the sid on mount; the content script replies with
the payload. Structured clone, so no string serialization and no 5 MB wall. The
handshake is required because postMessage has a delivery race that
`sessionStorage` did not — a durable per-tab write has no listener to miss.
Reload stays correct because the durable copy remains in `chrome.storage.local`
under the uuid, so a refresh simply re-requests it.

Large payloads are delivered in chunks (`begin` / `chunk` / `finish`), reusing
the protocol proven in the mega export rather than inventing a second one.

**4. The extension never touches the app's archive database.**

If the content script wrote the archive directly, the extension would know its
database name, store names and schema version — and the next archive migration
would become an extension update and a review cycle per store. That is the exact
failure mode this ADR exists to avoid. Durability stays in
`chrome.storage.local`; the page owns everything past the handshake, including
IndexedDB persistence and any sync to a registered user's Bridge Classroom
database.

**5. Keep both `.org` and `.com`; the backend is the cross-origin mechanism.**

Both origins stay supported. Anything the page persists locally is origin-scoped
— data ingested on `.org` is invisible on `.com` — so for **registered users the
backend sync is what makes the data portable**, across both domains and across
machines. That is a feature of the account, not of the browser storage, and it
is the right place for it.

Do not attempt to bridge the origins client-side. The classic trick — a hidden
iframe on a canonical origin sharing storage via postMessage — no longer works
reliably: Chrome partitions third-party storage by top-level site, and Safari's
ITP does likewise, so the iframe gets a *different* store per embedding origin
rather than a shared one. Anything built on it would appear to work in
development and fail per-browser in the field.

The residual limitation is therefore **signed-out users only**: their data lives
on whichever origin ingested it. This is accepted, but it must be visible rather
than silent — the ingest page should say plainly that the capture is local to
this domain and that signing in makes it available everywhere. Two consequences
follow that the implementation has to handle:

- `preferredTld` (formerly `preferredAnalyzerTld`) currently follows whichever domain the user last
  visited, so a signed-out user can split their own captures across origins
  without ever making a choice. Either pin signed-out ingest to one origin or
  make the landing page state which domain it just wrote to.
- A user who captures signed-out and registers later has local data on one
  origin that the backend has never seen. There needs to be a claim-and-upload
  path, or that history is silently orphaned.

**6. Add the `unlimitedStorage` permission.**

This is the actual fix for batch capacity, which the transport change does not
address. It generates no user-visible permission warning in Chrome. Gzip stays:
dropping it would cut buffer capacity roughly sevenfold (~10:1 for gzip on this
JSON, times ~1.33 for the base64 wrapper).

## Consequences

**Gained.** Adding or changing a consumer becomes a web deploy rather than a
store submission. The 5 MB handoff ceiling and its `storage-failed` path are
gone. Batch capacity is limited by disk rather than a 10 MB quota. The extension
shrinks to one job — produce a normalized envelope and deliver it — which is
also the easiest thing to explain to a store reviewer.

**Costs and risks.**

- One more moving part in the handshake, and a real race if the `ready` message
  is missed. Needs an explicit timeout and a visible failure, not a silent empty
  state.
- **`postMessage` is readable by any script on the page**, and any script can
  post to it. Validate `event.source === window` and `event.origin` on both
  ends. Treat "no third-party scripts on the ingest route" as a standing
  constraint — an analytics tag or embedded widget on that origin would be able
  to read members' hand records.
- **Signed-out captures are origin-scoped** (see Decision 5). Registered users
  are unaffected because the backend syncs across both domains and all their
  machines; signed-out users can strand data on one domain. Sync latency matters
  too: if a registered user captures on `.org` and immediately opens `.com`, the
  data is only there once the upload has completed, so the ingest page should
  not report success before the sync it promises has actually landed.
- Store submission requires a privacy policy and accurate data-use
  declarations on all three stores: this is a disclosed data flow to
  bridge-classroom.org.
- `http://localhost:3001/*` should be dropped from the shipped manifest. A
  localhost permission in a production listing invites reviewer questions for no
  benefit; the dev override belongs in a separate unpacked build.

## Alternatives considered

**`externally_connectable`** — lets the page talk to the extension without a
content script. Rejected: Firefox does not support it for web pages at all, and
its match patterns cannot include paths. Not portable to a three-store release.

**Extension writes IndexedDB directly** — considered and rejected under
Decision 4. Moves the coupling rather than removing it.

**A frozen `bc-handoff` staging database** — one object store, key = uuid,
value = envelope, owned by the extension and never changed; the app drains and
deletes. Sound if a durable page-side tier were needed, but
`chrome.storage.local` already is that tier. Rejected as a second durability
layer with no additional guarantee.

**Keep `sessionStorage`, raise nothing** — viable while sessions are 50–100 KB,
which is what the original decision assumed. Rejected: multi-event batches
already hit both ceilings, and full-history payloads are three orders of
magnitude past it.

## Open questions

- Confirm `chrome.storage.local`'s current quota and that `unlimitedStorage`
  lifts it on **Firefox and Safari**, not just Chrome. The Chrome behaviour is
  documented; the others are assumed here and should be measured.
- For signed-out ingest, whether to pin one origin or follow
  `preferredTld` and disclose the destination on the landing page
  (Decision 5).
- The claim-and-upload path for a user who captures signed-out and registers
  afterwards.

---

## Resolved

- **Does `/ingest` replace `/game-analysis/` entirely, or run alongside it?**
  Replaced entirely, 2026-08-08. No parallel period was needed: the extension
  has two users, and the ingest page forwards to whichever tool is wanted, so
  keeping a second hand-off mechanism bought nothing.
  `src/ui/analyzerContent.js`, its content-script match and its `sessionStorage`
  bridge are removed; `/game-analysis/` is now reached by the ingest page
  forwarding to it, not by the extension.
- **handoff-protocol.md.** Retired rather than rewritten — the mechanism it
  describes no longer exists. It carries a header pointing here and at
  [ingest-protocol.md](../ingest-protocol.md), and is kept only as a record of
  why `sessionStorage` was chosen originally.
