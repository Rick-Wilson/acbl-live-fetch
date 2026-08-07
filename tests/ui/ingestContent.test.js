import { describe, it, expect } from 'vitest'
import { parseRef, isIngestPath, toChunks } from '../../src/ui/ingestContent.js'

const UUID = '11111111-2222-4333-8444-555555555555'

describe('parseRef', () => {
  it('reads a session ref', () => {
    expect(parseRef(`#sid=${UUID}`)).toEqual({ kind: 'session', ref: UUID })
  })

  it('reads a batch ref', () => {
    expect(parseRef(`#batch=${UUID}`)).toEqual({ kind: 'batch', ref: UUID })
  })

  it('rejects a malformed uuid', () => {
    expect(parseRef('#sid=nope')).toBeNull()
    expect(parseRef('#sid=')).toBeNull()
  })

  it('ignores unrelated fragments', () => {
    expect(parseRef('#section=2')).toBeNull()
    expect(parseRef('')).toBeNull()
    expect(parseRef(null)).toBeNull()
  })

  it('prefers sid when both are present', () => {
    expect(parseRef(`#sid=${UUID}&batch=${UUID}`).kind).toBe('session')
  })
})

describe('isIngestPath', () => {
  it.each([
    ['/ingest', true],
    ['/ingest/', true],
    ['/ingest///', true],
    // A GitHub Pages *project* site serves under a repo-name prefix, which is
    // how the test ingester is reached end to end.
    ['/acbl-live-fetch/ingest/', true],
    ['/acbl-live-fetch/ingest', true],
    ['/game-analysis/', false],
    ['/', false],
    ['/ingested', false],
  ])('%s -> %s', (path, expected) => {
    expect(isIngestPath(path)).toBe(expected)
  })

  // The gate exists because analyzerContent.js consumes the same #sid fragment
  // on /game-analysis/, and the first consumer deletes the stored entry.
  it('does not match the analyzer route', () => {
    expect(isIngestPath('/game-analysis/')).toBe(false)
  })
})

describe('toChunks', () => {
  it('sends a session as one json chunk', () => {
    const envelope = { source: 'bbo', tournaments: [] }
    expect(toChunks('session', { envelope })).toEqual([
      { encoding: 'json', data: JSON.stringify(envelope) },
    ])
  })

  it('forwards batch items already gzipped, one chunk each', () => {
    const items = [{ compressed: 'AAA', source_url: 'a' }, { compressed: 'BBB', source_url: 'b' }]
    expect(toChunks('batch', { items })).toEqual([
      { encoding: 'gzip+base64', data: 'AAA' },
      { encoding: 'gzip+base64', data: 'BBB' },
    ])
  })

  it('handles an empty batch', () => {
    expect(toChunks('batch', {})).toEqual([])
  })
})
