/**
 * @experimental
 *
 * The recursive driver-executor — the seam that lets a SPAWNED child be a DRIVER, so
 * agents drive agents drive agents over the one keystone atom.
 *
 * A spawned child resolves through the open registry to an `Executor`; the built-in
 * executors (router/inline, sandbox, cli) are LEAVES — `execute(task, signal)` runs the
 * work and settles. This executor is the recursive case: on `execute`, it mounts a NESTED
 * `Scope` (the scope hands it the mount via the `nested-scope` seam) over the SAME
 * conserved pool + shared journal/blobs + the same open registry, one `depth` deeper, then
 * runs the wrapped driver `Agent.act(task, nestedScope)`. The driver spawns its own
 * children into that nested scope; each resolves to EITHER a leaf executor (a worker child)
 * OR this same driver-executor (a driver child) — recursively. So a driver spawns a driver
 * spawns a worker, all on one budget-conserving tree.
 *
 * Why this preserves every keystone invariant (the scope owns the sharing; this executor
 * only runs the driver over what the scope mounts):
 *  - Conserved budget: the nested scope reserves from the SAME `BudgetPool` the root owns
 *    (the scope mounts it over `args.pool`), so `Σk` is conserved ACROSS depth by
 *    construction — a deep tree cannot overspend the root ceiling (reserve-on-spawn fails
 *    closed at any depth).
 *  - Journal: the nested scope writes to its OWN tree key (`${journalRoot}/${nodeId}`) so
 *    its cursor `seq`s never collide with the parent's in the per-tree uniqueness guard,
 *    while every nested tree shares the one `SpawnJournal` — the whole recursion is one
 *    journal, queryable tree by tree.
 *  - Settlement bubbling: the driver child settles into its PARENT scope with the conserved
 *    spend summed off its nested tree's settled events, so the parent's pool reconcile +
 *    the supervisor's `spentTotal` see the whole sub-tree's spend rolled up — settlements
 *    bubble to the root.
 *  - Depth ceiling: the nested scope runs at `depth+1`, so the supervisor's `maxDepth`
 *    (paired with the conserved pool per R3) fails a spawn closed once the recursion is too
 *    deep — exactly as it does for a flat tree.
 *
 * Layering: pure keystone composition. It reuses the scope's `NestedScopeSeam` + the shared
 * `SpawnJournal`; it builds NO new budget, journal, or selection logic. The recursion rides
 * the existing atom.
 */

import { ValidationError } from '../../errors'
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

/** The runtime tag the registry maps a driver child to. */
export const driverRuntime = 'driver' as const

/** The metadata marker on a driver child's spec the recursive registry routes on. */
const driverRole = 'driver'

/** A driver child's spec carries the `Agent` to run inside the nested scope. */
interface DriverSpec extends AgentSpec {
  readonly driver: Agent<unknown, unknown>
  /** The shared journal the nested tree is one tree key inside (so the executor can
   *  begin its nested tree + sum its spend off the same record). */
  readonly journal: SpawnJournal
}

/**
 * Mark + carry a driver `Agent` so the recursive registry resolves it to the
 * driver-executor. The returned agent is SPAWNED (never run directly): its
 * `executorSpec` is marked `role: 'driver'` and carries the driver agent + the shared
 * journal so the executor can run its `act` inside a nested scope. `act` fails loud if
 * called directly — a driver child runs THROUGH its nested-scope executor, never as a root.
 */
export function driverChild<Out>(
  name: string,
  driver: Agent<unknown, Out>,
  journal: SpawnJournal,
): Agent<unknown, Out> {
  const spec: DriverSpec = {
    profile: { name, metadata: { role: driverRole } } as AgentSpec['profile'],
    harness: null,
    driver: driver as Agent<unknown, unknown>,
    journal,
  }
  return {
    name,
    executorSpec: spec,
    act(): Promise<Out> {
      throw new ValidationError(
        `driverChild: "${name}" was run directly; a driver child runs through its nested-scope executor`,
      )
    },
  } as Agent<unknown, Out> & { executorSpec: AgentSpec }
}

/** True when a spec is a driver child (carries the role marker + a driver Agent). */
export function isDriverSpec(spec: AgentSpec): spec is DriverSpec {
  const role = (spec.profile.metadata as { role?: unknown } | undefined)?.role
  if (role !== driverRole) return false
  const driver = (spec as { driver?: unknown }).driver
  if (!isAgent(driver)) {
    throw new ValidationError(
      'driverExecutor: a driver-role spec must carry a `driver` Agent to run inside its nested scope',
    )
  }
  return true
}

/**
 * The recursive driver-executor factory. `withDriverExecutor` routes a child marked
 * `role: 'driver'` here; any other child resolves to a leaf built-in. On `execute`, it
 * reads the `nested-scope` seam the SCOPE seeded, mounts a nested `Scope` one `depth`
 * deeper over the shared pool/journal/blobs/registry, runs the driver
 * `Agent.act(task, nestedScope)`, and reports the conserved spend summed off the nested
 * tree's settled events — so the parent scope's reconcile rolls the whole sub-tree's spend
 * into the conserved total.
 *
 * A `down` from the nested driver (a thrown `act` or an aborted scope) propagates as a
 * thrown executor, which the parent scope types into a `down` settlement — the same
 * fail-loud-into-typed-down discipline a leaf gets.
 */
export const driverExecutorFactory: ExecutorFactory<unknown> = (spec, ctx) => {
  if (!isDriverSpec(spec)) {
    throw new ValidationError(
      'driverExecutorFactory: spec is not a driver child (no role:"driver" marker)',
    )
  }
  const driver = spec.driver
  const journal = spec.journal
  const seam = readNestedScopeSeam(ctx)

  let artifact: ExecutorResult<unknown> | undefined

  return {
    runtime: driverRuntime,
    async execute(task, signal): Promise<ExecutorResult<unknown>> {
      // The nested tree key namespaces this driver's children inside the ONE shared
      // journal, so its cursor seqs never collide with the parent's per-tree guard.
      const nestedRoot = nestedTreeKey(seam, journal)
      await journal.beginTree(nestedRoot, new Date(0).toISOString())

      const nestedScope: Scope<unknown> = seam.mount(nestedRoot, signal)

      // Run the driver. Its `act` spawns children into the nested scope and reacts via
      // `scope.next()`; a thrown `act` propagates so the PARENT scope types it into a down.
      const out = await driver.act(task, nestedScope)

      // Read the nested tree's events ONCE. Two roll-ups, kept separate so the conserved invariant
      // is not double-charged:
      //  - `spent` = settled child WORK → reconciled against THIS driver's reservation (as before).
      //  - `metered` = the nested subtree's driver INFERENCE → re-homed by the parent scope as a
      //    `metered` event, NOT reconciled (already pool-debited live via `observe`).
      const events = await loadTreeEvents(journal, nestedRoot)
      const settled = events.filter(isSettled)
      const spent = sumSpend(settled)
      const metered = sumMetered(events)
      // Completion-oracle propagation: a driver "delivered" iff at least one of its DIRECT
      // children settled `valid` (the child its keep-best finalize returns). Deriving the
      // driver child's verdict this way composes delivery UP the recursion — a sub-driver is
      // `valid` only when it itself selected a delivered child — so a node never settles
      // "done = delivered" on a sub-tree that delivered nothing (Foreman's 0/18 lesson).
      const verdict = deriveDeliveryVerdict(settled)
      artifact = {
        outRef: `${driverRuntime}:${nestedRoot}`,
        out,
        spent,
        ...(verdict ? { verdict } : {}),
        ...(isNonZeroSpend(metered) ? { metered } : {}),
      }
      return artifact
    },
    teardown(): Promise<{ destroyed: boolean }> {
      // The nested scope's live children are torn down by the driver's own `act` discipline
      // (it drains to settlement) and by the parent's abort cascade through `signal`; there
      // is no separate box/process to reap here.
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) {
        throw new ValidationError('driverExecutor: resultArtifact() read before execute()')
      }
      return artifact
    },
  }
}

/**
 * Register the driver-executor so a child marked `role: 'driver'` resolves to it. The base
 * registry resolves by harness alone (it does not read `role`), so a recursive run needs a
 * registry that routes the driver tag here FIRST. Returns a registry decorator: a
 * driver-role spec → the driver-executor; everything else → the base registry's resolution
 * (leaf built-ins + BYO).
 */
export function withDriverExecutor(base: ExecutorRegistry): ExecutorRegistry {
  return {
    register: base.register.bind(base),
    resolve<Out>(spec: AgentSpec) {
      const role = (spec.profile.metadata as { role?: unknown } | undefined)?.role
      if (role === driverRole && !spec.executor) {
        return { succeeded: true as const, value: driverExecutorFactory as ExecutorFactory<Out> }
      }
      return base.resolve<Out>(spec)
    },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Mint a unique nested-tree key under the parent's journal root. Uses the parent's
 *  `journalRoot` + a per-journal monotonic ordinal so two sibling driver trees never
 *  collide their keys (each driver child mints exactly one nested tree). */
function nestedTreeKey(seam: NestedScopeSeam, journal: SpawnJournal): string {
  return `${seam.journalRoot}/d${nextNestOrdinal(journal)}`
}

/** Per-journal monotonic nest counter — keyed on the journal instance so a single run's
 *  nested-tree keys are unique without a shared module global. */
const nestCounters = new WeakMap<SpawnJournal, { n: number }>()
function nextNestOrdinal(journal: SpawnJournal): number {
  let c = nestCounters.get(journal)
  if (!c) {
    c = { n: 0 }
    nestCounters.set(journal, c)
  }
  return c.n++
}

/** The nested tree's full event list — the one evidence the spend, verdict, AND driver-inference
 *  roll-ups read off the same journal the supervisor sums. */
async function loadTreeEvents(journal: SpawnJournal, nestedRoot: string): Promise<SpawnEvent[]> {
  const events = await journal.loadTree(nestedRoot)
  if (events === undefined) {
    throw new ValidationError(
      `driverExecutor: nested tree '${nestedRoot}' missing from the journal after run (corrupted log)`,
    )
  }
  return events
}

function isSettled(ev: SpawnEvent): ev is Extract<SpawnEvent, { kind: 'settled' }> {
  return ev.kind === 'settled'
}

/** Sum the conserved spend over the nested tree's settled events — the honest per-channel
 *  roll-up of the whole sub-tree's child WORK. */
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

/** Sum the nested tree's `metered` events — the sub-tree's whole driver INFERENCE (this driver's
 *  own turns + any sub-driver inference already re-homed into this tree). Re-homed up to the parent
 *  as one `metered` event; never reconciled (already pool-debited live via `observe`). */
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

/** Derive the driver child's delivery verdict from its DIRECT children's settlements:
 *  `valid` iff any direct child settled `done` AND `valid` (the keep-best finalize's pick);
 *  `score` = the best delivered score. Returns `undefined` when no child settled at all (the
 *  driver itself produced nothing to bubble a verdict from). Fail-closed: a child whose verdict
 *  carried no `valid` counts as not-delivered. */
function deriveDeliveryVerdict(
  settled: ReadonlyArray<{ status: 'done' | 'down'; verdict?: DefaultVerdict }>,
): DefaultVerdict | undefined {
  let sawChild = false
  let anyValid = false
  let bestValidScore: number | undefined
  let bestDoneScore: number | undefined
  for (const ev of settled) {
    sawChild = true
    if (ev.status !== 'done') continue
    const score = ev.verdict?.score
    if (score !== undefined && (bestDoneScore === undefined || score > bestDoneScore)) {
      bestDoneScore = score
    }
    if (ev.verdict?.valid === true) {
      anyValid = true
      if (score !== undefined && (bestValidScore === undefined || score > bestValidScore)) {
        bestValidScore = score
      }
    }
  }
  if (!sawChild) return undefined
  return {
    valid: anyValid,
    score: anyValid ? (bestValidScore ?? 1) : (bestDoneScore ?? 0),
  }
}

function readNestedScopeSeam(ctx: ExecutorContext): NestedScopeSeam {
  const seam = ctx.seams[nestedScopeSeamKey] as NestedScopeSeam | undefined
  if (!seam || typeof seam.mount !== 'function') {
    throw new ValidationError(
      `driverExecutor: missing required seam "${nestedScopeSeamKey}" — a driver child must be spawned through a Scope that seeds it (the keystone scope does)`,
    )
  }
  return seam
}

function isAgent(value: unknown): value is Agent<unknown, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { act?: unknown }).act === 'function' &&
    typeof (value as { name?: unknown }).name === 'string'
  )
}
