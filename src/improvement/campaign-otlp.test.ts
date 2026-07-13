/**
 * Campaign spans→OTLP converter + resolver proof, at the REAL seams:
 *
 *  1. The published `runCampaign` records `spans.jsonl` per cell (nothing
 *     hand-crafted); `campaignTraceResolver` converts that recording to
 *     OTLP-flat JSONL the published `OtlpFileTraceStore` indexes — the exact
 *     store the trace-analyst registry reads.
 *  2. The published `traceAnalystProposer` wired with the resolver produces a
 *     candidate from those real recorded traces (analyze + apply seams
 *     injected — offline, no LLM).
 *
 * The regression this guards: the campaign trace format
 * (`{name, cellId, startMs, durationMs, ...attrs}`) is NOT the OTLP shape the
 * analysts parse, so without the converter every trace-native proposer threw
 * "resolveTraces returned no OTLP traces" on the traces the loop itself wrote.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFinding } from '@tangle-network/agent-eval'
import {
  runCampaign,
  type Scenario,
  traceAnalystProposer,
} from '@tangle-network/agent-eval/campaign'
import type { DispatchContext } from '@tangle-network/agent-eval/contract'
import { OtlpFileTraceStore } from '@tangle-network/agent-eval/traces'
import { afterAll, describe, expect, it } from 'vitest'
import {
  campaignCellSpansToOtlp,
  campaignTraceResolver,
  convertCampaignDirToOtlp,
} from './campaign-otlp'

const scenarios: Scenario[] = [
  { id: 'alpha', kind: 'fixture' },
  { id: 'beta', kind: 'fixture' },
]

/** Dispatch that reports usage AND records a tool-ish span — the two write
 *  paths (`ctx.cost.observe` → `cost.<source>` spans, `ctx.trace.span`) the
 *  real substrate uses to populate `spans.jsonl`. */
async function tracedDispatch(scenario: Scenario, ctx: DispatchContext): Promise<{ text: string }> {
  ctx.cost.observe(0.0002, 'stub')
  ctx.cost.observeTokens({ input: 3, output: 5 })
  const span = ctx.trace.span('worker.turn', { 'tool.name': 'grep' })
  span.end({ outcome: 'ok' })
  return { text: `artifact-${scenario.id}` }
}

const root = mkdtempSync(join(tmpdir(), 'campaign-otlp-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** One real campaign per loop slot, into the run-optimization layout. */
async function recordLayout(): Promise<void> {
  for (const dir of [join(root, 'baseline'), join(root, 'gen-0', 'candidate-0')]) {
    await runCampaign<Scenario, { text: string }>({
      scenarios,
      dispatch: tracedDispatch,
      runDir: dir,
      resumable: false,
    })
  }
}

describe('campaignTraceResolver — real runCampaign recording → OTLP the analysts index', () => {
  it('converts the recorded spans.jsonl and OtlpFileTraceStore indexes them', async () => {
    await recordLayout()

    // Proposing generation 0 reads the BASELINE campaign's traces.
    const resolver = campaignTraceResolver({ runDir: root })
    const otlp = resolver({ generation: 0 })
    expect(otlp.trim()).not.toBe('')

    const lines = otlp.trim().split('\n')
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
    // Every line carries the OTLP identity fields the analysts key on.
    for (const p of parsed) {
      expect(typeof p.trace_id).toBe('string')
      expect(typeof p.span_id).toBe('string')
    }
    // One trace per cell: 2 scenarios × 1 rep.
    expect(new Set(parsed.map((p) => p.trace_id)).size).toBe(2)
    const names = parsed.map((p) => p.name as string)
    expect(names.some((n) => n.startsWith('cell.'))).toBe(true)
    expect(names).toContain('cost.stub')
    expect(names).toContain('worker.turn')
    // Only baseline traces — gen-0 stays out of generation 0's view.
    for (const p of parsed) {
      const res = p.resource as { attributes: Record<string, unknown> }
      expect(String(res.attributes['campaign.cell_dir'])).toContain(join(root, 'baseline'))
    }

    // The consumer contract: the published analyst store indexes the output.
    const tracePath = join(root, 'converted.jsonl')
    writeFileSync(tracePath, otlp)
    const store = new OtlpFileTraceStore({ path: tracePath })
    const overview = await store.getOverview()
    expect(overview.total_traces).toBe(2)
    expect(overview.tool_names).toContain('grep')
    expect(overview.errors.span_count).toBe(0)

    // Generation 1 reads gen-0; a generation with no recorded predecessor
    // falls back to every trace under the run root.
    const gen1 = resolver({ generation: 1 })
    expect(gen1).toContain(join(root, 'gen-0'))
    expect(gen1).not.toContain('baseline')
    const gen5 = resolver({ generation: 5 })
    const gen5Ids = new Set(
      gen5
        .trim()
        .split('\n')
        .map((l) => (JSON.parse(l) as { trace_id: string }).trace_id),
    )
    expect(gen5Ids.size).toBe(4)
  })

  it('traceAnalystProposer consumes the resolver end-to-end and returns a candidate', async () => {
    let analyzedTraces = 0
    const proposer = traceAnalystProposer({
      baseUrl: 'https://stub.local/v1',
      apiKey: 'stub-key',
      model: 'stub-model',
      resolveTraces: campaignTraceResolver({ runDir: root }),
      // Analyst seam: assert the materialized trace file is REAL converted
      // content (indexable by the same store the registry uses), then return
      // one finding for the apply step.
      analyze: async (tracePath) => {
        const store = new OtlpFileTraceStore({ path: tracePath })
        const overview = await store.getOverview()
        analyzedTraces = overview.total_traces
        return [
          makeFinding({
            analyst_id: 'test-analyst',
            severity: 'high',
            area: 'tool-use',
            confidence: 1,
            claim: 'worker.turn spans show grep-only exploration',
            recommended_action: 'instruct the agent to read files before editing',
            evidence_refs: [],
          }),
        ]
      },
      // Apply seam: the one LLM edit, stubbed offline.
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'REVISED PROMPT: read before editing' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
            model: 'stub-model',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })

    const candidates = await proposer.propose({
      currentSurface: 'baseline prompt',
      history: [],
      findings: [],
      populationSize: 1,
      generation: 0,
      signal: new AbortController().signal,
    })

    expect(analyzedTraces).toBe(2)
    expect(candidates.length).toBeGreaterThanOrEqual(1)
    const first = candidates[0] as { surface: unknown }
    expect(String(first.surface)).toContain('REVISED PROMPT')
  })
})

describe('campaignCellSpansToOtlp — wire-shape unit checks', () => {
  it('maps error records to STATUS_CODE_ERROR and skips torn lines', () => {
    const content = [
      JSON.stringify({ name: 'ok.step', cellId: 'c', startMs: 1000, durationMs: 5 }),
      '{"torn": ',
      JSON.stringify({ name: 'bad.step', cellId: 'c', startMs: 2000, error: 'boom' }),
    ].join('\n')
    const lines = campaignCellSpansToOtlp(content, { cellId: 'c', cellKey: '/tmp/x/c' })
    // Root anchor + 2 records (torn line skipped).
    expect(lines).toHaveLength(3)
    const spans = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
    const anchor = spans[0] as { status: { code: string }; parent_span_id: string }
    expect(anchor.parent_span_id).toBe('')
    expect(anchor.status.code).toBe('STATUS_CODE_ERROR')
    const bad = spans.find((s) => s.name === 'bad.step') as {
      status: { code: string; message: string }
    }
    expect(bad.status).toEqual({ code: 'STATUS_CODE_ERROR', message: 'boom' })
    const ok = spans.find((s) => s.name === 'ok.step') as {
      status: { code: string }
      start_time: string
      end_time: string
    }
    expect(ok.status.code).toBe('STATUS_CODE_OK')
    expect(Date.parse(ok.end_time) - Date.parse(ok.start_time)).toBe(5)
  })

  it('distinct cell paths with the same cellId yield distinct traces', () => {
    const content = JSON.stringify({ name: 's', cellId: 'cell_a', startMs: 1 })
    const a = JSON.parse(
      campaignCellSpansToOtlp(content, { cellId: 'cell_a', cellKey: '/run/baseline/cell_a' })[0]!,
    ) as { trace_id: string }
    const b = JSON.parse(
      campaignCellSpansToOtlp(content, {
        cellId: 'cell_a',
        cellKey: '/run/gen-0/candidate-0/cell_a',
      })[0]!,
    ) as { trace_id: string }
    expect(a.trace_id).not.toBe(b.trace_id)
    expect(a.trace_id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('empty content and an absent dir resolve to no traces, not a throw', () => {
    expect(campaignCellSpansToOtlp('', { cellId: 'c' })).toEqual([])
    expect(convertCampaignDirToOtlp('/nonexistent/definitely-not-here')).toBe('')
  })
})
