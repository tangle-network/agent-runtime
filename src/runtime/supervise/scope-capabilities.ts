import { ValidationError } from '../../errors'
import type { DriverAttemptRecord } from './driver-attempt-evidence'
import type { TeamProgress } from './progress'
import {
  releaseScopeRetainedOwnerEnvironment,
  scopeRetainedOwnerSettled,
} from './retained-scope-owner'
import type { LiveChild } from './scope-contract'
import type {
  HeldEnvironment,
  ProviderModelExecutionEvidence,
  Scope,
  SpawnEvent,
  Spend,
  SubtreeSummary,
  UnconfirmedTeardown,
} from './types'

type RuntimeOwnedProviderMeter = (
  spend: Spend,
  providerModel: ProviderModelExecutionEvidence | undefined,
  detail?: Record<string, unknown>,
  accountingOnly?: boolean,
  alreadySpent?: boolean,
) => Promise<void>

/** Runtime-owned provider evidence is written through this private scope capability. */
export const runtimeOwnedProviderMeters = new WeakMap<object, RuntimeOwnedProviderMeter>()
/** What {@link recordScopeOwnerPause} journals, less the fields the scope supplies. */
export type ScopeOwnerPause = Omit<
  Extract<SpawnEvent, { kind: 'paused' }>,
  'kind' | 'id' | 'seq' | 'at'
>
export const pauseRecorders = new WeakMap<object, (pause: ScopeOwnerPause) => Promise<void>>()
export const driverAttemptRecorders = new WeakMap<
  object,
  (record: DriverAttemptRecord) => Promise<void>
>()
export const recoveryStarters = new WeakMap<object, () => Promise<void>>()
export const retainedReleasers = new WeakMap<object, () => Promise<void>>()
export const heldReleasers = new WeakMap<object, () => Promise<void>>()
export const childDrains = new WeakMap<object, () => Promise<void>>()
export const retainedSlotClosers = new WeakMap<object, () => Promise<void>>()
export const teardownRetriers = new WeakMap<object, () => Promise<void>>()
export const teardownRetriable = new WeakMap<object, (release: boolean) => boolean>()
/** The retained owner environments a scope's last release could not confirm destroyed. */
const ownerUnconfirmedByScope = new WeakMap<object, ReadonlyArray<UnconfirmedTeardown>>()
/** The scope a recursive executor owns, so the settlement retry reaches its descendants. */
export const nestedTeardownScopes = new WeakMap<object, () => Scope<unknown> | undefined>()
/** Each scope's reader of the manager scopes its children own, read live. */
export const nestedManagerScopeReaders = new WeakMap<object, () => Scope<unknown>[]>()
/** A manager scope's release of its own environment, started once and joined by later callers. */
const managerEnvironmentReleases = new WeakMap<object, Promise<void>>()
/** Scopes whose settlement released retained environments: none of their retained children is
 *  kept for a resume any longer. */
export const releasingScopes = new WeakSet<object>()
export const admissionSeals = new WeakMap<object, () => void>()
/** Each scope's reader of its own team, for the settlement its owner writes one level up. */
export const subtreeReaders = new WeakMap<object, () => SubtreeSummary | undefined>()
/** A scope's live team and its owner's own turns, as the owner's lead observes them. */
export interface LiveTeam extends TeamProgress {
  /** Newest activity anywhere in the scope: the owner's own turn, or any agent below it. */
  readonly lastActivityAt: number
  /** Turns the scope's owner metered for itself. */
  readonly ownerTurns: number
}
/** Each scope's reader of its live team, for the progress its owner's lead reads mid-flight. */
export const liveTeamReaders = new WeakMap<object, () => LiveTeam>()

/** How many of a manager's direct children its summary lists; the counts always cover all. */
export const SUBTREE_RESULT_LIMIT = 8

/** @internal The bounded account of the children a scope spawned and everything below them.
 *  `undefined` when the scope spawned no worker. */
export function subtreeSummaryOf(scope: Scope<unknown>): SubtreeSummary | undefined {
  return subtreeReaders.get(scope)?.()
}

/** Per-child bound on a retained release: one remote destroy, answered or abandoned. */
export const RETAINED_RELEASE_TIMEOUT_MS = 30_000

/**
 * One unconfirmed child as the run names it: the node, the environments its executor still
 * reports holding, and what the last teardown attempt answered.
 *
 * Environments split by intent. Those kept on purpose go in `kept`, so a sweeper that deletes
 * `environments` never destroys work a resume would recover or evidence preserved on purpose.
 * The executor marks what it preserves as evidence. A retained-pending child is kept for a resume
 * until its scope releases retained environments at settlement: `releasing` says whether it has.
 * After a release, a retained environment still held is a leak like any other.
 */
export function unconfirmedTeardownOf(child: LiveChild, releasing: boolean): UnconfirmedTeardown {
  const keptForResume = child.recoveryPending === true && !releasing
  const environments: HeldEnvironment[] = []
  const kept: HeldEnvironment[] = []
  try {
    for (const environment of child.readHeldEnvironments?.() ?? []) {
      const keptFor = environment.keptFor ?? (keptForResume ? 'resume' : undefined)
      const named = Object.freeze({
        provider: environment.provider,
        environmentId: environment.environmentId,
        ...(keptFor === undefined ? {} : { keptFor }),
      })
      if (keptFor === undefined) environments.push(named)
      else kept.push(named)
    }
  } catch {
    // The read is contractually non-throwing; one that throws names nothing rather than failing
    // the barrier that reports the leak.
  }
  return Object.freeze({
    id: child.id,
    label: child.label,
    runtime: child.runtime,
    status: child.status,
    ...(environments.length === 0 ? {} : { environments: Object.freeze(environments) }),
    ...(kept.length === 0 ? {} : { kept: Object.freeze(kept) }),
    ...(child.teardownAttempts > 0 ? { attempts: child.teardownAttempts } : {}),
    ...(child.teardownDetail === undefined ? {} : { detail: child.teardownDetail }),
  })
}

/** Ten minutes: a manager that is alive decides within a turn or two; one that crashed, or a host
 *  that restarted, must not leave a paid environment running until a retire pass finds it. */
export const DEFAULT_BUDGET_STOP_HOLD_MS = 600_000

/**
 * @internal Release every environment this scope's settled children still hold after a budget
 * stop, at the join barrier: no later spawn of this scope can continue them. Each release journals
 * an `environment-teardown` with `heldRelease: 'scope-join'`. Never rejects.
 */
export async function releaseHeldEnvironments(scope: Scope<unknown>): Promise<void> {
  await heldReleasers.get(scope)?.()
}

/** @internal Admit original children before the parent acts; do not wait for their results. */
export async function startScopeRecoveries(scope: Scope<unknown>): Promise<void> {
  const start = recoveryStarters.get(scope)
  if (!start) return
  recoveryStarters.delete(scope)
  await start()
}

/**
 * @internal Release what this scope's settled children still hold for a retained execution, and
 * confirm each one's teardown afterwards through the executor's own teardown verb.
 *
 * A retained-pending child settles `down` with its cursor slot open and its environment alive,
 * because a resumed process reconciles the paid execution inside it. The supervisor calls this
 * once the root has reached a terminal outcome that no later process resumes — never while the
 * root is live, and never on a resumable interruption, since the open slot and the live
 * environment are exactly what a resume recovers. One `environment-teardown` receipt is journaled
 * per environment, on this scope's own tree; a nested manager reaches its children through
 * `Executor.releaseRetained`, and its nested scope journals theirs.
 */
export async function releaseRetainedEnvironments(
  scope: Scope<unknown>,
): Promise<ReadonlyArray<UnconfirmedTeardown>> {
  releasingScopes.add(scope)
  const release = retainedReleasers.get(scope)
  if (release) await release()
  // A nested manager whose own teardown confirmed is not among the children `release` reaches,
  // and it still holds the environment it kept between its turns.
  await releaseNestedManagerEnvironments(scope)
  ownerUnconfirmedByScope.set(scope, await releaseScopeRetainedOwnerEnvironment(scope))
  return unconfirmedTeardowns(scope)
}

/** The manager scopes this scope's children own, read live. */
function nestedManagerScopes(scope: Scope<unknown>): Scope<unknown>[] {
  return nestedManagerScopeReaders.get(scope)?.() ?? []
}

async function releaseNestedManagerEnvironments(scope: Scope<unknown>): Promise<void> {
  await Promise.all(
    nestedManagerScopes(scope).map(async (nested) => {
      await releaseNestedManagerEnvironments(nested)
      // One a retained release already reached keeps that release's answer.
      if (!ownerUnconfirmedByScope.has(nested)) await releaseManagerEnvironment(nested)
    }),
  )
}

/**
 * @internal Release the environment a manager kept between its turns, once its own scope has
 * finished and no turn of it will run again. The release first waits for the manager's last
 * end-of-turn capture, so it runs in the background of the manager's settlement; a later call,
 * including the run's settlement sweep, joins it. Its receipt is journaled in the manager's own
 * tree. It is the manager's own resource, not one of its descendants, so it never changes the
 * teardown answer its executor gives the parent.
 */
export function releaseManagerEnvironment(scope: Scope<unknown>): Promise<void> {
  let release = managerEnvironmentReleases.get(scope)
  if (release === undefined) {
    release = releaseScopeRetainedOwnerEnvironment(scope).then(() => undefined)
    managerEnvironmentReleases.set(scope, release)
  }
  return release
}

/**
 * @internal Wait for the work every manager in this scope's tree still has in flight after its
 * node settled: the end-of-turn capture its last turn handed over, and the release of its
 * environment. The run's settlement awaits it under either retention policy, so nothing writes to
 * the run's journal after the run settles and no capture is cut short by the process exiting.
 */
export async function settleManagerWork(scope: Scope<unknown>): Promise<void> {
  await Promise.all(nestedManagerScopes(scope).map((nested) => settleManagerWork(nested)))
  await scopeRetainedOwnerSettled(scope)
  await managerEnvironmentReleases.get(scope)?.catch(() => undefined)
}

/**
 * @internal Close the cursor slot of every retained child this scope and its nested scopes still
 * hold open, once the settlement is final and the release and its retries are done.
 *
 * The release sweep closes a slot only when it confirms the environment destroyed, and nothing
 * else ever closed the rest: a refused delete, a teardown probe that failed after a destroy, or an
 * admission that timed out before `create` named an environment. Measured on the Discovery fleet
 * of 2026-09-23/24 (Runtime 0.249.1 to 0.261.0): 338 of 1,620 agents never settled, so they had no
 * terminal record, no spend but the reservation ceiling, and no transcript receipt (#1301). A
 * settlement under `retainedAtSettlement: 'release'` is final, so no process will recover these
 * executions. Each slot closes with the settlement the driver already received, under the seq it
 * saw, marked `retainedExecution: 'release-unconfirmed'`. The environment it may still hold stays
 * named by its `teardown-unconfirmed` record for a sweeper. Never call this on a run a later
 * process may resume.
 */
export async function closeRetainedSlots(scope: Scope<unknown>): Promise<void> {
  const close = retainedSlotClosers.get(scope)
  if (close) await close()
}

/**
 * @internal Everything this scope cannot prove destroyed: its settled children whose teardown is
 * unconfirmed and, after a release, the retained owner environment that release could not
 * confirm. Read live, so a later retry that confirms a node removes it.
 */
export function unconfirmedTeardowns(scope: Scope<unknown>): ReadonlyArray<UnconfirmedTeardown> {
  return [...scope.workerCapacity.unconfirmed, ...(ownerUnconfirmedByScope.get(scope) ?? [])]
}

/** @internal Let the settlement retry reach the scope a recursive executor owns. */
export function registerNestedTeardownScope(
  executor: object,
  read: () => Scope<unknown> | undefined,
): void {
  nestedTeardownScopes.set(executor, read)
}

/**
 * @internal Ask each settled child whose teardown is still unconfirmed to tear down once more,
 * and resolve when every attempt has answered.
 *
 * A child's first teardown runs inside its settlement with a short acknowledgement window, and a
 * provider delete that fails once or answers late then leaves its sandbox running for good. This
 * is one retry pass; the supervisor paces passes with backoff inside a bounded window, and a
 * nested manager runs one pass over its own scope each time its teardown is asked again, so the
 * retry reaches every level of the tree.
 *
 * A retained-pending child is skipped: its executor answers `destroyed: false` by construction
 * while a resume may still reconcile it, and `releaseRetainedEnvironments` owns its release. An
 * attempt still in flight from an earlier pass is awaited, never duplicated. Never rejects.
 */
export async function retryUnconfirmedTeardowns(scope: Scope<unknown>): Promise<void> {
  const retry = teardownRetriers.get(scope)
  if (retry) await retry()
}

/**
 * @internal Whether another retry can still change this scope's unconfirmed set. With `release`
 * the run releases retained environments at settlement, so a retained child or owner whose
 * release failed can still be released again; without it those are kept for a resume, and only
 * an ordinary unconfirmed teardown counts.
 */
export function hasRetriableTeardowns(scope: Scope<unknown>, release: boolean): boolean {
  return teardownRetriable.get(scope)?.(release) ?? false
}

/**
 * @internal Close this scope to NEW children. Idempotent, synchronous, and irreversible.
 *
 * The supervisor calls it the instant the root `act` has settled, before the join barrier drains.
 * A driver's `act` returning does not stop everything that holds its scope: a supervisor tool
 * whose handler outran its response fence keeps running detached (`single-flight-tools`
 * `background()`) with the coordination verbs still bound, and a verb call reaches `spawn`
 * in-process — closing the MCP listener does not reach it. Measured 2026-09-14: such a handler
 * spawned `distill:all` 309 ms after the barrier had drained and released. The child was
 * admitted, took a conserved reservation, built a sandbox, ran 12.4 s of provider work, and
 * journaled its settlement 19 s after the run had already written its failure — while the live
 * reservation it legitimately held was read back at the barrier as a conserved-pool leak and
 * threw away 63 settled children.
 *
 * Nothing admitted here could reach the result anyway: the driver has already selected over the
 * settled ledger. Sealing is total because `spawn` never suspends between this gate and the
 * point the child is registered and its ticket marked `executing`, so no spawn can straddle it.
 *
 * Not a `Scope` method: an Agent must not be able to close its own siblings out of the run.
 */
export function closeScopeAdmission(scope: Scope<unknown>): void {
  admissionSeals.get(scope)?.()
}

/** Join local observers after abort without requiring a writable settlement journal. */
export async function waitForScopeChildren(scope: Scope<unknown>): Promise<void> {
  await childDrains.get(scope)?.()
}

/** @internal Meter one Runtime-owned provider attempt into the durable scope journal. */
export function meterRuntimeOwnedProviderAttempt(
  scope: Scope<unknown>,
  spend: Spend,
  providerModel: ProviderModelExecutionEvidence,
  detail?: Record<string, unknown>,
): Promise<void> {
  const meter = runtimeOwnedProviderMeters.get(scope as object)
  if (meter === undefined) {
    throw new ValidationError('scope: Runtime-owned provider meter is not bound to this scope')
  }
  return meter(spend, providerModel, detail)
}

/**
 * @internal Journal that this scope's owner paused on an unavailable upstream. The pause is the
 * owner's, so it is recorded against the owner node, beside its `metered` turns.
 */
export function recordScopeOwnerPause(
  scope: Scope<unknown>,
  pause: ScopeOwnerPause,
): Promise<void> {
  const record = pauseRecorders.get(scope as object)
  if (record === undefined) {
    throw new ValidationError('scope: pause recorder is not bound to this scope')
  }
  return record(pause)
}

/** @internal Persist the owner's driver outcome even after its scope has been aborted. */
export function recordScopeOwnerDriverAttempt(
  scope: Scope<unknown>,
  attempt: DriverAttemptRecord,
): Promise<void> {
  const record = driverAttemptRecorders.get(scope as object)
  if (record === undefined) {
    throw new ValidationError('scope: driver attempt recorder is not bound to this scope')
  }
  return record(attempt)
}

/**
 * @internal Meter Runtime-owned accounting that does not represent provider execution.
 * `alreadySpent` marks work that finished with no caller left to refuse it: under a dollar cap its
 * unknown dollars close dollar admission instead of being refused (`BudgetPool.observe`).
 */
export function meterRuntimeOwnedAccounting(
  scope: Scope<unknown>,
  spend: Spend,
  detail?: Record<string, unknown>,
  options?: { readonly alreadySpent?: boolean },
): Promise<void> {
  const meter = runtimeOwnedProviderMeters.get(scope as object)
  if (meter === undefined) {
    throw new ValidationError('scope: Runtime-owned provider meter is not bound to this scope')
  }
  return meter(spend, undefined, detail, true, options?.alreadySpent === true)
}
