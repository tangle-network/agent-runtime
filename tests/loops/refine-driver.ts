import {
  type CompletionAnalyst,
  type CompletionPolicy,
  type CompletionVerdict,
  completionAuthorizes,
  type Driver,
  type Iteration,
  type LoopPlanDescription,
} from '../../src/runtime'

/**
 * One topology decision for the next round — the move shape the scripted test
 * driver replays. Mirrors the kernel's expectations: `refine` → one task next
 * round, `fanout` → N tasks, `stop`/`select` → terminate.
 */
export type ScriptedMove<Task> =
  | { kind: 'refine'; task: Task; rationale?: string; parentIndex?: number }
  | { kind: 'fanout'; tasks: Task[]; rationale?: string; parentIndex?: number }
  | { kind: 'stop'; rationale?: string }
  | { kind: 'select'; index: number; rationale?: string }

/** Per-round topology decision from task + history (sync or async). */
export type ScriptedPlanner<Task, Output> = (ctx: {
  task: Task
  history: ReadonlyArray<Iteration<Task, Output>>
}) => ScriptedMove<Task> | Promise<ScriptedMove<Task>>

export interface ScriptedDriverOptions<Task, Output> {
  planner: ScriptedPlanner<Task, Output>
  /** Hard cap on total iterations before the driver forces a stop. Default 8. */
  maxIterations?: number
  /** Max branches a single `fanout` move may dispatch (clamped). Default 4. */
  maxFanout?: number
  /** Optional deployable, non-oracle completion analyst consulted (after a trace
   *  exists) BEFORE the planner; an authorizing verdict stops the loop. */
  complete?: CompletionAnalyst<Task, Output>
  completionPolicy?: CompletionPolicy
  name?: string
}

/**
 * Minimal scripted driver — test scaffolding only. Replays a fixed (or
 * function-computed) sequence of topology moves through the real `runAgentRounds`
 * kernel: it implements `plan`/`decide`/`describePlan`/`selectWinner` so kernel
 * coverage (abort, teardown, lineage prune/fork, completion stop) survives
 * without the deleted dynamic `createDriver`. It is NOT a model of an
 * agent-authored planner — it is the smallest deterministic vehicle the kernel
 * tests need. The presence of `describePlan` makes the kernel treat the driver
 * as authoring its own branch point (canPrune = false), matching the lineage
 * tests' expectations.
 */
export function scriptedDriver<Task, Output>(
  opts: ScriptedDriverOptions<Task, Output>,
): Driver<Task, Output, 'continue' | 'done'> {
  const maxIterations = opts.maxIterations ?? 8
  const maxFanout = opts.maxFanout ?? 4
  let pending: ScriptedMove<Task> | undefined
  return {
    name: opts.name ?? 'scripted',
    async plan(task, history) {
      if (history.length >= maxIterations) {
        pending = { kind: 'stop', rationale: `maxIterations (${maxIterations}) reached` }
        return []
      }
      if (opts.complete && history.length > 0) {
        const verdict = (await opts.complete.assess({ task, history })) as CompletionVerdict
        if (completionAuthorizes(verdict, opts.completionPolicy)) {
          pending = {
            kind: 'stop',
            rationale: `complete (${verdict.determinism}): ${verdict.reasons ?? 'satisfied'}`,
          }
          return []
        }
      }
      const move = await opts.planner({ task, history })
      // Clamp an over-wide fanout rather than reject (a budget concern).
      pending =
        move.kind === 'fanout' && move.tasks.length > maxFanout
          ? { kind: 'fanout', tasks: move.tasks.slice(0, maxFanout) }
          : move
      switch (pending.kind) {
        case 'refine':
          return [pending.task]
        case 'fanout':
          return pending.tasks
        case 'stop':
        case 'select':
          return []
      }
    },
    decide() {
      return pending?.kind === 'stop' || pending?.kind === 'select' ? 'done' : 'continue'
    },
    describePlan() {
      if (!pending) return undefined
      const out: LoopPlanDescription = { kind: pending.kind }
      if (pending.rationale !== undefined) out.rationale = pending.rationale
      if (
        (pending.kind === 'refine' || pending.kind === 'fanout') &&
        pending.parentIndex !== undefined
      ) {
        out.parentIndex = pending.parentIndex
      }
      return out
    },
    selectWinner(history) {
      if (pending?.kind !== 'select') return undefined
      const iter = history[pending.index]
      if (!iter || iter.output === undefined) return undefined
      return {
        task: iter.task,
        output: iter.output,
        verdict: iter.verdict,
        iterationIndex: iter.index,
        agentRunName: iter.agentRunName,
      }
    },
  }
}

/**
 * A minimal replay-until-valid driver — test scaffolding only. The product no longer ships a
 * `createRefineDriver` factory (the driver is a sandbox harness, not a code factory; see
 * docs/architecture.md §1). Kernel/composition tests still need *a* driver to exercise the loop, so
 * this 15-line equivalent lives in the test tree, not the library.
 */
export function refineDriver<Task, Output>(
  opts: { maxIterations?: number } = {},
): Driver<Task, Output, 'continue' | 'stop'> {
  const max = opts.maxIterations ?? 5
  return {
    name: 'refine',
    async plan(task, history) {
      if (history.length >= max) return []
      if (history.length === 0) return [task]
      const prior = history.at(-1)
      if (!prior || prior.verdict?.valid === true) return []
      return [prior.task]
    },
    decide(history) {
      const last = history.at(-1)
      if (last?.verdict?.valid === true || history.length >= max) return 'stop'
      return 'continue'
    },
  }
}

/** A single-round fanout: N copies round 0, then stop; the kernel selects the best-valid. Test
 *  scaffolding — the product no longer ships a `createFanoutVoteDriver` factory. */
export function fanoutDriver<Task, Output>(
  n: number,
): Driver<Task, Output, 'pick-winner' | 'fail'> {
  return {
    name: 'fanout',
    plan: async (task, history) =>
      history.length === 0 ? Array.from({ length: n }, () => task) : [],
    decide: (history) => (history.some((i) => i.verdict?.valid === true) ? 'pick-winner' : 'fail'),
  }
}
