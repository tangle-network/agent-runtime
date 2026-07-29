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

import { sha256DigestSchema } from '@tangle-network/agent-interface'
import {
  contentAddress,
  materializeTreeView,
  pendingWaits,
  replaySpawnTree,
} from '../../durable/spawn-journal'
import { RuntimeRunStateError } from '../../errors'
import { type BudgetPool, createBudgetPool } from './budget'
import { armDeadlineTimer } from './deadline'
import { runTree } from './finalizer'
import {
  knownExecutionBindingReceipt,
  knownMaterializationReceipt,
  newExecutionAttemptId,
  unknownExecutionBindingReceipt,
  unknownMaterializationReceipt,
} from './materialization'
import { createScope, finalizeScopeOwnerMaterialization } from './scope'
import { detachedSnapshot } from './snapshot'
import type {
  Agent,
  Budget,
  ExecutionBindingReceipt,
  ProfileMaterializationReceipt,
  ResumedKeyState,
  RootHandle,
  RootSignal,
  Scope,
  Settled,
  SpawnEvent,
  SpawnJournal,
  Spend,
  SteerableRootHandle,
  SupervisedResult,
  Supervisor,
  SupervisorOpts,
  TreeView,
} from './types'
import type { PendingWait } from './wait'

/** The committed work + cursor maxima the supervisor hands a resumed scope. Shaped to spread
 *  into `ScopeArgs.resumeFrom`. */
interface ResumeFrom {
  readonly settled: ReadonlyArray<Settled<unknown>>
  readonly view: TreeView
  readonly maxSpawnOrdinal: number
  readonly maxCursorSeq: number
  readonly maxWaitOrdinal: number
  readonly waits: ReadonlyArray<PendingWait>
  readonly keys: ReadonlyMap<string, ResumedKeyState<unknown>>
  readonly priorSpend: { readonly childWork: Spend; readonly driverInference: Spend }
}

/**
 * The keyed assignments a prior journal proves: every `spawned` event carrying a `key`, resolved
 * against the replayed settlements. A key spawned more than once (a retry chain) resolves to its
 * LATEST attempt — iterate in ordinal order so later spawns overwrite earlier ones. A spawned
 * event with no matching settlement is `in-doubt`: the process died with it in flight.
 */
function keyedAssignments(
  events: SpawnEvent[],
  settled: ReadonlyArray<Settled<unknown>>,
): ReadonlyMap<string, ResumedKeyState<unknown>> {
  const byId = new Map(settled.map((s) => [s.handle.id, s]))
  const keys = new Map<string, ResumedKeyState<unknown>>()
  const spawns = events
    .filter((ev): ev is Extract<SpawnEvent, { kind: 'spawned' }> => ev.kind === 'spawned')
    .sort((a, b) => a.seq - b.seq)
  for (const ev of spawns) {
    if (ev.key === undefined) continue
    if (ev.identity === undefined) {
      throw new RuntimeRunStateError(
        `supervisor: keyed node '${ev.id}' has no durable execution identity`,
      )
    }
    const s = byId.get(ev.id)
    keys.set(
      ev.key,
      s === undefined
        ? { id: ev.id, label: ev.label, identity: ev.identity, state: 'in-doubt' }
        : {
            id: ev.id,
            label: ev.label,
            identity: ev.identity,
            state: s.kind === 'done' ? 'completed' : 'down',
            settled: s,
          },
    )
  }
  return keys
}

type SpawnedEvent = Extract<SpawnEvent, { kind: 'spawned' }>

/** A resumed process may continue only the exact root contract first recorded for this run id. */
function assertResumeContract(events: SpawnEvent[], opts: SupervisorOpts): SpawnedEvent {
  const roots = events.filter(
    (event): event is SpawnedEvent =>
      event.kind === 'spawned' && event.id === opts.runId && event.parent === undefined,
  )
  if (roots.length !== 1) {
    throw new RuntimeRunStateError(
      `supervisor: resumed run '${opts.runId}' must contain exactly one root identity event; found ${roots.length}`,
    )
  }
  const recorded = roots[0]!
  if (contentAddress(recorded.budget) !== contentAddress(opts.budget)) {
    throw new RuntimeRunStateError(
      `supervisor: resume budget mismatch for run '${opts.runId}'; use a new runId to change limits`,
    )
  }
  if (!sameOptionalIdentity(recorded.identity, opts.rootIdentity)) {
    throw new RuntimeRunStateError(
      `supervisor: resume identity mismatch for run '${opts.runId}'; task, profile, candidate, and correlation must match`,
    )
  }
  const receipts = events.filter(
    (event): event is Extract<SpawnEvent, { kind: 'materialized' }> =>
      event.kind === 'materialized' && event.id === opts.runId,
  )
  const expectedReceipt = rootMaterializationReceipt(opts)
  if (expectedReceipt === undefined) {
    if (receipts.length > 1) {
      throw new RuntimeRunStateError(
        `supervisor: resumed run '${opts.runId}' contains duplicate root materialization evidence`,
      )
    }
  } else if (
    receipts.length !== 1 ||
    contentAddress(receipts[0]?.receipt) !== contentAddress(expectedReceipt)
  ) {
    throw new RuntimeRunStateError(
      `supervisor: resume materialization mismatch for run '${opts.runId}'; backend, model, execution identity, and plan must match`,
    )
  }
  return recorded
}

/** Mint root evidence at the trusted composition boundary. A generic in-process Agent root has no
 * executor declaration and remains explicitly unknown rather than inheriting fabricated details. */
function rootMaterializationReceipt(
  opts: SupervisorOpts,
): ProfileMaterializationReceipt | undefined {
  const declaration = opts.rootMaterialization
  if (declaration === undefined) {
    return unknownMaterializationReceipt({
      ...(opts.rootIdentity?.profileDigest === undefined
        ? {}
        : { authoredProfileDigest: opts.rootIdentity.profileDigest }),
      runtime: 'inline',
      reason: 'root-agent-did-not-report',
    })
  }
  if (declaration.declaration === 'deferred') return undefined
  if (opts.rootIdentity?.profileDigest === undefined) {
    throw new RuntimeRunStateError(
      `supervisor: run '${opts.runId}' cannot record known root materialization without an exact profileDigest`,
    )
  }
  try {
    return knownMaterializationReceipt({
      authoredProfileDigest: opts.rootIdentity.profileDigest,
      runtime: declaration.runtime,
      declaration: declaration.declaration,
    })
  } catch (error) {
    throw new RuntimeRunStateError(
      `supervisor: run '${opts.runId}' has invalid root materialization evidence`,
      { cause: error },
    )
  }
}

function rootExecutionBindingReceipt(
  opts: SupervisorOpts,
  materialization: ProfileMaterializationReceipt,
  attemptId: string,
): ExecutionBindingReceipt | undefined {
  const root = opts.rootMaterialization
  if (root?.declaration === 'deferred') return undefined
  if (root === undefined) {
    return unknownExecutionBindingReceipt(materialization, attemptId, 'root-agent-did-not-report')
  }
  try {
    return knownExecutionBindingReceipt(materialization, {
      attemptId,
      ...root.binding,
    })
  } catch (error) {
    throw new RuntimeRunStateError(
      `supervisor: run '${opts.runId}' has invalid root execution binding`,
      { cause: error },
    )
  }
}

function sameOptionalIdentity(
  recorded: SpawnedEvent['identity'],
  requested: SpawnedEvent['identity'],
): boolean {
  if (recorded === undefined || requested === undefined) return recorded === requested
  return contentAddress(recorded) === contentAddress(requested)
}

/** Validate caller-supplied root identity before any journal access. Fresh runs may omit identity,
 * but once supplied it is trusted durable evidence and therefore must be complete and canonical;
 * resumed runs always require it so the prior root can be matched exactly. */
function assertRootIdentity(opts: SupervisorOpts): void {
  const identity = opts.rootIdentity
  if (identity === undefined) {
    if (opts.resume !== true) return
    throw new RuntimeRunStateError(
      `supervisor: resumed run '${opts.runId}' requires an exact rootIdentity with profileDigest and taskDigest`,
    )
  }
  const unknownFields = Object.keys(identity).filter(
    (key) =>
      key !== 'profileDigest' &&
      key !== 'taskDigest' &&
      key !== 'candidateDigest' &&
      key !== 'correlation',
  )
  const correlation = identity.correlation
  const validCorrelation =
    correlation === undefined ||
    (typeof correlation === 'object' &&
      correlation !== null &&
      !Array.isArray(correlation) &&
      Object.entries(correlation).every(
        ([key, value]) => key.length > 0 && typeof value === 'string' && value.length > 0,
      ))
  if (
    unknownFields.length > 0 ||
    !sha256DigestSchema.safeParse(identity.profileDigest).success ||
    !sha256DigestSchema.safeParse(identity.taskDigest).success ||
    (identity.candidateDigest !== undefined &&
      !sha256DigestSchema.safeParse(identity.candidateDigest).success) ||
    !validCorrelation
  ) {
    throw new RuntimeRunStateError(
      `supervisor: run '${opts.runId}' requires an exact rootIdentity with valid profileDigest, taskDigest, candidateDigest, and correlation`,
    )
  }
}

function rootDeadline(root: SpawnedEvent): number {
  const startedAt = Date.parse(root.at)
  if (!Number.isFinite(startedAt)) {
    throw new RuntimeRunStateError(
      `supervisor: root event for '${root.id}' has an invalid timestamp '${root.at}'`,
    )
  }
  return startedAt + (root.budget.deadlineMs ?? 0)
}

/** Child reservations whose spawn was durable but whose terminal record never landed. */
function uncertainSpawnBudgets(events: SpawnEvent[]): Budget[] {
  const terminal = new Set(
    events
      .filter(
        (event) => event.kind === 'settled' || event.kind === 'cancelled' || event.kind === 'woken',
      )
      .map((event) => event.id),
  )
  return events
    .filter(
      (event): event is SpawnedEvent =>
        event.kind === 'spawned' && event.parent !== undefined && !terminal.has(event.id),
    )
    .map((event) => event.budget)
}

/** Highest `seq` among events matching `pred`, or `-1` when none match (so a resumed scope's
 *  first new ordinal/seq is 0 — the same start a fresh scope uses). */
function maxSeqOf(events: SpawnEvent[], pred: (ev: SpawnEvent) => boolean): number {
  let max = -1
  for (const ev of events) if (pred(ev) && ev.seq > max) max = ev.seq
  return max
}

/** The default runtime recursion-depth ceiling, paired with the conserved pool so a
 *  runaway recursion hits budget-exhaustion first and depth-exceeded second (R3). */
const defaultMaxDepth = 4

/** A no-winner reason the supervisor can prove from its OWN lifecycle state — pinned to
 *  the frozen `SupervisedResult` reason union. A driver rejecting for a domain reason
 *  (not budget/abort) is classed `all-children-down`, the only typed bucket for "the tree
 *  produced no usable result". */
type NoWinnerReason = (SupervisedResult<unknown> & { kind: 'no-winner' })['reason']

/** Create a supervisor that owns one recursive agent execution tree. */
export function createSupervisor<Task, Out>(): Supervisor<Task, Out> {
  let attached: RootControl | undefined

  async function run(
    root: Agent<Task, Out>,
    task: Task,
    opts: SupervisorOpts,
  ): Promise<SupervisedResult<Out>> {
    // Read every caller-owned field once, then detach and freeze all decision data together before
    // the first await. Stateful runtime collaborators stay live by reference, but replacing a field
    // on the caller's opts object after intake cannot redirect this run.
    const {
      budget,
      rootIdentity,
      rootMaterialization,
      runId,
      journal: journalStore,
      blobs: blobStore,
      executors: executorRegistry,
      probes,
      maxDepth,
      maxLiveWorkers,
      maxRestarts,
      withinMs,
      resume,
      now: suppliedNow,
      signal,
      hooks,
    } = opts
    const input = detachedSnapshot(
      {
        task,
        options: {
          budget,
          runId,
          ...(rootIdentity === undefined ? {} : { rootIdentity }),
          ...(rootMaterialization === undefined ? {} : { rootMaterialization }),
          ...(maxDepth === undefined ? {} : { maxDepth }),
          ...(maxLiveWorkers === undefined ? {} : { maxLiveWorkers }),
          ...(maxRestarts === undefined ? {} : { maxRestarts }),
          ...(withinMs === undefined ? {} : { withinMs }),
          ...(resume === undefined ? {} : { resume }),
        },
      },
      'supervisor.run',
    )
    opts = Object.freeze({
      ...input.options,
      journal: journalStore,
      blobs: blobStore,
      executors: executorRegistry,
      ...(probes === undefined ? {} : { probes }),
      ...(suppliedNow === undefined ? {} : { now: suppliedNow }),
      ...(signal === undefined ? {} : { signal }),
      ...(hooks === undefined ? {} : { hooks }),
    })
    task = input.task
    const rootAct = root.act.bind(root)
    const rootDeliver = root.deliver?.bind(root)
    const now = opts.now ?? Date.now
    assertRootIdentity(opts)
    // Reserve the attached control synchronously, before the first journal read or write. A handle
    // is one live route, so two concurrent runs may never race to overwrite that route and later
    // detach each other. The lease is released on every early failure as well as normal teardown.
    const rootLease = attached?.acquire()
    try {
      const rootAttemptId = newExecutionAttemptId(opts.runId)
      // One instant owns both the fresh pool's absolute deadline and its durable root records. Capture
      // it before any asynchronous journal work so a slow begin cannot extend the run on restart.
      const runStartedAtMs = now()
      const runStartedAt = new Date(runStartedAtMs).toISOString()

      // RESUME-FIRST (opt-in via `opts.resume`): read any prior journal tree for this runId BEFORE
      // beginning a fresh one. A non-empty tree means a prior run for this runId already committed
      // work (it crashed mid-flight, or this is an explicit resume), so rehydrate it instead of
      // starting over. An empty/absent tree — and every run that did NOT opt in — takes the fresh
      // path unchanged. This wires the already-built+tested resume primitives
      // (`replaySpawnTree`/`materializeTreeView`); the journal/blob store decide durability.
      const existing = await opts.journal.loadTree(opts.runId)
      if (opts.resume !== true && existing !== undefined) {
        throw new RuntimeRunStateError(
          `supervisor: runId '${opts.runId}' already exists; pass resume: true to continue it or use a new runId`,
        )
      }
      const prior = opts.resume === true ? existing : undefined
      const resuming = prior !== undefined && prior.length > 0
      let resumeFrom: ResumeFrom | undefined
      let pool: BudgetPool
      if (resuming) {
        const rootEvent = assertResumeContract(prior, opts)
        const measured = sumMeasuredSpendFromEvents(prior)
        const uncertainReservations = uncertainSpawnBudgets(prior)
        pool = createBudgetPool(opts.budget, now, {
          committed: addSpend(measured.childWork, measured.driverInference),
          uncertainReservations,
          ...(rootEvent.budget.deadlineMs !== undefined
            ? { absoluteDeadlineMs: rootDeadline(rootEvent) }
            : {}),
        })
        // Rehydrate the committed work: the cursor-ordered `Settled[]` (from the blob store) plus the
        // tree as it stood at the recorded cursor position. The new scope's ordinal/cursor counters
        // continue past the recorded maxima so a fresh spawn never reuses a journaled `seq`.
        const settled = await replaySpawnTree(opts.journal, opts.blobs, opts.runId)
        const view = materializeTreeView(prior)
        resumeFrom = {
          settled,
          view,
          maxSpawnOrdinal: maxSeqOf(prior, (ev) => ev.kind === 'spawned'),
          maxCursorSeq: maxSeqOf(
            prior,
            (ev) => ev.kind === 'settled' || ev.kind === 'cancelled' || ev.kind === 'woken',
          ),
          maxWaitOrdinal: maxSeqOf(prior, (ev) => ev.kind === 'waiting'),
          // Waits armed but never woken: the run died mid-wait. They ride onto `Scope.resume.waits`,
          // and re-arming the same label adopts the ORIGINAL absolute deadline rather than
          // restarting the countdown from this process's clock.
          waits: pendingWaits(prior),
          // Keyed assignments + prior committed spend ride onto `Scope.resume`, so a resume-aware
          // driver resolves keys instead of re-spawning and reports what the run already paid.
          keys: keyedAssignments(prior, settled),
          priorSpend: sumSpendFromEvents(prior),
        }
      } else {
        pool = createBudgetPool(opts.budget, now, {
          ...(opts.budget.deadlineMs !== undefined
            ? { absoluteDeadlineMs: runStartedAtMs + opts.budget.deadlineMs }
            : {}),
        })
        // Fresh run: begin the tree and journal the root as its own `spawned` node (parent-less, the
        // spawn-ordinal-0 marker), so a journal-based reader — `trajectoryReport`, `replaySpawnTree`,
        // `materializeTreeView` — can reconstruct the WHOLE realized tree from a real run, not only
        // hand-built journals. The root is never `scope.spawn`ed (the supervisor runs `act` directly),
        // so without this the root node is absent and `trajectoryReport` fails its `nodes.has(root)`
        // invariant. The uniqueness guard skips `spawned` events (only the cursor namespace must be
        // unique), so sharing ordinal 0 with the first child's spawn is not a collision; replay ignores
        // `spawned` events for settlement reconstruction, so the replayed `Settled[]` is unchanged.
        await opts.journal.beginTree(opts.runId, runStartedAt)
        const rootReceipt = rootMaterializationReceipt(opts)
        const rootRuntime = opts.rootMaterialization?.runtime ?? 'inline'
        await opts.journal.appendEvent(opts.runId, {
          kind: 'spawned',
          id: opts.runId,
          label: 'root',
          budget: opts.budget,
          runtime: rootRuntime,
          ...(opts.rootIdentity ? { identity: opts.rootIdentity } : {}),
          seq: 0,
          at: runStartedAt,
        })
        if (rootReceipt !== undefined) {
          await opts.journal.appendEvent(opts.runId, {
            kind: 'materialized',
            id: opts.runId,
            receipt: rootReceipt,
            seq: 0,
            at: runStartedAt,
          })
        }
      }

      const stableRootReceipt = resuming
        ? prior?.find(
            (event): event is Extract<SpawnEvent, { kind: 'materialized' }> =>
              event.kind === 'materialized' && event.id === opts.runId,
          )?.receipt
        : rootMaterializationReceipt(opts)
      if (stableRootReceipt !== undefined) {
        const rootBinding = rootExecutionBindingReceipt(opts, stableRootReceipt, rootAttemptId)
        if (rootBinding !== undefined) {
          await opts.journal.appendEvent(opts.runId, {
            kind: 'execution-bound',
            id: opts.runId,
            binding: rootBinding,
            seq: 0,
            at: runStartedAt,
          })
        }
      }

      // ONE internal controller is the root scope's abort source. Every cascade path
      // (caller signal, RootHandle.abort, breaker trip, deadline) aborts it; the scope
      // fans it out to each live child's executor (acquire-aware reap included).
      const controller = new AbortController()
      const cascadeAbort = (reason?: string): boolean => {
        if (controller.signal.aborted) return false
        // Carry the reason on the signal so it chains down to each child's abort signal
        // (`childAbort.signal.reason`) — the diagnostic the scope's executors observe.
        controller.abort(reason)
        return true
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
      const priorRootMaterialization = prior?.find(
        (event): event is Extract<SpawnEvent, { kind: 'materialized' }> =>
          event.kind === 'materialized' && event.id === opts.runId,
      )?.receipt

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
        ...(opts.maxLiveWorkers !== undefined ? { maxLiveWorkers: opts.maxLiveWorkers } : {}),
        signal: controller.signal,
        now,
        hooks: opts.hooks,
        ...(opts.rootMaterialization?.declaration === 'deferred'
          ? {
              ownerMaterialization: {
                runtime: opts.rootMaterialization.runtime,
                authoredProfile: opts.rootMaterialization.authoredProfile,
                ...(opts.rootIdentity === undefined ? {} : { identity: opts.rootIdentity }),
                attemptId: rootAttemptId,
                requiredKnown: true,
                ...(priorRootMaterialization === undefined
                  ? {}
                  : { prior: priorRootMaterialization }),
              },
            }
          : {}),
        ...(opts.probes ? { probes: opts.probes } : {}),
        ...(resumeFrom ? { resumeFrom } : {}),
      })

      // `view`/drain read the scope opaquely (`Out` erased) — the supervisor never `spawn`s
      // on it, so the live-tree readout and the join barrier are `Out`-agnostic.
      const openScope = scope as unknown as Scope<unknown>

      // Bind any attached RootHandle to THIS live run so view()/signal()/abort() reach the
      // live scope + the one cascade controller. Detached again in the finally barrier.
      if (rootLease) {
        rootLease.bind({
          scope: openScope,
          cascadeAbort,
          signal: pushRootSignal(cascadeAbort),
          deliver: rootDeliver ? (message) => rootDeliver(message) !== false : () => false,
        })
      }

      let deadlineExceeded = false
      const rootDeadlineAtMs = pool.readout().deadlineMs
      if (rootDeadlineAtMs > 0 && now() >= rootDeadlineAtMs) {
        deadlineExceeded = cascadeAbort('root budget deadline exceeded')
      }
      const clearRootDeadline =
        opts.budget.deadlineMs === undefined
          ? undefined
          : armDeadlineTimer(Math.max(0, rootDeadlineAtMs - now()), () => {
              deadlineExceeded = cascadeAbort('root budget deadline exceeded')
            })
      let actOutcome: { ok: true; out: Out } | { ok: false; error: unknown } = {
        ok: false,
        error: new RuntimeRunStateError('supervisor: root execution did not start'),
      }
      let executionAborted = controller.signal.aborted
      try {
        const out = await runAbortable(() => rootAct(task, scope), controller.signal)
        actOutcome = { ok: true, out }
      } catch (error) {
        // act()'s rejection is the PRIMARY error; capture it before the join barrier so a
        // teardown failure in the barrier can never overwrite it (firstError precedence).
        actOutcome = { ok: false, error }
      } finally {
        executionAborted = controller.signal.aborted
        // A child inherits the root cutoff and can settle the root act on that exact timer turn.
        // If its settlement callback runs before the root timer callback, the finally block clears
        // the still-pending root timer. Preserve the deadline cause from the shared absolute clock;
        // do not overwrite a caller/breaker abort that already won the controller race.
        if (!controller.signal.aborted && rootDeadlineAtMs > 0 && now() >= rootDeadlineAtMs) {
          deadlineExceeded = true
        }
        clearRootDeadline?.()
        // Join barrier: tear down every still-live child. Generalizes the kernel's
        // `finally{ Promise.allSettled(destroy) }` — a teardown throw is allSettled'd and
        // journaled, never re-thrown.
        try {
          await drainLiveChildren(openScope, controller)
        } catch (error) {
          if (actOutcome?.ok !== false) actOutcome = { ok: false, error }
        }
        try {
          await finalizeScopeOwnerMaterialization(openScope)
        } catch (error) {
          if (actOutcome?.ok !== false) actOutcome = { ok: false, error }
        }
        if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort)
        rootLease?.release()
      }

      // The run's tree, not this process's: on a resumed run the prior process's committed nodes are
      // carried in, so `tree` covers the same work `spentTotal` bills for. Identical to `scope.view`
      // on every run that did not resume.
      const tree = runTree(scope)
      // Success and failure both pass the same conservation check. A child promise is never allowed
      // to disappear behind a swallowed cleanup error and leave a reservation open.
      pool.assertNoOpenTickets()
      if (actOutcome.ok) {
        if (executionAborted) return noWinner()
        // Every child has settled (join barrier above); no reservation may remain. A leaked ticket
        // would silently corrupt the conserved spend total, so fail loud here — on the success path
        // only, where the act() error precedence does not apply.
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
          reason: classifyNoWinner(controller, pool, opts, breaker, deadlineExceeded, tree),
          tree,
          downCount: breaker.downCount(),
          spentTotal: addSpend(childWork, driverInference),
        }
      }
    } finally {
      rootLease?.release()
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
  readonly deliver: (msg: unknown) => boolean
}

/** The supervisor-private control behind a `RootHandle`. `createRootHandle` mints it and
 *  registers it in `rootControls`; `attach` looks it up and `bind`s it to the live run. */
interface RootLease {
  bind(binding: RunBinding): void
  release(): void
}

interface RootControl {
  acquire(): RootLease
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
export function createRootHandle<Out>(): SteerableRootHandle<Out> {
  let binding: RunBinding | undefined
  let activeLease: symbol | undefined
  const handle: SteerableRootHandle<Out> = {
    view(): TreeView {
      if (!binding) {
        throw new RuntimeRunStateError(
          'RootHandle.view: handle is not bound to a live run (attach it before run, read after run starts)',
        )
      }
      return binding.scope.view
    },
    deliver(msg: unknown): boolean {
      if (!binding) {
        throw new RuntimeRunStateError('RootHandle.deliver: handle is not bound to a live run')
      }
      return binding.deliver(msg)
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
    acquire(): RootLease {
      if (activeLease !== undefined) {
        throw new RuntimeRunStateError(
          'RootHandle: handle already controls a live run; use one handle per concurrent run',
        )
      }
      const token = Symbol('root-handle-lease')
      activeLease = token
      let released = false
      return {
        bind(next: RunBinding): void {
          if (released || activeLease !== token) {
            throw new RuntimeRunStateError('RootHandle: live-run lease is no longer active')
          }
          if (binding !== undefined) {
            throw new RuntimeRunStateError('RootHandle: live-run lease is already bound')
          }
          binding = next
        },
        release(): void {
          if (released) return
          released = true
          if (activeLease !== token) return
          binding = undefined
          activeLease = undefined
        },
      }
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
  // Armed wait-states count here even though they are deliberately excluded from `inFlight`: a
  // wait holds no executor, but it DOES hold a live timer, so a run that returns without
  // cancelling one would leave the process pinned to a deadline nobody is reading anymore.
  const view = scope.view
  const hasLive = view.inFlight > 0 || view.waiting > 0
  if (!hasLive) {
    if (scope.workerCapacity.live > 0) {
      throw new RuntimeRunStateError(
        `supervisor: cleanup ended with ${scope.workerCapacity.live} executor resource(s) not confirmed destroyed`,
      )
    }
    return
  }
  // Cascade the abort into every live child's executor before draining.
  if (!controller.signal.aborted) controller.abort()
  await drainCursor(scope)
  const after = scope.view
  if (after.inFlight > 0 || after.waiting > 0 || scope.workerCapacity.live > 0) {
    throw new RuntimeRunStateError(
      `supervisor: cleanup ended with ${after.inFlight} running, ${after.waiting} waiting, and ${scope.workerCapacity.live} executor resource(s) not confirmed destroyed`,
    )
  }
}

async function drainCursor(scope: Scope<unknown>): Promise<void> {
  for (;;) {
    const settled = await scope.next()
    if (settled === null) return
  }
}

/** Race root policy execution against the same signal that stops every child. The losing promise
 * remains observed, so a late rejection cannot surface as an unhandled process error. */
async function runAbortable<T>(act: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw supervisorAbortError(signal)
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      queueMicrotask(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(supervisorAbortError(signal))
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

function supervisorAbortError(signal: AbortSignal): Error {
  const reason = signal.reason
  const error = new Error(
    typeof reason === 'string' && reason.length > 0 ? reason : 'supervisor aborted',
  )
  error.name = 'AbortError'
  return error
}

function classifyNoWinner(
  controller: AbortController,
  pool: BudgetPool,
  opts: SupervisorOpts,
  breaker: IntensityBreaker,
  deadlineExceeded: boolean,
  tree: TreeView,
): NoWinnerReason {
  // A tripped breaker is the most specific cause (children kept dying), so it outranks
  // the abort it raised. A deadline that won the abort race remains budget exhaustion;
  // then come caller/handle abort and other exhausted pool channels. The residual bucket is
  // "ran to completion under budget but produced nothing usable".
  if (breaker.tripped()) return 'all-children-down'
  if (deadlineExceeded) return 'budget-exhausted'
  if (controller.signal.aborted) return 'aborted'
  // Unknown terminal usage correctly seals the remaining pool, but that accounting consequence is
  // not the cause of a run where every child failed. Preserve the lifecycle outcome before asking
  // whether any budget channel is now unavailable. A real admission failure with no failed child
  // still classifies as budget exhaustion below.
  if (allSpawnedChildrenDown(tree)) return 'all-children-down'
  if (poolExhausted(pool, opts)) return 'budget-exhausted'
  return 'all-children-down'
}

function allSpawnedChildrenDown(tree: TreeView): boolean {
  const children = tree.nodes.filter((node) => node.id !== tree.root)
  return children.length > 0 && children.every((node) => node.status === 'failed')
}

function poolExhausted(pool: BudgetPool, opts: SupervisorOpts): boolean {
  const r = pool.readout()
  if (r.iterationsLeft <= 0) return true
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
  return sumSpendFromEvents(events)
}

/** Per-channel sum over a journaled event list: `settled` = spawned-child work (reconciled);
 *  `metered` = driver inference (re-homed up the tree, so a single root-tree pass already
 *  includes every nested driver's inference). */
function sumSpendFromEvents(events: SpawnEvent[]): { childWork: Spend; driverInference: Spend } {
  const totals = sumMeasuredSpendFromEvents(events)
  const rootBudget = events.find(
    (event): event is SpawnedEvent => event.kind === 'spawned' && event.parent === undefined,
  )?.budget
  let remainingRootUsd = Math.max(
    0,
    (rootBudget?.maxUsd ?? 0) - totals.childWork.usd - totals.driverInference.usd,
  )
  for (const budget of uncertainSpawnBudgets(events)) {
    totals.childWork.iterations += budget.maxIterations
    // The numeric value is the charged upper bound, not a fabricated measurement. The false flag
    // makes that distinction machine-readable in every report.
    totals.childWork.tokens.input += budget.maxTokens
    totals.childWork.tokensKnown = false
    const usdCharge = budget.maxUsd ?? (rootBudget?.maxUsd !== undefined ? remainingRootUsd : 0)
    totals.childWork.usd += usdCharge
    totals.childWork.usdKnown = false
    remainingRootUsd = Math.max(0, remainingRootUsd - usdCharge)
  }
  return totals
}

function sumMeasuredSpendFromEvents(events: SpawnEvent[]): {
  childWork: Spend
  driverInference: Spend
} {
  const childWork: Spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
  const driverInference: Spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
  for (const ev of events) {
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
  if (b.tokensKnown === false) a.tokensKnown = false
  a.usd += b.usd
  if (b.usdKnown === false) a.usdKnown = false
  a.ms += b.ms
}

/** Sum two conserved-spend tallies per channel — the child-work journal sum + the drivers' own
 *  metered inference, so `spentTotal` is the true cost of the run. */
function addSpend(a: Spend, b: Spend): Spend {
  return {
    iterations: a.iterations + b.iterations,
    tokens: { input: a.tokens.input + b.tokens.input, output: a.tokens.output + b.tokens.output },
    ...(a.tokensKnown === false || b.tokensKnown === false ? { tokensKnown: false } : {}),
    usd: a.usd + b.usd,
    ...(a.usdKnown === false || b.usdKnown === false ? { usdKnown: false } : {}),
    ms: a.ms + b.ms,
  }
}

/** True when any driver metered inference this run (so the winner carries a `spentBreakdown`).
 *  Checks every channel `addSpend` sums — including `ms` — so the gate stays consistent with the
 *  total even though the coordination driver currently stamps `ms: 0`. */
function isNonEmptySpend(s: Spend): boolean {
  return (
    s.iterations > 0 ||
    s.tokens.input > 0 ||
    s.tokens.output > 0 ||
    s.tokensKnown === false ||
    s.usd > 0 ||
    s.ms > 0
  )
}
