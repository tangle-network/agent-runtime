import { fromOtelSpans } from '@tangle-network/agent-eval/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allShapes } from '../examples/agents-of-all-shapes/shapes'
import {
  type AgentRun,
  otelSpansForRun,
  shipToTangleOtlp,
  spansForRuns,
  toInsightReport,
} from '../examples/agents-of-all-shapes/shared/intelligence'

/**
 * Checks the showcase with no sandbox, hosted endpoint, or model key.
 */
describe('agents-of-all-shapes — one intelligence pipe, no sandbox', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits exact run identity, parentage, terminal state, usage, and cost source', () => {
    const [run] = Object.values(allShapes()).flat()
    const [root, modelCall] = otelSpansForRun(run!)

    expect(root!.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(root!.traceId).not.toBe('0'.repeat(32))
    expect(root!.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(root!.spanId).not.toBe('0'.repeat(16))
    expect(modelCall!.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(modelCall!.spanId).not.toBe('0'.repeat(16))
    expect(modelCall!.traceId).toBe(root!.traceId)
    expect(modelCall!.spanId).not.toBe(root!.spanId)
    expect(root).not.toHaveProperty('parentSpanId')
    expect(root).toMatchObject({
      name: 'agent.run',
      'tangle.runId': run!.runId,
      'tangle.scenarioId': run!.scenarioId,
      attributes: {
        'openinference.span.kind': 'AGENT',
        'tangle.runId': run!.runId,
        'tangle.candidateId': run!.candidateId,
        'tangle.scenarioId': run!.scenarioId,
        'tangle.task.score': run!.score,
        'tangle.terminal.outcome': 'succeeded',
        'tangle.cost.provenance': 'observed',
      },
      status: { code: 'OK' },
    })
    expect(modelCall).toMatchObject({
      name: 'gen_ai.chat',
      parentSpanId: root!.spanId,
      'tangle.runId': run!.runId,
      'tangle.scenarioId': run!.scenarioId,
      attributes: {
        'openinference.span.kind': 'LLM',
        'tangle.runId': run!.runId,
        'tangle.candidateId': run!.candidateId,
        'tangle.scenarioId': run!.scenarioId,
        'gen_ai.request.model': run!.model,
        'gen_ai.usage.input_tokens': run!.inputTokens,
        'gen_ai.usage.output_tokens': run!.outputTokens,
        'gen_ai.usage.cost_usd': run!.costUsd,
        'tangle.cost.provenance': 'observed',
      },
      status: { code: 'OK' },
    })
    expect(modelCall!.attributes).not.toHaveProperty('tangle.task.score')
  })

  it('rejects contradictory cost and terminal metadata', () => {
    const [run] = Object.values(allShapes()).flat()

    expect(() =>
      otelSpansForRun({
        ...run!,
        costProvenance: 'uncaptured',
      } as AgentRun),
    ).toThrow('AgentRun uncaptured costUsd must be null')
    expect(() =>
      otelSpansForRun({
        ...run!,
        terminalOutcome: 'failed',
      } as AgentRun),
    ).toThrow('AgentRun failed terminal outcome requires a non-empty reason')
  })

  it('keeps scenario identity stable across candidates and projects exact run metadata', () => {
    const runs = Object.values(allShapes()).map((shapeRuns) => shapeRuns[0]!)
    expect(new Set(runs.map((run) => run.scenarioId))).toEqual(new Set(['scenario-00']))
    expect(new Set(runs.map((run) => run.candidateId)).size).toBe(runs.length)
    expect(new Set(runs.map((run) => run.runId)).size).toBe(runs.length)

    const records = fromOtelSpans({ spans: spansForRuns(runs) })
    expect(records).toHaveLength(runs.length)
    for (const run of runs) {
      expect(records.find((record) => record.runId === run.runId)).toMatchObject({
        candidateId: run.candidateId,
        scenarioId: run.scenarioId,
        terminalOutcome: 'succeeded',
        costUsd: run.costUsd,
        costProvenance: { kind: 'observed', usd: run.costUsd },
      })
    }
  })

  it('keeps failed execution distinct from missing quality and uncaptured cost', () => {
    const failed: AgentRun = {
      runId: 'candidate-a:scenario-failed:seed-0',
      candidateId: 'candidate-a',
      scenarioId: 'scenario-failed',
      model: 'provider/model@snapshot',
      score: null,
      costUsd: null,
      costProvenance: 'uncaptured',
      inputTokens: 0,
      outputTokens: 0,
      startMs: 1_700_000_000_000,
      durationMs: 250,
      terminalOutcome: 'failed',
      terminalFailureReason: 'provider request failed before a response',
    }

    const spans = otelSpansForRun(failed)
    expect(spans[0]).toMatchObject({
      attributes: {
        'tangle.terminal.outcome': 'failed',
        'tangle.cost.provenance': 'uncaptured',
      },
      status: { code: 'ERROR', message: failed.terminalFailureReason },
    })
    expect(spans[0]!.attributes).not.toHaveProperty('tangle.task.score')
    expect(spans[1]!.attributes).not.toHaveProperty('gen_ai.usage.cost_usd')

    expect(fromOtelSpans({ spans })[0]).toMatchObject({
      runId: failed.runId,
      candidateId: failed.candidateId,
      scenarioId: failed.scenarioId,
      terminalOutcome: 'failed',
      terminalFailureReason: failed.terminalFailureReason,
      costUsd: null,
      costProvenance: { kind: 'uncaptured', usd: null },
    })
  })

  it('ships the same hierarchy and metadata in a confirmed OTLP request', async () => {
    const [run] = Object.values(allShapes()).flat()
    const spans = otelSpansForRun(run!)
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await shipToTangleOtlp(spans, {
      endpoint: 'https://intelligence.example/v1/otlp',
      apiKey: 'test-key',
      serviceName: 'shape-test',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://intelligence.example/v1/otlp/v1/traces')
    const body = JSON.parse(String(init?.body))
    const resource = body.resourceSpans[0]
    expect(resource.resource.attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'shape-test' },
    })
    expect(resource.scopeSpans[0].scope).toEqual({
      name: '@tangle-network/agent-runtime',
    })
    const [root, modelCall] = resource.scopeSpans[0].spans
    expect(modelCall.parentSpanId).toBe(root.spanId)
    expect(modelCall.traceId).toBe(root.traceId)
    expect(root.attributes).toContainEqual({
      key: 'tangle.candidateId',
      value: { stringValue: run!.candidateId },
    })
  })

  it('rejects hosted delivery when the collector rejects any span', async () => {
    const [run] = Object.values(allShapes()).flat()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          partialSuccess: {
            rejectedSpans: '1',
            errorMessage: 'invalid span',
          },
        }),
      ),
    )

    await expect(
      shipToTangleOtlp(otelSpansForRun(run!), {
        endpoint: 'https://intelligence.example/v1/otlp',
        apiKey: 'test-key',
      }),
    ).rejects.toThrow('rejected 1 spans despite HTTP 200: invalid span')
  })

  it('every shape produces a real InsightReport in-process', async () => {
    const shapes = allShapes()
    expect(Object.keys(shapes).sort()).toEqual([
      'claude-agent-sdk',
      'mastra',
      'openai-compatible',
      'tangle-runtime',
    ])

    for (const [name, runs] of Object.entries(shapes)) {
      expect(runs.length).toBeGreaterThan(0)
      const report = await toInsightReport(spansForRuns(runs))
      // Real decision packet per framework — composite over its runs.
      expect(report.composite.n).toBe(runs.length)
      expect(report.composite.mean).toBeGreaterThan(0)
      expect(report.composite.mean).toBeLessThanOrEqual(1)
      expect(report.composite.min).toBeGreaterThanOrEqual(0)
      expect(report.composite.max).toBeLessThanOrEqual(1)
      expect(Array.isArray(report.recommendations)).toBe(true)
      // Cost/quality Pareto is computed from the gen_ai.usage.cost_usd attrs.
      expect(report.costQuality).toBeDefined()
    }
  })

  it('merges all shapes into one fleet report (cross-framework aggregation)', async () => {
    const shapes = allShapes()
    const total = Object.values(shapes).reduce((sum, r) => sum + r.length, 0)
    const fleet = await toInsightReport(spansForRuns(Object.values(shapes).flat()))
    expect(fleet.composite.n).toBe(total)
    // The merged corpus carries failures from multiple frameworks; the
    // canonical failure classes surface the dominant cross-framework cause.
    expect(fleet.failureClasses).toBeDefined()
    expect(fleet.failureClasses!.length).toBeGreaterThan(0)
    expect(fleet.failureClasses![0]!.count).toBeGreaterThan(0)
  })

  it('derives a real cost from gen_ai.usage.cost_usd across shapes', async () => {
    const fleet = await toInsightReport(spansForRuns(Object.values(allShapes()).flat()))
    // The Pareto/cost view is populated from the OTel cost attribute, not zeros.
    expect(fleet.costQuality.cost.n).toBeGreaterThan(0)
    expect(fleet.costQuality.cost.mean).toBeGreaterThan(0)
  })
})
