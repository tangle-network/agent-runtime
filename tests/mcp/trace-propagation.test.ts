import { deriveHexId } from '@tangle-network/agent-trace-contract'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createPropagatingTraceEmitter,
  mergeTraceEnv,
  parseTraceparent,
  readTraceContextFromEnv,
  traceContextToEnv,
} from '../../src/mcp/trace-propagation'
import { loopEventToOtelSpan } from '../../src/otel-export'

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

  it('a HUMAN parent id converges through BOTH conventions onto the same derived wire id', () => {
    // The dual-write's core claim, on the path where the spellings actually diverge: the W3C
    // reader observes the derived hex, the legacy reader observes the human spelling, and at
    // export both become the SAME wire id — one trace, either convention.
    const env = traceContextToEnv({ traceId: 'my-trace', parentSpanId: 'my-span' })
    const viaTraceparent = readTraceContextFromEnv({ TRACEPARENT: env.TRACEPARENT })
    const viaLegacy = readTraceContextFromEnv({
      TRACE_ID: env.TRACE_ID,
      PARENT_SPAN_ID: env.PARENT_SPAN_ID,
    })
    expect(viaTraceparent.traceId).toBe(deriveHexId('my-trace', 16))
    expect(viaTraceparent.parentSpanId).toBe(deriveHexId('my-span', 8))
    expect(viaLegacy.traceId).toBe('my-trace')
    expect(viaLegacy.parentSpanId).toBe('my-span')
    const exported = loopEventToOtelSpan(
      { kind: 'loop.started', runId: 'r', timestamp: 1, payload: {} },
      viaLegacy.traceId,
      viaLegacy.parentSpanId,
    )
    expect(exported.traceId).toBe(deriveHexId('my-trace', 16))
    expect(exported.parentSpanId).toBe(deriveHexId('my-span', 8))
  })

  it('mergeTraceEnv rewrites TRACEPARENT to the CALLER ids when an override declares the legacy pair', () => {
    const recorder = traceContextToEnv({
      traceId: 'a3ce929d0e0e4736a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
    })
    const merged = mergeTraceEnv({}, recorder, {
      TRACE_ID: 'caller-trace',
      PARENT_SPAN_ID: 'caller-span',
    })
    expect(merged.TRACE_ID).toBe('caller-trace')
    expect(merged.PARENT_SPAN_ID).toBe('caller-span')
    // Dual-write on the caller's behalf: the recorder's W3C wire must not survive the override.
    expect(merged.TRACEPARENT).toBe(
      `00-${deriveHexId('caller-trace', 16)}-${deriveHexId('caller-span', 8)}-01`,
    )
  })

  it('mergeTraceEnv keeps the recorder TRACEPARENT when the override declares no trace identity', () => {
    const recorder = traceContextToEnv({
      traceId: 'a3ce929d0e0e4736a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
    })
    const merged = mergeTraceEnv({ AMBIENT: 'yes' }, recorder, { PATH: '/x' })
    expect(merged.TRACEPARENT).toBe(recorder.TRACEPARENT)
    expect(merged.TRACE_ID).toBe(recorder.TRACE_ID)
    expect(merged.AMBIENT).toBe('yes')
    expect(merged.PATH).toBe('/x')
  })

  it("mergeTraceEnv honors an override's OWN TRACEPARENT verbatim", () => {
    const recorder = traceContextToEnv({
      traceId: 'a3ce929d0e0e4736a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
    })
    const own = '00-ffffffffffffffffffffffffffffffff-eeeeeeeeeeeeeeee-01'
    const merged = mergeTraceEnv({}, recorder, { TRACE_ID: 'caller-trace', TRACEPARENT: own })
    expect(merged.TRACEPARENT).toBe(own)
  })

  it('mergeTraceEnv drops TRACEPARENT when the override leaves no parent span id to rebuild from', () => {
    // Override declares only TRACE_ID and the recorder stamped nothing (untraced run): the W3C
    // grammar needs a parent span id, so no TRACEPARENT may survive — not even an ambient one.
    const merged = mergeTraceEnv(
      { TRACEPARENT: '00-a3ce929d0e0e4736a3ce929d0e0e4736-00f067aa0ba902b7-01' },
      {},
      { TRACE_ID: 'caller-trace' },
    )
    expect(merged.TRACE_ID).toBe('caller-trace')
    expect('TRACEPARENT' in merged).toBe(false)
  })
})
