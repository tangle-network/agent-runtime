import {
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import {
  closesCursorSlot,
  contentAddress,
  materializeTreeView,
  ownedTreeRootSpawn,
  pendingWaits,
  replaySpawnTree,
} from '../../durable/spawn-journal'
import { RuntimeRunStateError } from '../../errors'
import { addSpend, zeroSpend } from '../util'
import { assertValidSpend, type BudgetPoolRestore, createBudgetPool } from './budget'
import { executorFailureReason } from './executor-outcome'
import { prepareRetainedExecutor, type RetainedChildRecovery } from './retained-executor'
import type { ScopeArgs } from './scope'
import { detachedSnapshot } from './snapshot'
import { nestedDriverTreeRoot } from './tree-key'
import type {
  Budget,
  NodeId,
  ResumedKeyState,
  Settled,
  SpawnEvent,
  Spend,
  SupervisorOpts,
} from './types'

type ResumeStores = Pick<SupervisorOpts, 'runId' | 'journal' | 'blobs' | 'recoverExecutor'>
type Spawned = Extract<SpawnEvent, { kind: 'spawned' }>
type RecordedResult = Extract<SpawnEvent, { kind: 'execution-result' }>

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
  const accepted: Array<{ result: RecordedResult; violation?: string }> = []
  const rootBudget = events.find(
    (event): event is Spawned => event.kind === 'spawned' && event.parent === undefined,
  )?.budget
  for (const node of interrupted) {
    signal.throwIfAborted()
    const owned = events.filter((event) => event.id === node.id)
    const recorded = owned.find(
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
      let violation: string | undefined
      try {
        validation.reconcile(reservation.ticket, recorded.spent)
      } catch (error) {
        violation = error instanceof Error ? error.message : String(error)
      }
      accepted.push({ result: recorded, ...(violation === undefined ? {} : { violation }) })
      continue
    }
    const admissions = owned.flatMap((event) =>
      event.kind === 'execution-admitted' ? [event.admission] : [],
    )
    if (!opts.recoverExecutor || (admissions.length === 0 && !node.ownedTreeRoot)) continue
    const input = owned.find((event) => event.kind === 'execution-input')
    const taskRef = input?.kind === 'execution-input' ? input.taskRef : undefined
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
    recoveries.push({
      ...detachedSnapshot(
        {
          spawned: node,
          task,
          admissions,
          ...(priorMaterialization === undefined ? {} : { priorMaterialization }),
        },
        'retained child recovery',
      ),
      spec: prepared?.spec ?? { profile, harness: null, execution: node.identity },
      factory: prepared?.factory ?? opts.recoverExecutor,
    })
  }
  let seq =
    events.reduce((max, event) => (closesCursorSlot(event) ? Math.max(max, event.seq) : max), -1) +
    1
  for (const { result, violation } of accepted) {
    signal.throwIfAborted()
    const failureReason = executorFailureReason(result)
    const reason = violation ?? failureReason
    // Await every admitted write before releasing the run lock, including cancellation races.
    await opts.journal.appendEvent(opts.runId, {
      kind: 'settled',
      id: result.id,
      status: reason === undefined ? 'done' : 'down',
      outRef: result.outRef,
      ...(reason === undefined ? {} : { infra: violation !== undefined, reason }),
      spent: result.spent,
      ...(result.verdict ? { verdict: result.verdict } : {}),
      seq: seq++,
      at: new Date(now()).toISOString(),
    })
  }
  signal.throwIfAborted()
  return { events: (await opts.journal.loadTree(opts.runId)) ?? events, recoveries }
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
 * event with no matching settlement is `in-doubt`: the process died with it in flight.
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

/** Child reservations whose spawn was durable but whose terminal record never landed. */
export function uncertainSpawnBudgets(
  events: SpawnEvent[],
  recovered: ReadonlySet<NodeId> = new Set(),
): Budget[] {
  const terminal = new Set(events.filter(closesCursorSlot).map((event) => event.id))
  return events
    .filter(
      (event): event is Spawned =>
        event.kind === 'spawned' &&
        event.parent !== undefined &&
        !terminal.has(event.id) &&
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

/** Per-channel sum over a journaled event list: `settled` = spawned-child work (reconciled);
 *  `metered` = driver inference (re-homed up the tree, so a single root-tree pass already
 *  includes every nested driver's inference). */
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
    if (ev.kind === 'settled' || (ev.kind === 'cancelled' && ev.spent !== undefined))
      childWork = addSpend(childWork, ev.spent!)
    else if (ev.kind === 'metered') driverInference = addSpend(driverInference, ev.spend)
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
  const prepared = await prepareInterruptedExecutors(opts, events, signal, now, parentId)
  const prior = prepared.events
  const recovering = new Set(prepared.recoveries.map((item) => item.spawned.id))
  // A restored manager's full reservation already covers its previous inference.
  // Its executor reconciles total spend and publishes only the unrecorded meter delta.
  const measured = sumMeasuredSpendFromEvents(
    prior.filter((event) => event.kind !== 'metered' || !recovering.has(event.id)),
  )
  const settled = await replaySpawnTree(opts.journal, opts.blobs, opts.runId)
  signal.throwIfAborted()
  return {
    poolRestore: {
      committed: addSpend(measured.childWork, measured.driverInference),
      uncertainReservations: uncertainSpawnBudgets(prior, recovering),
    },
    resumeFrom: {
      events: prior,
      recoveries: prepared.recoveries,
      settled,
      view: materializeTreeView(prior),
      maxSpawnOrdinal: maxSeqOf(prior, (event) => event.kind === 'spawned'),
      maxCursorSeq: maxSeqOf(prior, closesCursorSlot),
      maxWaitOrdinal: maxSeqOf(prior, (event) => event.kind === 'waiting'),
      waits: pendingWaits(prior),
      keys: keyedAssignments(prior, settled),
      priorSpend: sumMeasuredSpendFromEvents(prior),
    },
  }
}
