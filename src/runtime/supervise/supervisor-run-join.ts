import { loadSpawnForest } from '../../durable/spawn-journal/spawn-forest'
import { RunCancellationReason } from './abortable'
import type { ScopeResumeState } from './recover-executors'
import { RELEASE_DESTROY_MS } from './retained-owner-release'
import type { ReleaseClock } from './retained-owner-state'
import type { guardRunPersistence } from './run-persistence'
import {
  boundRetainedReleases,
  closeRetainedSlots,
  hasRetriableTeardowns,
  releaseHeldEnvironments,
  releaseRetainedEnvironments,
  settleManagerWork,
  unconfirmedTeardowns,
} from './scope'
import { appendTeardownConfirmation } from './scope-settlement'
import {
  confirmSettledTeardowns,
  drainLiveChildren,
  unconfirmedRecord,
} from './supervisor-child-join'
import type { HeldEnvironment, Scope, SupervisorOpts, UnconfirmedTeardown } from './types'

/** The join barrier of one run: what it reads, and the teardown evidence it leaves. */
export interface RunJoin {
  readonly scope: Scope<unknown>
  readonly controller: AbortController
  readonly opts: SupervisorOpts
  readonly now: () => number
  readonly persistence: ReturnType<typeof guardRunPersistence>
  readonly retainedAtSettlement: 'release' | 'keep'
  readonly resumeFrom: ScopeResumeState | undefined
  /** Settled children whose executor teardown was never acknowledged, surfaced on every result arm
   *  so the leak is loud without voiding the run. A throwing barrier leaves what it had read. */
  teardownUnconfirmed: ReadonlyArray<UnconfirmedTeardown>
  /** `teardown-*` records live outside the cursor namespace, like `metered`/`edge`. */
  teardownSeq: number
}

/**
 * Join barrier: tear down every still-live child. Generalizes the kernel's
 * `finally{ Promise.allSettled(destroy) }` — a teardown throw is allSettled'd and journaled.
 * `settleGraceMs` lets live children of a root that was not cancelled reach their own terminal
 * state first (#741).
 */
export async function joinRunChildren(
  join: RunJoin,
  settleGraceMs: Parameters<typeof drainLiveChildren>[2],
): Promise<void> {
  const { scope, persistence } = join
  await drainLiveChildren(scope, join.controller, settleGraceMs)
  // No later spawn can continue a budget-stopped worker, so what it held is released now.
  await releaseHeldEnvironments(scope)
  join.teardownUnconfirmed = unconfirmedTeardowns(scope)
  // A retained-pending child kept its environment so a resuming process could reconcile the paid
  // execution. When the run will not be resumed nothing would: four settled `no-winner` runs held 18
  // of a 60-slot fleet for 19 to 37 hours. The caller knows whether a later process
  // resumes, so the policy decides; the unconfirmed set is re-read so released nodes drop out.
  const releasing = !persistence.failed && join.retainedAtSettlement === 'release'
  // Every level of the tree releases at once under one clock, started by the tree's first destroy
  // request: each owner's destroys get one destroy wait from when it asks, after its captures, and
  // retries end with the clock's window. Releasing the tree one level after another, each level
  // waiting its own deadline, took 22 minutes on a 28-box cancel.
  const clock: ReleaseClock = {
    windowMs: Math.max(join.opts.teardownConfirmMs ?? 0, RELEASE_DESTROY_MS),
  }
  if (releasing) boundRetainedReleases(scope, clock)
  // A settled manager may still be capturing its last turn's workspace and releasing its
  // environment; both finish before the run settles. The run's release joins that work instead of
  // waiting for it, since each release waits for its own manager's capture before any destroy.
  await Promise.all([
    settleManagerWork(scope),
    releasing ? releaseRetainedEnvironments(scope) : undefined,
  ])
  join.teardownUnconfirmed = unconfirmedTeardowns(scope)
  // The retries share the release's clock; with no destroy asked, they open once settlement is done.
  const opensAt = clock.startedAt ?? Date.now()
  await confirmRetriableTeardowns(join, releasing, opensAt)
  // An expired or cancelled resume can stop before adopting retained children.
  // Preserve those nodes and name their source environments instead of implying
  // that the empty live scope confirmed their cleanup.
  join.teardownUnconfirmed = await unrecoveredRetainedChildren(join)
  // The leak must surface: journaled per node (durable evidence, naming the environment ids a
  // sweeper deletes) without voiding the run's outcome.
  for (const node of join.teardownUnconfirmed) {
    await join.opts.journal.appendEvent(join.opts.runId, {
      kind: 'teardown-unconfirmed',
      ...unconfirmedRecord(node),
      seq: join.teardownSeq++,
      at: new Date(join.now()).toISOString(),
    })
  }
  // A released run is never resumed, so a retained child whose release the retries could not
  // confirm is final: its slot closes now as `release-unconfirmed` (#1301), the leak named above.
  if (releasing) await closeRetainedSlots(scope)
}

/** Retained custody absent from the live scope, including a cold cancellation without ports. */
async function unrecoveredRetainedChildren(join: RunJoin): Promise<UnconfirmedTeardown[]> {
  const { scope, resumeFrom } = join
  const adopted = new Set(scope.view.nodes.map((node) => node.id))
  const unrecovered: UnconfirmedTeardown[] = []
  for (const recovery of resumeFrom?.recoveries ?? []) {
    if (adopted.has(recovery.spawned.id)) continue
    const environments = new Map<string, HeldEnvironment>()
    for (const admission of recovery.admissions) {
      const environment =
        admission.phase === 'environment'
          ? admission
          : admission.phase === 'dispatched'
            ? admission.controlRef
            : undefined
      if (environment === undefined) continue
      const ref = {
        provider: environment.provider,
        environmentId: environment.environmentId,
        keptFor: 'evidence' as const,
      }
      environments.set(JSON.stringify([ref.provider, ref.environmentId]), ref)
    }
    unrecovered.push({
      id: recovery.spawned.id,
      label: recovery.spawned.label,
      runtime: recovery.spawned.runtime,
      status:
        resumeFrom?.view.nodes.find((node) => node.id === recovery.spawned.id)?.status ?? 'pending',
      ...(environments.size === 0 ? {} : { kept: [...environments.values()] }),
      attempts: 0,
      detail:
        'Retained child was not recovered before settlement; source evidence and teardown remain unverified.',
    })
  }
  const unconfirmed = new Map(
    [...join.teardownUnconfirmed, ...unrecovered].map((node) => [node.id, node]),
  )
  if (resumeFrom === undefined || !(join.opts.signal?.reason instanceof RunCancellationReason))
    return [...unconfirmed.values()]
  const forest = await loadSpawnForest(join.opts.journal, join.opts.runId)
  const nestedOwners = new Set(
    forest.nodes.filter((node) => node.ownedTreeRoot !== undefined).map((node) => node.id),
  )
  type Position = { tree: string; index: number; at: number }
  type Custody = { ref: HeldEnvironment; admissions: Map<string, Position> }
  const destroyed = new Map<string, Position[]>()
  const confirmed = new Map<string, Position[]>()
  const refs = new Map<string, Map<string, Custody>>()
  const pending = new Map<string, { id: string; position: Position }>()
  const keyOf = (provider: string, environmentId: string) =>
    JSON.stringify([provider, environmentId])
  const later = (proof: Position, admission: Position) =>
    proof.tree === admission.tree
      ? proof.index > admission.index
      : Number.isFinite(proof.at) && Number.isFinite(admission.at) && proof.at > admission.at
  for (const [index, { treeRoot, event }] of forest.events.entries()) {
    const position = { tree: treeRoot, index, at: Date.parse(event.at) }
    const invocation = JSON.stringify([treeRoot, event.id])
    if (event.kind === 'environment-teardown' && event.destroyed) {
      const key = keyOf(event.provider, event.environmentId)
      destroyed.set(key, [...(destroyed.get(key) ?? []), position])
    }
    if (event.kind === 'teardown-confirmed')
      confirmed.set(event.id, [...(confirmed.get(event.id) ?? []), position])
    if (
      event.kind === 'execution-input' ||
      event.kind === 'execution-result' ||
      event.kind === 'execution-abandoned'
    )
      pending.delete(invocation)
    if (event.kind !== 'execution-admitted') continue
    const admission = event.admission
    const environment =
      admission.phase === 'environment'
        ? admission
        : admission.phase === 'dispatched'
          ? admission.controlRef
          : undefined
    if (environment === undefined) {
      pending.set(invocation, { id: event.id, position })
      continue
    }
    pending.delete(invocation)
    const held = refs.get(event.id) ?? new Map<string, Custody>()
    const key = keyOf(environment.provider, environment.environmentId)
    const custody = held.get(key) ?? {
      ref: {
        provider: environment.provider,
        environmentId: environment.environmentId,
        keptFor: 'evidence' as const,
      },
      admissions: new Map<string, Position>(),
    }
    custody.admissions.set(treeRoot, position)
    held.set(key, custody)
    refs.set(event.id, held)
  }
  const discharged = (id: string, key: string, custody: Custody) =>
    [...custody.admissions.values()].every((admission) =>
      [
        ...(destroyed.get(key) ?? []),
        ...(nestedOwners.has(id) ? [] : (confirmed.get(id) ?? [])),
      ].some((proof) => later(proof, admission)),
    )
  const unknown = new Set(
    [...pending.values()]
      .filter(
        ({ id, position }) => !(confirmed.get(id) ?? []).some((proof) => later(proof, position)),
      )
      .map(({ id }) => id),
  )
  for (const [id, node] of unconfirmed) {
    if (node.attempts !== 0 || node.environments?.length || !node.kept?.length || unknown.has(id))
      continue
    if (
      node.kept.every((ref) => {
        const key = keyOf(ref.provider, ref.environmentId)
        const custody = refs.get(id)?.get(key)
        return custody !== undefined && discharged(id, key, custody)
      })
    )
      unconfirmed.delete(id)
  }
  for (const node of forest.nodes) {
    const kept = [...(refs.get(node.id) ?? [])]
      .filter(([key, custody]) => !discharged(node.id, key, custody))
      .map(([, custody]) => custody.ref)
    if (kept.length === 0 && !unknown.has(node.id)) continue
    const prior = unconfirmed.get(node.id)
    const covered = new Set(
      [...(prior?.kept ?? []), ...(prior?.environments ?? [])].map((ref) =>
        keyOf(ref.provider, ref.environmentId),
      ),
    )
    const missing = kept.filter((ref) => !covered.has(keyOf(ref.provider, ref.environmentId)))
    if (prior !== undefined && missing.length === 0) continue
    unconfirmed.set(node.id, {
      ...(prior ?? {
        id: node.id,
        label: node.label,
        runtime: node.runtime,
        status: node.status,
        attempts: 0,
      }),
      ...((prior?.kept?.length ?? 0) + missing.length > 0
        ? { kept: [...(prior?.kept ?? []), ...missing] }
        : {}),
      detail:
        prior?.detail ??
        'Prior admitted execution has no confirmed teardown; source custody remains unverified.',
    })
  }
  return [...unconfirmed.values()]
}

/**
 * A first teardown that failed or answered late is not the provider's last word, and a run that
 * settles over it leaves the sandbox running: cancelling 20 Discovery lanes
 * left 2 workers running. Ask again until confirmed or out of time.
 */
async function confirmRetriableTeardowns(
  join: RunJoin,
  releasing: boolean,
  opensAt: number,
): Promise<void> {
  const { opts, scope } = join
  // The default window is one destroy wait, so the retries fit inside the first release's. The
  // first release counts against the window; one that used it all leaves no retry.
  const confirmWindowMs = opts.teardownConfirmMs ?? RELEASE_DESTROY_MS
  if (
    !(
      join.teardownUnconfirmed.length > 0 &&
      opensAt + confirmWindowMs > Date.now() &&
      hasRetriableTeardowns(scope, releasing)
    )
  ) {
    return
  }
  // A process dying inside this window must not lose the environment ids: durable before the first retry.
  const pending = join.teardownUnconfirmed
  for (const node of pending) {
    await opts.journal.appendEvent(opts.runId, {
      kind: 'teardown-pending',
      ...unconfirmedRecord(node),
      seq: join.teardownSeq++,
      at: new Date(join.now()).toISOString(),
    })
  }
  join.teardownUnconfirmed = await confirmSettledTeardowns(
    scope,
    confirmWindowMs,
    releasing,
    opensAt,
  )
  const still = new Set(join.teardownUnconfirmed.map((node) => node.id))
  for (const node of pending) {
    if (still.has(node.id)) continue
    await appendTeardownConfirmation(
      opts.journal,
      opts.runId,
      node.id,
      new Date(join.now()).toISOString(),
    )
  }
}
