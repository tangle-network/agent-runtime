/**
 *
 * Trace context propagation across process-spawn boundaries.
 *
 * CANONICAL WIRE: the W3C `TRACEPARENT` environment variable
 * (`00-<32 hex trace id>-<16 hex span id>-<2 hex flags>`), the convention the wider ecosystem —
 * OTel SDKs, collectors, the Claude Code harness binary — already reads at spawn. The bespoke
 * `TRACE_ID` / `PARENT_SPAN_ID` pair this package shipped first is the FORK, not the standard:
 * it is still read as a fallback and still written alongside `TRACEPARENT` for one release, so
 * a child running either version of this package joins the same trace. The legacy pair is
 * scheduled for removal in the next major.
 *
 *   read:  TRACEPARENT first, then TRACE_ID / PARENT_SPAN_ID, else a fresh root.
 *   write: BOTH — TRACEPARENT (+ TRACESTATE untouched) and TRACE_ID / PARENT_SPAN_ID.
 *
 * A fresh root minted because NO context reached this process is a severed hop, not a normal
 * start: it is marked `unpropagated: true` and every span tree it emits carries
 * `tangle.trace.unpropagated=true`, so a disconnected trace is a queryable fact instead of a
 * silent stranger.
 *
 * @experimental
 */

import { isW3CSpanId, isW3CTraceId } from '@tangle-network/agent-trace-contract'
import type { OtelExporter } from '../otel-export'
import { buildLoopOtelSpans, createOtelExporter, padSpanId, padTraceId } from '../otel-export'
import type { LoopTraceEmitter, LoopTraceEvent } from '../runtime/types'

export interface TraceContext {
  /** Trace id inherited from the parent process, or a fresh one. */
  traceId: string
  /** Parent span id from the delegation that launched this MCP server. */
  parentSpanId?: string
  /** True when NO context reached this process and the trace id is a fallback mint — the hop
   *  above this process is severed. Span trees emitted under this context are stamped
   *  `tangle.trace.unpropagated=true` so the severed hop is queryable. */
  unpropagated?: boolean
}

/** `00-<traceId>-<spanId>-<flags>`, any version prefix, case-insensitive per the W3C grammar. */
const TRACEPARENT_PATTERN = /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i

/** Parse a W3C `traceparent` header/env value, or `undefined` when malformed. Fails closed: a
 *  half-formed value yields no context rather than an unjoinable id. */
export function parseTraceparent(value: unknown): TraceContext | undefined {
  if (typeof value !== 'string') return undefined
  const match = TRACEPARENT_PATTERN.exec(value.trim())
  if (!match) return undefined
  const traceId = (match[1] as string).toLowerCase()
  const parentSpanId = (match[2] as string).toLowerCase()
  if (!isW3CTraceId(traceId) || !isW3CSpanId(parentSpanId)) return undefined
  return { traceId, parentSpanId }
}

/**
 * Read trace context from a process environment (defaults to `process.env`).
 * `TRACEPARENT` wins; the legacy `TRACE_ID` / `PARENT_SPAN_ID` pair is the fallback; with
 * neither present a fresh root is generated AND marked `unpropagated` — see {@link TraceContext}.
 */
export function readTraceContextFromEnv(
  env: Record<string, string | undefined> = process.env,
): TraceContext {
  const fromTraceparent = parseTraceparent(env.TRACEPARENT)
  if (fromTraceparent) return fromTraceparent
  if (env.TRACE_ID) {
    return {
      traceId: env.TRACE_ID,
      ...(env.PARENT_SPAN_ID ? { parentSpanId: env.PARENT_SPAN_ID } : {}),
    }
  }
  return { traceId: generateTraceId(), unpropagated: true }
}

/**
 * Create a LoopTraceEmitter that:
 *   1. Parents all spans under the inherited parent span id.
 *   2. Exports spans to OTEL when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 *
 * Returns both the emitter and the optional exporter handle for shutdown.
 */
export function createPropagatingTraceEmitter(ctx: TraceContext): {
  emitter: LoopTraceEmitter
  exporter: OtelExporter | undefined
  context: TraceContext
} {
  const exporter = createOtelExporter()

  // Buffer events per loop run, then emit the full nested span tree on
  // `loop.ended` so the topology hierarchy (loop → round → branch) reaches the
  // OTLP collector — not a flat list of zero-duration point spans. A run that
  // never reaches `loop.ended` (hard abort) drops its buffer; acceptable for
  // the short-lived MCP subprocess.
  const buffers = new Map<string, LoopTraceEvent[]>()

  const emitter: LoopTraceEmitter = {
    emit(event: LoopTraceEvent) {
      if (!exporter) return
      const buf = buffers.get(event.runId)
      if (buf) buf.push(event)
      else buffers.set(event.runId, [event])
      if (event.kind === 'loop.ended') {
        const events = buffers.get(event.runId) ?? [event]
        buffers.delete(event.runId)
        for (const span of buildLoopOtelSpans(events, ctx.traceId, ctx.parentSpanId)) {
          // The child-side severed-hop marker: a fallback-minted root stamps every span it emits,
          // so a trace with no inbound link SAYS so instead of appearing as a stranger tree. The
          // human run id stays in `loop.run_id` / `tangle.run.id` where it was already searchable.
          exporter.exportSpan(
            ctx.unpropagated === true
              ? {
                  ...span,
                  attributes: [
                    ...(span.attributes ?? []),
                    { key: 'tangle.trace.unpropagated', value: { boolValue: true } },
                  ],
                }
              : span,
          )
        }
      }
    },
  }

  return { emitter, exporter, context: ctx }
}

/**
 * Build env vars to pass to a child subprocess so it inherits the current trace context.
 *
 * Writes BOTH conventions (see the module doc): `TRACEPARENT` carries the W3C-hex ids — mapped
 * through the exporter's own `padTraceId`/`padSpanId` (dashed hex passes through dash-stripped, a
 * human id is derived through the contract's `deriveHexId`), the SAME normalization every emitted
 * span uses, so both spellings and the parent's own spans all name ONE trace — and the legacy
 * pair carries the caller's ids verbatim. `TRACEPARENT` needs a parent span id by grammar; when
 * the context has none, the legacy pair still propagates the trace id alone.
 */
export function traceContextToEnv(ctx: TraceContext): Record<string, string> {
  const env: Record<string, string> = { TRACE_ID: ctx.traceId }
  if (ctx.parentSpanId) env.PARENT_SPAN_ID = ctx.parentSpanId
  if (ctx.parentSpanId) {
    env.TRACEPARENT = `00-${padTraceId(ctx.traceId)}-${padSpanId(ctx.parentSpanId)}-01`
  }
  return env
}

/**
 * Merge a spawned child's environment from lowest to highest precedence — ambient env, the
 * recorder's stamped trace env, the caller's own overrides — while keeping the ONE cross-key
 * invariant a plain spread cannot: `TRACEPARENT` and the legacy pair must name the SAME trace.
 * A caller override that declares `TRACE_ID` / `PARENT_SPAN_ID` without its own `TRACEPARENT`
 * would otherwise keep the recorder's W3C wire — the child would join the caller's trace on the
 * legacy pair and the RECORDER's on the standard one. The dual-write is performed on the
 * caller's behalf: the merged `TRACEPARENT` is rebuilt from the merged legacy pair through the
 * same {@link traceContextToEnv} derivation (`deriveHexId` for human ids), or dropped when no
 * parent span id survives the merge (the W3C grammar requires one).
 */
export function mergeTraceEnv(
  ambient: Record<string, string | undefined>,
  traceEnv: Record<string, string>,
  overrides?: Record<string, string>,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = {
    ...ambient,
    ...traceEnv,
    ...(overrides ?? {}),
  }
  const overridesIdentity =
    overrides !== undefined &&
    overrides.TRACEPARENT === undefined &&
    (overrides.TRACE_ID !== undefined || overrides.PARENT_SPAN_ID !== undefined)
  if (!overridesIdentity) return merged
  delete merged.TRACEPARENT
  if (merged.TRACE_ID !== undefined) {
    const rewritten = traceContextToEnv({
      traceId: merged.TRACE_ID,
      ...(merged.PARENT_SPAN_ID !== undefined ? { parentSpanId: merged.PARENT_SPAN_ID } : {}),
    })
    if (rewritten.TRACEPARENT !== undefined) merged.TRACEPARENT = rewritten.TRACEPARENT
  }
  return merged
}

function generateTraceId(): string {
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
