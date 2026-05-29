import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOtelExporter,
  exportEvalRuns,
  INTELLIGENCE_WIRE_VERSION,
  loopEventToOtelSpan,
} from '../src/otel-export'

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
      { index: 0, surfaceHash: 'h1', surface: { surfaceId: 'completeness-audit' }, cells: [], compositeMean: 0, costUsd: 0, durationMs: 0 },
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
    const r = await exportEvalRuns([event], { apiKey: 'sk-tan-test', base: 'https://intel.example', idempotencyKey: 'rsi-1' })
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
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ accepted: 0, rejected: [{ index: 0, reason: 'bad' }] }), { status: 400 }),
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
