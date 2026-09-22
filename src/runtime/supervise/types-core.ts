import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type { AgentProfile, Sha256Digest, StreamEvent } from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import type { LoopTokenUsage } from '../types'
import type { ExecutorProgress, WorkerProgress } from './progress-types'
import type { NodeStatus } from './scope-node-types'
import type { TraceSource } from './trace-source'
import type { PendingWait, WaitOutcome, WaitProbeRegistry, WaitRejection, WaitSpec } from './wait'

export type {
  DefaultVerdict,
  LoopTokenUsage,
  PendingWait,
  WaitOutcome,
  WaitProbeRegistry,
  WaitRejection,
  WaitSpec,
  NodeStatus,
}
export type { ExecutorProgress, WorkerProgress } from './progress-types'

export interface WaitOpts {
  readonly label: string
}

export interface Agent<Task, Out> {
  readonly name: string
  act(task: Task, scope: Scope<Out>): Promise<Out>
  // biome-ignore lint/suspicious/noConfusingVoidType: legacy agents may not acknowledge delivery.
  deliver?(msg: unknown): void | boolean
}

export interface Executor<Out> {
  readonly runtime: Runtime
  readonly budgetExempt?: boolean
  execute(
    task: unknown,
    signal: AbortSignal,
  ): Promise<ExecutorResult<Out>> | AsyncIterable<UsageEvent>
  // biome-ignore lint/suspicious/noConfusingVoidType: legacy executors may not acknowledge delivery.
  deliver?(msg: unknown): void | boolean
  progress?(): ExecutorProgress | undefined
  traceSource?(): TraceSource | undefined
  teardown(grace: number | 'brutalKill' | 'infinity'): Promise<{ destroyed: boolean }>
  resultArtifact(): { outRef: string; out: Out; verdict?: DefaultVerdict; spent: Spend }
  accounting?(): ExecutorAccounting | undefined
  metered?(): Spend | undefined
}

export type WorkerTraceUnavailableReason =
  | 'execution-did-not-start'
  | 'executor-did-not-expose-trace-source'
  | 'trace-source-unavailable'
  | 'no-tool-spans-captured'
  | 'invalid-tool-spans'
  | 'trace-collection-failed'
  | 'trace-persistence-failed'
  | 'legacy-settlement-without-trace-evidence'
  | 'not-an-executor'

export type WorkerTraceEvidence =
  | { readonly status: 'available'; readonly traceRef: string; readonly spanCount: number }
  | { readonly status: 'unavailable'; readonly reason: WorkerTraceUnavailableReason }

export interface ExecutorAccounting {
  readonly reported: Spend
  readonly reservation: Spend
}

export interface ExecutorResult<Out> {
  outRef: string
  out: Out
  verdict?: DefaultVerdict
  spent: Spend
}

export type UsageEvent =
  | { kind: 'tokens'; input: number; output: number }
  | { kind: 'cost'; usdKnown?: false; usd: number }
  | { kind: 'iteration' }
  | {
      kind: 'runtime_event'
      event: StreamEvent
      eventId?: string
      cursor?: string
      sequence?: number
      occurredAt?: string
    }

export type Runtime = 'router' | 'inline' | 'sandbox' | 'cli' | (string & {})

export interface AgentSpec {
  readonly profile: AgentProfile
  readonly harness: BackendType | null
  readonly execution?: AgentExecutionRef
  readonly executorFactory?: ExecutorFactory<unknown>
  readonly executor?: Executor<unknown>
}

export interface AgentExecutionRef {
  readonly candidateDigest?: Sha256Digest
  readonly correlation?: Readonly<Record<string, string>>
}

export interface NodeExecutionIdentity extends AgentExecutionRef {
  readonly profileDigest?: Sha256Digest
  readonly taskDigest?: Sha256Digest
}

export type MaterializedModelIdentity =
  | { readonly status: 'known'; readonly id: string }
  | { readonly status: 'unknown'; readonly reason: string }

export interface MaterializedExecutionIdentity {
  readonly kind: string
  readonly id: string
}

export interface ExecutorMaterialization {
  readonly effectiveProfile: AgentProfile
  readonly backend: string
  readonly model: MaterializedModelIdentity
  readonly execution: MaterializedExecutionIdentity
  readonly materializer: string
  readonly plan: unknown
  readonly platformAttachments?: unknown
}

export interface ExecutorExecutionBinding {
  readonly attemptId: string
  readonly binding: unknown
  readonly descriptor: Readonly<Record<string, string | number | boolean | null>>
}

export type UnknownMaterializationReason =
  | 'executor-did-not-report'
  | 'invalid-executor-report'
  | 'root-agent-did-not-report'

export type ProfileMaterializationReceipt =
  | {
      readonly status: 'known'
      readonly authoredProfileDigest: Sha256Digest
      readonly effectiveProfileDigest: Sha256Digest
      readonly materializationPlanDigest: Sha256Digest
      readonly platformAttachmentsDigest?: Sha256Digest
      readonly runtime: Runtime
      readonly backend: string
      readonly model: MaterializedModelIdentity
      readonly execution: MaterializedExecutionIdentity
      readonly materializer: string
    }
  | {
      readonly status: 'unknown'
      readonly authoredProfileDigest?: Sha256Digest
      readonly runtime: Runtime
      readonly reason: UnknownMaterializationReason
    }

export type ExecutionBindingReceipt =
  | {
      readonly status: 'known'
      readonly attemptId: string
      readonly materializationReceiptDigest: Sha256Digest
      readonly bindingDigest: Sha256Digest
      readonly descriptor: Readonly<Record<string, string | number | boolean | null>>
    }
  | {
      readonly status: 'unknown'
      readonly attemptId: string
      readonly materializationReceiptDigest: Sha256Digest
      readonly reason: UnknownMaterializationReason
    }

export type RootMaterialization =
  | {
      readonly runtime: Runtime
      readonly declaration: ExecutorMaterialization
      readonly binding: Omit<ExecutorExecutionBinding, 'attemptId'>
    }
  | {
      readonly runtime: Runtime
      readonly declaration: 'deferred'
      readonly authoredProfile: AgentProfile
    }

export type NodeId = string

export interface ExecutorNodeContext {
  readonly rootId: NodeId
  readonly parentId: NodeId
  readonly nodeId: NodeId
  readonly attemptId: string
  readonly identity?: NodeExecutionIdentity
}

export type ExecutorFactory<Out> = (spec: AgentSpec, ctx: ExecutorContext) => Executor<Out>

export interface ExecutorContext {
  readonly signal: AbortSignal
  readonly node?: ExecutorNodeContext
  readonly seams: Readonly<Record<string, unknown>>
}

export interface ExecutorRegistry {
  register<Out>(runtime: Runtime, factory: ExecutorFactory<Out>): void
  resolve<Out>(
    spec: AgentSpec,
  ): { succeeded: true; value: ExecutorFactory<Out> } | { succeeded: false; error: string }
}

export interface Budget {
  readonly maxIterations: number
  readonly maxTokens: number
  readonly maxUsd?: number
  readonly deadlineMs?: number
}

export interface Spend {
  iterations: number
  tokens: LoopTokenUsage
  tokensKnown?: boolean
  usdKnown?: boolean
  usd: number
  ms: number
}

export type Restart = 'temporary' | 'transient' | 'permanent'

export type SpawnOpts = {
  readonly budget: Budget
  readonly label: string
  readonly assignmentId?: string
  readonly restart?: Restart
  readonly shutdown?: number | 'brutalKill' | 'infinity'
  readonly key?: string
}

export type SpawnRejection =
  | 'budget-exhausted'
  | 'usd-unbudgeted'
  | 'below-runtime-floor'
  | 'depth-exceeded'
  | 'duplicate-key'
  | 'invalid-identity'
  | 'key-conflict'
  | 'max-live-workers'
  | 'scope-aborted'

export type SpawnPrior<Out = unknown> =
  | { readonly state: 'completed'; readonly settled: Settled<Out> & { kind: 'done' } }
  | { readonly state: 'retried'; readonly priorId: NodeId; readonly reason: string }
  | { readonly state: 'lost'; readonly priorId: NodeId }

export interface Handle<Out> {
  readonly id: NodeId
  readonly label: string
  readonly status: NodeStatus
  readonly assignmentId?: string
  readonly identity?: NodeExecutionIdentity
  readonly materialization?: ProfileMaterializationReceipt
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>
  abort(reason?: string): void
  readonly __out?: Out
}

export type Settled<Out> =
  | {
      kind: 'done'
      handle: Handle<Out>
      out: Out
      outRef: string
      verdict?: DefaultVerdict
      spent: Spend
      trace: WorkerTraceEvidence
      settledAt?: number
      seq: number
    }
  | {
      kind: 'down'
      handle: Handle<Out>
      reason: string
      infra: boolean
      restartCount: number
      trace: WorkerTraceEvidence
      settledAt?: number
      seq: number
    }

export interface Scope<Out> {
  spawn<C extends Out>(
    agent: Agent<unknown, C> | (() => Agent<unknown, C>),
    task: unknown,
    opts: SpawnOpts,
  ): { ok: true; handle: Handle<C>; prior?: SpawnPrior<C> } | { ok: false; reason: SpawnRejection }
  next(): Promise<Settled<Out> | null>
  nextResolved(): Promise<Settled<Out> | null>
  send(nodeId: NodeId, msg: unknown): boolean
  cancel(nodeId: NodeId, reason?: string): boolean
  wait(
    spec: WaitSpec,
    opts: { readonly label: string },
  ): { ok: true; handle: Handle<WaitOutcome> } | { ok: false; reason: WaitRejection }
  progress(
    nodeId: NodeId,
    opts?: { now?: number; stallAfterMs?: number },
  ): WorkerProgress | undefined
  traceSource(nodeId: NodeId): TraceSource | undefined
  readonly signal: AbortSignal
  meter(spend: Spend, detail?: Record<string, unknown>): Promise<void>
  readonly resume?: ResumedWork<Out>
  readonly view: TreeView
  readonly budget: Readonly<{
    tokensLeft: number
    tokensKnown: boolean
    usdLeft: number
    usdCapped: boolean
    usdKnown: boolean
    iterationsLeft: number
    deadlineMs: number
    reservedTokens: number
  }>
  readonly workerCapacity: Readonly<{ live: number; freeSlots: number | null }>
}

export interface ResumedWork<Out> {
  readonly settled: ReadonlyArray<Settled<Out>>
  readonly view: TreeView
  readonly waits: ReadonlyArray<PendingWait>
  readonly keys: ReadonlyMap<string, ResumedKeyState<Out>>
  readonly priorSpend: { readonly childWork: Spend; readonly driverInference: Spend }
}

export interface ResumedKeyState<Out = unknown> {
  readonly id: NodeId
  readonly label: string
  readonly identity?: NodeExecutionIdentity
  readonly state: 'completed' | 'down' | 'in-doubt'
  readonly settled?: Settled<Out>
}

export interface NodeSnapshot {
  readonly id: NodeId
  readonly parent?: NodeId
  readonly label: string
  readonly status: NodeStatus
  readonly runtime: Runtime
  readonly budget: Budget
  readonly ownedTreeRoot?: NodeId
  readonly assignmentId?: string
  readonly identity?: NodeExecutionIdentity
  readonly materialization?: ProfileMaterializationReceipt
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>
  readonly settledAt?: number
  readonly spent: Spend
  readonly outRef?: string
  readonly trace?: WorkerTraceEvidence
}

export interface TreeView {
  readonly root: NodeId
  readonly nodes: ReadonlyArray<NodeSnapshot>
  readonly inFlight: number
  readonly waiting: number
}
