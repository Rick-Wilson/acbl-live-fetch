# Ingest Protocol (v1)

The contract between the extension and any Bridge Classroom ingest page.
Implements [ADR 0001](adr/0001-ingest-endpoint-and-postmessage-handoff.md);
supersedes [handoff-protocol.md](handoff-protocol.md) once shipped.

Three pieces of code:

- **Service worker** (`src/background.js`) — runs the adapter, holds the payload
  in `chrome.storage.local` under a UUID for `PENDING_TTL_MS` (1 hour).
- **Ingest content script** (`src/ui/ingestContent.js`) — matched on the whole
  origin, bridges the service worker to the page.
- **Ingest page** (`bridge-classroom.{org,com}/ingest`) — everything after the
  handshake: decode, summarize, persist, sync.

If you're implementing the page, you need [§ Page contract](#page-contract) and
nothing else.

## Entry point

The extension opens:

```
https://bridge-classroom.{org,com}/ingest?v=1#sid=<uuid>       one session
https://bridge-classroom.{org,com}/ingest?v=1#batch=<uuid>     many events
```

`?v=1` versions **this transport contract**. It does not describe the payload —
each envelope carries its own `schema_version` (currently `"1.0"`, see
[normalized-schema.md](normalized-schema.md)), and the page dispatches on that
for payload shape. Bump `v` only when the message sequence below changes.

The fragment carries the reference (`ref`) the page echoes back. The content
script clears it **only after `ready` arrives** — clearing earlier races the
page's own read of the hash, and the page cannot recover a `ref` it never saw.
Receiving `ready` proves the page already has it.

## Message sequence

All messages travel by `window.postMessage` between the content script and the
page. Every message is an object with `channel: 'bc-ingest'`, `v: 1`, a `type`,
and the `ref` from the fragment.

```
page                                   content script                service worker
 │                                          │                              │
 │  ready {ref}                             │                              │
 │─────────────────────────────────────────>│                              │
 │                                          │  consume-pending-{session,batch}
 │                                          │─────────────────────────────>│
 │                                          │<─────────────────────────────│
 │  begin {ref, kind, parts, bytes}         │                              │
 │<─────────────────────────────────────────│                              │
 │  chunk {ref, seq, encoding, data}        │                              │
 │<─────────────────────────────────────────│   (repeated, seq 0..parts-1) │
 │  finish {ref, parts, errors}             │                              │
 │<─────────────────────────────────────────│                              │
 │  ack {ref, ok, summary}                  │                              │
 │─────────────────────────────────────────>│                              │
```

The page speaks first. `postMessage` has no delivery guarantee to a listener
that isn't attached yet, so the content script waits rather than firing blind —
this is the one behavioural difference from the old `sessionStorage` write,
which was durable per-tab and needed no handshake.

Two rules make the handshake survive startup ordering. Both were added after an
end-to-end test found the handoff stranded:

- **The page repeats `ready` every 250 ms until `begin` arrives.** A single
  `ready` is fragile: the page's inline script routinely runs before the content
  script's dynamic `import()` resolves, and a missed `ready` strands the handoff
  with no recovery path.
- **The content script attaches its listener synchronously at
  `document_start`,** before any `await`. Retrying covers the rest, but a
  listener behind an async import misses the early attempts for no reason.

### Messages

**`ready`** — page → content script. Sent once the page's listener is attached.

```js
{ channel: 'bc-ingest', v: 1, type: 'ready', ref: '<uuid>' }
```

**`begin`** — content script → page.

```js
{ channel: 'bc-ingest', v: 1, type: 'begin', ref,
  kind: 'session' | 'batch',
  parts: 1,            // number of chunk messages to expect
  bytes: 123456 }      // approximate decoded size, for progress UI
```

**`chunk`** — content script → page, `parts` times, `seq` ascending from 0.

```js
{ channel: 'bc-ingest', v: 1, type: 'chunk', ref, seq: 0,
  encoding: 'json' | 'gzip+base64',
  data: '<string>' }
```

One chunk per envelope. `kind: 'session'` is always a single chunk. Batches send
one chunk per event, which is what keeps a full history from crossing as one
enormous structured clone — a single oversized payload has already bitten us
once, silently, in the `#bcdev-mega` export.

`gzip+base64` is what batch items are already stored as
([handlers.js:78-96](../src/background/handlers.js#L78-L96)); the page decodes
with `DecompressionStream('gzip')`. Sessions are sent as `json`. Handle both —
do not assume by `kind`.

**`finish`** — content script → page.

```js
{ channel: 'bc-ingest', v: 1, type: 'finish', ref,
  parts: 12,                                    // must equal chunks sent
  errors: [{ url, error }] }                    // per-event extraction failures
```

`errors` are events the extension failed to fetch. They are reported, not
retried, and the page should surface the count.

**`error`** — content script → page, terminal, may arrive instead of `begin`.

```js
{ channel: 'bc-ingest', v: 1, type: 'error', ref,
  reason: 'expired' | 'not-found' | 'malformed' | 'send-failed',
  detail: '<string>' }
```

`expired` means the payload aged past the 1-hour TTL — the user left the tab
too long. It is a normal outcome, not a bug; say so plainly.

**`ack`** — page → content script, after persisting.

```js
{ channel: 'bc-ingest', v: 1, type: 'ack', ref,
  ok: true,
  summary: { /* see below */ } }
```

The extension does not act on `ack` today beyond logging, but sending it is
required: it is how the extension will later distinguish "delivered" from
"delivered and stored" without another protocol revision.

## Timeouts

| Waiting for | Limit | On expiry |
|---|---|---|
| Page: `begin` after `ready` | 5 s | Show "extension did not respond"; offer reload |
| Page: next `chunk` | 15 s | Treat as failed; discard partial |
| Content script: `ready` | 10 s | Give up quietly — payload stays in `chrome.storage.local` for the TTL, so a reload recovers it |

The asymmetry is deliberate. The page failing is user-visible and needs a
message; the content script failing usually means the user navigated away, where
silence is correct.

## Security

`window.postMessage` is readable by **any** script running on the page, and any
script can post to it. Both ends must validate:

```js
if (event.source !== window) return
if (event.origin !== window.location.origin) return
if (event.data?.channel !== 'bc-ingest' || event.data.v !== 1) return
if (event.data.ref !== expectedRef) return
```

Per ADR 0001, treat "no third-party scripts on the ingest route" as a standing
constraint — an analytics tag or embedded widget on this origin would be able to
read members' hand records off this channel.

## Page contract

Minimum viable ingester: attach a listener, send `ready`, collect chunks,
summarize, `ack`. Persistence and sync can come later — the protocol doesn't
change when they do.

### Summary shape

What the first ingester records. Counts are cheap to compute from the decoded
envelopes and are the fastest way to confirm end-to-end correctness:

```js
{
  ref, kind,                       // 'session' | 'batch'
  received_at,                     // ISO 8601
  transport_ms,                    // ready → finish
  decode_ms,                       // gunzip + JSON.parse of all chunks
  bytes,                           // decoded JSON length
  envelopes, events, sessions, boards, results,
  sources: ['bbo'],                // distinct envelope.source values
  date_range: ['2024-01-10', '2026-08-01'],   // min/max event.date, or null
  errors: 0                        // from finish.errors
}
```

`transport_ms` and `decode_ms` are separated because they fail differently: slow
transport means chunking or extension pressure, slow decode means payload size.
Averaged over real captures they also tell you whether chunk sizing needs
tuning.

### Reference implementation

```js
// bridge-classroom.{org,com}/ingest
const CHANNEL = 'bc-ingest'
const ref = new URLSearchParams(location.hash.slice(1)).get('sid')
        ?? new URLSearchParams(location.hash.slice(1)).get('batch')

const chunks = []
let meta = null
let t0 = 0

window.addEventListener('message', async (event) => {
  if (event.source !== window) return
  if (event.origin !== location.origin) return
  const m = event.data
  if (m?.channel !== CHANNEL || m.v !== 1 || m.ref !== ref) return

  switch (m.type) {
    case 'begin':
      meta = m
      break
    case 'chunk':
      chunks[m.seq] = m
      break
    case 'error':
      render({ failed: m.reason, detail: m.detail })
      break
    case 'finish': {
      const transport_ms = performance.now() - t0
      const d0 = performance.now()
      const envelopes = await Promise.all(chunks.map(decode))
      const summary = summarize(envelopes, {
        ref, kind: meta.kind, transport_ms,
        decode_ms: performance.now() - d0,
        errors: m.errors?.length ?? 0,
      })
      await persist(summary)          // v1: whatever you like — even console
      render(summary)
      post({ type: 'ack', ok: true, summary })
      break
    }
  }
})

function post(msg) {
  window.postMessage({ channel: CHANNEL, v: 1, ref, ...msg }, location.origin)
}

async function decode(chunk) {
  if (chunk.encoding === 'json') return JSON.parse(chunk.data)
  const bytes = Uint8Array.from(atob(chunk.data), (c) => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}

function summarize(envelopes, base) {
  const counts = { envelopes: envelopes.length, events: 0, sessions: 0, boards: 0, results: 0 }
  const sources = new Set()
  const dates = []
  for (const env of envelopes) {
    sources.add(env.source)
    for (const t of env.tournaments ?? []) {
      for (const ev of t.events ?? []) {
        counts.events++
        if (ev.date) dates.push(ev.date)
        for (const s of ev.sessions ?? []) {
          counts.sessions++
          for (const b of s.boards ?? []) {
            counts.boards++
            counts.results += (b.results ?? []).length
          }
        }
      }
    }
  }
  dates.sort()
  return {
    ...base, ...counts,
    received_at: new Date().toISOString(),
    sources: [...sources],
    date_range: dates.length ? [dates[0], dates.at(-1)] : null,
  }
}

// Speak first — the content script is waiting for this.
t0 = performance.now()
post({ type: 'ready' })
```

`persist` is deliberately unspecified for v1. A single IndexedDB store of
summaries keyed by `ref` is enough to prove the path end to end, and nothing in
this contract changes when it grows into the real archive and backend sync.

## Notes for the extension side

Not yet implemented. When `src/ui/ingestContent.js` is written it should:

- Match the whole origin, per ADR 0001 Decision 1.
- Reuse the `begin`/`chunk`/`finish` chunking already proven in
  `src/ui/bboLobbyContent.js`, rather than a second implementation.
- Keep `consume-pending-session` / `consume-pending-batch` unchanged. This is a
  transport change; the service worker's storage and TTL behaviour is untouched.
