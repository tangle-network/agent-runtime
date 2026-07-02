/**
 *
 * The `Supervisor` impl (KEYSTONE, build step 5).
 *
 * Owns the four things a free-running recursive `act` cannot own itself: the GLOBAL
 * conserved budget pool, the event-sourced spawn log, the abort cascade over the whole
 * live tree, and the OTP intensity breaker. `run` builds the root `Scope` over those,
 * runs the root `Agent.act`, and returns a TYPED `SupervisedResult` — a no-winner is
 * never coerced into a best-effort `Out`.
 *
 * Three lifecycle invariants this impl enforces by construction:
 *  - Join barrier: when `act()` settles (resolve OR reject), every still-live child is
 *    torn down before `run` returns — the generalization of the kernel's
 *    `finally{ Promise.allSettled(destroy) }` barrier (run-loop.ts) from boxes to the
 *    whole sub-tree. A teardown failure is `allSettled`'d and journaled as a
 *    `cancelled` event; it NEVER masks act()'s own outcome. act()'s rejection is the
 *    PRIMARY error (the kernel's firstError precedence), so a teardown throw during the
 *    barrier can never overwrite the real failure.
 *  - Abort cascade: a root abort (caller signal, `RootHandle.abort`, a tripped breaker,
 *    or pool exhaustion) aborts ONE internal controller whose signal is the root scope's
 *    signal. The scope cascades that into every live child's executor abort — which, for
 *    an `acquiring` child, chains into the `acquireSandbox` signal and reaps the
 *    find-by-name orphan box (M1). The supervisor never reaps children directly.
 *  - The supervisor NEVER re-enters a child (m3): the kernel/`acquireSandbox` already
 *    retried at the leaf, and a driver re-spawns through `scope.spawn`. The breaker only
 *    COUNTS `down` settlements within the intensity window and trips to a typed
 *    no-winner; it does not restart anything.
 *
 * Selection lives in the driver, not here (selector≠judge): `act` returns the synthesized
 * winner `Out`. The supervisor content-addresses that `Out` for its replay `outRef`, reads
 * `spentTotal` off the journal (`settled` child work + `metered` driver inference), and wraps
 * it as a typed `winner` — it does not re-rank children behind the driver's back.
 *
 * @experimental
 */

import { contentAddress } from '../../durable/spawn-journal'
import { RuntimeRunStateError } from '../../errors'
import { type BudgetPool, createBudgetPool } from './budget'
import { createScope } from './scope'
import type {
  Agent,
  RootHandle,
  RootSignal,
  Scope,
  SpawnEvent,
  SpawnJournal,
  Spend,
  SupervisedResult,
  Supervisor,
  SupervisorOpts,
  TreeView,
} from './types'

/** The default runtime recursion-depth ceiling, paired with the conserved pool so a
 *  runaway recursion hits budget-exhaustion first and depth-exceeded second (R3). */
const defaultMaxDepth = 4

/** A no-winner reason the supervisor can prove from its OWN lifecycle state — pinned to
 *  the frozen `SupervisedResult` reason union. A driver rejecting for a domain reason
 *  (not budget/abort) is classed `all-children-down`, the only typed bucket for "the tree
 *  produced no usable result". */
type NoWinnerReason = (SupervisedResult<unknown> & { kind: 'no-winner' })['reason']

export function createSupervisor<Task, Out>(): Supervisor<Task, Out> {
  let attached: RootControl | undefined

  async function run(
    root: Agent<Task, Out>,
    task: Task,
    opts: SupervisorOpts,
  ): Promise<SupervisedResult<Out>> {
    const now = opts.now ?? Date.now
    const pool = createBudgetPool(opts.budget, now)
    await opts.journal.beginTree(opts.runId, new Date(now()).toISOString())

    // Journal the root as its own `spawned` node (parent-less, the spawn-ordinal-0 marker), so a
    // journal-based reader — `trajectoryReport`, `replaySpawnTree`, `materializeTreeView` — can
    // reconstruct the WHOLE realized tree from a real run, not only hand-built journals. The root
    // is never `scope.spawn`ed (the supervisor runs `act` directly), so without this the root node
    // is absent and `trajectoryReport` fails its `nodes.has(root)` invariant. The uniqueness guard
    // skips `spawned` events (only the cursor namespace must be unique), so sharing ordinal 0 with
    // the first child's spawn is not a collision; replay ignores `spawned` events for settlement
    // reconstruction, so the replayed `Settled[]` is unchanged.
    await opts.journal.appendEvent(opts.runId, {
      kind: 'spawned',
      id: opts.runId,
      label: 'root',
      budget: opts.budget,
      runtime: 'inline',
      seq: 0,
      at: new Date(now()).toISOString(),
    })

    // ONE internal controller is the root scope's abort source. Every cascade path
    // (caller signal, RootHandle.abort, breaker trip, deadline) aborts it; the scope
    // fans it out to each live child's executor (acquire-aware reap included).
    const controller = new AbortController()
    const cascadeAbort = (reason?: string) => {
      if (controller.signal.aborted) return
      // Carry the reason on the signal so it chains down to each child's abort signal
      // (`childAbort.signal.reason`) — the diagnostic the scope's executors observe.
      controller.abort(reason)
    }

    const onCallerAbort = () => cascadeAbort('caller signal aborted')
    if (opts.signal) {
      if (opts.signal.aborted) cascadeAbort('caller signal aborted')
      else opts.signal.addEventListener('abort', onCallerAbort, { once: true })
    }

    // The breaker watches `down` settlements via a counting journal decorator, so it
    // observes every child failure without intercepting `scope.next()` (the driver's
    // private channel). Tripping aborts the same controller; the trip is recorded so the
    // final result can name it.
    const breaker = createIntensityBreaker(opts, () => cascadeAbort('intensity breaker tripped'))
    const journal = wrapJournalForBreaker(opts.journal, breaker)

    const scope = createScope<Out>({
      parentId: opts.runId,
      root: opts.runId,
      pool,
      journal,
      blobs: opts.blobs,
      executors: opts.executors,
      seams: {},
      depth: 0,
      maxDepth: opts.maxDepth ?? defaultMaxDepth,
      signal: controller.signal,
      now,
      hooks: opts.hooks,
    })

    // `view`/drain read the scope opaquely (`Out` erased) — the supervisor never `spawn`s
    // on it, so the live-tree readout and the join barrier are `Out`-agnostic.
    const openScope = scope as unknown as Scope<unknown>

    // Bind any attached RootHandle to THIS live run so view()/signal()/abort() reach the
    // live scope + the one cascade controller. Detached again in the finally barrier.
    if (attached) {
      attached.bind({ scope: openScope, cascadeAbort, signal: pushRootSignal(cascadeAbort) })
    }

    let actOutcome: { ok: true; out: Out } | { ok: false; error: unknown }
    try {
      const out = await root.act(task, scope)
      actOutcome = { ok: true, out }
    } catch (error) {
      // act()'s rejection is the PRIMARY error; capture it before the join barrier so a
      // teardown failure in the barrier can never overwrite it (firstError precedence).
      actOutcome = { ok: false, error }
    } finally {
      // Join barrier: tear down every still-live child. Generalizes the kernel's
      // `finally{ Promise.allSettled(destroy) }` — a teardown throw is allSettled'd and
      // journaled, never re-thrown.
      await drainLiveChildren(openScope, controller)
      if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort)
      if (attached) attached.unbind()
    }

    const tree = scope.view
    if (actOutcome.ok) {
      // Every child has settled (join barrier above); no reservation may remain. A leaked ticket
      // would silently corrupt the conserved spend total, so fail loud here — on the success path
      // only, where the act() error precedence does not apply.
      pool.assertNoOpenTickets()
      const out = actOutcome.out
      // Completion-oracle at the root: a `winner` MUST carry a real `Out`. A driver that ran to
      // completion but selected nothing (its keep-best finalize found no DELIVERED child) returns
      // `undefined` — that is a no-winner, never a winner wrapping `undefined`. The supervisor's
      // contract is to refuse coercing a non-result into a best-effort Out (Foreman's 0/18 lesson).
      if (out !== undefined) {
        // The driver synthesized a winner. Content-address it for the replay `outRef`, put it
        // once, and sum the conserved spend off every journaled settlement. No re-ranking — the
        // driver already selected.
        const outRef = contentAddress(out)
        await opts.blobs.put(outRef, out)
        // ONE ledger: the journal. `settled` events carry spawned-child WORK; `metered` events carry
        // the drivers' OWN inference (the twin of `pool.observe`). `spentTotal` is their sum and the
        // breakdown keeps the two separable — the A++ view of where the tokens went. No pool bridge.
        const { childWork, driverInference } = await spentFromJournal(journal, opts.runId)
        return {
          kind: 'winner',
          out,
          outRef,
          tree,
          spentTotal: addSpend(childWork, driverInference),
          ...(isNonEmptySpend(driverInference)
            ? { spentBreakdown: { driverInference, childWork } }
            : {}),
        }
      }
      return noWinner()
    }

    // act() rejected. The reason is proven from lifecycle state, in precedence order:
    // a tripped breaker outranks any abort (it is the most specific cause) outranks
    // budget-exhaustion outranks the residual "the tree produced nothing usable" bucket.
    // A no-winner is TYPED — never a best-effort coercion of a partial child (M2).
    return noWinner()

    // A no-winner still incurred real conserved spend before failing, so it carries `spentTotal`
    // summed off the SAME journal the winner path reads — the caller always learns the cost.
    async function noWinner(): Promise<SupervisedResult<Out>> {
      const { childWork, driverInference } = await spentFromJournal(journal, opts.runId)
      return {
        kind: 'no-winner',
        reason: classifyNoWinner(controller, pool, opts, breaker),
        tree,
        downCount: breaker.downCount(),
        spentTotal: addSpend(childWork, driverInference),
      }
    }
  }

  function attach(h: RootHandle<Out>): void {
    const control = rootControls.get(h as RootHandle<unknown>)
    if (!control) {
      throw new RuntimeRunStateError(
        'supervisor.attach: handle was not minted by createRootHandle (no control channel)',
      )
    }
    attached = control
  }

  return { run, attach }
}

// ── Root handle ───────────────────────────────────────────────────────────────

/** The live binding the supervisor populates while a run is in flight. `view` reads the
 *  live scope; `cascadeAbort`/`signal` reach the one cascade controller. */
interface RunBinding {
  readonly scope: Scope<unknown>
  readonly cascadeAbort: (reason?: string) => void
  readonly signal: (msg: RootSignal) => void
}

/** The supervisor-private control behind a `RootHandle`. `createRootHandle` mints it and
 *  registers it in `rootControls`; `attach` looks it up and `bind`s it to the live run. */
interface RootControl {
  bind(binding: RunBinding): void
  unbind(): void
}

/** Module-private channel from a minted `RootHandle` to its `RootControl`, so `attach`
 *  can prove a handle is ours and reach its binding without leaking the control onto the
 *  frozen `RootHandle` shape. */
const rootControls = new WeakMap<RootHandle<unknown>, RootControl>()

/**
 * Mint a `RootHandle` plus its supervisor-private control. The handle is the substrate a
 * chat/pi-viz client attaches to (Q2): `view()` reads the live tree, `signal()` delivers
 * an out-of-band message, `abort()` cascades. Before `run` binds it (and after `run`
 * unbinds it) the handle is fail-loud: a client that talks to a handle that is not
 * driving a live run gets a typed error, never a silent no-op.
 */
export function createRootHandle<Out>(): RootHandle<Out> {
  let binding: RunBinding | undefined
  const handle: RootHandle<Out> = {
    view(): TreeView {
      if (!binding) {
        throw new RuntimeRunStateError(
          'RootHandle.view: handle is not bound to a live run (attach it before run, read after run starts)',
        )
      }
      return binding.scope.view
    },
    signal(msg: RootSignal): void {
      if (!binding) {
        throw new RuntimeRunStateError('RootHandle.signal: handle is not bound to a live run')
      }
      binding.signal(msg)
    },
    abort(reason?: string): void {
      if (!binding) {
        throw new RuntimeRunStateError('RootHandle.abort: handle is not bound to a live run')
      }
      binding.cascadeAbort(reason ?? 'root handle aborted')
    },
  }
  rootControls.set(handle as RootHandle<unknown>, {
    bind(b: RunBinding): void {
      binding = b
    },
    unbind(): void {
      binding = undefined
    },
  })
  return handle
}

/** A `RootSignal` sink: `cancel` cascades an abort; pause/resume/ask are observability
 *  signals the substrate accepts but does not act on here (the chat/pi-viz client owns
 *  pause semantics — building them now would be mechanism ahead of the gate). */
function pushRootSignal(cascadeAbort: (reason?: string) => void): (msg: RootSignal) => void {
  return (msg: RootSignal): void => {
    if (msg.kind === 'cancel') cascadeAbort(msg.reason ?? 'root signal: cancel')
  }
}

// ── OTP intensity breaker ───────────────────────────────────────────────────────

/**
 * Counts `down` settlements inside a sliding window. More than `maxRestarts` of them
 * within `withinMs` trips the supervisor (aborting the cascade) rather than letting a
 * driver re-spawn a doomed child forever. With either bound unset the breaker is inert
 * (it still counts `down`s for `downCount`). The breaker NEVER restarts a child — it is a
 * circuit breaker over the driver's own re-spawn decisions (m3).
 */
interface IntensityBreaker {
  recordDown(at: number): void
  tripped(): boolean
  downCount(): number
}

function createIntensityBreaker(opts: SupervisorOpts, trip: () => void): IntensityBreaker {
  const max = opts.maxRestarts
  const within = opts.withinMs
  const armed = max !== undefined && within !== undefined
  const recent: number[] = []
  let total = 0
  let isTripped = false
  return {
    recordDown(at: number): void {
      total += 1
      if (!armed || isTripped) return
      recent.push(at)
      const cutoff = at - within
      while (recent.length > 0 && recent[0]! < cutoff) recent.shift()
      if (recent.length > max) {
        isTripped = true
        trip()
      }
    },
    tripped(): boolean {
      return isTripped
    },
    downCount(): number {
      return total
    },
  }
}

/** Decorate the journal so the breaker observes every `settled`-`down` event the scope
 *  appends, without the supervisor intercepting `scope.next()`. The decorator is
 *  transparent — it forwards every method verbatim and only reads the down events. */
function wrapJournalForBreaker(journal: SpawnJournal, breaker: IntensityBreaker): SpawnJournal {
  return {
    loadTree: (root) => journal.loadTree(root),
    beginTree: (root, at) => journal.beginTree(root, at),
    appendEvent: (root, ev: SpawnEvent) => {
      if (ev.kind === 'settled' && ev.status === 'down') breaker.recordDown(Date.parse(ev.at))
      return journal.appendEvent(root, ev)
    },
  }
}

// ── Join barrier + result classification ─────────────────────────────────────────

/**
 * Drain the root scope's live set so every still-running/acquiring child is torn down
 * before `run` returns — the join barrier. Abort the cascade controller first (so each
 * child's executor stops cleanly), then pull `next()` to completion so every aborted
 * child's teardown + reconcile runs and its `settled` event is journaled by the scope.
 * A child's own teardown failure is already swallowed inside `runChild`, and the cursor
 * itself never rejects (a failing child is typed into a `down`), so the whole barrier is
 * `allSettled`'d — a stray throw here is NOT the primary error (firstError precedence).
 */
async function drainLiveChildren(
  scope: Scope<unknown>,
  controller: AbortController,
): Promise<void> {
  const hasLive = scope.view.inFlight > 0
  if (!hasLive) return
  // Cascade the abort into every live child's executor before draining.
  if (!controller.signal.aborted) controller.abort()
  await Promise.allSettled([drainCursor(scope)])
}

async function drainCursor(scope: Scope<unknown>): Promise<void> {
  for (;;) {
    const settled = await scope.next()
    if (settled === null) return
  }
}

function classifyNoWinner(
  controller: AbortController,
  pool: BudgetPool,
  opts: SupervisorOpts,
  breaker: IntensityBreaker,
): NoWinnerReason {
  // A tripped breaker is the most specific cause (children kept dying), so it outranks
  // the generic abort it raised. Then a caller/handle abort. Then the pool. The residual
  // bucket is "ran to completion under budget but produced nothing usable".
  if (breaker.tripped()) return 'all-children-down'
  if (controller.signal.aborted) return 'aborted'
  if (poolExhausted(pool, opts)) return 'budget-exhausted'
  return 'all-children-down'
}

function poolExhausted(pool: BudgetPool, opts: SupervisorOpts): boolean {
  const r = pool.readout()
  if (r.tokensLeft <= 0) return true
  if (opts.budget.maxUsd !== undefined && r.usdLeft <= 0) return true
  if (
    opts.budget.deadlineMs !== undefined &&
    r.deadlineMs > 0 &&
    (opts.now ?? Date.now)() >= r.deadlineMs
  ) {
    return true
  }
  return false
}

/**
 * Sum the conserved spend over every journaled `settled` event — the honest per-channel
 * total (input/output/usd/iterations all preserved), read off the same evidence replay
 * reads. Computed AFTER the join barrier so every child's settlement is recorded. Fails
 * loud if the tree was never journaled (the supervisor always `beginTree`s, so a missing
 * tree is a corrupted journal, not a normal path).
 */
async function spentFromJournal(
  journal: SpawnJournal,
  root: string,
): Promise<{ childWork: Spend; driverInference: Spend }> {
  const events = await journal.loadTree(root)
  if (events === undefined) {
    throw new RuntimeRunStateError(
      `supervisor: spawn tree '${root}' is missing from the journal after run (corrupted log)`,
    )
  }
  const childWork: Spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
  const driverInference: Spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
  for (const ev of events) {
    // `settled` = spawned-child work (reconciled); `metered` = driver inference (re-homed up the
    // tree, so this single root-tree pass already includes every nested driver's inference).
    if (ev.kind === 'settled') accumulate(childWork, ev.spent)
    else if (ev.kind === 'metered') accumulate(driverInference, ev.spend)
  }
  return { childWork, driverInference }
}

/** Add `b` into `a` in place, per channel. */
function accumulate(a: Spend, b: Spend): void {
  a.iterations += b.iterations
  a.tokens.input += b.tokens.input
  a.tokens.output += b.tokens.output
  a.usd += b.usd
  a.ms += b.ms
}

/** Sum two conserved-spend tallies per channel — the child-work journal sum + the drivers' own
 *  metered inference, so `spentTotal` is the true cost of the run. */
function addSpend(a: Spend, b: Spend): Spend {
  return {
    iterations: a.iterations + b.iterations,
    tokens: { input: a.tokens.input + b.tokens.input, output: a.tokens.output + b.tokens.output },
    usd: a.usd + b.usd,
    ms: a.ms + b.ms,
  }
}

/** True when any driver metered inference this run (so the winner carries a `spentBreakdown`).
 *  Checks every channel `addSpend` sums — including `ms` — so the gate stays consistent with the
 *  total even though the coordination driver currently stamps `ms: 0`. */
function isNonEmptySpend(s: Spend): boolean {
  return s.iterations > 0 || s.tokens.input > 0 || s.tokens.output > 0 || s.usd > 0 || s.ms > 0
}
