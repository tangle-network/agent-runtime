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
