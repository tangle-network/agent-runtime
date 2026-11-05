import {
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { closesCursorSlot } from '../../durable/spawn-journal/event-index'
import { replaySpawnTree } from '../../durable/spawn-journal/replay'
import { loadSpawnForest, ownedTreeRootSpawn } from '../../durable/spawn-journal/spawn-forest'
import { materializeTreeView } from '../../durable/spawn-journal/tree-view'
import { RuntimeRunStateError } from '../../errors'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { reportedFailureCause } from '../failure-cause'
import { addSpend, chargedTokens, zeroSpend } from '../util'
import {
  type BudgetPoolRestore,
  BudgetReconcileFault,
  budgetRecoverySeeds,
  completedLeafBacking,
  createBudgetPool,
} from './budget'
import { executorFailure, executorFailureInfra } from './executor-outcome'
import { addResourceSpend, withBudgetResources } from './resources'
import {
  BUDGET_CONTINUATION_TASK,
  leafContinuationExecutionId,
  prepareRetainedExecutor,
  type RetainedChildRecovery,
  type RetainedLeafContinuation,
} from './retained-executor'
import type { ScopeArgs } from './scope'
import { detachedSnapshot, shareParsedStrings } from './snapshot'
import { assertValidSpend } from './spend-validation'
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

/** Heal release-to-terminal crashes across the forest using the original floor's settlement,
 * cursor seq and timestamp. Require a complete floor, later nonempty successful receipts,
 * and the latest admitted environment among them. Recorded results take precedence. */
async function healReleasedSlots(
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
      // Complete floors require cursor, reason and trace; infra remains optional.
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
      // Reserved cursors cannot be reused by recovery or healing.
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
        ...(floor.failure === undefined ? {} : { failure: floor.failure }),
        ...(floor.infra === undefined ? {} : { infra: floor.infra }),
        trace: floor.trace,
        ...(floor.outRef ? { outRef: floor.outRef } : {}),
        ...(floor.traceRoot ? { traceRoot: floor.traceRoot } : {}),
        ...(floor.providerModel ? { providerModel: floor.providerModel } : {}),
        ...(floor.harnessTranscript ? { harnessTranscript: floor.harnessTranscript } : {}),
        ...(floor.retainedPendingCause ? { retainedPendingCause: floor.retainedPendingCause } : {}),
      }
      await opts.journal.appendEvent(
        tree.root,
        terminalDownEvent(subject, settlement, settledSeq, floor.at, 'released'),
      )
      healed += 1
      // Replay the live release hook with original spawn and acknowledged release times.
      const materialized = [...owned]
        .reverse()
        .find((event) => event.kind === 'materialized' || event.kind === 'seat-materialized')
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
async function prepareInterruptedExecutors(
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
  // Intern equal mounted strings across recovered children.
  const parsedStrings = new Map<string, string>()
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
    // Earlier invocation results cannot settle the latest input.
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
    const profile = shareParsedStrings(
      agentProfileSchema.parse(await opts.blobs.get(node.profileRef)),
      parsedStrings,
    )
    const task = shareParsedStrings(await opts.blobs.get(taskRef), parsedStrings)
    if (
      canonicalAgentProfileDigest(profile) !== node.identity.profileDigest ||
      canonicalCandidateDigest(task) !== node.identity.taskDigest
    ) {
      throw new RuntimeRunStateError(
        `recovery inputs for '${node.id}' do not match its admitted identity`,
      )
    }
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
    }
    const prepared = prepareRetainedExecutor(opts.recoverExecutor, { spawned: node, profile, task })
    if (node.ownedTreeRoot !== undefined && !prepared) continue
    const priorMaterialization = [...owned]
      .reverse()
      .find((event) => event.kind === 'materialized' || event.kind === 'seat-materialized')?.receipt
    const continuation =
      latestInput !== undefined && inputs.length > 1 && node.ownedTreeRoot === undefined
        ? await leafContinuation(node, owned, latestInput, opts)
        : latestInput !== undefined &&
            node.continues !== undefined &&
            admissions.length === 0 &&
            node.ownedTreeRoot === undefined
          ? heldContinuation(node, events, latestInput)
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
    // Replayed and live settlements use the same Runtime/provider attribution.
    const infra =
      fault !== undefined ? true : failure === undefined ? undefined : executorFailureInfra(failure)
    // Await every admitted write before releasing the run lock, including cancellation races.
    await opts.journal.appendEvent(opts.runId, {
      kind: 'settled',
      id: result.id,
      status: reason === undefined ? 'done' : 'down',
      outRef: result.outRef,
      // Copied, never recomputed: salts are random, so only the recorded root proves this output.
      ...(result.traceRoot === undefined ? {} : { traceRoot: result.traceRoot }),
      ...(reason === undefined ? {} : { reason }),
      ...(infra === undefined ? {} : { infra }),
      ...(fault === undefined && failure !== undefined
        ? { failure: reportedFailureCause(failure) }
        : {}),
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
  const priorResult = [...before]
    .reverse()
    .find((event): event is RecordedResult => event.kind === 'execution-result')
  if (priorResult === undefined) {
    throw new RuntimeRunStateError(
      `cannot recover '${node.id}': its continuation has no committed predecessor result`,
    )
  }
  await assertRecordedResult(node, priorResult, owned, opts)
  const task = await opts.blobs.get(latestInput.taskRef)
  if (task === undefined || contentAddress(task) !== latestInput.taskRef) {
    throw new RuntimeRunStateError(`continuation task for '${node.id}' is missing or corrupt`)
  }
  return {
    task,
    inputSeq: latestInput.seq,
    executionId: leafContinuationExecutionId(node.id, latestInput.seq),
    priorSession,
    priorSpent: priorResult.spent,
  }
}

/**
 * A node that continues a budget-stopped node's held environment, recovered before its own first
 * admission: it runs in the environment and session of its predecessor's last environment
 * admission, so the recovery neither creates a second environment nor leaves the held one behind.
 */
function heldContinuation(
  node: Spawned,
  events: ReadonlyArray<SpawnEvent>,
  latestInput: Extract<SpawnEvent, { kind: 'execution-input' }>,
): RetainedLeafContinuation {
  const continues = node.continues!
  const priorSession = [...events]
    .reverse()
    .flatMap((event) =>
      event.id === continues.ofWorker &&
      event.kind === 'execution-admitted' &&
      event.admission.phase === 'environment'
        ? [event.admission]
        : [],
    )[0]
  if (priorSession === undefined || priorSession.environmentId !== continues.environmentId) {
    throw new RuntimeRunStateError(
      `cannot recover '${node.id}': '${continues.ofWorker}' has no admission for the environment it continues`,
    )
  }
  return {
    task: BUDGET_CONTINUATION_TASK,
    inputSeq: latestInput.seq,
    executionId: node.id,
    priorSession,
    priorSpent: zeroSpend(),
  }
}

async function assertRecordedResult(
  node: Spawned,
  result: RecordedResult,
  events: SpawnEvent[],
  opts: ResumeStores,
): Promise<void> {
  const before = events.slice(0, events.indexOf(result))
  const receipt = [...before]
    .reverse()
    .find((event) => event.kind === 'materialized' || event.kind === 'seat-materialized')?.receipt
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

/** Latest keyed attempts, resolved against durable settlements. An interrupted inline
 * invocation died with its process; remote invocations remain in doubt. */
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
function uncertainSpawnBudgets(
  events: SpawnEvent[],
  recovered: ReadonlySet<NodeId> = new Set(),
): Budget[] {
  const terminal = new Set(events.filter(closesCursorSlot).map((event) => event.id))
  const reconciled = openReconciledFloors(events)
  const granted = new Set(
    events.filter((event) => event.kind === 'admission-granted').map((event) => event.id),
  )
  const unknown = events
    .filter(
      (event): event is Spawned =>
        event.kind === 'spawned' &&
        event.parent !== undefined &&
        !terminal.has(event.id) &&
        !reconciled.has(event.id) &&
        !recovered.has(event.id) &&
        (event.attemptId === undefined || granted.has(event.id)) &&
        // Inline work died with its process; only external executions remain uncertain.
        event.runtime !== 'inline',
    )
    .map((event) => event.budget)
  return unknown
}

function openReconciledFloors(events: readonly SpawnEvent[]) {
  const terminal = new Set(events.filter(closesCursorSlot).map((event) => event.id))
  const floors = new Map<NodeId, Extract<SpawnEvent, { kind: 'reconciled' }>>()
  for (const event of events) {
    if (
      event.kind === 'reconciled' &&
      !terminal.has(event.id) &&
      event.seq > (floors.get(event.id)?.seq ?? -1)
    )
      floors.set(event.id, event)
  }
  return floors
}

function heldSpawnBudgets(
  events: readonly SpawnEvent[],
  recovered: ReadonlySet<NodeId> = new Set(),
): Array<{ id: NodeId; budget: Budget; custody?: Budget }> {
  const floors = new Map<NodeId, Reconciled>()
  for (const event of events)
    if (event.kind === 'reconciled' && event.seq > (floors.get(event.id)?.seq ?? -1))
      floors.set(event.id, event)
  const spawns = new Map(
    events
      .filter((event): event is Spawned => event.kind === 'spawned')
      .map((event) => [event.id, event]),
  )
  const terminal = new Map(
    events
      .filter(
        (event): event is Extract<SpawnEvent, { kind: 'settled' | 'cancelled' }> =>
          event.kind === 'settled' || event.kind === 'cancelled',
      )
      .map((event) => [event.id, event]),
  )
  return [...spawns].flatMap(([id, spawned]) => {
    const floor = floors.get(id),
      closed = terminal.get(id)
    const legacy =
      spawned.attemptId === undefined && (!closed || closed.retainedExecution !== undefined)
    const accepted = events.some((event) => event.id === id && event.kind === 'execution-result')
    const completedLeaf =
      spawned.ownedTreeRoot === undefined &&
      closed?.spent !== undefined &&
      closed.retainedExecution !== 'release-unconfirmed' &&
      ((closed.kind === 'settled' && closed.status === 'done') || accepted)
    // A normal leaf can close without a floor. Its grant still backs physical custody;
    // a terminal usage receipt alone is not a resource-teardown acknowledgement.
    let reservation =
      floor?.reservation ??
      ((floor && legacy) || (completedLeaf && accepted && spawned.parent !== undefined)
        ? spawned.budget
        : undefined)
    if (reservation && completedLeaf && closed?.spent) {
      const owned = events.filter((event) => event.id === id)
      const lastAdmission = owned.reduce(
        (last, event, index) =>
          event.kind === 'admission-granted' || event.kind === 'execution-admitted' ? index : last,
        -1,
      )
      const cleanupConfirmed =
        closed.retainedExecution === 'released' ||
        owned.some((event, index) => event.kind === 'teardown-confirmed' && index > lastAdmission)
      reservation = completedLeafBacking(
        reservation,
        closed.spent,
        floor?.spent ?? zeroSpend(),
        cleanupConfirmed,
      )
    }
    if (recovered.has(id) || !reservation) return []
    const custody =
      completedLeaf && accepted && spawned.parent !== undefined && reservation.resources
        ? {
            resources: Object.fromEntries(
              Object.entries(spawned.budget.resources ?? reservation.resources).map(
                ([name, value]) => [
                  name,
                  {
                    unit: value.unit,
                    limit:
                      closed?.spent?.resources?.[name]?.known === true
                        ? (reservation.resources?.[name]?.limit ?? 0)
                        : 0,
                  },
                ],
              ),
            ),
          }
        : undefined
    return [
      {
        id,
        budget: {
          ...reservation,
          ...(reservation.resources
            ? {
                resources: Object.fromEntries(
                  Object.entries(reservation.resources).map(([name, value]) => [
                    name,
                    { ...value, limit: value.limit - (custody?.resources[name]?.limit ?? 0) },
                  ]),
                ),
              }
            : {}),
          maxTokens: reservation.maxTokens ?? 0,
          maxIterations: reservation.maxIterations ?? 0,
          maxUsd: reservation.maxUsd ?? 0,
        },
        ...(custody && Object.values(custody.resources).some((value) => value.limit > 0)
          ? { custody }
          : {}),
      },
    ]
  })
}

/** Highest `seq` among events matching `pred`, or `-1` when none match (so a resumed scope's
 *  first new ordinal/seq is 0 — the same start a fresh scope uses). */
function maxSeqOf(events: SpawnEvent[], pred: (ev: SpawnEvent) => boolean): number {
  let max = -1
  for (const ev of events) if (pred(ev) && ev.seq > max) max = ev.seq
  return max
}

/** Closed cursor seqs and open retained floors both reserve their original positions.
 * Recovery must allocate above both so a later heal cannot collide with new delivery. */
function reservedCursorFloor(events: SpawnEvent[]): number {
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

/** Durable measured costs plus conservative unmeasured ceilings and remaining backing.
 * Unknown flags distinguish those charges from observed spend. */
export function sumSpendFromEvents(events: SpawnEvent[]): {
  childWork: Spend
  driverInference: Spend
} {
  const totals = sumMeasuredSpendFromEvents(events)
  const rootBudget = events.find(
    (event): event is Spawned => event.kind === 'spawned' && event.parent === undefined,
  )?.budget
  let remainingRootTokens = Math.max(
    0,
    (rootBudget?.maxTokens ?? 0) -
      chargedTokens(totals.childWork.tokens) -
      chargedTokens(totals.driverInference.tokens),
  )
  let remainingRootIterations = Math.max(
    0,
    (rootBudget?.maxIterations ?? 0) -
      totals.childWork.iterations -
      totals.driverInference.iterations,
  )
  let remainingRootUsd = Math.max(
    0,
    (rootBudget?.maxUsd ?? 0) - totals.childWork.usd - totals.driverInference.usd,
  )
  for (const budget of uncertainSpawnBudgets(events)) {
    const unknown = withBudgetResources(zeroSpend(), budget)
    Object.assign(totals.childWork, addResourceSpend(totals.childWork.resources, unknown.resources))
    const iterationCharge = budget.maxIterations ?? remainingRootIterations
    totals.childWork.iterations += iterationCharge
    remainingRootIterations = Math.max(0, remainingRootIterations - iterationCharge)
    // The numeric value is the charged upper bound, not a fabricated measurement. The false flag
    // makes that distinction machine-readable in every report.
    const tokenCharge = budget.maxTokens ?? remainingRootTokens
    totals.childWork.tokens.input += tokenCharge
    remainingRootTokens = Math.max(0, remainingRootTokens - tokenCharge)
    totals.childWork.tokensKnown = false
    const usdCharge = budget.maxUsd ?? (rootBudget?.maxUsd !== undefined ? remainingRootUsd : 0)
    totals.childWork.usd += usdCharge
    totals.childWork.usdKnown = false
    remainingRootUsd = Math.max(0, remainingRootUsd - usdCharge)
  }
  for (const { budget: held } of heldSpawnBudgets(events)) {
    totals.childWork = addSpend(totals.childWork, {
      ...zeroSpend(),
      iterations: held.maxIterations ?? 0,
      tokens: { input: held.maxTokens ?? 0, output: 0 },
      tokensKnown: (held.maxTokens ?? 0) === 0,
      usd: held.maxUsd ?? 0,
      usdKnown: (held.maxUsd ?? 0) === 0,
      ...(held.resources === undefined
        ? {}
        : {
            resources: Object.fromEntries(
              Object.entries(held.resources).map(([name, value]) => [
                name,
                { unit: value.unit, amount: value.limit, known: value.limit === 0 },
              ]),
            ),
          }),
    })
  }
  return totals
}

export function sumMeasuredSpendFromEvents(events: SpawnEvent[], ownerId?: NodeId) {
  const budgets = new Map(
    events.flatMap((event) =>
      event.kind === 'spawned' ? [[event.id, event.budget] as const] : [],
    ),
  )
  let childWork = zeroSpend()
  let driverInference = zeroSpend()
  const owners = new Map<NodeId, Spend>()
  // Latest open floors are cumulative child work; terminal costs replace their spend only.
  const floors = openReconciledFloors(events)
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
  }
  for (const [id, floor] of floors) {
    childWork = addSpend(childWork, withBudgetResources(floor.spent, budgets.get(id) ?? {}))
  }
  for (const [id, spend] of owners) {
    driverInference = addSpend(driverInference, withBudgetResources(spend, budgets.get(id) ?? {}))
  }
  const owner = ownerId === undefined ? undefined : owners.get(ownerId)
  return { childWork, driverInference, owner }
}

/** Restore the same journal projection and accounting for root and nested scopes. @internal */
export async function prepareScopeResume(
  opts: ResumeStores,
  events: SpawnEvent[],
  signal: AbortSignal,
  now: () => number,
  parentId = opts.runId,
  /** A terminal entry restores cleanup descriptors, never slot heals or execution. */
  settleOnly = false,
): Promise<{ resumeFrom: ScopeResumeState; poolRestore: BudgetPoolRestore }> {
  // Heal the forest once at root entry; nested restore uses already healed events.
  if (!settleOnly && parentId === opts.runId && (await healReleasedSlots(opts, signal, now)) > 0) {
    events = (await opts.journal.loadTree(opts.runId)) ?? events
  }
  if (settleOnly) signal = new AbortController().signal
  const prepared = await prepareInterruptedExecutors(opts, events, signal, now, parentId)
  const prior = prepared.events
  const recovering = new Set(prepared.recoveries.map((item) => item.spawned.id))
  // Recovery attaches its original ticket to the prefix and backing seeded below.
  // Exclude them here so the pool credits them exactly once before admitting any new work.
  const measuredEvents = prior.filter(
    (event) =>
      (event.kind !== 'metered' && event.kind !== 'reconciled') || !recovering.has(event.id),
  )
  const measured = sumMeasuredSpendFromEvents(measuredEvents, parentId)
  const hasCommittedEvidence = measuredEvents.some(
    (event) =>
      event.kind === 'metered' ||
      event.kind === 'reconciled' ||
      event.kind === 'settled' ||
      event.kind === 'cancelled',
  )
  const settled = await replaySpawnTree(opts.journal, opts.blobs, opts.runId)
  if (!settleOnly) signal.throwIfAborted()
  const holds = heldSpawnBudgets(prior, recovering)
  const poolRestore: BudgetPoolRestore = {
    ...(hasCommittedEvidence
      ? { committed: addSpend(measured.childWork, measured.driverInference) }
      : {}),
    owner: measured.owner,
    uncertainReservations: uncertainSpawnBudgets(prior, recovering),
    heldReservations: holds.map(({ budget }) => budget),
  }
  budgetRecoverySeeds.set(poolRestore, [
    ...prepared.recoveries.map(({ spawned }) => {
      const owned = prior.filter((event) => event.id === spawned.id)
      const totals = sumMeasuredSpendFromEvents(owned)
      const floor = owned.filter((event) => event.kind === 'reconciled').at(-1)
      const reservation =
        floor?.reservation ??
        (spawned.attemptId === undefined ||
        owned.some((event) => event.kind === 'admission-granted')
          ? spawned.budget
          : undefined)
      return {
        id: spawned.id,
        spent: withBudgetResources(
          addSpend(totals.childWork, totals.driverInference),
          spawned.budget,
          true,
        ),
        held: {
          ...(spawned.budget.maxTokens === undefined
            ? {}
            : { maxTokens: reservation?.maxTokens ?? 0 }),
          ...(spawned.budget.maxIterations === undefined
            ? {}
            : { maxIterations: reservation?.maxIterations ?? 0 }),
          ...(spawned.budget.maxUsd === undefined ? {} : { maxUsd: reservation?.maxUsd ?? 0 }),
          ...(spawned.budget.resources === undefined
            ? {}
            : {
                resources: Object.fromEntries(
                  Object.entries(spawned.budget.resources).map(([name, value]) => [
                    name,
                    { unit: value.unit, limit: reservation?.resources?.[name]?.limit ?? 0 },
                  ]),
                ),
              }),
        },
      }
    }),
    ...holds.flatMap(({ id, custody }) =>
      custody ? [{ id, spent: zeroSpend(), held: custody, closed: true as const }] : [],
    ),
  ])
  return {
    poolRestore,
    resumeFrom: {
      events: prior,
      recoveries: prepared.recoveries,
      settled,
      view: materializeTreeView(prior),
      maxSpawnOrdinal: maxSeqOf(prior, (event) => event.kind === 'spawned'),
      // An open node's journaled cursor seq is reserved across processes: the resumed scope must
      // never mint it for another node, or the heal above could only ever collide.
      maxCursorSeq: reservedCursorFloor(prior),
      keys: keyedAssignments(prior, settled),
      priorSpend: sumMeasuredSpendFromEvents(prior),
    },
  }
}
