import type { RuntimeHooks } from '../../runtime-hooks'
import type { BudgetPool } from './budget'
import type { ExecutorProgress } from './progress'
import type { TraceSource } from './trace-source'
import type {
  Budget,
  DefaultVerdict,
  ExecutionBindingReceipt,
  NodeExecutionIdentity,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  ProfileMaterializationReceipt,
  ResultBlobStore,
  ResumedKeyState,
  Scope,
  Settled,
  SpawnJournal,
  Spend,
  TreeView,
  WorkerTraceEvidence,
} from './types'
import type { PendingWait, WaitProbeRegistry, WaitSpec } from './wait'
import type { WorkerTraceResolver } from './worker-trace-types'

export interface ScopeArgs {
  readonly parentId: NodeId
  readonly root: NodeId
  readonly pool: BudgetPool
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly executors: import('./types').ExecutorRegistry
  readonly probes?: WaitProbeRegistry
  readonly waitSleep?: (ms: number, signal: AbortSignal) => Promise<void>
  readonly seams: Readonly<Record<string, unknown>>
  readonly depth: number
  readonly maxDepth?: number
  readonly maxLiveWorkers?: number
  readonly liveWorkerCapacity?: LiveWorkerCapacityState
  readonly signal: AbortSignal
  readonly now?: () => number
  readonly hooks?: RuntimeHooks
  readonly workerTrace?: WorkerTraceResolver
  readonly workerTraceUnpropagated?: {
    readonly backend: string
    readonly reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted'
  }
  readonly ownerMaterialization?: {
    readonly runtime: NodeSnapshot['runtime']
    readonly authoredProfile?: unknown
    readonly attemptId: string
    readonly prior?: ProfileMaterializationReceipt
    readonly journalRoot?: NodeId
    readonly nodeId?: NodeId
    readonly requiredKnown?: boolean
    readonly onReceipt?: (
      materialization: ProfileMaterializationReceipt,
      binding: ExecutionBindingReceipt,
    ) => void
  }
  readonly resumeFrom?: {
    readonly settled: ReadonlyArray<Settled<unknown>>
    readonly view: TreeView
    readonly maxSpawnOrdinal: number
    readonly maxCursorSeq: number
    readonly maxWaitOrdinal: number
    readonly waits: ReadonlyArray<PendingWait>
    readonly keys: ReadonlyMap<string, ResumedKeyState<unknown>>
    readonly priorSpend: { readonly childWork: Spend; readonly driverInference: Spend }
  }
}

export interface LiveWorkerCapacityState {
  readonly max: number | undefined
  live: number
}

export type PreSeqSettled =
  | {
      kind: 'done'
      out: unknown
      outRef: string
      verdict?: DefaultVerdict
      spent: Spend
      trace: WorkerTraceEvidence
      metered?: Spend
    }
  | {
      kind: 'down'
      reason: string
      infra: boolean
      restartCount: number
      trace: WorkerTraceEvidence
      metered?: Spend
    }

export interface LiveChild {
  readonly id: NodeId
  status: NodeStatus
  runtime: NodeSnapshot['runtime']
  readonly ownedTreeRoot?: NodeId
  readonly budget: Budget
  readonly label: string
  readonly assignmentId?: string
  readonly identity?: NodeExecutionIdentity
  readonly key?: string
  spent: Spend
  outRef?: string
  trace?: WorkerTraceEvidence
  settledAt?: number
  readonly settled: Promise<PreSeqSettled>
  resolved?: PreSeqSettled
  executorDone: boolean
  cleanupConfirmed: boolean
  delivered: boolean
  readonly deliver?: (msg: unknown) => boolean
  readonly abort: (reason?: string) => void
  readonly isAborted: () => boolean
  readonly readProgress?: () => ExecutorProgress | undefined
  readonly readTraceSource?: () => TraceSource | undefined
  materialization?: ProfileMaterializationReceipt
  executionBindings: ExecutionBindingReceipt[]
  readonly startedAt: number
  lastActivityAt: number
  readonly wait?: {
    readonly spec: WaitSpec
    readonly armedAt: number
    readonly label: string
    armCommitted: boolean
  }
}

export const nestedScopeSeamKey = 'nested-scope'

export interface NestedScopeSeam {
  readonly nodeId: NodeId
  readonly depth: number
  readonly maxDepth?: number
  readonly journalRoot: NodeId
  mount(nestedRoot: NodeId, signal: AbortSignal): Scope<unknown>
}

export interface DeferredOwnerSlot {
  ownerMaterialization?: NonNullable<ScopeArgs['ownerMaterialization']>
}

export type KeyState<Out> =
  | { readonly state: 'live'; readonly id: NodeId; readonly identity: NodeExecutionIdentity }
  | {
      readonly state: 'done'
      readonly id: NodeId
      readonly identity: NodeExecutionIdentity
      readonly settled: Settled<Out> & { kind: 'done' }
    }
  | {
      readonly state: 'down'
      readonly id: NodeId
      readonly identity: NodeExecutionIdentity
      readonly reason: string
    }
  | { readonly state: 'in-doubt'; readonly id: NodeId; readonly identity: NodeExecutionIdentity }

export interface SpawnContext<Out> {
  readonly args: ScopeArgs
  readonly children: Map<NodeId, LiveChild>
  readonly keyed: Map<string, KeyState<Out>>
  readonly recordKeyedSettlement: (key: string, settled: Settled<Out>) => void
  readonly nextOrdinal: () => number
  readonly liveWorkerCapacity: LiveWorkerCapacityState
  readonly now: () => number
  readonly makeNestedScopeSeam: (
    childNodeId: NodeId,
    childBudget: Budget,
    childDeadlineAtMs: number | undefined,
    deferredOwner: DeferredOwnerSlot,
  ) => NestedScopeSeam
}

export interface WaitContext {
  readonly args: ScopeArgs
  readonly children: Map<NodeId, LiveChild>
  readonly nextOrdinal: () => number
  readonly unclaimedWaits: Map<string, PendingWait>
  readonly now: () => number
}
