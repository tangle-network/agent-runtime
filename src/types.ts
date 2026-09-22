/**
 *
 * Core task, session, adapter, and stream-event types for the runtime.
 *
 * This module owns the public shape of every cross-cutting record (`TaskSpec`,
 * `RuntimeSession`, `RuntimeStreamEvent`). Everything else in the runtime
 * imports from here so type-level changes ripple in one place.
 *
 * @stable
 */

import type {
  ControlBudget,
  ControlDecision,
  ControlEvalResult,
  ControlRunResult,
  ControlStep,
  DataAcquisitionPlan,
  KnowledgeReadinessReport,
  RunRecord,
  TraceStore,
  UserQuestion,
} from '@tangle-network/agent-eval'
import type {
  AgentRunControlRef,
  InteractionAcknowledgement,
  InteractionResponseCommand,
} from '@tangle-network/agent-interface'
import type {
  AgentTaskSpec,
  AgentTaskStatus,
  RuntimeSession,
} from './runtime-contracts'
import type { RuntimeStreamEvent } from './runtime-stream-types'

export type {
  AgentTaskSpec,
  AgentTaskStatus,
  BackendErrorDetail,
  KnowledgeReadinessDecision,
  RuntimeSession,
} from './runtime-contracts'
export type { RuntimeStreamEvent } from './runtime-stream-types'

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

/**
 *
 * OpenAI Chat Completions tool descriptor. The shape mirrors the
 * `/v1/chat/completions` `tools[]` parameter so callers can pass tool
 * definitions through `createOpenAICompatibleBackend({ tools })` without any
 * runtime translation. The router proxies this shape verbatim to Anthropic
 * (translated server-side), DeepSeek, Groq, OpenAI, and Gemini — every model
 * that the eval surface targets.
 *
 * Callers that build their tool list from MCP servers should run a one-shot
 * MCP `tools/list` at config time and project the result into this shape. The
 * runtime intentionally does NOT depend on `@modelcontextprotocol/sdk` —
 * keeping the backend transport thin lets domain repos own MCP plumbing.
 *
 * @stable
 */
export interface OpenAIChatTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

/**
 *
 * `tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI
 * spec: `'auto'` (default — model decides), `'none'` (disable tool calling
 * for this turn), `'required'` (force a tool call), or a specific function
 * pin `{ type: 'function', function: { name } }`.
 *
 * @stable
 */
export type OpenAIChatToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } }

/**
 *
 * `response_format` parameter for OpenAI-compatible chat endpoints. Use
 * `json_object` when the caller needs syntactically valid JSON, or
 * `json_schema` when the upstream provider supports schema-constrained JSON.
 *
 * @stable
 */
export type OpenAIChatResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: Record<string, unknown> }

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
  /**
   * Conversation/run identifier when this call is part of a multi-agent run.
   * Backends should stamp it into any trace/log emission so cross-participant
   * events correlate. Absent when the call is a stand-alone `runAgentTask`.
   */
  runId?: string
  /**
   * Deterministic turn id for this single call. Stable across retries of the
   * same logical turn so a caching gateway / idempotent backend can dedupe.
   */
  turnId?: string
  /**
   * If this call is itself nested inside a higher-order conversation
   * (recursion via `createConversationBackend`), the enclosing turn's id.
   * Used for trace stitching across nested orchestration.
   */
  parentTurnId?: string
  /**
   * Headers to forward verbatim to any outbound HTTP the backend issues:
   * `X-Tangle-Forwarded-Authorization`, `X-Tangle-Forwarded-Depth`,
   * run/turn correlation. Backends that issue HTTP MUST merge these into
   * the outbound request; backends that don't issue HTTP may ignore them.
   */
  propagatedHeaders?: Readonly<Record<string, string>>
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
  /** Replay a retained run after an exclusive event cursor. */
  replay?(
    controlRef: AgentRunControlRef,
    options?: { after?: string; signal?: AbortSignal },
  ): AsyncIterable<RuntimeStreamEvent>
  /** Read retained-run status without starting or resuming work. */
  status?(
    controlRef: AgentRunControlRef,
    options?: { waitMs?: number; signal?: AbortSignal },
  ): Promise<RuntimeSession | null> | RuntimeSession | null
  /** Submit one exactly-bound interaction response. */
  respondToInteraction?(
    command: InteractionResponseCommand,
    options?: { signal?: AbortSignal },
  ): Promise<InteractionAcknowledgement>
  /** Explicitly cancel one retained run by its exact provider coordinates. */
  cancel?(controlRef: AgentRunControlRef, options?: { signal?: AbortSignal }): Promise<void>
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
