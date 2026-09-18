import assert from 'node:assert/strict'
import { afterEach, describe, it, vi } from 'vitest'

import { type EvalRunEvent, exportEvalRuns } from '../src/otel-export'

const event: EvalRunEvent = {
  runId: 'run-1',
  runDir: 'run-1',
  timestamp: '2026-09-17T00:00:00Z',
  status: 'finished',
  totalCostUsd: 0,
  totalDurationMs: 1,
}

function respond(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status }))
}

describe('strict eval-runs acknowledgement', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('an unreadable acknowledgement is a failure, never default acceptance', async () => {
    for (const body of ['', '<html>proxy error</html>', '{']) {
      vi.stubGlobal('fetch', async () => new Response(body, { status: 200 }))
      await assert.rejects(
        exportEvalRuns([event], { apiKey: 'test' }),
        /Unreadable eval-runs acknowledgement/,
      )
    }
  })

  it('rejects malformed, missing, fractional, duplicated and inconsistent counts', async () => {
    for (const body of [
      null,
      [],
      true,
      {},
      { accepted: 1 },
      { rejected: [] },
      { accepted: '1', rejected: [] },
      { accepted: -1, rejected: [] },
      { accepted: 0.5, rejected: [] },
      { accepted: 2, rejected: [] },
      { accepted: 0, rejected: [] },
      { accepted: 1, rejected: {} },
      { accepted: 0, rejected: [{ index: 1, reason: 'bad' }] },
      { accepted: 0, rejected: [{ index: 0.5, reason: 'bad' }] },
      { accepted: 0, rejected: [{ index: 0, reason: '' }] },
      { accepted: 0, rejected: [null] },
      {
        accepted: 0,
        rejected: [
          { index: 0, reason: 'bad' },
          { index: 0, reason: 'bad' },
        ],
      },
    ]) {
      respond(body)
      await assert.rejects(
        exportEvalRuns([event], { apiKey: 'test' }),
        /acknowledgement/,
        JSON.stringify(body),
      )
    }
  })

  it('reports partial acceptance without reporting success', async () => {
    respond({ accepted: 1, rejected: [{ index: 1, reason: 'invalid event' }] })
    assert.deepEqual(
      await exportEvalRuns([event, { ...event, runId: 'run-2' }], { apiKey: 'test' }),
      {
        ok: false,
        status: 200,
        accepted: 1,
        rejected: [{ index: 1, reason: 'invalid event' }],
      },
    )
  })

  it('accepts only a complete acknowledgement and preserves HTTP failure', async () => {
    respond({ accepted: 1, rejected: [] })
    assert.equal((await exportEvalRuns([event], { apiKey: 'test' })).ok, true)
    respond({ accepted: 1, rejected: [] }, 503)
    await assert.rejects(
      exportEvalRuns([event], { apiKey: 'test' }),
      /Failed HTTP response claimed/,
    )
    respond({ accepted: 0, rejected: [{ index: 0, reason: 'bad' }] }, 400)
    assert.deepEqual(await exportEvalRuns([event], { apiKey: 'test' }), {
      ok: false,
      status: 400,
      accepted: 0,
      rejected: [{ index: 0, reason: 'bad' }],
    })
  })

  it('validates against the sent batch, not a subsequently mutated array', async () => {
    const events = [event]
    vi.stubGlobal('fetch', async () => {
      events.push({ ...event, runId: 'late' })
      return new Response(JSON.stringify({ accepted: 2, rejected: [] }))
    })
    await assert.rejects(exportEvalRuns(events, { apiKey: 'test' }), /acknowledgement counts/)
  })

  it('rejects whitespace credentials and surfaces transport failures', async () => {
    await assert.rejects(exportEvalRuns([event], { apiKey: ' ' }), /apiKey required/)
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down')
    })
    await assert.rejects(exportEvalRuns([event], { apiKey: 'test' }), /network down/)
  })
})
