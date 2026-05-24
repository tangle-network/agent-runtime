/**
 * @experimental
 *
 * Loop-topology trace events. Independent from `runHandle.observe`, which
 * tracks cost. These describe the loop's iteration tree so downstream eval
 * pipelines can group traces by topology (refine vs fanout, which spec ran
 * each iteration, who won).
 *
 * Re-exported from `./types` for back-compat with the kernel's local imports;
 * the canonical home is `./types` so call sites that already import from
 * `loops` don't double-import.
 */

export type {
  LoopDecisionPayload,
  LoopEndedPayload,
  LoopIterationEndedPayload,
  LoopIterationStartedPayload,
  LoopStartedPayload,
  LoopTraceEmitter,
  LoopTraceEvent,
} from './types'
