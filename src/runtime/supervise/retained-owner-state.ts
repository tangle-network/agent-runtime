import type { AgentWorkspaceBranching } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import type { RuntimeHooks } from '../../runtime-hooks'
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
  /** Set on every prepare so a recovered invocation replays the committed identity. */
  freshSessions?: boolean
  /** The previous harness process died. Release that execution before the next dispatch. */
  replaceDeadExecution?: boolean
  provider?: AgentEnvironmentProvider
  /** Current environment id. Admissions miss a provider that never writes one. */
  liveEnvironmentId?: () => string | undefined
  nextSequence: () => number
  /** A failed or unanswered destroy, not a source preserved on purpose. */
  releaseRetriable?: boolean
  /** Each environment's destroy in flight, joined by every later release until it succeeds. */
  destroys?: Map<string, { readonly destroy: Promise<void>; readonly since: number }>
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
  /** Stops a rotation's checkpoint deletes when the turn's own workspace capture starts. */
  rotationCaptures?: AbortController
  /** The drive in progress: from before its executor exists until its turn has ended. */
  drive?: Promise<void>
  /** End-of-turn work a turn handed over: its workspace capture and the evidence of its receipt. */
  turnEnd?: Promise<void>
  /** The release in progress, so a second caller joins it instead of destroying twice. */
  releasing?: Promise<readonly UnconfirmedTeardown[]>
}

/** @internal */
export interface OwnerRegistration {
  readonly hooks?: RuntimeHooks
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

/** Bound native custody, read from its canonical receipts without probing another provider. */
export function scopeOwnerLiabilities(
  scope: Scope<unknown>,
  events: readonly SpawnEvent[],
): {
  environmentHeld: boolean
  invocationUnsettled: boolean
  measuredResources: ReadonlyMap<string, string>
} {
  const state = owners.get(scope)
  if (!state)
    return { environmentHeld: false, invocationUnsettled: false, measuredResources: new Map() }
  const held = new Set<string>()
  const destroyed = new Set<string>()
  const forks = new Set<string>()
  const key = (provider: string, id: string) => JSON.stringify([provider, id])
  const forkKey = (provider: string, id: string, environmentId?: string) =>
    JSON.stringify([provider, id, environmentId ?? null])
  let invocationUnsettled = false
  let environment: string | undefined
  const measurements = new Map<string, Map<string, string>>()
  for (const event of events) {
    if (event.id !== state.args.nodeId) continue
    if (event.kind === 'execution-admitted') {
      invocationUnsettled = true
      if (event.admission.phase === 'environment') {
        environment = key(event.admission.provider, event.admission.environmentId)
        held.add(environment)
        destroyed.delete(environment)
        measurements.delete(environment)
      }
    } else if (event.kind === 'execution-result') {
      invocationUnsettled = false
      if (environment !== undefined)
        measurements.set(
          environment,
          new Map(
            Object.entries(event.spent.resources ?? {}).flatMap(([name, value]) =>
              value.known ? [[name, value.unit] as const] : [],
            ),
          ),
        )
    } else if (event.kind === 'environment-teardown' && event.destroyed) {
      held.delete(key(event.provider, event.environmentId))
      destroyed.add(key(event.provider, event.environmentId))
    } else if (event.kind === 'workspace-checkpoint-fork-requested')
      forks.add(forkKey(event.provider, event.idempotencyKey))
    else if (event.kind === 'workspace-checkpoint-fork-ready') {
      forks.delete(forkKey(event.provider, event.fork.idempotencyKey))
      forks.add(forkKey(event.provider, event.fork.idempotencyKey, event.fork.environmentId))
    } else if (event.kind === 'workspace-checkpoint-fork-teardown' && event.destroyed) {
      forks.delete(forkKey(event.provider, event.fork.idempotencyKey))
      forks.delete(forkKey(event.provider, event.fork.idempotencyKey, event.fork.environmentId))
    }
  }
  const live = state.liveEnvironmentId?.()
  if (
    live !== undefined &&
    (state.provider === undefined || !destroyed.has(key(state.provider.name, live)))
  )
    held.add(key(state.provider?.name ?? '', live))
  const measuredResources = new Map(measurements.get([...held][0] ?? '') ?? [])
  for (const reference of held)
    for (const [name, unit] of measuredResources)
      if (measurements.get(reference)?.get(name) !== unit) measuredResources.delete(name)
  if (forks.size > 0 || invocationUnsettled) measuredResources.clear()
  return {
    environmentHeld: held.size > 0 || forks.size > 0,
    invocationUnsettled,
    measuredResources,
  }
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

/** Bind the provider that owns native stop, checkpoint and environment acknowledgements. */
export function bindScopeRetainedOwnerProvider(
  scope: Scope<unknown>,
  provider: AgentEnvironmentProvider,
): void {
  const state = owners.get(scope)
  if (state) state.provider = provider
}

/** Bind the resolver for the owner's current environment id. Admissions alone miss a provider that never writes an environment admission. */
export function bindScopeRetainedOwnerEnvironmentId(
  scope: Scope<unknown>,
  liveEnvironmentId: () => string | undefined,
): void {
  const state = owners.get(scope)
  if (state) state.liveEnvironmentId = liveEnvironmentId
}
