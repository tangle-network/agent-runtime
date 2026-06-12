/**
 * @experimental
 *
 * Compact loop-trace tee for the delegation journal.
 *
 * The OTEL exporter ({@link createPropagatingTraceEmitter}) is a no-op
 * without `OTEL_EXPORTER_OTLP_ENDPOINT`, which leaves delegated work streams
 * dark in practice. This module derives the same loop → round → branch span
 * tree (via the shared {@link buildLoopSpanNodes} builder) into a small,
 * JSON-safe shape persisted directly on the `DelegationRecord` — observable
 * through `delegation_status` with no collector infrastructure. Both sinks
 * coexist: the OTEL export path is unchanged.
 *
 * Payload discipline: a record's trace is hard-capped (spans + serialized
 * bytes). Past the cap the OLDEST spans are dropped and the record carries a
 * `traceTruncated: true` marker — truncation is never silent.
 */

import { buildLoopSpanNodes } from '../otel-export'
import type { LoopTraceEmitter, LoopTraceEvent } from '../runtime/types'

/**
 * One span of a delegation's compact trace. Flat (parent linkage by id), all
 * values JSON-safe scalars — `FileDelegationStore` round-trips records
 * through `JSON.stringify`. `meta` carries the span's attributes (GenAI
 * semconv keys + `tangle.loop.*` extensions) exactly as the OTEL sink emits
 * them, so a consumer can re-export journal traces losslessly.
 *
 * @experimental
 */
export interface DelegationTraceSpan {
  spanId: string
  /** Absent on the tree root. */
  parentSpanId?: string
  /** `'loop'` | `'loop.round'` | `'loop.iteration'` (or a sink-specific name). */
  name: string
  /** Topology level: loop root, plan round, or iteration branch. */
  kind: 'loop' | 'round' | 'branch'
  startMs: number
  endMs: number
  meta?: Record<string, string | number | boolean>
}

/** Default cap on spans retained per delegation record. @experimental */
export const DELEGATION_TRACE_MAX_SPANS = 512

/** Default cap on the serialized trace payload per record, in bytes. @experimental */
export const DELEGATION_TRACE_MAX_BYTES = 256 * 1024

/** @experimental */
export interface DelegationTraceCaps {
  /** Default {@link DELEGATION_TRACE_MAX_SPANS}. */
  maxSpans?: number
  /** Default {@link DELEGATION_TRACE_MAX_BYTES}. Approximate — measured as the
   *  sum of per-span `JSON.stringify` lengths. */
  maxBytes?: number
}

/** @experimental */
export interface CappedDelegationTrace {
  trace: DelegationTraceSpan[]
  /** True when oldest spans were dropped to honor the caps. */
  truncated: boolean
}

/**
 * Derive the compact span tree for ONE loop run from its buffered
 * `LoopTraceEvent` stream. Same reconstruction as the OTEL exporter
 * ({@link buildLoopSpanNodes}); tolerates partial streams.
 *
 * @experimental
 */
export function buildDelegationTraceSpans(
  events: ReadonlyArray<LoopTraceEvent>,
): DelegationTraceSpan[] {
  return buildLoopSpanNodes(events).map((node) => ({
    spanId: node.spanId,
    ...(node.parentSpanId !== undefined ? { parentSpanId: node.parentSpanId } : {}),
    name: node.name,
    kind: node.kind,
    startMs: node.startMs,
    endMs: node.endMs,
    ...(Object.keys(node.attrs).length > 0 ? { meta: node.attrs } : {}),
  }))
}

/**
 * Enforce the trace caps over an ordered (oldest-first) span list. Drops the
 * OLDEST spans first and reports `truncated: true` when anything was dropped;
 * the newest span always survives, so a non-empty input never caps to empty.
 * Dropping a parent may orphan surviving children's `parentSpanId` references
 * — acceptable for the flat journal shape; consumers treat unresolved parents
 * as roots.
 *
 * @experimental
 */
export function capDelegationTrace(
  spans: ReadonlyArray<DelegationTraceSpan>,
  caps?: DelegationTraceCaps,
): CappedDelegationTrace {
  const maxSpans = caps?.maxSpans ?? DELEGATION_TRACE_MAX_SPANS
  const maxBytes = caps?.maxBytes ?? DELEGATION_TRACE_MAX_BYTES
  let start = Math.max(0, spans.length - maxSpans)
  const sizes = spans.map((span) => JSON.stringify(span).length + 1)
  let total = 0
  for (let i = start; i < sizes.length; i += 1) total += sizes[i]!
  while (start < spans.length - 1 && total > maxBytes) {
    total -= sizes[start]!
    start += 1
  }
  return { trace: spans.slice(start), truncated: start > 0 }
}

/**
 * Per-delegation trace collector. Buffers `LoopTraceEvent`s per runId
 * (mirroring the OTEL emitter's buffering) and hands the derived compact
 * spans to `onSpans` when a run reaches `loop.ended`. `settle()` drains runs
 * that never ended — a hard-aborted loop still leaves its partial tree in the
 * journal, unlike the OTEL path which drops it.
 *
 * @experimental
 */
export interface DelegationTraceCollector {
  emitter: LoopTraceEmitter
  /** Flush buffered events of runs that never reached `loop.ended`. */
  settle(): void
}

/** @experimental */
export function createDelegationTraceCollector(
  onSpans: (spans: DelegationTraceSpan[]) => void,
): DelegationTraceCollector {
  const buffers = new Map<string, LoopTraceEvent[]>()
  const flush = (events: LoopTraceEvent[]): void => {
    const spans = buildDelegationTraceSpans(events)
    if (spans.length > 0) onSpans(spans)
  }
  return {
    emitter: {
      emit(event: LoopTraceEvent): void {
        const buf = buffers.get(event.runId)
        if (buf) buf.push(event)
        else buffers.set(event.runId, [event])
        if (event.kind === 'loop.ended') {
          const events = buffers.get(event.runId) ?? [event]
          buffers.delete(event.runId)
          flush(events)
        }
      },
    },
    settle(): void {
      for (const events of buffers.values()) flush(events)
      buffers.clear()
    },
  }
}

/**
 * Fan one `LoopTraceEvent` stream into several emitters — e.g. the
 * process-wide OTEL exporter AND the per-delegation journal collector.
 * `undefined` entries are skipped; returns `undefined` when nothing is left
 * so callers keep the kernel's "no emitter, no events" fast path.
 *
 * @experimental
 */
export function composeLoopTraceEmitters(
  ...emitters: ReadonlyArray<LoopTraceEmitter | undefined>
): LoopTraceEmitter | undefined {
  const live = emitters.filter((e): e is LoopTraceEmitter => e !== undefined)
  if (live.length === 0) return undefined
  if (live.length === 1) return live[0]
  return {
    emit(event: LoopTraceEvent): void | Promise<void> {
      let pending: Promise<void>[] | undefined
      for (const emitter of live) {
        const result = emitter.emit(event)
        if (result) (pending ??= []).push(result)
      }
      if (pending) return Promise.all(pending).then(() => undefined)
    },
  }
}
