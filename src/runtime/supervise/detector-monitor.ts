/**
 * @experimental
 *
 * The online analyst on the worker pipe. As a worker streams its tool calls, this folds each one
 * through agent-eval's streaming detector kernel (`repeatedActionDetector` etc. — the SAME kernel the
 * control loop uses, published in @tangle-network/agent-eval) and fires `onSignal` the moment one
 * trips. The wiring point: `onSignal` raises a `finding` on the coordination bus, so the driver learns
 * mid-round that its worker is stuck — instead of finding out only at settle.
 *
 * Detection logic + the failure taxonomy live in agent-eval (substrate); this module is the thin
 * runtime adapter that projects a live tool call into a `DetectorEvent` (the tool name + `argHash` of
 * its args → an action fingerprint) and pumps the detectors. No detection logic is reimplemented here.
 */

import {
  argHash,
  type DetectorSignal,
  errorStreakDetector,
  observeAll,
  repeatedActionDetector,
  type StreamingDetector,
} from '@tangle-network/agent-eval'

export interface ToolStep {
  readonly toolName: string
  readonly args: unknown
  /** Whether the tool call errored (drives error-streak detection). Omit/`'ok'` when unknown. */
  readonly status?: 'ok' | 'error'
}

export interface DetectorMonitor {
  /** Fold one tool step through the detectors; returns (and fires `onSignal` for) every signal. */
  observeToolStep(step: ToolStep): DetectorSignal[]
  reset(): void
}

export interface DetectorMonitorOptions {
  /** The detectors to run online. Defaults to a stuck-loop + error-streak panel. */
  readonly detectors?: ReadonlyArray<StreamingDetector>
  /** Fired for each signal a detector raises — the seam that raises a `finding` on the bus. */
  readonly onSignal?: (signal: DetectorSignal) => void | Promise<void>
}

/** The default online panel for a tool-call pipe: a worker repeating the same call, or hammering
 *  consecutive errors. (No-progress needs a domain progress-probe, so it is opt-in, not default.) */
export function defaultToolDetectors(): StreamingDetector[] {
  return [repeatedActionDetector({ maxRepeated: 3 }), errorStreakDetector({ maxErrors: 3 })]
}

export function createDetectorMonitor(opts: DetectorMonitorOptions = {}): DetectorMonitor {
  const detectors = opts.detectors ?? defaultToolDetectors()
  return {
    observeToolStep(step) {
      // Defensive: a hash/serialization quirk in the step args must never throw out of an
      // observability side-channel. Fall back to the tool name alone.
      let fingerprint: string
      try {
        fingerprint = `${step.toolName}|${argHash(step.args)}`
      } catch {
        fingerprint = `${step.toolName}|<unhashable>`
      }
      const signals = observeAll(detectors, {
        // Same fingerprint scheme as agent-eval's batch stuck-loop view: tool name + hashed args.
        actionFingerprint: fingerprint,
        ...(step.status ? { status: step.status } : {}),
        label: step.toolName,
      })
      for (const s of signals) void opts.onSignal?.(s)
      return signals
    },
    reset() {
      for (const d of detectors) d.reset()
    },
  }
}
