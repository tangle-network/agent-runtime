/**
 *
 * The recursive driver-executor — the seam that lets a SPAWNED child be a DRIVER, so
 * agents drive agents drive agents over the one keystone atom.
 *
 * A spawned child resolves through the open registry to an `Executor`; the built-in
 * executors (router/inline, sandbox, cli) are LEAVES — `execute(task, signal)` runs the
 * work and settles. This executor is the recursive case: on `execute`, it mounts a NESTED
 * `Scope` (the scope hands it the mount via the `nested-scope` seam) over a child-local
 * pool bounded by the parent's reservation, with shared journal/blobs + the same open registry,
 * one `depth` deeper, then
 * runs the wrapped driver `Agent.act(task, nestedScope)`. The driver spawns its own
 * children into that nested scope; each resolves to EITHER a leaf executor (a worker child)
 * OR this same driver-executor (a driver child) — recursively. So a driver spawns a driver
 * spawns a worker, all on one budget-conserving tree.
 *
 * Why this preserves every keystone invariant (the scope owns the sharing; this executor
 * only runs the driver over what the scope mounts):
 *  - Conserved budget: the parent reserves the driver's ceiling atomically, and the nested scope
 *    allocates only within that child-local ceiling. On settle the parent reconciles the nested
 *    aggregate once. One opaque provider call may report an overrun after it completes; that real
 *    overrun is retained and blocks later admissions.
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
 *
 * @experimental
 */

import { ValidationError } from '../../errors'
import type { ActivityNote, ExecutorProgress } from './progress'
import { type NestedScopeSeam, nestedScopeSeamKey, readNestedDelivery } from './scope'
import type {
  Agent,
  AgentSpec,
  DefaultVerdict,
  ExecutorContext,
  ExecutorFactory,
  ExecutorRegistry,
  ExecutorResult,
  NodeId,
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
 * deeper over the child-local pool and shared journal/blobs/registry, runs the driver
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
  // The executor owns one nested scope for its lifetime. Exposing that SAME scope through the
  // existing Executor progress/delivery verbs lets the parent observe and steer the active subtree
  // without a second registry or message path.
  let nestedScope: Scope<unknown> | undefined
  let nestedAbort: AbortController | undefined
  const pendingDownMessages: Array<{
    message: unknown
    targetNodeId?: NodeId
    ambiguous?: true
  }> = []
  const bindUntargetedMessage = (pending: {
    message: unknown
    targetNodeId?: NodeId
    ambiguous?: true
  }): void => {
    if (!nestedScope || pending.targetNodeId || pending.ambiguous) return
    const candidates = nestedScope.view.nodes.filter(
      (node) => isLiveStatus(node.status) && nestedScope?.progress(node.id)?.steerable === true,
    )
    if (candidates.length === 1) pending.targetNodeId = candidates[0]?.id
    else if (candidates.length > 1) pending.ambiguous = true
  }
  const flushDownMessages = (): void => {
    if (!nestedScope || pendingDownMessages.length === 0) return
    for (let index = 0; index < pendingDownMessages.length; ) {
      const pending = pendingDownMessages[index] as {
        message: unknown
        targetNodeId?: NodeId
        ambiguous?: true
      }
      // Bind an unaddressed correction at most once. If two children were viable when it arrived,
      // it remains ambiguous forever rather than drifting to whichever unrelated sibling survives.
      bindUntargetedMessage(pending)
      const accepted =
        pending.targetNodeId !== undefined &&
        nestedScope.send(pending.targetNodeId, pending.message)
      if (accepted) pendingDownMessages.splice(index, 1)
      else index += 1
    }
  }

  return {
    runtime: driverRuntime,
    deliver(msg): void {
      // A Scope routing an observed descendant id carries that id in private Runtime metadata;
      // direct messages remain compatible for the common one-active-child case. Retain either
      // form across the small interval between spawning this driver and mounting its nested scope.
      const targeted = readNestedDelivery(msg)
      const pending = targeted
        ? { message: targeted.message, targetNodeId: targeted.targetNodeId }
        : { message: msg }
      pendingDownMessages.push(pending)
      if (!targeted) bindUntargetedMessage(pending)
      flushDownMessages()
    },
    progress(): ExecutorProgress {
      return nestedScopeProgress(nestedScope, pendingDownMessages.length)
    },
    async execute(task, signal): Promise<ExecutorResult<unknown>> {
      // The nested tree key namespaces this driver's children inside the ONE shared
      // journal, so its cursor seqs never collide with the parent's per-tree guard.
      const nestedRoot = nestedTreeKey(seam)
      await journal.beginTree(nestedRoot, new Date(0).toISOString())

      const controller = new AbortController()
      nestedAbort = controller
      const cascadeParentAbort = () => controller.abort(signal.reason)
      if (signal.aborted) cascadeParentAbort()
      else signal.addEventListener('abort', cascadeParentAbort, { once: true })

      try {
        nestedScope = seam.mount(nestedRoot, controller.signal)
        flushDownMessages()

        // Preserve the driver's own error while enforcing structured ownership: whether act
        // returns or throws, every child it admitted is settled before this executor can settle.
        let actFailed = false
        let actError: unknown
        let out: unknown
        try {
          const acting = driver.act(task, nestedScope)
          // An async `act` runs synchronously through its first await. Most drivers spawn their first
          // wave there, so a correction queued during mount can now reach it.
          flushDownMessages()
          out = await acting
          flushDownMessages()
        } catch (error) {
          actFailed = true
          actError = error
        }

        try {
          await closeNestedScope(
            nestedScope,
            controller,
            'nested driver finished before all descendants settled',
          )
        } catch (error) {
          if (!actFailed) {
            actFailed = true
            actError = error
          }
        }

        if (actFailed) throw actError
        if (pendingDownMessages.length > 0) {
          throw new ValidationError(
            `driverExecutor: nested driver finished with ${pendingDownMessages.length} unread parent message(s)`,
          )
        }

        // Read the nested tree's events once. Child work and driver inference remain separate for
        // reporting; the parent reconciles their sum once against this driver's reservation.
        const events = await loadTreeEvents(journal, nestedRoot)
        const settled = events.filter(isSettled)
        meteredSpend = nonZeroOrUndef(sumMetered(events))
        // Completion-oracle propagation: a driver "delivered" iff at least one of its DIRECT
        // children settled `valid` (the child its keep-best finalize returns). Deriving the
        // driver child's verdict this way composes delivery UP the recursion — a sub-driver is
        // `valid` only when it itself selected a delivered child — so a node never settles
        // "done = delivered" on a sub-tree that delivered nothing (Foreman's 0/18 lesson).
        const verdict = deriveDeliveryVerdict(settled)
        artifact = {
          outRef: `${driverRuntime}:${nestedRoot}`,
          out,
          spent: sumSpend(settled),
          ...(verdict ? { verdict } : {}),
        }
        return artifact
      } catch (err) {
        // Crash mid-run: expose both parts of the partial subtree before rethrowing. The parent
        // records child work on its down settlement and re-homes driver inference separately;
        // both are reconciled once by the parent against this driver's reservation.
        try {
          const events = await loadTreeEvents(journal, nestedRoot)
          meteredSpend = nonZeroOrUndef(sumMetered(events))
          artifact = {
            outRef: `${driverRuntime}:${nestedRoot}:down`,
            out: { failed: true },
            spent: sumSpend(events.filter(isSettled)),
          }
        } catch {
          meteredSpend = undefined
        }
        throw err
      } finally {
        signal.removeEventListener('abort', cascadeParentAbort)
      }
    },
    metered(): Spend | undefined {
      return meteredSpend
    },
    async teardown(): Promise<{ destroyed: boolean }> {
      if (!nestedScope || !nestedAbort) return { destroyed: true }
      try {
        await closeNestedScope(nestedScope, nestedAbort, 'driver executor teardown')
        return { destroyed: true }
      } catch {
        return { destroyed: false }
      }
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

/** A nested tree is the durable child that owns it, not the process that happened to execute it.
 *  Child ids already include the full parent chain and resume past journaled ordinals, so this is
 *  stable for one child and unique across siblings and coordinator restarts. */
function nestedTreeKey(seam: NestedScopeSeam): string {
  return `${seam.journalRoot}/${seam.childNodeId}`
}

/** Fold the existing child progress reads into the parent-visible driver row. This is a projection
 *  of the live nested Scope, not a second tree: every id, status, activity note, and pending-message
 *  count comes from the same objects the nested driver's coordination tools use. */
function nestedScopeProgress(
  scope: Scope<unknown> | undefined,
  pendingFromParent: number,
): ExecutorProgress {
  if (!scope) return { pendingMessages: pendingFromParent, note: 'mounting nested scope' }
  const nodes = scope.view.nodes
  let turns = 0
  let pendingMessages = 0
  const recentActivity: ActivityNote[] = []
  for (const node of nodes) {
    const progress = scope.progress(node.id)
    turns += progress?.turns ?? node.spent.iterations
    pendingMessages += progress?.pendingMessages ?? 0
    if (progress?.recentActivity.length) {
      for (const activity of progress.recentActivity) {
        recentActivity.push({
          ...activity,
          label: `${node.label}: ${activity.label}`,
          detail: activity.detail ? `${node.id} — ${activity.detail}` : node.id,
        })
      }
      continue
    }
    recentActivity.push({
      at: progress?.lastActivityAt ?? 0,
      kind: 'note',
      label: node.label,
      detail: `${node.id} — ${node.status}`,
    })
  }
  recentActivity.sort((a, b) => a.at - b.at)
  const live = nodes.filter((node) => isLiveStatus(node.status))
  const roster = nodes.map((node) => `${node.label} (${node.status})`).join(', ')
  return {
    turns,
    pendingMessages: pendingFromParent + pendingMessages,
    recentActivity: recentActivity.slice(-12),
    note: `${live.length} nested worker${live.length === 1 ? '' : 's'} live / ${nodes.length} total${
      roster ? ` — ${roster}` : ''
    }`,
  }
}

function isLiveStatus(status: string): boolean {
  return status !== 'done' && status !== 'failed' && status !== 'cancelled'
}

/**
 * Close one driver-owned scope before its executor settles. First commit children whose executors
 * already finished, then abort the remaining live work and drain every resulting settlement.
 * The nested journal is therefore complete before the parent snapshots spend and refunds anything.
 */
async function closeNestedScope(
  scope: Scope<unknown>,
  controller: AbortController,
  reason: string,
): Promise<void> {
  for (
    let settled = await scope.nextResolved();
    settled !== null;
    settled = await scope.nextResolved()
  ) {
    // `nextResolved` performs the journal commit; no second ledger is needed here.
  }

  const view = scope.view
  if ((view.inFlight > 0 || view.waiting > 0) && !controller.signal.aborted) {
    controller.abort(reason)
  }

  for (let settled = await scope.next(); settled !== null; settled = await scope.next()) {
    // Pull to null so abort, teardown, reconciliation, and the nested `settled` record all finish.
  }
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
  const total: Spend = {
    iterations: 0,
    tokens: { input: 0, output: 0 },
    usdKnown: true,
    usd: 0,
    ms: 0,
  }
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
 *  own turns + any sub-driver inference already re-homed into this tree). It is re-homed to the
 *  parent as one event and reconciled with child work against the driver's reservation. */
function sumMetered(events: ReadonlyArray<SpawnEvent>): Spend {
  const total: Spend = {
    iterations: 0,
    tokens: { input: 0, output: 0 },
    usdKnown: true,
    usd: 0,
    ms: 0,
  }
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
  return (
    s.usdKnown === false ||
    s.iterations > 0 ||
    s.tokens.input > 0 ||
    s.tokens.output > 0 ||
    s.usd > 0 ||
    s.ms > 0
  )
}

/** A spend, or `undefined` when it is all-zero — so `metered()` returns undefined for a driver
 *  whose sub-tree did no inference (and the parent journals no empty `metered` event). */
function nonZeroOrUndef(s: Spend): Spend | undefined {
  return isNonZeroSpend(s) ? s : undefined
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
