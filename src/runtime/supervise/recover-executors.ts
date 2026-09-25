import {
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import {
  closesCursorSlot,
  contentAddress,
  loadSpawnForest,
  materializeTreeView,
  ownedTreeRootSpawn,
  pendingWaits,
  replaySpawnTree,
} from '../../durable/spawn-journal'
import { RuntimeRunStateError } from '../../errors'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { addSpend, zeroSpend } from '../util'
import {
  assertValidSpend,
  type BudgetPoolRestore,
  BudgetReconcileFault,
  createBudgetPool,
} from './budget'
import { executorFailure, executorFailureInfra } from './executor-outcome'
import { addResourceSpend, withBudgetResources } from './resources'
import {
  leafContinuationExecutionId,
  prepareRetainedExecutor,
  type RetainedChildRecovery,
  type RetainedLeafContinuation,
} from './retained-executor'
import type { ScopeArgs } from './scope'
import { detachedSnapshot } from './snapshot'
import { releasedChildPayload, terminalDownEvent } from './terminal-record'
import { nestedDriverTreeRoot } from './tree-key'
import type {
  Budget,
  BudgetViolation,
  NodeId,
  ResumedKeyState,
  Settled,
  SpawnEvent,
  Spend,
  SupervisorOpts,
} from './types'

type ResumeStores = Pick<
  SupervisorOpts,
  'runId' | 'journal' | 'blobs' | 'recoverExecutor' | 'hooks'
>
type Spawned = Extract<SpawnEvent, { kind: 'spawned' }>
type RecordedResult = Extract<SpawnEvent, { kind: 'execution-result' }>
type Reconciled = Extract<SpawnEvent, { kind: 'reconciled' }>
type TeardownReceipt = Extract<SpawnEvent, { kind: 'environment-teardown' }>

/** The environment id the node's latest durable admission names — the executor's own rule
 *  (`admittedEnvironmentId` in environment-provider.ts), read off the journal. */
function journaledEnvironmentId(owned: ReadonlyArray<SpawnEvent>): string | undefined {
  for (const event of [...owned].reverse()) {
    if (event.kind !== 'execution-admitted') continue
    if (event.admission.phase === 'dispatched') return event.admission.controlRef.environmentId
    if (event.admission.phase === 'environment') return event.admission.environmentId
  }
  return undefined
}

/**
 * Close the cursor slot of every node the release sweep destroyed but never recorded: the
 * settling process died between the last `environment-teardown` receipt and the terminal record
 * (the 0.233.0 crash window). The record is the sweep's own — the same builder, the cursor seq
 * `next()` stamped on the delivery and the settlement instant, all read back from the node's
 * latest `reconciled` record — so a healed journal replays as one the sweep completed.
 *
 * The gate is fail-closed, every clause required, because the heal cannot re-ask the executor
 * to confirm teardown the way the sweep does:
 *  - the latest `reconciled` record carries `settledSeq`, `reason` and `trace` (a record written
 *    before those fields existed names no cursor position and is not healed; `infra` is carried
 *    when present and never required, since an unattributable envelope failure has none);
 *  - at least one receipt sits after that record and every such receipt reads `destroyed: true`
 *    (an empty set must not close the slot vacuously, and a receipt from an earlier process
 *    belongs to an earlier settlement);
 *  - the environment the latest admission names is among those receipts, so a receipt for an
 *    environment the journal never admitted, or a re-admitted node whose receipt names the
 *    earlier environment, is left open where the live sweep would have closed it.
 * A node with an `execution-result` is left to the recorded-result branch of
 * {@link prepareInterruptedExecutors}, which settles it from the durable blob and takes
 * precedence. The walk is over the whole forest because a nested manager settled on the ordinary
 * path is never restored, so a per-tree heal inside the resume of its tree would never reach its
 * grandchild. Returns the number of records written.
 */
export async function healReleasedSlots(
  opts: ResumeStores,
  signal: AbortSignal,
  now: () => number,
): Promise<number> {
  const forest = await loadSpawnForest(opts.journal, opts.runId)
  let healed = 0
  for (const tree of forest.trees) {
    signal.throwIfAborted()
    const events = tree.events
    const closed = new Set(events.filter(closesCursorSlot).map((event) => event.id))
    const recorded = new Set(
      events.flatMap((event) => (event.kind === 'execution-result' ? [event.id] : [])),
    )
    for (const spawned of events) {
      if (spawned.kind !== 'spawned' || spawned.parent === undefined) continue
      if (closed.has(spawned.id) || recorded.has(spawned.id)) continue
      const owned = events.filter((event) => event.id === spawned.id)
      const floor = owned.reduce<Reconciled | undefined>(
        (latest, event) =>
          event.kind === 'reconciled' && (latest === undefined || event.seq > latest.seq)
            ? event
            : latest,
        undefined,
      )
      // A complete floor names its cursor seq, its reason and its trace. `infra` is not required:
      // a floor whose envelope failure the runtime could not attribute carries none, and a
      // release that healed everything else must not be skipped for a claim the record never made.
      if (
        floor?.settledSeq === undefined ||
        floor.reason === undefined ||
        floor.trace === undefined
      )
        continue
      const receipts = owned
        .slice(owned.indexOf(floor) + 1)
        .filter((event): event is TeardownReceipt => event.kind === 'environment-teardown')
      if (receipts.length === 0 || !receipts.every((receipt) => receipt.destroyed)) continue
      const held = journaledEnvironmentId(owned)
      if (held === undefined || !receipts.some((receipt) => receipt.environmentId === held))
        continue
      const settledSeq = floor.settledSeq
      // The journal's own duplicate-cursor guard is the backstop; this names the node first, and
      // writes nothing. A fixed process cannot produce it: the resumed cursor starts past every
      // open node's `settledSeq` (see `maxCursorSeq` below).
      if (events.some((event) => closesCursorSlot(event) && event.seq === settledSeq)) {
        throw new RuntimeRunStateError(
          `retained child '${spawned.id}' cannot be released at cursor seq ${settledSeq}: tree '${tree.root}' already closes that seq`,
        )
      }
      const subject = {
        id: spawned.id,
        spent: floor.spent,
        ...(floor.budgetViolation ? { budgetViolation: floor.budgetViolation } : {}),
        ...(floor.cancellation ? { cancellationReason: floor.cancellation } : {}),
      }
      const settlement = {
        kind: 'down' as const,
        reason: floor.reason,
        ...(floor.infra === undefined ? {} : { infra: floor.infra }),
        trace: floor.trace,
        ...(floor.outRef ? { outRef: floor.outRef } : {}),
        ...(floor.providerModel ? { providerModel: floor.providerModel } : {}),
        ...(floor.harnessTranscript ? { harnessTranscript: floor.harnessTranscript } : {}),
        ...(floor.retainedPendingCause ? { retainedPendingCause: floor.retainedPendingCause } : {}),
      }
      await opts.journal.appendEvent(
        tree.root,
        terminalDownEvent(subject, settlement, settledSeq, floor.at, 'released'),
      )
      healed += 1
      // The sweep's `agent.child` on the resumed stream, so a projection whose node state comes
      // only from that target flips the node to released as it does live. `startedAt` is the
      // runtime's own rule for a recovered child (the spawn instant), `releasedAt` the last
      // receipt's instant; the journal record above is the byte-identical surface.
      const materialized = owned.find((event) => event.kind === 'materialized')
      const lastReceipt = receipts[receipts.length - 1]!
      notifyRuntimeHookEvent(
        opts.hooks,
        {
          id: `${spawned.id}:released`,
          runId: tree.root,
          target: 'agent.child',
          phase: 'after',
          timestamp: now(),
          stepIndex: settledSeq,
          parentId: tree.ownerNodeId ?? opts.runId,
          payload: releasedChildPayload(
            {
              ...subject,
              runtime: materialized?.receipt.runtime ?? spawned.runtime,
              startedAt: Date.parse(spawned.at),
              ...(materialized === undefined ? {} : { materialization: materialized.receipt }),
              executionBindings: owned.flatMap((event) =>
                event.kind === 'execution-bound' ? [event.binding] : [],
              ),
              ...(floor.providerModel ? { providerModel: floor.providerModel } : {}),
            },
            settlement,
            Date.parse(floor.at),
            Date.parse(lastReceipt.at),
          ),
        },
        { signal },
      )
    }
  }
  return healed
}

/** Validate durable inputs without waiting for work that may need its resumed manager. */
export async function prepareInterruptedExecutors(
  opts: ResumeStores,
  events: SpawnEvent[],
  signal: AbortSignal,
  now: () => number,
  parentId = opts.runId,
): Promise<{ events: SpawnEvent[]; recoveries: RetainedChildRecovery[] }> {
  signal.throwIfAborted()
  const roots = events.filter((event) => event.kind === 'spawned' && event.parent === undefined)
  if (roots.length !== 1 || roots[0]?.id !== parentId) {
    throw new RuntimeRunStateError(
      `retained tree '${opts.runId}' must have exactly one original root '${parentId}'`,
    )
  }
  const terminal = new Set(events.filter(closesCursorSlot).map((event) => event.id))
  const interrupted = events.filter(
    (event): event is Spawned =>
      event.kind === 'spawned' && event.parent === parentId && !terminal.has(event.id),
  )
  const recoveries: RetainedChildRecovery[] = []
  const accepted: Array<{
    result: RecordedResult
    fault?: string
    budgetViolation?: BudgetViolation
  }> = []
  const rootBudget = events.find(
    (event): event is Spawned => event.kind === 'spawned' && event.parent === undefined,
  )?.budget
  for (const node of interrupted) {
    signal.throwIfAborted()
    const owned = events.filter((event) => event.id === node.id)
    // A leaf that continued after an unavailable upstream has one invocation per
    // `execution-input`. Only the latest decides: an earlier invocation's result is the refusal
    // the leaf continued past, not its outcome.
    const inputs = owned.filter(
      (event): event is Extract<SpawnEvent, { kind: 'execution-input' }> =>
        event.kind === 'execution-input',
    )
    const latestInput = inputs.at(-1)
    const current =
      latestInput === undefined || inputs.length === 1
        ? owned
        : owned.slice(owned.indexOf(latestInput))
    const recorded = current.find(
      (event): event is RecordedResult => event.kind === 'execution-result',
    )
    if (recorded) {
      await assertRecordedResult(node, recorded, owned, opts)
      if (!rootBudget)
        throw new RuntimeRunStateError('retained results have no original root budget')
      const validation = createBudgetPool(rootBudget, 0)
      const reservation = validation.reserve(node.budget)
      if (!reservation.ok)
        throw new RuntimeRunStateError(
          `retained child '${node.id}' exceeds its original root budget`,
        )
      // An overspend is recorded beside the saved result, exactly as a live settlement records
      // it. Only spend the pool cannot verify settles the saved result down.
      let fault: string | undefined
      let budgetViolation: BudgetViolation | undefined
      try {
        budgetViolation = validation.reconcile(reservation.ticket, recorded.spent)
      } catch (error) {
        fault = error instanceof Error ? error.message : String(error)
        if (error instanceof BudgetReconcileFault) budgetViolation = error.budgetViolation
      }
      accepted.push({
        result: recorded,
        ...(fault === undefined ? {} : { fault }),
        ...(budgetViolation === undefined ? {} : { budgetViolation }),
      })
      continue
    }
    const admissions = current.flatMap((event) =>
      event.kind === 'execution-admitted' ? [event.admission] : [],
    )
    if (
      !opts.recoverExecutor ||
      (admissions.length === 0 &&
        !node.ownedTreeRoot &&
        (opts.journal.appendEvents === undefined || latestInput === undefined))
    )
      continue
    const taskRef = inputs[0]?.taskRef
    if (
      !node.profileRef ||
      !taskRef ||
      !node.identity?.profileDigest ||
      !node.identity.taskDigest
    ) {
      throw new RuntimeRunStateError(
        `cannot recover '${node.id}' without exact profile and task bytes`,
      )
    }
    const profile = agentProfileSchema.parse(await opts.blobs.get(node.profileRef))
    const task = await opts.blobs.get(taskRef)
    if (
      canonicalAgentProfileDigest(profile) !== node.identity.profileDigest ||
      canonicalCandidateDigest(task) !== node.identity.taskDigest
    ) {
      throw new RuntimeRunStateError(
        `recovery inputs for '${node.id}' do not match its admitted identity`,
      )
    }
    let prepared: ReturnType<typeof prepareRetainedExecutor>
    if (node.ownedTreeRoot !== undefined) {
      if (node.ownedTreeRoot !== nestedDriverTreeRoot(opts.runId, node.id)) {
        throw new RuntimeRunStateError(`retained manager '${node.id}' changed its owned tree`)
      }
      const nested = await opts.journal.loadTree(node.ownedTreeRoot)
      const roots =
        nested?.filter((event) => event.kind === 'spawned' && event.parent === undefined) ?? []
      if (
        nested?.length &&
        (roots.length !== 1 ||
          contentAddress(roots[0]) !== contentAddress(ownedTreeRootSpawn(node)))
      ) {
        throw new RuntimeRunStateError(
          `retained manager '${node.id}' has conflicting subtree ownership`,
        )
      }
      prepared = prepareRetainedExecutor(opts.recoverExecutor, { spawned: node, profile, task })
      if (!prepared) continue
    }
    const priorMaterialization = owned.find((event) => event.kind === 'materialized')?.receipt
    const continuation =
      latestInput !== undefined && inputs.length > 1 && node.ownedTreeRoot === undefined
        ? await leafContinuation(node, owned, latestInput, opts)
        : undefined
    recoveries.push({
      ...detachedSnapshot(
        {
          spawned: node,
          task,
          admissions,
          ...(priorMaterialization === undefined ? {} : { priorMaterialization }),
          ...(continuation === undefined ? {} : { continuation }),
        },
        'retained child recovery',
      ),
      spec: prepared?.spec ?? { profile, harness: null, execution: node.identity },
      factory: prepared?.factory ?? opts.recoverExecutor,
    })
  }
  // Past every closed AND reserved seq: an open node's `settledSeq` is where its terminal record
  // lands, and a recovered result written there would be the collision the heal refuses.
  let seq = reservedCursorFloor(events) + 1
  for (const { result, fault, budgetViolation } of accepted) {
    signal.throwIfAborted()
    const failure = executorFailure(result)
    const reason = fault ?? failure?.error
    // A reconcile fault is the runtime's own failure; an envelope failure is attributed by the
    // same vocabulary the live path uses, so a child settled here and one settled live from the
    // same durable result carry the same label. This site used to stamp `infra: false` for every
    // envelope failure, which made the label depend on whether the process survived to settle it.
    const infra =
      fault !== undefined ? true : failure === undefined ? undefined : executorFailureInfra(failure)
    // Await every admitted write before releasing the run lock, including cancellation races.
    await opts.journal.appendEvent(opts.runId, {
      kind: 'settled',
      id: result.id,
      status: reason === undefined ? 'done' : 'down',
      outRef: result.outRef,
      ...(reason === undefined ? {} : { reason }),
      ...(infra === undefined ? {} : { infra }),
      spent: result.spent,
      ...(budgetViolation === undefined ? {} : { budgetViolation }),
      ...(result.verdict ? { verdict: result.verdict } : {}),
      seq: seq++,
      at: new Date(now()).toISOString(),
    })
  }
  signal.throwIfAborted()
  return { events: (await opts.journal.loadTree(opts.runId)) ?? events, recoveries }
}

/**
 * The later invocation a leaf was running when its process stopped: its own task, and the
 * environment admission of the invocation before it, which it continued in. The execution id is
 * derived from the input sequence exactly as the live scope derived it.
 */
async function leafContinuation(
  node: Spawned,
  owned: SpawnEvent[],
  latestInput: Extract<SpawnEvent, { kind: 'execution-input' }>,
  opts: ResumeStores,
): Promise<RetainedLeafContinuation> {
  const before = owned.slice(0, owned.indexOf(latestInput))
  const priorSession = [...before]
    .reverse()
    .flatMap((event) =>
      event.kind === 'execution-admitted' && event.admission.phase === 'environment'
        ? [event.admission]
        : [],
    )[0]
  if (priorSession === undefined) {
    throw new RuntimeRunStateError(
      `cannot recover '${node.id}': its continuation names no environment it continued in`,
    )
  }
  const task = await opts.blobs.get(latestInput.taskRef)
  if (task === undefined || contentAddress(task) !== latestInput.taskRef) {
    throw new RuntimeRunStateError(`continuation task for '${node.id}' is missing or corrupt`)
  }
  return {
    task,
    inputSeq: latestInput.seq,
    executionId: leafContinuationExecutionId(node.id, latestInput.seq),
    priorSession,
  }
}

async function assertRecordedResult(
  node: Spawned,
  result: RecordedResult,
  events: SpawnEvent[],
  opts: ResumeStores,
): Promise<void> {
  const before = events.slice(0, events.indexOf(result))
  const receipt = before.find((event) => event.kind === 'materialized')?.receipt
  const binding = [...before].reverse().find((event) => event.kind === 'execution-bound')?.binding
  if (
    receipt?.status !== 'known' ||
    binding?.status !== 'known' ||
    receipt.runtime !== node.runtime ||
    receipt.authoredProfileDigest !== node.identity?.profileDigest ||
    binding.materializationReceiptDigest !== canonicalCandidateDigest(receipt)
  ) {
    throw new RuntimeRunStateError(
      `retained result '${node.id}' has no matching execution evidence`,
    )
  }
  assertValidSpend(result.spent, `retained result '${result.id}'`)
  const output = await opts.blobs.get(result.outRef)
  if (output === undefined || contentAddress(output) !== result.outRef)
    throw new RuntimeRunStateError(`retained result '${result.id}' is missing or corrupt`)
}

/** The committed work + cursor maxima the supervisor hands a resumed scope. Shaped to spread
 *  into `ScopeArgs.resumeFrom`. */
export type ScopeResumeState = NonNullable<ScopeArgs['resumeFrom']> & {
  readonly events: readonly SpawnEvent[]
  readonly recoveries: readonly RetainedChildRecovery[]
}

/**
 * The keyed assignments a prior journal proves: every `spawned` event carrying a `key`, resolved
 * against the replayed settlements. A key spawned more than once (a retry chain) resolves to its
 * LATEST attempt — iterate in ordinal order so later spawns overwrite earlier ones. A spawned
 * event with no matching settlement is `in-doubt`: the process died with it in flight — UNLESS
 * the spawn's own runtime proves the execution cannot have outlived the process (`inline`, the
 * same predicate the budget layer charges no uncertain reservation for), in which case the resume
 * itself is the terminal evidence and the key resolves `down` with a derived reason, so a re-spawn
 * under the same key retries instead of wedging in-doubt.
 */
function keyedAssignments(
  events: SpawnEvent[],
  settled: ReadonlyArray<Settled<unknown>>,
): ReadonlyMap<string, ResumedKeyState<unknown>> {
  const byId = new Map(settled.map((s) => [s.handle.id, s]))
  const keys = new Map<string, ResumedKeyState<unknown>>()
  const spawns = events
    .filter(
      (ev): ev is Extract<SpawnEvent, { kind: 'spawned' }> =>
        ev.kind === 'spawned' && ev.parent !== undefined,
    )
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
        ? ev.runtime === 'inline'
          ? {
              id: ev.id,
              label: ev.label,
              identity: ev.identity,
              state: 'down',
              reason: `interrupted: the process died with '${ev.label}' in flight and its '${ev.runtime}' runtime cannot outlive that process, so the resume proves the attempt dead`,
            }
          : { id: ev.id, label: ev.label, identity: ev.identity, state: 'in-doubt' }
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

/** Child reservations whose spawn was durable, whose terminal record never landed, and whose
 *  reservation was never reconciled: the process died with them in flight, so nothing observed
 *  their spend and the ceiling is the only sound charge. An open node with a `reconciled` record is
 *  not uncertain in that sense — its floor is measured evidence and is charged by
 *  {@link sumMeasuredSpendFromEvents}, never here, so the two readers cannot charge one node twice. */
export function uncertainSpawnBudgets(
  events: SpawnEvent[],
  recovered: ReadonlySet<NodeId> = new Set(),
): Budget[] {
  const terminal = new Set(events.filter(closesCursorSlot).map((event) => event.id))
  const reconciled = new Set(
    events.flatMap((event) => (event.kind === 'reconciled' ? [event.id] : [])),
  )
  return events
    .filter(
      (event): event is Spawned =>
        event.kind === 'spawned' &&
        event.parent !== undefined &&
        !terminal.has(event.id) &&
        !reconciled.has(event.id) &&
        !recovered.has(event.id) &&
        // An `inline` executor runs inside the process that spawned it, so a resume can prove it
        // dead rather than in-doubt: holding its reservation would charge the pool for work no
        // process can ever finish. Only a runtime that can re-attach across a process boundary
        // (bridge, sandbox) keeps its reservation charged as uncertain.
        event.runtime !== 'inline',
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

/**
 * The highest cursor seq any record in the journal already owns, closed OR reserved.
 *
 * A closed slot owns its seq outright. An open retained node owns the `settledSeq` its
 * `reconciled` record carries: that is the seq the driver already branched on, and the seq the
 * heal (or a later release sweep) writes the terminal record under. Every writer that mints a
 * new cursor seq in a resumed process — the recorded-result settlements below and the resumed
 * scope's own cursor — must start past BOTH, or a recovered result lands on a seq an open node
 * has reserved and the heal can only ever collide. One function so no writer can drift.
 */
export function reservedCursorFloor(events: SpawnEvent[]): number {
  return Math.max(
    maxSeqOf(events, closesCursorSlot),
    events.reduce(
      (max, event) =>
        event.kind === 'reconciled' && event.settledSeq !== undefined
          ? Math.max(max, event.settledSeq)
          : max,
      -1,
    ),
  )
}

/** Per-channel sum over a journaled event list: `settled` = spawned-child work (reconciled), plus
 *  the reconciled floor of every node still open, plus the declared ceiling of every open node
 *  nothing reconciled; `metered` = driver inference (re-homed up the tree, so a single root-tree
 *  pass already includes every nested driver's inference). The pool commits exactly these amounts
 *  — a floor where a reconcile ran, a ceiling where the process died first — so this sum is the
 *  same ledger the pool holds, read from the journal. */
export function sumSpendFromEvents(events: SpawnEvent[]): {
  childWork: Spend
  driverInference: Spend
} {
  const totals = sumMeasuredSpendFromEvents(events)
  const rootBudget = events.find(
    (event): event is Spawned => event.kind === 'spawned' && event.parent === undefined,
  )?.budget
  let remainingRootUsd = Math.max(
    0,
    (rootBudget?.maxUsd ?? 0) - totals.childWork.usd - totals.driverInference.usd,
  )
  for (const budget of uncertainSpawnBudgets(events)) {
    const unknown = withBudgetResources(zeroSpend(), budget)
    Object.assign(totals.childWork, addResourceSpend(totals.childWork.resources, unknown.resources))
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
  const budgets = new Map(
    events.flatMap((event) =>
      event.kind === 'spawned' ? [[event.id, event.budget] as const] : [],
    ),
  )
  let childWork = zeroSpend()
  let driverInference = zeroSpend()
  const owners = new Map<NodeId, Spend>()
  const terminal = new Set(events.filter(closesCursorSlot).map((event) => event.id))
  // A retained-pending node's reconciled floor is its child work for as long as the node stays
  // open. The LATEST record is the whole charge, not a sum: a recovered execution reports its
  // total again on its next reconcile, so an earlier floor would count the same work twice. A
  // terminal record supersedes every floor for the same reason.
  const floors = new Map<NodeId, Extract<SpawnEvent, { kind: 'reconciled' }>>()
  for (const ev of events) {
    if (ev.kind === 'settled' || ev.kind === 'cancelled')
      childWork = addSpend(
        childWork,
        withBudgetResources(
          ev.spent ?? { ...zeroSpend(), tokensKnown: false, usdKnown: false },
          budgets.get(ev.id) ?? {},
        ),
      )
    else if (ev.kind === 'metered')
      owners.set(ev.id, addSpend(owners.get(ev.id) ?? zeroSpend(), ev.spend))
    else if (ev.kind === 'reconciled' && !terminal.has(ev.id)) {
      const prior = floors.get(ev.id)
      if (prior === undefined || ev.seq > prior.seq) floors.set(ev.id, ev)
    }
  }
  for (const [id, floor] of floors) {
    childWork = addSpend(childWork, withBudgetResources(floor.spent, budgets.get(id) ?? {}))
  }
  for (const [id, spend] of owners) {
    driverInference = addSpend(driverInference, withBudgetResources(spend, budgets.get(id) ?? {}))
  }
  return { childWork, driverInference }
}

/** Restore the same journal projection and accounting for root and nested scopes. @internal */
export async function prepareScopeResume(
  opts: ResumeStores,
  events: SpawnEvent[],
  signal: AbortSignal,
  now: () => number,
  parentId = opts.runId,
): Promise<{ resumeFrom: ScopeResumeState; poolRestore: BudgetPoolRestore }> {
  // The root resume walks the whole forest once; the nested restore, whose `parentId` is the
  // manager node, does not walk again. A healed node is then terminal to everything below:
  // never interrupted, never a recovery, charged its floor as `settled.spent` instead of the
  // reconciled floor (the same object), and replayed at the driver's own seq.
  if (parentId === opts.runId && (await healReleasedSlots(opts, signal, now)) > 0) {
    events = (await opts.journal.loadTree(opts.runId)) ?? events
  }
  const prepared = await prepareInterruptedExecutors(opts, events, signal, now, parentId)
  const prior = prepared.events
  const recovering = new Set(prepared.recoveries.map((item) => item.spawned.id))
  // A restored child's full reservation already covers its previous inference and its reconciled
  // floor. Its executor reconciles total spend and publishes only the unrecorded meter delta, so
  // neither prior record may be committed a second time.
  const measuredEvents = prior.filter(
    (event) =>
      (event.kind !== 'metered' && event.kind !== 'reconciled') || !recovering.has(event.id),
  )
  const measured = sumMeasuredSpendFromEvents(measuredEvents)
  const hasCommittedEvidence = measuredEvents.some(
    (event) =>
      event.kind === 'metered' ||
      event.kind === 'reconciled' ||
      event.kind === 'settled' ||
      event.kind === 'cancelled',
  )
  const settled = await replaySpawnTree(opts.journal, opts.blobs, opts.runId)
  signal.throwIfAborted()
  return {
    poolRestore: {
      ...(hasCommittedEvidence
        ? { committed: addSpend(measured.childWork, measured.driverInference) }
        : {}),
      uncertainReservations: uncertainSpawnBudgets(prior, recovering),
    },
    resumeFrom: {
      events: prior,
      recoveries: prepared.recoveries,
      settled,
      view: materializeTreeView(prior),
      maxSpawnOrdinal: maxSeqOf(prior, (event) => event.kind === 'spawned'),
      // An open node's journaled cursor seq is reserved across processes: the resumed scope must
      // never mint it for another node, or the heal above could only ever collide.
      maxCursorSeq: reservedCursorFloor(prior),
      maxWaitOrdinal: maxSeqOf(prior, (event) => event.kind === 'waiting'),
      waits: pendingWaits(prior),
      keys: keyedAssignments(prior, settled),
      priorSpend: sumMeasuredSpendFromEvents(prior),
    },
  }
}
