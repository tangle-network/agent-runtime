import type { RuntimeHooks } from '../../runtime-hooks'
import type {
  Agent,
  Budget,
  DefaultVerdict,
  ExecutorRegistry,
  NodeExecutionIdentity,
  NodeId,
  RootMaterialization,
  Spend,
} from './types-core'
import type { ResultBlobStore, SpawnJournal } from './types-journal'
import type { Handle, ResumedWork, Scope, Settled, TreeView } from './types-scope'
import type { WaitProbeRegistry } from './wait'
import type { WorkerTraceResolver } from './worker-trace-types'

export interface Supervisor<Task, Out> {
  run(root: Agent<Task, Out>, task: Task, opts: SupervisorOpts): Promise<SupervisedResult<Out>>
  attach(h: RootHandle<Out>): void
}

export interface SupervisorOpts {
  readonly budget: Budget
  readonly rootIdentity?: NodeExecutionIdentity
  readonly rootMaterialization?: RootMaterialization
  readonly runId: NodeId
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly executors: ExecutorRegistry
  readonly probes?: WaitProbeRegistry
  readonly maxDepth?: number
  readonly maxLiveWorkers?: number
  readonly maxRestarts?: number
  readonly withinMs?: number
  readonly resume?: boolean
  readonly now?: () => number
  readonly signal?: AbortSignal
  readonly controlDir?: string
  readonly controlCapabilityToken?: string
  readonly hooks?: RuntimeHooks
  readonly workerTrace?: WorkerTraceResolver
  readonly workerTraceUnpropagated?: {
    readonly backend: string
    readonly reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted'
  }
}

export interface NoWinnerError {
  name: string
  message: string
  stack?: string
}

export type SupervisedResult<Out> =
  | {
      kind: 'winner'
      out: Out
      outRef: string
      verdict?: DefaultVerdict
      tree: TreeView
      spentTotal: Spend
      spentBreakdown?: { driverInference: Spend; childWork: Spend }
    }
  | {
      kind: 'no-winner'
      reason: 'all-children-down' | 'budget-exhausted' | 'aborted'
      tree: TreeView
      downCount: number
      spentTotal: Spend
      error?: never
    }
  | {
      kind: 'no-winner'
      reason: 'driver-failed'
      tree: TreeView
      downCount: number
      spentTotal: Spend
      error: NoWinnerError
    }

export type RootControlStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface RootControlSnapshot {
  readonly status: RootControlStatus
  readonly tree: TreeView
}

export interface RootHandle<Out> {
  view(): TreeView
  controlSnapshot?(): RootControlSnapshot
  deliver?(msg: unknown): boolean
  steer?(nodeId: NodeId, msg: unknown): boolean
  cancelWorker?(nodeId: NodeId, reason?: string): boolean
  signal(msg: RootSignal): void
  abort(reason?: string): void
  readonly __out?: Out
}

export interface ControllableRootHandle<Out> extends RootHandle<Out> {
  steer(nodeId: NodeId, msg: unknown): boolean
  cancelWorker(nodeId: NodeId, reason?: string): boolean
}

export interface SteerableRootHandle<Out> extends ControllableRootHandle<Out> {
  deliver(msg: unknown): boolean
}

export type RootSignal =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'cancel'; reason?: string }
  | { kind: 'ask'; question: string }

export interface WidenGate<Out> {
  shouldWiden(settled: Settled<Out>, budget: Scope<Out>['budget']): boolean
  readonly judgeExempt?: boolean
}

export type { Handle, ResumedWork }
