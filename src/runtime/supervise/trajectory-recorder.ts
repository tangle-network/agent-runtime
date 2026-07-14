/**
 *
 * The SETTLE-time analyst: when a worker finishes, collect its tool spans from a `TraceSource` and run
 * agent-eval's PUBLISHED batch analyzers over them — `buildTrajectory` (structured run summary),
 * `stuckLoopView` (full-run repeated-call view, complementing the online consecutive detector), and
 * `toolWasteView`. Substrate-agnostic: the spans come from any source (an owned loop's buffer OR a
 * sandbox box session). No analysis reimplemented — this is the thin bridge into agent-eval's analyzers.
 *
 * @experimental
 */

import { buildTrajectory, InMemoryTraceStore } from '@tangle-network/agent-eval'
import { stuckLoopView, toolWasteView } from '@tangle-network/agent-eval/pipelines'
import type { TraceSource } from './trace-source'

export interface TrajectoryAnalysis {
  /** Structured run summary (tool-call count, step order). Steps carry a single timestamp, so per-span
   *  duration is 0; loop/waste detection keys on call PATTERNS + cross-span windows, not durations. */
  readonly trajectory: Awaited<ReturnType<typeof buildTrajectory>>
  /** Full-run repeated-call view (total occurrences + window) — allows one intervening call so it
   * catches a loop the online consecutive detector interleaves past. */
  readonly stuckLoop: Awaited<ReturnType<typeof stuckLoopView>>
  /** Wasted-vs-total tool-call ratio for the run. */
  readonly toolWaste: Awaited<ReturnType<typeof toolWasteView>>
}

/** Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`. */
export async function analyzeTrace(
  source: TraceSource,
  runId = 'worker',
): Promise<TrajectoryAnalysis> {
  const spans = await source.collect()
  const store = new InMemoryTraceStore()
  const laneSpanId = `${runId}-session-lane`
  if (spans.length > 0) {
    const startedAt = Math.min(...spans.map((span) => span.startedAt))
    const endedAt = Math.max(...spans.map((span) => span.endedAt ?? span.startedAt))
    const agentSpanId = `${runId}-agent`
    await store.appendSpan({
      spanId: agentSpanId,
      runId,
      kind: 'agent',
      name: 'trace-source-agent',
      startedAt,
      endedAt,
    })
    await store.appendSpan({
      spanId: laneSpanId,
      parentSpanId: agentSpanId,
      runId,
      kind: 'custom',
      name: 'trace-source-session',
      startedAt,
      endedAt,
    })
  }
  // Re-stamp onto one runId so the runId-filtered analyzers see the whole trace regardless of the
  // source's own id scheme. A TraceSource carries tool spans only, so attach
  // them to one explicit session lane; 0.117's analyzer uses ancestry plus
  // overlap times to distinguish serial repeats from parallel siblings.
  for (let i = 0; i < spans.length; i += 1) {
    const s = spans[i]
    if (s) {
      await store.appendSpan({
        ...s,
        runId,
        spanId: `${runId}-t${i}`,
        parentSpanId: laneSpanId,
      })
    }
  }
  const [trajectory, stuckLoop, toolWaste] = await Promise.all([
    buildTrajectory(store, runId),
    stuckLoopView(store, { runId, maxInterveningToolCalls: 1 }),
    toolWasteView(store, { runId }),
  ])
  return { trajectory, stuckLoop, toolWaste }
}
