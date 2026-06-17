/**
 * @experimental
 *
 * The ONLINE analyst: watch a `TraceSource` and fold each tool span through agent-eval's published
 * streaming detector kernel (`repeatedActionDetector`/`errorStreakDetector` — the SAME kernel the
 * control loop folds), firing `onSignal` the moment a worker loops or error-storms. Substrate-
 * agnostic: it consumes spans from any source (owned router/bridge loop OR a sandbox box session),
 * never the raw tool seam. Detection logic + the failure taxonomy live in agent-eval; not reimplemented.
 */

import {
  argHash,
  type DetectorSignal,
  errorStreakDetector,
  observeAll,
  repeatedActionDetector,
  type StreamingDetector,
  type ToolSpan,
} from '@tangle-network/agent-eval'
import type { TraceSource } from './trace-source'

export interface WatchTraceOptions {
  /** The detectors to run online. Defaults to a stuck-loop + error-streak panel. */
  readonly detectors?: ReadonlyArray<StreamingDetector>
  /** Fired for each signal a detector raises — the seam that raises a `finding` on the bus. */
  readonly onSignal?: (signal: DetectorSignal, span: ToolSpan) => void | Promise<void>
}

/** The default online panel for a tool-call pipe: a worker repeating the same call, or hammering
 *  consecutive errors. (No-progress needs a domain progress-probe, so it is opt-in, not default.) */
export function defaultToolDetectors(): StreamingDetector[] {
  return [repeatedActionDetector({ maxRepeated: 3 }), errorStreakDetector({ maxErrors: 3 })]
}

/** Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an
 *  unsubscribe. A defensive `argHash` failure (circular args) never throws out of the side-channel. */
export function watchTrace(source: TraceSource, opts: WatchTraceOptions = {}): () => void {
  const detectors = opts.detectors ?? defaultToolDetectors()
  return source.onSpan((span) => {
    let fingerprint: string
    try {
      // Same fingerprint scheme as agent-eval's batch stuck-loop view: tool name + hashed args.
      fingerprint = `${span.toolName}|${argHash(span.args)}`
    } catch {
      fingerprint = `${span.toolName}|<unhashable>`
    }
    const signals = observeAll(detectors, {
      actionFingerprint: fingerprint,
      ...(span.status ? { status: span.status } : {}),
      label: span.toolName,
    })
    for (const s of signals) void opts.onSignal?.(s, span)
  })
}
