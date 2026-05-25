import { afterEach, describe, expect, it } from 'vitest'
import {
  createPropagatingTraceEmitter,
  readTraceContextFromEnv,
  traceContextToEnv,
} from '../../src/mcp/trace-propagation'

describe('MCP trace propagation', () => {
  const originalTraceId = process.env.TRACE_ID
  const originalParentSpanId = process.env.PARENT_SPAN_ID
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  afterEach(() => {
    if (originalTraceId === undefined) delete process.env.TRACE_ID
    else process.env.TRACE_ID = originalTraceId
    if (originalParentSpanId === undefined) delete process.env.PARENT_SPAN_ID
    else process.env.PARENT_SPAN_ID = originalParentSpanId
    if (originalEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint
  })

  it('reads traceId and parentSpanId from env', () => {
    process.env.TRACE_ID = 'inherited-trace-id-abc'
    process.env.PARENT_SPAN_ID = 'parent-span-xyz'

    const ctx = readTraceContextFromEnv()
    expect(ctx.traceId).toBe('inherited-trace-id-abc')
    expect(ctx.parentSpanId).toBe('parent-span-xyz')
  })

  it('generates fresh traceId when env is missing', () => {
    delete process.env.TRACE_ID
    delete process.env.PARENT_SPAN_ID

    const ctx = readTraceContextFromEnv()
    expect(ctx.traceId).toBeDefined()
    expect(ctx.traceId.length).toBe(32)
    expect(ctx.parentSpanId).toBeUndefined()
  })

  it('child spans reference parent via parentSpanId', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    const ctx = { traceId: 'test-trace', parentSpanId: 'parent-123' }
    const { emitter, exporter, context } = createPropagatingTraceEmitter(ctx)

    expect(context.traceId).toBe('test-trace')
    expect(context.parentSpanId).toBe('parent-123')
    expect(emitter).toBeDefined()
    // Without OTEL endpoint, exporter is undefined — emitter still works
    expect(exporter).toBeUndefined()
  })

  it('traceContextToEnv produces correct env vars', () => {
    const ctx = { traceId: 'my-trace', parentSpanId: 'my-span' }
    const env = traceContextToEnv(ctx)
    expect(env.TRACE_ID).toBe('my-trace')
    expect(env.PARENT_SPAN_ID).toBe('my-span')
  })

  it('traceContextToEnv omits PARENT_SPAN_ID when undefined', () => {
    const ctx = { traceId: 'my-trace' }
    const env = traceContextToEnv(ctx)
    expect(env.TRACE_ID).toBe('my-trace')
    expect('PARENT_SPAN_ID' in env).toBe(false)
  })
})
