/**
 * @experimental
 *
 * The settle-time trace analyzer. Captures a worker's tool steps and, when it settles, replays them
 * as agent-eval spans into an in-memory `TraceStore` and runs agent-eval's PUBLISHED batch analyzers
 * over them — `buildTrajectory` (structured run summary), `stuckLoopView` (full-run repeated-call
 * view, complementing the ONLINE consecutive detector), and `toolWasteView` (waste ratio). The result
 * is the "parent runs trace analyzers over the whole loop trace at settle" piece, reusing agent-eval —
 * no analysis logic is reimplemented here; this is the thin adapter that bridges live tool steps into
 * the substrate's trace model.
 *
 * Pairs with `createDetectorMonitor` (the ONLINE pipe watcher): feed both from the worker's `onToolStep`
 * seam — the monitor raises findings mid-run, the recorder produces the post-hoc trajectory at settle.
 */

import { buildTrajectory, InMemoryTraceStore, type ToolSpan } from '@tangle-network/agent-eval'
import { stuckLoopView, toolWasteView } from '@tangle-network/agent-eval/pipelines'

export interface RecordedToolStep {
  readonly toolName: string
  readonly args: unknown
  readonly status?: 'ok' | 'error'
  readonly result?: unknown
}

export interface TrajectoryAnalysis {
  /** Structured run summary: tool-call count, llm turns, total duration. */
  readonly trajectory: Awaited<ReturnType<typeof buildTrajectory>>
  /** Full-run repeated-call view (total occurrences + window), distinct from the online consecutive
   *  detector — catches a loop that is interleaved with other calls. */
  readonly stuckLoop: Awaited<ReturnType<typeof stuckLoopView>>
  /** Wasted-vs-total tool-call ratio for the run. */
  readonly toolWaste: Awaited<ReturnType<typeof toolWasteView>>
}

export interface TrajectoryRecorder {
  /** Capture one tool step (feed from the same `onToolStep` seam as the online monitor). */
  observeToolStep(step: RecordedToolStep): void
  /** Replay the captured steps as agent-eval spans and run the batch analyzers over them. */
  analyze(): Promise<TrajectoryAnalysis>
  reset(): void
}

export function createTrajectoryRecorder(
  runId: string,
  now: () => number = Date.now,
): TrajectoryRecorder {
  let steps: Array<RecordedToolStep & { at: number }> = []
  return {
    observeToolStep(step) {
      steps.push({ ...step, at: now() })
    },
    async analyze() {
      const store = new InMemoryTraceStore()
      for (let i = 0; i < steps.length; i += 1) {
        const s = steps[i]
        if (!s) continue
        const span: ToolSpan = {
          spanId: `${runId}-t${i}`,
          runId,
          kind: 'tool',
          name: s.toolName,
          toolName: s.toolName,
          args: s.args,
          status: s.status ?? 'ok',
          startedAt: s.at,
          endedAt: s.at,
          ...(s.result !== undefined ? { result: s.result } : {}),
        }
        await store.appendSpan(span)
      }
      const [trajectory, stuckLoop, toolWaste] = await Promise.all([
        buildTrajectory(store, runId),
        stuckLoopView(store, { runId }),
        toolWasteView(store, { runId }),
      ])
      return { trajectory, stuckLoop, toolWaste }
    },
    reset() {
      steps = []
    },
  }
}
