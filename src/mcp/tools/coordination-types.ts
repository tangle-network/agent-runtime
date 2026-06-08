import type {
  Budget,
  LoopFindingInput,
  LoopMessageInput,
  LoopPacket,
  NodeId,
  ResultBlobStore,
  LoopQuestion as RuntimeLoopQuestion,
  LoopQuestionDecision as RuntimeQuestionDecision,
  Scope,
  Agent as SuperviseAgent,
} from '../../runtime'
import type { McpToolDescriptor } from '../server'

/** A worker the driver has drained via `await_next`. */
export interface SettledWorker {
  readonly id: string
  readonly status: 'done' | 'down'
  readonly score?: number
  readonly valid?: boolean
  readonly outRef?: string
  readonly reason?: string
}

/** A question raised by a worker/driver that the current driver cannot safely answer inline. */
export type LoopQuestion = Omit<RuntimeLoopQuestion, 'openedAt' | 'status' | 'decision'>

export type QuestionDecision = RuntimeQuestionDecision

export type QuestionRecord = RuntimeLoopQuestion

export type LoopQuestionInput = Omit<LoopQuestion, 'id'> & { readonly id?: string }

export type LoopPacketMessage = Omit<LoopMessageInput, 'to'> & {
  readonly to: NodeId
}

export interface LoopPacketAnalysisInput {
  /** The newly-settled packet before analysis output is attached. */
  readonly packet: LoopPacket
  /** Prior packets plus `packet`, in packet order. */
  readonly packets: ReadonlyArray<LoopPacket>
  readonly questions: ReadonlyArray<QuestionRecord>
  readonly budget: Scope<unknown>['budget']
}

export interface LoopPacketAnalysis {
  readonly findings?: ReadonlyArray<LoopFindingInput>
  readonly questions?: ReadonlyArray<LoopQuestionInput>
  readonly messages?: ReadonlyArray<LoopPacketMessage>
}

export type LoopPacketAnalyzer = (
  input: LoopPacketAnalysisInput,
) => LoopPacketAnalysis | undefined | Promise<LoopPacketAnalysis | undefined>

export type QuestionPolicyMode = 'auto' | 'mustDecide' | 'bubble' | 'failClosed'

export interface AnalystRegistry {
  readonly kinds: ReadonlyArray<{ id: string; description: string; area: string }>
  readonly run: (kindId: string, trace: unknown) => Promise<unknown>
  readonly auto?: ReadonlyArray<string>
}

export type LoopEvent =
  | { readonly type: 'question'; readonly question: QuestionRecord }
  | { readonly type: 'packet'; readonly packet: LoopPacket }

export type MakeWorkerAgent = (profile: unknown) => SuperviseAgent<unknown, unknown>

export interface CoordinationToolsOptions {
  readonly scope: Scope<unknown>
  readonly blobs: ResultBlobStore
  readonly makeWorkerAgent: MakeWorkerAgent
  readonly perWorker: Budget
  /** Trace analyst registry. `auto` kinds are attached to every settled loop packet. */
  readonly analysts?: AnalystRegistry
  /** Optional lifecycle hook after every settled child: findings, questions, and messages land on the packet. */
  readonly analyzePacket?: LoopPacketAnalyzer
  readonly onEvent?: (event: LoopEvent) => void | Promise<void>
  readonly questionPolicy?: QuestionPolicyMode
}

export interface CoordinationTools {
  readonly tools: McpToolDescriptor[]
  isStopped(): boolean
  stopReason(): string | undefined
  settled(): ReadonlyArray<SettledWorker>
  packets(): ReadonlyArray<LoopPacket>
  questions(): ReadonlyArray<QuestionRecord>
}
