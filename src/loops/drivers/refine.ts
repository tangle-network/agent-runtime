/**
 * @experimental
 *
 * Refine driver — single task per iteration, validator-gated.
 *
 * `plan` returns `[task]` (possibly transformed via `refineTask`) until the
 * prior verdict is valid OR the local cap is hit, then `[]`.
 * `decide` returns `'stop'` once the latest verdict is valid OR the cap is
 * reached. The kernel's `maxIterations` is an orthogonal safety cap;
 * whichever is lower wins.
 */

import { ValidationError } from '../../errors'
import type { DefaultVerdict, Driver, Iteration } from '../types'

export type RefineDecision = 'continue' | 'stop'

/** @experimental */
export interface CreateRefineDriverOptions<Task> {
  /** Hard cap on iterations. Default 5. */
  maxIterations?: number
  /**
   * Optional task transform applied each round based on the prior verdict.
   * When omitted, the same task is replayed and the agent is expected to
   * inspect the sandbox session state for prior attempts.
   */
  refineTask?: (task: Task, prior: DefaultVerdict) => Task
  /** Stable identifier surfaced in trace events. Default `'refine'`. */
  name?: string
}

/** @experimental */
export function createRefineDriver<Task, Output>(
  options: CreateRefineDriverOptions<Task> = {},
): Driver<Task, Output, RefineDecision> {
  const maxIterations = options.maxIterations ?? 5
  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    throw new ValidationError('createRefineDriver: maxIterations must be > 0')
  }
  const refineTask = options.refineTask
  return {
    name: options.name ?? 'refine',
    async plan(task, history) {
      if (history.length >= maxIterations) return []
      if (history.length === 0) return [task]
      const prior = history.at(-1)
      if (!prior) return [task]
      if (prior.verdict?.valid === true) return []
      // Worker error: replay the same task so the agent can self-correct.
      // The driver has no signal beyond `verdict`; only the validator
      // controls "good enough".
      if (!refineTask || !prior.verdict) return [prior.task]
      return [refineTask(prior.task, prior.verdict)]
    },
    decide(history) {
      const last = history.at(-1)
      if (!last) return 'continue'
      if (last.verdict?.valid === true) return 'stop'
      if (history.length >= maxIterations) return 'stop'
      return 'continue'
    },
  }
}

/**
 * Test helper: select the last-valid iteration (or the last attempt if
 * none passed). Mirrors the kernel's default selector ordering for refine
 * topologies — the most recent successful attempt wins.
 *
 * @experimental
 */
export function refineWinnerIndex<Task, Output>(
  iterations: ReadonlyArray<Iteration<Task, Output>>,
): number | undefined {
  for (let i = iterations.length - 1; i >= 0; i -= 1) {
    if (iterations[i]?.verdict?.valid) return i
  }
  return iterations.length > 0 ? iterations.length - 1 : undefined
}
