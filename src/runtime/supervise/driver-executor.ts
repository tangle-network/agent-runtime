/**
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
 *  - Journal: the nested scope writes to its OWN tree key (the spawned agent node id) so
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
 *
 * @experimental
 */

import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import { type NestedScopeSeam, nestedScopeSeamKey } from './scope'
import type {
  Agent,
  AgentSpec,
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

/** A driver child's spec carries the `Agent` to run inside the nested scope. */
interface DriverSpec extends AgentSpec {
  readonly driver: Agent<unknown, unknown>
  /** The shared journal the nested tree is one tree key inside (so the executor can
   *  begin its nested tree + sum its spend off the same record). */
  readonly journal: SpawnJournal
}

/**
 * Carry a driver `Agent` structurally so the recursive registry resolves it to the
 * driver-executor. No role string or profile metadata controls execution: the exact authored
 * profile is retained and the presence of the typed `driver` field is the runtime capability.
 */
export function driverChild<Out>(
  profileOrName: AgentProfile | string,
  driver: Agent<unknown, Out>,
  journal: SpawnJournal,
): Agent<unknown, Out> {
  const profile: AgentProfile =
    typeof profileOrName === 'string' ? { name: profileOrName } : profileOrName
  const name = canonicalAgentProfileDigest(profile)
  const spec: DriverSpec = {
    profile,
    driver: driver as Agent<unknown, unknown>,
    journal,
  }
  return {
    name,
    executorSpec: spec,
    ...(driver.deliver
      ? { deliver: (message: unknown) => driver.deliver?.(message) ?? false }
      : {}),
    ...(driver.canDeliver ? { canDeliver: () => driver.canDeliver?.() ?? false } : {}),
    ...(driver.progress ? { progress: () => driver.progress?.() } : {}),
    ...(driver.traceSource ? { traceSource: () => driver.traceSource?.() } : {}),
    act(): Promise<Out> {
      throw new ValidationError(
        `driverChild: "${name}" was run directly; a driver child runs through its nested-scope executor`,
      )
    },
  } as Agent<unknown, Out> & { executorSpec: AgentSpec }
}

/** True when a spec structurally carries a driver Agent. */
export function isDriverSpec(spec: AgentSpec): spec is DriverSpec {
  const driver = (spec as { driver?: unknown }).driver
  if (driver === undefined) return false
  if (!isAgent(driver)) {
    throw new ValidationError(
      'driverExecutor: a driver spec must carry a `driver` Agent to run inside its nested scope',
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
    throw new ValidationError('driverExecutorFactory: spec does not carry a driver Agent')
  }
  const driver = spec.driver
  const journal = spec.journal
  const seam = readNestedScopeSeam(ctx)

  let artifact: ExecutorResult<unknown> | undefined
  // The nested subtree's driver INFERENCE, cached so the parent re-homes it on settle. Computed
  // on BOTH the success AND crash paths (metered events are durable in the nested tree regardless),
  // so a sub-driver that crashes mid-run still re-homes its partial inference — pool + journal agree.
  let meteredSpend: Spend | undefined

  return {
    runtime: driverRuntime,
    ...(driver.deliver
      ? { deliver: (message: unknown) => driver.deliver?.(message) ?? false }
      : {}),
    ...(driver.canDeliver ? { canDeliver: () => driver.canDeliver?.() ?? false } : {}),
    ...(driver.progress ? { progress: () => driver.progress?.() } : {}),
    ...(driver.traceSource ? { traceSource: () => driver.traceSource?.() } : {}),
    async execute(task, signal): Promise<ExecutorResult<unknown>> {
      // The spawned node is the nested coordinator's exact, restart-stable identity.
      const nestedRoot = seam.childNodeId
      await journal.beginTree(nestedRoot, new Date(seam.now()).toISOString())

      const nestedScope: Scope<unknown> = seam.mount(nestedRoot, signal)

      try {
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
        meteredSpend = nonZeroOrUndef(sumMetered(events))
        const verdict = driver.resultVerdict?.()
        artifact = {
          outRef: `${driverRuntime}:${nestedRoot}`,
          out,
          spent: sumSpend(settled),
          ...(verdict ? { verdict } : {}),
        }
        return artifact
      } catch (err) {
        // Crash mid-run: the nested tree still holds the durable `metered` events the sub-driver
        // already wrote (pool already debited them). Cache them so the parent's down-path re-home
        // lands the partial inference and the two ledgers stay in agreement. A missing tree must
        // not mask the original error.
        meteredSpend = await safeSumMetered(journal, nestedRoot)
        throw err
      }
    },
    metered(): Spend | undefined {
      return meteredSpend
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
 * Register the driver-executor so a child structurally carrying a `driver` resolves to it.
 * Returns a registry decorator: a driver spec → the driver-executor; everything else → the base
 * registry's resolution
 * (leaf built-ins + BYO).
 */
export function withDriverExecutor(base: ExecutorRegistry): ExecutorRegistry {
  return {
    register: base.register.bind(base),
    resolve<Out>(spec: AgentSpec) {
      if ((spec as { driver?: unknown }).driver !== undefined && !spec.executor) {
        if (!isDriverSpec(spec)) {
          return { succeeded: false as const, error: 'driver spec carries an invalid driver Agent' }
        }
        return { succeeded: true as const, value: driverExecutorFactory as ExecutorFactory<Out> }
      }
      return base.resolve<Out>(spec)
    },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

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
    if (ev.spent.usdKnown === false) total.usdKnown = false
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
    if (ev.spend.usdKnown === false) total.usdKnown = false
    total.ms += ev.spend.ms
  }
  return total
}

function isNonZeroSpend(s: Spend): boolean {
  return s.iterations > 0 || s.tokens.input > 0 || s.tokens.output > 0 || s.usd > 0 || s.ms > 0
}

/** A spend, or `undefined` when it is all-zero — so `metered()` returns undefined for a driver
 *  whose sub-tree did no inference (and the parent journals no empty `metered` event). */
function nonZeroOrUndef(s: Spend): Spend | undefined {
  return isNonZeroSpend(s) ? s : undefined
}

/** Sum the nested tree's metered events, tolerating a missing tree (a crash before `beginTree`
 *  landed) — never throw here, or it would mask the original `act` error on the crash path. */
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
