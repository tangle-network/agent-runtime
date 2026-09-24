import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import {
  deriveHexId,
  isW3CTraceId,
  validateTraceSpans,
} from '@tangle-network/agent-trace-contract'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildLoopOtelSpans,
  buildRuntimeEventOtelSpans,
  createOtelExporter,
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
      { includeControlPayloads: true },
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

  it('omits non-finite numeric attributes instead of emitting invalid OTLP JSON', () => {
    const [span] = buildRuntimeEventOtelSpans(
      [
        {
          type: 'llm_call',
          model: 'test',
          costUsd: Number.NaN,
          latencyMs: Number.POSITIVE_INFINITY,
        },
      ],
      'a'.repeat(32),
    )
    const attrs = attrMap(span!)
    expect(attrs['tangle.cost.usd']).toBeUndefined()
    expect(attrs['tangle.latency_ms']).toBeUndefined()
    expect(JSON.stringify(span)).not.toContain('NaN')
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

describe('wire ids', () => {
  it('passes an already-valid W3C id through unchanged, so an inherited trace keeps joining', () => {
    const traceId = 'a3ce929d0e0e4736a3ce929d0e0e4736'
    const parentSpanId = '00f067aa0ba902b7'
    const span = loopEventToOtelSpan(
      { kind: 'loop.started', runId: 'run-1', timestamp: 1700000000000, payload: {} },
      traceId,
      parentSpanId,
    )
    expect(span.traceId).toBe(traceId)
    expect(span.parentSpanId).toBe(parentSpanId)
  })

  it('passes a UUID-form id through DASH-STRIPPED — the exact wire id earlier releases exported', () => {
    // Cross-version join guard: the old padTraceId/padSpanId stripped dashes, so a UUID produced
    // a valid, joinable hex id. Deriving it instead would silently break every join against
    // spans the previous release (or an external system feeding UUIDs) already exported.
    const uuid = 'a3ce929d-0e0e-4736-a3ce-929d0e0e4736'
    const dashedSpan = 'a3ce929d-0e0e4736'
    const span = loopEventToOtelSpan(
      { kind: 'loop.started', runId: 'run-1', timestamp: 1, payload: {} },
      uuid,
      dashedSpan,
    )
    expect(span.traceId).toBe('a3ce929d0e0e4736a3ce929d0e0e4736')
    expect(span.parentSpanId).toBe('a3ce929d0e0e4736')
    expect(isW3CTraceId(span.traceId)).toBe(true)
    expect(span.traceId).not.toBe(deriveHexId(uuid, 16))
  })

  it('derives the same wire id for the same run id in every process (deterministic derivation)', () => {
    // The issue's executed proof: the retired slice-and-pad produced
    // 'vbwebgrounded20260801cella000000' — invalid hex, leaking the raw run id.
    const runId = 'vb-web-grounded-20260801-cell-a'
    const a = loopEventToOtelSpan({ kind: 'loop.started', runId, timestamp: 1, payload: {} }, runId)
    const b = loopEventToOtelSpan({ kind: 'loop.ended', runId, timestamp: 2, payload: {} }, runId)
    expect(a.traceId).toBe(b.traceId)
    expect(a.traceId).toBe(deriveHexId(runId, 16))
    expect(a.traceId).not.toBe('vbwebgrounded20260801cella000000')
    expect(isW3CTraceId('vbwebgrounded20260801cella000000')).toBe(false)
    expect(isW3CTraceId(a.traceId)).toBe(true)
  })

  it('exported spans now pass the contract validator that rejected the old derivation', () => {
    const runId = 'vb-web-grounded-20260801-cell-a'
    const span = loopEventToOtelSpan(
      { kind: 'loop.started', runId, timestamp: 1, payload: {} },
      runId,
    )
    const asContractSpan = (s: OtelSpan) => ({
      trace_id: s.traceId,
      span_id: s.spanId,
      name: s.name,
      start_time_unix_nano: s.startTimeUnixNano,
      end_time_unix_nano: s.endTimeUnixNano,
    })
    // The shipped code used to violate the shipped validator: slice-and-pad output drew the
    // `non-hex-id` finding. The derived id draws none.
    const nowValid = validateTraceSpans([asContractSpan(span)] as never)
    expect(nowValid.findings.map((f) => f.code)).not.toContain('non-hex-id')
    const oldStyle = validateTraceSpans([
      asContractSpan({ ...span, traceId: 'vbwebgrounded20260801cella000000' }),
    ] as never)
    expect(oldStyle.findings.map((f) => f.code)).toContain('non-hex-id')
  })
})

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached within 5s')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function testSpan(id: string): OtelSpan {
  return {
    traceId: 'a'.repeat(32),
    spanId: id.repeat(16).slice(0, 16),
    name: 'test',
    startTimeUnixNano: '1000000000000',
    endTimeUnixNano: '1000000000000',
  }
}

/**
 * A real OTLP/HTTP collector on a loopback port. `respond` decides each reply, so a test can
 * refuse, partially accept, or stall a batch exactly as a live collector does.
 */
async function startCollector(
  respond: (res: ServerResponse, spanCount: number) => void,
): Promise<{ endpoint: string; batches: number[]; close: () => Promise<void> }> {
  const batches: number[] = []
  const sockets = new Set<Socket>()
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      const body = JSON.parse(raw) as { resourceSpans: [{ scopeSpans: [{ spans: unknown[] }] }] }
      const count = body.resourceSpans[0].scopeSpans[0].spans.length
      batches.push(count)
      respond(res, count)
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    endpoint: `http://127.0.0.1:${port}`,
    batches,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

describe('createOtelExporter delivery accounting against a real collector', () => {
  const collectors: Array<{ close: () => Promise<void> }> = []
  afterEach(async () => {
    await Promise.all(collectors.splice(0).map((collector) => collector.close()))
  })

  it('counts every span the collector confirms as written', async () => {
    const collector = await startCollector((res) => res.writeHead(200).end('{}'))
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint, batchSize: 2 })!

    for (const id of ['1', '2', '3']) exporter.exportSpan(testSpan(id))
    await exporter.flush()

    expect(collector.batches).toEqual([2, 1])
    expect(exporter.stats()).toEqual({ written: 3, dropped: 0, pending: 0 })
    await exporter.shutdown()
  })

  it('counts a refused batch as dropped, reports it once from flush, and keeps the status', async () => {
    const collector = await startCollector((res) => res.writeHead(503).end('collector overloaded'))
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint, batchSize: 10 })!

    for (const id of ['1', '2', '3']) exporter.exportSpan(testSpan(id))

    await expect(exporter.flush()).rejects.toThrow(/dropped 3 spans.*HTTP 503.*overloaded/)
    expect(exporter.stats()).toMatchObject({ written: 0, dropped: 3, pending: 0 })
    expect(exporter.stats().lastError).toMatch(/HTTP 503/)
    // The loss was reported; a later flush with nothing new lost resolves.
    await expect(exporter.flush()).resolves.toBeUndefined()
    await exporter.shutdown()
  })

  it('counts spans an OTLP partialSuccess response rejects inside a 200', async () => {
    const collector = await startCollector((res) =>
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ partialSuccess: { rejectedSpans: '1', errorMessage: 'bad span' } })),
    )
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint, batchSize: 10 })!

    exporter.exportSpan(testSpan('1'))
    exporter.exportSpan(testSpan('2'))

    await expect(exporter.flush()).rejects.toThrow(/dropped 1 spans.*bad span/)
    expect(exporter.stats()).toMatchObject({ written: 1, dropped: 1, pending: 0 })
    await exporter.shutdown()
  })

  it('bounds queued plus in-flight spans while the collector stalls, and counts the overflow', async () => {
    const stalled: ServerResponse[] = []
    const collector = await startCollector((res) => stalled.push(res))
    collectors.push(collector)
    const exporter = createOtelExporter({
      endpoint: collector.endpoint,
      batchSize: 2,
      maxQueueSize: 4,
    })!

    // Two spans start the first POST; two more wait; the fifth has no room.
    for (const id of ['1', '2', '3', '4', '5']) exporter.exportSpan(testSpan(id))
    expect(exporter.stats()).toMatchObject({ written: 0, dropped: 1, pending: 4 })
    expect(exporter.stats().lastError).toMatch(/queue full/)

    const flushed = exporter.flush()
    for (let batch = 0; batch < 2; batch++) {
      await waitFor(() => stalled.length === 1)
      stalled.shift()!.writeHead(200).end()
    }

    await expect(flushed).rejects.toThrow(/dropped 1 spans.*queue full/)
    expect(collector.batches).toEqual([2, 2])
    expect(exporter.stats()).toMatchObject({ written: 4, dropped: 1, pending: 0 })
    await exporter.shutdown()
  })

  it('abandons a POST that outlives timeoutMs and counts its spans as dropped', async () => {
    const collector = await startCollector(() => {
      // Never answer: the exporter must not wait forever on a hung collector.
    })
    collectors.push(collector)
    const exporter = createOtelExporter({
      endpoint: collector.endpoint,
      batchSize: 10,
      timeoutMs: 50,
    })!

    exporter.exportSpan(testSpan('1'))

    await expect(exporter.flush()).rejects.toThrow(/dropped 1 spans/)
    expect(exporter.stats()).toMatchObject({ written: 0, dropped: 1, pending: 0 })
    await exporter.shutdown()
  })

  it('counts a span exported after the exporter stopped instead of discarding it silently', async () => {
    const collector = await startCollector((res) => res.writeHead(200).end())
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint })!
    await exporter.shutdown()

    exporter.exportSpan(testSpan('1'))

    expect(exporter.stats()).toMatchObject({ written: 0, dropped: 1, pending: 0 })
    expect(collector.batches).toEqual([])
  })
})
