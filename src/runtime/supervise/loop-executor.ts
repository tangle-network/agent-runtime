/**
 *
 * The loop-executor — a spawnable, budget-conserving, gated, STEERABLE multi-round loop
 * as a first-class atom, the sibling of the recursive driver-executor.
 *
 * A leaf worker runs one turn and settles. A driver child (driver-executor.ts) runs an
 * LLM brain that spawns children and reacts. A LOOP child is the third shape: a CODED loop
 * whose control flow is written, not left to a model's judgment. On `execute` it mounts a
 * NESTED `Scope` (via the same `nested-scope` seam the driver-executor uses) one `depth`
 * deeper over the SAME conserved pool + shared journal/blobs + open registry, then runs the
 * authored loop's `round(ctx)` up to `maxRounds` times. Each round may spawn children into
 * that nested scope (conserved budget, depth-bounded), and the runtime — not the authored
 * body — owns the three guarantees a "loop" must make:
 *
 *  - BOUNDED: at most `maxRounds` rounds; the run-wide conserved pool still fails a spawn
 *    closed at any depth, so a loop can never overspend the root ceiling.
 *  - GATED: the loop settles `valid` iff its deployable `check(out)` passes (the completion
 *    oracle, same discipline as `gateOnDeliverable`). A loop that exhausts `maxRounds`
 *    without the check ever passing settles `valid: false` — ran, did not deliver.
 *  - STEERABLE: the executor owns an `Inbox` and exposes `deliver`, so a supervisor's
 *    `steer_agent` (→ `Scope.send` → this `deliver`) lands between rounds. Queued messages
 *    fold into the next round's `ctx.steer`; a forceful `interrupt` aborts the in-flight
 *    round's linked signal so the loop re-plans immediately with the message folded in.
 *
 * Why this preserves every keystone invariant: identical to the driver-executor — the SCOPE
 * owns the sharing (nested scope over `args.pool`, one `SpawnJournal` tree per child), this
 * executor only runs the coded loop over what the scope mounts and rolls the sub-tree's
 * conserved spend up on settle. It builds NO new budget, journal, or selection logic.
 *
 * The authored loop body is `defineLoop(name, { maxRounds, round, check })`. `round` is
 * ordinary code — arbitrary composition inside a round (spawn one child, fan out many,
 * pipeline) — while the runtime owns iteration, the budget, the gate, and steer-folding.
 * So a loop is "codemode" (the author writes control flow) yet structurally bounded.
 *
 * @experimental
 */

import { ValidationError } from '../../errors'
import { createInbox, type Inbox, type InboxMessage } from './inbox'
import { type NestedScopeSeam, nestedScopeSeamKey } from './scope'
import type {
  Agent,
  AgentSpec,
  DefaultVerdict,
  ExecutorContext,
  ExecutorFactory,
  ExecutorRegistry,
  ExecutorResult,
  Scope,
  SpawnEvent,
  SpawnJournal,
  Spend,
} from './types'

/** The runtime tag the registry maps a loop child to. */
export const loopRuntime = 'loop' as const

/** The metadata marker on a loop child's spec the recursive registry routes on. */
const loopRole = 'loop'

// ── The authored loop ──────────────────────────────────────────────────────────

/** What one round of a loop receives. The scope is the NESTED scope — spawn conserved
 *  children here; budget/depth are enforced by the scope, not the body. */
export interface LoopRoundCtx {
  /** The spawn task, verbatim. */
  readonly task: unknown
  /** The nested, conserved scope. Spawn children with `scope.spawn`, react with `scope.next`. */
  readonly scope: Scope<unknown>
  /** 1-based round index. */
  readonly round: number
  /** The declared ceiling on rounds. */
  readonly maxRounds: number
  /** Supervisor `steer_agent` messages that arrived since the last round, folded to text. */
  readonly steer: readonly string[]
  /** Conserved-pool readouts (post-reservation) for in-body budget-awareness. */
  readonly budget: Scope<unknown>['budget']
  /** Abort signal: the spawn signal + nested-scope signal + a fresh per-round interrupt.
   *  A forceful steer during the round aborts THIS signal so the body can break and re-plan. */
  readonly signal: AbortSignal
}

/** What a round returns. `out` is the running result; `done: true` stops the loop early
 *  (the author's own stop condition, distinct from the runtime's gate `check`). */
export interface LoopRoundResult {
  readonly out: unknown
  readonly done?: boolean
}

/** An authored coded loop: a name, a round ceiling, the round body, and an optional
 *  deployable gate `check`. `check` decides DELIVERED — the loop settles `valid` iff it
 *  passes — and is polled after each round to stop as soon as the loop has delivered. */
export interface LoopDef {
  readonly name: string
  readonly maxRounds: number
  round(ctx: LoopRoundCtx): Promise<LoopRoundResult>
  /** The deployable completion oracle. `settled.valid ⟺ this resolves true`. A throwing
   *  check is fail-closed (not delivered). Omit for a loop whose only stop is `done`. */
  check?(out: unknown): boolean | Promise<boolean>
  /** What the loop was supposed to produce — surfaced in traces. */
  readonly describe?: string
}

/** One named agent in a MULTI-AGENT loop (the `agents` form of `defineLoop`). `run` does the
 *  agent's work for a round; `prior` is the previous agent's output, or `ctx.task` for the first.
 *  The last agent's return is the round's `out`. So a proposer→verifier loop is just two agents. */
export interface LoopAgent {
  /** A short, human name for the agent this plays (proposer, verifier, engineer). */
  readonly name: string
  run(ctx: LoopRoundCtx, prior: unknown): Promise<unknown>
}

/**
 * Author a coded loop atom. The returned `LoopDef` is handed to `loopChild` to become a
 * spawnable `Agent`. The runtime owns `maxRounds`, the conserved budget, the gate, and
 * steer-folding; you supply ONE of two round shapes:
 *
 *  - `round` — freeform: write the whole round yourself (arbitrary code, may spawn children).
 *  - `agents` — declarative MULTI-AGENT: an ordered list of named agents piped each round
 *    (`task → agents[0] → agents[1] → … → out`). "How many agents" is self-evident from the
 *    list, so a two-agent research loop is `agents: [proposer, verifier]` — no bespoke function.
 *
 * Provide EXACTLY one of `round` / `agents`.
 */
export function defineLoop(
  name: string,
  spec: {
    maxRounds: number
    round?: (ctx: LoopRoundCtx) => Promise<LoopRoundResult>
    agents?: readonly LoopAgent[]
    check?: (out: unknown) => boolean | Promise<boolean>
    describe?: string
  },
): LoopDef {
  if (!name) throw new ValidationError('defineLoop: a loop needs a name')
  if (!Number.isInteger(spec.maxRounds) || spec.maxRounds < 1) {
    throw new ValidationError(`defineLoop: "${name}" needs an integer maxRounds >= 1`)
  }
  const hasRound = typeof spec.round === 'function'
  const hasAgents = Array.isArray(spec.agents) && spec.agents.length > 0
  if (hasRound === hasAgents) {
    throw new ValidationError(
      `defineLoop: "${name}" needs exactly one of round(ctx) or a non-empty agents[]`,
    )
  }
  const round = hasRound
    ? (spec.round as LoopDef['round'])
    : agentPipelineRound(name, spec.agents ?? [])
  return {
    name,
    maxRounds: spec.maxRounds,
    round,
    ...(spec.check ? { check: spec.check } : {}),
    ...(spec.describe ? { describe: spec.describe } : {}),
  }
}

/** Compile an ordered agent list into a round: pipe `ctx.task` through each agent in turn, the
 *  last one's output is the round result. This is the whole "multi-agent loop" — a pipeline of
 *  named agents, not a bespoke per-shape function. */
function agentPipelineRound(
  name: string,
  agents: readonly LoopAgent[],
): (ctx: LoopRoundCtx) => Promise<LoopRoundResult> {
  for (const agent of agents) {
    if (!agent || typeof agent.run !== 'function' || !agent.name) {
      throw new ValidationError(`defineLoop: "${name}" has an agent missing a name or run()`)
    }
  }
  return async (ctx) => {
    let out: unknown = ctx.task
    for (const agent of agents) {
      out = await agent.run(ctx, out)
    }
    return { out }
  }
}

// ── The spawnable child ─────────────────────────────────────────────────────────

/** A loop child's spec carries the authored loop + the shared journal (so the executor
 *  can begin its nested tree + sum its spend off the same record). */
interface LoopSpec extends AgentSpec {
  readonly loop: LoopDef
  readonly journal: SpawnJournal
}

/**
 * Mark + carry an authored loop so the recursive registry resolves it to the
 * loop-executor. The returned agent is SPAWNED (never run directly): its `executorSpec` is
 * marked `role: 'loop'` and carries the `LoopDef` + the shared journal. `act` fails loud if
 * called directly — a loop child runs THROUGH its nested-scope executor, never as a root.
 */
export function loopChild<Out>(loop: LoopDef, journal: SpawnJournal): Agent<unknown, Out> {
  const spec: LoopSpec = {
    profile: { name: loop.name, metadata: { role: loopRole } } as AgentSpec['profile'],
    harness: null,
    loop,
    journal,
  }
  return {
    name: loop.name,
    executorSpec: spec,
    act(): Promise<Out> {
      throw new ValidationError(
        `loopChild: "${loop.name}" was run directly; a loop child runs through its nested-scope executor`,
      )
    },
  } as Agent<unknown, Out> & { executorSpec: AgentSpec }
}

/** True when a spec is a loop child (carries the role marker + an authored loop). */
export function isLoopSpec(spec: AgentSpec): spec is LoopSpec {
  const role = (spec.profile.metadata as { role?: unknown } | undefined)?.role
  if (role !== loopRole) return false
  const loop = (spec as { loop?: unknown }).loop
  if (!isLoopDef(loop)) {
    throw new ValidationError(
      'loopExecutor: a loop-role spec must carry a `loop` LoopDef to run inside its nested scope',
    )
  }
  return true
}

// ── The executor ────────────────────────────────────────────────────────────────

/**
 * The loop-executor factory. `withLoopExecutor` routes a child marked `role: 'loop'` here.
 * On `execute` it mounts a nested `Scope` one `depth` deeper over the shared
 * pool/journal/blobs/registry, then runs the authored loop's `round` up to `maxRounds`
 * times, draining its steer inbox before each round and gating on `check` after each. The
 * conserved spend is summed off the nested tree's settled events, so the parent scope's
 * reconcile rolls the whole sub-tree's spend into the conserved total — exactly as the
 * driver-executor does.
 */
export const loopExecutorFactory: ExecutorFactory<unknown> = (spec, ctx) => {
  if (!isLoopSpec(spec)) {
    throw new ValidationError(
      'loopExecutorFactory: spec is not a loop child (no role:"loop" marker)',
    )
  }
  const loop = spec.loop
  const journal = spec.journal
  const seam = readNestedScopeSeam(ctx)
  const inbox = createInbox()

  let artifact: ExecutorResult<unknown> | undefined
  let meteredSpend: Spend | undefined

  return {
    runtime: loopRuntime,
    // The steer seam: `steer_agent` → `Scope.send` → here. Never throws (inbox contract).
    deliver(msg: unknown): void {
      inbox.deliver(msg)
    },
    async execute(task, signal): Promise<ExecutorResult<unknown>> {
      const nestedRoot = nestedTreeKey(seam, journal)
      await journal.beginTree(nestedRoot, new Date(0).toISOString())
      const nestedScope: Scope<unknown> = seam.mount(nestedRoot, signal)

      let out: unknown
      let delivered = false
      try {
        for (let round = 1; round <= loop.maxRounds; round++) {
          if (signal.aborted || nestedScope.signal.aborted) break

          // Drain queued steer BEFORE the round so this round sees it, then open a fresh
          // per-round interrupt so a forceful steer arriving DURING the round aborts it.
          const steer = drainSteer(inbox)
          const roundInterrupt = inbox.freshInterrupt()
          const roundSignal = AbortSignal.any([signal, nestedScope.signal, roundInterrupt])

          const result = await loop.round({
            task,
            scope: nestedScope,
            round,
            maxRounds: loop.maxRounds,
            steer,
            budget: nestedScope.budget,
            signal: roundSignal,
          })
          out = result.out

          // Poll the gate after each round so the loop stops as soon as it has delivered.
          if (loop.check && (await runCheck(loop.check, out))) {
            delivered = true
            break
          }
          if (result.done) break
        }

        // One read of the nested tree, two roll-ups kept separate (as the driver-executor):
        // settled child WORK (reconciled) and the sub-tree's driver INFERENCE (re-homed).
        const events = await loadTreeEvents(journal, nestedRoot)
        const settled = events.filter(isSettled)
        meteredSpend = nonZeroOrUndef(sumMetered(events))

        // Final verdict: DELIVERED iff the gate passes on the last `out`. With no gate, a
        // loop is delivered iff a round declared `done`. Fail-closed either way.
        const valid = loop.check ? await runCheck(loop.check, out) : delivered
        const verdict: DefaultVerdict = { valid, score: valid ? 1 : 0 }
        artifact = {
          outRef: `${loopRuntime}:${nestedRoot}`,
          out,
          spent: sumSpend(settled),
          verdict,
        }
        return artifact
      } catch (err) {
        meteredSpend = await safeSumMetered(journal, nestedRoot)
        throw err
      }
    },
    metered(): Spend | undefined {
      return meteredSpend
    },
    teardown(): Promise<{ destroyed: boolean }> {
      // The nested scope's live children are torn down by the round bodies' own settle
      // discipline and the parent's abort cascade through `signal`; nothing else to reap.
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact)
        throw new ValidationError('loopExecutor: resultArtifact() read before execute()')
      return artifact
    },
  }
}

/**
 * Register the loop-executor so a child marked `role: 'loop'` resolves to it. Mirrors
 * `withDriverExecutor`: a loop-role spec → the loop-executor; everything else → the base
 * registry's resolution. Compose it WITH `withDriverExecutor` so loops and drivers coexist:
 * `withLoopExecutor(withDriverExecutor(base))`.
 */
export function withLoopExecutor(base: ExecutorRegistry): ExecutorRegistry {
  return {
    register: base.register.bind(base),
    resolve<Out>(spec: AgentSpec) {
      const role = (spec.profile.metadata as { role?: unknown } | undefined)?.role
      if (role === loopRole && !spec.executor) {
        return { succeeded: true as const, value: loopExecutorFactory as ExecutorFactory<Out> }
      }
      return base.resolve<Out>(spec)
    },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Drain the inbox and fold each pending message to one steer line for the next round. */
function drainSteer(inbox: Inbox): string[] {
  return inbox.drain().map((m: InboxMessage) => m.text)
}

async function runCheck(
  check: (out: unknown) => boolean | Promise<boolean>,
  out: unknown,
): Promise<boolean> {
  try {
    return (await check(out)) === true
  } catch {
    return false // fail-closed: a throwing check is NOT a delivery
  }
}

/** Mint a unique nested-tree key under the parent's journal root — `l`-prefixed so a loop
 *  child's tree never collides with a sibling driver child's `d`-prefixed tree. */
function nestedTreeKey(seam: NestedScopeSeam, journal: SpawnJournal): string {
  return `${seam.journalRoot}/l${nextNestOrdinal(journal)}`
}

const nestCounters = new WeakMap<SpawnJournal, { n: number }>()
function nextNestOrdinal(journal: SpawnJournal): number {
  let c = nestCounters.get(journal)
  if (!c) {
    c = { n: 0 }
    nestCounters.set(journal, c)
  }
  return c.n++
}

async function loadTreeEvents(journal: SpawnJournal, nestedRoot: string): Promise<SpawnEvent[]> {
  const events = await journal.loadTree(nestedRoot)
  if (events === undefined) {
    throw new ValidationError(
      `loopExecutor: nested tree '${nestedRoot}' missing from the journal after run (corrupted log)`,
    )
  }
  return events
}

function isSettled(ev: SpawnEvent): ev is Extract<SpawnEvent, { kind: 'settled' }> {
  return ev.kind === 'settled'
}

function sumSpend(settled: ReadonlyArray<{ spent: Spend }>): Spend {
  const total: Spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
  for (const ev of settled) {
    total.iterations += ev.spent.iterations
    total.tokens.input += ev.spent.tokens.input
    total.tokens.output += ev.spent.tokens.output
    total.usd += ev.spent.usd
    total.ms += ev.spent.ms
  }
  return total
}

function sumMetered(events: ReadonlyArray<SpawnEvent>): Spend {
  const total: Spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
  for (const ev of events) {
    if (ev.kind !== 'metered') continue
    total.iterations += ev.spend.iterations
    total.tokens.input += ev.spend.tokens.input
    total.tokens.output += ev.spend.tokens.output
    total.usd += ev.spend.usd
    total.ms += ev.spend.ms
  }
  return total
}

function isNonZeroSpend(s: Spend): boolean {
  return s.iterations > 0 || s.tokens.input > 0 || s.tokens.output > 0 || s.usd > 0 || s.ms > 0
}

function nonZeroOrUndef(s: Spend): Spend | undefined {
  return isNonZeroSpend(s) ? s : undefined
}

async function safeSumMetered(
  journal: SpawnJournal,
  nestedRoot: string,
): Promise<Spend | undefined> {
  try {
    return nonZeroOrUndef(sumMetered(await loadTreeEvents(journal, nestedRoot)))
  } catch {
    return undefined
  }
}

function readNestedScopeSeam(ctx: ExecutorContext): NestedScopeSeam {
  const seam = ctx.seams[nestedScopeSeamKey] as NestedScopeSeam | undefined
  if (!seam || typeof seam.mount !== 'function') {
    throw new ValidationError(
      `loopExecutor: missing required seam "${nestedScopeSeamKey}" — a loop child must be spawned through a Scope that seeds it (the keystone scope does)`,
    )
  }
  return seam
}

function isLoopDef(value: unknown): value is LoopDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { round?: unknown }).round === 'function' &&
    typeof (value as { name?: unknown }).name === 'string' &&
    Number.isInteger((value as { maxRounds?: unknown }).maxRounds)
  )
}
