/**
 * @experimental
 *
 * Dynamic driver — the agent authors the loop topology at runtime.
 *
 * Where `refine` and `fanout-vote` encode a fixed shape as a pure function of
 * history, this driver delegates the per-round shape to an injected
 * `TopologyPlanner`. Each round the planner inspects the task + iteration
 * history and emits one `TopologyMove`:
 *   - `refine` → one task next round (optionally rewritten from the prior attempt)
 *   - `fanout` → N tasks next round (the kernel round-robins `agentRuns`, so a
 *     2-harness fanout dispatches branch 0 to harness A and branch 1 to harness B)
 *   - `stop`   → terminate; the kernel selects the winner across all iterations
 *
 * The planner is the brain; this driver is the structure. It maps moves onto
 * the kernel's `plan`/`decide` contract, enforces the iteration + fanout caps,
 * and fails loud on a malformed move. The planner is injected exactly like
 * `refine`'s `refineTask` and `fanout-vote`'s `selector` — so a test can drive
 * a deterministic policy through the real kernel, and production can wire it to
 * an LLM via `createSandboxPlanner`.
 *
 * Topology is orthogonal to harness: the planner never names a backend. Which
 * harness runs a branch is decided by the `AgentRunSpec` the kernel round-robins
 * to, so one dynamic driver works across claude-code, codex, opencode, pi —
 * including fanning a single round across several at once.
 */

import { PlannerError, ValidationError } from '../../errors'
import type { Driver, Iteration } from '../types'

/** Terminal once `decide` returns `'done'` (a kernel terminal decision). */
export type DynamicDecision = 'continue' | 'done'

/**
 * One topology decision for the next round. `fanout` carries explicit tasks
 * rather than a count so the planner can issue heterogeneous branches (a
 * different sub-task per harness); pass N copies of one task for a homogeneous
 * fanout that relies on `agentRuns` diversity instead.
 *
 * @experimental
 */
export type TopologyMove<Task> =
  | { kind: 'refine'; task: Task; rationale?: string }
  | { kind: 'fanout'; tasks: Task[]; rationale?: string }
  | { kind: 'stop'; rationale?: string }

/** @experimental */
export interface PlannerContext<Task, Output> {
  /** The root task the loop was invoked with — stable across rounds. */
  task: Task
  /** Every iteration so far, in dispatch order, with outputs + verdicts. */
  history: ReadonlyArray<Iteration<Task, Output>>
  /** `history.length` — iterations already spent. */
  iterationsSpent: number
  /** Iterations left before the driver's `maxIterations` cap forces a stop. */
  iterationsRemaining: number
}

/**
 * Chooses the next topology move from the task + history. Sync or async; an
 * async planner is where an LLM call goes (see `createSandboxPlanner`).
 *
 * @experimental
 */
export type TopologyPlanner<Task, Output> = (
  ctx: PlannerContext<Task, Output>,
) => TopologyMove<Task> | Promise<TopologyMove<Task>>

/** @experimental */
export interface CreateDynamicDriverOptions<Task, Output> {
  /** The agent-authored topology policy. Invoked once per round in `plan`. */
  planner: TopologyPlanner<Task, Output>
  /**
   * Hard safety cap on total iterations. When reached, the driver stops before
   * consulting the planner. Default 8. Set the kernel's `runLoop`
   * `maxIterations >= ` this so the driver's cap governs and the loop closes on
   * a clean `'done'` rather than a truncated `'continue'`.
   */
  maxIterations?: number
  /** Max branches a single `fanout` move may dispatch. Default 4. */
  maxFanout?: number
  /** Stable identifier surfaced in trace events. Default `'dynamic'`. */
  name?: string
}

/** @experimental */
export function createDynamicDriver<Task, Output>(
  options: CreateDynamicDriverOptions<Task, Output>,
): Driver<Task, Output, DynamicDecision> {
  if (typeof options.planner !== 'function') {
    throw new ValidationError('createDynamicDriver: planner must be a function')
  }
  const maxIterations = options.maxIterations ?? 8
  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    throw new ValidationError('createDynamicDriver: maxIterations must be > 0')
  }
  const maxFanout = options.maxFanout ?? 4
  if (!Number.isFinite(maxFanout) || maxFanout < 1) {
    throw new ValidationError('createDynamicDriver: maxFanout must be >= 1')
  }

  // The kernel calls plan(), runs the batch, then calls decide() — strictly
  // sequential, one driver instance per loop. Caching the move the planner
  // chose this round lets decide() report terminality without re-invoking the
  // planner (which would double every LLM call).
  let pending: TopologyMove<Task> | undefined

  return {
    name: options.name ?? 'dynamic',
    async plan(task, history) {
      if (history.length >= maxIterations) {
        pending = { kind: 'stop', rationale: `maxIterations (${maxIterations}) reached` }
        return []
      }
      const move = await options.planner({
        task,
        history,
        iterationsSpent: history.length,
        iterationsRemaining: maxIterations - history.length,
      })
      pending = validateMove(move, maxFanout)
      switch (pending.kind) {
        case 'refine':
          return [pending.task]
        case 'fanout':
          return pending.tasks
        case 'stop':
          return []
      }
    },
    decide() {
      // pending is set by the plan() call that immediately precedes every
      // decide(). Only a `stop` move terminates; refine/fanout keep looping so
      // plan() — and thus the planner — runs again next round.
      return pending?.kind === 'stop' ? 'done' : 'continue'
    },
    describePlan() {
      // Surface the move the planner just chose (kind + rationale) so the
      // kernel's loop.plan trace event carries the agent's intent, not just the
      // inferred fan-width. `pending` is the move set by the preceding plan().
      if (!pending) return undefined
      return pending.rationale !== undefined
        ? { kind: pending.kind, rationale: pending.rationale }
        : { kind: pending.kind }
    },
  }
}

function validateMove<Task>(move: TopologyMove<Task>, maxFanout: number): TopologyMove<Task> {
  if (!move || typeof move !== 'object' || typeof (move as { kind?: unknown }).kind !== 'string') {
    throw new PlannerError(`dynamic planner returned a non-move value: ${describe(move)}`)
  }
  switch (move.kind) {
    case 'refine':
      return move
    case 'stop':
      return move
    case 'fanout': {
      if (!Array.isArray(move.tasks) || move.tasks.length === 0) {
        throw new PlannerError('dynamic planner fanout move must carry a non-empty tasks[]')
      }
      if (move.tasks.length <= maxFanout) return move
      // Clamp rather than reject — over-fanning is a budget concern, not a
      // structural error. The clamp is recorded in the rationale for traces.
      return {
        kind: 'fanout',
        tasks: move.tasks.slice(0, maxFanout),
        rationale: `${move.rationale ?? ''} [clamped ${move.tasks.length}→${maxFanout}]`.trim(),
      }
    }
    default:
      throw new PlannerError(
        `dynamic planner returned unknown move kind: ${describe((move as { kind: unknown }).kind)}`,
      )
  }
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Compact, planner-friendly view of iteration history — what an LLM planner
 * needs to choose the next move without the raw event streams. Output is
 * truncated so a long run's prompt stays bounded.
 *
 * @experimental
 */
export function summarizeHistory<Task, Output>(
  history: ReadonlyArray<Iteration<Task, Output>>,
  opts: { maxOutputChars?: number } = {},
): Array<{
  index: number
  agentRunName: string
  valid?: boolean
  score?: number
  error?: string
  output?: string
}> {
  const maxOutputChars = opts.maxOutputChars ?? 600
  return history.map((iter) => {
    const row: {
      index: number
      agentRunName: string
      valid?: boolean
      score?: number
      error?: string
      output?: string
    } = { index: iter.index, agentRunName: iter.agentRunName }
    if (iter.verdict) {
      row.valid = iter.verdict.valid
      if (typeof iter.verdict.score === 'number') row.score = iter.verdict.score
    }
    if (iter.error) row.error = iter.error.message
    if (iter.output !== undefined) {
      const serialized = describe(iter.output)
      row.output =
        serialized.length > maxOutputChars ? `${serialized.slice(0, maxOutputChars)}…` : serialized
    }
    return row
  })
}
