/**
 * @experimental
 *
 * FanoutVote driver — N parallel attempts in iteration 0, pick the highest-
 * scoring valid output. No second iteration: the topology is "spawn N, score,
 * pick winner". The kernel handles heterogeneous fanout via the
 * `agentRuns: AgentRunSpec[]` form on `runLoop`.
 */

import { ValidationError } from '../../errors'
import type { Driver, Iteration, LoopWinner } from '../types'

export type FanoutVoteDecision = 'pick-winner' | 'fail'

/**
 * A scored fanout entry — structurally the kernel's `LoopWinner` (one record
 * per candidate output a custom `selector` chooses among).
 *
 * @experimental
 */
export type FanoutVoteScored<Task, Output> = LoopWinner<Task, Output>

/** @experimental */
export interface CreateFanoutVoteDriverOptions<Task, Output> {
  /** Number of parallel attempts. Must be >= 1. */
  n: number
  /**
   * Pick the winner from the scored set. Default: highest `verdict.score`
   * among valid outputs (ties broken by smallest iteration index). When
   * no valid outputs exist, returns `undefined` and `decide()` resolves
   * to `'fail'`. The kernel still records winners structurally — this
   * selector only feeds `decide()`'s pass/fail signal.
   */
  selector?: (
    scored: FanoutVoteScored<Task, Output>[],
  ) => FanoutVoteScored<Task, Output> | undefined
  /** Stable identifier surfaced in trace events. Default `'fanout-vote'`. */
  name?: string
}

/** @experimental */
export function createFanoutVoteDriver<Task, Output>(
  options: CreateFanoutVoteDriverOptions<Task, Output>,
): Driver<Task, Output, FanoutVoteDecision> {
  if (!Number.isFinite(options.n) || options.n < 1) {
    throw new ValidationError(`createFanoutVoteDriver: n must be >= 1, got ${options.n}`)
  }
  const selector = options.selector ?? defaultSelector
  return {
    name: options.name ?? 'fanout-vote',
    async plan(task, history) {
      if (history.length === 0) return Array.from({ length: options.n }, () => task)
      return []
    },
    decide(history) {
      const scored = scoreIterations(history)
      return selector(scored) ? 'pick-winner' : 'fail'
    },
  }
}

function defaultSelector<Task, Output>(
  scored: FanoutVoteScored<Task, Output>[],
): FanoutVoteScored<Task, Output> | undefined {
  const valid = scored.filter((entry) => entry.verdict?.valid === true)
  if (valid.length === 0) return undefined
  return [...valid].sort(
    (a, b) =>
      (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0) || a.iterationIndex - b.iterationIndex,
  )[0]
}

function scoreIterations<Task, Output>(
  iterations: ReadonlyArray<Iteration<Task, Output>>,
): FanoutVoteScored<Task, Output>[] {
  const out: FanoutVoteScored<Task, Output>[] = []
  for (const iter of iterations) {
    if (iter.output === undefined || iter.error) continue
    out.push({
      task: iter.task,
      output: iter.output,
      verdict: iter.verdict,
      iterationIndex: iter.index,
      agentRunName: iter.agentRunName,
    })
  }
  return out
}

/**
 * Test helper: surface the per-iteration scored view a custom `selector`
 * would receive. Exposed so consumers writing a custom selector can test it
 * standalone without driving the full kernel.
 *
 * @experimental
 */
export function scoreFanoutVoteIterations<Task, Output>(
  iterations: ReadonlyArray<Iteration<Task, Output>>,
): FanoutVoteScored<Task, Output>[] {
  return scoreIterations(iterations)
}
