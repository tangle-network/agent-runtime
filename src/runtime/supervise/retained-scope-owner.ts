import {
  type AgentWorkspaceBranching,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
  workspaceCheckpointRequestDigest,
  workspaceCheckpointResultMatchesRequest,
  workspaceCleanupAcknowledgementMatches,
  workspaceCleanupRequestDigest,
} from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { environmentReader, type SpawnResourceReader } from '../../mcp/tools/spawn-resource-paths'
import type { RetainedRunAdmission, RetainedRunEnvironmentAdmission } from '../retained-run-types'
import { addSpend, zeroSpend } from '../util'
import { runAbortable } from './abortable'
import { assertValidSpend } from './budget'
import { executorFailureReason } from './executor-outcome'
import type {
  RetainedExecutorContext,
  RetainedWorkspaceRestore,
  RetainedWorkspaceRestoreReceipt,
} from './retained-executor'
import { detachedSnapshot } from './snapshot'
import type {
  ExecutorResult,
  NodeId,
  ResultBlobStore,
  Scope,
  SpawnEvent,
  SpawnJournal,
  UnconfirmedTeardown,
  WorkspaceCheckpointMarker,
} from './types'
import {
  WORKSPACE_CHECKPOINT_MARKER_PATH,
  WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS,
  WORKSPACE_CHECKPOINT_TIMEOUT_MS,
  WORKSPACE_CHECKPOINTS_KEPT,
  writeWorkspaceMarker,
} from './workspace-checkpoint'

interface OwnerState {
  readonly admissions: RetainedRunAdmission[]
  readonly context: RetainedExecutorContext
  readonly args: OwnerRegistration
  inputSequence?: number
  prepared?: boolean
  acceptedConsumed?: boolean
  priorSession?: RetainedRunEnvironmentAdmission
  provider?: AgentEnvironmentProvider
  /** The provider backend captures executable workspace evidence for unsettled owner turns. */
  workspaceRetention: boolean
  /** The owner's current environment id, from its executor's materialization receipt. Set by the
   *  drive harness; populated on the retained AND non-retained provider paths, where an
   *  `environment` admission exists only on the retained one. */
  liveEnvironmentId?: () => string | undefined
  nextSequence: () => number
  /** Whether the last release left an environment that another release could still destroy: a
   *  failed or unanswered destroy, not a source preserved on purpose. */
  releaseRetriable?: boolean
  taskRef?: string
  accepted?: ExecutorResult<unknown>
  acceptedRef?: Extract<SpawnEvent, { kind: 'execution-result' }>
  /** The checkpoint the current invocation's NEW environment starts from, if any. */
  restore?: RetainedWorkspaceRestore
  /** The checkpoint in progress, so two never run at once. */
  checkpointing?: Promise<void>
  checkpointHandles?: Map<string, AgentWorkspaceBranching>
  lastCheckpointAt?: number
  /** Set once checkpoints cannot be taken for this owner, with why; no later call retries. */
  checkpointsUnavailable?: string
}
interface OwnerRegistration {
  readonly rootId: NodeId
  readonly nodeId: NodeId
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly priorEvents: readonly SpawnEvent[]
  readonly now: () => number
}
const owners = new WeakMap<object, OwnerState>()

/** @internal Scope construction carries this private policy to every nested owner scope. */
export const retainedOwnerWorkspaceRetentionSeamKey = 'runtime.retainedOwnerWorkspaceRetention'

/** The scope owns these writers; provider adapters receive only the restricted context. */
export function registerScopeRetainedOwner(scope: Scope<unknown>, args: OwnerRegistration): void {
  const events = args.priorEvents.filter((event) => 'id' in event && event.id === args.nodeId)
  const taskEvent = [...events].reverse().find((event) => event.kind === 'execution-input')
  const start = taskEvent === undefined ? 0 : events.indexOf(taskEvent)
  const attempt = events.slice(start)
  const beforeInput = taskEvent === undefined ? [] : events.slice(0, start)
  const priorInput = [...beforeInput].reverse().find((event) => event.kind === 'execution-input')
  const priorAttempt =
    priorInput === undefined ? [] : beforeInput.slice(beforeInput.indexOf(priorInput))
  const admissions = attempt.flatMap((event) =>
    event.kind === 'execution-admitted' ? [event.admission] : [],
  )
  const acceptedRef = [...attempt].reverse().find((event) => event.kind === 'execution-result')
  const priorResult = [...priorAttempt].reverse().find((event) => event.kind === 'execution-result')
  const priorSession =
    priorResult?.kind === 'execution-result'
      ? priorAttempt
          .slice(0, priorAttempt.indexOf(priorResult))
          .reverse()
          .flatMap((event) =>
            event.kind === 'execution-admitted' && event.admission.phase === 'environment'
              ? [event.admission]
              : [],
          )[0]
      : undefined
  let sequence = Math.max(0, ...events.map((event) => ('seq' in event ? event.seq : 0)))
  const state: OwnerState = {
    args,
    admissions,
    workspaceRetention: false,
    nextSequence: () => ++sequence,
    ...(taskEvent?.kind === 'execution-input'
      ? { taskRef: taskEvent.taskRef, inputSequence: taskEvent.seq }
      : {}),
    ...(acceptedRef?.kind === 'execution-result' ? { acceptedRef } : {}),
    ...(priorSession ? { priorSession } : {}),
    context: {
      get executionId() {
        if (state.inputSequence === undefined)
          throw new ValidationError('retained owner input was not committed')
        return `${args.nodeId}:input:${state.inputSequence}`
      },
      get priorSession() {
        return state.priorSession
      },
      // The first retained turn must stay alive so a later deliberate invocation can reuse it.
      // The owning scope releases it once the complete manager scope finishes.
      preserveEnvironment: true,
      admissions,
      get restoreWorkspace() {
        return state.restore
      },
      onWorkspaceRestored: async (receipt: RetainedWorkspaceRestoreReceipt) => {
        await args.journal.appendEvent(args.rootId, {
          kind: 'workspace-restored',
          id: args.nodeId,
          provider: receipt.checkpoint.provider,
          environmentId: receipt.environmentId,
          checkpointId: receipt.checkpoint.checkpointId,
          sourceEnvironmentId: receipt.checkpoint.source.environmentId,
          verified: receipt.verified,
          ...(receipt.detail === undefined ? {} : { detail: receipt.detail }),
          seq: state.nextSequence(),
          at: new Date(args.now()).toISOString(),
        })
      },
      onAdmission: async (admission) => {
        scope.signal.throwIfAborted()
        const prior = admissions.find((record) => record.phase === admission.phase)
        if (prior !== undefined) {
          if (contentAddress(prior) !== contentAddress(admission)) {
            throw new ValidationError('retained owner admission conflicts with its committed phase')
          }
          return
        }
        await args.journal.appendEvent(args.rootId, {
          kind: 'execution-admitted',
          id: args.nodeId,
          admission: detachedSnapshot(admission, 'retained owner admission'),
          seq: ++sequence,
          at: new Date(args.now()).toISOString(),
        })
        scope.signal.throwIfAborted()
        admissions.push(detachedSnapshot(admission, 'retained owner admission'))
      },
      onResult: async (result) => {
        scope.signal.throwIfAborted()
        assertValidSpend(result.spent, 'retained owner result')
        executorFailureReason(result)
        const outRef = contentAddress(result.out)
        await args.blobs.put(outRef, result.out)
        scope.signal.throwIfAborted()
        const event: Extract<SpawnEvent, { kind: 'execution-result' }> = {
          kind: 'execution-result',
          id: args.nodeId,
          outRef,
          spent: detachedSnapshot(result.spent, 'retained owner spend'),
          ...(result.verdict ? { verdict: result.verdict } : {}),
          ...(result.outcome ? { outcome: result.outcome } : {}),
          seq: ++sequence,
          at: new Date(args.now()).toISOString(),
        }
        await args.journal.appendEvent(args.rootId, event)
        state.acceptedRef = event
        state.accepted = detachedSnapshot(result, 'retained owner result')
        state.acceptedConsumed = true
      },
    },
  }
  owners.set(scope, state)
}

export function scopeRetainedOwnerContext(
  scope: Scope<unknown>,
): RetainedExecutorContext | undefined {
  return owners.get(scope)?.context
}

/** Bind cleanup before replay can return an already accepted owner result. */
export function bindScopeRetainedOwnerProvider(
  scope: Scope<unknown>,
  provider: AgentEnvironmentProvider,
): void {
  const state = owners.get(scope)
  if (state) state.provider = provider
}

/** Bind the owner cleanup policy selected by its provider executor. */
export function bindScopeRetainedOwnerWorkspaceRetention(
  scope: Scope<unknown>,
  enabled: boolean,
): void {
  const state = owners.get(scope)
  if (state) state.workspaceRetention = enabled
}

/**
 * Bind where the owner's CURRENT environment id can be read from. The drive harness supplies a
 * resolver over its active executor's materialization receipt, which every provider path
 * publishes once the environment exists. The `environment` admission is written only on the
 * retained path, and the production tangle provider declares no `retainedControl`, so a reader
 * that scanned admissions alone would refuse every read on a real sandbox root while looking
 * correct in every test that uses the retained fixture.
 */
export function bindScopeRetainedOwnerEnvironmentId(
  scope: Scope<unknown>,
  liveEnvironmentId: () => string | undefined,
): void {
  const state = owners.get(scope)
  if (state) state.liveEnvironmentId = liveEnvironmentId
}

/**
 * The owner's environment as a source of by-path spawn resources.
 *
 * Built once per scope, before the environment exists: the coordination tools are created ahead
 * of the owner's first turn, and the environment is admitted during it. So the reader resolves
 * its target on every read — the latest environment admission on this node, reconstructed through
 * the bound provider the same way cleanup reconstructs it, with the same identity check. A manager
 * that has not yet been admitted, or whose provider was never bound, gets a refusal that names the
 * missing piece rather than a read from nowhere.
 *
 * The environment's `read()` serves the sandbox's own workspace; containment against that
 * workspace is the provider's. The relative-path and `..` rules are the reader's, in
 * `environmentReader`, so a manager is refused for the rule it broke.
 */
export function scopeRetainedOwnerResourceReader(
  scope: Scope<unknown>,
): SpawnResourceReader | undefined {
  const state = owners.get(scope)
  if (state === undefined) return undefined
  const latestEnvironmentId = (): string | undefined =>
    state.liveEnvironmentId?.() ??
    [...state.admissions]
      .reverse()
      .flatMap((admission) =>
        admission.phase === 'environment' ? [admission.environmentId] : [],
      )[0]
  return {
    get describe() {
      return `environment ${latestEnvironmentId() ?? '<not yet admitted>'}`
    },
    async read(path) {
      const provider = state.provider
      if (provider === undefined) {
        return { ok: false, reason: 'the manager’s environment provider is not bound yet' }
      }
      const environmentId = latestEnvironmentId()
      if (environmentId === undefined) {
        return { ok: false, reason: 'the manager’s environment has not been admitted yet' }
      }
      if (!provider.get) {
        return {
          ok: false,
          reason: `provider ${provider.name} cannot reconstruct the manager’s environment`,
        }
      }
      let environment: Awaited<ReturnType<NonNullable<AgentEnvironmentProvider['get']>>>
      try {
        environment = await provider.get(environmentId)
      } catch (error) {
        return {
          ok: false,
          reason: `environment ${environmentId}: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      if (environment === null) {
        return { ok: false, reason: `environment ${environmentId} is gone` }
      }
      if (environment.id !== environmentId || environment.provider !== provider.name) {
        return { ok: false, reason: `provider returned another environment for ${environmentId}` }
      }
      if (typeof environment.read !== 'function') {
        return {
          ok: false,
          reason: `environment ${environmentId} does not expose read; its provider cannot serve a resource by path`,
        }
      }
      const read = environment.read.bind(environment)
      return environmentReader({ id: environment.id, read }).read(path)
    },
  }
}

type CheckpointEvent = Extract<SpawnEvent, { kind: 'workspace-checkpoint' }>
type CheckpointRequestEvent = Extract<SpawnEvent, { kind: 'workspace-checkpoint-requested' }>

/**
 * Note that the owner's manager made a coordination call, and checkpoint its workspace when the
 * last checkpoint is older than {@link WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS}.
 *
 * A coordination call is where a manager commits work: it spawns, waits for, reads, or submits.
 * The checkpoint runs in the background and never delays the call. A failed checkpoint leaves the
 * previous one as the restore point; a provider or environment that cannot checkpoint stops the
 * attempts for this owner.
 */
export function noteScopeRetainedOwnerCoordination(scope: Scope<unknown>): void {
  const state = owners.get(scope)
  if (state?.provider === undefined || state.checkpointsUnavailable !== undefined) return
  if (state.checkpointing !== undefined || scope.signal.aborted) return
  const now = state.args.now()
  if (
    state.lastCheckpointAt !== undefined &&
    now - state.lastCheckpointAt < WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS
  )
    return
  state.lastCheckpointAt = now
  state.checkpointing = checkpointOwnerWorkspace(scope, state)
    .catch(() => undefined)
    .finally(() => {
      delete state.checkpointing
    })
}

/** @internal The checkpoint in progress for this owner, for a test or a release to wait on. */
export function scopeRetainedOwnerCheckpointing(scope: Scope<unknown>): Promise<void> | undefined {
  return owners.get(scope)?.checkpointing
}

async function checkpointOwnerWorkspace(scope: Scope<unknown>, state: OwnerState): Promise<void> {
  const { provider, args } = state
  if (provider === undefined) return
  if (!provider.get) {
    state.checkpointsUnavailable = `provider ${provider.name} cannot reconstruct an environment`
    return
  }
  // A checkpoint no create can restore is storage for nothing.
  if ((await provider.capabilities()).create?.workspaceCheckpoint !== true) {
    state.checkpointsUnavailable = `provider ${provider.name} cannot create an environment from a checkpoint`
    return
  }
  const dispatched = [...state.admissions]
    .reverse()
    .find((admission) => admission.phase === 'dispatched')
  if (dispatched?.phase !== 'dispatched') return
  const source = dispatched.controlRef
  const signal = AbortSignal.any([
    scope.signal,
    AbortSignal.timeout(WORKSPACE_CHECKPOINT_TIMEOUT_MS),
  ])
  const get = provider.get.bind(provider)
  const environment = await runAbortable(
    () => get(source.environmentId),
    signal,
    'retained owner checkpoint timed out',
  )
  if (
    environment === null ||
    environment.id !== source.environmentId ||
    environment.provider !== provider.name
  )
    return
  const branching = environment.workspaceBranching
  if (branching === undefined) {
    state.checkpointsUnavailable = `environment ${environment.id} offers no durable checkpoint`
    return
  }
  const seq = state.nextSequence()
  const at = new Date(args.now()).toISOString()
  const name = `owner-checkpoint-${seq}`
  const marker: WorkspaceCheckpointMarker = {
    path: WORKSPACE_CHECKPOINT_MARKER_PATH,
    content: `${JSON.stringify({ node: args.nodeId, checkpoint: name, at })}\n`,
  }
  const marked = await writeWorkspaceMarker(environment, marker, signal)
  const material = { source, name }
  const request = {
    ...material,
    idempotencyKey: `${args.nodeId}:workspace-checkpoint:${seq}`,
    requestDigest: workspaceCheckpointRequestDigest(material),
  }
  state.checkpointHandles ??= new Map()
  state.checkpointHandles.set(environment.id, branching)
  await args.journal.appendEvent(args.rootId, {
    kind: 'workspace-checkpoint-requested',
    id: args.nodeId,
    provider: provider.name,
    environmentId: environment.id,
    request,
    ...(marked ? { marker } : {}),
    seq,
    at,
  })
  const result = await runAbortable(
    () => branching.checkpoint(request, { signal }),
    signal,
    'retained owner checkpoint timed out',
  )
  if (result.status !== 'created' && result.status !== 'replayed') return
  if (!workspaceCheckpointResultMatchesRequest(request, result)) return
  scope.signal.throwIfAborted()
  await args.journal.appendEvent(args.rootId, {
    kind: 'workspace-checkpoint',
    id: args.nodeId,
    provider: provider.name,
    environmentId: environment.id,
    checkpoint: result.checkpoint,
    ...(marked ? { marker } : {}),
    seq: state.nextSequence(),
    at,
  })
  const owned = pendingCheckpoints((await args.journal.loadTree(args.rootId)) ?? [], state).filter(
    (event): event is CheckpointEvent => event.environmentId === environment.id,
  )
  await deleteCheckpoints(state, branching, owned.slice(0, -WORKSPACE_CHECKPOINTS_KEPT), signal)
}

/** Reconstruct authority for this source only; a replacement cannot own its snapshots. */
async function checkpointHandle(
  state: OwnerState,
  sourceEnvironmentId: string,
  signal: AbortSignal,
): Promise<AgentWorkspaceBranching | undefined> {
  const cached = state.checkpointHandles?.get(sourceEnvironmentId)
  if (cached !== undefined) return cached
  const provider = state.provider
  if (provider === undefined) return undefined
  try {
    const branching = await runAbortable(
      async () => {
        if (provider.workspaceBranching) {
          return (
            (await provider.workspaceBranching.forEnvironment(sourceEnvironmentId, { signal })) ??
            undefined
          )
        }
        const source = await provider.get?.(sourceEnvironmentId)
        return source?.id === sourceEnvironmentId && source.provider === provider.name
          ? source.workspaceBranching
          : undefined
      },
      signal,
      'retained owner checkpoint handle lookup timed out',
    )
    if (branching !== undefined) {
      state.checkpointHandles ??= new Map()
      state.checkpointHandles.set(sourceEnvironmentId, branching)
    }
    return branching
  } catch {
    return undefined
  }
}

/** An aborted observation cannot prove that the provider never created a snapshot. */
async function reconcileCheckpointRequests(
  state: OwnerState,
  events: SpawnEvent[],
): Promise<CheckpointRequestEvent[]> {
  const operationKey = (operation: { idempotencyKey: string; requestDigest: string }): string =>
    JSON.stringify([operation.idempotencyKey, operation.requestDigest])
  const resolved = new Set(
    events.flatMap((event) =>
      event.kind === 'workspace-checkpoint' &&
      event.id === state.args.nodeId &&
      event.provider === state.provider?.name
        ? [operationKey(event.checkpoint)]
        : [],
    ),
  )
  const pending = events.filter(
    (event): event is CheckpointRequestEvent =>
      event.kind === 'workspace-checkpoint-requested' &&
      event.id === state.args.nodeId &&
      event.provider === state.provider?.name &&
      !resolved.has(operationKey(event.request)),
  )
  const unconfirmed: CheckpointRequestEvent[] = []
  for (const event of pending) {
    const signal = AbortSignal.timeout(30_000)
    try {
      const branching = await checkpointHandle(state, event.environmentId, signal)
      if (branching === undefined) throw new Error('source-scoped checkpoint handle unavailable')
      const result = await runAbortable(
        () =>
          branching.lookupCheckpoint(
            {
              idempotencyKey: event.request.idempotencyKey,
              requestDigest: event.request.requestDigest,
            },
            { signal },
          ),
        signal,
        'retained owner checkpoint lookup timed out',
      )
      if (
        result.status !== 'found' ||
        !workspaceCheckpointResultMatchesRequest(event.request, result)
      )
        throw new Error('checkpoint operation outcome is unresolved')
      const recovered: CheckpointEvent = {
        kind: 'workspace-checkpoint',
        id: event.id,
        provider: event.provider,
        environmentId: event.environmentId,
        checkpoint: result.checkpoint,
        ...(event.marker === undefined ? {} : { marker: event.marker }),
        seq: state.nextSequence(),
        at: event.at,
      }
      await state.args.journal.appendEvent(state.args.rootId, recovered)
      events.push(recovered)
    } catch {
      // Even not_found may race an in-flight effect. Keep its source and durable request.
      unconfirmed.push(event)
    }
  }
  return unconfirmed
}

function pendingCheckpoints(events: readonly SpawnEvent[], state: OwnerState): CheckpointEvent[] {
  const confirmed = new Set(
    events.flatMap((event) =>
      event.kind === 'workspace-checkpoint-cleanup' &&
      event.id === state.args.nodeId &&
      event.provider === state.provider?.name &&
      event.confirmed
        ? [JSON.stringify([event.environmentId, event.checkpointId])]
        : [],
    ),
  )
  return events.filter(
    (event): event is CheckpointEvent =>
      event.kind === 'workspace-checkpoint' &&
      event.id === state.args.nodeId &&
      event.provider === state.provider?.name &&
      !confirmed.has(JSON.stringify([event.environmentId, event.checkpoint.checkpointId])),
  )
}

/** Only the source-scoped handle can attest deletion, including after its source is lost. */
async function deleteCheckpoints(
  state: OwnerState,
  branching: AgentWorkspaceBranching | undefined,
  checkpoints: readonly CheckpointEvent[],
  signal: AbortSignal,
): Promise<CheckpointEvent[]> {
  const unconfirmed: CheckpointEvent[] = []
  for (const event of checkpoints) {
    const material = {
      kind: 'checkpoint' as const,
      targetId: event.checkpoint.checkpointId,
      provider: event.checkpoint.provider,
    }
    const request = {
      ...material,
      operationId: `${event.checkpoint.idempotencyKey}:delete`,
      requestDigest: workspaceCleanupRequestDigest(material),
    }
    let confirmed = false
    try {
      if (branching === undefined) throw new Error('source-scoped checkpoint handle unavailable')
      const acknowledgement = await runAbortable(
        () => branching.deleteCheckpoint(request, { signal }),
        signal,
        'retained owner checkpoint cleanup timed out',
      )
      confirmed =
        workspaceCleanupAcknowledgementMatches(request, acknowledgement) &&
        (acknowledgement.status === 'deleted' || acknowledgement.status === 'already_absent')
    } catch {
      // The journal and settle result retain the unresolved resource below.
    }
    if (!confirmed) unconfirmed.push(event)
    await state.args.journal.appendEvent(state.args.rootId, {
      kind: 'workspace-checkpoint-cleanup',
      id: state.args.nodeId,
      provider: event.provider,
      environmentId: event.environmentId,
      checkpointId: event.checkpoint.checkpointId,
      confirmed,
      seq: state.nextSequence(),
      at: new Date(state.args.now()).toISOString(),
    })
  }
  return unconfirmed
}

/**
 * The checkpoint a new environment of this owner starts from: the latest one journaled before
 * the invocation's input, taken from an environment the provider has since lost. Only such an
 * environment needs one; a live environment is continued, never copied.
 */
function restoreBefore(
  owned: readonly SpawnEvent[],
  inputIndex: number,
): CheckpointEvent | undefined {
  const destroyed = destroyedEnvironmentIds(owned)
  return owned
    .slice(0, inputIndex < 0 ? owned.length : inputIndex)
    .filter(
      (event): event is CheckpointEvent =>
        event.kind === 'workspace-checkpoint' && destroyed.has(event.environmentId),
    )
    .at(-1)
}

async function restoreCapable(provider: AgentEnvironmentProvider | undefined): Promise<boolean> {
  if (provider === undefined) return false
  try {
    return (await provider.capabilities()).create?.workspaceCheckpoint === true
  } catch {
    return false
  }
}

/**
 * What the owner's next new environment will hold of the lost one, read before the drive so the
 * re-entered director is told: the checkpoint's time, or undefined when there is nothing to
 * restore.
 */
export async function scopeRetainedOwnerRestorePoint(
  scope: Scope<unknown>,
): Promise<{ readonly checkpointId: string; readonly takenAt: string } | undefined> {
  const state = owners.get(scope)
  if (state === undefined || !(await restoreCapable(state.provider))) return undefined
  const owned = ((await state.args.journal.loadTree(state.args.rootId)) ?? []).filter(
    (event) => event.id === state.args.nodeId,
  )
  const latest = restoreBefore(owned, -1)
  return latest === undefined
    ? undefined
    : { checkpointId: latest.checkpoint.checkpointId, takenAt: latest.at }
}

/** @internal Whether another owner release could still destroy what the last one left. */
export function retainedOwnerReleaseRetriable(scope: Scope<unknown>): boolean {
  return owners.get(scope)?.releaseRetriable ?? false
}

/** The existing scope settlement barrier releases the owner's environment after all its turns. */
export async function releaseScopeRetainedOwnerEnvironment(
  scope: Scope<unknown>,
): Promise<readonly UnconfirmedTeardown[]> {
  const state = owners.get(scope)
  if (!state?.provider) return []
  const { provider, args } = state
  // No checkpoint may race the destroy below, and none is needed after it.
  state.checkpointsUnavailable ??= 'released'
  await state.checkpointing?.catch(() => undefined)
  const events = [...((await args.journal.loadTree(args.rootId)) ?? [])]
  const requestFailures = await reconcileCheckpointRequests(state, events)
  const pendingSources = new Set(requestFailures.map((event) => event.environmentId))
  const released = new Set(
    events.flatMap((event) =>
      event.kind === 'environment-teardown' &&
      event.id === args.nodeId &&
      event.provider === provider.name &&
      event.destroyed
        ? [event.environmentId]
        : [],
    ),
  )
  const environments = new Set(
    events.flatMap((event) =>
      event.id === args.nodeId &&
      event.kind === 'execution-admitted' &&
      event.admission.phase === 'environment'
        ? [event.admission.environmentId]
        : [],
    ),
  )
  const retentionConfigured =
    state.workspaceRetention ||
    events.some(
      (event) =>
        event.kind === 'execution-input' &&
        event.id === args.nodeId &&
        event.workspaceRetention === true,
    )
  const retentionFailures = retentionConfigured
    ? await ownerWorkspaceRetentionFailures(events, args.nodeId, args.blobs)
    : new Set<string>()
  const unconfirmed: string[] = []
  // Sources preserved for lack of a verified workspace receipt: evidence, never swept.
  const preserved: string[] = []
  let lastDetail: string | undefined
  let retriable = false
  const checkpointFailures: CheckpointEvent[] = []
  const pending = pendingCheckpoints(events, state).filter(
    (event) => !retentionFailures.has(event.environmentId),
  )
  for (const sourceEnvironmentId of new Set(pending.map((event) => event.environmentId))) {
    const signal = AbortSignal.timeout(30_000)
    const branching = await checkpointHandle(state, sourceEnvironmentId, signal)
    checkpointFailures.push(
      ...(await deleteCheckpoints(
        state,
        branching,
        pending.filter((event) => event.environmentId === sourceEnvironmentId),
        signal,
      )),
    )
  }
  for (const event of checkpointFailures) pendingSources.add(event.environmentId)
  for (const environmentId of environments) {
    if (released.has(environmentId)) continue
    let destroyed = false
    let detail: string | undefined
    if (retentionFailures.has(environmentId) || pendingSources.has(environmentId)) {
      detail = pendingSources.has(environmentId)
        ? 'checkpoint cleanup unresolved: source preserved for exact lookup and cleanup'
        : 'provider workspace retention: source preserved because the owner execution has no verified workspace receipt'
      preserved.push(environmentId)
      lastDetail = detail
    } else {
      // A provider that cannot reconstruct or destroy the environment answers the same way every
      // time; only a destroy that failed or went unanswered is worth asking again.
      let permanent = false
      try {
        await runAbortable(
          async () => {
            if (!provider.get) {
              permanent = true
              throw new Error('provider cannot reconstruct the retained environment')
            }
            const environment = await provider.get(environmentId)
            if (environment === null) return
            if (environment.id !== environmentId || environment.provider !== provider.name) {
              permanent = true
              throw new Error('provider returned another retained environment')
            }
            if (!environment.destroy) {
              permanent = true
              throw new Error('provider cannot destroy the retained environment')
            }
            await environment.destroy()
          },
          AbortSignal.timeout(30_000),
          'retained owner cleanup timed out',
        )
        destroyed = true
      } catch {
        detail = 'retained owner environment cleanup was not confirmed'
        unconfirmed.push(environmentId)
        lastDetail = detail
        if (!permanent) retriable = true
      }
    }
    await args.journal.appendEvent(args.rootId, {
      kind: 'environment-teardown',
      id: args.nodeId,
      provider: provider.name,
      environmentId,
      destroyed,
      ...(detail === undefined ? {} : { detail }),
      seq: state.nextSequence(),
      at: new Date(args.now()).toISOString(),
    })
  }
  state.releaseRetriable = retriable
  const checkpointTeardowns: UnconfirmedTeardown[] = [
    ...checkpointFailures.map(
      (event): UnconfirmedTeardown => ({
        id: args.nodeId,
        label: 'scope owner workspace checkpoint',
        runtime: provider.name,
        status: 'done',
        detail: `checkpoint cleanup unconfirmed: ${event.checkpoint.checkpointId} from ${event.environmentId}`,
      }),
    ),
    ...requestFailures.map(
      (event): UnconfirmedTeardown => ({
        id: args.nodeId,
        label: 'scope owner checkpoint request',
        runtime: provider.name,
        status: 'done',
        detail: `checkpoint request unresolved: ${event.request.idempotencyKey} from ${event.environmentId}`,
      }),
    ),
  ]
  return unconfirmed.length > 0 || preserved.length > 0
    ? [
        {
          id: args.nodeId,
          label: 'scope owner',
          runtime: provider.name,
          status: 'done',
          ...(unconfirmed.length === 0
            ? {}
            : {
                environments: unconfirmed.map((environmentId) => ({
                  provider: provider.name,
                  environmentId,
                })),
              }),
          ...(preserved.length === 0
            ? {}
            : {
                kept: preserved.map((environmentId) => ({
                  provider: provider.name,
                  environmentId,
                  keptFor: 'evidence' as const,
                })),
              }),
          ...(lastDetail === undefined ? {} : { detail: lastDetail }),
        },
        ...checkpointTeardowns,
      ]
    : checkpointTeardowns
}

interface OwnerAttempt {
  readonly environmentIds: Set<string>
  result?: Extract<SpawnEvent, { kind: 'execution-result' }>
}

/** Group owner admissions by input and require a verified workspace receipt before deletion. */
async function ownerWorkspaceRetentionFailures(
  events: readonly SpawnEvent[],
  nodeId: NodeId,
  blobs: ResultBlobStore,
): Promise<ReadonlySet<string>> {
  const attempts: OwnerAttempt[] = []
  let current: OwnerAttempt | undefined
  const flush = (): void => {
    if (current !== undefined) attempts.push(current)
    current = undefined
  }
  for (const event of events) {
    if (!('id' in event) || event.id !== nodeId) continue
    if (event.kind === 'execution-input') {
      flush()
      current = { environmentIds: new Set<string>() }
    } else if (event.kind === 'execution-admitted' && event.admission.phase === 'environment') {
      if (current?.result !== undefined) flush()
      current ??= { environmentIds: new Set<string>() }
      current.environmentIds.add(event.admission.environmentId)
    } else if (event.kind === 'execution-result') {
      current ??= { environmentIds: new Set<string>() }
      current.result = event
    }
  }
  flush()
  const failures = new Set<string>()
  for (const attempt of attempts) {
    if (attempt.environmentIds.size === 0) continue
    // One result receipt cannot prove which source belongs to which environment when a
    // recovered attempt admitted more than one. Preserve every source until a later run can
    // establish a one-to-one receipt rather than guessing from a shared result.
    if (attempt.environmentIds.size > 1) {
      for (const environmentId of attempt.environmentIds) failures.add(environmentId)
      continue
    }
    const result = attempt.result
    if (result === undefined) {
      for (const environmentId of attempt.environmentIds) failures.add(environmentId)
      continue
    }
    let output: unknown | undefined
    try {
      output = await blobs.get(result.outRef)
      if (output === undefined || contentAddress(output) !== result.outRef) throw new Error()
    } catch {
      output = undefined
    }
    const snapshot =
      output !== null && typeof output === 'object'
        ? (output as { readonly workspaceSnapshot?: unknown }).workspaceSnapshot
        : undefined
    if (!hasDurableWorkspaceSnapshot(snapshot)) {
      for (const environmentId of attempt.environmentIds) failures.add(environmentId)
    }
  }
  return failures
}

/** A stored result is deletion authority only when it names the durable archive capture wrote. */
function hasDurableWorkspaceSnapshot(value: unknown): boolean {
  const parsed = agentCandidateWorkspaceSnapshotEvidenceSchema.safeParse(value)
  return parsed.success && 'locator' in parsed.data.manifest && 'locator' in parsed.data.archive
}

/** Environment ids this owner's provider confirmed gone, from their teardown receipts. */
function destroyedEnvironmentIds(owned: readonly SpawnEvent[]): ReadonlySet<string> {
  return new Set(
    owned.flatMap((event) =>
      event.kind === 'environment-teardown' && event.destroyed ? [event.environmentId] : [],
    ),
  )
}

/** The environment the owner's next invocation would continue in, when there is one: the latest
 *  environment admission of this owner, which is either the current invocation's own (recovered
 *  in place) or the one a deliberate later invocation reuses after an accepted result. `inFlight`
 *  says whether the latest invocation has no result yet. */
function continuedEnvironment(
  owned: readonly SpawnEvent[],
): { readonly admission: RetainedRunEnvironmentAdmission; readonly inFlight: boolean } | undefined {
  const latestInput = [...owned].reverse().find((event) => event.kind === 'execution-input')
  if (latestInput === undefined) return undefined
  const attempt = owned.slice(owned.indexOf(latestInput))
  const admission = [...owned]
    .reverse()
    .flatMap((event) =>
      event.kind === 'execution-admitted' && event.admission.phase === 'environment'
        ? [event.admission]
        : [],
    )[0]
  if (admission === undefined) return undefined
  return { admission, inFlight: !attempt.some((event) => event.kind === 'execution-result') }
}

/** What the owner's next invocation continues, read before it starts. */
export type RetainedOwnerEnvironmentState =
  /** No environment was admitted yet, or the owner is not a retained provider owner. */
  | { readonly state: 'none' }
  /** The provider still holds the environment the next invocation continues in. */
  | { readonly state: 'live'; readonly environmentId: string; readonly inFlight: boolean }
  /** The provider no longer holds it; the next invocation starts in a new environment. */
  | { readonly state: 'lost'; readonly environmentId: string }
  /** The provider could not say. Nothing is concluded and nothing is journaled. */
  | { readonly state: 'unknown'; readonly environmentId: string }

/**
 * Confirm, before a new drive, that the environment the owner would continue in still exists.
 *
 * A retained invocation whose environment is gone can never be recovered: the retained path asked
 * the provider to reconnect, the provider answered `Sandbox not found`, and every later attempt
 * repeated that refusal until the barren streak ended the run. Measured on the real opencode path
 * (autopsy-a-before-20260924a, agent-runtime 5c22fbb2): the root sandbox was deleted 17 s after it
 * dispatched a child, four attempts in 64 s each refused "retained provider execution requires
 * reconciliation before replacement", and the run settled `driver-failed` while the child it had
 * commissioned settled `done` two minutes later, unread.
 *
 * The reconciliation refusal protects against paying twice for an execution that may still run.
 * An environment the provider no longer holds runs nothing, so there is nothing to reconcile: the
 * loss is journaled as a destroyed teardown receipt, and the next prepare starts a new invocation.
 */
export async function reconcileScopeRetainedOwnerEnvironment(
  scope: Scope<unknown>,
): Promise<RetainedOwnerEnvironmentState> {
  const state = owners.get(scope)
  if (!state?.provider) return { state: 'none' }
  const { provider, args } = state
  const owned = ((await args.journal.loadTree(args.rootId)) ?? []).filter(
    (event) => event.id === args.nodeId,
  )
  const continued = continuedEnvironment(owned)
  if (continued === undefined) return { state: 'none' }
  const environmentId = continued.admission.environmentId
  if (destroyedEnvironmentIds(owned).has(environmentId)) return { state: 'lost', environmentId }
  if (!provider.get) return { state: 'unknown', environmentId }
  let environment: Awaited<ReturnType<NonNullable<AgentEnvironmentProvider['get']>>>
  try {
    environment = await runAbortable(
      () => provider.get!(environmentId),
      AbortSignal.any([scope.signal, AbortSignal.timeout(30_000)]),
      'retained owner environment check timed out',
    )
  } catch {
    return { state: 'unknown', environmentId }
  }
  if (environment !== null) return { state: 'live', environmentId, inFlight: continued.inFlight }
  scope.signal.throwIfAborted()
  await args.journal.appendEvent(args.rootId, {
    kind: 'environment-teardown',
    id: args.nodeId,
    provider: provider.name,
    environmentId,
    destroyed: true,
    detail:
      'lost: the provider no longer holds this environment, so the next invocation starts in a new one',
    seq: state.nextSequence(),
    at: new Date(args.now()).toISOString(),
  })
  return { state: 'lost', environmentId }
}

/** Resume the original backend prompt; rebuilt coordination observations cannot replace it. */
export async function prepareScopeRetainedOwnerTask(
  scope: Scope<unknown>,
  task: unknown,
): Promise<unknown> {
  const state = owners.get(scope)
  if (!state) return task
  const { args } = state
  scope.signal.throwIfAborted()
  const journal = (await args.journal.loadTree(args.rootId)) ?? []
  const owned = journal.filter((event) => event.id === args.nodeId)
  const latestInput = [...owned].reverse().find((event) => event.kind === 'execution-input')
  if (latestInput?.kind === 'execution-input') {
    const attempt = owned.slice(owned.indexOf(latestInput))
    state.taskRef = latestInput.taskRef
    state.inputSequence = latestInput.seq
    state.admissions.splice(
      0,
      state.admissions.length,
      ...attempt.flatMap((event) => (event.kind === 'execution-admitted' ? [event.admission] : [])),
    )
    const accepted = [...attempt].reverse().find((event) => event.kind === 'execution-result')
    if (accepted?.kind === 'execution-result') state.acceptedRef = accepted
  }
  const destroyed = destroyedEnvironmentIds(owned)
  const inFlight = continuedEnvironment(owned)
  if (inFlight?.inFlight && destroyed.has(inFlight.admission.environmentId)) {
    // An in-flight invocation whose environment the provider no longer holds cannot be recovered,
    // and nothing is left running to pay for twice. The next drive is a new invocation.
    delete state.inputSequence
    delete state.taskRef
    state.admissions.length = 0
    delete state.priorSession
  }
  if (state.prepared && state.acceptedRef && state.acceptedConsumed) {
    const currentEnvironment = [...state.admissions]
      .reverse()
      .find((admission) => admission.phase === 'environment')
    if (currentEnvironment?.phase === 'environment') state.priorSession = currentEnvironment
    delete state.inputSequence
    delete state.taskRef
    delete state.acceptedRef
    delete state.accepted
    // A deliberate later drive starts a distinct invocation after an accepted result.
    state.admissions.length = 0
    delete state.acceptedConsumed
  }
  // A later invocation never reuses an environment the provider confirmed gone.
  if (state.priorSession !== undefined && destroyed.has(state.priorSession.environmentId)) {
    delete state.priorSession
  }
  state.prepared = true
  // The invocation's restore point is fixed by the journal before its input, so a recovered
  // invocation replays the same create it committed.
  const capable = await restoreCapable(state.provider)
  const restoreFor = (inputIndex: number): RetainedWorkspaceRestore | undefined => {
    if (!capable || state.priorSession !== undefined) return undefined
    const point = restoreBefore(owned, inputIndex)
    return point === undefined
      ? undefined
      : {
          checkpoint: point.checkpoint,
          ...(point.marker === undefined ? {} : { marker: point.marker }),
        }
  }
  if (state.taskRef !== undefined) {
    const original = await args.blobs.get(state.taskRef)
    if (original === undefined || contentAddress(original) !== state.taskRef) {
      throw new ValidationError('retained owner task is missing or corrupt')
    }
    const inputIndex = owned.findIndex(
      (event) => event.kind === 'execution-input' && event.seq === state.inputSequence,
    )
    const restore = restoreFor(inputIndex)
    if (restore === undefined) delete state.restore
    else state.restore = restore
    return original
  }
  const restore = restoreFor(-1)
  if (restore === undefined) delete state.restore
  else state.restore = restore
  const snapshot = detachedSnapshot(task, 'retained owner task')
  const taskRef = contentAddress(snapshot)
  await args.blobs.put(taskRef, snapshot)
  scope.signal.throwIfAborted()
  const inputSequence = state.nextSequence()
  await args.journal.appendEvent(args.rootId, {
    kind: 'execution-input',
    id: args.nodeId,
    taskRef,
    ...(state.workspaceRetention ? { workspaceRetention: true } : {}),
    seq: inputSequence,
    at: new Date(args.now()).toISOString(),
  })
  state.taskRef = taskRef
  state.inputSequence = inputSequence
  return snapshot
}

/** Accepted backend output remains evidence, never the supervisor's finalized output. */
export async function scopeRetainedOwnerResult(
  scope: Scope<unknown>,
): Promise<ExecutorResult<unknown> | undefined> {
  const state = owners.get(scope)
  if (!state?.acceptedRef) return undefined
  if (state.accepted) return state.accepted
  const event = state.acceptedRef
  const out = await state.args.blobs.get(event.outRef)
  if (out === undefined || contentAddress(out) !== event.outRef) {
    throw new ValidationError('retained owner result is missing or corrupt')
  }
  assertValidSpend(event.spent, 'replayed retained owner result')
  return {
    outRef: event.outRef,
    out,
    spent: event.spent,
    ...(event.verdict ? { verdict: event.verdict } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
  }
}

export async function scopeRetainedOwnerPriorSpend(scope: Scope<unknown>) {
  const state = owners.get(scope)
  if (!state) return zeroSpend()
  const events = ((await state.args.journal.loadTree(state.args.rootId)) ?? []).filter(
    (event) => event.id === state.args.nodeId,
  )
  const input = [...events].reverse().find((event) => event.kind === 'execution-input')
  if (!input) return zeroSpend()
  return events
    .slice(events.indexOf(input))
    .reduce(
      (total, event) => (event.kind === 'metered' ? addSpend(total, event.spend) : total),
      zeroSpend(),
    )
}

/** Called only after the scope verifies the accepted invocation's materialization. */
export function consumeScopeRetainedOwnerResult(scope: Scope<unknown>): void {
  const state = owners.get(scope)
  if (!state?.acceptedRef) throw new ValidationError('retained owner has no accepted result')
  state.acceptedConsumed = true
}
