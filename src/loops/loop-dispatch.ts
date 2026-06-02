/**
 * `loopDispatch` — turn `runLoop` into an agent-eval campaign dispatch.
 *
 * Without this adapter a consumer wiring `runLoop` into `runProfileMatrix` /
 * `runCampaign` has to, by hand, every time: (a) build an `ExecCtx` with a
 * sandbox client, (b) adapt the campaign `DispatchContext.trace` into a
 * `LoopTraceEmitter` (or lose all loop trace correlation), and (c) remember to
 * forward the loop's cost + tokens via `ctx.cost` (forgetting it yields a
 * `{0,0}` cell the backend-integrity guard reads as a stub). Three foot-guns,
 * the third silent. The fleet's products skipped (c) and fell back to a
 * `workerRecords[]` side-channel — the exact anti-pattern the substrate exists
 * to kill.
 *
 * `loopDispatch` collapses all three into one typed call:
 *
 *   const dispatch = loopDispatch({
 *     sandboxClient,
 *     toLoopOptions: (scenario, profile) => ({ driver, agentRun, output, validator, task }),
 *   })
 *   await runProfileMatrix({ profiles, scenarios, dispatch, judges, commitSha })
 *
 * Usage is reported automatically; trace events are forwarded automatically;
 * the ctx is built automatically. The seam becomes impossible to mis-wire.
 *
 * Typed structurally against the campaign `DispatchContext` (imported type-only
 * from `@tangle-network/agent-eval/campaign`) — a downward dependency, never an
 * inversion.
 */

// agent-eval's AgentProfile (the eval-harness unit of variation, `model: string`)
// — NOT sandbox's AgentProfile. ProfileDispatchFn is keyed on the former.
import type { AgentProfile } from '@tangle-network/agent-eval'
import type {
  CampaignTraceWriter,
  DispatchContext,
  ProfileDispatchFn,
  Scenario,
} from '@tangle-network/agent-eval/campaign'
import { reportLoopUsage } from './report-usage'
import { type RunLoopOptions, runLoop } from './run-loop'
import type { LoopResult, LoopSandboxClient, LoopTraceEmitter } from './types'

/** runLoop options minus the `ctx` (loopDispatch builds the ctx). */
export type LoopOptionsForDispatch<Task, Output, Decision> = Omit<
  RunLoopOptions<Task, Output, Decision>,
  'ctx'
>

export interface LoopDispatchOptions<
  Task,
  Output,
  Decision,
  TScenario extends Scenario,
  TArtifact,
> {
  /** Sandbox client used for every cell's `runLoop`. Supplied once. */
  sandboxClient: LoopSandboxClient
  /** Build the per-cell runLoop options from the scenario (+ profile, when
   *  used with `runProfileMatrix`). */
  toLoopOptions: (
    scenario: TScenario,
    profile: AgentProfile,
  ) => LoopOptionsForDispatch<Task, Output, Decision>
  /** Map the finished loop to the artifact the judges score. Default:
   *  `result.winner?.output`. A loop with no winner yields `undefined` (judges
   *  skip the cell) — but the loop's token usage is STILL reported, so the
   *  integrity guard sees real activity. */
  toArtifact?: (result: LoopResult<Task, Output, Decision>) => TArtifact
  /** Forward `loop.*` trace events into the campaign's scoped trace so loop
   *  spans correlate with the cell. Default true. */
  forwardTrace?: boolean
  /** Cost-meter source label for the loop's spend. Default `'loop'`. */
  costSource?: string
}

/** Bridge a campaign `DispatchContext.trace` to a `LoopTraceEmitter` so every
 *  `loop.*` event lands as a span under the cell's scoped trace. */
function campaignTraceToLoopEmitter(trace: CampaignTraceWriter): LoopTraceEmitter {
  return {
    emit(event) {
      trace
        .span(event.kind, { runId: event.runId, timestamp: event.timestamp, ...event.payload })
        .end()
    },
  }
}

async function runLoopForCell<Task, Output, Decision, TScenario extends Scenario, TArtifact>(
  opts: LoopDispatchOptions<Task, Output, Decision, TScenario, TArtifact>,
  scenario: TScenario,
  profile: AgentProfile,
  ctx: DispatchContext,
): Promise<TArtifact> {
  const loopOptions = opts.toLoopOptions(scenario, profile)
  const result = await runLoop<Task, Output, Decision>({
    ...loopOptions,
    ctx: {
      sandboxClient: opts.sandboxClient,
      signal: ctx.signal,
      traceEmitter: opts.forwardTrace === false ? undefined : campaignTraceToLoopEmitter(ctx.trace),
    },
  })
  reportLoopUsage(ctx.cost, result, opts.costSource ?? 'loop')
  const toArtifact =
    opts.toArtifact ?? ((r: LoopResult<Task, Output, Decision>) => r.winner?.output as TArtifact)
  return toArtifact(result)
}

/**
 * Adapter for `runProfileMatrix` (profile is an axis). Returns a
 * `ProfileDispatchFn` that runs `runLoop` per (profile, scenario) cell and
 * reports usage automatically.
 */
export function loopDispatch<Task, Output, Decision, TScenario extends Scenario, TArtifact>(
  opts: LoopDispatchOptions<Task, Output, Decision, TScenario, TArtifact>,
): ProfileDispatchFn<TScenario, TArtifact> {
  return (profile, scenario, ctx) => runLoopForCell(opts, scenario, profile, ctx)
}
