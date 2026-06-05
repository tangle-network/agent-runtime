/**
 * Bridge a finished `runLoop` into an agent-eval campaign / profile-matrix
 * dispatch.
 *
 * `runProfileMatrix` (and `runCampaign`) run the backend-integrity guard over
 * the token usage a dispatch reports through `ctx.cost`. A dispatch that wraps
 * `runLoop` must forward the loop's cost AND token usage, or the guard reads
 * the run as a stub and throws. `reportLoopUsage` is that one line:
 *
 *   const dispatch: ProfileDispatchFn<S, A> = async (profile, scenario, ctx) => {
 *     const result = await runLoop({ ...optsFor(profile, scenario), ctx: loopCtx })
 *     reportLoopUsage(ctx, result)
 *     return result.winner?.output as A
 *   }
 *
 * Typed structurally against the campaign `DispatchContext.cost` so this module
 * stays free of an agent-eval import — it works with any cost meter exposing
 * `observe` + `observeTokens`.
 */

import type { LoopResult, LoopTokenUsage } from './types'

/** The slice of an agent-eval campaign `DispatchContext.cost` this needs. */
export interface UsageSink {
  observe(amountUsd: number, source: string): void
  observeTokens(usage: LoopTokenUsage): void
}

/**
 * Forward a `LoopResult`'s aggregated cost + token usage into a campaign cost
 * meter so the backend-integrity guard sees real LLM activity. `source`
 * defaults to `'loop'`.
 */
export function reportLoopUsage<Task, Output, Decision>(
  cost: UsageSink,
  result: Pick<LoopResult<Task, Output, Decision>, 'costUsd' | 'tokenUsage'>,
  source = 'loop',
): void {
  cost.observe(result.costUsd, source)
  cost.observeTokens(result.tokenUsage)
}
