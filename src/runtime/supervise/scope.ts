/**
 * @experimental
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
 */

import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent, type RuntimeHooks } from '../../runtime-hooks'
import type { Iteration } from '../types'
import type { BudgetPool, ReservationTicket } from './budget'
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
  Scope,
  Settled,
  SpawnJournal,
  SpawnOpts,
  Spend,
  TreeView,
  UsageEvent,
} from './types'

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
   *  SAME stream `runLoop`/`tool-loop` feed, so the recursive tree is ONE observable stream
   *  (the topology viewer reads it). Undefined ⇒ the journal stays the only record. */
  readonly hooks?: RuntimeHooks
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
  status: NodeStatus
  runtime: NodeSnapshot['runtime']
  readonly budget: Budget
  readonly label: string
  spent: Spend
  outRef?: string
  /** Resolves with the terminal settlement WITHOUT a `seq` — `next()` stamps the seq. */
  readonly settled: Promise<PreSeqSettled>
  /** Synchronous mirror of `settled`'s value once it has resolved (else `undefined`). */
  resolved?: PreSeqSettled
  /** True once `next()` has yielded this child's settlement. */
  delivered: boolean
  /** The executor's out-of-band inbox, captured at spawn — backs `scope.send`. */
  readonly deliver?: (msg: unknown) => void
}

/** A child's terminal settlement before the cursor stamps the monotonic `seq`. */
type PreSeqSettled =
  | { kind: 'done'; out: unknown; outRef: string; verdict?: DefaultVerdict; spent: Spend }
  | { kind: 'down'; reason: string; infra: boolean; restartCount: number }

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
  /** This scope's recursion depth — a nested scope runs at `depth + 1`. */
  readonly depth: number
  /** The runtime recursion-depth ceiling, paired with the conserved pool (R3). */
  readonly maxDepth?: number
  /** The journal tree key the parent scope writes to (used to namespace nested trees). */
  readonly journalRoot: NodeId
  /** Mount a nested scope rooted at `nestedRoot`, parented at this driver child's node id. */
  mount(nestedRoot: NodeId, signal: AbortSignal): Scope<unknown>
}

function makeNestedScopeSeam(args: ScopeArgs, childNodeId: NodeId): NestedScopeSeam {
  return {
    depth: args.depth,
    ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
    journalRoot: args.root,
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

export function createScope<Out>(args: ScopeArgs): Scope<Out> {
  const children = new Map<NodeId, LiveChild>()
  // Two distinct monotonic counters in two namespaces:
  //  - `spawnOrdinal` is the spawn order (0,1,2,…); it mints the deterministic node id
  //    `${parent}:s${ordinal}` and stamps the `spawned` event's `seq`. Known at spawn.
  //  - `cursorSeq` is the order `next()` yields settlements (B2); it stamps the
  //    `settled`/`cancelled` event's `seq` and the `Settled.seq` the driver branches on.
  // They are separate so a `spawned` event never collides with a `settled` event in the
  // journal's per-tree uniqueness guard (which is scoped to the cursor namespace).
  let spawnOrdinal = 0
  let cursorSeq = 0
  const now = args.now ?? Date.now

  function spawn<C extends Out>(
    agent: Agent<unknown, C>,
    task: unknown,
    opts: SpawnOpts,
  ):
    | { ok: true; handle: Handle<C> }
    | { ok: false; reason: 'budget-exhausted' | 'depth-exceeded' } {
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
        status: 'acquiring',
        runtime: executor.runtime,
        budget: opts.budget,
        label: opts.label,
        spent: zeroSpend(),
        settled: undefined as unknown as Promise<PreSeqSettled>,
        delivered: false,
        ...(executor.deliver ? { deliver: executor.deliver.bind(executor) } : {}),
      }
      children.set(id, live)

      void args.journal.appendEvent(args.root, {
        kind: 'spawned',
        id,
        parent: args.parentId,
        label: opts.label,
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
      return finalizeSettlement<Out>(chosen, settlement, seq, args, now)
    }
  }

  function send(nodeId: NodeId, msg: unknown): boolean {
    const child = children.get(nodeId)
    // Deliver only to a child that is still LIVE (not yet yielded by the cursor) and whose executor
    // accepts an inbox. A settled/unknown child, or a leaf with no `deliver`, cannot be steered.
    if (!child || child.delivered || !child.deliver) return false
    child.deliver(msg)
    return true
  }

  return {
    spawn,
    next,
    send,
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
      restartCount: settlement.restartCount,
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
      // authority), then read the terminal artifact after the stream drains.
      const spend = await foldStream(ran)
      live.spent = spend
      artifact = executor.resultArtifact() as ExecutorResult<C>
      reconcileOnce(spend)
    } else {
      const terminal = await ran
      live.spent = terminal.spent
      artifact = terminal
      reconcileOnce(terminal.spent)
    }

    if (childAbort.signal.aborted) {
      await teardownSafe(executor, opts.shutdown ?? 'brutalKill')
      return downRecord('aborted before settle', true)
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
    }
  } catch (err) {
    // Reconcile the (likely partial) spend so the reservation is refunded even on a throw.
    reconcileOnce(live.spent)
    await teardownSafe(executor, 'brutalKill')
    const aborted = childAbort.signal.aborted || isAbortError(err)
    return downRecord(errMessage(err), aborted || isInfraError(err))
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

async function foldStream(stream: AsyncIterable<UsageEvent>): Promise<Spend> {
  const tokens = { input: 0, output: 0 }
  let usd = 0
  let iterations = 0
  for await (const ev of stream) {
    if (ev.kind === 'tokens') {
      tokens.input += ev.input
      tokens.output += ev.output
    } else if (ev.kind === 'cost') {
      usd += ev.usd
    } else {
      iterations += 1
    }
  }
  return { iterations, tokens, usd, ms: 0 }
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

function downRecord(reason: string, infra: boolean): PreSeqSettled {
  return { kind: 'down', reason, infra, restartCount: 0 }
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

/** An `AgentSpec` is identified structurally — it carries a `profile` and a `harness`
 *  field (`null` or a `BackendType`) and optionally an `executor`. */
function isAgentSpec(value: unknown): value is AgentSpec {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return 'profile' in v && 'harness' in v
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
