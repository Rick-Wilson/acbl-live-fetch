// End-to-end test of the ingest handoff (docs/ingest-protocol.md).
//
// Exercises the real path — service worker storage, content script, chunking,
// postMessage handshake, page decode — against the test ingester, with no
// dependency on BBO, ACBL or the real Bridge Classroom ingest.
//
// The fixture is staged directly into chrome.storage.local via the service
// worker, so no test-only message handler exists in shipped code. Playwright
// can evaluate in an MV3 service worker, which makes a backdoor unnecessary.

import { test, expect, chromium } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const EXTENSION = path.join(REPO, 'dist/test')
const PAGE = path.join(REPO, 'test-ingest/index.html')

const PENDING_PREFIX = 'pending-sessions:'
const PENDING_BATCH_PREFIX = 'pending-batch:'

const SID = '11111111-2222-4333-8444-555555555555'
const BATCH_KEY = '99999999-8888-4777-8666-555555555555'

function envelope({ date = '2026-04-29', boards = 2, results = 3 } = {}) {
  return {
    schema_version: '1.0',
    source: 'bbo',
    fetched_at: '2026-04-29T12:00:00.000Z',
    source_url: 'https://www.bridgebase.com/myhands/hands.php?tourney=1-2',
    tournaments: [{
      sanction: '81382',
      schedule_url: null,
      name: 'Test Tournament',
      events: [{
        event_id: '81382-1777478400',
        event_type: 'open_pairs',
        name: 'Test Event',
        date,
        scoring: 'matchpoints',
        sessions: [{
          session_number: 1,
          time: null,
          user_pair: null,
          partial: false,
          warnings: [],
          boards: Array.from({ length: boards }, (_, b) => ({
            number: b + 1,
            section: null,
            dealer: 'N',
            vulnerability: 'None',
            deal: null,
            double_dummy: null,
            par: [],
            user_result_index: 0,
            results: Array.from({ length: results }, () => ({
              contract: '3NT', declarer: 'S', tricks: 9, score: 400,
              matchpoints: 5, percentage: null, imps: null,
              ns_pair: { number: 1, players: [{ name: 'a' }, { name: 'b' }] },
              ew_pair: { number: 2, players: [{ name: 'c' }, { name: 'd' }] },
              auction: null, play: null, handviewer_url: null,
            })),
          })),
        }],
      }],
    }],
  }
}

// Matches handlers.js compressEnvelope: gzip then base64.
function compress(env) {
  return gzipSync(Buffer.from(JSON.stringify(env))).toString('base64')
}

function startServer() {
  const html = fs.readFileSync(PAGE, 'utf8')
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Serve the ingester for anything under /ingest — the content script
      // gates on the path, so the route has to look real.
      if (req.url.startsWith('/ingest')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(html)
      } else {
        res.writeHead(404)
        res.end('not found')
      }
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'acbl-e2e-'))
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  })
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  return { context, sw, profile }
}

test.describe('ingest handoff', () => {
  let context, sw, server, port

  test.beforeAll(async () => {
    if (!fs.existsSync(EXTENSION)) {
      throw new Error(`missing ${EXTENSION} — run: INGEST_TEST=1 npx vite build --outDir dist/test`)
    }
    ;({ server, port } = await startServer())
    ;({ context, sw } = await launch())
  })

  test.afterAll(async () => {
    await context?.close()
    server?.close()
  })

  async function stage(key, value) {
    await sw.evaluate(async ([k, v]) => {
      await chrome.storage.local.set({ [k]: v })
    }, [key, value])
  }

  test('delivers a single session and summarizes it', async () => {
    await stage(`${PENDING_PREFIX}${SID}`, {
      stored_at: Date.now(),
      envelope: envelope({ boards: 2, results: 3 }),
    })

    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}/ingest/#sid=${SID}`)

    await expect(page.getByTestId('state')).toHaveClass(/ok/, { timeout: 15000 })
    await expect(page.getByTestId('row-kind')).toHaveText('session')
    await expect(page.getByTestId('row-envelopes')).toHaveText('1')
    await expect(page.getByTestId('row-boards')).toHaveText('2')
    await expect(page.getByTestId('row-results')).toHaveText('6')  // 2 boards x 3
    await expect(page.getByTestId('row-sources')).toHaveText('bbo')
    await page.close()
  })

  test('delivers a gzipped batch as one chunk per envelope', async () => {
    await stage(`${PENDING_BATCH_PREFIX}${BATCH_KEY}`, {
      stored_at: Date.now(),
      total: 3,
      done: true,
      errors: [{ url: 'https://example.test/x', error: 'failed' }],
      items: [
        { compressed: compress(envelope({ date: '2026-04-01', boards: 1, results: 2 })), source_url: 'a' },
        { compressed: compress(envelope({ date: '2026-05-01', boards: 2, results: 2 })), source_url: 'b' },
        { compressed: compress(envelope({ date: '2026-06-01', boards: 1, results: 2 })), source_url: 'c' },
      ],
    })

    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}/ingest/#batch=${BATCH_KEY}`)

    await expect(page.getByTestId('state')).toHaveClass(/ok/, { timeout: 15000 })
    await expect(page.getByTestId('row-kind')).toHaveText('batch')
    await expect(page.getByTestId('row-envelopes')).toHaveText('3')
    await expect(page.getByTestId('row-boards')).toHaveText('4')
    await expect(page.getByTestId('row-results')).toHaveText('8')
    // Date range proves the gzip chunks decoded into distinct envelopes rather
    // than the same one three times.
    await expect(page.getByTestId('row-date-range')).toHaveText('2026-04-01 .. 2026-06-01')
    await expect(page.getByTestId('row-fetch-errors')).toHaveText('1')
    await page.close()
  })

  test('reports expiry rather than hanging', async () => {
    const stale = '22222222-3333-4444-8555-666666666666'
    await stage(`${PENDING_PREFIX}${stale}`, {
      stored_at: Date.now() - 2 * 60 * 60 * 1000,   // past the 1 hour TTL
      envelope: envelope(),
    })

    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}/ingest/#sid=${stale}`)

    await expect(page.getByTestId('state')).toHaveClass(/fail/, { timeout: 15000 })
    await expect(page.getByTestId('state')).toContainText('expired')
    await page.close()
  })

  test('reports a missing payload rather than hanging', async () => {
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}/ingest/#sid=33333333-4444-4555-8666-777777777777`)

    await expect(page.getByTestId('state')).toHaveClass(/fail/, { timeout: 15000 })
    // Assert the reason, not just failure: before the ready-handshake fix this
    // passed for the wrong reason ("extension did not respond").
    await expect(page.getByTestId('state')).toContainText('not-found')
    await page.close()
  })

  // Regression guard for the bug this suite found: the page's inline script can
  // post `ready` before the content script's dynamic import resolves. The page
  // repeats `ready` and the content script attaches its listener synchronously,
  // so a slow start must still deliver.
  test('survives the page announcing ready before the content script is up', async () => {
    const ref = '44444444-5555-4666-8777-888888888888'
    await stage(`${PENDING_PREFIX}${ref}`, {
      stored_at: Date.now(),
      envelope: envelope({ boards: 3, results: 2 }),
    })

    const page = await context.newPage()
    // Block until well after the content script would normally have started,
    // so `ready` fires into an empty room on the first attempt.
    await page.route('**/ingest*', async (route) => {
      await new Promise((r) => setTimeout(r, 1200))
      await route.continue()
    })
    await page.goto(`http://127.0.0.1:${port}/ingest/#sid=${ref}`)

    await expect(page.getByTestId('state')).toHaveClass(/ok/, { timeout: 15000 })
    await expect(page.getByTestId('row-boards')).toHaveText('3')
    await page.close()
  })
})
