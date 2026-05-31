import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildLoopOtelSpans,
  createOtelExporter,
  exportEvalRuns,
  INTELLIGENCE_WIRE_VERSION,
  loopEventToOtelSpan,
  type OtelSpan,
} from '../src/otel-export'

function attrMap(span: OtelSpan): Record<string, string | number | boolean | undefined> {
  const out: Record<string, string | number | boolean | undefined> = {}
  for (const a of span.attributes ?? []) {
    const v = a.value
    out[a.key] =
      v.stringValue ??
      (v.intValue !== undefined ? Number(v.intValue) : undefined) ??
      v.doubleValue ??
      v.boolValue
  }
  return out
}

describe('buildLoopOtelSpans — nested GenAI topology tree', () => {
  // One dynamic-loop run: round 0 fans out 2 branches (with rationale), then stops.
  const events = [
    {
      kind: 'loop.started',
      runId: 'run-1',
      timestamp: 1000,
      payload: {
        driver: 'dynamic',
        agentRunNames: ['claude', 'codex'],
        maxIterations: 8,
        maxConcurrency: 4,
      },
    },
    {
      kind: 'loop.plan',
      runId: 'run-1',
      timestamp: 1010,
      payload: {
        roundIndex: 0,
        plannedCount: 2,
        moveKind: 'fanout',
        rationale: 'attempts disagree; fan to 2 harnesses',
      },
    },
    {
      kind: 'loop.iteration.started',
      runId: 'run-1',
      timestamp: 1020,
      payload: { iterationIndex: 0, agentRunName: 'claude', taskHash: 'h0' },
    },
    {
      kind: 'loop.iteration.dispatch',
      runId: 'run-1',
      timestamp: 1021,
      payload: {
        iterationIndex: 0,
        agentRunName: 'claude',
        placement: 'fleet',
        sandboxId: 'sb0',
        fleetId: 'flt',
        machineId: 'm1',
      },
    },
    {
      kind: 'loop.iteration.started',
      runId: 'run-1',
      timestamp: 1022,
      payload: { iterationIndex: 1, agentRunName: 'codex', taskHash: 'h1' },
    },
    {
      kind: 'loop.iteration.ended',
      runId: 'run-1',
      timestamp: 1500,
      payload: {
        iterationIndex: 0,
        agentRunName: 'claude',
        costUsd: 0.02,
        durationMs: 480,
        verdict: { valid: true, score: 0.9 },
        tokenUsage: { input: 1200, output: 300 },
      },
    },
    {
      kind: 'loop.iteration.ended',
      runId: 'run-1',
      timestamp: 1600,
      payload: {
        iterationIndex: 1,
        agentRunName: 'codex',
        costUsd: 0.03,
        durationMs: 578,
        verdict: { valid: false, score: 0.4 },
        tokenUsage: { input: 1100, output: 250 },
      },
    },
    {
      kind: 'loop.decision',
      runId: 'run-1',
      timestamp: 1610,
      payload: { decision: 'continue', historyLength: 2 },
    },
    {
      kind: 'loop.plan',
      runId: 'run-1',
      timestamp: 1620,
      payload: {
        roundIndex: 1,
        plannedCount: 0,
        moveKind: 'stop',
        rationale: 'valid winner exists',
      },
    },
    {
      kind: 'loop.decision',
      runId: 'run-1',
      timestamp: 1625,
      payload: { decision: 'done', historyLength: 2 },
    },
    {
      kind: 'loop.ended',
      runId: 'run-1',
      timestamp: 1700,
      payload: { winnerIterationIndex: 0, totalCostUsd: 0.05, durationMs: 700, iterations: 2 },
    },
  ]

  it('builds a real-duration root → round → branch tree with a single trace id', () => {
    const spans = buildLoopOtelSpans(events, 'trace-abc')
    const byName = (n: string) => spans.filter((s) => s.name === n)

    const root = byName('loop')
    expect(root).toHaveLength(1)
    expect(spans.every((s) => s.traceId === root[0]!.traceId)).toBe(true)
    // real durations, not zero-width point spans
    expect(BigInt(root[0]!.endTimeUnixNano) - BigInt(root[0]!.startTimeUnixNano)).toBe(
      700n * 1_000_000n,
    )

    const rounds = byName('loop.round')
    expect(rounds).toHaveLength(2)
    expect(rounds.every((r) => r.parentSpanId === root[0]!.spanId)).toBe(true)

    const iters = byName('loop.iteration')
    expect(iters).toHaveLength(2)
    // iterations nest under round 0 (the fanout), not the root
    const round0 = rounds[0]!
    expect(iters.every((i) => i.parentSpanId === round0.spanId)).toBe(true)
    // branch span duration reflects started→ended (480ms for iter 0)
    const iter0 = iters.find((i) => attrMap(i)['tangle.loop.iteration.index'] === 0)!
    expect(BigInt(iter0.endTimeUnixNano) - BigInt(iter0.startTimeUnixNano)).toBe(480n * 1_000_000n)
  })

  it('emits current (non-deprecated) gen_ai.* + tangle.* attributes', () => {
    const spans = buildLoopOtelSpans(events, 'trace-abc')
    const root = attrMap(spans.find((s) => s.name === 'loop')!)
    expect(root['gen_ai.operation.name']).toBe('invoke_workflow')
    expect(root['gen_ai.conversation.id']).toBe('run-1')
    expect(root['tangle.loop.driver']).toBe('dynamic')
    expect(root['tangle.loop.winner.iteration_index']).toBe(0)
    expect(root['tangle.cost.usd']).toBeCloseTo(0.05, 6)

    const round0 = attrMap(spans.filter((s) => s.name === 'loop.round')[0]!)
    expect(round0['tangle.loop.move.kind']).toBe('fanout')
    expect(round0['tangle.loop.move.width']).toBe(2)
    expect(round0['tangle.loop.move.rationale']).toBe('attempts disagree; fan to 2 harnesses')
    expect(round0['tangle.loop.decision']).toBe('continue')

    const iter0 = attrMap(
      spans
        .filter((s) => s.name === 'loop.iteration')
        .find((s) => attrMap(s)['tangle.loop.iteration.index'] === 0)!,
    )
    expect(iter0['gen_ai.operation.name']).toBe('invoke_agent')
    expect(iter0['gen_ai.agent.name']).toBe('claude')
    expect(iter0['gen_ai.usage.input_tokens']).toBe(1200)
    expect(iter0['gen_ai.usage.output_tokens']).toBe(300)
    expect(iter0['tangle.loop.verdict.valid']).toBe(true)
    expect(iter0['tangle.loop.verdict.score']).toBeCloseTo(0.9, 6)
    expect(iter0['tangle.loop.placement.kind']).toBe('fleet')
    expect(iter0['tangle.machine.id']).toBe('m1')

    // NO deprecated keys anywhere
    const allKeys = spans.flatMap((s) => (s.attributes ?? []).map((a) => a.key))
    expect(allKeys).not.toContain('gen_ai.system')
    expect(allKeys).not.toContain('gen_ai.usage.prompt_tokens')
    expect(allKeys).not.toContain('gen_ai.usage.completion_tokens')
  })

  it('parents the loop-root under an inherited span when provided', () => {
    const spans = buildLoopOtelSpans(events, 'trace-abc', 'parent-span-id')
    const root = spans.find((s) => s.name === 'loop')!
    expect(root.parentSpanId).toBeDefined()
    expect(root.parentSpanId).toHaveLength(16)
  })

  it('returns [] for an empty event stream', () => {
    expect(buildLoopOtelSpans([], 'trace-abc')).toEqual([])
  })

  it('emits edge lineage (move child_indices/parent_index + iteration group_id/parent_index/output_preview)', () => {
    // fanout(0,1) at round 0 → refine(2) at round 1 branching off iteration 0.
    const lineageEvents = [
      {
        kind: 'loop.started',
        runId: 'r2',
        timestamp: 0,
        payload: { driver: 'dynamic', agentRunNames: ['a'] },
      },
      {
        kind: 'loop.plan',
        runId: 'r2',
        timestamp: 1,
        payload: { roundIndex: 0, plannedCount: 2, moveKind: 'fanout', childIndices: [0, 1] },
      },
      {
        kind: 'loop.iteration.started',
        runId: 'r2',
        timestamp: 2,
        payload: { iterationIndex: 0, agentRunName: 'a', groupId: 0 },
      },
      {
        kind: 'loop.iteration.started',
        runId: 'r2',
        timestamp: 2,
        payload: { iterationIndex: 1, agentRunName: 'a', groupId: 0 },
      },
      {
        kind: 'loop.iteration.ended',
        runId: 'r2',
        timestamp: 10,
        payload: {
          iterationIndex: 0,
          agentRunName: 'a',
          costUsd: 0.01,
          durationMs: 8,
          groupId: 0,
          verdict: { valid: true, score: 0.8 },
          outputPreview: '{"answer":"alpha"}',
        },
      },
      {
        kind: 'loop.iteration.ended',
        runId: 'r2',
        timestamp: 11,
        payload: { iterationIndex: 1, agentRunName: 'a', costUsd: 0.01, durationMs: 9, groupId: 0 },
      },
      {
        kind: 'loop.decision',
        runId: 'r2',
        timestamp: 12,
        payload: { decision: 'continue', historyLength: 2 },
      },
      {
        kind: 'loop.plan',
        runId: 'r2',
        timestamp: 13,
        payload: {
          roundIndex: 1,
          plannedCount: 1,
          moveKind: 'refine',
          parentIndex: 0,
          childIndices: [2],
        },
      },
      {
        kind: 'loop.iteration.started',
        runId: 'r2',
        timestamp: 14,
        payload: { iterationIndex: 2, agentRunName: 'a', groupId: 1, parentIndex: 0 },
      },
      {
        kind: 'loop.iteration.ended',
        runId: 'r2',
        timestamp: 20,
        payload: {
          iterationIndex: 2,
          agentRunName: 'a',
          costUsd: 0.01,
          durationMs: 6,
          groupId: 1,
          parentIndex: 0,
          outputPreview: '{"answer":"beta"}',
        },
      },
      {
        kind: 'loop.decision',
        runId: 'r2',
        timestamp: 21,
        payload: { decision: 'done', historyLength: 3 },
      },
      {
        kind: 'loop.ended',
        runId: 'r2',
        timestamp: 25,
        payload: { winnerIterationIndex: 2, totalCostUsd: 0.03, durationMs: 25, iterations: 3 },
      },
    ]
    const spans = buildLoopOtelSpans(lineageEvents, 'trace-xyz')
    const moves = spans.filter((s) => s.name === 'loop.round').map(attrMap)
    const fanout = moves.find((m) => m['tangle.loop.move.kind'] === 'fanout')!
    expect(fanout['tangle.loop.move.child_indices']).toBe('0,1')
    expect(fanout['tangle.loop.move.parent_index']).toBeUndefined()
    const refine = moves.find((m) => m['tangle.loop.move.kind'] === 'refine')!
    expect(refine['tangle.loop.move.parent_index']).toBe(0)
    expect(refine['tangle.loop.move.child_indices']).toBe('2')

    const iters = spans.filter((s) => s.name === 'loop.iteration').map(attrMap)
    const iter2 = iters.find((i) => i['tangle.loop.iteration.index'] === 2)!
    expect(iter2['tangle.loop.iteration.group_id']).toBe(1)
    expect(iter2['tangle.loop.iteration.parent_index']).toBe(0)
    expect(iter2['tangle.loop.iteration.duration_ms']).toBe(6)
    expect(iter2['tangle.loop.iteration.output_preview']).toBe('{"answer":"beta"}')

    const root = attrMap(spans.find((s) => s.name === 'loop')!)
    expect(root['tangle.loop.duration_ms']).toBe(25)
  })
})

describe('otel-export', () => {
  afterEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS
    vi.unstubAllGlobals()
  })

  it('returns undefined when no endpoint is configured', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    const exporter = createOtelExporter()
    expect(exporter).toBeUndefined()
  })

  it('returns exporter when endpoint is set via config', () => {
    const exporter = createOtelExporter({ endpoint: 'http://localhost:4318' })
    expect(exporter).toBeDefined()
    expect(exporter!.exportSpan).toBeInstanceOf(Function)
    expect(exporter!.flush).toBeInstanceOf(Function)
    expect(exporter!.shutdown).toBeInstanceOf(Function)
  })

  it('reads endpoint from OTEL_EXPORTER_OTLP_ENDPOINT env', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.local:4318'
    const exporter = createOtelExporter()
    expect(exporter).toBeDefined()
  })

  it('batch flush posts to /v1/traces with correct format', async () => {
    const bodies: unknown[] = []
    const mockFetch = vi.fn(async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body))
      return new Response('', { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 1,
    })!

    exporter.exportSpan({
      traceId: 'abcdef1234567890abcdef1234567890',
      spanId: '1234567890abcdef',
      name: 'loop.iteration.started',
      kind: 1,
      startTimeUnixNano: '1000000000000',
      endTimeUnixNano: '1500000000000',
      attributes: [{ key: 'test', value: { stringValue: 'hello' } }],
      status: { code: 1 },
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4318/v1/traces',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = bodies[0] as any
    expect(body.resourceSpans).toHaveLength(1)
    expect(body.resourceSpans[0].scopeSpans[0].spans[0].name).toBe('loop.iteration.started')

    await exporter.shutdown()
  })

  it('parses OTEL_EXPORTER_OTLP_HEADERS from env correctly', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer secret,X-Org=my-org'

    let capturedHeaders: Record<string, string> = {}
    const mockFetch = vi.fn(async (_url: string, init: any) => {
      capturedHeaders = init.headers
      return new Response('', { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({ batchSize: 1 })!
    exporter.exportSpan({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 'test',
      startTimeUnixNano: '1000000000000',
      endTimeUnixNano: '1000000000000',
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(capturedHeaders.Authorization).toBe('Bearer secret')
    expect(capturedHeaders['X-Org']).toBe('my-org')

    await exporter.shutdown()
  })

  it('shutdown drains all pending spans', async () => {
    const mockFetch = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 100, // won't auto-flush
    })!

    exporter.exportSpan({
      traceId: 'a'.repeat(32),
      spanId: 'c'.repeat(16),
      name: 'pending-span',
      startTimeUnixNano: '1000000000000',
      endTimeUnixNano: '2000000000000',
    })

    expect(mockFetch).not.toHaveBeenCalled()
    await exporter.shutdown()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('network failure does not crash the exporter', async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 1,
    })!

    // Should not throw
    exporter.exportSpan({
      traceId: 'a'.repeat(32),
      spanId: 'd'.repeat(16),
      name: 'test',
      startTimeUnixNano: '1000000000000',
      endTimeUnixNano: '1000000000000',
    })

    await new Promise((r) => setTimeout(r, 50))
    await exporter.shutdown()
    // If we get here without exception, test passes
  })

  it('loopEventToOtelSpan formats correctly', () => {
    const span = loopEventToOtelSpan(
      {
        kind: 'loop.iteration.started',
        runId: 'run-1',
        timestamp: 1700000000000,
        payload: { iterationIndex: 0, agentRunName: 'coder', taskHash: 'abc' },
      },
      'trace-id-123',
      'parent-span-456',
    )

    // traceId: "trace-id-123" → strip dashes → "traceid123" → pad to 32
    expect(span.traceId).toHaveLength(32)
    expect(span.traceId).toMatch(/^traceid123/)
    // parentSpanId: "parent-span-456" → strip dashes → "parentspan456" → pad to 16
    expect(span.parentSpanId).toHaveLength(16)
    expect(span.parentSpanId).toMatch(/^parentspan456/)
    expect(span.name).toBe('loop.iteration.started')
    // 1700000000000ms * 1_000_000 = 1700000000000000000000ns
    expect(span.startTimeUnixNano).toBe((BigInt(1700000000000) * 1_000_000n).toString())
    const attrMap = Object.fromEntries((span.attributes ?? []).map((a) => [a.key, a.value]))
    expect(attrMap['loop.event_kind']).toEqual({ stringValue: 'loop.iteration.started' })
    expect(attrMap['loop.iterationIndex']).toEqual({ intValue: '0' })
    expect(attrMap['loop.agentRunName']).toEqual({ stringValue: 'coder' })
  })
})

describe('exportEvalRuns (Intelligence self-improvement provenance)', () => {
  afterEach(() => {
    delete process.env.TANGLE_API_KEY
    delete process.env.INTELLIGENCE_BASE
    vi.unstubAllGlobals()
  })

  const event = {
    runId: 'rsi-1',
    runDir: 'rsi/fhenix/abc',
    timestamp: '2026-05-29T00:00:00.000Z',
    status: 'generation-complete' as const,
    labels: { stage: 'proposed', measured: 'false' },
    generations: [
      {
        index: 0,
        surfaceHash: 'h1',
        surface: { surfaceId: 'completeness-audit' },
        cells: [],
        compositeMean: 0,
        costUsd: 0,
        durationMs: 0,
      },
    ],
    totalCostUsd: 0,
    totalDurationMs: 0,
  }

  it('throws without an api key', async () => {
    await expect(exportEvalRuns([event])).rejects.toThrow(/apiKey required/)
  })

  it('POSTs the wire-versioned envelope to /v1/ingest/eval-runs with bearer + version header', async () => {
    let captured: { url: string; init: any } | undefined
    const mockFetch = vi.fn(async (url: string, init: any) => {
      captured = { url, init }
      return new Response(JSON.stringify({ accepted: 1, rejected: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)
    const r = await exportEvalRuns([event], {
      apiKey: 'sk-tan-test',
      base: 'https://intel.example',
      idempotencyKey: 'rsi-1',
    })
    expect(r.ok).toBe(true)
    expect(r.accepted).toBe(1)
    expect(captured!.url).toBe('https://intel.example/v1/ingest/eval-runs')
    expect(captured!.init.headers.authorization).toBe('Bearer sk-tan-test')
    expect(captured!.init.headers['X-Tangle-Wire-Version']).toBe(INTELLIGENCE_WIRE_VERSION)
    expect(captured!.init.headers['Idempotency-Key']).toBe('rsi-1')
    const body = JSON.parse(captured!.init.body)
    expect(body.wireVersion).toBe(INTELLIGENCE_WIRE_VERSION)
    expect(body.events[0].generations[0].index).toBe(0)
  })

  it('surfaces per-event rejections from a 400 (does not throw)', async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ accepted: 0, rejected: [{ index: 0, reason: 'bad' }] }), {
          status: 400,
        }),
    )
    vi.stubGlobal('fetch', mockFetch)
    const r = await exportEvalRuns([event], { apiKey: 'k' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(400)
    expect(r.rejected[0]?.reason).toBe('bad')
  })

  it('no-ops on empty events', async () => {
    const r = await exportEvalRuns([], { apiKey: 'k' })
    expect(r).toEqual({ ok: true, status: 0, accepted: 0, rejected: [] })
  })
})
