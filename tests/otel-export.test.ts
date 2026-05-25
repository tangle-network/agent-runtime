import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOtelExporter, loopEventToOtelSpan } from '../src/otel-export'

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
