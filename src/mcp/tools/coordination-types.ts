import type { TraceAnalysisStore } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { WatchTraceOptions } from '../../runtime/supervise/detector-monitor'
import type {
  Agent as SuperviseAgent,
  AgentExecutionRef,
  Budget,
  ExecutionBindingReceipt,
  NodeExecutionIdentity,
  ProfileMaterializationReceipt,
  Spend,
  WorkerTraceEvidence,
} from '../../runtime/supervise/types'

/** A worker the driver has drained via `await_event`. */
export interface SettledWorker {
  readonly id: string
  readonly status: 'done' | 'down'
  readonly assignmentId?: string
  readonly identity?: NodeExecutionIdentity
  readonly materialization?: ProfileMaterializationReceipt
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>
  readonly spent?: Spend
  readonly score?: number
  readonly valid?: boolean
  readonly outRef?: string
  readonly reason?: string
  readonly trace: WorkerTraceEvidence
  readonly resumed?: boolean
  readonly settledAt?: number
}

export type QuestionLevel = 'worker' | 'driver' | 'loop'
export type QuestionUrgency = 'continue-without' | 'blocks-step' | 'blocks-run'

export interface QuestionOption {
  readonly label: string
  readonly tradeoff: string
}

export interface Question {
  readonly id: string
  readonly from: string
  readonly level: QuestionLevel
  readonly question: string
  readonly reason: string
  readonly urgency: QuestionUrgency
  readonly options?: ReadonlyArray<QuestionOption>
}

export type QuestionDecision =
  | { readonly kind: 'answer'; readonly answer: string; readonly by: string }
  | { readonly kind: 'defer'; readonly reason: string }
  | { readonly kind: 'escalate'; readonly to: 'parent' | 'user' | string; readonly reason: string }

export interface QuestionRecord extends Question {
  readonly status: 'open' | 'answered' | 'deferred' | 'escalated'
  readonly decision?: QuestionDecision
  readonly openedAt: number
}

export type QuestionPolicy = 'auto' | 'mustDecide' | 'bubble' | 'failClosed'

export interface AnalystRegistry {
  readonly kinds: ReadonlyArray<{ id: string; description: string; area: string }>
  readonly run: (kindId: string, trace: TraceAnalysisStore) => Promise<unknown>
}

export interface AnalystFindingEvent {
  readonly fromWorker: string
  readonly analyst: string
  readonly findings?: unknown
}

export interface AnalyzeOnSettleRoute {
  readonly kind: string
  readonly to?: string
  readonly directive?: string
  readonly over?: ReadonlyArray<string>
}

export type DownMessageDeliveryOutcome =
  | 'delivered'
  | 'unknown-worker'
  | 'already-settled'
  | 'runtime-has-no-inbox'
  | 'scope-stopped'
  | 'runtime-error'

export interface DownMessageDeliveryAttempt {
  readonly receiptId: string
  readonly kind: 'steer' | 'answer'
  readonly toWorker: string
  readonly instructionDigest: string
  readonly interrupt: boolean
  readonly questionId?: string
}

export interface DownMessageEvent {
  readonly receiptId: string
  readonly toWorker: string
  readonly instruction: string
  readonly instructionDigest: string
  readonly delivered: boolean
  readonly outcome: DownMessageDeliveryOutcome
  readonly error?: string
}

export interface ContinuationInstruction {
  readonly receiptId: string
  readonly kind: 'steer' | 'answer'
  readonly toWorker: string
  readonly instruction: string
  readonly instructionDigest: string
  readonly workerIdentity?: NodeExecutionIdentity
  readonly interrupt: boolean
  readonly questionId?: string
}

export interface DownMessageAuthorizationInput {
  readonly kind: 'steer' | 'answer'
  readonly workerId: string
  readonly workerIdentity: NodeExecutionIdentity
  readonly instruction: string
  readonly interrupt: boolean
  readonly questionId?: string
}

export interface AuthorizedDownMessage {
  readonly instruction: string
}

export type AuthorizeDownMessage = (input: DownMessageAuthorizationInput) => AuthorizedDownMessage

export type CoordinationEvent =
  | { readonly type: 'question'; readonly question: QuestionRecord }
  | { readonly type: 'settled'; readonly worker: SettledWorker }
  | { readonly type: 'finding'; readonly finding: AnalystFindingEvent }
  | { readonly type: 'steer'; readonly down: DownMessageEvent; readonly analyst?: string }
  | { readonly type: 'answer'; readonly down: DownMessageEvent; readonly questionId: string }
  | { readonly type: 'instruction'; readonly instruction: ContinuationInstruction }
  | { readonly type: 'delivery-attempt'; readonly attempt: DownMessageDeliveryAttempt }

export interface WorkerSpawnContext {
  readonly assignmentId: string
  readonly parentNodeId: string
  readonly budget: Budget
  readonly task: unknown
  readonly label: string
  readonly key?: string
  readonly execution?: AgentExecutionRef
}

export type MakeWorkerAgent = (
  profile: AgentProfile,
  context?: WorkerSpawnContext,
) => SuperviseAgent<unknown, unknown>

export interface WorkerWatchOptions {
  readonly detectors?: WatchTraceOptions['detectors']
  readonly maxFindingsPerWorker?: number
}
