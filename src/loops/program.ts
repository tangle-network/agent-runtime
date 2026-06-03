/**
 * @experimental
 *
 * The Program op-set — the recursive Agent atom's composable topology language
 * (docs/architecture.md §1). Where `TopologyMove` is ONE move per round (a flat
 * tagged union), a `Program` is a COMPOSABLE tree over the op-set
 * `{ sample, steer, fork, select, seq, stop }` that an Agent's `act()` emits and the
 * kernel executes. This is the model the architecture doc describes; the runtime
 * shipped only the flat `TopologyMove` until now.
 *
 * `compileProgram` turns a Program into a `TopologyPlanner` that drives the existing
 * `runLoop` — so the op-set is real, composable, and emittable TODAY over the
 * per-round kernel. The op→move mapping:
 *   - sample{task,n}  → fanout n (n>=2) | refine (n=1): n independent attempts
 *   - steer{task}     → refine: one attempt carrying a (rewritten) task
 *   - fork{branches}  → fanout: N heterogeneous leaf branches in parallel
 *   - select{index}   → select: declare the winner (TERMINAL, like the doc's prune)
 *   - seq{steps}      → the steps in order, one per round (sequential composition)
 *   - stop            → stop
 *
 * KNOWN LIMIT (honest): a `fork` whose branch is itself a multi-round `Program`
 * (true nested PARALLEL sub-loops) cannot run on the per-round kernel — `plan()`
 * returns a flat `Task[]` for one batch, not a tree. `flattenProgram` FAILS LOUD on a
 * non-leaf fork branch rather than silently flattening it; lifting that needs a
 * tree-walking kernel executor (the next increment). `select` is terminal here, so it
 * must be the last step of a `seq` (a mid-seq select ends the program).
 */

import { PlannerError } from '../errors'
import type { TopologyMove, TopologyPlanner } from './drivers/dynamic'
import type { Iteration } from './types'
import { stringifySafe } from './util'

/** @experimental The composable topology program an Agent's `act()` emits. */
export type Program<Task> =
  | { op: 'sample'; task: Task; n?: number; rationale?: string }
  | { op: 'steer'; task: Task; rationale?: string }
  | { op: 'fork'; branches: Task[]; rationale?: string }
  | { op: 'select'; index: number; rationale?: string }
  | { op: 'seq'; steps: Program<Task>[] }
  | { op: 'stop'; rationale?: string }

/**
 * Flatten a Program into the per-round `TopologyMove` queue the kernel executes one
 * move at a time. `seq` concatenates its steps; the other ops map to a single move.
 * Fails loud on what the per-round kernel cannot express (an empty fork, a non-leaf
 * fork branch i.e. nested parallel sub-loops, an empty/`stop`-free program).
 */
export function flattenProgram<Task>(program: Program<Task>): TopologyMove<Task>[] {
  switch (program.op) {
    case 'sample': {
      const n = program.n ?? 1
      if (!Number.isInteger(n) || n < 1) {
        throw new PlannerError(
          `Program sample.n must be a positive integer, got ${stringifySafe(n)}`,
        )
      }
      return n >= 2
        ? [
            {
              kind: 'fanout',
              tasks: Array.from({ length: n }, () => program.task),
              rationale: program.rationale,
            },
          ]
        : [{ kind: 'refine', task: program.task, rationale: program.rationale }]
    }
    case 'steer':
      return [{ kind: 'refine', task: program.task, rationale: program.rationale }]
    case 'fork':
      if (!Array.isArray(program.branches) || program.branches.length === 0) {
        throw new PlannerError('Program fork must carry a non-empty branches[] of leaf tasks')
      }
      return [{ kind: 'fanout', tasks: program.branches, rationale: program.rationale }]
    case 'select':
      return [{ kind: 'select', index: program.index, rationale: program.rationale }]
    case 'stop':
      return [{ kind: 'stop', rationale: program.rationale }]
    case 'seq': {
      if (!Array.isArray(program.steps) || program.steps.length === 0) {
        throw new PlannerError('Program seq must carry a non-empty steps[]')
      }
      return program.steps.flatMap(flattenProgram)
    }
    default:
      throw new PlannerError(
        `unknown Program op: ${stringifySafe((program as { op: unknown }).op)}`,
      )
  }
}

/**
 * Compile a Program into a `TopologyPlanner` for `createDynamicDriver`. The compiled
 * planner emits one queued move per round (so a `seq` runs its steps across rounds),
 * short-circuits to `stop` the moment any attempt is valid, and `stop`s when the
 * program is exhausted. A FIXED program (the agent committed to a topology); for an
 * adaptive program re-emitted from context each round, see `agentProgramPlanner`.
 */
export function compileProgram<Task, Output>(
  program: Program<Task>,
): TopologyPlanner<Task, Output> {
  const queue = flattenProgram(program)
  let cursor = 0
  return ({ history }) => {
    if (history.some((h) => h.verdict?.valid === true)) {
      return { kind: 'stop', rationale: 'a valid result exists' }
    }
    if (cursor < queue.length) return queue[cursor++] as TopologyMove<Task>
    return { kind: 'stop', rationale: 'program complete' }
  }
}

/**
 * @experimental The recursive Agent atom (docs/architecture.md §1): `act` returns a
 * `Program` (the agent DRIVES — decides topology) given the context (task + history).
 * `agentProgramPlanner` is the bridge: it calls `act` once (round 0) to obtain the
 * agent's program, then executes it across rounds via `compileProgram`. (A worker
 * atom — `act` returning an `Output` — is the leaf the kernel already dispatches.)
 */
export interface Agent<Task, Output> {
  act: (ctx: {
    task: Task
    history: ReadonlyArray<Iteration<Task, Output>>
  }) => Program<Task> | Promise<Program<Task>>
}

export function agentProgramPlanner<Task, Output>(
  agent: Agent<Task, Output>,
): TopologyPlanner<Task, Output> {
  let compiled: TopologyPlanner<Task, Output> | undefined
  return async (ctx) => {
    if (!compiled)
      compiled = compileProgram<Task, Output>(
        await agent.act({ task: ctx.task, history: ctx.history }),
      )
    return compiled(ctx)
  }
}
