/**
 * @experimental
 *
 * The Program op-set — the recursive Agent atom's composable topology language
 * (docs/architecture.md §1). Where `TopologyMove` is ONE move per round (a flat
 * tagged union), a `Program` is a COMPOSABLE tree over the op-set
 * `{ sample, steer, fork, parallel, select, seq, stop }` that an Agent's `act()`
 * emits. This is the model the architecture doc describes; the runtime shipped only
 * the flat `TopologyMove` until now.
 *
 * Two parallelisms, at two layers — kept as distinct ops so the cost/trace shapes
 * stay honest:
 *   - WORKER layer — `fork`/`sample(n)`: N leaf attempts in ONE fanout round of a
 *     SINGLE loop (heterogeneous across `agentRuns`). Cheap; one loop, one batch.
 *   - LOOP layer — `parallel{branches: Program[]}`: N concurrent SUB-LOOPS, each its
 *     own multi-round `runLoop`. This is "a driver driving multiple loops / dynamic
 *     workflows": a branch can itself be a `seq`/`fork`/`parallel` tree.
 *
 * Two executors, by capability:
 *   - `compileProgram(program) → TopologyPlanner` executes a STRAIGHT-LINE program
 *     (no `parallel`) over the existing per-round kernel — one `runLoop`, free history
 *     threading across `seq` rounds. The op→move mapping:
 *       sample{task,n} → fanout n (n>=2) | refine (n=1) · steer{task} → refine ·
 *       fork{branches} → fanout · select{index} → select (declare winner, terminal) ·
 *       seq{steps} → the steps in order, one per round · stop → stop
 *     It FAILS LOUD on `parallel` (a per-round move queue can't express a sub-loop).
 *   - `runProgram(program, opts)` is the tree-walking executor: it runs the largest
 *     straight-line subtree as one `runLoop` (preserving threading) and forks into
 *     CONCURRENT `runLoop`s at each `parallel` node, merging their iterations + cost +
 *     tokens and selecting a global winner with the kernel's own selector.
 *
 * `select` selects among the iterations of its enclosing straight-line segment (the
 * one `runLoop` it compiles into). Cross-branch selection at a `parallel` node is the
 * merge's job (best-valid-score over all branches), so a `select` placed directly
 * after a `parallel` boundary in a `seq` FAILS LOUD rather than mis-indexing.
 */

import { PlannerError } from '../errors'
import type { CompletionAnalyst, CompletionPolicy } from './completion'
import type { TopologyMove, TopologyPlanner } from './dynamic'
import { createDynamicDriver } from './dynamic'
import { defaultSelectWinner, runLoop } from './run-loop'
import type {
  AgentRunSpec,
  ExecCtx,
  Iteration,
  LoopTokenUsage,
  LoopWinner,
  OutputAdapter,
  Validator,
} from './types'
import { addTokenUsage, stringifySafe, zeroTokenUsage } from './util'

/** @experimental The composable topology program an Agent's `act()` emits. */
export type Program<Task> =
  | { op: 'sample'; task: Task; n?: number; rationale?: string }
  | { op: 'steer'; task: Task; rationale?: string }
  | { op: 'fork'; branches: Task[]; rationale?: string }
  | { op: 'parallel'; branches: Program<Task>[]; rationale?: string }
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
    case 'parallel':
      throw new PlannerError(
        'Program parallel{} runs concurrent SUB-LOOPS — it cannot flatten to a per-round ' +
          'move queue. Execute it with runProgram(), not compileProgram().',
      )
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

// ── runProgram: the tree-walking executor (loop-layer parallelism) ──────────

const DEFAULT_PROGRAM_MAX_ITERATIONS = 10
/** Recursion-depth ceiling for the tree executor — the guard against ~k^depth sub-loop
 *  blowup. Matches the agent-bus depth ceiling; raise opts.maxDepth deliberately. */
const DEFAULT_PROGRAM_MAX_DEPTH = 4

/**
 * @experimental Result of executing a `Program` tree. Structurally a `LoopResult`
 * minus `decision` (a tree has no single driver decision): the merged iterations
 * (re-indexed contiguously across every sub-loop), the global winner, and summed
 * cost + token usage. `durationMs` is wall-clock — summed across `seq` segments,
 * MAX across concurrent `parallel` branches.
 */
export interface ProgramResult<Task, Output> {
  iterations: Iteration<Task, Output>[]
  winner?: LoopWinner<Task, Output>
  costUsd: number
  tokenUsage: LoopTokenUsage
  durationMs: number
}

/** @experimental Options for `runProgram` / `runAgent` — the shared `runLoop`
 *  configuration every sub-loop in the tree inherits (driver + task are derived
 *  per-node from the program). */
export interface RunProgramOptions<Task, Output> {
  /** Single agent spec for every sub-loop. Mutually exclusive with `agentRuns`. */
  agentRun?: AgentRunSpec<Task>
  /** Heterogeneous specs round-robined within each sub-loop's fanout. */
  agentRuns?: AgentRunSpec<Task>[]
  output: OutputAdapter<Output>
  validator?: Validator<Output>
  ctx: ExecCtx
  /** Per-SUB-LOOP iteration cap (each straight-line segment / parallel branch). Default 10. */
  maxIterations?: number
  /** In-flight worker cap WITHIN a single sub-loop's fanout batch. Default = kernel's. */
  maxConcurrency?: number
  /**
   * Max concurrent `parallel` BRANCHES (sub-loops) at one node. Default = all branches
   * at once. Bounds the multiplicative sandbox load: up to `maxParallel × maxConcurrency`
   * boxes live at once under a `parallel`.
   */
  maxParallel?: number
  /** Trace-correlation root; each sub-loop runs under `${runId}/<tree-path>`. */
  runId?: string
  now?: () => number
  /**
   * Winner selector at every merge point (parallel + seq accumulation) and inside each
   * sub-loop. Default = the kernel's `defaultSelectWinner` (best-valid-score, ties
   * earliest index) — single-sourced, not a forked copy.
   */
  selectWinner?: (iterations: Iteration<Task, Output>[]) => LoopWinner<Task, Output> | undefined
  /**
   * Max recursion DEPTH of the tree (nesting of `parallel` / `seq`-with-`parallel`). The
   * executor FAILS LOUD past this — the only guard against a driver-of-drivers blowing up to
   * ~k^depth live sub-loops. Default 4 (the agent-bus depth ceiling). A straight-line program
   * is depth 0; a `parallel` of straight-lines is depth 1; a parallel-of-parallels is depth 2.
   * Raise it DELIBERATELY — recursion multiplies the per-layer factor, so deep trees should
   * be earned by a per-layer win, not defaulted on.
   */
  maxDepth?: number
  /**
   * Deployable completion stop (the non-oracle "is it done?") applied at every leaf sub-loop,
   * so an N-deep tree is stoppable PER NODE, not just at the root. One analyst is shared
   * across nodes here; per-node-distinct completion is a follow-on (a path→analyst resolver).
   */
  complete?: CompletionAnalyst<Task, Output>
  completionPolicy?: CompletionPolicy
}

/** A program with no `parallel` anywhere — executable as ONE `runLoop` via
 *  `compileProgram`, with the kernel's free history threading across `seq` rounds. */
export function isStraightLine<Task>(program: Program<Task>): boolean {
  switch (program.op) {
    case 'sample':
    case 'steer':
    case 'fork':
    case 'select':
    case 'stop':
      return true
    case 'parallel':
      return false
    case 'seq':
      return program.steps.every(isStraightLine)
    default:
      return false
  }
}

/**
 * @experimental Execute a `Program` tree. Runs the largest straight-line subtree as a
 * single `runLoop` (preserving the kernel's threading), and forks into CONCURRENT
 * `runLoop`s at each `parallel` node — so a `parallel` branch is a real multi-round
 * sub-loop, and `parallel([seqA, seqB])` is two distinct workflows running at once.
 * Merges sub-loop iterations (re-indexed), cost, and tokens, selecting a global winner
 * with the same selector the kernel uses at a single loop's finalize.
 */
export async function runProgram<Task, Output>(
  program: Program<Task>,
  opts: RunProgramOptions<Task, Output>,
  idSuffix = 'root',
  depth = 0,
): Promise<ProgramResult<Task, Output>> {
  const maxDepth = opts.maxDepth ?? DEFAULT_PROGRAM_MAX_DEPTH
  if (depth > maxDepth) {
    throw new PlannerError(
      `runProgram: recursion depth ${depth} exceeds maxDepth ${maxDepth} — a driver-of-drivers tree this deep risks ~k^depth live sub-loops; raise opts.maxDepth deliberately or flatten the program`,
    )
  }
  if (isStraightLine(program)) return runStraightLine(program, opts, idSuffix)
  if (program.op === 'parallel') return runParallel(program.branches, opts, idSuffix, depth)
  if (program.op === 'seq') return runSeq(program.steps, opts, idSuffix, depth)
  throw new PlannerError(`runProgram: no executor for op ${stringifySafe(program.op)}`)
}

/**
 * @experimental Drive the recursive Agent atom over the tree executor: `act()` emits
 * the program (from the root context), `runProgram` executes it — so an agent can
 * fork concurrent sub-loops, not just a per-round move queue (cf. `agentProgramPlanner`,
 * which compiles a straight-line program onto one loop).
 */
export async function runAgent<Task, Output>(
  agent: Agent<Task, Output>,
  rootTask: Task,
  opts: RunProgramOptions<Task, Output>,
): Promise<ProgramResult<Task, Output>> {
  const program = await agent.act({ task: rootTask, history: [] })
  return runProgram(program, opts, opts.runId ? 'root' : 'agent')
}

/** A straight-line program → one `runLoop`. A program with no dispatching op
 *  (`stop` / `select`-only) does nothing — there is no batch to run. */
async function runStraightLine<Task, Output>(
  program: Program<Task>,
  opts: RunProgramOptions<Task, Output>,
  idSuffix: string,
): Promise<ProgramResult<Task, Output>> {
  if (!hasDispatch(program)) return emptyResult<Task, Output>()
  const maxIterations = opts.maxIterations ?? DEFAULT_PROGRAM_MAX_ITERATIONS
  const driver = createDynamicDriver<Task, Output>({
    planner: compileProgram<Task, Output>(program),
    maxIterations,
    complete: opts.complete,
    completionPolicy: opts.completionPolicy,
  })
  const result = await runLoop<Task, Output, unknown>({
    driver,
    agentRun: opts.agentRun,
    agentRuns: opts.agentRuns,
    output: opts.output,
    validator: opts.validator,
    // compileProgram's planner ignores this task (moves carry their own); it is the
    // representative root for trace correlation only.
    task: firstTaskOf(program) as Task,
    ctx: opts.ctx,
    maxIterations,
    maxConcurrency: opts.maxConcurrency,
    runId: `${opts.runId ?? 'program'}/${idSuffix}`,
    now: opts.now,
    selectWinner: opts.selectWinner,
  })
  return {
    iterations: result.iterations,
    winner: result.winner,
    costUsd: result.costUsd,
    tokenUsage: result.tokenUsage,
    durationMs: result.durationMs,
  }
}

/** A `parallel` node → one `runProgram` per branch, run CONCURRENTLY (bounded by
 *  `maxParallel`), merged. Wall-clock = the slowest branch. */
async function runParallel<Task, Output>(
  branches: Program<Task>[],
  opts: RunProgramOptions<Task, Output>,
  idSuffix: string,
  depth: number,
): Promise<ProgramResult<Task, Output>> {
  if (!Array.isArray(branches) || branches.length === 0) {
    throw new PlannerError('Program parallel{} must carry a non-empty branches[]')
  }
  const limit = opts.maxParallel ?? branches.length
  const settled = await mapPool(branches, limit, (branch, i) =>
    runProgram(branch, opts, `${idSuffix}/p${i}`, depth + 1),
  )
  // One-for-one: a branch that threw is a `down` record EXCLUDED from the merge `n`;
  // survivors still merge. A real cancel (abort signal fired) is NOT a branch failure —
  // it propagates so the abort cascade stays loud.
  if (opts.ctx.signal?.aborted) {
    const aborted = settled.find((r) => !r.ok)
    if (aborted && !aborted.ok) throw aborted.error
  }
  const survivors = settled.filter(
    (r): r is { ok: true; value: ProgramResult<Task, Output> } => r.ok,
  )
  if (survivors.length === 0) {
    // Every branch went down: there is nothing to merge, so the program genuinely
    // failed. Surface the FIRST branch's original error (its real type + message — e.g.
    // a maxDepth guard) rather than a lossy summary; a structural guard must not be
    // swallowed as an excluded infra `down`.
    const firstDown = settled.find((r) => !r.ok)
    if (firstDown && !firstDown.ok) throw firstDown.error
    throw new PlannerError(
      `Program parallel{} merged 0 branches — all ${branches.length} sub-loops went down`,
    )
  }
  return concatRuns(
    survivors.map((r) => r.value),
    'max',
    opts,
  )
}

/** A `seq` containing a `parallel` → run maximal straight-line runs as single loops
 *  (threaded), `parallel`-bearing steps via recursion; accumulate, short-circuiting
 *  the moment a valid winner exists (matching `compileProgram`). */
async function runSeq<Task, Output>(
  steps: Program<Task>[],
  opts: RunProgramOptions<Task, Output>,
  idSuffix: string,
  depth: number,
): Promise<ProgramResult<Task, Output>> {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new PlannerError('Program seq must carry a non-empty steps[]')
  }
  const segments: Array<{ line: Program<Task>[] } | { recurse: Program<Task> }> = []
  let buf: Program<Task>[] = []
  for (const step of steps) {
    if (isStraightLine(step)) {
      buf.push(step)
    } else {
      if (buf.length) {
        segments.push({ line: buf })
        buf = []
      }
      segments.push({ recurse: step })
    }
  }
  if (buf.length) segments.push({ line: buf })

  let acc = emptyResult<Task, Output>()
  let ran = false
  for (let i = 0; i < segments.length; i += 1) {
    if (acc.winner?.verdict?.valid === true) break // short-circuit: a valid result exists
    const seg = segments[i]!
    let segResult: ProgramResult<Task, Output>
    if ('recurse' in seg) {
      segResult = await runProgram(seg.recurse, opts, `${idSuffix}.s${i}`, depth + 1)
    } else {
      const sub: Program<Task> =
        seg.line.length === 1 ? seg.line[0]! : { op: 'seq', steps: seg.line }
      if (ran && firstOp(sub) === 'select') {
        throw new PlannerError(
          'Program select after a parallel boundary is not supported: cross-branch ' +
            'selection is the parallel merge (best-valid-score over all branches). Remove the ' +
            'select, or wrap the branches you mean to select among.',
        )
      }
      segResult = await runStraightLine(sub, opts, `${idSuffix}.s${i}`)
    }
    acc = concatRuns([acc, segResult], 'sum', opts)
    ran = true
  }
  return acc
}

type MapPoolOutcome<R> = { ok: true; value: R } | { ok: false; error: unknown }

/** Bounded-concurrency map preserving order. One-for-one isolation: a thrown item is
 *  CAPTURED as a per-item `{ ok: false }` outcome — it does NOT abort siblings or stop
 *  scheduling, so survivors all run to completion. The caller decides whether a failed
 *  outcome is an excluded branch (infra `down`) or a propagated cancel. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<MapPoolOutcome<R>[]> {
  const results = new Array<MapPoolOutcome<R>>(items.length)
  let next = 0
  const workers = Math.max(1, Math.min(limit, items.length))
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next
      next += 1
      if (i >= items.length) return
      try {
        results[i] = { ok: true, value: await fn(items[i] as T, i) }
      } catch (err) {
        results[i] = { ok: false, error: err }
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

/** Concatenate sub-results: re-index iterations contiguously, sum cost + tokens,
 *  combine wall-clock per mode (`sum` for sequential seq, `max` for concurrent
 *  parallel), and re-select the global winner over the merged set. */
function concatRuns<Task, Output>(
  runs: ProgramResult<Task, Output>[],
  durationMode: 'sum' | 'max',
  opts: RunProgramOptions<Task, Output>,
): ProgramResult<Task, Output> {
  const iterations: Iteration<Task, Output>[] = []
  let costUsd = 0
  const tokenUsage = zeroTokenUsage()
  let durationMs = 0
  for (const run of runs) {
    const offset = iterations.length
    for (const iter of run.iterations) iterations.push({ ...iter, index: offset + iter.index })
    costUsd += run.costUsd
    addTokenUsage(tokenUsage, run.tokenUsage)
    durationMs =
      durationMode === 'max' ? Math.max(durationMs, run.durationMs) : durationMs + run.durationMs
  }
  const winner = opts.selectWinner ? opts.selectWinner(iterations) : defaultSelectWinner(iterations)
  return { iterations, winner, costUsd, tokenUsage, durationMs }
}

function emptyResult<Task, Output>(): ProgramResult<Task, Output> {
  return {
    iterations: [],
    winner: undefined,
    costUsd: 0,
    tokenUsage: zeroTokenUsage(),
    durationMs: 0,
  }
}

/** True if the program has any dispatching op (sample/steer/fork) somewhere — i.e.
 *  something for a `runLoop` to actually run. A pure `stop`/`select` tree has none. */
function hasDispatch<Task>(program: Program<Task>): boolean {
  switch (program.op) {
    case 'sample':
    case 'steer':
    case 'fork':
      return true
    case 'parallel':
      return program.branches.some(hasDispatch)
    case 'seq':
      return program.steps.some(hasDispatch)
    default:
      return false
  }
}

/** First dispatched task in the tree — the representative root task for trace
 *  correlation (compileProgram's planner ignores `runLoop`'s `task` arg). */
function firstTaskOf<Task>(program: Program<Task>): Task | undefined {
  switch (program.op) {
    case 'sample':
    case 'steer':
      return program.task
    case 'fork':
      return program.branches[0]
    case 'parallel':
      for (const b of program.branches) {
        const t = firstTaskOf(b)
        if (t !== undefined) return t
      }
      return undefined
    case 'seq':
      for (const s of program.steps) {
        const t = firstTaskOf(s)
        if (t !== undefined) return t
      }
      return undefined
    default:
      return undefined
  }
}

/** The leading op of a program — `seq` recurses into its first step. */
function firstOp<Task>(program: Program<Task>): Program<Task>['op'] {
  if (program.op === 'seq') {
    const head = program.steps[0]
    return head ? firstOp(head) : 'seq'
  }
  return program.op
}
