import type { AgentProfile, AgentWorkspaceBranching } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import type { ProviderWorkspaceRetentionPort } from '../provider-workspace-retention'
import type { RetainedRunAdmission, RetainedRunEnvironmentAdmission } from '../retained-run-types'
import type { RetainedExecutorContext, RetainedWorkspaceRestore } from './retained-executor'
import type {
  ExecutorResult,
  NodeId,
  ResultBlobStore,
  Scope,
  SpawnEvent,
  SpawnJournal,
  UnconfirmedTeardown,
} from './types'

/** @internal */
export interface OwnerState {
  readonly admissions: RetainedRunAdmission[]
  readonly context: RetainedExecutorContext
  readonly args: OwnerRegistration
  inputSequence?: number
  prepared?: boolean
  acceptedConsumed?: boolean
  priorSession?: RetainedRunEnvironmentAdmission
  /** A changed native provider starts a new harness session from a verified checkpoint. */
  forceNewSession?: boolean
  /** `continuation.session: 'fresh'`: a later invocation keeps the environment and starts a new
   *  harness session in it. Set on every prepare, so a recovered invocation replays the identity
   *  it committed. */
  freshSessions?: boolean
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
  /** Cuts short the captures a checkpoint rotation is running, when a turn's own workspace
   *  capture starts. */
  rotationCaptures?: AbortController
  /** The drive in progress: from before its executor exists until its turn has ended. */
  drive?: Promise<void>
  /** End-of-turn work a turn handed over: its workspace capture and the evidence of its receipt. */
  turnEnd?: Promise<void>
  /** The release in progress, so a second caller joins it instead of destroying twice. */
  releasing?: Promise<readonly UnconfirmedTeardown[]>
  /** Capture retries of the evidence this node owes, while any is owed; the release stops them. */
  evidenceRetry?: { readonly stop: AbortController; done: Promise<void> }
}

/** @internal */
export interface OwnerRegistration {
  readonly rootId: NodeId
  readonly executionRootId?: NodeId
  readonly nodeId: NodeId
  readonly depth?: number
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly priorEvents: readonly SpawnEvent[]
  readonly now: () => number
}

export const owners = new WeakMap<object, OwnerState>()

/** @internal Scope construction carries this private policy to every nested owner scope. */
export const retainedOwnerWorkspaceRetentionSeamKey = 'runtime.retainedOwnerWorkspaceRetention'

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
