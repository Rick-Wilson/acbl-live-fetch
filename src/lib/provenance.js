// Envelope provenance: who produced this data, why, and what it covers.
//
// This lives in the envelope rather than the ingest transport because the
// envelope is the durable artifact. A second producer — a results site
// exporting directly from its own server, with no browser extension involved —
// emits an envelope too, and a consumer reading the archive years later needs
// to know what it is holding without re-deriving it from a 100MB scan.

import manifest from '../../manifest.json' with { type: 'json' }

export const SCHEMA_VERSION = '1.1'

// Single source of truth for the version: read from the manifest so the two
// can't drift.
export const PROVIDER = Object.freeze({
  id: 'acbl-live-fetch',
  version: manifest.version,
  kind: 'browser-extension',
})

// How much cardplay the source carries. An enum rather than a boolean because
// "some cardplay" spans cases a consumer must treat differently:
//
//   none        no card-level data at all
//   lead        opening lead only — Bridgemate can be configured to record it,
//               typically for every table
//   user-table  full play, but only for the seat we captured for
//   all-tables  full play for every table on the board
//
// The distinction is load-bearing: user-table supports "how did I play this",
// all-tables supports "how did the field play this". A boolean would make a BBO
// export look identical before and after a replay backfill promotes it from
// user-table to all-tables.
export const CARDPLAY = Object.freeze({
  NONE: 'none',
  LEAD: 'lead',
  USER_TABLE: 'user-table',
  ALL_TABLES: 'all-tables',
})

export const AUCTION = Object.freeze({
  NONE: 'none',
  USER_TABLE: 'user-table',
  ALL_TABLES: 'all-tables',
})

export const RESULTS = Object.freeze({
  USER_TABLE: 'user-table',
  SECTION: 'section',
  ALL_TABLES: 'all-tables',
})

export const SECTIONS = Object.freeze({
  ALL: 'all',
  USER_ONLY: 'user-only',
  NOT_APPLICABLE: 'not-applicable',
})

// Build the provenance block shared by every adapter.
//
// `coverage` describes the data; `capture` describes the request that produced
// it and is supplied by the caller, since an adapter has no idea whether it was
// asked for one session or a year of history.
export function buildProvenance({ coverage, capture } = {}) {
  return {
    provider: { ...PROVIDER },
    ...(capture ? { capture: { ...capture } } : {}),
    coverage: { ...coverage },
  }
}
