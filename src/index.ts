import {
  acquisitionPlansForKnowledgeGaps,
  blockingKnowledgeEval,
  runAgentControlLoop,
  scoreKnowledgeReadiness,
  userQuestionsForKnowledgeGaps,
  type ControlBudget,
  type ControlContext,
  type ControlDecision,
  type ControlEvalResult,
  type ControlRunResult,
  type ControlStep,
  type DataAcquisitionPlan,
  type KnowledgeReadinessReport,
  type KnowledgeRequirement,
  type RunRecord,
  type TraceStore,
  type UserQuestion,
} from '@tangle-network/agent-eval'

export interface AgentTaskSpec {
  id: string
  intent: string
  /** Domain is metadata, not an architectural boundary: tax, legal, gtm, creative, blueprint, redteam, etc. */
  domain?: string
  inputs?: Record<string, unknown>
  requiredKnowledge?: KnowledgeRequirement[]
  budget?: Partial<ControlBudget>
  metadata?: Record<string, unknown>
}

export interface AgentKnowledgeProvider {
  buildReadiness?(task: AgentTaskSpec): Promise<KnowledgeReadinessReport> | KnowledgeReadinessReport
  answerQuestions?(questions: UserQuestion[], task: AgentTaskSpec): Promise<Record<string, string>> | Record<string, string>
  executeAcquisitionPlans?(plans: DataAcquisitionPlan[], task: AgentTaskSpec): Promise<string[]> | string[]
  refreshReadiness?(input: {
    task: AgentTaskSpec
    previous: KnowledgeReadinessReport
    userAnswers: Record<string, string>
    acquiredEvidenceIds: string[]
  }): Promise<KnowledgeReadinessReport> | KnowledgeReadinessReport
}

export interface AgentTaskContext<TState, TAction, TActionResult, TEval extends ControlEvalResult = ControlEvalResult> {
  task: AgentTaskSpec
  knowledge: KnowledgeReadinessReport
  state: TState
  evals: TEval[]
  history: ControlStep<TState, TAction, TActionResult, TEval>[]
  budget: ControlBudget
  stepIndex: number
  wallMs: number
  spentCostUsd: number
  remainingCostUsd?: number
  abortSignal: AbortSignal
}

export interface AgentAdapter<TState, TAction, TActionResult, TEval extends ControlEvalResult = ControlEvalResult> {
  observe(ctx: {
    task: AgentTaskSpec
    knowledge: KnowledgeReadinessReport
    history: ControlStep<TState, TAction, TActionResult, TEval>[]
    abortSignal: AbortSignal
  }): Promise<TState> | TState

  validate(ctx: {
    task: AgentTaskSpec
    knowledge: KnowledgeReadinessReport
    state: TState
    history: ControlStep<TState, TAction, TActionResult, TEval>[]
    abortSignal: AbortSignal
  }): Promise<TEval[]> | TEval[]

  decide(ctx: AgentTaskContext<TState, TAction, TActionResult, TEval>): Promise<ControlDecision<TAction>> | ControlDecision<TAction>

  act(action: TAction, ctx: AgentTaskContext<TState, TAction, TActionResult, TEval>): Promise<TActionResult> | TActionResult

  shouldStop?(ctx: AgentTaskContext<TState, TAction, TActionResult, TEval>): Promise<{
    stop: boolean
    pass: boolean
    reason: string
    score?: number
  }> | {
    stop: boolean
    pass: boolean
    reason: string
    score?: number
  }

  onKnowledgeBlocked?(ctx: {
    task: AgentTaskSpec
    knowledge: KnowledgeReadinessReport
    questions: UserQuestion[]
    acquisitionPlans: DataAcquisitionPlan[]
  }): Promise<ControlDecision<TAction>> | ControlDecision<TAction>

  getActionCostUsd?(ctx: {
    action: TAction
    result: TActionResult
    task: AgentTaskSpec
    state: TState
    evals: TEval[]
    history: ControlStep<TState, TAction, TActionResult, TEval>[]
  }): number | undefined

  projectRunRecords?(result: ControlRunResult<TState, TAction, TActionResult, TEval>, task: AgentTaskSpec): RunRecord[]
}

export type AgentTaskStatus =
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'aborted'

export type AgentRuntimeEvent<TState = unknown, TAction = unknown, TActionResult = unknown, TEval extends ControlEvalResult = ControlEvalResult> =
  | { type: 'task_start'; task: AgentTaskSpec }
  | { type: 'readiness_start'; task: AgentTaskSpec }
  | { type: 'readiness_end'; task: AgentTaskSpec; knowledge: KnowledgeReadinessReport }
  | { type: 'questions_start'; task: AgentTaskSpec; questions: UserQuestion[] }
  | { type: 'questions_end'; task: AgentTaskSpec; questions: UserQuestion[]; userAnswers: Record<string, string> }
  | { type: 'acquisition_start'; task: AgentTaskSpec; acquisitionPlans: DataAcquisitionPlan[] }
  | { type: 'acquisition_end'; task: AgentTaskSpec; acquisitionPlans: DataAcquisitionPlan[]; acquiredEvidenceIds: string[] }
  | { type: 'control_start'; task: AgentTaskSpec; knowledge: KnowledgeReadinessReport }
  | { type: 'control_step'; task: AgentTaskSpec; step: ControlStep<TState, TAction, TActionResult, TEval> }
  | { type: 'control_end'; task: AgentTaskSpec; control: ControlRunResult<TState, TAction, TActionResult, TEval> }
  | { type: 'task_end'; task: AgentTaskSpec; status: AgentTaskStatus; reason: string }

export type AgentRuntimeEventSink<TState = unknown, TAction = unknown, TActionResult = unknown, TEval extends ControlEvalResult = ControlEvalResult> = (
  event: AgentRuntimeEvent<TState, TAction, TActionResult, TEval>,
) => Promise<void> | void

export type RuntimeStreamEvent =
  | { type: 'task_start'; task: AgentTaskSpec; timestamp: string }
  | { type: 'readiness_start'; task: AgentTaskSpec; timestamp: string }
  | { type: 'readiness_end'; task: AgentTaskSpec; knowledge: KnowledgeReadinessReport; decision: KnowledgeReadinessDecision; timestamp: string }
  | { type: 'questions_start'; task: AgentTaskSpec; questions: UserQuestion[]; timestamp: string }
  | { type: 'questions_end'; task: AgentTaskSpec; questions: UserQuestion[]; userAnswers: Record<string, string>; timestamp: string }
  | { type: 'acquisition_start'; task: AgentTaskSpec; acquisitionPlans: DataAcquisitionPlan[]; timestamp: string }
  | { type: 'acquisition_end'; task: AgentTaskSpec; acquisitionPlans: DataAcquisitionPlan[]; acquiredEvidenceIds: string[]; timestamp: string }
  | { type: 'session_created'; task: AgentTaskSpec; session: RuntimeSession; timestamp: string }
  | { type: 'session_resumed'; task: AgentTaskSpec; session: RuntimeSession; timestamp: string }
  | { type: 'backend_start'; task: AgentTaskSpec; session: RuntimeSession; backend: string; timestamp: string }
  | { type: 'text_delta'; task?: AgentTaskSpec; session?: RuntimeSession; text: string; timestamp?: string }
  | { type: 'reasoning_delta'; task?: AgentTaskSpec; session?: RuntimeSession; text: string; timestamp?: string }
  | { type: 'tool_call'; task?: AgentTaskSpec; session?: RuntimeSession; toolName: string; toolCallId?: string; args?: unknown; timestamp?: string }
  | { type: 'tool_result'; task?: AgentTaskSpec; session?: RuntimeSession; toolName: string; toolCallId?: string; result?: unknown; timestamp?: string }
  | { type: 'artifact'; task?: AgentTaskSpec; session?: RuntimeSession; artifactId: string; name?: string; mimeType?: string; uri?: string; metadata?: Record<string, unknown>; timestamp?: string }
  | { type: 'backend_error'; task: AgentTaskSpec; session?: RuntimeSession; backend: string; message: string; recoverable: boolean; timestamp: string }
  | { type: 'backend_end'; task: AgentTaskSpec; session: RuntimeSession; backend: string; timestamp: string }
  | { type: 'task_end'; task: AgentTaskSpec; status: AgentTaskStatus; reason: string; timestamp: string }
  | { type: 'final'; task: AgentTaskSpec; session?: RuntimeSession; status: AgentTaskStatus; reason: string; text?: string; metadata?: Record<string, unknown>; timestamp: string }

export interface RuntimeSession {
  id: string
  backend: string
  status: 'active' | 'completed' | 'failed' | 'aborted'
  resumeToken?: string
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
}

export interface RuntimeSessionStore {
  get(sessionId: string): Promise<RuntimeSession | undefined> | RuntimeSession | undefined
  put(session: RuntimeSession): Promise<void> | void
  appendEvent?(sessionId: string, event: RuntimeStreamEvent): Promise<void> | void
  listEvents?(sessionId: string): Promise<RuntimeStreamEvent[]> | RuntimeStreamEvent[]
}

export interface AgentBackendInput {
  task: AgentTaskSpec
  message?: string
  messages?: Array<{ role: string; content: string }>
  inputs?: Record<string, unknown>
}

export interface AgentBackendContext {
  task: AgentTaskSpec
  knowledge: KnowledgeReadinessReport
  session: RuntimeSession
  signal?: AbortSignal
}

export interface AgentExecutionBackend<TInput extends AgentBackendInput = AgentBackendInput> {
  kind: string
  start?(input: TInput, context: Omit<AgentBackendContext, 'session'> & { requestedSessionId?: string }): Promise<RuntimeSession> | RuntimeSession
  resume?(session: RuntimeSession, input: TInput, context: Omit<AgentBackendContext, 'session'>): Promise<RuntimeSession> | RuntimeSession
  stream(input: TInput, context: AgentBackendContext): AsyncIterable<RuntimeStreamEvent>
  stop?(session: RuntimeSession, reason: string): Promise<void> | void
}

export interface RunAgentTaskStreamOptions<TInput extends AgentBackendInput = AgentBackendInput> {
  task: AgentTaskSpec
  backend: AgentExecutionBackend<TInput>
  input?: Omit<TInput, 'task'>
  knowledge?: AgentKnowledgeProvider
  sessionStore?: RuntimeSessionStore
  sessionId?: string
  resume?: boolean
  signal?: AbortSignal
  minimumReadinessScore?: number
}

export interface RunAgentTaskOptions<TState, TAction, TActionResult, TEval extends ControlEvalResult = ControlEvalResult> {
  task: AgentTaskSpec
  adapter: AgentAdapter<TState, TAction, TActionResult, TEval>
  knowledge?: AgentKnowledgeProvider
  onEvent?: AgentRuntimeEventSink<TState, TAction, TActionResult, TEval>
  store?: TraceStore
  signal?: AbortSignal
  scenarioId?: string
  projectId?: string
  variantId?: string
  minimumReadinessScore?: number
}

export interface AgentTaskRunResult<TState, TAction, TActionResult, TEval extends ControlEvalResult = ControlEvalResult> {
  task: AgentTaskSpec
  status: AgentTaskStatus
  knowledge: KnowledgeReadinessReport
  questions: UserQuestion[]
  acquisitionPlans: DataAcquisitionPlan[]
  userAnswers: Record<string, string>
  acquiredEvidenceIds: string[]
  control: ControlRunResult<TState, TAction, TActionResult, TEval>
  runRecords: RunRecord[]
}

export interface RuntimeTelemetryOptions {
  /**
   * Include raw task inputs. Off by default because task inputs often
   * contain customer facts, credentials, source text, or internal IDs.
   */
  includeInputs?: boolean
  /** Include requirement descriptions. Secret requirements are always redacted. */
  includeRequirementDescriptions?: boolean
  /** Include evidence IDs. Off by default; counts are safer for shared reports. */
  includeEvidenceIds?: boolean
  /** Include user answers from question preflight. Off by default. */
  includeUserAnswers?: boolean
  /** Include action payloads and action results for control steps. Off by default. */
  includeControlPayloads?: boolean
  /** Include task metadata. Off by default because metadata may carry IDs or policy internals. */
  includeMetadata?: boolean
  /** Include eval detail/evidence strings. Off by default because validators may echo private input. */
  includeEvalDetails?: boolean
}

export interface SanitizedKnowledgeRequirement {
  id: string
  description?: string
  requiredFor: string[]
  category: KnowledgeRequirement['category']
  acquisitionMode: KnowledgeRequirement['acquisitionMode']
  importance: KnowledgeRequirement['importance']
  freshness: KnowledgeRequirement['freshness']
  sensitivity: KnowledgeRequirement['sensitivity']
  confidenceNeeded: number
  currentConfidence: number
  evidenceCount: number
  evidenceIds?: string[]
  fallbackPolicy: KnowledgeRequirement['fallbackPolicy']
}

export interface SanitizedKnowledgeReadinessReport {
  taskId: string
  readinessScore: number
  recommendedAction: KnowledgeReadinessReport['recommendedAction']
  severity: KnowledgeReadinessReport['severity']
  reason: string
  blockingMissingRequirements: SanitizedKnowledgeRequirement[]
  nonBlockingGaps: SanitizedKnowledgeRequirement[]
  evidenceCount: number
  evidenceIds?: string[]
  missingRequirementIds: string[]
}

export interface AgentTaskRunSummary {
  taskId: string
  domain?: string
  status: AgentTaskStatus
  reason: string
  readinessStatus: KnowledgeReadinessDecision['status']
  readinessScore: number
  recommendedAction: KnowledgeReadinessReport['recommendedAction']
  blockingGapIds: string[]
  nonBlockingGapIds: string[]
  questionCount: number
  acquisitionPlanCount: number
  acquiredEvidenceCount: number
  controlStepCount: number
  pass: boolean
  failureClass?: string
  wallMs: number
  costUsd: number
}

export interface KnowledgeReadinessDecision {
  passed: boolean
  status: 'ready' | 'blocked' | 'caveat'
  reason: string
  readinessScore: number
  recommendedAction: KnowledgeReadinessReport['recommendedAction']
  severity: KnowledgeReadinessReport['severity']
  blockingGapIds: string[]
  nonBlockingGapIds: string[]
}

export interface RuntimeEventCollector<TState = unknown, TAction = unknown, TActionResult = unknown, TEval extends ControlEvalResult = ControlEvalResult> {
  onEvent: AgentRuntimeEventSink<TState, TAction, TActionResult, TEval>
  events: Array<Record<string, unknown>>
}

export interface ServerSentEventOptions {
  event?: string
  id?: string
  retry?: number
}

export class InMemoryRuntimeSessionStore implements RuntimeSessionStore {
  private readonly sessions = new Map<string, RuntimeSession>()
  private readonly events = new Map<string, RuntimeStreamEvent[]>()

  get(sessionId: string): RuntimeSession | undefined {
    return this.sessions.get(sessionId)
  }

  put(session: RuntimeSession): void {
    this.sessions.set(session.id, session)
  }

  appendEvent(sessionId: string, event: RuntimeStreamEvent): void {
    const existing = this.events.get(sessionId) ?? []
    existing.push(event)
    this.events.set(sessionId, existing)
  }

  listEvents(sessionId: string): RuntimeStreamEvent[] {
    return [...(this.events.get(sessionId) ?? [])]
  }
}

export async function runAgentTask<TState, TAction, TActionResult, TEval extends ControlEvalResult = ControlEvalResult>(
  options: RunAgentTaskOptions<TState, TAction, TActionResult, TEval>,
): Promise<AgentTaskRunResult<TState, TAction, TActionResult, TEval>> {
  const task = options.task
  await emit(options.onEvent, { type: 'task_start', task })
  await emit(options.onEvent, { type: 'readiness_start', task })
  let knowledge = await buildReadiness(task, options.knowledge)
  await emit(options.onEvent, { type: 'readiness_end', task, knowledge })
  const questions = userQuestionsForKnowledgeGaps(knowledge.blockingMissingRequirements)
  const acquisitionPlans = acquisitionPlansForKnowledgeGaps([
    ...knowledge.blockingMissingRequirements,
    ...knowledge.nonBlockingGaps,
  ])
  const preflight = await runKnowledgePreflight(task, questions, acquisitionPlans, options.knowledge, options.onEvent)
  if (options.knowledge?.refreshReadiness && (Object.keys(preflight.userAnswers).length > 0 || preflight.acquiredEvidenceIds.length > 0)) {
    await emit(options.onEvent, { type: 'readiness_start', task })
    knowledge = await options.knowledge.refreshReadiness({
      task,
      previous: knowledge,
      userAnswers: preflight.userAnswers,
      acquiredEvidenceIds: preflight.acquiredEvidenceIds,
    })
    await emit(options.onEvent, { type: 'readiness_end', task, knowledge })
  }

  await emit(options.onEvent, { type: 'control_start', task, knowledge })
  const control = await runAgentControlLoop<TState, TAction, TActionResult, TEval>({
    intent: task.intent,
    budget: task.budget,
    signal: options.signal,
    store: options.store,
    scenarioId: options.scenarioId ?? task.id,
    projectId: options.projectId,
    variantId: options.variantId,
    observe: ({ history, abortSignal }) => options.adapter.observe({ task, knowledge, history, abortSignal }),
    validate: async ({ state, history, abortSignal }) => {
      const readinessEval = blockingKnowledgeEval(knowledge, { minimumScore: options.minimumReadinessScore })
      const evals = await options.adapter.validate({ task, knowledge, state, history, abortSignal })
      return [readinessEval as TEval, ...evals]
    },
    decide: (ctx) => {
      if (isKnowledgeBlocked(ctx.evals)) {
        return options.adapter.onKnowledgeBlocked?.({ task, knowledge, questions, acquisitionPlans }) ?? {
          type: 'stop',
          pass: false,
          score: knowledge.readinessScore,
          reason: `knowledge readiness blocked: ${knowledge.reason}`,
        }
      }
      return options.adapter.decide(toAgentContext(task, knowledge, ctx))
    },
    act: (action, ctx) => options.adapter.act(action, toAgentContext(task, knowledge, ctx)),
    shouldStop: options.adapter.shouldStop
      ? (ctx) => options.adapter.shouldStop!(toAgentContext(task, knowledge, ctx))
      : undefined,
    getActionCostUsd: options.adapter.getActionCostUsd
      ? ({ action, result, state, evals, history }) => options.adapter.getActionCostUsd!({ action, result, task, state, evals, history })
      : undefined,
    onStep: (step) => emit(options.onEvent, { type: 'control_step', task, step }),
  })
  await emit(options.onEvent, { type: 'control_end', task, control })
  const status = statusFromControl(control)
  await emit(options.onEvent, { type: 'task_end', task, status, reason: control.reason })

  return {
    task,
    status,
    knowledge,
    questions,
    acquisitionPlans,
    userAnswers: preflight.userAnswers,
    acquiredEvidenceIds: preflight.acquiredEvidenceIds,
    control,
    runRecords: options.adapter.projectRunRecords?.(control, task) ?? [],
  }
}

export function summarizeAgentTaskRun<TState, TAction, TActionResult, TEval extends ControlEvalResult>(
  result: AgentTaskRunResult<TState, TAction, TActionResult, TEval>,
): AgentTaskRunSummary {
  return {
    taskId: result.task.id,
    domain: result.task.domain,
    status: result.status,
    reason: result.control.reason,
    readinessStatus: decideKnowledgeReadiness(result.knowledge).status,
    readinessScore: result.knowledge.readinessScore,
    recommendedAction: result.knowledge.recommendedAction,
    blockingGapIds: result.knowledge.blockingMissingRequirements.map((requirement) => requirement.id),
    nonBlockingGapIds: result.knowledge.nonBlockingGaps.map((requirement) => requirement.id),
    questionCount: result.questions.length,
    acquisitionPlanCount: result.acquisitionPlans.length,
    acquiredEvidenceCount: result.acquiredEvidenceIds.length,
    controlStepCount: result.control.steps.length,
    pass: result.control.pass,
    failureClass: result.control.failureClass,
    wallMs: result.control.wallMs,
    costUsd: result.control.spentCostUsd,
  }
}

export async function* runAgentTaskStream<TInput extends AgentBackendInput = AgentBackendInput>(
  options: RunAgentTaskStreamOptions<TInput>,
): AsyncIterable<RuntimeStreamEvent> {
  const task = options.task
  const input = { task, ...(options.input ?? {}) } as TInput
  const started = streamEvent({ type: 'task_start', task })
  yield started

  const readinessStart = streamEvent({ type: 'readiness_start', task })
  yield readinessStart
  let knowledge = await buildReadiness(task, options.knowledge)
  const questions = userQuestionsForKnowledgeGaps(knowledge.blockingMissingRequirements)
  const acquisitionPlans = acquisitionPlansForKnowledgeGaps([
    ...knowledge.blockingMissingRequirements,
    ...knowledge.nonBlockingGaps,
  ])
  const preflight = await runKnowledgePreflightStream(task, questions, acquisitionPlans, options.knowledge)
  for (const event of preflight.events) yield event
  if (options.knowledge?.refreshReadiness && (Object.keys(preflight.userAnswers).length > 0 || preflight.acquiredEvidenceIds.length > 0)) {
    yield streamEvent({ type: 'readiness_start', task })
    knowledge = await options.knowledge.refreshReadiness({
      task,
      previous: knowledge,
      userAnswers: preflight.userAnswers,
      acquiredEvidenceIds: preflight.acquiredEvidenceIds,
    })
  }
  const decision = decideKnowledgeReadiness(knowledge, { minimumScore: options.minimumReadinessScore })
  yield streamEvent({ type: 'readiness_end', task, knowledge, decision })
  if (!decision.passed && decision.status === 'blocked') {
    const reason = `knowledge readiness blocked: ${decision.reason}`
    yield streamEvent({ type: 'task_end', task, status: 'blocked', reason })
    yield streamEvent({ type: 'final', task, status: 'blocked', reason })
    return
  }

  const store = options.sessionStore
  const existing = options.sessionId ? await store?.get(options.sessionId) : undefined
  const shouldResume = Boolean(options.resume && existing)
  let session = shouldResume && existing
    ? await resumeBackendSession(options.backend, existing, input, { task, knowledge, signal: options.signal })
    : await startBackendSession(options.backend, input, { task, knowledge, signal: options.signal }, options.sessionId)
  await store?.put(session)
  const sessionEvent = streamEvent({
    type: shouldResume ? 'session_resumed' : 'session_created',
    task,
    session,
  })
  await store?.appendEvent?.(session.id, sessionEvent)
  yield sessionEvent

  const backendStart = streamEvent({ type: 'backend_start', task, session, backend: options.backend.kind })
  await store?.appendEvent?.(session.id, backendStart)
  yield backendStart

  let finalText = ''
  try {
    for await (const rawEvent of options.backend.stream(input, { task, knowledge, session, signal: options.signal })) {
      const event = normalizeBackendStreamEvent(rawEvent, task, session)
      if (event.type === 'text_delta') finalText += event.text
      await store?.appendEvent?.(session.id, event)
      yield event
    }
    const completedStatus: AgentTaskStatus = 'completed'
    session = touchSession({ ...session, status: completedStatus })
    await store?.put(session)
    const backendEnd = streamEvent({ type: 'backend_end', task, session, backend: options.backend.kind })
    await store?.appendEvent?.(session.id, backendEnd)
    yield backendEnd
    const reason = 'backend completed'
    const taskEnd = streamEvent({ type: 'task_end', task, status: completedStatus, reason })
    await store?.appendEvent?.(session.id, taskEnd)
    yield taskEnd
    const final = streamEvent({ type: 'final', task, session, status: completedStatus, reason, text: finalText || undefined })
    await store?.appendEvent?.(session.id, final)
    yield final
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    session = touchSession({ ...session, status: options.signal?.aborted ? 'aborted' : 'failed' })
    await store?.put(session)
    let stopErrorMessage: string | undefined
    try {
      await options.backend.stop?.(session, message)
    } catch (stopErr) {
      stopErrorMessage = stopErr instanceof Error ? stopErr.message : String(stopErr)
    }
    const backendError = streamEvent({
      type: 'backend_error',
      task,
      session,
      backend: options.backend.kind,
      message: stopErrorMessage ? `${message}; backend stop failed: ${stopErrorMessage}` : message,
      recoverable: !options.signal?.aborted,
    })
    await store?.appendEvent?.(session.id, backendError)
    yield backendError
    const status: AgentTaskStatus = options.signal?.aborted ? 'aborted' : 'failed'
    const taskEnd = streamEvent({ type: 'task_end', task, status, reason: message })
    await store?.appendEvent?.(session.id, taskEnd)
    yield taskEnd
    const final = streamEvent({ type: 'final', task, session, status, reason: message, text: finalText || undefined })
    await store?.appendEvent?.(session.id, final)
    yield final
  }
}

export function decideKnowledgeReadiness(
  report: KnowledgeReadinessReport,
  options: { minimumScore?: number } = {},
): KnowledgeReadinessDecision {
  const minimumScore = options.minimumScore ?? 0.7
  const blockingGapIds = report.blockingMissingRequirements.map((requirement) => requirement.id)
  const nonBlockingGapIds = report.nonBlockingGaps.map((requirement) => requirement.id)
  if (blockingGapIds.length > 0) {
    return {
      passed: false,
      status: 'blocked',
      reason: report.reason,
      readinessScore: report.readinessScore,
      recommendedAction: report.recommendedAction,
      severity: report.severity,
      blockingGapIds,
      nonBlockingGapIds,
    }
  }
  if (report.readinessScore < minimumScore) {
    return {
      passed: false,
      status: 'caveat',
      reason: `Knowledge readiness score ${report.readinessScore.toFixed(3)} is below minimum ${minimumScore.toFixed(3)}.`,
      readinessScore: report.readinessScore,
      recommendedAction: report.recommendedAction,
      severity: report.severity,
      blockingGapIds,
      nonBlockingGapIds,
    }
  }
  return {
    passed: true,
    status: 'ready',
    reason: report.reason,
    readinessScore: report.readinessScore,
    recommendedAction: report.recommendedAction,
    severity: report.severity,
    blockingGapIds,
    nonBlockingGapIds,
  }
}

export function sanitizeKnowledgeReadinessReport(
  report: KnowledgeReadinessReport,
  options: RuntimeTelemetryOptions = {},
): SanitizedKnowledgeReadinessReport {
  return {
    taskId: report.taskId,
    readinessScore: report.readinessScore,
    recommendedAction: report.recommendedAction,
    severity: report.severity,
    reason: report.reason,
    blockingMissingRequirements: report.blockingMissingRequirements.map((requirement) =>
      sanitizeKnowledgeRequirement(requirement, options),
    ),
    nonBlockingGaps: report.nonBlockingGaps.map((requirement) =>
      sanitizeKnowledgeRequirement(requirement, options),
    ),
    evidenceCount: report.bundle.evidenceIds.length,
    evidenceIds: options.includeEvidenceIds ? report.bundle.evidenceIds : undefined,
    missingRequirementIds: report.bundle.missing.map((requirement) => requirement.id),
  }
}

export function sanitizeAgentRuntimeEvent<TState, TAction, TActionResult, TEval extends ControlEvalResult>(
  event: AgentRuntimeEvent<TState, TAction, TActionResult, TEval>,
  options: RuntimeTelemetryOptions = {},
): Record<string, unknown> {
  const base = { type: event.type, task: sanitizeTask(event.task, options) }
  if (event.type === 'readiness_start' || event.type === 'task_start' || event.type === 'control_start') {
    return event.type === 'control_start'
      ? { ...base, knowledge: sanitizeKnowledgeReadinessReport(event.knowledge, options) }
      : base
  }
  if (event.type === 'readiness_end') {
    return { ...base, knowledge: sanitizeKnowledgeReadinessReport(event.knowledge, options) }
  }
  if (event.type === 'questions_start') {
    return { ...base, questions: event.questions.map((question) => sanitizeQuestion(question, options)) }
  }
  if (event.type === 'questions_end') {
    return {
      ...base,
      questions: event.questions.map((question) => sanitizeQuestion(question, options)),
      userAnswers: options.includeUserAnswers ? event.userAnswers : redactRecord(event.userAnswers),
    }
  }
  if (event.type === 'acquisition_start') {
    return { ...base, acquisitionPlans: event.acquisitionPlans.map(sanitizeAcquisitionPlan) }
  }
  if (event.type === 'acquisition_end') {
    return {
      ...base,
      acquisitionPlans: event.acquisitionPlans.map(sanitizeAcquisitionPlan),
      acquiredEvidenceCount: event.acquiredEvidenceIds.length,
      acquiredEvidenceIds: options.includeEvidenceIds ? event.acquiredEvidenceIds : undefined,
    }
  }
  if (event.type === 'control_step') {
    return { ...base, step: sanitizeControlStep(event.step, options) }
  }
  if (event.type === 'control_end') {
    return { ...base, control: sanitizeControlRun(event.control, options) }
  }
  return { ...base, status: event.status, reason: event.reason }
}

export function sanitizeRuntimeStreamEvent(
  event: RuntimeStreamEvent,
  options: RuntimeTelemetryOptions = {},
): Record<string, unknown> {
  const withTask = 'task' in event && event.task
    ? { task: sanitizeTask(event.task, options) }
    : {}
  const withSession = 'session' in event && event.session
    ? { session: sanitizeRuntimeSession(event.session, options) }
    : {}

  if (event.type === 'readiness_end') {
    return {
      type: event.type,
      ...withTask,
      timestamp: event.timestamp,
      decision: event.decision,
      knowledge: sanitizeKnowledgeReadinessReport(event.knowledge, options),
    }
  }
  if (event.type === 'questions_start') {
    return { type: event.type, ...withTask, timestamp: event.timestamp, questions: event.questions.map((question) => sanitizeQuestion(question, options)) }
  }
  if (event.type === 'questions_end') {
    return {
      type: event.type,
      ...withTask,
      timestamp: event.timestamp,
      questions: event.questions.map((question) => sanitizeQuestion(question, options)),
      userAnswers: options.includeUserAnswers ? event.userAnswers : redactRecord(event.userAnswers),
    }
  }
  if (event.type === 'acquisition_start') {
    return { type: event.type, ...withTask, timestamp: event.timestamp, acquisitionPlans: event.acquisitionPlans.map(sanitizeAcquisitionPlan) }
  }
  if (event.type === 'acquisition_end') {
    return {
      type: event.type,
      ...withTask,
      timestamp: event.timestamp,
      acquisitionPlans: event.acquisitionPlans.map(sanitizeAcquisitionPlan),
      acquiredEvidenceCount: event.acquiredEvidenceIds.length,
      acquiredEvidenceIds: options.includeEvidenceIds ? event.acquiredEvidenceIds : undefined,
    }
  }
  if (event.type === 'tool_call') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      args: options.includeControlPayloads ? event.args : undefined,
    }
  }
  if (event.type === 'tool_result') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      result: options.includeControlPayloads ? event.result : undefined,
    }
  }
  if (event.type === 'artifact') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      artifactId: event.artifactId,
      name: event.name,
      mimeType: event.mimeType,
      uri: options.includeEvidenceIds ? event.uri : undefined,
      metadata: options.includeMetadata ? event.metadata : undefined,
    }
  }
  if (event.type === 'final') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      status: event.status,
      reason: event.reason,
      text: options.includeControlPayloads ? event.text : undefined,
      metadata: options.includeMetadata ? event.metadata : undefined,
    }
  }
  return {
    type: event.type,
    ...withTask,
    ...withSession,
    timestamp: 'timestamp' in event ? event.timestamp : undefined,
    ...pickPublicStreamFields(event),
  }
}

export function createRuntimeEventCollector<TState = unknown, TAction = unknown, TActionResult = unknown, TEval extends ControlEvalResult = ControlEvalResult>(
  options: RuntimeTelemetryOptions = {},
): RuntimeEventCollector<TState, TAction, TActionResult, TEval> {
  const events: Array<Record<string, unknown>> = []
  return {
    events,
    onEvent: (event) => {
      events.push(sanitizeAgentRuntimeEvent(event, options))
    },
  }
}

export function encodeServerSentEvent(
  data: unknown,
  options: ServerSentEventOptions = {},
): string {
  const lines: string[] = []
  if (options.id) lines.push(`id: ${stripNewlines(options.id)}`)
  if (options.event) lines.push(`event: ${stripNewlines(options.event)}`)
  if (typeof options.retry === 'number' && Number.isFinite(options.retry) && options.retry >= 0) {
    lines.push(`retry: ${Math.floor(options.retry)}`)
  }

  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  for (const line of payload.split(/\r?\n/)) {
    lines.push(`data: ${line}`)
  }
  return `${lines.join('\n')}\n\n`
}

export function readinessServerSentEvent(
  report: KnowledgeReadinessReport,
  options: RuntimeTelemetryOptions & ServerSentEventOptions = {},
): string {
  const { event, id, retry, ...telemetryOptions } = options
  return encodeServerSentEvent({
    type: 'readiness',
    readiness: sanitizeKnowledgeReadinessReport(report, telemetryOptions),
  }, { event, id, retry })
}

export function runtimeStreamServerSentEvent(
  event: RuntimeStreamEvent,
  options: RuntimeTelemetryOptions & ServerSentEventOptions = {},
): string {
  const { event: sseEvent, id, retry, ...telemetryOptions } = options
  return encodeServerSentEvent(sanitizeRuntimeStreamEvent(event, telemetryOptions), { event: sseEvent, id, retry })
}

export function createIterableBackend<TInput extends AgentBackendInput>(
  options: {
    kind: string
    start?: AgentExecutionBackend<TInput>['start']
    resume?: AgentExecutionBackend<TInput>['resume']
    stream: AgentExecutionBackend<TInput>['stream']
    stop?: AgentExecutionBackend<TInput>['stop']
  },
): AgentExecutionBackend<TInput> {
  return options
}

export function createSandboxPromptBackend<TBox, TInput extends AgentBackendInput = AgentBackendInput>(
  options: {
    kind?: string
    getBox(input: TInput, context: Omit<AgentBackendContext, 'session'>): Promise<TBox> | TBox
    streamPrompt(box: TBox, message: string, context: AgentBackendContext): AsyncIterable<unknown>
    mapEvent?: (event: unknown, context: AgentBackendContext) => RuntimeStreamEvent | undefined
    getSessionId?: (box: TBox, input: TInput) => string | undefined
  },
): AgentExecutionBackend<TInput> {
  return {
    kind: options.kind ?? 'sandbox',
    async start(input, context) {
      const box = await options.getBox(input, context)
      return newRuntimeSession(options.kind ?? 'sandbox', options.getSessionId?.(box, input) ?? context.requestedSessionId, {
        resumable: true,
      })
    },
    resume(session) {
      return touchSession({ ...session, status: 'active' })
    },
    async *stream(input, context) {
      const box = await options.getBox(input, context)
      const message = input.message ?? input.messages?.at(-1)?.content ?? context.task.intent
      for await (const event of options.streamPrompt(box, message, context)) {
        const mapped = options.mapEvent?.(event, context) ?? mapCommonBackendEvent(event, context)
        if (mapped) yield mapped
      }
    },
  }
}

export function createCliBridgeBackend<TInput extends AgentBackendInput = AgentBackendInput>(
  options: {
    url: string
    bearer?: string
    kind?: string
    fetchImpl?: typeof fetch
  },
): AgentExecutionBackend<TInput> {
  const fetcher = options.fetchImpl ?? fetch
  return {
    kind: options.kind ?? 'cli-bridge',
    start(_input, context) {
      return newRuntimeSession(options.kind ?? 'cli-bridge', context.requestedSessionId, { resumable: true })
    },
    resume(session) {
      return touchSession({ ...session, status: 'active' })
    },
    async *stream(input, context) {
      const response = await fetcher(options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
        },
        body: JSON.stringify({
          sessionId: context.session.id,
          resumeToken: context.session.resumeToken,
          task: input.task,
          message: input.message,
          messages: input.messages,
          inputs: input.inputs,
        }),
        signal: context.signal,
      })
      if (!response.ok) throw new Error(`cli bridge returned ${response.status}`)
      yield* streamResponseEvents(response, context)
    },
  }
}

export function createOpenAICompatibleBackend<TInput extends AgentBackendInput = AgentBackendInput>(
  options: {
    apiKey: string
    baseUrl: string
    model: string
    kind?: string
    fetchImpl?: typeof fetch
  },
): AgentExecutionBackend<TInput> {
  const fetcher = options.fetchImpl ?? fetch
  return {
    kind: options.kind ?? 'tcloud',
    start(_input, context) {
      return newRuntimeSession(options.kind ?? 'tcloud', context.requestedSessionId)
    },
    async *stream(input, context) {
      const response = await fetcher(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          stream: true,
          messages: input.messages ?? [{ role: 'user', content: input.message ?? context.task.intent }],
        }),
        signal: context.signal,
      })
      if (!response.ok) throw new Error(`chat backend returned ${response.status}`)
      yield* streamResponseEvents(response, context)
    },
  }
}

async function runKnowledgePreflight<TState, TAction, TActionResult, TEval extends ControlEvalResult>(
  task: AgentTaskSpec,
  questions: UserQuestion[],
  acquisitionPlans: DataAcquisitionPlan[],
  provider: AgentKnowledgeProvider | undefined,
  onEvent: AgentRuntimeEventSink<TState, TAction, TActionResult, TEval> | undefined,
): Promise<{ userAnswers: Record<string, string>; acquiredEvidenceIds: string[] }> {
  let userAnswers: Record<string, string> = {}
  let acquiredEvidenceIds: string[] = []
  if (questions.length > 0 && provider?.answerQuestions) {
    await emit(onEvent, { type: 'questions_start', task, questions })
    userAnswers = await provider.answerQuestions(questions, task)
    await emit(onEvent, { type: 'questions_end', task, questions, userAnswers })
  }
  if (acquisitionPlans.length > 0 && provider?.executeAcquisitionPlans) {
    await emit(onEvent, { type: 'acquisition_start', task, acquisitionPlans })
    acquiredEvidenceIds = await provider.executeAcquisitionPlans(acquisitionPlans, task)
    await emit(onEvent, { type: 'acquisition_end', task, acquisitionPlans, acquiredEvidenceIds })
  }
  return { userAnswers, acquiredEvidenceIds }
}

async function runKnowledgePreflightStream(
  task: AgentTaskSpec,
  questions: UserQuestion[],
  acquisitionPlans: DataAcquisitionPlan[],
  provider: AgentKnowledgeProvider | undefined,
): Promise<{
  userAnswers: Record<string, string>
  acquiredEvidenceIds: string[]
  events: RuntimeStreamEvent[]
}> {
  const events: RuntimeStreamEvent[] = []
  let userAnswers: Record<string, string> = {}
  let acquiredEvidenceIds: string[] = []
  if (questions.length > 0 && provider?.answerQuestions) {
    events.push(streamEvent({ type: 'questions_start', task, questions }))
    userAnswers = await provider.answerQuestions(questions, task)
    events.push(streamEvent({ type: 'questions_end', task, questions, userAnswers }))
  }
  if (acquisitionPlans.length > 0 && provider?.executeAcquisitionPlans) {
    events.push(streamEvent({ type: 'acquisition_start', task, acquisitionPlans }))
    acquiredEvidenceIds = await provider.executeAcquisitionPlans(acquisitionPlans, task)
    events.push(streamEvent({ type: 'acquisition_end', task, acquisitionPlans, acquiredEvidenceIds }))
  }
  return { userAnswers, acquiredEvidenceIds, events }
}

function sanitizeTask(task: AgentTaskSpec, options: RuntimeTelemetryOptions): Record<string, unknown> {
  return {
    id: task.id,
    intent: task.intent,
    domain: task.domain,
    inputs: options.includeInputs ? task.inputs : task.inputs ? '[redacted]' : undefined,
    requiredKnowledge: task.requiredKnowledge?.map((requirement) =>
      sanitizeKnowledgeRequirement(requirement, options),
    ),
    metadata: options.includeMetadata ? task.metadata : task.metadata ? '[redacted]' : undefined,
  }
}

function sanitizeRuntimeSession(session: RuntimeSession, options: RuntimeTelemetryOptions): Record<string, unknown> {
  return {
    id: session.id,
    backend: session.backend,
    status: session.status,
    hasResumeToken: Boolean(session.resumeToken),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    metadata: options.includeMetadata ? session.metadata : session.metadata ? '[redacted]' : undefined,
  }
}

function sanitizeKnowledgeRequirement(
  requirement: KnowledgeRequirement,
  options: RuntimeTelemetryOptions,
): SanitizedKnowledgeRequirement {
  const includeDescription = options.includeRequirementDescriptions && requirement.sensitivity !== 'secret'
  return {
    id: requirement.id,
    description: includeDescription ? requirement.description : undefined,
    requiredFor: requirement.requiredFor,
    category: requirement.category,
    acquisitionMode: requirement.acquisitionMode,
    importance: requirement.importance,
    freshness: requirement.freshness,
    sensitivity: requirement.sensitivity,
    confidenceNeeded: requirement.confidenceNeeded,
    currentConfidence: requirement.currentConfidence,
    evidenceCount: requirement.evidenceIds.length,
    evidenceIds: options.includeEvidenceIds ? requirement.evidenceIds : undefined,
    fallbackPolicy: requirement.fallbackPolicy,
  }
}

function sanitizeQuestion(question: UserQuestion, options: RuntimeTelemetryOptions): Record<string, unknown> {
  return {
    id: question.id,
    question: options.includeRequirementDescriptions && question.answerType !== 'credential'
      ? question.question
      : undefined,
    reason: options.includeRequirementDescriptions ? question.reason : undefined,
    requirementId: question.requirementId,
    importance: question.importance,
    answerType: question.answerType,
    impactIfUnknown: options.includeRequirementDescriptions ? question.impactIfUnknown : undefined,
    optionCount: question.options?.length ?? 0,
  }
}

function sanitizeAcquisitionPlan(plan: DataAcquisitionPlan): Record<string, unknown> {
  return {
    id: plan.id,
    requirementIds: plan.requirementIds,
    mode: plan.mode,
    priority: plan.priority,
    expectedEvidenceCount: plan.expectedEvidenceIds?.length ?? 0,
    questionCount: plan.questions?.length ?? 0,
  }
}

function sanitizeControlStep<TState, TAction, TActionResult, TEval extends ControlEvalResult>(
  step: ControlStep<TState, TAction, TActionResult, TEval>,
  options: RuntimeTelemetryOptions,
): Record<string, unknown> {
  const actionOutcome = step.actionOutcome
  return {
    index: step.index,
    decisionType: step.decision.type,
    reason: step.decision.reason,
    action: options.includeControlPayloads && step.decision.type === 'continue' ? step.decision.action : undefined,
    result: options.includeControlPayloads && actionOutcome?.ok ? actionOutcome.result : undefined,
    actionOk: actionOutcome?.ok,
    actionError: actionOutcome?.ok === false ? actionOutcome.error : undefined,
    durationMs: actionOutcome?.durationMs,
    evalsBefore: summarizeEvals(step.evalsBefore, options),
    evalsAfter: summarizeEvals(step.evalsAfter, options),
    startedAt: step.startedAt,
    endedAt: step.endedAt,
  }
}

function sanitizeControlRun<TState, TAction, TActionResult, TEval extends ControlEvalResult>(
  control: ControlRunResult<TState, TAction, TActionResult, TEval>,
  options: RuntimeTelemetryOptions,
): Record<string, unknown> {
  return {
    pass: control.pass,
    completed: control.completed,
    reason: control.reason,
    score: control.score,
    stepCount: control.steps.length,
    wallMs: control.wallMs,
    spentCostUsd: control.spentCostUsd,
    failureClass: control.failureClass,
    stoppedBy: control.stoppedBy,
    runId: control.runId,
    runtimeErrorCount: control.runtimeErrors.length,
    finalEvals: summarizeEvals(control.finalEvals, options),
  }
}

function summarizeEvals(evals: ControlEvalResult[], options: RuntimeTelemetryOptions): Array<Record<string, unknown>> {
  return evals.map((evalResult) => ({
    id: evalResult.id,
    passed: evalResult.passed,
    score: evalResult.score,
    severity: evalResult.severity,
    objective: evalResult.objective,
    detail: options.includeEvalDetails ? evalResult.detail : undefined,
    evidence: options.includeEvalDetails ? evalResult.evidence : undefined,
  }))
}

function redactRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(record).map((key) => [key, '[redacted]']))
}

function stripNewlines(value: string): string {
  return value.replace(/[\r\n]/g, ' ')
}

function timestamp(): string {
  return new Date().toISOString()
}

function streamEvent<T extends Omit<RuntimeStreamEvent, 'timestamp'>>(event: T): T & { timestamp: string } {
  return { ...event, timestamp: timestamp() }
}

function newRuntimeSession(backend: string, requestedId?: string, metadata?: Record<string, unknown>): RuntimeSession {
  const now = timestamp()
  return {
    id: requestedId || crypto.randomUUID(),
    backend,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    metadata,
  }
}

function touchSession(session: RuntimeSession): RuntimeSession {
  return { ...session, updatedAt: timestamp() }
}

async function startBackendSession<TInput extends AgentBackendInput>(
  backend: AgentExecutionBackend<TInput>,
  input: TInput,
  context: Omit<AgentBackendContext, 'session'>,
  requestedSessionId?: string,
): Promise<RuntimeSession> {
  if (backend.start) return backend.start(input, { ...context, requestedSessionId })
  return newRuntimeSession(backend.kind, requestedSessionId)
}

async function resumeBackendSession<TInput extends AgentBackendInput>(
  backend: AgentExecutionBackend<TInput>,
  session: RuntimeSession,
  input: TInput,
  context: Omit<AgentBackendContext, 'session'>,
): Promise<RuntimeSession> {
  if (session.backend !== backend.kind) {
    throw new Error(`Cannot resume ${session.backend} session with ${backend.kind} backend`)
  }
  if (backend.resume) return backend.resume(session, input, context)
  return touchSession({ ...session, status: 'active' })
}

function normalizeBackendStreamEvent(event: RuntimeStreamEvent, task: AgentTaskSpec, session: RuntimeSession): RuntimeStreamEvent {
  if ('task' in event && event.task && 'session' in event && event.session && 'timestamp' in event && event.timestamp) return event
  return {
    ...event,
    task: 'task' in event && event.task ? event.task : task,
    session: 'session' in event && event.session ? event.session : session,
    timestamp: 'timestamp' in event && event.timestamp ? event.timestamp : timestamp(),
  } as RuntimeStreamEvent
}

function pickPublicStreamFields(event: RuntimeStreamEvent): Record<string, unknown> {
  if (event.type === 'session_created' || event.type === 'session_resumed') return {}
  if (event.type === 'backend_start' || event.type === 'backend_end') return { backend: event.backend }
  if (event.type === 'backend_error') return { backend: event.backend, message: event.message, recoverable: event.recoverable }
  if (event.type === 'task_end') return { status: event.status, reason: event.reason }
  if (event.type === 'text_delta' || event.type === 'reasoning_delta') return { text: event.text }
  return {}
}

function mapCommonBackendEvent(event: unknown, context: AgentBackendContext): RuntimeStreamEvent | undefined {
  if (!event || typeof event !== 'object') return undefined
  const record = event as Record<string, unknown>
  const type = String(record.type ?? '')
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record
  if (type === 'message.part.updated' || type === 'text_delta' || type === 'delta') {
    const text = stringValue(data.text) ?? stringValue(data.delta) ?? stringValue(record.text)
    return text ? { type: 'text_delta', task: context.task, session: context.session, text, timestamp: timestamp() } : undefined
  }
  if (type === 'reasoning_delta') {
    const text = stringValue(data.text) ?? stringValue(record.text)
    return text ? { type: 'reasoning_delta', task: context.task, session: context.session, text, timestamp: timestamp() } : undefined
  }
  if (type === 'tool_call') {
    return {
      type: 'tool_call',
      task: context.task,
      session: context.session,
      toolName: stringValue(data.name) ?? stringValue(record.toolName) ?? 'tool',
      toolCallId: stringValue(data.id) ?? stringValue(record.toolCallId),
      args: data.args ?? data.input ?? record.args,
      timestamp: timestamp(),
    }
  }
  if (type === 'tool_result') {
    return {
      type: 'tool_result',
      task: context.task,
      session: context.session,
      toolName: stringValue(data.name) ?? stringValue(record.toolName) ?? 'tool',
      toolCallId: stringValue(data.id) ?? stringValue(record.toolCallId),
      result: data.result ?? data.output ?? record.result,
      timestamp: timestamp(),
    }
  }
  if (type === 'result' || type === 'final') {
    const text = stringValue(data.finalText) ?? stringValue(data.text) ?? stringValue(record.text)
    return text ? { type: 'text_delta', task: context.task, session: context.session, text, timestamp: timestamp() } : undefined
  }
  return undefined
}

async function* streamResponseEvents(response: Response, context: AgentBackendContext): AsyncIterable<RuntimeStreamEvent> {
  const body = response.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    for (const event of drainStreamBuffer(false)) yield event
  }
  buffer += decoder.decode().replace(/\r\n/g, '\n')
  for (const event of drainStreamBuffer(true)) yield event
  if (buffer.trim()) {
    const event = parseStreamChunk(buffer, context)
    if (event) yield event
  }

  function* drainStreamBuffer(flush: boolean): Iterable<RuntimeStreamEvent> {
    for (;;) {
      const sseBoundary = buffer.indexOf('\n\n')
      if (sseBoundary >= 0) {
        const chunk = buffer.slice(0, sseBoundary)
        buffer = buffer.slice(sseBoundary + 2)
        const event = parseStreamChunk(chunk, context)
        if (event) yield event
        continue
      }

      const newline = buffer.indexOf('\n')
      if (newline >= 0 && !buffer.slice(0, newline).startsWith('data:')) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const event = parseStreamChunk(line, context)
        if (event) yield event
        continue
      }

      if (flush && buffer.trim() && !buffer.trimStart().startsWith('data:')) {
        const line = buffer
        buffer = ''
        const event = parseStreamChunk(line, context)
        if (event) yield event
        continue
      }

      break
    }
  }
}

function parseStreamChunk(chunk: string, context: AgentBackendContext): RuntimeStreamEvent | undefined {
  const lines = chunk.split(/\r?\n/)
  const dataLines = lines.filter((line) => line.startsWith('data:'))
  const data = dataLines.length > 0
    ? dataLines.map((line) => line.slice(5).trimStart()).join('\n')
    : chunk.trim()
  if (!data || data === '[DONE]') return undefined
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>
    const choice = Array.isArray(parsed.choices) ? parsed.choices[0] as Record<string, unknown> | undefined : undefined
    const delta = choice?.delta as Record<string, unknown> | undefined
    const message = choice?.message as Record<string, unknown> | undefined
    const text = stringValue(delta?.content) ?? stringValue(message?.content) ?? stringValue(parsed.text)
    if (text) return { type: 'text_delta', task: context.task, session: context.session, text, timestamp: timestamp() }
    return mapCommonBackendEvent(parsed, context)
  } catch {
    return { type: 'text_delta', task: context.task, session: context.session, text: data, timestamp: timestamp() }
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function buildReadiness(
  task: AgentTaskSpec,
  provider: AgentKnowledgeProvider | undefined,
): Promise<KnowledgeReadinessReport> | KnowledgeReadinessReport {
  if (provider?.buildReadiness) return provider.buildReadiness(task)
  return scoreKnowledgeReadiness({
    taskId: task.id,
    requirements: task.requiredKnowledge ?? [],
    metadata: { domain: task.domain, ...task.metadata },
  })
}

function isKnowledgeBlocked(evals: ControlEvalResult[]): boolean {
  return evals.some((evalResult) => evalResult.id === 'knowledge-ready' && !evalResult.passed)
}

function statusFromControl(control: ControlRunResult<unknown, unknown, unknown, ControlEvalResult>): AgentTaskStatus {
  if (control.stoppedBy === 'abort') return 'aborted'
  if (control.reason.includes('knowledge readiness blocked')) return 'blocked'
  if (control.pass) return 'completed'
  return 'failed'
}

async function emit<TState, TAction, TActionResult, TEval extends ControlEvalResult>(
  sink: AgentRuntimeEventSink<TState, TAction, TActionResult, TEval> | undefined,
  event: AgentRuntimeEvent<TState, TAction, TActionResult, TEval>,
): Promise<void> {
  await sink?.(event)
}

function toAgentContext<TState, TAction, TActionResult, TEval extends ControlEvalResult>(
  task: AgentTaskSpec,
  knowledge: KnowledgeReadinessReport,
  ctx: ControlContext<TState, TAction, TActionResult, TEval>,
): AgentTaskContext<TState, TAction, TActionResult, TEval> {
  return {
    task,
    knowledge,
    state: ctx.state,
    evals: ctx.evals,
    history: ctx.history,
    budget: ctx.budget,
    stepIndex: ctx.stepIndex,
    wallMs: ctx.wallMs,
    spentCostUsd: ctx.spentCostUsd,
    remainingCostUsd: ctx.remainingCostUsd,
    abortSignal: ctx.abortSignal,
  }
}

export type {
  ControlBudget,
  ControlDecision,
  ControlEvalResult,
  ControlRunResult,
  ControlStep,
  DataAcquisitionPlan,
  KnowledgeReadinessReport,
  KnowledgeRequirement,
  RunRecord,
  UserQuestion,
} from '@tangle-network/agent-eval'
