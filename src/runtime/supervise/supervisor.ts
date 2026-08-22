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
 *    whole sub-tree. A teardown failure is `allSettled`'d and journaled per node as a
 *    `teardown-unconfirmed` event; it NEVER masks act()'s own outcome. act()'s rejection is the
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
 * @stable
 */

import { sha256DigestSchema } from '@tangle-network/agent-interface'
import {
  aggregateProviderModelEvidence,
  closesCursorSlot,
  contentAddress,
  loadSpawnForest,
  materializeTreeView,
  pendingWaits,
  replaySpawnTree,
} from '../../durable/spawn-journal'
import { RuntimeRunStateError } from '../../errors'
import { addSpend, zeroSpend } from '../util'
import { runAbortable } from './abortable'
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
  NodeId,
  NoWinnerError,
  ProfileMaterializationReceipt,
  ResumedKeyState,
  RootHandle,
  RootSignal,
  Scope,
  Settled,
  SpawnEvent,
  SpawnJournal,
  Spend,
  SpendChannel,
  SpendGap,
  SteerableRootHandle,
  SupervisedResult,
  Supervisor,
  SupervisorOpts,
  TreeView,
  UnconfirmedTeardown,
} from './types'
import type { PendingWait } from './wait'

/** The driver-rejection shape a `reason: 'driver-failed'` result carries. Re-exported from the
 *  module that produces it so a consumer catching a driver failure names the type instead of
 *  retyping `{ name; message; stack? }`. Declared in `./types` beside the result it rides on. */
export type { NoWinnerError } from './types'

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
      `supervisor: resume identity mismatch for run '${opts.runId}'; ${describeIdentityMismatch(recorded.identity, opts.rootIdentity)}`,
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

/**
 * Name the identity fields that actually differ, with both values.
 *
 * The identity is compared as one content address, so a mismatch is a single boolean and the
 * message could only list every field that MIGHT have caused it. A caller then has to diff four
 * digests by hand to learn which one moved, and the common cause — a task file regenerated with
 * one character different — is indistinguishable from a genuinely different profile.
 *
 * Digests are truncated because the prefix identifies them and the full 64 characters push the
 * real content off the end of a terminal line.
 */
function describeIdentityMismatch(
  recorded: SpawnedEvent['identity'],
  requested: SpawnedEvent['identity'],
): string {
  if (recorded === undefined)
    return 'the recorded root carried no identity but this resume supplies one'
  if (requested === undefined)
    return 'the recorded root carried an identity but this resume supplies none'
  const short = (value: unknown): string => {
    if (value === undefined) return '(absent)'
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > 20 ? `${text.slice(0, 20)}…` : text
  }
  const differing = (['profileDigest', 'taskDigest', 'candidateDigest', 'correlation'] as const)
    .filter((field) => contentAddress(recorded[field]) !== contentAddress(requested[field]))
    .map(
      (field) =>
        `${field} recorded ${short(recorded[field])} but resumed with ${short(requested[field])}`,
    )
  // A differing content address with no differing field means the shape itself changed (an extra
  // key, a different key order the address is sensitive to). Say that rather than nothing.
  if (differing.length === 0)
    return 'the identity objects differ in shape while every known field matches'
  return `${differing.join('; ')} — use a new runId to change any of these`
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

/** The instant the run's root was journaled — the anchor for both the absolute deadline and the
 *  terminal wall-clock `ms`, so a resumed run measures from its ORIGINAL start, not this
 *  process's. */
function rootStartedAtMs(root: SpawnedEvent): number {
  const startedAt = Date.parse(root.at)
  if (!Number.isFinite(startedAt)) {
    throw new RuntimeRunStateError(
      `supervisor: root event for '${root.id}' has an invalid timestamp '${root.at}'`,
    )
  }
  return startedAt
}

/** Child reservations whose spawn was durable but whose terminal record never landed. */
export function uncertainSpawnBudgets(events: SpawnEvent[]): Budget[] {
  const terminal = new Set(events.filter(closesCursorSlot).map((event) => event.id))
  return events
    .filter(
      (event): event is SpawnedEvent =>
        event.kind === 'spawned' && event.parent !== undefined && !terminal.has(event.id),
    )
    .map((event) => event.budget)
}

/** Highest `seq` among events matching `pred`, or `-1` when none match (so a resumed scope's
 *  first new ordinal/seq is 0 — the same start a fresh scope uses). */
export function maxSeqOf(events: SpawnEvent[], pred: (ev: SpawnEvent) => boolean): number {
  let max = -1
  for (const ev of events) if (pred(ev) && ev.seq > max) max = ev.seq
  return max
}

/** The default runtime recursion-depth ceiling, paired with the conserved pool so a
 *  runaway recursion hits budget-exhaustion first and depth-exceeded second (R3). */
const defaultMaxDepth = 4

/** Every no-winner reason, pinned to the published `SupervisedResult` union so the contract
 *  and the impl cannot drift. */
type NoWinnerReason = (SupervisedResult<unknown> & { kind: 'no-winner' })['reason']

/** The reasons the supervisor can prove from its OWN lifecycle state — everything except the
 *  driver's rejection, which no lifecycle observation can establish. */
type LifecycleNoWinnerReason = Exclude<NoWinnerReason, 'driver-failed'>

/** A captured `act()` rejection. Wrapped rather than passed bare so `throw undefined` — legal, and
 *  exactly the kind of authoring bug this field exists to surface — is still distinguishable from
 *  "the driver never threw". */
interface DriverRejection {
  readonly error: unknown
}

/**
 * Normalize an arbitrary rejection into the serializable triple the result carries. A driver may
 * reject with anything (a string, a plain object, a null-prototype value), and the whole point of
 * this field is that the failure survives, so every branch produces a message instead of throwing:
 * a stringification that itself throws (circular, hostile `toString`) falls back to the tag.
 */
function describeRejection(error: unknown): NoWinnerError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack !== undefined ? { stack: error.stack } : {}),
    }
  }
  let message: string
  try {
    message = typeof error === 'string' ? error : (JSON.stringify(error) ?? String(error))
  } catch {
    message = Object.prototype.toString.call(error)
  }
  return { name: 'NonError', message }
}

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
      childSettleGraceMs,
      resume,
      now: suppliedNow,
      signal,
      hooks,
      workerTrace,
      workerTraceUnpropagated,
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
          ...(childSettleGraceMs === undefined ? {} : { childSettleGraceMs }),
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
      ...(workerTrace === undefined ? {} : { workerTrace }),
      ...(workerTraceUnpropagated === undefined ? {} : { workerTraceUnpropagated }),
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
      // The instant terminal wall-clock `ms` measures from. A resumed run anchors to the ORIGINAL
      // root instant (the same anchor the absolute deadline uses), so its duration spans processes.
      let runEpochMs = runStartedAtMs
      if (resuming) {
        const rootEvent = assertResumeContract(prior, opts)
        runEpochMs = rootStartedAtMs(rootEvent)
        const measured = sumMeasuredSpendFromEvents(prior)
        const uncertainReservations = uncertainSpawnBudgets(prior)
        pool = createBudgetPool(opts.budget, runEpochMs, {
          committed: addSpend(measured.childWork, measured.driverInference),
          uncertainReservations,
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
          maxCursorSeq: maxSeqOf(prior, closesCursorSlot),
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
        pool = createBudgetPool(opts.budget, runStartedAtMs)
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
                attemptId: rootAttemptId,
                requiredKnown: true,
                ...(priorRootMaterialization === undefined
                  ? {}
                  : { prior: priorRootMaterialization }),
              },
            }
          : {}),
        ...(opts.probes ? { probes: opts.probes } : {}),
        ...(opts.workerTrace ? { workerTrace: opts.workerTrace } : {}),
        ...(opts.workerTraceUnpropagated
          ? { workerTraceUnpropagated: opts.workerTraceUnpropagated }
          : {}),
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
      // Settled children whose executor teardown was never acknowledged, read at the join
      // barrier. Surfaced on every result arm so the leak is loud without voiding the run.
      let teardownUnconfirmed: ReadonlyArray<UnconfirmedTeardown> = []
      // `teardown-unconfirmed` records live outside the cursor namespace, like `metered`/`edge`.
      let teardownSeq = 0
      let executionAborted = controller.signal.aborted
      // Whether every spawned child was ALREADY down when root execution settled. Read at settle,
      // never after the join barrier: the barrier's own teardown turns healthy live children into
      // `down` nodes, and reading it afterwards reported a crashed driver's run as
      // `all-children-down` — the tree's state caused by the cleanup, not the cause of the failure.
      let allChildrenDownAtSettle = false
      // Same reasoning for the breaker's tally: children the barrier kills are `down` settlements
      // too, so the count read after cleanup can never distinguish "children failed" from "we
      // stopped them because the driver died".
      let downCountAtSettle = 0
      try {
        const out = await runAbortable(
          () => rootAct(task, scope),
          controller.signal,
          'supervisor aborted',
        )
        actOutcome = { ok: true, out }
      } catch (error) {
        // act()'s rejection is the PRIMARY error; capture it before the join barrier so a
        // teardown failure in the barrier can never overwrite it (firstError precedence).
        actOutcome = { ok: false, error }
      } finally {
        executionAborted = controller.signal.aborted
        allChildrenDownAtSettle = allSpawnedChildrenDown(runTree(openScope))
        downCountAtSettle = breaker.downCount()
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
        //
        // #741: a root driver that DIED did not make its children unhealthy. When the run was not
        // cancelled and the driver failed, `childSettleGraceMs` lets live children reach their own
        // terminal state (and write what they hold) before the cascade takes them. Bounded by the
        // run's own deadline, because nothing may outlive that.
        const settleGraceMs =
          actOutcome.ok === false && !controller.signal.aborted
            ? boundedSettleGrace(opts.childSettleGraceMs, rootDeadlineAtMs, now)
            : 0
        try {
          teardownUnconfirmed = await drainLiveChildren(openScope, controller, settleGraceMs)
          // The leak is real and must surface, so it is journaled per node — durable evidence a
          // fleet autopsy reads without the run's outcome being voided by cleanup bookkeeping.
          for (const node of teardownUnconfirmed) {
            await opts.journal.appendEvent(opts.runId, {
              kind: 'teardown-unconfirmed',
              id: node.id,
              label: node.label,
              runtime: node.runtime,
              status: node.status,
              seq: teardownSeq++,
              at: new Date(now()).toISOString(),
            })
          }
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
          const { spentTotal, childWork, driverInference, gaps, providerModel } =
            await terminalAccounting(journal, opts.runId, now() - runEpochMs)
          return {
            kind: 'winner',
            out,
            outRef,
            tree,
            spentTotal,
            providerModel,
            ...(teardownUnconfirmed.length > 0 ? { teardownUnconfirmed } : {}),
            ...(gaps.length > 0 ? { spendGaps: gaps } : {}),
            ...(isNonEmptySpend(driverInference)
              ? { spentBreakdown: { driverInference, childWork } }
              : {}),
          }
        }
        return noWinner()
      }

      // act() rejected. The reason is proven from lifecycle state first, in precedence order:
      // a tripped breaker outranks any abort (it is the most specific cause) outranks
      // budget-exhaustion outranks a real `down` child. Only when NONE of those hold does the
      // rejection itself become the reason — `driver-failed`, the one arm that carries `error`.
      // A no-winner is TYPED — never a best-effort coercion of a partial child (M2).
      return noWinner({ error: actOutcome.error })

      // A no-winner still incurred real conserved spend before failing, so it carries `spentTotal`
      // summed off the SAME journal the winner path reads — the caller always learns the cost.
      async function noWinner(rejection?: DriverRejection): Promise<SupervisedResult<Out>> {
        const { spentTotal, gaps, providerModel } = await terminalAccounting(
          journal,
          opts.runId,
          now() - runEpochMs,
        )
        const common = {
          kind: 'no-winner' as const,
          tree,
          downCount: breaker.downCount(),
          spentTotal,
          providerModel,
          ...(teardownUnconfirmed.length > 0 ? { teardownUnconfirmed } : {}),
          ...(gaps.length > 0 ? { spendGaps: gaps } : {}),
        }
        // The lifecycle causes outrank the driver's own rejection, so they are asked first and a
        // proven one ends it. `undefined` means the supervisor's own state explains nothing.
        const lifecycle = classifyNoWinner(
          executionAborted,
          pool,
          opts,
          breaker,
          deadlineExceeded,
          allChildrenDownAtSettle,
          downCountAtSettle,
        )
        if (lifecycle !== undefined) return { ...common, reason: lifecycle }
        // No lifecycle cause AND the driver threw ⇒ the driver itself is the fault. `error` is
        // REQUIRED on this arm, and it is present by construction: this is the only branch that
        // produces `driver-failed`, and it is unreachable unless a rejection was captured.
        if (rejection !== undefined) {
          return { ...common, reason: 'driver-failed', error: describeRejection(rejection.error) }
        }
        // The residual bucket: ran to completion under budget and selected nothing usable.
        return { ...common, reason: 'all-children-down' }
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
  settleGraceMs = 0,
): Promise<ReadonlyArray<UnconfirmedTeardown>> {
  // Armed wait-states count here even though they are deliberately excluded from `inFlight`: a
  // wait holds no executor, but it DOES hold a live timer, so a run that returns without
  // cancelling one would leave the process pinned to a deadline nobody is reading anymore.
  const view = scope.view
  const hasLive = view.inFlight > 0 || view.waiting > 0
  if (!hasLive) return unconfirmedTeardowns(scope)
  // Cascade the abort into every live child's executor before draining — unless the caller granted
  // a settle grace, in which case the timer owns the cascade and the drain reads whatever the
  // children finish in the meantime. Exactly ONE cursor reader either way: the grace never races
  // `next()`, it only decides when the abort lands.
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  if (settleGraceMs > 0 && !controller.signal.aborted) {
    graceTimer = setTimeout(
      () => controller.abort('root driver failed; child settle grace expired'),
      settleGraceMs,
    )
    graceTimer.unref?.()
  } else if (!controller.signal.aborted) {
    // Same event as the grace-timer branch above, so it carries the same named reason: one
    // path stating why and the other going silent is what put identical deaths in two
    // different diagnostic buckets.
    controller.abort('root driver failed; no child settle grace configured')
  }
  try {
    await drainCursor(scope)
  } finally {
    if (graceTimer !== undefined) clearTimeout(graceTimer)
  }
  const after = scope.view
  if (after.inFlight > 0 || after.waiting > 0) {
    throw new RuntimeRunStateError(
      `supervisor: cleanup ended with ${after.inFlight} running, ${after.waiting} waiting, and ` +
        describeUnconfirmed(scope),
    )
  }
  return unconfirmedTeardowns(scope)
}

/**
 * The settled children whose executor teardown was never acknowledged.
 *
 * They still hold their capacity slot — the ledger stays poisoned, so replacement work can never
 * exceed the physical live count — but every one of them has already reached a terminal state and
 * journaled its work. That is evidence about an EXECUTOR, not a cause of run failure, so the
 * barrier NAMES them and lets the run reach its real terminal state. Live work after the drain is
 * a different fault and still fails loud.
 */
function unconfirmedTeardowns(scope: Scope<unknown>): ReadonlyArray<UnconfirmedTeardown> {
  return scope.workerCapacity.unconfirmed
}

/** The unconfirmed set as one error clause: the count plus the node ids behind it. One integer is
 *  not actionable after a six-hour run. */
function describeUnconfirmed(scope: Scope<unknown>): string {
  const unconfirmed = scope.workerCapacity.unconfirmed
  const named = unconfirmed
    .map((node) => `${node.id} (${node.label}, ${node.runtime}, ${node.status})`)
    .join(', ')
  return `${scope.workerCapacity.live} executor resource(s) not confirmed destroyed${
    named.length > 0 ? `: ${named}` : ''
  }`
}

/** The settle window a failed driver's children actually get: the caller's grace, never past the
 *  run's own deadline. `0` (the default) keeps the historical immediate cascade. */
function boundedSettleGrace(
  graceMs: number | undefined,
  deadlineAtMs: number,
  now: () => number,
): number {
  if (graceMs === undefined || graceMs <= 0) return 0
  if (deadlineAtMs <= 0) return graceMs
  return Math.max(0, Math.min(graceMs, deadlineAtMs - now()))
}

async function drainCursor(scope: Scope<unknown>): Promise<void> {
  for (;;) {
    const settled = await scope.next()
    if (settled === null) return
  }
}

/**
 * The lifecycle cause of a no-winner, or `undefined` when the supervisor's own state proves
 * nothing. Returning `undefined` rather than falling through to `all-children-down` is what lets
 * the caller decide between the `driver-failed` arm (a rejection was captured) and the residual
 * bucket — and it is why `driver-failed` cannot be produced without an `error` to attach.
 */
function classifyNoWinner(
  /** Whether the cascade was aborted at the moment root execution settled — NOT the controller's
   *  state now. The join barrier itself aborts the cascade to tear children down, so reading the
   *  live controller here reported every driver failure that happened to have a live child as
   *  `aborted`, hiding the real cause (#741: the run with one live child reported `aborted`, the
   *  identical failure with none reported `driver-failed`). */
  abortedAtSettle: boolean,
  pool: BudgetPool,
  opts: SupervisorOpts,
  breaker: IntensityBreaker,
  deadlineExceeded: boolean,
  /** Every spawned child was already down when root execution settled — measured BEFORE the join
   *  barrier, so the barrier's own teardown cannot manufacture this cause. */
  allChildrenDownAtSettle: boolean,
  /** `down` settlements counted at the same instant, for the same reason. */
  downCountAtSettle: number,
): LifecycleNoWinnerReason | undefined {
  // A tripped breaker is the most specific cause (children kept dying), so it outranks
  // the abort it raised. A deadline that won the abort race remains budget exhaustion;
  // then come caller/handle abort and other exhausted pool channels. Then a real `down`
  // child, which is what `all-children-down` asserts and which only `downCount > 0` can prove.
  if (breaker.tripped()) return 'all-children-down'
  if (deadlineExceeded) return 'budget-exhausted'
  if (abortedAtSettle) return 'aborted'
  // Unknown terminal usage correctly seals the remaining pool, but that accounting consequence is
  // not the cause of a run where every child failed. Preserve the lifecycle outcome before asking
  // whether any budget channel is now unavailable. A real admission failure with no failed child
  // still classifies as budget exhaustion below.
  if (allChildrenDownAtSettle) return 'all-children-down'
  if (poolExhausted(pool, opts)) return 'budget-exhausted'
  if (downCountAtSettle > 0) return 'all-children-down'
  return undefined
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
 * The run's terminal accounting, read off the one journal ledger — the honest per-channel
 * sums (input/output/usd/iterations all preserved), the named usage gaps, and the wall-clock
 * duration stamped onto `spentTotal.ms`. Computed AFTER the join barrier so every child's
 * settlement is recorded. Fails loud if the tree was never journaled (the supervisor always
 * `beginTree`s, so a missing tree is a corrupted journal, not a normal path).
 *
 * `spentTotal.ms` is `elapsedMs`, never the per-event sum: executors under-report their own
 * `ms` (most stamp 0) and parallel children overlap, so the sum cannot state the run's real
 * duration. The breakdown keeps the executor-reported sums.
 *
 * `tokensKnown`/`usdKnown` are stamped explicitly on the terminal total: `true` is a checked
 * claim (every spawn reached a terminal record AND every settled/metered record carried a
 * complete receipt on that channel), never the absence of bad news. The conjunction with the
 * summed flags is deliberately redundant — a future divergence between the sum and the gap
 * scan can only make the claim more conservative, never falsely `true`.
 */
async function terminalAccounting(
  journal: SpawnJournal,
  root: string,
  elapsedMs: number,
): Promise<{
  spentTotal: Spend
  childWork: Spend
  driverInference: Spend
  gaps: SpendGap[]
  providerModel: import('./types').ProviderModelExecutionEvidence
}> {
  const events = await journal.loadTree(root)
  if (events === undefined) {
    throw new RuntimeRunStateError(
      `supervisor: spawn tree '${root}' is missing from the journal after run (corrupted log)`,
    )
  }
  const { childWork, driverInference } = sumSpendFromEvents(events)
  const gaps = spendGapsFromEvents(events)
  const forest = await loadSpawnForest(journal, root)
  const providerModel = aggregateProviderModelEvidence(forest)
  const summed = addSpend(childWork, driverInference)
  const spentTotal: Spend = {
    ...summed,
    ms: Math.max(0, elapsedMs),
    tokensKnown:
      summed.tokensKnown !== false && !gaps.some((gap) => gap.channels.includes('tokens')),
    usdKnown: summed.usdKnown !== false && !gaps.some((gap) => gap.channels.includes('usd')),
  }
  return { spentTotal, childWork, driverInference, gaps, providerModel }
}

/** The journaled nodes whose usage accounting is incomplete — one `SpendGap` per node+kind,
 *  channels merged. A spawn with no terminal record (`settled`/`cancelled`/`woken`) is
 *  unaccounted on every channel; a settled or metered record that flags a channel unknown is
 *  a floor on that channel. The root's own spawned event is exempt: its terminal state is the
 *  result this list rides on. */
function spendGapsFromEvents(events: SpawnEvent[]): SpendGap[] {
  const labels = new Map<NodeId, string>()
  const terminal = new Set<NodeId>()
  for (const ev of events) {
    if (ev.kind === 'spawned') labels.set(ev.id, ev.label)
    else if (closesCursorSlot(ev)) terminal.add(ev.id)
  }
  const gaps = new Map<
    string,
    { id: NodeId; kind: SpendGap['kind']; channels: Set<SpendChannel> }
  >()
  const record = (
    id: NodeId,
    kind: SpendGap['kind'],
    channels: ReadonlyArray<SpendChannel>,
  ): void => {
    if (channels.length === 0) return
    const key = `${kind}:${id}`
    const existing = gaps.get(key)
    if (existing !== undefined) for (const channel of channels) existing.channels.add(channel)
    else gaps.set(key, { id, kind, channels: new Set(channels) })
  }
  for (const ev of events) {
    if (ev.kind === 'spawned' && ev.parent !== undefined && !terminal.has(ev.id)) {
      record(ev.id, 'never-settled', ['tokens', 'usd'])
    } else if (ev.kind === 'settled') {
      record(ev.id, 'unreported', unknownChannels(ev.spent))
    } else if (ev.kind === 'metered') {
      record(ev.id, 'unreported', unknownChannels(ev.spend))
    }
  }
  return [...gaps.values()].map((gap) => {
    const label = labels.get(gap.id)
    return {
      id: gap.id,
      ...(label !== undefined ? { label } : {}),
      kind: gap.kind,
      channels: [...gap.channels],
    }
  })
}

/** The channels a single spend record explicitly marks incomplete. */
function unknownChannels(spend: Spend): SpendChannel[] {
  const channels: SpendChannel[] = []
  if (spend.tokensKnown === false) channels.push('tokens')
  if (spend.usdKnown === false) channels.push('usd')
  return channels
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

export function sumMeasuredSpendFromEvents(events: SpawnEvent[]): {
  childWork: Spend
  driverInference: Spend
} {
  let childWork = zeroSpend()
  let driverInference = zeroSpend()
  for (const ev of events) {
    if (ev.kind === 'settled') childWork = addSpend(childWork, ev.spent)
    else if (ev.kind === 'metered') driverInference = addSpend(driverInference, ev.spend)
  }
  return { childWork, driverInference }
}

/** True when any driver metered inference this run (so the winner carries a `spentBreakdown`).
 *  Checks every channel `addSpend` sums — including `ms` — so the gate stays consistent with the
 *  total even though the coordination driver currently stamps `ms: 0`. */
function isNonEmptySpend(s: Spend): boolean {
  return (
    s.iterations > 0 ||
    s.tokens.input > 0 ||
    s.tokens.output > 0 ||
    s.usd > 0 ||
    s.ms > 0 ||
    s.tokensKnown === false ||
    s.usdKnown === false
  )
}
