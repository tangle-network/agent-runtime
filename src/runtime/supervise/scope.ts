/**
 *
 * The reactive `Scope` impl (KEYSTONE, build step 4 + the step-8 adapter).
 *
 * An `Agent.act` runs inside a `Scope`. It `spawn`s children dynamically and reacts to
 * them via `next()`. The scope owns ONE in-memory nursery — the authoritative live set —
 * and is the single place that drives a child's lifecycle: reserve budget atomically,
 * resolve a `Executor` through the open registry, run it (one-shot OR streaming),
 * fold its normalized `UsageEvent`s into a conserved `Spend`, reconcile the reservation
 * (refunding the unspent remainder), persist the result blob + journal records, and
 * deliver the `Settled` through the `next()` cursor.
 *
 * Three invariants this impl enforces by construction:
 *  - `next()` is a ray.wait n=1 cursor over THIS scope's live set; it assigns the
 *    monotonic `seq` (the recorded cursor order) at the moment it yields a settlement, so
 *    replay re-delivers in the identical order — `seq` is never wall-clock.
 *  - Budget is reserved at spawn and reconciled at settle through the shared `BudgetPool`,
 *    so `spawn` fails CLOSED on an exhausted pool and total ≡ free + reserved + committed.
 *  - `view` reads the in-memory nursery, never the journal — O(live), synchronous.
 *
 * The settle path is the only writer of journal `settled` events; the spawn path the only
 * writer of `spawned` events. The result blob is `put` BEFORE the journal `settled` record
 * references its `outRef`, so a crash can never leave a journaled ref with no blob.
 *
 * @experimental
 */

import { canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent, type RuntimeHooks } from '../../runtime-hooks'
import type { Iteration } from '../types'
import type { BudgetPool, ReservationTicket } from './budget'
import {
  DEFAULT_STALL_AFTER_MS,
  type ExecutorProgress,
  readWorkerProgress,
  type WorkerProgress,
} from './progress'
import type { TraceSource } from './trace-source'
import type {
  Agent,
  AgentSpec,
  Budget,
  DefaultVerdict,
  Executor,
  ExecutorContext,
  ExecutorRegistry,
  ExecutorResult,
  Handle,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  ResultBlobStore,
  ResumedKeyState,
  ResumedWork,
  Runtime,
  Scope,
  Settled,
  SpawnJournal,
  SpawnOpts,
  SpawnPrior,
  SpawnRejection,
  Spend,
  TreeView,
  UsageEvent,
  WaitOpts,
} from './types'
import {
  assertWaitWithinDeadline,
  type PendingWait,
  runWait,
  validateWaitSpec,
  type WaitOutcome,
  type WaitProbeRegistry,
  type WaitRejection,
  type WaitSpec,
} from './wait'

/** Construction args for `createScope`. The supervisor threads the shared pool, journal,
 *  blob store, and executor registry through; `depth`/`maxDepth` pair the runtime
 *  recursion ceiling with the conserved pool (R3). */
export interface ScopeArgs {
  /** This scope's owning node id — children get `${parentId}:s${seq}` ids. */
  readonly parentId: NodeId
  /** Journal/blob root key the supervisor `beginTree`'d. */
  readonly root: NodeId
  /** The shared conserved reservation pool (one per supervised run). */
  readonly pool: BudgetPool
  /** Append-only spawn journal; this scope writes `spawned` + `settled` records. */
  readonly journal: SpawnJournal
  /** Content-addressed result store backing `outRef` rehydration. */
  readonly blobs: ResultBlobStore
  /** The open executor resolver (BYO → router/inline → registered harness factory). */
  readonly executors: ExecutorRegistry
  /** Predicate resolver for `poll` wait-states. Absent ⇒ `wait` refuses a `poll` with
   *  `unknown-probe`; `timer` waits never touch it. */
  readonly probes?: WaitProbeRegistry
  /** Injected sleeper for wait-states — a test drives a week-long timer in microseconds. */
  readonly waitSleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** Per-spawn executor-construction seams (sandbox client, router config, cli bin). */
  readonly seams: Readonly<Record<string, unknown>>
  /** This scope's recursion depth (root = 0). */
  readonly depth: number
  /** Runtime recursion-depth ceiling — a spawn past it fails closed `depth-exceeded`. */
  readonly maxDepth?: number
  /** Abort signal for this scope; an abort cascades into every live child's executor. */
  readonly signal: AbortSignal
  /** Injected clock — keeps the journal `at` timestamp deterministic in tests. */
  readonly now?: () => number
  /** Lifecycle stream sink. `spawn` emits `agent.spawn`, `next` emits `agent.child` — the
   *  SAME stream `runAgentRounds`/`tool-loop` feed, so the recursive tree is ONE observable stream
   *  (the topology viewer reads it). Undefined ⇒ the journal stays the only record. */
  readonly hooks?: RuntimeHooks
  /**
   * Resume seam — set ONLY by the supervisor when `SupervisorOpts.resume` is on AND a non-empty
   * journal tree exists for this root. It carries the replayed committed work (so `scope.resume`
   * exposes it to a resume-aware `act`) and the recorded ordinal/cursor maxima the new counters
   * continue past, so a freshly-spawned child never reuses a journaled `seq`. Absent ⇒ fresh run.
   */
  readonly resumeFrom?: {
    readonly settled: ReadonlyArray<Settled<unknown>>
    readonly view: TreeView
    /** Highest `spawned` ordinal already journaled; new spawns start at `+1`. */
    readonly maxSpawnOrdinal: number
    /** Highest cursor `seq` already journaled; new settlements start at `+1`. */
    readonly maxCursorSeq: number
    /** Highest `waiting` ordinal already journaled; new waits start at `+1`. */
    readonly maxWaitOrdinal: number
    /** Waits journaled as armed but never woken — re-armed (same node id, same absolute deadline)
     *  when `wait` is called again with the SAME label. */
    readonly waits: ReadonlyArray<PendingWait>
    /** Keyed assignments from the prior journal — what a keyed re-spawn resolves against. */
    readonly keys: ReadonlyMap<string, ResumedKeyState<unknown>>
    /** Prior committed spend summed off the journal (settled child work + metered inference). */
    readonly priorSpend: { readonly childWork: Spend; readonly driverInference: Spend }
  }
}

/**
 * Internal live-set entry. `settled` resolves once the child's executor has fully drained,
 * its reservation reconciled, and its result blob persisted; `next()` awaits these to drive
 * the cursor. `resolved` mirrors that terminal value synchronously so a concurrent `next()`
 * can pick the next undelivered settlement without re-racing. `delivered` guards exactly-once
 * delivery; `seq` is stamped by `next()`, never here.
 */
interface LiveChild {
  readonly id: NodeId
  readonly profileDigest?: string
  status: NodeStatus
  runtime: Runtime
  readonly budget: Budget
  readonly label: string
  /** The semantic spawn key, when this child was spawned with one — the settle path folds the
   *  terminal state back into the scope's key registry under it. */
  readonly key?: string
  spent: Spend
  outRef?: string
  /** Resolves with the terminal settlement WITHOUT a `seq` — `next()` stamps the seq. */
  readonly settled: Promise<PreSeqSettled>
  /** Synchronous mirror of `settled`'s value once it has resolved (else `undefined`). */
  resolved?: PreSeqSettled
  /** True once the EXECUTOR's own work is finished (artifact read or throw caught) — from then
   *  on `settled` resolves without further executor progress (only persistence/teardown), so a
   *  non-blocking drain may await it without waiting on live work. */
  executorDone: boolean
  /** True once `next()` has yielded this child's settlement. */
  delivered: boolean
  /** The executor's out-of-band inbox, captured at spawn — backs `scope.send`. */
  readonly deliver?: (msg: unknown) => void | boolean
  /** Dynamic inbox availability, captured from the executor when present. */
  readonly canDeliver?: () => boolean
  /** The executor's optional live progress read, captured at spawn — backs `scope.progress`. */
  readonly readProgress?: () => ExecutorProgress | undefined
  /** The executor's optional live tool trace, captured at spawn — backs `scope.traceSource`. */
  readonly readTraceSource?: () => TraceSource | undefined
  /** Wall-clock of the spawn, and of the last metered usage event this child produced. Both are
   *  stamped by the scope from the stream the conserved pool already meters, so EVERY executor —
   *  including one that implements no progress read at all — has an observable liveness signal. */
  readonly startedAt: number
  lastActivityAt: number
  /** Present ONLY on a wait-state node. Its presence is what routes the settle path to the
   *  `woken` journal event instead of `settled`, and what keeps a wait out of `inFlight`. */
  readonly wait?: { readonly spec: WaitSpec; readonly armedAt: number; readonly label: string }
}

/** A child's terminal settlement before the cursor stamps the monotonic `seq`. A wait-state's
 *  `done` carries a `WaitOutcome` as its `out` and a zero `spent` — waiting is free by type, not
 *  by measurement. */
type PreSeqSettled =
  | {
      kind: 'done'
      out: unknown
      outRef: string
      verdict?: DefaultVerdict
      spent: Spend
      /** A driver child's OWN-inference subtree total (from `Executor.metered()`) — journaled as a
       *  `metered` event for this node, NOT reconciled (already debited live via `observe`). */
      metered?: Spend
    }
  | {
      kind: 'down'
      reason: string
      infra: boolean
      /** A CRASHED driver child's partial OWN-inference subtree total — re-homed on the down path
       *  too, so the journal matches the pool (which already debited it via `observe`). */
      metered?: Spend
    }

/**
 * The recursion seam key. A `Scope` seeds a value of this on each child's
 * `ExecutorContext.seams` so a child whose executor is a DRIVER can mount a NESTED `Scope`
 * over the SAME conserved pool at `depth+1`. A leaf executor never reads it. Single-sourced
 * here so the scope and the driver-executor agree on the seam without a circular import.
 */
export const nestedScopeSeamKey = 'nested-scope'

/**
 * The recursion seam value: mount a nested `Scope` for a driver child. `parentId` is the
 * driver child's own node id (so its children get `${nodeId}:s${ordinal}` ids and its
 * nested journal tree is namespaced under it); `root` is the journal tree key for the
 * nested tree (distinct from the parent's so cursor seqs never collide in the per-tree
 * guard). `depth` is `parent.depth + 1`. The nested scope shares the parent's `pool`
 * (conserved budget across depth), `journal`/`blobs` (one record), and `executors` (a
 * nested child resolves to leaf-or-driver through the same open registry).
 */
export interface NestedScopeSeam {
  /** The exact spawned agent node that owns the nested scope. */
  readonly childNodeId: NodeId
  /** The run's injected clock, shared with the nested journal. */
  readonly now: () => number
  /** This scope's recursion depth — a nested scope runs at `depth + 1`. */
  readonly depth: number
  /** The runtime recursion-depth ceiling, paired with the conserved pool (R3). */
  readonly maxDepth?: number
  /** Mount a nested scope rooted at `nestedRoot`, parented at this driver child's node id. */
  mount(nestedRoot: NodeId, signal: AbortSignal): Scope<unknown>
}

function makeNestedScopeSeam(args: ScopeArgs, childNodeId: NodeId): NestedScopeSeam {
  return {
    childNodeId,
    now: args.now ?? Date.now,
    depth: args.depth,
    ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
    mount(nestedRoot: NodeId, signal: AbortSignal): Scope<unknown> {
      return createScope<unknown>({
        parentId: childNodeId,
        root: nestedRoot,
        pool: args.pool,
        journal: args.journal,
        blobs: args.blobs,
        executors: args.executors,
        // Re-seed the parent's NON-recursion seams (sandbox/router for leaf grandchildren);
        // the nested scope adds its OWN nested-scope seam per child in `spawn`.
        seams: args.seams,
        depth: args.depth + 1,
        ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
        signal,
        ...(args.now ? { now: args.now } : {}),
        ...(args.hooks ? { hooks: args.hooks } : {}),
      })
    },
  }
}

/** Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay. */
export function createScope<Out>(args: ScopeArgs): Scope<Out> {
  const children = new Map<NodeId, LiveChild>()
  // Two distinct monotonic counters in two namespaces:
  //  - `spawnOrdinal` is the spawn order (0,1,2,…); it mints the deterministic node id
  //    `${parent}:s${ordinal}` and stamps the `spawned` event's `seq`. Known at spawn.
  //  - `cursorSeq` is the order `next()` yields settlements (B2); it stamps the
  //    `settled`/`cancelled` event's `seq` and the `Settled.seq` the driver branches on.
  // They are separate so a `spawned` event never collides with a `settled` event in the
  // journal's per-tree uniqueness guard (which is scoped to the cursor namespace).
  // On a resumed scope, continue both monotonic namespaces PAST the recorded maxima so a
  // freshly-spawned child or settlement never reuses a journaled `seq` (the per-tree
  // uniqueness guard would otherwise fail loud). On a fresh scope both start at 0.
  //  - `waitOrdinal` is a THIRD namespace for wait-states (`${parent}:w${ordinal}`, stamping the
  //    `waiting` event's `seq`), separate from the spawn ordinal so a wait and a worker can never
  //    mint the same node id.
  let spawnOrdinal = args.resumeFrom ? args.resumeFrom.maxSpawnOrdinal + 1 : 0
  let cursorSeq = args.resumeFrom ? args.resumeFrom.maxCursorSeq + 1 : 0
  let waitOrdinal = args.resumeFrom ? args.resumeFrom.maxWaitOrdinal + 1 : 0
  let meterSeq = 0
  const now = args.now ?? Date.now
  // Waits the journal shows as armed but never woken, keyed by label. `wait` RE-ADOPTS one instead
  // of arming a fresh countdown — that is what makes a resumed deadline the ORIGINAL deadline.
  const unclaimedWaits = new Map<string, PendingWait>(
    (args.resumeFrom?.waits ?? []).map((w) => [w.label, w]),
  )

  // The semantic-key registry (`SpawnOpts.key`): every keyed assignment's current state, seeded
  // from the prior journal on resume and updated live as keyed children spawn and settle. This is
  // what makes a keyed spawn idempotent per key across process lifetimes: `done` returns the
  // committed result, `live` refuses a concurrent duplicate, `down`/`in-doubt` spawn fresh but
  // say so explicitly.
  type KeyState =
    | { readonly state: 'live'; readonly id: NodeId }
    | {
        readonly state: 'done'
        readonly id: NodeId
        readonly settled: Settled<Out> & { kind: 'done' }
      }
    | { readonly state: 'down'; readonly id: NodeId; readonly reason: string }
    | { readonly state: 'in-doubt'; readonly id: NodeId }
  const keyed = new Map<string, KeyState>()
  for (const [key, prior] of args.resumeFrom?.keys ?? []) {
    if (prior.state === 'completed' && prior.settled?.kind === 'done') {
      keyed.set(key, {
        state: 'done',
        id: prior.id,
        settled: prior.settled as Settled<Out> & { kind: 'done' },
      })
    } else if (prior.state === 'down' && prior.settled?.kind === 'down') {
      keyed.set(key, { state: 'down', id: prior.id, reason: prior.settled.reason })
    } else {
      keyed.set(key, { state: 'in-doubt', id: prior.id })
    }
  }
  /** Fold a keyed child's terminal settlement back into the registry, so a later spawn with the
   *  same key resolves to it (done → committed result; down → explicit retry). */
  const recordKeyedSettlement = (key: string, settled: Settled<Out>): void => {
    if (settled.kind === 'done') {
      keyed.set(key, { state: 'done', id: settled.handle.id, settled })
    } else {
      keyed.set(key, { state: 'down', id: settled.handle.id, reason: settled.reason })
    }
  }

  function spawn<C extends Out>(
    agent: Agent<unknown, C>,
    task: unknown,
    opts: SpawnOpts,
  ):
    | { ok: true; handle: Handle<C>; prior?: SpawnPrior<C> }
    | { ok: false; reason: SpawnRejection } {
    // Resolve the semantic key FIRST — a committed key spends nothing (no reservation, no
    // executor, no journal record: the prior settlement is already the durable record), and a
    // still-live duplicate is refused before any resource is touched.
    if (opts.key !== undefined) {
      const existing = keyed.get(opts.key)
      if (existing?.state === 'live') return { ok: false, reason: 'duplicate-key' }
      if (existing?.state === 'done') {
        return {
          ok: true,
          handle: existing.settled.handle as Handle<C>,
          prior: { state: 'completed', settled: existing.settled as Settled<C> & { kind: 'done' } },
        }
      }
      if (existing?.state === 'down') {
        return { ok: false, reason: 'prior-down' }
      } else if (existing?.state === 'in-doubt') {
        return { ok: false, reason: 'prior-in-doubt' }
      }
    }

    if (args.maxDepth !== undefined && args.depth >= args.maxDepth) {
      return { ok: false, reason: 'depth-exceeded' }
    }

    // Resolve the leaf executor through the OPEN registry FIRST (no reservation to unwind
    // if the agent is misconfigured). An agent carries its executor mapping as the
    // `executorSpec` (an `AgentSpec`); resolution precedence (BYO → router/inline → harness
    // factory) lives in the registry, not in a call-site switch.
    const spec = (agent as unknown as { executorSpec?: unknown }).executorSpec
    if (!isAgentSpec(spec)) {
      throw new ValidationError(
        `scope.spawn: agent "${agent.name}" exposes no \`executorSpec\` (AgentSpec) to resolve a Executor`,
      )
    }
    const profileDigest = canonicalAgentProfileDigest(spec.profile)
    const resolved = args.executors.resolve<C>(spec)
    if (!resolved.succeeded) throw new ValidationError(`scope.spawn: ${resolved.error}`)

    // Reserve the child's whole ceiling atomically; fail CLOSED when the pool can't cover
    // it (never read-then-spawn overcommit, so Σk is conserved by construction).
    const reservation = args.pool.reserve(opts.budget)
    if (!reservation.ok) return { ok: false, reason: reservation.reason }

    // Everything between reserve and runChild's hand-off owns the reservation. A SYNCHRONOUS
    // throw here (most likely the executor factory `resolved.value(spec, ctx)`) would otherwise
    // leak the reservation — runChild, which reconciles the ticket, is never reached. Release it
    // with zero spend on throw, then rethrow, so `total ≡ free + reserved + committed` holds.
    // (runChild is the last statement and never sync-throws, so there is no double-reconcile.)
    try {
      const ordinal = spawnOrdinal++
      const id: NodeId = `${args.parentId}:s${ordinal}`

      // The child's abort chains off this scope's signal (a scope abort reaps every child)
      // AND off its own handle.abort(). Aborting mid-acquire cascades through the executor's
      // signal into its acquireSandbox find-by-name reap, so an acquiring node never leaks.
      const childAbort = new AbortController()
      const cascadeAbort = () => childAbort.abort()
      if (args.signal.aborted) childAbort.abort()
      else args.signal.addEventListener('abort', cascadeAbort, { once: true })

      // Seed THIS scope's own keystone deps into the child's `ExecutorContext.seams`, so a
      // child whose executor is a DRIVER can mount a nested `Scope` at `depth+1` over the
      // SAME conserved pool + shared journal/blobs/registry (the recursion seam). A leaf
      // executor ignores it; the parent's sandbox/router seams still pass through for leaves.
      // The mounted nested scope re-seeds the SAME bag for ITS children, so the recursion
      // composes — a driver child of a driver child mounts one level deeper still.
      const ctx: ExecutorContext = {
        nodeId: id,
        signal: childAbort.signal,
        seams: { ...args.seams, [nestedScopeSeamKey]: makeNestedScopeSeam(args, id) },
      }
      const executor = resolved.value(spec, ctx) as Executor<C>

      const handle: Handle<C> = {
        id,
        label: opts.label,
        get status(): NodeStatus {
          return children.get(id)?.status ?? 'cancelled'
        },
        abort(reason?: string): void {
          childAbort.abort(reason)
        },
      }

      const live: LiveChild = {
        id,
        profileDigest,
        status: 'acquiring',
        runtime: executor.runtime,
        budget: opts.budget,
        label: opts.label,
        ...(opts.key !== undefined ? { key: opts.key } : {}),
        spent: zeroSpend(),
        settled: undefined as unknown as Promise<PreSeqSettled>,
        delivered: false,
        executorDone: false,
        startedAt: now(),
        lastActivityAt: now(),
        ...(executor.deliver ? { deliver: executor.deliver.bind(executor) } : {}),
        ...(executor.canDeliver ? { canDeliver: executor.canDeliver.bind(executor) } : {}),
        ...(executor.progress ? { readProgress: executor.progress.bind(executor) } : {}),
        ...(executor.traceSource ? { readTraceSource: executor.traceSource.bind(executor) } : {}),
      }
      children.set(id, live)
      if (opts.key !== undefined) keyed.set(opts.key, { state: 'live', id })

      void args.journal.appendEvent(args.root, {
        kind: 'spawned',
        id,
        parent: args.parentId,
        label: opts.label,
        profileDigest,
        ...(opts.key !== undefined ? { key: opts.key } : {}),
        budget: opts.budget,
        runtime: executor.runtime,
        seq: ordinal,
        at: new Date(now()).toISOString(),
      })

      notifyRuntimeHookEvent(
        args.hooks,
        {
          id: `${id}:spawn`,
          runId: args.root,
          target: 'agent.spawn',
          phase: 'after',
          timestamp: now(),
          stepIndex: ordinal,
          parentId: args.parentId,
          payload: {
            childId: id,
            label: opts.label,
            profileDigest,
            runtime: executor.runtime,
            budget: opts.budget,
            depth: args.depth,
          },
        },
        { signal: args.signal },
      )

      // Drive the executor to settlement off to the side; `next()` awaits the resulting
      // promise. A thrown executor (or a real abort) is TYPED into a `down` record by
      // `runChild` (never re-thrown) so a single failing child never rejects the cursor.
      const settled = runChild(
        live,
        executor,
        childAbort,
        task,
        opts,
        args.pool,
        reservation.ticket,
        args.blobs,
        now,
      )
        .then((s) => {
          live.resolved = s
          return s
        })
        .finally(() => {
          args.signal.removeEventListener('abort', cascadeAbort)
        })
      ;(live as { settled: Promise<PreSeqSettled> }).settled = settled

      return { ok: true, handle }
    } catch (err) {
      args.pool.reconcile(reservation.ticket, zeroSpend())
      throw err
    }
  }

  async function next(): Promise<Settled<Out> | null> {
    const undelivered = () => [...children.values()].filter((c) => !c.delivered)
    if (undelivered().length === 0) return null

    // ray.wait n=1: await the FIRST not-yet-delivered child to settle. Loop because a
    // concurrent `next()` may take the race winner between the await and the pick.
    for (;;) {
      const pending = undelivered()
      if (pending.length === 0) return null
      // Prefer an already-resolved-but-undelivered child (no await needed).
      const ready = pending.find((c) => c.resolved !== undefined)
      const chosen = ready ?? (await raceFirstSettled(pending))
      if (chosen.delivered) continue
      chosen.delivered = true

      const seq = cursorSeq++
      const settlement = chosen.resolved
      if (!settlement) {
        throw new ValidationError(
          `scope.next: child '${chosen.id}' won the settle race without a resolved value`,
        )
      }
      const delivered = await finalizeSettlement<Out>(chosen, settlement, seq, args, now)
      if (chosen.key !== undefined) recordKeyedSettlement(chosen.key, delivered)
      return delivered
    }
  }

  async function nextResolved(): Promise<Settled<Out> | null> {
    // Same exactly-once delivery as `next()`, but never awaits a RUNNING executor. A child
    // whose executor has finished (`executorDone`) may still be mid-persistence — awaiting its
    // `settled` promise there completes in bounded bookkeeping time, never on live work.
    for (;;) {
      const candidates = [...children.values()].filter((c) => !c.delivered)
      const pick =
        candidates.find((c) => c.resolved !== undefined) ?? candidates.find((c) => c.executorDone)
      if (!pick) return null
      const settlement = await pick.settled
      if (pick.delivered) continue // lost the race with a concurrent cursor — pick again
      pick.delivered = true
      const seq = cursorSeq++
      const delivered = await finalizeSettlement<Out>(pick, settlement, seq, args, now)
      if (pick.key !== undefined) recordKeyedSettlement(pick.key, delivered)
      return delivered
    }
  }

  function send(nodeId: NodeId, msg: unknown): boolean {
    const child = children.get(nodeId)
    // Deliver only to a child that is still LIVE (not yet yielded by the cursor) and whose executor
    // accepts an inbox. A settled/unknown child, or a leaf with no `deliver`, cannot be steered.
    if (!child || child.delivered || !child.deliver || child.canDeliver?.() === false) return false
    if (child.deliver(msg) === false) return false
    // A delivered steer IS activity: it resets the idle clock so a worker that was about to read
    // as stalled is not immediately re-steered before it can act on the message it just got.
    child.lastActivityAt = now()
    return true
  }

  /**
   * Arm a wait-state node. Deliberately NOT a `spawn` with a sleeping executor: it resolves no
   * `AgentSpec`, constructs no `Executor`, and — the point of the whole mechanic — reserves NOTHING
   * from the conserved pool, so a week-long wait costs zero tokens and zero dollars and cannot
   * starve a worker of budget.
   *
   * Fail-closed admission, mirroring `spawn`'s typed outcome. The deadline check is the one that
   * matters: a wait may not silently sleep past the pool's hard wall-clock ceiling, and it may not
   * extend that ceiling either (that would make a wait override a budget guard).
   */
  function wait(
    spec: WaitSpec,
    opts: WaitOpts,
  ): { ok: true; handle: Handle<WaitOutcome> } | { ok: false; reason: WaitRejection } {
    if (validateWaitSpec(spec) !== null) return { ok: false, reason: 'invalid-spec' }
    if (spec.kind === 'poll' && args.probes?.resolve(spec.probe) === undefined) {
      return { ok: false, reason: 'unknown-probe' }
    }

    // Re-adopt a journaled, still-unfired wait with this label: same node id, same spec, same
    // ORIGINAL arm instant. The caller passes the spec it would have used fresh; the journaled one
    // wins, so a restart cannot slide the deadline forward.
    const adopted = unclaimedWaits.get(opts.label)
    if (adopted) unclaimedWaits.delete(opts.label)
    const effectiveSpec = adopted?.spec ?? spec
    const armedAt = adopted?.armedAt ?? now()

    if (!assertWaitWithinDeadline(effectiveSpec, args.pool.readout().deadlineMs)) {
      return { ok: false, reason: 'deadline-exceeded' }
    }

    const id: NodeId = adopted ? adopted.id : `${args.parentId}:w${waitOrdinal}`
    const ordinal = adopted ? adopted.ordinal : waitOrdinal
    if (!adopted) waitOrdinal += 1

    const waitAbort = new AbortController()
    const cascadeAbort = () => waitAbort.abort()
    if (args.signal.aborted) waitAbort.abort()
    else args.signal.addEventListener('abort', cascadeAbort, { once: true })

    const handle: Handle<WaitOutcome> = {
      id,
      label: opts.label,
      get status(): NodeStatus {
        return children.get(id)?.status ?? 'cancelled'
      },
      abort(reason?: string): void {
        waitAbort.abort(reason)
      },
    }

    const live: LiveChild = {
      id,
      status: 'waiting',
      runtime: 'wait',
      // A wait's recorded budget is zero on every channel — nothing was reserved, so nothing may
      // be reconciled, and a journal reader sums it as the zero it truly is.
      budget: { maxIterations: 0, maxTokens: 0 },
      label: opts.label,
      spent: zeroSpend(),
      settled: undefined as unknown as Promise<PreSeqSettled>,
      delivered: false,
      executorDone: false,
      startedAt: armedAt,
      lastActivityAt: now(),
      wait: { spec: effectiveSpec, armedAt, label: opts.label },
    }
    children.set(id, live)

    // Only a FRESH arm journals `waiting`; an adopted one already has its record (re-writing it
    // would duplicate the wait ordinal in the journal's per-tree guard).
    if (!adopted) {
      void args.journal.appendEvent(args.root, {
        kind: 'waiting',
        id,
        parent: args.parentId,
        label: opts.label,
        spec: effectiveSpec,
        armedAt,
        seq: ordinal,
        at: new Date(now()).toISOString(),
      })
    }

    notifyRuntimeHookEvent(
      args.hooks,
      {
        id: `${id}:waiting`,
        runId: args.root,
        target: 'agent.spawn',
        phase: 'after',
        timestamp: now(),
        stepIndex: ordinal,
        parentId: args.parentId,
        payload: {
          childId: id,
          label: opts.label,
          runtime: 'wait',
          wait: effectiveSpec,
          armedAt,
          resumed: adopted !== undefined,
        },
      },
      { signal: args.signal },
    )

    const settled = runWait({
      spec: effectiveSpec,
      label: opts.label,
      armedAt,
      resumed: adopted !== undefined,
      signal: waitAbort.signal,
      ...(args.probes ? { probes: args.probes } : {}),
      now,
      ...(args.waitSleep ? { sleep: args.waitSleep } : {}),
    })
      .then(async (resolution): Promise<PreSeqSettled> => {
        live.executorDone = true
        live.lastActivityAt = now()
        if (resolution.kind === 'cancelled') {
          return { kind: 'down', reason: resolution.reason, infra: false }
        }
        const outRef = contentAddress(resolution.outcome)
        await args.blobs.put(outRef, resolution.outcome)
        return { kind: 'done', out: resolution.outcome, outRef, spent: zeroSpend() }
      })
      .catch((err): PreSeqSettled => {
        live.executorDone = true
        return { kind: 'down', reason: errMessage(err), infra: true }
      })
      .then((s) => {
        live.resolved = s
        return s
      })
      .finally(() => {
        args.signal.removeEventListener('abort', cascadeAbort)
      })
    ;(live as { settled: Promise<PreSeqSettled> }).settled = settled

    return { ok: true, handle }
  }

  function progress(
    nodeId: NodeId,
    opts: { now?: number; stallAfterMs?: number } = {},
  ): WorkerProgress | undefined {
    const child = children.get(nodeId)
    if (!child) return undefined
    // The executor's own read is best-effort enrichment on a live path — a throwing progress
    // implementation must never break the driver's observation of an otherwise healthy worker.
    let fromExecutor: ExecutorProgress | undefined
    try {
      fromExecutor = child.readProgress?.()
    } catch {
      fromExecutor = undefined
    }
    return readWorkerProgress(
      {
        id: child.id,
        status: child.status,
        steerable: child.deliver !== undefined && !child.delivered,
        startedAt: child.startedAt,
        lastActivityAt: child.lastActivityAt,
        turns: child.spent.iterations,
        tokens: child.spent.tokens,
        usd: child.spent.usd,
        ...(child.spent.usdKnown === false ? { usdKnown: false } : {}),
      },
      fromExecutor,
      opts.now ?? now(),
      opts.stallAfterMs ?? DEFAULT_STALL_AFTER_MS,
    )
  }

  function traceSource(nodeId: NodeId): TraceSource | undefined {
    const child = children.get(nodeId)
    if (!child) return undefined
    try {
      return child.readTraceSource?.()
    } catch {
      return undefined
    }
  }

  async function meter(spend: Spend, detail?: Record<string, unknown>): Promise<void> {
    const seq = meterSeq++
    // Debit the driver's own inference against the shared conserved pool (free → committed), so
    // equal-k counts it live and `budget.tokensLeft` reflects it for the in-loop guard.
    args.pool.observe(spend)
    // Journal it as a `metered` event — the durable TWIN of the pool debit (as `settled` is the
    // twin of `reconcile`), so every journal-based cost reader sums driver inference automatically.
    // Awaited like the settled append (cost-critical), so it has landed before the supervisor's
    // join-barrier cost roll-up.
    await args.journal.appendEvent(args.root, {
      kind: 'metered',
      id: args.parentId,
      spend,
      seq,
      at: new Date(now()).toISOString(),
    })
    // Emit it as an `agent.turn` event so the trace/topology view sees per-turn driver inference
    // (the same stream `spawn`/`next` feed — one observable tree).
    notifyRuntimeHookEvent(
      args.hooks,
      {
        id: `${args.parentId}:meter:${seq}`,
        runId: args.root,
        target: 'agent.turn',
        phase: 'after',
        timestamp: now(),
        parentId: args.parentId,
        payload: { spend, ...(detail ?? {}) },
      },
      { signal: args.signal },
    )
  }

  // The replayed committed work, frozen once at construction — a resume-aware `act` reads it
  // to skip re-spawning settled children. Absent on a fresh scope.
  const resume: ResumedWork<Out> | undefined = args.resumeFrom
    ? {
        settled: args.resumeFrom.settled as ReadonlyArray<Settled<Out>>,
        view: args.resumeFrom.view,
        waits: args.resumeFrom.waits,
        keys: args.resumeFrom.keys as ReadonlyMap<string, ResumedKeyState<Out>>,
        priorSpend: args.resumeFrom.priorSpend,
      }
    : undefined

  return {
    spawn,
    next,
    nextResolved,
    send,
    wait,
    progress,
    traceSource,
    signal: args.signal,
    meter,
    ...(resume ? { resume } : {}),
    get view(): TreeView {
      return makeTreeView(args.parentId, children)
    },
    get budget() {
      return args.pool.readout()
    },
  }
}

/** Await whichever pending child settles first, returning the child (its `resolved` is set
 *  by the time this resolves because `runChild`'s `.then` sets it before the promise
 *  resolves downstream). */
async function raceFirstSettled(pending: LiveChild[]): Promise<LiveChild> {
  return Promise.race(pending.map((c) => c.settled.then(() => c)))
}

/** Stamp the cursor `seq`, write the `settled` journal record, and project the
 *  `PreSeqSettled` into the frozen `Settled` the driver branches on. */
async function finalizeSettlement<Out>(
  child: LiveChild,
  settlement: PreSeqSettled,
  seq: number,
  args: ScopeArgs,
  now: () => number,
): Promise<Settled<Out>> {
  const handle = frozenHandle<Out>(child)
  // A wait-state settles into the `woken` cursor event, not `settled` — kept distinct so any
  // journal reader can separate zero-cost waiting from paid work without inspecting payloads
  // (`spentFromJournal` therefore sums waits as the zero they are, with no special case).
  if (child.wait) return finalizeWait<Out>(child, settlement, seq, args, now, handle)
  if (settlement.kind === 'down') {
    child.status = 'failed'
    await args.journal.appendEvent(args.root, {
      kind: 'settled',
      id: child.id,
      status: 'down',
      spent: child.spent,
      infra: settlement.infra,
      seq,
      at: new Date(now()).toISOString(),
    })
    // Re-home a crashed driver child's partial inference too (the pool already debited it via
    // `observe`) — so spentTotal/trajectory never undercount a sub-driver that died mid-run.
    if (settlement.metered) {
      await args.journal.appendEvent(args.root, {
        kind: 'metered',
        id: child.id,
        spend: settlement.metered,
        seq,
        at: new Date(now()).toISOString(),
      })
    }
    notifyRuntimeHookEvent(
      args.hooks,
      {
        id: `${child.id}:settled`,
        runId: args.root,
        target: 'agent.child',
        phase: 'after',
        timestamp: now(),
        stepIndex: seq,
        parentId: args.parentId,
        payload: {
          childId: child.id,
          status: 'down',
          reason: settlement.reason,
          infra: settlement.infra,
          spent: child.spent,
        },
      },
      { signal: args.signal },
    )
    return {
      kind: 'down',
      handle,
      reason: settlement.reason,
      infra: settlement.infra,
      seq,
    }
  }

  child.status = 'done'
  child.outRef = settlement.outRef
  child.spent = settlement.spent
  await args.journal.appendEvent(args.root, {
    kind: 'settled',
    id: child.id,
    status: 'done',
    outRef: settlement.outRef,
    ...(settlement.verdict ? { verdict: settlement.verdict } : {}),
    spent: settlement.spent,
    seq,
    at: new Date(now()).toISOString(),
  })
  // Re-home a driver child's OWN-inference subtree total up to THIS (parent) tree as a `metered`
  // event for the child node — mirroring how `settled.spent` rolls child WORK up. So summing any
  // sub-tree root yields its true driver-inference cost, NOT reconciled (already pool-debited).
  if (settlement.metered) {
    await args.journal.appendEvent(args.root, {
      kind: 'metered',
      id: child.id,
      spend: settlement.metered,
      seq,
      at: new Date(now()).toISOString(),
    })
  }
  notifyRuntimeHookEvent(
    args.hooks,
    {
      id: `${child.id}:settled`,
      runId: args.root,
      target: 'agent.child',
      phase: 'after',
      timestamp: now(),
      stepIndex: seq,
      parentId: args.parentId,
      payload: {
        childId: child.id,
        status: 'done',
        outRef: settlement.outRef,
        score: settlement.verdict?.score,
        valid: settlement.verdict?.valid,
        spent: settlement.spent,
      },
    },
    { signal: args.signal },
  )
  return {
    kind: 'done',
    handle,
    out: settlement.out as Out,
    outRef: settlement.outRef,
    ...(settlement.verdict ? { verdict: settlement.verdict } : {}),
    spent: settlement.spent,
    seq,
  }
}

/** Journal a wait-state's settlement as a `woken` event and project it onto the same `Settled`
 *  the driver branches on. `by` names WHY it woke — `fired` / `timeout` / `cancelled` — which is
 *  the fact a resumed reader needs and cannot recover from a payload it may never fetch. */
async function finalizeWait<Out>(
  child: LiveChild,
  settlement: PreSeqSettled,
  seq: number,
  args: ScopeArgs,
  now: () => number,
  handle: Handle<Out>,
): Promise<Settled<Out>> {
  const at = new Date(now()).toISOString()
  if (settlement.kind === 'down') {
    child.status = 'cancelled'
    await args.journal.appendEvent(args.root, {
      kind: 'woken',
      id: child.id,
      by: 'cancelled',
      seq,
      at,
    })
    return {
      kind: 'down',
      handle,
      reason: settlement.reason,
      infra: settlement.infra,
      seq,
    }
  }
  child.status = 'done'
  child.outRef = settlement.outRef
  const out = settlement.out as WaitOutcome
  await args.journal.appendEvent(args.root, {
    kind: 'woken',
    id: child.id,
    by: out.settled,
    outRef: settlement.outRef,
    seq,
    at,
  })
  notifyRuntimeHookEvent(
    args.hooks,
    {
      id: `${child.id}:woken`,
      runId: args.root,
      target: 'agent.child',
      phase: 'after',
      timestamp: now(),
      stepIndex: seq,
      parentId: args.parentId,
      payload: { childId: child.id, status: 'done', wait: out },
    },
    { signal: args.signal },
  )
  return {
    kind: 'done',
    handle,
    out: settlement.out as Out,
    outRef: settlement.outRef,
    spent: settlement.spent,
    seq,
  }
}

/**
 * Drive one child's `Executor` to a terminal `PreSeqSettled`, folding usage into the
 * conserved `Spend`, reconciling the reservation, and persisting the result blob. Both
 * executor shapes are handled here: a one-shot `Promise<ExecutorResult>` and a streaming
 * `AsyncIterable<UsageEvent>` whose terminal artifact is read from `resultArtifact()`.
 *
 * A thrown executor (or a real abort) becomes a TYPED `down` — never re-thrown — so a
 * single failing child cannot reject the `next()` cursor (the M2 typed-result discipline,
 * applied per child). The reservation is reconciled on EVERY path (success, abort, throw)
 * so the conserved pool can never leak a reservation.
 */
async function runChild<C>(
  live: LiveChild,
  executor: Executor<C>,
  childAbort: AbortController,
  task: unknown,
  opts: SpawnOpts,
  pool: BudgetPool,
  ticket: ReservationTicket,
  blobs: ResultBlobStore,
  now: () => number,
): Promise<PreSeqSettled> {
  let reconciled = false
  const reconcileOnce = (spend: Spend) => {
    if (reconciled) return
    reconciled = true
    // A budgetExempt executor reports zero spend by contract; the reconcile refunds its
    // whole reservation, keeping it out of the conserved Σk by construction.
    pool.reconcile(ticket, clampSpend(spend, opts.budget))
  }
  try {
    live.status = 'running'
    const ran = executor.execute(task, childAbort.signal)
    let artifact: ExecutorResult<C>
    if (isAsyncIterable(ran)) {
      // Streaming: fold the incremental usage events as they arrive (the conserved-pool
      // authority), then read the terminal artifact after the stream drains. Each event also
      // republishes the running total + a fresh activity stamp onto the live child, so a
      // concurrent `scope.progress(id)` sees a worker mid-flight rather than a zeroed row.
      const spend = await foldStream(ran, (running) => {
        live.spent = running
        live.lastActivityAt = now()
      })
      live.spent = spend
      artifact = executor.resultArtifact() as ExecutorResult<C>
      reconcileOnce(spend)
    } else {
      const terminal = await ran
      live.spent = terminal.spent
      artifact = terminal
      reconcileOnce(terminal.spent)
    }
    // Executor work is complete; everything below is persistence/teardown. From here `settled`
    // resolves without further executor progress — the non-blocking drain keys on this.
    live.executorDone = true

    // A driver child's OWN-inference subtree total — re-homed by the parent on EVERY settle exit
    // (done, aborted, crash) so the journal always matches what the pool already debited.
    const ownMetered = executor.metered?.()

    if (childAbort.signal.aborted) {
      await teardownSafe(executor, opts.shutdown ?? 'brutalKill')
      return downRecord('aborted before settle', true, ownMetered)
    }

    // The durable record is keyed by the canonical content address of the output — the
    // single addressing scheme the blob store enforces and the supervisor's winner path
    // uses. An executor's self-minted `resultArtifact().outRef` is its own internal dedup
    // hint; the journal/blob `outRef` is re-derived here so replay rehydrates by one
    // scheme. Persist the blob BEFORE the journal `settled` record references its `outRef`,
    // so a crash never leaves a journaled ref pointing at a missing blob.
    const outRef = contentAddress(artifact.out)
    await blobs.put(outRef, artifact.out)
    await teardownSafe(executor, opts.shutdown ?? 'infinity')
    return {
      kind: 'done',
      out: artifact.out,
      outRef,
      ...(artifact.verdict ? { verdict: artifact.verdict } : {}),
      spent: live.spent,
      ...(ownMetered ? { metered: ownMetered } : {}),
    }
  } catch (err) {
    // A thrown executor has also finished its own work — only the down-record persistence
    // remains, so the non-blocking drain may await this child too.
    live.executorDone = true
    // Reconcile the (likely partial) spend so the reservation is refunded even on a throw.
    reconcileOnce(live.spent)
    await teardownSafe(executor, 'brutalKill')
    const aborted = childAbort.signal.aborted || isAbortError(err)
    // A crashed driver child still re-homes the partial inference it durably metered.
    return downRecord(errMessage(err), aborted || isInfraError(err), executor.metered?.())
  }
}

/**
 * The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's
 * `Iteration` shape so `defaultSelectWinner` stays single-sourced — the supervisor selects
 * across settled children with the SAME argmax the loop kernel uses, not a forked copy.
 *
 * `index` is the cursor `seq` (the recorded, replay-stable order); `output`/`verdict`/
 * `tokenUsage`/`costUsd` are read straight off the settlement (already rehydrated from the
 * `outRef` blob by `next()`). Events are empty — a settled child is an opaque leaf result,
 * not a sandbox event stream — and the timing/cost fields project its conserved `Spend`.
 * Fail loud on a `down` settlement: only a `done` child is an iteration.
 */
export function settledToIteration<Out>(settled: Settled<Out>): Iteration<unknown, Out> {
  if (settled.kind === 'down') {
    throw new ValidationError(
      `settledToIteration: cannot adapt a 'down' settlement (node '${settled.handle.id}', seq ${settled.seq}) to an Iteration`,
    )
  }
  return {
    index: settled.seq,
    task: undefined,
    agentRunName: settled.handle.label,
    output: settled.out,
    ...(settled.verdict ? { verdict: settled.verdict } : {}),
    events: [],
    startedAt: 0,
    endedAt: settled.spent.ms,
    costUsd: settled.spent.usd,
    tokenUsage: { input: settled.spent.tokens.input, output: settled.spent.tokens.output },
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeTreeView(root: NodeId, children: Map<NodeId, LiveChild>): TreeView {
  const nodes: NodeSnapshot[] = [...children.values()].map((c) => ({
    id: c.id,
    parent: root,
    label: c.label,
    ...(c.profileDigest !== undefined ? { profileDigest: c.profileDigest } : {}),
    status: c.status,
    runtime: c.runtime,
    budget: c.budget,
    spent: c.spent,
    ...(c.outRef ? { outRef: c.outRef } : {}),
  }))
  return {
    root,
    nodes,
    inFlight: nodes.filter((n) => n.status === 'running' || n.status === 'acquiring').length,
    waiting: nodes.filter((n) => n.status === 'waiting').length,
  }
}

function frozenHandle<C>(child: LiveChild): Handle<C> {
  return {
    id: child.id,
    label: child.label,
    status: child.status,
    abort(): void {
      // A settled child is terminal; abort is a no-op (its executor already tore down).
    },
  }
}

/**
 * Fold a streaming executor's normalized usage into the conserved `Spend`, publishing the
 * running total after EVERY event via `onProgress`.
 *
 * The publish is what makes a running worker observable. Before it, `live.spent` was assigned
 * once — after the whole stream drained — so `observe_agent` on a RUNNING worker reported
 * `{tokens:0, iterations:0}` for the entire run and a driver had no way to tell a worker three
 * turns deep from one that had produced nothing. It also means a worker that THROWS mid-stream
 * now reconciles its real partial spend instead of refunding work the provider already billed.
 */
async function foldStream(
  stream: AsyncIterable<UsageEvent>,
  onProgress?: (running: Spend) => void,
): Promise<Spend> {
  const tokens = { input: 0, output: 0 }
  let usd = 0
  let usdKnown = true
  let iterations = 0
  for await (const ev of stream) {
    if (ev.kind === 'tokens') {
      tokens.input += ev.input
      tokens.output += ev.output
    } else if (ev.kind === 'cost') {
      usd += ev.usd
      if (ev.usdKnown === false) usdKnown = false
    } else {
      iterations += 1
    }
    onProgress?.({
      iterations,
      tokens: { ...tokens },
      usd,
      ...(usdKnown ? {} : { usdKnown: false }),
      ms: 0,
    })
  }
  return {
    iterations,
    tokens,
    usd,
    ...(usdKnown ? {} : { usdKnown: false }),
    ms: 0,
  }
}

/** Clamp a child's reported spend to its reservation so the pool's fail-loud over-spend
 *  guard never trips on a benign overshoot from an external usage report; the difference
 *  refunds to the pool as if the child stopped at its ceiling. */
function clampSpend(spend: Spend, budget: Budget): Spend {
  const totalTokens = spend.tokens.input + spend.tokens.output
  const tokensOk = totalTokens <= budget.maxTokens
  const itersOk = spend.iterations <= budget.maxIterations
  const usdOk = budget.maxUsd === undefined || spend.usd <= budget.maxUsd
  if (tokensOk && itersOk && usdOk) return spend
  const ratio = !tokensOk && totalTokens > 0 ? budget.maxTokens / totalTokens : 1
  return {
    iterations: Math.min(spend.iterations, budget.maxIterations),
    tokens:
      ratio < 1
        ? {
            input: Math.floor(spend.tokens.input * ratio),
            output: Math.floor(spend.tokens.output * ratio),
          }
        : spend.tokens,
    usd: budget.maxUsd === undefined ? spend.usd : Math.min(spend.usd, budget.maxUsd),
    ...(spend.usdKnown === false ? { usdKnown: false } : {}),
    ms: spend.ms,
  }
}

async function teardownSafe<C>(
  executor: Executor<C>,
  grace: number | 'brutalKill' | 'infinity',
): Promise<void> {
  try {
    await executor.teardown(grace)
  } catch {
    // Teardown failure is observable through the node staying live; swallow so it never
    // masks the settlement itself. The supervisor's join barrier reaps on its own grace.
  }
}

function downRecord(reason: string, infra: boolean, metered?: Spend): PreSeqSettled {
  return { kind: 'down', reason, infra, ...(metered ? { metered } : {}) }
}

function zeroSpend(): Spend {
  return { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<UsageEvent> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AsyncIterable<UsageEvent>)[Symbol.asyncIterator] === 'function'
  )
}

/** An `AgentSpec` is identified structurally by its profile. Harness is optional because an
 *  explicit executor factory or structural recursive executor may resolve the spec instead. */
function isAgentSpec(value: unknown): value is AgentSpec {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.profile === 'object' && v.profile !== null
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'AbortError'
  )
}

/** External-boundary failures (network/FS/subprocess) are infra — excluded from the merge
 *  `n` and the equal-k assertion. A `ValidationError` from a built-in executor wraps a
 *  config/transport failure, so it counts as infra; other throws are a real bad result. */
function isInfraError(err: unknown): boolean {
  return err instanceof ValidationError
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
