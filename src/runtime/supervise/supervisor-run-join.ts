import type { ScopeResumeState } from './recover-executors'
import type { guardRunPersistence } from './run-persistence'
import {
  closeRetainedSlots,
  hasRetriableTeardowns,
  releaseHeldEnvironments,
  releaseRetainedEnvironments,
  settleManagerWork,
  unconfirmedTeardowns,
} from './scope'
import {
  confirmSettledTeardowns,
  DEFAULT_TEARDOWN_CONFIRM_MS,
  drainLiveChildren,
  unconfirmedRecord,
} from './supervisor-child-join'
import type { Scope, SupervisorOpts, UnconfirmedTeardown } from './types'

/** The join barrier of one run: what it reads, and the teardown evidence it leaves. */
export interface RunJoin {
  readonly scope: Scope<unknown>
  readonly controller: AbortController
  readonly opts: SupervisorOpts
  readonly now: () => number
  readonly persistence: ReturnType<typeof guardRunPersistence>
  readonly retainedAtSettlement: 'release' | 'keep'
  readonly resumeFrom: ScopeResumeState | undefined
  /** Settled children whose executor teardown was never acknowledged, read at the join barrier.
   *  Surfaced on every result arm so the leak is loud without voiding the run. A barrier that
   *  throws leaves what it had read so far. */
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
  // A manager that settled may still be capturing the workspace of its last turn, which
  // it took over so that its node could settle first, and may be releasing its
  // environment after it. Both finish before the run settles, under either policy.
  await settleManagerWork(scope)
  // A retained-pending child kept its environment through the barrier so that a process
  // resuming this run could reconcile the paid execution inside it. When the run will not
  // be resumed, nothing ever would — measured 2026-09-11, four settled `no-winner` runs
  // held 18 of a 60-slot fleet for 19 to 37 hours and later runs were refused for capacity.
  // Whether a later process resumes is the caller's knowledge, not the outcome's, so the
  // policy decides; the unconfirmed set is re-read so a released node is no longer named.
  if (!persistence.failed && join.retainedAtSettlement === 'release') {
    join.teardownUnconfirmed = await releaseRetainedEnvironments(scope)
  }
  const releasing = !persistence.failed && join.retainedAtSettlement === 'release'
  await confirmRetriableTeardowns(join, releasing)
  // An expired or cancelled resume can stop before adopting retained children.
  // Preserve those nodes and name their source environments instead of implying
  // that the empty live scope confirmed their cleanup.
  join.teardownUnconfirmed = [
    ...join.teardownUnconfirmed,
    ...unrecoveredRetainedChildren(scope, join.resumeFrom),
  ]
  // The leak is real and must surface, so it is journaled per node — durable evidence a
  // fleet autopsy reads without the run's outcome being voided by cleanup bookkeeping,
  // naming the environment ids an operator's sweeper deletes.
  for (const node of join.teardownUnconfirmed) {
    await join.opts.journal.appendEvent(join.opts.runId, {
      kind: 'teardown-unconfirmed',
      ...unconfirmedRecord(node),
      seq: join.teardownSeq++,
      at: new Date(join.now()).toISOString(),
    })
  }
  // A released run is never resumed, so a retained child whose release the retries could
  // not confirm is as final as a released one. Its slot closes now, marked
  // `release-unconfirmed`, with the leak already named above; left open, it read as
  // never-settled forever (#1301).
  if (releasing) await closeRetainedSlots(scope)
}

/**
 * A first teardown that failed or answered late is not the provider's last word, and a run that
 * settles over it leaves the sandbox running: measured 2026-09-20, cancelling 20 Discovery lanes
 * left 2 workers running. Ask again until confirmed or out of time.
 */
async function confirmRetriableTeardowns(join: RunJoin, releasing: boolean): Promise<void> {
  const { opts, scope } = join
  const confirmWindowMs = opts.teardownConfirmMs ?? DEFAULT_TEARDOWN_CONFIRM_MS
  if (
    !(
      join.teardownUnconfirmed.length > 0 &&
      confirmWindowMs > 0 &&
      hasRetriableTeardowns(scope, releasing)
    )
  ) {
    return
  }
  // The window can last minutes, and a process that dies inside it must not lose the
  // environment ids: the pending set is durable before the first retry.
  const pending = join.teardownUnconfirmed
  for (const node of pending) {
    await opts.journal.appendEvent(opts.runId, {
      kind: 'teardown-pending',
      ...unconfirmedRecord(node),
      seq: join.teardownSeq++,
      at: new Date(join.now()).toISOString(),
    })
  }
  join.teardownUnconfirmed = await confirmSettledTeardowns(scope, confirmWindowMs, releasing)
  const still = new Set(join.teardownUnconfirmed.map((node) => node.id))
  for (const node of pending) {
    if (still.has(node.id)) continue
    await opts.journal.appendEvent(opts.runId, {
      kind: 'teardown-confirmed',
      id: node.id,
      seq: join.teardownSeq++,
      at: new Date(join.now()).toISOString(),
    })
  }
}

/** Retained children a resume restored from the journal but never adopted into the live scope. */
function unrecoveredRetainedChildren(
  scope: Scope<unknown>,
  resumeFrom: ScopeResumeState | undefined,
): UnconfirmedTeardown[] {
  const adopted = new Set(scope.view.nodes.map((node) => node.id))
  const unrecovered: UnconfirmedTeardown[] = []
  for (const recovery of resumeFrom?.recoveries ?? []) {
    if (adopted.has(recovery.spawned.id)) continue
    const environments = new Map<
      string,
      { provider: string; environmentId: string; keptFor: 'evidence' }
    >()
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
  return unrecovered
}
