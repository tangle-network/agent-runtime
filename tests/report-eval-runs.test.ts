import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OptimizePromptResult } from '../src/improvement/optimize-prompt'
import {
  optimizePromptResultToEvalRunEvents,
  reportOptimizationRun,
} from '../src/improvement/report-eval-runs'
import { INTELLIGENCE_WIRE_VERSION } from '../src/otel-export'

// Minimal stand-in for a CampaignResult — the mapper only reads
// `aggregates.byScenario[*].meanComposite`.
const campaign = (composite: number): unknown => ({
  aggregates: { byScenario: { s1: { meanComposite: composite } } },
})

function fakeResult(
  over: Partial<OptimizePromptResult<unknown, never>> = {},
): OptimizePromptResult<unknown, never> {
  const raw = {
    winnerSurfaceHash: 'h-win',
    generations: [
      {
        record: {},
        surfaces: [
          { surfaceHash: 'h-a', surface: {}, campaign: campaign(0.55) },
          { surfaceHash: 'h-win', surface: {}, campaign: campaign(0.7) },
        ],
      },
    ],
  }
  return {
    prompt: 'winner prompt',
    improved: true,
    decision: 'ship',
    reasons: ['+0.2 composite on holdout'],
    baselineComposite: 0.5,
    winnerComposite: 0.7,
    delta: 0.2,
    rationale: 'because the baseline missed the citation step',
    diff: '--- a\n+++ b\n+cite sources',
    raw,
    ...over,
  } as OptimizePromptResult<unknown, never>
}

const meta = {
  runId: 'rsi-7',
  runDir: 'rsi/finsearch/abc',
  totalCostUsd: 0.42,
  totalDurationMs: 12_345,
  now: () => new Date('2026-06-03T00:00:00.000Z'),
}

describe('optimizePromptResultToEvalRunEvents', () => {
  it('projects a shipped run to one finished event with real economics + lift', () => {
    const [event, ...rest] = optimizePromptResultToEvalRunEvents(fakeResult(), meta)
    expect(rest).toHaveLength(0)
    expect(event!.runId).toBe('rsi-7')
    expect(event!.status).toBe('finished')
    expect(event!.timestamp).toBe('2026-06-03T00:00:00.000Z')
    expect(event!.gateDecision).toBe('ship')
    expect(event!.holdoutLift).toBe(0.2)
    expect(event!.totalCostUsd).toBe(0.42)
    expect(event!.totalDurationMs).toBe(12_345)
    expect(event!.baseline!.compositeMean).toBe(0.5)
    expect(event!.baseline!.index).toBe(0)
    expect(event!.labels!.rsiImproved).toBe('true')
    expect(event!.labels!.rsiDecision).toBe('ship')
  })

  it('scores each generation by its best candidate + tags the winner with diff/rationale', () => {
    const [event] = optimizePromptResultToEvalRunEvents(fakeResult(), meta)
    expect(event!.generations).toHaveLength(1)
    const gen = event!.generations![0]!
    expect(gen.index).toBe(1) // generation 0 is the baseline
    expect(gen.surfaceHash).toBe('h-win') // max composite (0.7 > 0.55)
    expect(gen.compositeMean).toBe(0.7)
    const surface = gen.surface as Record<string, unknown>
    expect(surface.winner).toBe(true)
    expect(surface.diff).toContain('cite sources')
    expect(surface.rationale).toContain('citation step')
  })

  it('merges caller labels over the derived defaults', () => {
    const [event] = optimizePromptResultToEvalRunEvents(fakeResult(), {
      ...meta,
      labels: { stage: 'nightly', rsiDecision: 'overridden' },
    })
    expect(event!.labels!.stage).toBe('nightly')
    expect(event!.labels!.rsiDecision).toBe('overridden') // caller wins
    expect(event!.labels!.rsiImproved).toBe('true') // derived default kept
  })

  it('does NOT tag a winner when the gate held the baseline', () => {
    const [event] = optimizePromptResultToEvalRunEvents(
      fakeResult({ improved: false, decision: 'hold' }),
      meta,
    )
    expect(event!.gateDecision).toBe('hold')
    const surface = event!.generations![0]!.surface as Record<string, unknown>
    expect(surface.winner).toBeUndefined()
  })

  it('FAILS LOUD on a gate decision outside the wire enum (no silent cast)', () => {
    // a custom gate emitting a non-wire decision must map it first
    const bad = fakeResult({
      decision: 'investigate' as OptimizePromptResult<unknown, never>['decision'],
    })
    expect(() => optimizePromptResultToEvalRunEvents(bad, meta)).toThrow(/not a wire gateDecision/)
  })
})

describe('reportOptimizationRun', () => {
  afterEach(() => {
    delete process.env.TANGLE_API_KEY
    delete process.env.INTELLIGENCE_BASE
    vi.unstubAllGlobals()
  })

  it('ships the projected event via exportEvalRuns with runId as the Idempotency-Key', async () => {
    let captured:
      | { url: string; init: { headers: Record<string, string>; body: string } }
      | undefined
    const mockFetch = vi.fn(
      async (url: string, init: { headers: Record<string, string>; body: string }) => {
        captured = { url, init }
        return new Response(JSON.stringify({ accepted: 1, rejected: [] }), { status: 200 })
      },
    )
    vi.stubGlobal('fetch', mockFetch)

    const r = await reportOptimizationRun(fakeResult(), meta, {
      apiKey: 'sk-tan-test',
      base: 'https://intel.example',
    })
    expect(r.ok).toBe(true)
    expect(r.accepted).toBe(1)
    expect(captured!.url).toBe('https://intel.example/v1/ingest/eval-runs')
    expect(captured!.init.headers['Idempotency-Key']).toBe('rsi-7')
    expect(captured!.init.headers['X-Tangle-Wire-Version']).toBe(INTELLIGENCE_WIRE_VERSION)
    const body = JSON.parse(captured!.init.body)
    expect(body.events[0].gateDecision).toBe('ship')
    expect(body.events[0].totalCostUsd).toBe(0.42)
  })

  it('throws (does not swallow) when no API key is configured', async () => {
    await expect(reportOptimizationRun(fakeResult(), meta)).rejects.toThrow(/apiKey required/)
  })
})
