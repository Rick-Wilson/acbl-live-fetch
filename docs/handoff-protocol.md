# Handoff Protocol

This document specifies how the extension hands a parsed session to the bridge-classroom.com analyzer SPA. It's the contract between three pieces of code:

- **Service worker** (`src/background.js`) — runs the adapter, holds the data briefly.
- **Analyzer content script** (`src/ui/analyzerContent.js`) — runs in the analyzer page, bridges extension storage and the page's `sessionStorage`.
- **Analyzer SPA** (in the bridge-classroom.com codebase) — reads the session and renders.

If you're working on the SPA side, [§ SPA contract](#spa-contract) is the part you need.

## Why sessionStorage

Looked at three options:

- **POST to a server endpoint** — needs server-side storage, auth, and a deletion strategy. Overkill for ephemeral, single-session, single-user data.
- **`chrome.storage` exposed via `externally_connectable`** — couples the SPA to the extension's runtime API and breaks if the extension isn't installed or the user has a different one.
- **`window.sessionStorage` bridged by a content script** ← chosen. Same-origin, per-tab, ephemeral, no server, SPA stays decoupled (it just reads a known key).

Trade-off: payload size is bounded by `sessionStorage`'s ~5 MB-per-origin limit. A 26-board session is ~50–100 KB of JSON; we have plenty of room.

## End-to-end flow

```
┌──────────────────┐                  ┌──────────────────┐                  ┌──────────────────┐
│  source page     │                  │ service worker   │                  │ analyzer page    │
│ live.acbl.org    │                  │  (background)    │                  │ bridge-classroom │
│                  │                  │                  │                  │      .com        │
└────────┬─────────┘                  └────────┬─────────┘                  └────────┬─────────┘
         │                                     │                                     │
         │ 1. user clicks                      │                                     │
         │   "Analyze in Bridge Classroom"     │                                     │
         │                                     │                                     │
         │ ───── extract-session(url) ──────►  │                                     │
         │                                     │                                     │
         │                                     │ 2. fetch + parse session            │
         │                                     │ 3. generate uuid                    │
         │                                     │ 4. write to chrome.storage.local    │
         │                                     │       'pending-sessions:<uuid>'     │
         │                                     │                                     │
         │ ◄──── extraction-complete{sid} ──── │                                     │
         │                                     │                                     │
         │                                     │ 5. chrome.tabs.create               │
         │                                     │   bridge-classroom.com/analyze#sid=<uuid>
         │                                     │ ────────────────────────────────►   │
         │                                     │                                     │
         │                                     │                       6. content script
         │                                     │                          reads location.hash
         │                                     │                          (run_at: document_start)
         │                                     │                                     │
         │                                     │ ◄── consume-pending-session{sid} ── │
         │                                     │                                     │
         │                                     │ 7. read + delete                    │
         │                                     │ ────── envelope JSON ───────────►   │
         │                                     │                                     │
         │                                     │                       8. content script writes
         │                                     │                          sessionStorage
         │                                     │                          ['pending-session']
         │                                     │                                     │
         │                                     │                       9. SPA mounts, reads
         │                                     │                          sessionStorage,
         │                                     │                          removes key, renders
         │                                     │                                     │
```

## Storage layout

### `chrome.storage.local` (extension side, transient)

```jsonc
{
  "pending-sessions:<uuid>": {
    "stored_at": 1714241400000, // Date.now() at write time
    "envelope": <Envelope>,     // see below
  }
}
```

- Keys are namespaced under `pending-sessions:` to keep them out of the way of other future state.
- The service worker deletes the key as soon as the analyzer content script consumes it.
- A garbage-collection sweep on service-worker startup removes any entry older than 1 hour to handle the case where the user clicked the button but never opened the analyzer tab.

### `window.sessionStorage` (analyzer page, ephemeral)

Single key:

```
sessionStorage['pending-session'] = JSON.stringify(<Envelope>)
```

- Lifetime: tied to the tab. Closing the tab clears it. Reloading the analyzer page within the same tab preserves it (which is intentional — refresh during analysis shouldn't lose the session).
- The SPA is responsible for removing the key after it has consumed the data (see [§ SPA contract](#spa-contract)).

## JSON envelope

The value of both `chrome.storage.local`'s `envelope` field and `sessionStorage['pending-session']` is the tournaments-tree envelope defined in [normalized-schema.md](normalized-schema.md):

```jsonc
{
  "schema_version": "2.0",
  "source": "acbl-live", // or "club-game-bws", future sources, etc.
  "fetched_at": "2026-04-26T18:30:00Z",
  "tournaments": [
    /* one or more Tournament trees, per normalized-schema.md */
  ],
}
```

The SPA validates `schema_version` on read and refuses unknown major versions.

## Message protocol

All messages flow through `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`. Every message has a `type` discriminator.

### Source page → service worker

```jsonc
{ "type": "extract-session", "url": "<absolute scorecard URL>" }
```

Response:

```jsonc
// Success
{ "type": "extraction-complete", "sid": "<uuid>" }

// Failure (no analyzer tab opened)
{ "type": "extraction-error", "error": { "code": "<code>", "message": "<human readable>" } }
```

The service worker opens the analyzer tab itself when extraction succeeds — the source content script does not need to navigate. This keeps the source page intact (the user might have other things to do there).

### Analyzer content script → service worker

```jsonc
{ "type": "consume-pending-session", "sid": "<uuid from fragment>" }
```

Response:

```jsonc
// Found
{ "type": "pending-session", "envelope": <Envelope> }

// Not found / expired / wrong tab
{ "type": "no-pending-session", "reason": "missing" | "expired" | "malformed" }
```

The service worker deletes the `chrome.storage.local` entry on a successful read so the same `sid` can't be replayed.

## URL fragment

```
https://bridge-classroom.com/analyze#sid=<uuid>
```

- Fragment, not query string, because fragments don't hit servers and don't appear in HTTP referer / access logs.
- The analyzer content script clears the fragment after reading it (`history.replaceState(null, '', location.pathname + location.search)`) so reloads don't re-trigger consumption against an already-deleted `sid`.

## SPA contract

This is the part the bridge-classroom.com SPA needs to implement.

### On mount of the `/analyze` route

```js
function readPendingSession() {
  const raw = sessionStorage.getItem('pending-session')
  if (raw == null) return { state: 'empty' }

  // Always remove so that hard reloads or route re-mounts don't double-process.
  sessionStorage.removeItem('pending-session')

  let envelope
  try {
    envelope = JSON.parse(raw)
  } catch {
    return { state: 'malformed', reason: 'json-parse' }
  }
  if (typeof envelope !== 'object' || envelope === null) {
    return { state: 'malformed', reason: 'not-object' }
  }
  if (!isSupportedSchemaVersion(envelope.schema_version)) {
    return { state: 'malformed', reason: 'schema-version', got: envelope.schema_version }
  }
  return { state: 'data', envelope }
}

function isSupportedSchemaVersion(v) {
  if (typeof v !== 'string') return false
  // Accept the same major version. Reject unknown majors.
  return v.startsWith('2.')
}
```

### Three states

| State       | Meaning                                                          | Recommended UI                                                                                                                                  |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`      | Valid envelope, ready to analyze.                                | Render the analysis view.                                                                                                                       |
| `empty`     | No `pending-session` key. User navigated to `/analyze` directly. | Show the file-upload / paste / sample-data flow.                                                                                                |
| `malformed` | Key existed but JSON was bad or schema version unsupported.      | Show an error: "We couldn't read the session passed by the extension." Suggest re-running, and include the `reason` for the bug-report channel. |

### Don't poll, don't wait — but be aware

The content script writes `sessionStorage` _after_ a round-trip to the service worker. If the SPA mounts before the round-trip resolves, it sees `state: 'empty'` and shows the upload flow.

In practice, the round-trip is sub-10ms — much faster than React mount in production builds — so this race is rare. The fallback is graceful (the upload flow still works), so we don't bother with polling or coordinating events. If you ever do see frequent empty-state hits when the user expected data, that's a signal to revisit; until then, keep it simple.

The fragment `#sid=<uuid>` is removed by the content script before the SPA mounts, so the SPA shouldn't read or rely on it.

### Idempotency

Reading and removing the key in one synchronous block (as above) means:

- A second mount within the same tab sees `empty` (the key is gone) — correct: the user has already started analyzing this session.
- A hard refresh sees `empty` after the first read — also correct: the data is one-shot.
- Re-running the extension produces a new `sid`, a new fragment, a new round-trip, a new write — independent of any stale state.

If the SPA needs the data to survive a refresh, it should copy the envelope into its own state-management layer after reading.

## Failure modes

| Where               | Symptom                                                                         | Cause                                                                                                                                            | Mitigation                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Service worker      | Extraction fails (network, parse, ACBL Live HTML changed)                       | The user gets `extraction-error` on the source page, no tab opens, no `chrome.storage.local` write.                                              | Source content script surfaces the error message in its UI. Console logs include the parser's selector / HTML snippet for debugging. |
| Analyzer page       | `state: 'empty'`                                                                | Round-trip hadn't completed by mount, OR user navigated to `/analyze` without a `sid` fragment, OR the storage entry expired before consumption. | SPA falls back to upload flow. Acceptable.                                                                                           |
| Service worker → SW | `consume-pending-session` returns `no-pending-session` with `reason: "expired"` | User opened the analyzer tab > 1 hour after extraction.                                                                                          | Content script writes nothing to `sessionStorage`. SPA shows `empty` state.                                                          |
| SPA                 | `state: 'malformed'`                                                            | Schema-version skew (extension upgraded, SPA didn't) or storage corruption.                                                                      | SPA shows malformed-state UI with the `reason`. User re-runs the extension after the SPA is updated.                                 |

## Security & privacy notes

- Envelope contains real player names and ACBL IDs, but only data the user already had access to on `live.acbl.org` (results pages are public).
- `sessionStorage` is per-origin and per-tab; no other site can read it.
- We don't touch `localStorage` (persists across tabs/restarts) or `IndexedDB` (heavier, more failure modes) for the handoff.
- `chrome.storage.local` is extension-scoped, not visible to web pages directly. Only the extension's own scripts can read it, and only the analyzer content script ever requests a specific `sid`.

## Versioning this protocol

The protocol itself isn't versioned separately — it piggybacks on `schema_version` in the envelope. If a non-additive change to message types or the storage layout is needed (e.g., introducing chunked transfers for very large sessions), bump `schema_version`'s major and update both sides in lockstep.
