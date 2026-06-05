/**
 * @experimental
 *
 * STEP 2 of closing the autonomous loop: `createAnalystDriverHook` returns the exact
 * `analyze` callback `createDynamicDriver` already accepts. Each round it projects the
 * round's iterations into a `TraceAnalysisStore` (STEP 1), runs `runAnalystLoop` over the
 * registry, threads the prior round's findings as the baseline (cross-round memory), and
 * returns the findings — which the driver feeds to the planner via `PlannerContext.analyses`.
 *
 * This is `runAnalystLoop`'s first consumer: the wire that turns "trace analysts exist" into
 * "trace analysts drive the next prompt." The driver enforces the steer-firewall
 * (`assertTraceDerivedFindings`) on what this returns, so a kind that leaks judge-derived
 * evidence fails loud here — selector ≠ judge stays intact for free.
 */

import type { AnalystFinding, AnalystRunInputs } from '@tangle-network/agent-eval'
import type { AnalyzeInput } from '../loops/dynamic'
import type { Iteration } from '../loops/types'
import { randomSuffix } from '../loops/util'
import { iterationsToTraceStore } from './iterations-to-trace-store'
import { runAnalystLoop } from './run-analyst-loop'
import type { AnalystRegistryLike, FindingsStoreLike } from './types'

export interface AnalystDriverHookOptions {
  /** The analyst registry, pre-populated with the trace-analyst kinds to run each round. */
  registry: AnalystRegistryLike
  /**
   * Durable findings ledger. When set, each round's findings are appended and diffed
   * against the prior round (cross-run memory). `null`/omitted = one-shot, no persistence.
   */
  findingsStore?: FindingsStoreLike | null
  /** How prior-round findings reach the analysts. Default `'per-kind'` (threads memory). */
  priorFindingsStrategy?: 'per-kind' | 'wildcard' | 'none'
  /** Base run id; each round runs as `${runId}-r{round}`. Default = a random base. */
  runId?: string
}

/**
 * Build the `analyze` hook for `createDynamicDriver({ planner, analyze })`. Fail-loud: an
 * empty round throws inside `iterationsToTraceStore` rather than returning empty findings.
 */
export function createAnalystDriverHook<Task, Output>(
  opts: AnalystDriverHookOptions,
): (input: AnalyzeInput<Task, Output>) => Promise<ReadonlyArray<AnalystFinding>> {
  const baseRunId = opts.runId ?? `analyst-${randomSuffix()}`
  let priorRunId: string | undefined
  return async ({ history }: AnalyzeInput<Task, Output>) => {
    const traceStore = iterationsToTraceStore(history as ReadonlyArray<Iteration<Task, Output>>)
    const runId = `${baseRunId}-r${history.length}`
    const result = await runAnalystLoop({
      runId,
      registry: opts.registry,
      inputs: { traceStore } as AnalystRunInputs,
      findingsStore: opts.findingsStore ?? null,
      // thread the prior round's findings as the baseline → cross-round steering memory.
      baselineRunId: priorRunId,
      priorFindingsStrategy: opts.priorFindingsStrategy ?? 'per-kind',
    })
    priorRunId = runId
    return result.analystResult.findings
  }
}
