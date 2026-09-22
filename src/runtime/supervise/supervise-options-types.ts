import type {
  AgentProfile,
  AgentProfileSecurityPolicy,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import type { ProfileMaterializationContract } from '../../agent/profile-materialization'
import type {
  AnalystRegistry,
  AnalyzeOnSettleRoute,
  AuthorizedDownMessage,
  CoordinationEvent,
  DownMessageAuthorizationInput,
  MakeWorkerAgent,
  WorkerWatchOptions,
} from '../../mcp/tools/coordination-types'
import type { RuntimeHooks } from '../../runtime-hooks'
import type { RouterConfig } from '../router-client'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import type { DeliverableSpec } from './completion-gate'
import type { BusRecord } from './event-bus'
import type { SupervisorFinalizer } from './finalizer'
import type { SupervisorSpanOptions } from './otel-spans'
import type { ExecutorConfig } from './runtime'
import type { StopRule } from './stop-rules'
import type {
  CoordinationBinding,
  DriveHarness,
  ResolveDriveHarness,
  ResolveSupervisorTools,
  SupervisorNodeContext,
} from './supervisor-agent'
import type {
  AgentExecutionRef,
  Budget,
  NodeExecutionIdentity,
  ResultBlobStore,
  RootHandle,
  SpawnJournal,
} from './types'
import type { WaitProbeRegistry } from './wait'

export interface SuperviseRegistryTable<T> {
  resolve(name: string): T | undefined
}

export interface SuperviseRegistry {
  readonly deliverables?: SuperviseRegistryTable<DeliverableSpec<unknown>>
  readonly finalizers?: SuperviseRegistryTable<SupervisorFinalizer>
  readonly analysts?: SuperviseRegistryTable<AnalystRegistry>
  readonly probes?: SuperviseRegistryTable<WaitProbeRegistry>
}

export interface AuthorizedSpawn {
  readonly profile: AgentProfile
  readonly execution?: AgentExecutionRef
}

export interface AuthorizedSpawnContext {
  readonly profile: AgentProfile
  readonly parent: AgentProfile
  readonly parentIdentity: NodeExecutionIdentity
  readonly execution: NodeExecutionIdentity
  readonly parentNodeId: string
  readonly assignmentId: string
  readonly task: unknown
  readonly budget: Budget
  readonly label: string
  readonly key?: string
  readonly depth: number
}

export type DeliverableResolutionInput = AuthorizedSpawnContext

export interface SuperviseOptions {
  readonly budget: Budget
  readonly rootHandle?: RootHandle<unknown>
  readonly signal?: AbortSignal
  readonly execution?: AgentExecutionRef
  readonly backend?: ExecutorConfig
  readonly deliverable?: DeliverableSpec<unknown> | string
  readonly resolveDeliverable?: (
    input: DeliverableResolutionInput,
  ) => DeliverableSpec<unknown> | undefined
  readonly registry?: SuperviseRegistry
  readonly coordination?: CoordinationBinding
  readonly makeWorkerAgent?: MakeWorkerAgent
  readonly driverBackend?: ExecutorConfig
  readonly profileSecurity?: AgentProfileSecurityPolicy
  readonly authorizeSpawn?: (input: {
    readonly profile: AgentProfile
    readonly parent: AgentProfile
    readonly parentIdentity: NodeExecutionIdentity
    readonly parentNodeId: string
    readonly assignmentId: string
    readonly task: unknown
    readonly budget: Budget
    readonly label: string
    readonly key?: string
    readonly depth: number
  }) => AuthorizedSpawn
  readonly authorizeMessage?: (
    input: DownMessageAuthorizationInput & {
      readonly parent: AgentProfile
      readonly depth: number
    },
  ) => AuthorizedDownMessage
  readonly isDriverProfile?: (input: AuthorizedSpawnContext) => boolean
  readonly router?: RouterConfig
  readonly brain?: ToolLoopChat
  readonly driveHarness?: DriveHarness
  readonly resolveDriveHarness?: ResolveDriveHarness
  readonly driveHarnessMaterialization?: ProfileMaterializationContract
  readonly resolveSupervisorTools?: ResolveSupervisorTools
  readonly onCoordinationEvent?: (
    context: SupervisorNodeContext,
    eventId: Sha256Digest,
    record: BusRecord<CoordinationEvent>,
  ) => void | Promise<void>
  readonly extraTools?: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly parameters: Record<string, unknown>
  }>
  readonly executeExtraTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string | null | undefined>
  readonly perWorker?: Budget
  readonly maxLiveWorkers?: number
  readonly analysts?: AnalystRegistry | string
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
  readonly watchWorkers?: WorkerWatchOptions
  readonly stallAfterMs?: number
  readonly blobs?: ResultBlobStore
  readonly runDir?: string
  readonly controlCapabilityToken?: string
  readonly journal?: SpawnJournal
  readonly probes?: WaitProbeRegistry | string
  readonly stopRule?: StopRule
  readonly onProgressStop?: (reason: string) => void
  readonly maxDepth?: number
  readonly maxTurns?: number
  readonly compaction?: ToolLoopCompactionOptions
  readonly runId?: string
  readonly now?: () => number
  readonly allowedModels?: readonly string[]
  readonly finalizer?: SupervisorFinalizer | string
  readonly hooks?: RuntimeHooks
  readonly otel?: Omit<SupervisorSpanOptions, 'runId' | 'now'>
}
