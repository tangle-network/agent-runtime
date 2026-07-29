/**
 *
 * The recursive driver-executor — the seam that lets a SPAWNED child be a DRIVER, so
 * agents drive agents drive agents over the one keystone atom.
 *
 * A spawned child resolves through the open registry to an `Executor`; the built-in
 * executors (router/inline, sandbox, cli) are LEAVES — `execute(task, signal)` runs the
 * work and settles. This executor is the recursive case: on `execute`, it mounts a NESTED
 * `Scope` (the scope hands it the mount via the `nested-scope` seam) over a child allocation
 * carved from its parent reservation, plus shared journal/blobs and the same open registry, then
 * runs the wrapped driver `Agent.act(task, nestedScope)`. The driver spawns its own
 * children into that nested scope; each resolves to EITHER a leaf executor (a worker child)
 * OR this same driver-executor (a driver child) — recursively. So a driver spawns a driver
 * spawns a worker, all on one budget-conserving tree.
 *
 * Why this preserves every keystone invariant (the scope owns the sharing; this executor
 * only runs the driver over what the scope mounts):
 *  - Conserved budget: the parent reserves the driver's whole allocation once. The nested scope
 *    partitions only that allocation, and its actual child work + driver inference reconcile the
 *    parent ticket once at settle. A deep tree cannot overspend or double-charge the root total.
 *  - Journal: the nested scope writes to its OWN tree key (`${journalRoot}/${nodeId}`) so
 *    its cursor `seq`s never collide with the parent's in the per-tree uniqueness guard,
 *    while every nested tree shares the one `SpawnJournal` — the whole recursion is one
 *    journal, queryable tree by tree.
 *  - Settlement bubbling: the driver child settles into its PARENT scope with child work and
 *    driver inference kept separate in the journal, while their sum reconciles the one parent
 *    reservation. The supervisor sees the whole sub-tree exactly once.
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

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import {
  attestRuntimeOwnedDeferredExecutor,
  runtimeOwnedScopeOwnerRuntime,
} from './materialization'
import {
  finalizeScopeOwnerMaterialization,
  type NestedScopeSeam,
  nestedScopeSeamKey,
} from './scope'
import type {
  Agent,
  AgentExecutionRef,
  AgentSpec,
  DefaultVerdict,
  Executor,
  ExecutorAccounting,
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
  readonly driverRuntime: typeof driverRuntime
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
  profileOrName: AgentProfile | string,
  driver: Agent<unknown, Out>,
  journal: SpawnJournal,
  execution?: AgentExecutionRef,
): Agent<unknown, Out> {
  const profile: AgentProfile =
    typeof profileOrName === 'string'
      ? { name: profileOrName, metadata: { role: driverRole } }
      : profileOrName
  const name = profile.name ?? driver.name
  const spec: DriverSpec = {
    profile,
    harness: null,
    ...(execution ? { execution } : {}),
    driverRuntime,
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
  if ((spec as { driverRuntime?: unknown }).driverRuntime !== driverRuntime) return false
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
 * deeper over the driver's reserved child pool plus shared journal/blobs/registry, runs the driver
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
  // The nested subtree's driver INFERENCE, cached so the parent re-homes it on settle. Computed
  // on BOTH the success AND crash paths (metered events are durable in the nested tree regardless),
  // so a sub-driver that crashes mid-run still re-homes its partial inference — pool + journal agree.
  let meteredSpend: Spend | undefined
  let accounting: ExecutorAccounting | undefined
  let active:
    | {
        readonly controller: AbortController
        readonly scope: Scope<unknown>
        close?: Promise<void>
      }
    | undefined

  const closeActive = (reason: string): Promise<void> => {
    if (active === undefined) return Promise.resolve()
    active.close ??= closeNestedScope(active.scope, active.controller, reason)
    return active.close
  }

  const executor: Executor<unknown> = {
    runtime: driverRuntime,
    async execute(task, signal): Promise<ExecutorResult<unknown>> {
      // The nested tree key namespaces this driver's children inside the ONE shared
      // journal, so its cursor seqs never collide with the parent's per-tree guard.
      const nestedRoot = nestedTreeKey(seam)
      await journal.beginTree(nestedRoot, new Date(0).toISOString())

      const controller = new AbortController()
      const onParentAbort = () => controller.abort(signal.reason)
      if (signal.aborted) controller.abort(signal.reason)
      else signal.addEventListener('abort', onParentAbort, { once: true })
      const nestedScope: Scope<unknown> = seam.mount(nestedRoot, controller.signal)
      active = { controller, scope: nestedScope }

      try {
        // Run the driver. Its `act` spawns children into the nested scope and reacts via
        // `scope.next()`; a thrown `act` propagates so the PARENT scope types it into a down.
        const out = await driverActAbortable(() => driver.act(task, nestedScope), controller.signal)
        await finalizeScopeOwnerMaterialization(nestedScope)

        // A driver may choose its answer while descendants still run. Its allocation is not
        // refundable until every descendant has stopped and reached a terminal journal record.
        await closeActive('driver completed')

        // Read the nested tree's events ONCE. Keep two journal categories while reconciling their
        // sum against this driver's one parent reservation:
        //  - `spent` = settled child WORK, written on this driver's settlement.
        //  - `metered` = nested driver INFERENCE, re-homed as a separate metered event.
        const events = await loadTreeEvents(journal, nestedRoot)
        const settled = events.filter(isSettled)
        const childWork = sumSpend(settled)
        meteredSpend = nonZeroOrUndef(sumMetered(events))
        accounting = {
          reported: childWork,
          reservation: addSpend(childWork, meteredSpend ?? zeroSpend()),
        }
        // Completion-oracle propagation: a driver "delivered" iff at least one of its DIRECT
        // children settled `valid` (the child its keep-best finalize returns). Deriving the
        // driver child's verdict this way composes delivery UP the recursion — a sub-driver is
        // `valid` only when it itself selected a delivered child — so a node never settles
        // "done = delivered" on a sub-tree that delivered nothing (Foreman's 0/18 lesson).
        const verdict = deriveDeliveryVerdict(settled)
        artifact = {
          outRef: `${driverRuntime}:${nestedRoot}`,
          out,
          spent: childWork,
          ...(verdict ? { verdict } : {}),
        }
        return artifact
      } catch (err) {
        await finalizeScopeOwnerMaterialization(active?.scope ?? nestedScope).catch(() => undefined)
        await closeActive('driver stopped')
        // Crash mid-run: the nested tree still holds the durable `metered` events the sub-driver
        // already wrote (pool already debited them). Cache them so the parent's down-path re-home
        // lands the partial inference and the two ledgers stay in agreement. A missing tree must
        // not mask the original error.
        const partial = await safeRollup(journal, nestedRoot)
        meteredSpend = partial?.metered
        accounting = partial?.accounting
        throw err
      } finally {
        signal.removeEventListener('abort', onParentAbort)
        active = undefined
      }
    },
    accounting(): ExecutorAccounting | undefined {
      return accounting
    },
    metered(): Spend | undefined {
      return meteredSpend
    },
    async teardown(): Promise<{ destroyed: boolean }> {
      await closeActive('driver executor teardown')
      return { destroyed: true }
    },
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) {
        throw new ValidationError('driverExecutor: resultArtifact() read before execute()')
      }
      return artifact
    },
  }
  const ownerRuntime = runtimeOwnedScopeOwnerRuntime(driver)
  return ownerRuntime === undefined
    ? executor
    : attestRuntimeOwnedDeferredExecutor(executor, ownerRuntime)
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
      if ((spec as { driverRuntime?: unknown }).driverRuntime === driverRuntime && !spec.executor) {
        return { succeeded: true as const, value: driverExecutorFactory as ExecutorFactory<Out> }
      }
      return base.resolve<Out>(spec)
    },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Derive the nested-tree key from the parent's durable journal root and this driver child's stable
 * node id. Sibling node ids are unique within the parent tree, and replay derives the same key. */
function nestedTreeKey(seam: NestedScopeSeam): string {
  return `${seam.journalRoot}/${seam.nodeId}`
}

async function closeNestedScope(
  scope: Scope<unknown>,
  controller: AbortController,
  reason: string,
): Promise<void> {
  if (!controller.signal.aborted) controller.abort(reason)
  for (;;) {
    const settled = await scope.next()
    if (settled === null) break
  }
  const view = scope.view
  if (view.inFlight > 0 || view.waiting > 0) {
    throw new ValidationError(
      `driverExecutor: nested cleanup left ${view.inFlight} running and ${view.waiting} waiting nodes`,
    )
  }
}

async function driverActAbortable<T>(act: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw driverAbortError(signal)
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      queueMicrotask(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(driverAbortError(signal))
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    let work: Promise<T>
    try {
      work = Promise.resolve(act())
    } catch (error) {
      cleanup()
      reject(error)
      return
    }
    work.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

function driverAbortError(signal: AbortSignal): Error {
  const reason = signal.reason
  const error = new Error(
    typeof reason === 'string' && reason.length > 0 ? reason : 'driver aborted',
  )
  error.name = 'AbortError'
  return error
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
    if (ev.spent.tokensKnown === false) total.tokensKnown = false
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
    if (ev.spend.tokensKnown === false) total.tokensKnown = false
    total.usd += ev.spend.usd
    if (ev.spend.usdKnown === false) total.usdKnown = false
    total.ms += ev.spend.ms
  }
  return total
}

function zeroSpend(): Spend {
  return { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
}

function addSpend(a: Spend, b: Spend): Spend {
  return {
    iterations: a.iterations + b.iterations,
    tokens: {
      input: a.tokens.input + b.tokens.input,
      output: a.tokens.output + b.tokens.output,
    },
    ...(a.tokensKnown === false || b.tokensKnown === false ? { tokensKnown: false } : {}),
    usd: a.usd + b.usd,
    ...(a.usdKnown === false || b.usdKnown === false ? { usdKnown: false } : {}),
    ms: a.ms + b.ms,
  }
}

function isNonZeroSpend(s: Spend): boolean {
  return (
    s.iterations > 0 ||
    s.tokens.input > 0 ||
    s.tokens.output > 0 ||
    s.tokensKnown === false ||
    s.usd > 0 ||
    s.usdKnown === false ||
    s.ms > 0
  )
}

/** A spend, or `undefined` when it is all-zero — so `metered()` returns undefined for a driver
 *  whose sub-tree did no inference (and the parent journals no empty `metered` event). */
function nonZeroOrUndef(s: Spend): Spend | undefined {
  return isNonZeroSpend(s) ? s : undefined
}

/** Sum the nested tree's metered events, tolerating a missing tree (a crash before `beginTree`
 *  landed) — never throw here, or it would mask the original `act` error on the crash path. */
async function safeRollup(
  journal: SpawnJournal,
  nestedRoot: string,
): Promise<
  { readonly metered: Spend | undefined; readonly accounting: ExecutorAccounting } | undefined
> {
  try {
    const events = await loadTreeEvents(journal, nestedRoot)
    const childWork = sumSpend(events.filter(isSettled))
    const metered = nonZeroOrUndef(sumMetered(events))
    return {
      metered,
      accounting: {
        reported: childWork,
        reservation: addSpend(childWork, metered ?? zeroSpend()),
      },
    }
  } catch {
    return undefined
  }
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
