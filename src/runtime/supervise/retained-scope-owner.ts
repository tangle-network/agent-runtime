import {
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
  type AgentProfile,
  type AgentWorkspaceBranching,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
  type Sha256Digest,
  workspaceCheckpointRequestDigest,
  workspaceCheckpointResultMatchesRequest,
  workspaceCleanupAcknowledgementMatches,
  workspaceCleanupRequestDigest,
  workspaceForkRequestDigest,
  workspaceForkResultMatchesRequest,
} from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { environmentReader, type SpawnResourceReader } from '../../mcp/tools/spawn-resource-paths'
import { HARNESS_TRANSCRIPT_SETTLE_TIMEOUT_MS } from '../harness-transcript'
import {
  captureProviderCheckpointWorkspace,
  type ProviderWorkspaceRetentionPort,
} from '../provider-workspace-retention'
import { describeRetainedNativeStops, stopRetainedNativeExecution } from '../retained-native-stop'
import { sameControlCoordinates } from '../retained-run-binding'
import type { RetainedRunAdmission, RetainedRunEnvironmentAdmission } from '../retained-run-types'
import { addSpend, zeroSpend } from '../util'
import { runAbortable } from './abortable'
import { assertValidSpend } from './budget'
import { errMessage, errorText } from './error-message'
import { executorFailureReason } from './executor-outcome'
import {
  executorEvidenceWriter,
  type RetainedExecutionPendingError,
  type RetainedExecutorContext,
  type RetainedWorkspaceRestore,
  type RetainedWorkspaceRestoreReceipt,
  workspaceCaptureWriter,
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
  WORKSPACE_CHECKPOINT_ABSENT_AFTER_MS,
  WORKSPACE_CHECKPOINT_FORK_TIMEOUT_MS,
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
  /** A changed native provider starts a new harness session from a verified checkpoint. */
  forceNewSession?: boolean
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
  /** Where a checkpoint's files are captured before it is deleted, and the profile its capture
   *  names. Bound with the provider; absent when the owner's backend retains no workspace. */
  checkpointCapture?: {
    readonly port: ProviderWorkspaceRetentionPort
    readonly profile: AgentProfile
  }
  /** Checkpoints whose capture failed in this process. Rotation keeps them without forking them
   *  again; the release tries each once more. */
  captureRefused?: Set<string>
  /** The drive in progress: from before its executor exists until its turn has ended. */
  drive?: Promise<void>
  /** End-of-turn work a turn handed over: its workspace capture and the evidence of its receipt. */
  turnEnd?: Promise<void>
  /** The release in progress, so a second caller joins it instead of destroying twice. */
  releasing?: Promise<readonly UnconfirmedTeardown[]>
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
  const admissions = attempt.flatMap((event) =>
    event.kind === 'execution-admitted' ? [event.admission] : [],
  )
  const acceptedRef = [...attempt].reverse().find((event) => event.kind === 'execution-result')
  const priorSession = taskEvent === undefined ? undefined : committedSession(events, start)
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
      onEvidence: executorEvidenceWriter({
        journal: args.journal,
        blobs: args.blobs,
        rootId: args.rootId,
        nodeId: args.nodeId,
        nextSequence: () => state.nextSequence(),
        now: args.now,
      }),
      onWorkspaceCapture: workspaceCaptureWriter({
        journal: args.journal,
        rootId: args.rootId,
        nodeId: args.nodeId,
        nextSequence: () => state.nextSequence(),
        now: args.now,
      }),
      onEndOfTurnWork: (work) => {
        const prior = state.turnEnd
        const settled = work.catch(() => undefined)
        state.turnEnd = prior === undefined ? settled : Promise.all([prior, settled]).then(() => {})
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

/**
 * The environment admission an invocation that starts at `before` continues in: that of the
 * latest earlier invocation with a committed result, looking past invocations Runtime abandoned,
 * which never committed one. A live process keeps the same session across an abandonment, so a
 * resumed one must derive it the same way or its replay of the next invocation would not match
 * the material that invocation admitted.
 */
function committedSession(
  events: readonly SpawnEvent[],
  before: number,
): RetainedRunEnvironmentAdmission | undefined {
  let end = before
  for (;;) {
    const head = events.slice(0, end)
    const input = [...head].reverse().find((event) => event.kind === 'execution-input')
    if (input === undefined) return undefined
    const start = head.indexOf(input)
    const attempt = head.slice(start)
    const result = [...attempt].reverse().find((event) => event.kind === 'execution-result')
    if (result !== undefined) {
      return attempt
        .slice(0, attempt.indexOf(result))
        .reverse()
        .flatMap((event) =>
          event.kind === 'execution-admitted' && event.admission.phase === 'environment'
            ? [event.admission]
            : [],
        )[0]
    }
    if (!attempt.some((event) => event.kind === 'execution-abandoned')) return undefined
    end = start
  }
}

/** Bounds the stop Runtime asks for before abandoning a dispatched invocation. */
const ABANDON_STOP_TIMEOUT_MS = 30_000

/**
 * Abandon the owner's in-flight invocation, which the driver retry loop asks for when the same
 * reconciliation keeps failing the same way (`DriverRetryRun.resolvePending`).
 *
 * Runtime stops the invocation at the provider when it had dispatched, then journals what the
 * provider confirmed. The journal refuses every later admission or result of the invocation, so
 * only the replacement the next {@link prepareScopeRetainedOwnerTask} starts can commit a result.
 * Answers `false`, journaling nothing, when this owner has no unfinished invocation to abandon.
 */
export async function abandonScopeRetainedOwnerInvocation(
  scope: Scope<unknown>,
  failure: RetainedExecutionPendingError,
  failures: number,
): Promise<boolean> {
  const state = owners.get(scope)
  if (state === undefined || state.inputSequence === undefined) return false
  const { args } = state
  const owned = ((await args.journal.loadTree(args.rootId)) ?? []).filter(
    (event) => event.id === args.nodeId,
  )
  const latestInput = [...owned].reverse().find((event) => event.kind === 'execution-input')
  if (latestInput?.kind !== 'execution-input' || latestInput.seq !== state.inputSequence)
    return false
  const attempt = owned.slice(owned.indexOf(latestInput))
  if (
    attempt.some(
      (event) => event.kind === 'execution-result' || event.kind === 'execution-abandoned',
    )
  )
    return false
  const dispatched = [...attempt]
    .reverse()
    .flatMap((event) =>
      event.kind === 'execution-admitted' && event.admission.phase === 'dispatched'
        ? [event.admission]
        : [],
    )[0]
  const stop =
    dispatched === undefined || state.provider === undefined
      ? undefined
      : await stopRetainedNativeExecution({
          provider: state.provider,
          controlRef: dispatched.controlRef,
          signal: AbortSignal.any([scope.signal, AbortSignal.timeout(ABANDON_STOP_TIMEOUT_MS)]),
          now: args.now,
        })
  scope.signal.throwIfAborted()
  const stopped = stop?.effect === 'cancelled' || stop?.effect === 'not_live'
  await args.journal.appendEvent(args.rootId, {
    kind: 'execution-abandoned',
    id: args.nodeId,
    inputSeq: latestInput.seq,
    pendingCause: failure.pendingCause,
    failures,
    detail: errorText(errMessage(failure)).slice(0, 2_048),
    outcome: stopped ? 'stopped' : 'uncertain',
    ...(stop === undefined
      ? {}
      : {
          stop: {
            executionId: stop.executionId,
            effect: stop.effect,
            ...(stop.error === undefined ? {} : { error: stop.error }),
          },
        }),
    seq: state.nextSequence(),
    at: new Date(args.now()).toISOString(),
  })
  return true
}

export function scopeRetainedOwnerContext(
  scope: Scope<unknown>,
): RetainedExecutorContext | undefined {
  return owners.get(scope)?.context
}

/** The journal tree that owns this manager turn, including nested driver children. */
export function scopeRetainedOwnerJournalRoot(scope: Scope<unknown>): NodeId | undefined {
  return owners.get(scope)?.args.rootId
}

/**
 * Bind cleanup before replay can return an already accepted owner result. `checkpointCapture` is
 * where each checkpoint's files are stored before the checkpoint is deleted; without it, no
 * checkpoint of this owner is deleted.
 */
export function bindScopeRetainedOwnerProvider(
  scope: Scope<unknown>,
  provider: AgentEnvironmentProvider,
  checkpointCapture?: {
    readonly port: ProviderWorkspaceRetentionPort
    readonly profile: AgentProfile
  },
): void {
  const state = owners.get(scope)
  if (state === undefined) return
  state.provider = provider
  if (checkpointCapture !== undefined) state.checkpointCapture = checkpointCapture
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

/** A committed turn is the seat boundary. Keep its native home for a same-harness provider
 * continuation; only a provider/harness change needs a new environment. */
export async function prepareScopeRetainedOwnerSeatSwitch(
  scope: Scope<unknown>,
  mode: 'same-environment' | 'replace-environment',
): Promise<{
  readonly checkpointAt: string
  readonly checkpointId: string
  readonly sourceEnvironmentId: string
}> {
  const state = owners.get(scope)
  if (!state?.acceptedRef || !state.acceptedConsumed) {
    throw new ValidationError('seat switch requires a committed owner turn')
  }
  const accepted = state.acceptedRef
  await scopeRetainedOwnerTurnEnded(scope)
  await state.checkpointing
  await checkpointOwnerWorkspace(scope, state)
  const owned = ((await state.args.journal.loadTree(state.args.rootId)) ?? []).filter(
    (event) => event.id === state.args.nodeId,
  )
  const acceptedIndex = owned.findIndex(
    (event) =>
      event.kind === 'execution-result' &&
      event.seq === accepted.seq &&
      event.outRef === accepted.outRef,
  )
  if (acceptedIndex < 0)
    throw new ValidationError('seat switch has no committed result in its journal')
  const source = owned
    .slice(0, acceptedIndex)
    .reverse()
    .find((event) => event.kind === 'execution-admitted' && event.admission.phase === 'environment')
  const sourceEnvironmentId =
    source?.kind === 'execution-admitted' && source.admission.phase === 'environment'
      ? source.admission.environmentId
      : undefined
  const checkpoint =
    sourceEnvironmentId !== undefined
      ? owned
          .slice(acceptedIndex + 1)
          .reverse()
          .find(
            (event) =>
              event.kind === 'workspace-checkpoint' && event.environmentId === sourceEnvironmentId,
          )
      : undefined
  if (checkpoint?.kind !== 'workspace-checkpoint') {
    throw new ValidationError(
      'seat switch requires a checkpoint of the committed source environment',
    )
  }
  if (mode === 'replace-environment') {
    await retireSeatEnvironment(scope, state)
    state.forceNewSession = true
  }
  return {
    checkpointAt: checkpoint.at,
    checkpointId: checkpoint.checkpoint.checkpointId,
    sourceEnvironmentId: checkpoint.environmentId,
  }
}

/** The next seat receives fresh create-time credentials. Release the stopped source only after
 * its checkpoint exists, then commit the teardown so recovery never tries its old session. */
async function retireSeatEnvironment(scope: Scope<unknown>, state: OwnerState): Promise<void> {
  const { provider, args } = state
  if (!provider?.get)
    throw new ValidationError('seat switch requires a provider with exact environment lookup')
  const owned = ((await args.journal.loadTree(args.rootId)) ?? []).filter(
    (event) => event.id === args.nodeId,
  )
  const admitted = [...owned]
    .reverse()
    .find((event) => event.kind === 'execution-admitted' && event.admission.phase === 'environment')
  if (admitted?.kind !== 'execution-admitted' || admitted.admission.phase !== 'environment') {
    throw new ValidationError('seat switch has no committed source environment')
  }
  const environmentId = admitted.admission.environmentId
  if (
    owned.some(
      (event) =>
        event.kind === 'environment-teardown' &&
        event.destroyed &&
        event.environmentId === environmentId,
    )
  )
    return
  const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(30_000)])
  const environment = await runAbortable(
    () => provider.get!(environmentId),
    signal,
    'seat switch environment lookup timed out',
  )
  if (environment !== null) {
    if (
      environment.id !== environmentId ||
      environment.provider !== provider.name ||
      !environment.destroy
    ) {
      throw new ValidationError('seat switch cannot retire the exact source environment')
    }
    await runAbortable(
      () => environment.destroy!(),
      signal,
      'seat switch environment retirement timed out',
    )
  }
  await args.journal.appendEvent(args.rootId, {
    kind: 'environment-teardown',
    id: args.nodeId,
    provider: provider.name,
    environmentId,
    destroyed: true,
    detail: 'seat changed after a committed turn',
    seq: state.nextSequence(),
    at: new Date(args.now()).toISOString(),
  })
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
  const events = (await args.journal.loadTree(args.rootId)) ?? []
  const owned = pendingCheckpoints(events, state).filter(
    (event): event is CheckpointEvent =>
      event.environmentId === environment.id &&
      state.captureRefused?.has(event.checkpoint.checkpointId) !== true,
  )
  // The capture forks a box and reads its whole workspace, so it is bounded by the fork and the
  // port, never by this checkpoint's own bound.
  await cleanCheckpoints(
    state,
    branching,
    owned.slice(0, -WORKSPACE_CHECKPOINTS_KEPT),
    events,
    scope.signal,
  )
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

/** A checkpoint request whose outcome a lookup could not establish, and what the lookup said. */
interface UnresolvedCheckpointRequest {
  readonly event: CheckpointRequestEvent
  readonly reason: string
}

/**
 * An aborted observation cannot prove that the provider never created a snapshot, so a request
 * whose lookup does not find it keeps its source alive for a later lookup, with one exception: a
 * provider that answers `not_found` for a request older than {@link WORKSPACE_CHECKPOINT_ABSENT_AFTER_MS}
 * never created it. No operation that request started can still be in flight, and keeping the
 * source then holds a sandbox for nothing: on Discovery Lab runs terraform-economics-20261005e and
 * f, each root was kept after its run settled over requests made hours earlier.
 */
async function reconcileCheckpointRequests(
  state: OwnerState,
  events: SpawnEvent[],
): Promise<UnresolvedCheckpointRequest[]> {
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
  const unconfirmed: UnresolvedCheckpointRequest[] = []
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
      if (result.status === 'not_found') {
        const requestedAt = Date.parse(event.at)
        if (
          Number.isFinite(requestedAt) &&
          state.args.now() - requestedAt >= WORKSPACE_CHECKPOINT_ABSENT_AFTER_MS
        )
          continue
        unconfirmed.push({ event, reason: 'lookup not_found while the request may be in flight' })
        continue
      }
      if (result.status !== 'found') {
        unconfirmed.push({
          event,
          reason: `lookup ${result.status}${'message' in result && result.message ? `: ${result.message}` : ''}`,
        })
        continue
      }
      if (!workspaceCheckpointResultMatchesRequest(event.request, result)) {
        unconfirmed.push({ event, reason: 'lookup found a checkpoint for another request' })
        continue
      }
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
    } catch (error) {
      unconfirmed.push({
        event,
        reason: `lookup failed: ${errorText(error instanceof Error ? error.message : error)}`,
      })
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

type CheckpointCaptureEvent = Extract<SpawnEvent, { kind: 'workspace-checkpoint-capture' }>
type ForkTeardownEvent = Extract<SpawnEvent, { kind: 'workspace-checkpoint-fork-teardown' }>

/** A checkpoint kept without a delete because no capture holds its files. */
interface CaptureRefusal {
  readonly event: CheckpointEvent
  readonly reason: string
  /** Whether a later capture needs the source: its handle is the only one that can fork it. */
  readonly needsSource: boolean
}

/** What cleaning a group of checkpoints left: deletes the provider did not confirm, and
 *  checkpoints kept because their files are in no capture. */
interface CheckpointCleanup {
  readonly unconfirmed: CheckpointEvent[]
  readonly refused: CaptureRefusal[]
}

/**
 * Delete checkpoints, each only after its files are captured into the run's content-addressed
 * store; a checkpoint no capture holds is kept, and the cleanup record says why. Only the
 * source-scoped handle can fork a checkpoint and attest its deletion, including after its source
 * is lost. `parent` cancels the captures (the owner's scope during rotation); each provider
 * operation also has its own bound.
 */
async function cleanCheckpoints(
  state: OwnerState,
  branching: AgentWorkspaceBranching | undefined,
  checkpoints: readonly CheckpointEvent[],
  events: readonly SpawnEvent[],
  parent?: AbortSignal,
): Promise<CheckpointCleanup> {
  const unconfirmed: CheckpointEvent[] = []
  const refused: CaptureRefusal[] = []
  for (const event of checkpoints) {
    const captured = await captureBeforeCleanup(state, branching, event, events, parent)
    if ('reason' in captured) {
      state.captureRefused ??= new Set()
      state.captureRefused.add(event.checkpoint.checkpointId)
      refused.push(captured)
      await state.args.journal.appendEvent(state.args.rootId, {
        kind: 'workspace-checkpoint-cleanup',
        id: state.args.nodeId,
        provider: event.provider,
        environmentId: event.environmentId,
        checkpointId: event.checkpoint.checkpointId,
        confirmed: false,
        refused: captured.reason.slice(0, 1_000),
        seq: state.nextSequence(),
        at: new Date(state.args.now()).toISOString(),
      })
      continue
    }
    state.captureRefused?.delete(event.checkpoint.checkpointId)
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
      const signal = AbortSignal.timeout(30_000)
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
      capturedDigest: captured.digest,
      seq: state.nextSequence(),
      at: new Date(state.args.now()).toISOString(),
    })
  }
  return { unconfirmed, refused }
}

/**
 * The digest of the tree that holds a checkpoint's files, capturing it first when no record says
 * one exists, or why it cannot be had. The files are read from a fork of the checkpoint: a box
 * created from the snapshot itself, so the capture is the checkpoint's state and not the live
 * workspace's, which has moved on. The fork request is journaled before it is made and the fork
 * destroyed once the capture is journaled, so neither a failure nor a crash leaves it running
 * unrecorded.
 */
async function captureBeforeCleanup(
  state: OwnerState,
  branching: AgentWorkspaceBranching | undefined,
  event: CheckpointEvent,
  events: readonly SpawnEvent[],
  parent?: AbortSignal,
): Promise<{ readonly digest: Sha256Digest } | CaptureRefusal> {
  const { args } = state
  const checkpointId = event.checkpoint.checkpointId
  const recorded = events.find(
    (prior): prior is CheckpointCaptureEvent =>
      prior.kind === 'workspace-checkpoint-capture' &&
      prior.id === args.nodeId &&
      prior.provider === event.provider &&
      prior.environmentId === event.environmentId &&
      prior.checkpointId === checkpointId,
  )
  if (recorded !== undefined) return { digest: recorded.tree.digest }
  const refuse = (reason: string, needsSource: boolean): CaptureRefusal => ({
    event,
    reason,
    needsSource,
  })
  const capture = state.checkpointCapture
  if (capture?.port.captureCheckpoint === undefined)
    return refuse('no checkpoint capture: the owner backend has no captureCheckpoint', false)
  const provider = state.provider
  if (provider?.get === undefined)
    return refuse('the provider cannot reconstruct a fork of the checkpoint', false)
  const get = provider.get.bind(provider)
  if (branching === undefined) return refuse('source-scoped checkpoint handle unavailable', true)
  const material = { checkpoint: event.checkpoint, placement: { kind: 'sandbox' as const } }
  // One key per attempt: a fork an earlier attempt destroyed cannot be replayed into this one.
  const request = {
    ...material,
    idempotencyKey: `${event.checkpoint.idempotencyKey}:capture:${state.nextSequence()}`,
    requestDigest: workspaceForkRequestDigest(material),
  }
  let forkEnvironmentId: string | undefined
  try {
    const tree = await captureProviderCheckpointWorkspace(
      capture.port,
      async (captureSignal) => {
        const forkSignal = AbortSignal.any([
          captureSignal,
          ...(parent === undefined ? [] : [parent]),
          AbortSignal.timeout(WORKSPACE_CHECKPOINT_FORK_TIMEOUT_MS),
        ])
        await args.journal.appendEvent(args.rootId, {
          kind: 'workspace-checkpoint-fork-requested',
          id: args.nodeId,
          provider: event.provider,
          environmentId: event.environmentId,
          checkpointId,
          idempotencyKey: request.idempotencyKey,
          requestDigest: request.requestDigest,
          seq: state.nextSequence(),
          at: new Date(args.now()).toISOString(),
        })
        const result = await runAbortable(
          () => branching.fork(request, { signal: forkSignal }),
          forkSignal,
          'checkpoint fork timed out',
        )
        if (result.status === 'created' || result.status === 'replayed')
          forkEnvironmentId = result.environment.environmentId
        if (
          (result.status !== 'created' && result.status !== 'replayed') ||
          !workspaceForkResultMatchesRequest(request, result)
        )
          throw new Error(
            `fork ${result.status}${'message' in result ? `: ${result.message}` : ''}`,
          )
        const forkId = result.environment.environmentId
        const environment = await runAbortable(
          () => get(forkId),
          forkSignal,
          'checkpoint fork lookup timed out',
        )
        if (
          environment === null ||
          environment.id !== forkId ||
          environment.provider !== provider.name
        )
          throw new Error(`fork ${forkId} could not be reconstructed`)
        parent?.throwIfAborted()
        return {
          environment,
          checkpoint: event.checkpoint,
          executionId: `${args.nodeId}:checkpoint:${checkpointId}`,
          profile: capture.profile,
        }
      },
      event.marker,
    )
    const forkId = forkEnvironmentId
    if (forkId === undefined) throw new Error('checkpoint capture fork identity missing')
    await args.journal.appendEvent(args.rootId, {
      kind: 'workspace-checkpoint-capture',
      id: args.nodeId,
      provider: event.provider,
      environmentId: event.environmentId,
      checkpointId,
      fork: { idempotencyKey: request.idempotencyKey, environmentId: forkId },
      tree: {
        digest: tree.digest,
        manifest: tree.manifest,
        files: tree.files,
        bytes: tree.bytes,
        storedBytes: tree.storedBytes,
      },
      seq: state.nextSequence(),
      at: new Date(args.now()).toISOString(),
    })
    return { digest: tree.digest }
  } catch (error) {
    return refuse(
      `capture failed: ${errorText(error instanceof Error ? error.message : error)}`,
      true,
    )
  } finally {
    if (forkEnvironmentId !== undefined)
      await destroyCaptureFork(state, branching, {
        provider: event.provider,
        environmentId: event.environmentId,
        checkpointId,
        fork: { idempotencyKey: request.idempotencyKey, environmentId: forkEnvironmentId },
      })
  }
}

/** Destroy a capture's fork and journal whether the provider confirmed it. */
async function destroyCaptureFork(
  state: OwnerState,
  branching: AgentWorkspaceBranching,
  target: Pick<ForkTeardownEvent, 'provider' | 'environmentId' | 'checkpointId' | 'fork'>,
): Promise<boolean> {
  const material = {
    kind: 'fork' as const,
    targetId: target.fork.environmentId,
    provider: target.provider,
  }
  const request = {
    ...material,
    operationId: `${target.fork.idempotencyKey}:destroy`,
    requestDigest: workspaceCleanupRequestDigest(material),
  }
  let destroyed = false
  try {
    const signal = AbortSignal.timeout(30_000)
    const acknowledgement = await runAbortable(
      () => branching.destroyFork(request, { signal }),
      signal,
      'checkpoint capture fork cleanup timed out',
    )
    destroyed =
      workspaceCleanupAcknowledgementMatches(request, acknowledgement) &&
      (acknowledgement.status === 'deleted' || acknowledgement.status === 'already_absent')
  } catch {
    // Journaled unconfirmed below; the release asks again.
  }
  await state.args.journal.appendEvent(state.args.rootId, {
    kind: 'workspace-checkpoint-fork-teardown',
    id: state.args.nodeId,
    ...target,
    destroyed,
    seq: state.nextSequence(),
    at: new Date(state.args.now()).toISOString(),
  })
  return destroyed
}

/**
 * Destroy every capture fork the journal does not show destroyed: one a crash left between its
 * request and its teardown, or whose teardown the provider did not confirm. Returns the forks
 * still not confirmed destroyed, by environment or, when none was ever named, by request key.
 */
async function settleCaptureForks(state: OwnerState): Promise<string[]> {
  const { args } = state
  const providerName = state.provider?.name
  const events = ((await args.journal.loadTree(args.rootId)) ?? []).filter(
    (event) => event.id === args.nodeId,
  )
  const named = (key: string): string | undefined => {
    for (const event of events) {
      if (
        (event.kind === 'workspace-checkpoint-capture' ||
          event.kind === 'workspace-checkpoint-fork-teardown') &&
        event.fork.idempotencyKey === key
      )
        return event.fork.environmentId
    }
    return undefined
  }
  const destroyed = new Set(
    events.flatMap((event) =>
      event.kind === 'workspace-checkpoint-fork-teardown' && event.destroyed
        ? [event.fork.idempotencyKey]
        : [],
    ),
  )
  const unresolved: string[] = []
  for (const request of events) {
    if (request.kind !== 'workspace-checkpoint-fork-requested' || request.provider !== providerName)
      continue
    if (destroyed.has(request.idempotencyKey)) continue
    const signal = AbortSignal.timeout(30_000)
    const branching = await checkpointHandle(state, request.environmentId, signal)
    let forkEnvironmentId = named(request.idempotencyKey)
    if (forkEnvironmentId === undefined && branching !== undefined) {
      try {
        const found = await runAbortable(
          () =>
            branching.lookupFork(
              { idempotencyKey: request.idempotencyKey, requestDigest: request.requestDigest },
              { signal },
            ),
          signal,
          'checkpoint capture fork lookup timed out',
        )
        // No fork was ever created for this request: nothing to destroy.
        if (found.status === 'not_found') continue
        if (found.status === 'found') forkEnvironmentId = found.environment.environmentId
      } catch {
        // Unresolved below.
      }
    }
    if (
      forkEnvironmentId === undefined ||
      branching === undefined ||
      !(await destroyCaptureFork(state, branching, {
        provider: request.provider,
        environmentId: request.environmentId,
        checkpointId: request.checkpointId,
        fork: { idempotencyKey: request.idempotencyKey, environmentId: forkEnvironmentId },
      }))
    )
      unresolved.push(forkEnvironmentId ?? request.idempotencyKey)
  }
  return unresolved
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
  const unusable = unusableEnvironmentIds(owned)
  return owned
    .slice(0, inputIndex < 0 ? owned.length : inputIndex)
    .filter(
      (event): event is CheckpointEvent =>
        event.kind === 'workspace-checkpoint' && unusable.has(event.environmentId),
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
export async function scopeRetainedOwnerRestorePoint(scope: Scope<unknown>): Promise<
  | {
      readonly checkpointId: string
      readonly takenAt: string
      readonly sourceEnvironmentId: string
    }
  | undefined
> {
  const state = owners.get(scope)
  if (state === undefined || !(await restoreCapable(state.provider))) return undefined
  const owned = ((await state.args.journal.loadTree(state.args.rootId)) ?? []).filter(
    (event) => event.id === state.args.nodeId,
  )
  const latest = restoreBefore(owned, -1)
  return latest === undefined
    ? undefined
    : {
        checkpointId: latest.checkpoint.checkpointId,
        takenAt: latest.at,
        sourceEnvironmentId: latest.checkpoint.source.environmentId,
      }
}

/** @internal Whether another owner release could still destroy what the last one left. */
export function retainedOwnerReleaseRetriable(scope: Scope<unknown>): boolean {
  return owners.get(scope)?.releaseRetriable ?? false
}

/**
 * Mark one drive of the owner in progress until the returned function is called. An abort settles
 * the node while the drive is still ending its turn: stopping the harness, copying its session and
 * handing its workspace capture over. A release that ran then would find no receipt for the turn
 * and keep the source alive, as on terraform-economics-20261005f, where the root's last attempt was
 * recorded two minutes after its environment's release.
 */
export function beginScopeRetainedOwnerDrive(scope: Scope<unknown>): () => void {
  const state = owners.get(scope)
  if (state === undefined) return () => {}
  let end!: () => void
  const drive = new Promise<void>((resolve) => {
    end = resolve
  })
  state.drive = drive
  return () => {
    end()
    if (state.drive === drive) delete state.drive
  }
}

/** Wait, bounded like a turn's own ending, for the owner's drive in progress to end. */
async function ownerDriveEnded(state: OwnerState): Promise<void> {
  const drive = state.drive
  if (drive === undefined) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      drive,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, HARNESS_TRANSCRIPT_SETTLE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Wait for the end-of-turn work the owner's last turn handed over: its workspace capture and the
 * evidence record of its receipt. A turn hands it over so that its node settles without it; the
 * owner's next turn and its environment's release wait for it here.
 */
export async function scopeRetainedOwnerTurnEnded(scope: Scope<unknown>): Promise<void> {
  const state = owners.get(scope)
  if (state === undefined) return
  for (;;) {
    const pending = state.turnEnd
    if (pending === undefined) return
    await pending
    if (state.turnEnd === pending) {
      delete state.turnEnd
      return
    }
  }
}

/** @internal Wait for everything this owner still has in flight: the drive ending its turn, the
 *  work that turn handed over, and a release. */
export async function scopeRetainedOwnerSettled(scope: Scope<unknown>): Promise<void> {
  const state = owners.get(scope)
  if (state === undefined) return
  await ownerDriveEnded(state)
  await scopeRetainedOwnerTurnEnded(scope)
  await state.releasing?.catch(() => undefined)
}

/**
 * Release the owner's environment once no turn of it will run again: at the run's final
 * settlement for the root, and when a nested manager's own scope has finished. A second call while
 * one is in flight joins it. The release first waits for the end-of-turn capture of the owner's
 * last turn, so the capture always precedes the destroy.
 */
export function releaseScopeRetainedOwnerEnvironment(
  scope: Scope<unknown>,
): Promise<readonly UnconfirmedTeardown[]> {
  const state = owners.get(scope)
  const provider = state?.provider
  if (state === undefined || provider === undefined) return Promise.resolve([])
  if (state.releasing !== undefined) return state.releasing
  const releasing = (async () => {
    await ownerDriveEnded(state)
    await scopeRetainedOwnerTurnEnded(scope)
    return await releaseOwnerEnvironment(state, provider)
  })()
  const tracked = releasing.finally(() => {
    if (state.releasing === tracked) delete state.releasing
  })
  state.releasing = tracked
  return tracked
}

async function releaseOwnerEnvironment(
  state: OwnerState,
  provider: AgentEnvironmentProvider,
): Promise<readonly UnconfirmedTeardown[]> {
  const { args } = state
  // No checkpoint may race the destroy below, and none is needed after it.
  state.checkpointsUnavailable ??= 'released'
  await state.checkpointing?.catch(() => undefined)
  const events = [...((await args.journal.loadTree(args.rootId)) ?? [])]
  const requestFailures = await reconcileCheckpointRequests(state, events)
  const pendingSources = new Set(requestFailures.map(({ event }) => event.environmentId))
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
  const checkpointsKept: CaptureRefusal[] = []
  // Sources kept because a checkpoint of theirs is in no capture, and only they can fork it.
  const uncapturedSources = new Set<string>()
  const pending = pendingCheckpoints(events, state).filter(
    (event) => !retentionFailures.has(event.environmentId),
  )
  for (const sourceEnvironmentId of new Set(pending.map((event) => event.environmentId))) {
    const branching = await checkpointHandle(
      state,
      sourceEnvironmentId,
      AbortSignal.timeout(30_000),
    )
    const cleaned = await cleanCheckpoints(
      state,
      branching,
      pending.filter((event) => event.environmentId === sourceEnvironmentId),
      events,
    )
    checkpointFailures.push(...cleaned.unconfirmed)
    checkpointsKept.push(...cleaned.refused)
    for (const refusal of cleaned.refused)
      if (refusal.needsSource) uncapturedSources.add(sourceEnvironmentId)
  }
  const forksUnresolved = await settleCaptureForks(state)
  for (const event of checkpointFailures) pendingSources.add(event.environmentId)
  for (const environmentId of environments) {
    if (released.has(environmentId)) continue
    let destroyed = false
    let detail: string | undefined
    if (
      retentionFailures.has(environmentId) ||
      pendingSources.has(environmentId) ||
      uncapturedSources.has(environmentId)
    ) {
      detail = pendingSources.has(environmentId)
        ? 'checkpoint cleanup unresolved: source preserved for exact lookup and cleanup'
        : uncapturedSources.has(environmentId)
          ? 'checkpoint kept uncaptured: source preserved so its checkpoint can still be forked and captured'
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
    if (!destroyed) {
      // A kept environment keeps its files, never its running harness: the run has settled, so
      // nothing will observe or reconcile an owner turn still executing inside it.
      const runs = unsettledOwnerRuns(events, args.nodeId, environmentId)
      if (runs.length > 0) {
        const stops = await Promise.all(
          runs.map((controlRef) =>
            stopRetainedNativeExecution({
              provider,
              controlRef,
              signal: AbortSignal.timeout(30_000),
              now: args.now,
            }),
          ),
        )
        detail = `${detail}; ${describeRetainedNativeStops(stops)}`
        lastDetail = detail
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
      ({ event, reason }): UnconfirmedTeardown => ({
        id: args.nodeId,
        label: 'scope owner checkpoint request',
        runtime: provider.name,
        status: 'done',
        detail: `checkpoint request unresolved: ${event.request.idempotencyKey} from ${event.environmentId} (${reason})`,
      }),
    ),
    ...checkpointsKept.map(
      ({ event, reason }): UnconfirmedTeardown => ({
        id: args.nodeId,
        label: 'scope owner workspace checkpoint',
        runtime: provider.name,
        status: 'done',
        detail: `checkpoint kept uncaptured: ${event.checkpoint.checkpointId} from ${event.environmentId} (${reason})`,
      }),
    ),
    ...(forksUnresolved.length === 0
      ? []
      : [
          {
            id: args.nodeId,
            label: 'scope owner checkpoint capture fork',
            runtime: provider.name,
            status: 'done',
            detail: `checkpoint capture fork destruction unconfirmed: ${forksUnresolved.join(', ')}`,
          } satisfies UnconfirmedTeardown,
        ]),
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

/**
 * The owner's dispatched executions in one environment whose turn committed no result. A turn
 * with a result has ended; one without may still be running even after a later turn started.
 */
function unsettledOwnerRuns(
  events: readonly SpawnEvent[],
  nodeId: NodeId,
  environmentId: string,
): AgentExactRunControlRef[] {
  const runs = new Map<string, AgentExactRunControlRef>()
  let turn: AgentExactRunControlRef[] = []
  const close = (): void => {
    for (const controlRef of turn) runs.set(contentAddress(controlRef), controlRef)
    turn = []
  }
  for (const event of events) {
    if (!('id' in event) || event.id !== nodeId) continue
    if (event.kind === 'execution-input') close()
    else if (event.kind === 'execution-result') turn = []
    else if (
      event.kind === 'execution-admitted' &&
      event.admission.phase === 'dispatched' &&
      event.admission.controlRef.environmentId === environmentId
    ) {
      turn.push(event.admission.controlRef)
    }
  }
  close()
  return [...runs.values()]
}

interface OwnerAttempt {
  readonly environmentIds: Set<string>
  readonly executionId?: string
  readonly controlByEnvironment: Map<string, AgentExactRunControlRef>
  result?: Extract<SpawnEvent, { kind: 'execution-result' }>
  /** Captures retained as evidence of this attempt: the capture a turn handed over after its
   *  result, or the capture of a turn that failed. */
  readonly evidence: Array<Extract<SpawnEvent, { kind: 'execution-evidence' }>>
}

/**
 * Group owner admissions by input and require a verified workspace receipt before deletion.
 *
 * The receipt is the attempt's committed result, or an evidence record of the same attempt: a
 * turn its manager stopped commits its result first and journals its capture as evidence after
 * it, and a turn that failed journals the capture it took of the stopped session. This runs only
 * at a release no process will resume, so a complete, verified capture of the exact execution is
 * the whole of what keeping the source would preserve.
 */
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
  const fresh = (executionId?: string): OwnerAttempt => ({
    ...(executionId === undefined ? {} : { executionId }),
    environmentIds: new Set<string>(),
    controlByEnvironment: new Map(),
    evidence: [],
  })
  for (const event of events) {
    if (!('id' in event) || event.id !== nodeId) continue
    if (event.kind === 'execution-input') {
      flush()
      current = fresh(`${nodeId}:input:${event.seq}`)
    } else if (event.kind === 'execution-admitted' && event.admission.phase === 'environment') {
      if (current?.result !== undefined) flush()
      current ??= fresh()
      current.environmentIds.add(event.admission.environmentId)
    } else if (event.kind === 'execution-admitted' && event.admission.phase === 'dispatched') {
      current?.controlByEnvironment.set(
        event.admission.controlRef.environmentId,
        event.admission.controlRef,
      )
    } else if (event.kind === 'execution-result') {
      current ??= fresh()
      current.result = event
    } else if (event.kind === 'execution-evidence') {
      current?.evidence.push(event)
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
    const environmentId = [...attempt.environmentIds][0]!
    const controlRef = attempt.controlByEnvironment.get(environmentId)
    const receipts = [
      ...(attempt.result === undefined ? [] : [attempt.result.outRef]),
      ...attempt.evidence.map((event) => event.outRef),
    ]
    let verified = false
    for (const outRef of receipts) {
      const output = await storedOutput(blobs, outRef)
      const snapshot =
        output !== null && typeof output === 'object'
          ? (output as { readonly workspaceSnapshot?: unknown }).workspaceSnapshot
          : undefined
      if (
        hasDurableWorkspaceCapture(output, snapshot, environmentId, attempt.executionId, controlRef)
      ) {
        verified = true
        break
      }
    }
    if (!verified) failures.add(environmentId)
  }
  return failures
}

/** A stored output whose bytes match its content reference, or undefined. */
async function storedOutput(blobs: ResultBlobStore, outRef: string): Promise<unknown | undefined> {
  try {
    const output = await blobs.get(outRef)
    return output === undefined || contentAddress(output) !== outRef ? undefined : output
  } catch {
    return undefined
  }
}

/** A stored result authorizes cleanup only for the exact source and complete capture. */
function hasDurableWorkspaceCapture(
  output: unknown,
  snapshot: unknown,
  environmentId: string,
  executionId: string | undefined,
  controlRef: AgentExactRunControlRef | undefined,
): boolean {
  const parsed = agentCandidateWorkspaceSnapshotEvidenceSchema.safeParse(snapshot)
  if (
    !parsed.success ||
    !('locator' in parsed.data.manifest) ||
    !('locator' in parsed.data.archive)
  )
    return false
  if (output === null || typeof output !== 'object') return false
  const capture = (output as { readonly workspaceCapture?: unknown }).workspaceCapture
  if (capture === null || typeof capture !== 'object') return false
  const receipt = capture as Record<string, unknown>
  const capturedControl = AgentExactRunControlRefSchema.safeParse(receipt.controlRef)
  if (
    executionId === undefined ||
    controlRef === undefined ||
    !capturedControl.success ||
    !sameControlCoordinates(capturedControl.data, controlRef) ||
    receipt.environmentId !== environmentId ||
    receipt.executionId !== executionId ||
    receipt.coverageComplete !== true
  )
    return false
  const linked = agentCandidateWorkspaceSnapshotEvidenceSchema.safeParse(receipt.snapshot)
  return (
    linked.success &&
    linked.data.digest === parsed.data.digest &&
    JSON.stringify(linked.data.manifest) === JSON.stringify(parsed.data.manifest) &&
    JSON.stringify(linked.data.archive) === JSON.stringify(parsed.data.archive)
  )
}

/** Environments that cannot execute another turn, whether absent or terminal at the provider. */
function unusableEnvironmentIds(owned: readonly SpawnEvent[]): ReadonlySet<string> {
  return new Set(
    owned.flatMap((event) =>
      event.kind === 'environment-terminal' ||
      (event.kind === 'environment-teardown' && event.destroyed)
        ? [event.environmentId]
        : [],
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
 * An environment the provider no longer holds or reports terminal runs nothing. Runtime records
 * the provider's exact observation before the next prepare starts a new invocation. A terminal
 * record still requires cleanup at settlement; it is not a teardown receipt.
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
  if (unusableEnvironmentIds(owned).has(environmentId)) return { state: 'lost', environmentId }
  if (!provider.get) return { state: 'unknown', environmentId }
  let environment: Awaited<ReturnType<NonNullable<AgentEnvironmentProvider['get']>>>
  let terminalStatus: 'failed' | 'expired' | undefined
  try {
    environment = await runAbortable(
      () => provider.get!(environmentId),
      AbortSignal.any([scope.signal, AbortSignal.timeout(30_000)]),
      'retained owner environment check timed out',
    )
    if (environment !== null) {
      const found = environment
      if (found.id !== environmentId || found.provider !== provider.name)
        return { state: 'unknown', environmentId }
      const status = await runAbortable(
        () => found.status(),
        AbortSignal.any([scope.signal, AbortSignal.timeout(30_000)]),
        'retained owner environment status timed out',
      )
      if (status === 'failed' || status === 'expired') terminalStatus = status
    }
  } catch {
    return { state: 'unknown', environmentId }
  }
  if (environment !== null && terminalStatus === undefined)
    return { state: 'live', environmentId, inFlight: continued.inFlight }
  scope.signal.throwIfAborted()
  await args.journal.appendEvent(
    args.rootId,
    terminalStatus === undefined
      ? {
          kind: 'environment-teardown',
          id: args.nodeId,
          provider: provider.name,
          environmentId,
          destroyed: true,
          detail:
            'lost: the provider no longer holds this environment, so the next invocation starts in a new one',
          seq: state.nextSequence(),
          at: new Date(args.now()).toISOString(),
        }
      : {
          kind: 'environment-terminal',
          id: args.nodeId,
          provider: provider.name,
          environmentId,
          status: terminalStatus,
          seq: state.nextSequence(),
          at: new Date(args.now()).toISOString(),
        },
  )
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
  const unusable = unusableEnvironmentIds(owned)
  const inFlight = continuedEnvironment(owned)
  if (inFlight?.inFlight && unusable.has(inFlight.admission.environmentId)) {
    // An in-flight invocation in an absent or terminal environment cannot be recovered, and
    // nothing is left running to pay for twice. The next drive is a new invocation.
    delete state.inputSequence
    delete state.taskRef
    state.admissions.length = 0
    delete state.priorSession
  }
  if (
    latestInput?.kind === 'execution-input' &&
    state.inputSequence === latestInput.seq &&
    owned.slice(owned.indexOf(latestInput)).some((event) => event.kind === 'execution-abandoned')
  ) {
    // Nothing of an abandoned invocation is recovered. The next drive is a new invocation in the
    // session the abandoned one continued, and the journal admits its input.
    delete state.inputSequence
    delete state.taskRef
    state.admissions.length = 0
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
  // A later invocation never reuses an environment the provider confirmed unusable.
  if (state.priorSession !== undefined && unusable.has(state.priorSession.environmentId)) {
    delete state.priorSession
  }
  const segmentStarts = owned.filter(
    (event): event is Extract<SpawnEvent, { kind: 'seat-segment' }> =>
      event.kind === 'seat-segment' && event.phase === 'started',
  )
  const latestSeat = segmentStarts.at(-1)
  const previousSeat = segmentStarts.at(-2)
  if (
    latestSeat &&
    previousSeat &&
    latestSeat.provider !== previousSeat.provider &&
    owned.indexOf(latestSeat) > owned.indexOf(latestInput as SpawnEvent)
  ) {
    // A coordinator that died after recording the new segment but before dispatch still starts
    // a fresh native session from the committed checkpoint, never the old provider's session.
    state.forceNewSession = true
  }
  const rootSegment = owned
    .filter(
      (event): event is Extract<SpawnEvent, { kind: 'root-segment' }> =>
        event.kind === 'root-segment',
    )
    .at(-1)
  if (
    rootSegment?.from !== undefined &&
    rootSegment.from.harness !== rootSegment.to.harness &&
    owned.indexOf(rootSegment) > owned.indexOf(latestInput as SpawnEvent)
  ) {
    // A root resumed in another harness: a native session of one harness cannot continue in
    // another. An in-flight turn of the old harness is still recovered as it committed; every
    // invocation after it starts a new session, from the latest checkpoint when the provider holds
    // one, exactly as a seat that changed provider does.
    state.forceNewSession = true
  }
  if (state.forceNewSession) {
    delete state.priorSession
    delete state.forceNewSession
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
