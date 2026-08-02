import { afterEach, describe, expect, it } from 'vitest'
import {
  createPropagatingTraceEmitter,
  parseTraceparent,
  readTraceContextFromEnv,
  traceContextToEnv,
} from '../../src/mcp/trace-propagation'

describe('MCP trace propagation', () => {
  const originalTraceparent = process.env.TRACEPARENT
  const originalTraceId = process.env.TRACE_ID
  const originalParentSpanId = process.env.PARENT_SPAN_ID
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  afterEach(() => {
    if (originalTraceparent === undefined) delete process.env.TRACEPARENT
    else process.env.TRACEPARENT = originalTraceparent
    if (originalTraceId === undefined) delete process.env.TRACE_ID
    else process.env.TRACE_ID = originalTraceId
    if (originalParentSpanId === undefined) delete process.env.PARENT_SPAN_ID
    else process.env.PARENT_SPAN_ID = originalParentSpanId
    if (originalEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint
  })

  it('reads traceId and parentSpanId from env', () => {
    delete process.env.TRACEPARENT
    process.env.TRACE_ID = 'inherited-trace-id-abc'
    process.env.PARENT_SPAN_ID = 'parent-span-xyz'

    const ctx = readTraceContextFromEnv()
    expect(ctx.traceId).toBe('inherited-trace-id-abc')
    expect(ctx.parentSpanId).toBe('parent-span-xyz')
    expect(ctx.unpropagated).toBeUndefined()
  })

  it('TRACEPARENT wins over the legacy pair when both are present', () => {
    process.env.TRACEPARENT = '00-a3ce929d0e0e4736a3ce929d0e0e4736-00f067aa0ba902b7-01'
    process.env.TRACE_ID = 'some-other-trace'
    process.env.PARENT_SPAN_ID = 'some-other-span'

    const ctx = readTraceContextFromEnv()
    expect(ctx.traceId).toBe('a3ce929d0e0e4736a3ce929d0e0e4736')
    expect(ctx.parentSpanId).toBe('00f067aa0ba902b7')
  })

  it('a malformed TRACEPARENT fails closed to the legacy pair', () => {
    process.env.TRACEPARENT = '00-not-hex-01'
    process.env.TRACE_ID = 'legacy-trace'
    delete process.env.PARENT_SPAN_ID

    const ctx = readTraceContextFromEnv()
    expect(ctx.traceId).toBe('legacy-trace')
  })

  it('a child reading either convention joins the same trace the parent wrote', () => {
    const parent = {
      traceId: 'a3ce929d0e0e4736a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
    }
    const env = traceContextToEnv(parent)
    // W3C-only reader (e.g. the Claude Code harness binary).
    const viaTraceparent = readTraceContextFromEnv({ TRACEPARENT: env.TRACEPARENT })
    // Legacy-only reader (a child running the previous release of this package).
    const viaLegacy = readTraceContextFromEnv({
      TRACE_ID: env.TRACE_ID,
      PARENT_SPAN_ID: env.PARENT_SPAN_ID,
    })
    expect(viaTraceparent.traceId).toBe(parent.traceId)
    expect(viaTraceparent.parentSpanId).toBe(parent.parentSpanId)
    expect(viaLegacy.traceId).toBe(parent.traceId)
    expect(viaLegacy.parentSpanId).toBe(parent.parentSpanId)
  })

  it('generates fresh traceId when env is missing and marks the hop severed', () => {
    delete process.env.TRACEPARENT
    delete process.env.TRACE_ID
    delete process.env.PARENT_SPAN_ID

    const ctx = readTraceContextFromEnv()
    expect(ctx.traceId).toBeDefined()
    expect(ctx.traceId.length).toBe(32)
    expect(ctx.parentSpanId).toBeUndefined()
    // The fallback mint is a severed hop and says so — the child-side marker every span carries.
    expect(ctx.unpropagated).toBe(true)
  })

  it('parseTraceparent rejects malformed values without throwing', () => {
    expect(parseTraceparent(undefined)).toBeUndefined()
    expect(parseTraceparent('')).toBeUndefined()
    expect(parseTraceparent('00-zz-yy-01')).toBeUndefined()
    expect(
      parseTraceparent('00-00000000000000000000000000000000-0000000000000000-01'),
    ).toBeUndefined()
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

  it('traceContextToEnv writes BOTH conventions (dual-write, one release)', () => {
    const ctx = { traceId: 'my-trace', parentSpanId: 'my-span' }
    const env = traceContextToEnv(ctx)
    expect(env.TRACE_ID).toBe('my-trace')
    expect(env.PARENT_SPAN_ID).toBe('my-span')
    // Human ids are derived into the W3C hex space for the standard wire.
    expect(env.TRACEPARENT).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('traceContextToEnv keeps already-hex ids verbatim in TRACEPARENT', () => {
    const ctx = {
      traceId: 'a3ce929d0e0e4736a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
    }
    const env = traceContextToEnv(ctx)
    expect(env.TRACEPARENT).toBe('00-a3ce929d0e0e4736a3ce929d0e0e4736-00f067aa0ba902b7-01')
  })

  it('traceContextToEnv omits PARENT_SPAN_ID and TRACEPARENT when no parent span exists', () => {
    const ctx = { traceId: 'my-trace' }
    const env = traceContextToEnv(ctx)
    expect(env.TRACE_ID).toBe('my-trace')
    expect('PARENT_SPAN_ID' in env).toBe(false)
    // A traceparent without a parent span id is ungrammatical; the legacy pair still carries the
    // trace id alone.
    expect('TRACEPARENT' in env).toBe(false)
  })
})
