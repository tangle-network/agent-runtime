/**
 * @stable
 *
 * Core task, session, adapter, and stream-event types for the runtime.
 *
 * This module owns the public shape of every cross-cutting record (`TaskSpec`,
 * `RuntimeSession`, `RuntimeStreamEvent`). Everything else in the runtime
 * imports from here so type-level changes ripple in one place.
 */

import type {
  ControlBudget,
  ControlDecision,
  ControlEvalResult,
  ControlRunResult,
  ControlStep,
  DataAcquisitionPlan,
  KnowledgeReadinessReport,
  KnowledgeRequirement,
  RunRecord,
  TraceStore,
  UserQuestion,
} from '@tangle-network/agent-eval'

/** @stable */
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

/** @stable */
export interface AgentKnowledgeProvider {
  buildReadiness?(task: AgentTaskSpec): Promise<KnowledgeReadinessReport> | KnowledgeReadinessReport
  answerQuestions?(
    questions: UserQuestion[],
    task: AgentTaskSpec,
  ): Promise<Record<string, string>> | Record<string, string>
  executeAcquisitionPlans?(
    plans: DataAcquisitionPlan[],
    task: AgentTaskSpec,
  ): Promise<string[]> | string[]
  refreshReadiness?(input: {
    task: AgentTaskSpec
    previous: KnowledgeReadinessReport
    userAnswers: Record<string, string>
    acquiredEvidenceIds: string[]
  }): Promise<KnowledgeReadinessReport> | KnowledgeReadinessReport
}

/** @stable */
export interface AgentTaskContext<
  TState,
  TAction,
  TActionResult,
  TEval extends ControlEvalResult = ControlEvalResult,
> {
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

/** @stable */
export interface AgentAdapter<
  TState,
  TAction,
  TActionResult,
  TEval extends ControlEvalResult = ControlEvalResult,
> {
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

  decide(
    ctx: AgentTaskContext<TState, TAction, TActionResult, TEval>,
  ): Promise<ControlDecision<TAction>> | ControlDecision<TAction>

  act(
    action: TAction,
    ctx: AgentTaskContext<TState, TAction, TActionResult, TEval>,
  ): Promise<TActionResult> | TActionResult

  shouldStop?(ctx: AgentTaskContext<TState, TAction, TActionResult, TEval>):
    | Promise<{
        stop: boolean
        pass: boolean
        reason: string
        score?: number
      }>
    | {
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

  projectRunRecords?(
    result: ControlRunResult<TState, TAction, TActionResult, TEval>,
    task: AgentTaskSpec,
  ): RunRecord[]
}

/** @stable */
export type AgentTaskStatus = 'completed' | 'blocked' | 'failed' | 'aborted'

/** @stable */
export type AgentRuntimeEvent<
  TState = unknown,
  TAction = unknown,
  TActionResult = unknown,
  TEval extends ControlEvalResult = ControlEvalResult,
> =
  | { type: 'task_start'; task: AgentTaskSpec }
  | { type: 'readiness_start'; task: AgentTaskSpec }
  | { type: 'readiness_end'; task: AgentTaskSpec; knowledge: KnowledgeReadinessReport }
  | { type: 'questions_start'; task: AgentTaskSpec; questions: UserQuestion[] }
  | {
      type: 'questions_end'
      task: AgentTaskSpec
      questions: UserQuestion[]
      userAnswers: Record<string, string>
    }
  | {
      type: 'acquisition_start'
      task: AgentTaskSpec
      acquisitionPlans: DataAcquisitionPlan[]
    }
  | {
      type: 'acquisition_end'
      task: AgentTaskSpec
      acquisitionPlans: DataAcquisitionPlan[]
      acquiredEvidenceIds: string[]
    }
  | { type: 'control_start'; task: AgentTaskSpec; knowledge: KnowledgeReadinessReport }
  | {
      type: 'control_step'
      task: AgentTaskSpec
      step: ControlStep<TState, TAction, TActionResult, TEval>
    }
  | {
      type: 'control_end'
      task: AgentTaskSpec
      control: ControlRunResult<TState, TAction, TActionResult, TEval>
    }
  | { type: 'task_end'; task: AgentTaskSpec; status: AgentTaskStatus; reason: string }

/** @stable */
export type AgentRuntimeEventSink<
  TState = unknown,
  TAction = unknown,
  TActionResult = unknown,
  TEval extends ControlEvalResult = ControlEvalResult,
> = (event: AgentRuntimeEvent<TState, TAction, TActionResult, TEval>) => Promise<void> | void

/** @stable */
export type RuntimeStreamEvent =
  | { type: 'task_start'; task: AgentTaskSpec; timestamp: string }
  | { type: 'readiness_start'; task: AgentTaskSpec; timestamp: string }
  | {
      type: 'readiness_end'
      task: AgentTaskSpec
      knowledge: KnowledgeReadinessReport
      decision: KnowledgeReadinessDecision
      timestamp: string
    }
  | {
      type: 'questions_start'
      task: AgentTaskSpec
      questions: UserQuestion[]
      timestamp: string
    }
  | {
      type: 'questions_end'
      task: AgentTaskSpec
      questions: UserQuestion[]
      userAnswers: Record<string, string>
      timestamp: string
    }
  | {
      type: 'acquisition_start'
      task: AgentTaskSpec
      acquisitionPlans: DataAcquisitionPlan[]
      timestamp: string
    }
  | {
      type: 'acquisition_end'
      task: AgentTaskSpec
      acquisitionPlans: DataAcquisitionPlan[]
      acquiredEvidenceIds: string[]
      timestamp: string
    }
  | { type: 'session_created'; task: AgentTaskSpec; session: RuntimeSession; timestamp: string }
  | { type: 'session_resumed'; task: AgentTaskSpec; session: RuntimeSession; timestamp: string }
  | {
      type: 'backend_start'
      task: AgentTaskSpec
      session: RuntimeSession
      backend: string
      timestamp: string
    }
  | {
      type: 'text_delta'
      task?: AgentTaskSpec
      session?: RuntimeSession
      text: string
      timestamp?: string
    }
  | {
      type: 'reasoning_delta'
      task?: AgentTaskSpec
      session?: RuntimeSession
      text: string
      timestamp?: string
    }
  | {
      type: 'tool_call'
      task?: AgentTaskSpec
      session?: RuntimeSession
      toolName: string
      toolCallId?: string
      args?: unknown
      timestamp?: string
    }
  | {
      type: 'tool_result'
      task?: AgentTaskSpec
      session?: RuntimeSession
      toolName: string
      toolCallId?: string
      result?: unknown
      timestamp?: string
    }
  | {
      type: 'llm_call'
      task?: AgentTaskSpec
      session?: RuntimeSession
      model: string
      tokensIn?: number
      tokensOut?: number
      costUsd?: number
      latencyMs?: number
      finishReason?: string
      timestamp?: string
    }
  | {
      type: 'artifact'
      task?: AgentTaskSpec
      session?: RuntimeSession
      artifactId: string
      name?: string
      mimeType?: string
      uri?: string
      metadata?: Record<string, unknown>
      timestamp?: string
    }
  | {
      type: 'backend_error'
      task: AgentTaskSpec
      session?: RuntimeSession
      backend: string
      message: string
      recoverable: boolean
      timestamp: string
    }
  | {
      type: 'backend_end'
      task: AgentTaskSpec
      session: RuntimeSession
      backend: string
      timestamp: string
    }
  | {
      type: 'task_end'
      task: AgentTaskSpec
      status: AgentTaskStatus
      reason: string
      timestamp: string
    }
  | {
      type: 'final'
      task: AgentTaskSpec
      session?: RuntimeSession
      status: AgentTaskStatus
      reason: string
      text?: string
      metadata?: Record<string, unknown>
      timestamp: string
    }

/** @stable */
export interface RuntimeSession {
  id: string
  backend: string
  status: 'active' | 'completed' | 'failed' | 'aborted'
  resumeToken?: string
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
}

/** @stable */
export interface RuntimeSessionStore {
  get(sessionId: string): Promise<RuntimeSession | undefined> | RuntimeSession | undefined
  put(session: RuntimeSession): Promise<void> | void
  appendEvent?(sessionId: string, event: RuntimeStreamEvent): Promise<void> | void
  listEvents?(sessionId: string): Promise<RuntimeStreamEvent[]> | RuntimeStreamEvent[]
}

/** @stable */
export interface AgentBackendInput {
  task: AgentTaskSpec
  message?: string
  messages?: Array<{ role: string; content: string }>
  inputs?: Record<string, unknown>
}

/** @stable */
export interface AgentBackendContext {
  task: AgentTaskSpec
  knowledge: KnowledgeReadinessReport
  session: RuntimeSession
  signal?: AbortSignal
}

/** @stable */
export interface AgentExecutionBackend<TInput extends AgentBackendInput = AgentBackendInput> {
  kind: string
  start?(
    input: TInput,
    context: Omit<AgentBackendContext, 'session'> & { requestedSessionId?: string },
  ): Promise<RuntimeSession> | RuntimeSession
  resume?(
    session: RuntimeSession,
    input: TInput,
    context: Omit<AgentBackendContext, 'session'>,
  ): Promise<RuntimeSession> | RuntimeSession
  stream(input: TInput, context: AgentBackendContext): AsyncIterable<RuntimeStreamEvent>
  stop?(session: RuntimeSession, reason: string): Promise<void> | void
}

/** @stable */
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

/** @stable */
export interface RunAgentTaskOptions<
  TState,
  TAction,
  TActionResult,
  TEval extends ControlEvalResult = ControlEvalResult,
> {
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

/** @stable */
export interface AgentTaskRunResult<
  TState,
  TAction,
  TActionResult,
  TEval extends ControlEvalResult = ControlEvalResult,
> {
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

/** @stable */
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

/** @stable */
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
