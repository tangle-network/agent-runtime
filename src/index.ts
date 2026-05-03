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
