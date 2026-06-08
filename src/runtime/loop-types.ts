export type LoopStatus = 'completed' | 'blocked' | 'failed'
export type LoopQuestionPolicy = 'auto' | 'mustDecide' | 'bubble' | 'failClosed'
export type LoopPacketStatus = 'running' | 'done' | 'down' | 'blocked'
export type LoopMessageKind = 'steer' | 'answer' | 'interrupt' | 'note'
export type LoopMessageDeliveryStatus = 'delivered' | 'queued' | 'rejected'
export type LoopMessageDeliveryMode = 'immediate' | 'queue'
export type LoopTraceEdgeKind =
  | 'spawn'
  | 'message'
  | 'steer'
  | 'conversation'
  | 'analysis'
  | 'verification'
  | 'judgement'

export interface LoopSpend {
  readonly iterations?: number
  readonly tokens?: { readonly input: number; readonly output: number }
  readonly usd?: number
  readonly ms?: number
}

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

export interface LoopVerdict {
  readonly valid: boolean
  readonly score?: number
  readonly reason?: string
  readonly notes?: string
  readonly findings?: ReadonlyArray<LoopFinding>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface LoopPacket {
  readonly id: string
  readonly nodeId: string
  readonly parentId?: string
  readonly label: string
  readonly kind?: string
  readonly status: LoopPacketStatus
  readonly startedAt: number
  readonly endedAt?: number
  readonly durationMs?: number
  readonly spent?: LoopSpend
  readonly outRef?: string
  readonly output?: unknown
  readonly trace?: unknown
  readonly verdict?: LoopVerdict
  readonly reason?: string
  readonly findings: ReadonlyArray<LoopFinding>
  readonly questions: ReadonlyArray<LoopQuestion>
  readonly messages: ReadonlyArray<LoopMessageRecord>
  readonly blockers: ReadonlyArray<string>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type LoopPacketInput = Omit<
  LoopPacket,
  'id' | 'nodeId' | 'startedAt' | 'findings' | 'questions' | 'messages' | 'blockers'
> &
  Partial<
    Pick<
      LoopPacket,
      'id' | 'nodeId' | 'startedAt' | 'findings' | 'questions' | 'messages' | 'blockers'
    >
  >

export interface LoopTraceNode {
  readonly id: string
  readonly label: string
  readonly kind?: string
  readonly parentId?: string
  readonly startedAt?: number
  readonly endedAt?: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface LoopTraceEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly kind: LoopTraceEdgeKind
  readonly eventId?: string
  readonly timestamp: number
  readonly status?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface LoopGraphEvent {
  readonly id: string
  readonly runId: string
  readonly type: string
  readonly timestamp: number
  readonly source?: string
  readonly target?: string
  readonly packetId?: string
  readonly durationMs?: number
  readonly data?: unknown
}

export interface LoopTraceGraph {
  readonly runId: string
  readonly startedAt: number
  readonly endedAt?: number
  readonly nodes: ReadonlyArray<LoopTraceNode>
  readonly edges: ReadonlyArray<LoopTraceEdge>
  readonly events: ReadonlyArray<LoopGraphEvent>
}

export interface LoopTraceSelector {
  readonly nodeId?: string
  readonly packetId?: string
  readonly source?: string
  readonly target?: string
  readonly pair?: readonly [string, string]
  readonly types?: ReadonlyArray<string>
  readonly includeRelated?: boolean
  readonly predicate?: (event: LoopGraphEvent) => boolean
}

export interface LoopAnalysisInput {
  readonly runId: string
  readonly timing: 'packet' | 'final'
  readonly packet?: LoopPacket
  readonly trace: LoopTraceGraph
  readonly packets: ReadonlyArray<LoopPacket>
  readonly questions: ReadonlyArray<LoopQuestion>
  readonly messages: ReadonlyArray<LoopMessageRecord>
  readonly events: ReadonlyArray<LoopGraphEvent>
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
  readonly timing?: 'packet' | 'final'
  readonly select?: LoopTraceSelector | ((input: LoopAnalysisInput) => LoopTraceSelector)
  analyze(input: LoopAnalysisInput): LoopAnalysis | undefined | Promise<LoopAnalysis | undefined>
}

export interface LoopEvaluatorInput<Output> {
  readonly runId: string
  readonly output: Output
  readonly trace: LoopTraceGraph
  readonly packets: ReadonlyArray<LoopPacket>
  readonly questions: ReadonlyArray<LoopQuestion>
  readonly messages: ReadonlyArray<LoopMessageRecord>
  readonly events: ReadonlyArray<LoopGraphEvent>
}

export type LoopVerifier<Output> = (
  input: LoopEvaluatorInput<Output>,
) => LoopVerdict | Promise<LoopVerdict>

export type LoopJudge<Output> = (
  input: LoopEvaluatorInput<Output>,
) => LoopVerdict | Promise<LoopVerdict>

export interface LoopControlSnapshot {
  readonly runId: string
  readonly name: string
  readonly trace: LoopTraceGraph
  readonly events: ReadonlyArray<LoopGraphEvent>
  readonly packets: ReadonlyArray<LoopPacket>
  readonly questions: ReadonlyArray<LoopQuestion>
  readonly messages: ReadonlyArray<LoopMessageRecord>
  readonly findings: ReadonlyArray<LoopFinding>
}

export interface LoopControlPlane {
  readonly runId: string
  send(input: LoopMessageInput): Promise<LoopMessageRecord>
  answerQuestion(questionId: string, decision: LoopQuestionDecision): Promise<LoopQuestion>
  trace(selector?: LoopTraceSelector): LoopTraceGraph
  packets(): ReadonlyArray<LoopPacket>
  questions(): ReadonlyArray<LoopQuestion>
  messages(): ReadonlyArray<LoopMessageRecord>
  events(): ReadonlyArray<LoopGraphEvent>
  snapshot(): LoopControlSnapshot
}

export interface LoopRunContext extends LoopControlPlane {
  readonly loopName: string
  readonly signal: AbortSignal
  readonly control: LoopControlPlane
  now(): number
  event(input: Omit<LoopGraphEvent, 'id' | 'runId' | 'timestamp'>): Promise<LoopGraphEvent>
  packet(input: LoopPacketInput): Promise<LoopPacket>
  question(input: LoopQuestionInput): Promise<LoopQuestion>
}

export interface DefineLoopOptions<Task, Output> {
  readonly name: string
  run(task: Task, ctx: LoopRunContext): Output | Promise<Output>
  readonly analysts?: ReadonlyArray<LoopAnalyst>
  /** In-loop gate. This determines whether the output is shippable. */
  readonly verifier?: LoopVerifier<Output>
  /** Held-out scorer. Recorded after the loop; never fed back into loop strategy. */
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
  readonly onEvent?: (event: LoopGraphEvent) => void | Promise<void>
  readonly messageRouter?: LoopMessageRouter
}

export interface LoopRunResult<Output> {
  readonly runId: string
  readonly name: string
  readonly status: LoopStatus
  readonly ok: boolean
  readonly output?: Output
  readonly error?: string
  readonly verifier?: LoopVerdict
  readonly judge?: LoopVerdict
  readonly packets: ReadonlyArray<LoopPacket>
  readonly questions: ReadonlyArray<LoopQuestion>
  readonly messages: ReadonlyArray<LoopMessageRecord>
  readonly findings: ReadonlyArray<LoopFinding>
  readonly blockers: ReadonlyArray<string>
  readonly trace: LoopTraceGraph
  readonly events: ReadonlyArray<LoopGraphEvent>
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
