import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildLoopOtelSpans,
  buildRuntimeEventOtelSpans,
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

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return (server.address() as AddressInfo).port
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function testSpan(spanId: string, name = `span-${spanId}`): OtelSpan {
  return {
    traceId: 'a'.repeat(32),
    spanId,
    name,
    startTimeUnixNano: '1000000000000',
    endTimeUnixNano: '1000000000000',
  }
}

describe('buildRuntimeEventOtelSpans', () => {
  it('preserves opted-in MCP tool payloads and LLM usage without truncation', () => {
    const longQuery = 'q'.repeat(5000)
    const spans = buildRuntimeEventOtelSpans(
      [
        {
          type: 'tool_call',
          toolName: 'mcp__linear__linear_graphql',
          toolCallId: 'call-1',
          args: { query: longQuery },
          timestamp: '2026-07-10T00:00:00.000Z',
        },
        {
          type: 'llm_call',
          model: 'anthropic/claude-sonnet-4.6',
          tokensIn: 12,
          tokensOut: 7,
          costUsd: 0.004,
          latencyMs: 350,
          timestamp: '2026-07-10T00:00:01.000Z',
        },
      ],
      'a'.repeat(32),
      'b'.repeat(16),
      { includeEventData: true },
    )

    const tool = attrMap(spans[0]!)
    expect(tool['tool.name']).toBe('mcp__linear__linear_graphql')
    expect(tool['mcp.server']).toBe('linear')
    expect(tool['mcp.tool.name']).toBe('linear_graphql')
    expect(String(tool['tool.input'])).toContain(longQuery)
    expect(String(tool['tangle.runtime.event'])).not.toContain('[truncated]')

    const llm = attrMap(spans[1]!)
    expect(llm['gen_ai.request.model']).toBe('anthropic/claude-sonnet-4.6')
    expect(llm['gen_ai.usage.input_tokens']).toBe(12)
    expect(llm['gen_ai.usage.output_tokens']).toBe(7)
    expect(llm['tangle.cost.usd']).toBe(0.004)
    expect(BigInt(spans[1]!.endTimeUnixNano) - BigInt(spans[1]!.startTimeUnixNano)).toBe(
      350_000_000n,
    )
  })

  it('omits control payloads by default while retaining tool identity', () => {
    const [span] = buildRuntimeEventOtelSpans(
      [{ type: 'tool_call', toolName: 'search', args: { secret: 'value' } }],
      'a'.repeat(32),
    )
    const attrs = attrMap(span!)
    expect(attrs['tool.name']).toBe('search')
    expect(attrs['tool.input']).toBeUndefined()
    expect(String(attrs['tangle.runtime.event'])).not.toContain('value')
  })

  it('rejects non-finite telemetry instead of silently deleting it', () => {
    expect(() =>
      buildRuntimeEventOtelSpans(
        [
          {
            type: 'llm_call',
            model: 'test',
            costUsd: Number.NaN,
            latencyMs: Number.POSITIVE_INFINITY,
          },
        ],
        'a'.repeat(32),
      ),
    ).toThrow('OTLP attribute tangle.cost.usd must be finite')
  })

  it('rejects an invalid supplied event timestamp instead of replacing it with now', () => {
    expect(() =>
      buildRuntimeEventOtelSpans(
        [
          {
            type: 'llm_call',
            model: 'test',
            timestamp: 'not-a-timestamp',
          },
        ],
        'a'.repeat(32),
      ),
    ).toThrow('runtime event timestamp is invalid: not-a-timestamp')
  })
})

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
    expect(root[0]!.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(spans.every((span) => /^[0-9a-f]{16}$/.test(span.spanId))).toBe(true)
    expect(
      spans.every(
        (span) => span.parentSpanId === undefined || /^[0-9a-f]{16}$/.test(span.parentSpanId),
      ),
    ).toBe(true)
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
    // explicit run identity + subject grain for a consuming run spine
    expect(root['tangle.run.id']).toBe('run-1')
    expect(typeof root['tangle.subject.key']).toBe('string')
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

  it('rejects a cross-origin 307 without forwarding telemetry or authorization', async () => {
    let sinkRequests = 0
    let sinkBodyBytes = 0
    let sinkAuthorization: string | undefined
    const sink = createServer((request, response) => {
      sinkRequests += 1
      sinkAuthorization = request.headers.authorization
      request.on('data', (chunk: Buffer) => {
        sinkBodyBytes += chunk.byteLength
      })
      request.on('end', () => {
        response.writeHead(204)
        response.end()
      })
    })
    const redirector = createServer((request, response) => {
      request.resume()
      response.writeHead(307, {
        location: `http://127.0.0.1:${(sink.address() as AddressInfo).port}/collect`,
      })
      response.end()
    })

    try {
      await listenOnLoopback(sink)
      const redirectorPort = await listenOnLoopback(redirector)
      const exporter = createOtelExporter({
        endpoint: `http://127.0.0.1:${redirectorPort}`,
        headers: { authorization: 'Bearer tenant-secret' },
        batchSize: 100,
      })!
      exporter.exportSpan({
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        name: 'private-run',
        startTimeUnixNano: '1000000000000',
        endTimeUnixNano: '1000000000000',
        attributes: [{ key: 'private.input', value: { stringValue: 'sensitive payload' } }],
      })

      await expect(exporter.shutdown()).resolves.toMatchObject({
        succeeded: false,
        undeliveredSpans: 1,
        error: expect.stringMatching(/OTLP export request.*failed/),
      })
      expect(sinkRequests).toBe(0)
      expect(sinkBodyBytes).toBe(0)
      expect(sinkAuthorization).toBeUndefined()
    } finally {
      await Promise.all([closeServer(redirector), closeServer(sink)])
    }
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

  it('rejects a network failure and retains the batch for an explicit retry', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 100,
    })!

    exporter.exportSpan({
      traceId: 'a'.repeat(32),
      spanId: 'd'.repeat(16),
      name: 'test',
      startTimeUnixNano: '1000000000000',
      endTimeUnixNano: '1000000000000',
    })

    await expect(exporter.flush()).resolves.toMatchObject({
      succeeded: false,
      undeliveredSpans: 1,
      error: 'OTLP export request to http://localhost:4318/v1/traces failed: ECONNREFUSED',
    })
    await expect(exporter.shutdown()).resolves.toMatchObject({
      succeeded: true,
      deliveredSpans: 1,
      undeliveredSpans: 0,
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('automatically retries a failed export after a bounded delay', async () => {
    const callTimes: number[] = []
    const mockFetch = vi
      .fn()
      .mockImplementationOnce(async () => {
        callTimes.push(Date.now())
        return new Response('temporarily unavailable', { status: 503 })
      })
      .mockImplementationOnce(async () => {
        callTimes.push(Date.now())
        return new Response(null, { status: 204 })
      })
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 1,
      flushIntervalMs: 60_000,
      retryInitialDelayMs: 40,
      retryMaxDelayMs: 40,
    })!
    exporter.exportSpan(testSpan('1'.repeat(16), 'retry-me'))

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2), { timeout: 1000 })
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(30)

    await expect(exporter.shutdown()).resolves.toMatchObject({
      succeeded: true,
      deliveredSpans: 1,
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('bounds retained spans, drops the newest, and reports each drop', async () => {
    const bodies: any[] = []
    const drops: unknown[] = []
    const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 100,
      maxQueueSize: 2,
      onDrop: (event) => drops.push(event),
    })!
    exporter.exportSpan(testSpan('1'.repeat(16), 'oldest'))
    exporter.exportSpan(testSpan('2'.repeat(16), 'second'))
    exporter.exportSpan(testSpan('3'.repeat(16), 'newest'))

    const result = await exporter.shutdown()

    const names = bodies[0].resourceSpans[0].scopeSpans[0].spans.map((span: OtelSpan) => span.name)
    expect(names).toEqual(['oldest', 'second'])
    expect(result).toEqual({
      succeeded: false,
      deliveredSpans: 2,
      undeliveredSpans: 0,
      droppedSpans: 1,
      error: '1 span dropped',
    })
    expect(drops).toEqual([
      {
        reason: 'queue_full',
        droppedCount: 1,
        totalDropped: 1,
        queueSize: 2,
        maxQueueSize: 2,
      },
    ])
  })

  it('keeps one ignored-abort request in flight and returns bounded flush failures', async () => {
    const signals: AbortSignal[] = []
    const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      return await new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 100,
      requestTimeoutMs: 25,
      flushIntervalMs: 10,
      retryInitialDelayMs: 10,
      retryMaxDelayMs: 10,
    })!
    exporter.exportSpan(testSpan('4'.repeat(16), 'never-resolves'))

    const flushStarted = Date.now()
    await expect(exporter.flush()).resolves.toMatchObject({
      succeeded: false,
      deliveredSpans: 0,
      undeliveredSpans: 1,
      droppedSpans: 0,
      error: expect.stringContaining('timed out after 25ms'),
    })
    expect(Date.now() - flushStarted).toBeLessThan(500)
    expect(signals[0]?.aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 75))
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const shutdownStarted = Date.now()
    await expect(exporter.shutdown()).resolves.toMatchObject({
      succeeded: false,
      deliveredSpans: 0,
      undeliveredSpans: 1,
      droppedSpans: 0,
      error: expect.stringContaining('remains in flight'),
    })
    expect(Date.now() - shutdownStarted).toBeLessThan(500)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('exports an immutable snapshot of each queued span', async () => {
    const bodies: any[] = []
    const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', mockFetch)
    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 100,
    })!
    const span = testSpan('6'.repeat(16), 'original')
    span.attributes = [{ key: 'state', value: { stringValue: 'queued' } }]
    span.status = { code: 1, message: 'original-status' }
    exporter.exportSpan(span)

    span.name = 'mutated'
    span.attributes[0]!.key = 'mutated'
    span.attributes[0]!.value.stringValue = 'mutated'
    span.status.message = 'mutated'

    const result = await exporter.shutdown()
    const exported = bodies[0].resourceSpans[0].scopeSpans[0].spans[0] as OtelSpan
    expect(result.succeeded).toBe(true)
    expect(exported).toMatchObject({
      name: 'original',
      attributes: [{ key: 'state', value: { stringValue: 'queued' } }],
      status: { code: 1, message: 'original-status' },
    })
  })

  it('caps response bytes and cancels an oversized error stream', async () => {
    let cancellations = 0
    const mockFetch = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('response is too large'))
        },
        cancel() {
          cancellations += 1
        },
      })
      return new Response(body, { status: 500 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 100,
      maxResponseBytes: 8,
    })!
    exporter.exportSpan(testSpan('5'.repeat(16), 'large-response'))

    await expect(exporter.shutdown()).resolves.toMatchObject({
      succeeded: false,
      undeliveredSpans: 1,
      error: 'OTLP response exceeded the 8-byte response limit',
    })
    expect(cancellations).toBe(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-2xx response and retains the batch for an explicit retry', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('tenant rejected', { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 1,
    })!
    exporter.exportSpan({
      traceId: 'a'.repeat(32),
      spanId: 'e'.repeat(16),
      name: 'test',
      startTimeUnixNano: '1000000000000',
      endTimeUnixNano: '1000000000000',
    })

    await expect(exporter.flush()).resolves.toMatchObject({
      succeeded: false,
      undeliveredSpans: 1,
      error:
        'OTLP export to http://localhost:4318/v1/traces was rejected with HTTP 403: tenant rejected',
    })
    await expect(exporter.shutdown()).resolves.toMatchObject({ succeeded: true })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('rejects partial OTLP acceptance and retains the batch for an explicit retry', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          partialSuccess: {
            rejectedSpans: '1',
            errorMessage: 'invalid span identity',
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({}))
    vi.stubGlobal('fetch', mockFetch)

    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 100,
    })!
    exporter.exportSpan({
      traceId: 'a'.repeat(32),
      spanId: 'f'.repeat(16),
      name: 'test',
      startTimeUnixNano: '1000000000000',
      endTimeUnixNano: '1000000000000',
    })

    await expect(exporter.flush()).resolves.toMatchObject({
      succeeded: false,
      undeliveredSpans: 1,
      error:
        'OTLP export to http://localhost:4318/v1/traces rejected 1 spans despite HTTP 200: invalid span identity',
    })
    await expect(exporter.shutdown()).resolves.toMatchObject({ succeeded: true })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed span identity and use after shutdown', async () => {
    const exporter = createOtelExporter({
      endpoint: 'http://localhost:4318',
      batchSize: 100,
    })!
    const malformed: OtelSpan = {
      traceId: 'not-a-trace-id',
      spanId: 'not-a-span-id',
      name: 'test',
      startTimeUnixNano: '1000000000000',
      endTimeUnixNano: '1000000000000',
    }

    expect(() => exporter.exportSpan(malformed)).toThrow(
      'OTLP span traceId must be a non-zero lowercase hexadecimal identifier',
    )
    await exporter.shutdown()
    expect(() =>
      exporter.exportSpan({
        ...malformed,
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
      }),
    ).toThrow('OTLP exporter is shut down')
  })

  it('loopEventToOtelSpan derives valid stable context ids from external labels', () => {
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

    const repeated = loopEventToOtelSpan(
      {
        kind: 'loop.iteration.started',
        runId: 'run-1',
        timestamp: 1700000000000,
        payload: {},
      },
      'trace-id-123',
      'parent-span-456',
    )

    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(span.traceId).not.toBe('0'.repeat(32))
    expect(span.parentSpanId).toMatch(/^[0-9a-f]{16}$/)
    expect(span.parentSpanId).not.toBe('0'.repeat(16))
    expect(repeated.traceId).toBe(span.traceId)
    expect(repeated.parentSpanId).toBe(span.parentSpanId)
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
    delete process.env.TANGLE_INTELLIGENCE_URL
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
