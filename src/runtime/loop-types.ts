import type { Spend } from './supervise/types'
import type { DefaultVerdict } from './types'

export type LoopStatus = 'completed' | 'blocked' | 'failed'
export type LoopQuestionPolicy = 'auto' | 'mustDecide' | 'bubble' | 'failClosed'
export type LoopArtifactStatus = 'running' | 'done' | 'down' | 'blocked'
export type LoopMessageKind = 'steer' | 'answer' | 'interrupt' | 'note'
export type LoopMessageDeliveryStatus = 'delivered' | 'queued' | 'rejected'
export type LoopMessageDeliveryMode = 'immediate' | 'queue'

export interface LoopFinding {
  readonly id: string
  readonly source: string
  readonly claim: string
  readonly severity?: 'critical' | 'high' | 'medium' | 'low' | 'info'
  readonly evidence?: ReadonlyArray<{ readonly uri: string; readonly excerpt?: string }>
  readonly confidence?: number
  readonly recommendedAction?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type LoopFindingInput = Omit<LoopFinding, 'id' | 'source'> &
  Partial<Pick<LoopFinding, 'id' | 'source'>>

export type LoopQuestionUrgency = 'continue-without' | 'blocks-step' | 'blocks-run'
export type LoopQuestionLevel = 'worker' | 'driver' | 'loop'

export interface LoopQuestionDecision {
  readonly kind: 'answer' | 'defer' | 'escalate'
  readonly value: string
  readonly by?: string
  readonly answer?: string
  readonly reason?: string
  readonly to?: 'parent' | 'user' | string
}

export interface LoopQuestion {
  readonly id: string
  readonly from: string
  readonly level: LoopQuestionLevel
  readonly question: string
  readonly reason: string
  readonly urgency: LoopQuestionUrgency
  readonly options?: ReadonlyArray<{ readonly label: string; readonly tradeoff: string }>
  readonly status: 'open' | 'answered' | 'deferred' | 'escalated'
  readonly decision?: LoopQuestionDecision
  readonly openedAt: number
}

export type LoopQuestionInput = Omit<LoopQuestion, 'id' | 'status' | 'openedAt'> & {
  readonly id?: string
}

export interface LoopMessageDelivery {
  readonly status: LoopMessageDeliveryStatus
  readonly reason?: string
}

export interface LoopMessageInput {
  readonly from?: string
  readonly to: string
  readonly kind?: LoopMessageKind
  readonly body: string
  readonly reason?: string
  readonly mode?: LoopMessageDeliveryMode
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface LoopMessageRecord extends Required<Pick<LoopMessageInput, 'from' | 'kind'>> {
  readonly id: string
  readonly to: string
  readonly body: string
  readonly reason?: string
  readonly mode: LoopMessageDeliveryMode
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly delivery: LoopMessageDelivery
  readonly sentAt: number
}

export interface LoopArtifact {
  readonly id: string
  readonly source: string
  readonly label?: string
  readonly kind?: string
  readonly status: LoopArtifactStatus
  readonly output?: unknown
  readonly trace?: unknown
  readonly verdict?: DefaultVerdict
  readonly spent?: Spend
  readonly blockers: ReadonlyArray<string>
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly startedAt: number
  readonly endedAt?: number
  readonly durationMs?: number
}

export type LoopArtifactInput = Omit<
  LoopArtifact,
  'id' | 'source' | 'status' | 'blockers' | 'startedAt'
> &
  Partial<Pick<LoopArtifact, 'id' | 'source' | 'status' | 'blockers' | 'startedAt'>>

export interface LoopEvent {
  readonly id: string
  readonly runId: string
  readonly kind: string
  readonly timestamp: number
  readonly source?: string
  readonly target?: string
  readonly artifactId?: string
  readonly durationMs?: number
  readonly payload?: unknown
}

export interface LoopTraceSlice {
  readonly runId: string
  readonly artifacts: ReadonlyArray<LoopArtifact>
  readonly events: ReadonlyArray<LoopEvent>
}

export interface LoopTraceSelector {
  readonly artifactId?: string
  readonly source?: string
  readonly target?: string
  readonly pair?: readonly [string, string]
  readonly kinds?: ReadonlyArray<string>
  readonly includeRelated?: boolean
  readonly predicate?: (event: LoopEvent) => boolean
}

export interface LoopAnalysisInput {
  readonly runId: string
  readonly timing: 'record' | 'final'
  readonly artifact?: LoopArtifact
  readonly trace: LoopTraceSlice
  readonly artifacts: ReadonlyArray<LoopArtifact>
  readonly questions: ReadonlyArray<LoopQuestion>
  readonly messages: ReadonlyArray<LoopMessageRecord>
  readonly events: ReadonlyArray<LoopEvent>
}

export interface LoopAnalysis {
  readonly findings?: ReadonlyArray<LoopFindingInput>
  readonly questions?: ReadonlyArray<LoopQuestionInput>
  readonly messages?: ReadonlyArray<LoopMessageInput>
  readonly blockers?: ReadonlyArray<string>
}

export interface LoopAnalyst {
  readonly id: string
  readonly description?: string
  readonly timing?: 'record' | 'final'
  readonly select?: LoopTraceSelector | ((input: LoopAnalysisInput) => LoopTraceSelector)
  analyze(input: LoopAnalysisInput): LoopAnalysis | undefined | Promise<LoopAnalysis | undefined>
}

export interface LoopEvaluatorInput<Output> {
  readonly runId: string
  readonly output: Output
  readonly trace: LoopTraceSlice
  readonly artifacts: ReadonlyArray<LoopArtifact>
  readonly questions: ReadonlyArray<LoopQuestion>
  readonly messages: ReadonlyArray<LoopMessageRecord>
  readonly events: ReadonlyArray<LoopEvent>
}

export type LoopVerifier<Output> = (
  input: LoopEvaluatorInput<Output>,
) => DefaultVerdict | Promise<DefaultVerdict>

export type LoopJudge<Output> = (
  input: LoopEvaluatorInput<Output>,
) => DefaultVerdict | Promise<DefaultVerdict>

export interface LoopControlSnapshot {
  readonly runId: string
  readonly name: string
  readonly trace: LoopTraceSlice
  readonly events: ReadonlyArray<LoopEvent>
  readonly artifacts: ReadonlyArray<LoopArtifact>
  readonly questions: ReadonlyArray<LoopQuestion>
  readonly messages: ReadonlyArray<LoopMessageRecord>
  readonly findings: ReadonlyArray<LoopFinding>
}

export interface LoopControlPlane {
  readonly runId: string
  send(input: LoopMessageInput): Promise<LoopMessageRecord>
  answerQuestion(questionId: string, decision: LoopQuestionDecision): Promise<LoopQuestion>
  trace(selector?: LoopTraceSelector): LoopTraceSlice
  artifacts(): ReadonlyArray<LoopArtifact>
  questions(): ReadonlyArray<LoopQuestion>
  messages(): ReadonlyArray<LoopMessageRecord>
  events(): ReadonlyArray<LoopEvent>
  snapshot(): LoopControlSnapshot
}

export interface LoopRunContext extends LoopControlPlane {
  readonly loopName: string
  readonly signal: AbortSignal
  readonly control: LoopControlPlane
  now(): number
  event(input: Omit<LoopEvent, 'id' | 'runId' | 'timestamp'>): Promise<LoopEvent>
  record(input: LoopArtifactInput): Promise<LoopArtifact>
  question(input: LoopQuestionInput): Promise<LoopQuestion>
}

export interface DefineLoopOptions<Task, Output> {
  readonly name: string
  run(task: Task, ctx: LoopRunContext): Output | Promise<Output>
  readonly analysts?: ReadonlyArray<LoopAnalyst>
  readonly verifier?: LoopVerifier<Output>
  readonly judge?: LoopJudge<Output>
  readonly questionPolicy?: LoopQuestionPolicy
}

export interface LoopMessageRouterInput extends Omit<LoopMessageRecord, 'delivery'> {
  readonly signal: AbortSignal
}

export type LoopMessageRouter = (
  message: LoopMessageRouterInput,
) => LoopMessageDelivery | Promise<LoopMessageDelivery>

export interface LoopRunOptions {
  readonly runId?: string
  readonly signal?: AbortSignal
  readonly now?: () => number
  readonly onEvent?: (event: LoopEvent) => void | Promise<void>
  readonly messageRouter?: LoopMessageRouter
}

export interface LoopRunResult<Output> {
  readonly runId: string
  readonly name: string
  readonly status: LoopStatus
  readonly ok: boolean
  readonly output?: Output
  readonly error?: string
  readonly verifier?: DefaultVerdict
  readonly judge?: DefaultVerdict
  readonly artifacts: ReadonlyArray<LoopArtifact>
  readonly trace: LoopTraceSlice
  readonly events: ReadonlyArray<LoopEvent>
  readonly findings: ReadonlyArray<LoopFinding>
  readonly questions: ReadonlyArray<LoopQuestion>
  readonly messages: ReadonlyArray<LoopMessageRecord>
  readonly blockers: ReadonlyArray<string>
  readonly startedAt: number
  readonly endedAt: number
  readonly durationMs: number
}

export interface LoopRunHandle<Output> {
  readonly runId: string
  readonly result: Promise<LoopRunResult<Output>>
  readonly control: LoopControlPlane
}

export interface DefinedLoop<Task, Output> {
  readonly name: string
  start(task: Task, options?: LoopRunOptions): LoopRunHandle<Output>
  run(task: Task, options?: LoopRunOptions): Promise<LoopRunResult<Output>>
}
