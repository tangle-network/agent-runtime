/**
 *
 * Trace context propagation for MCP subprocess.
 *
 * When the MCP server is launched as a child process by a sandbox harness,
 * the parent passes trace context via environment variables:
 *
 *   TRACE_ID=<current-run-trace-id>
 *   PARENT_SPAN_ID=<span-that-dispatched-the-delegation>
 *
 * The MCP server reads these at startup and uses them as the root of its
 * internal trace tree. All spans emitted by `runLoop` invocations inside
 * the MCP are children of the parent's delegation span.
 *
 * When these env vars are absent, the MCP generates a fresh trace root —
 * the server operates standalone without trace joining.
 *
 * @experimental
 */

import type { OtelExporter } from '../otel-export'
import { buildLoopOtelSpans, createOtelExporter } from '../otel-export'
import type { LoopTraceEmitter, LoopTraceEvent } from '../runtime/types'

export interface TraceContext {
  /** Trace id inherited from the parent process, or a fresh one. */
  traceId: string
  /** Parent span id from the delegation that launched this MCP server. */
  parentSpanId?: string
}

/**
 * Read trace context from the process environment.
 * Returns a context with inherited ids or a freshly generated root.
 */
export function readTraceContextFromEnv(): TraceContext {
  const traceId = process.env.TRACE_ID || generateTraceId()
  const parentSpanId = process.env.PARENT_SPAN_ID || undefined
  return { traceId, parentSpanId }
}

/**
 * Create a LoopTraceEmitter that:
 *   1. Parents all spans under the inherited PARENT_SPAN_ID.
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
          exporter.exportSpan(span)
        }
      }
    },
  }

  return { emitter, exporter, context: ctx }
}

/**
 * Build env vars to pass to a child MCP subprocess so it inherits the
 * current trace context.
 */
export function traceContextToEnv(ctx: TraceContext): Record<string, string> {
  const env: Record<string, string> = { TRACE_ID: ctx.traceId }
  if (ctx.parentSpanId) env.PARENT_SPAN_ID = ctx.parentSpanId
  return env
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
