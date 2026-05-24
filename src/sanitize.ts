/**
 * @stable
 *
 * Sanitization for runtime telemetry. The rule: nothing user-controlled leaks
 * unless the caller opts in with a `RuntimeTelemetryOptions` flag. This is the
 * envelope that ends up in `agent_run.metadata.runtimeEvents` on every
 * consumer, so the default must be safe.
 */

import type {
  ControlEvalResult,
  ControlRunResult,
  ControlStep,
  DataAcquisitionPlan,
  KnowledgeReadinessReport,
  KnowledgeRequirement,
  UserQuestion,
} from '@tangle-network/agent-eval'

import type {
  AgentRuntimeEvent,
  AgentTaskSpec,
  AgentTaskStatus,
  RuntimeSession,
  RuntimeStreamEvent,
} from './types'

/** @stable */
export interface RuntimeTelemetryOptions {
  /**
   * Include raw task inputs. Off by default because task inputs often contain
   * customer facts, credentials, source text, or internal IDs.
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

/** @stable */
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

/** @stable */
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

/** @stable */
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

/** @stable */
export function sanitizeAgentRuntimeEvent<
  TState,
  TAction,
  TActionResult,
  TEval extends ControlEvalResult,
>(
  event: AgentRuntimeEvent<TState, TAction, TActionResult, TEval>,
  options: RuntimeTelemetryOptions = {},
): Record<string, unknown> {
  const base = { type: event.type, task: sanitizeTask(event.task, options) }
  if (
    event.type === 'readiness_start' ||
    event.type === 'task_start' ||
    event.type === 'control_start'
  ) {
    return event.type === 'control_start'
      ? { ...base, knowledge: sanitizeKnowledgeReadinessReport(event.knowledge, options) }
      : base
  }
  if (event.type === 'readiness_end') {
    return { ...base, knowledge: sanitizeKnowledgeReadinessReport(event.knowledge, options) }
  }
  if (event.type === 'questions_start') {
    return {
      ...base,
      questions: event.questions.map((question) => sanitizeQuestion(question, options)),
    }
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

/** @stable */
export function sanitizeRuntimeStreamEvent(
  event: RuntimeStreamEvent,
  options: RuntimeTelemetryOptions = {},
): Record<string, unknown> {
  const withTask = 'task' in event && event.task ? { task: sanitizeTask(event.task, options) } : {}
  const withSession =
    'session' in event && event.session
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
    return {
      type: event.type,
      ...withTask,
      timestamp: event.timestamp,
      questions: event.questions.map((question) => sanitizeQuestion(question, options)),
    }
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
    return {
      type: event.type,
      ...withTask,
      timestamp: event.timestamp,
      acquisitionPlans: event.acquisitionPlans.map(sanitizeAcquisitionPlan),
    }
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
  if (event.type === 'llm_call') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      model: event.model,
      tokensIn: event.tokensIn,
      tokensOut: event.tokensOut,
      costUsd: event.costUsd,
      latencyMs: event.latencyMs,
      finishReason: event.finishReason,
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
      content: options.includeControlPayloads ? event.content : undefined,
      metadata: options.includeMetadata ? event.metadata : undefined,
    }
  }
  if (event.type === 'proposal_created') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      proposalId: event.proposalId,
      title: options.includeControlPayloads ? event.title : undefined,
      status: event.status,
    }
  }
  if (event.type === 'final') {
    // Surface error `kind` + `status` always — operators need failure
    // classification regardless of telemetry payload opt-in. `body` follows
    // the same gating as raw payloads (`includeControlPayloads`) because it
    // can echo user-visible text from the upstream provider's error page.
    const sanitizedError =
      event.error !== undefined
        ? {
            kind: event.error.kind,
            message: event.error.message,
            status: event.error.status,
            body: options.includeControlPayloads ? event.error.body : undefined,
          }
        : undefined
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      status: event.status,
      reason: event.reason,
      text: options.includeControlPayloads ? event.text : undefined,
      metadata: options.includeMetadata ? event.metadata : undefined,
      ...(sanitizedError !== undefined ? { error: sanitizedError } : {}),
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

function sanitizeTask(
  task: AgentTaskSpec,
  options: RuntimeTelemetryOptions,
): Record<string, unknown> {
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

function sanitizeRuntimeSession(
  session: RuntimeSession,
  options: RuntimeTelemetryOptions,
): Record<string, unknown> {
  return {
    id: session.id,
    backend: session.backend,
    status: session.status,
    hasResumeToken: Boolean(session.resumeToken),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    metadata: options.includeMetadata
      ? session.metadata
      : session.metadata
        ? '[redacted]'
        : undefined,
  }
}

function sanitizeKnowledgeRequirement(
  requirement: KnowledgeRequirement,
  options: RuntimeTelemetryOptions,
): SanitizedKnowledgeRequirement {
  const includeDescription =
    options.includeRequirementDescriptions && requirement.sensitivity !== 'secret'
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

function sanitizeQuestion(
  question: UserQuestion,
  options: RuntimeTelemetryOptions,
): Record<string, unknown> {
  return {
    id: question.id,
    question:
      options.includeRequirementDescriptions && question.answerType !== 'credential'
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
    action:
      options.includeControlPayloads && step.decision.type === 'continue'
        ? step.decision.action
        : undefined,
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

function summarizeEvals(
  evals: ControlEvalResult[],
  options: RuntimeTelemetryOptions,
): Array<Record<string, unknown>> {
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

function pickPublicStreamFields(event: RuntimeStreamEvent): Record<string, unknown> {
  if (event.type === 'session_created' || event.type === 'session_resumed') return {}
  if (event.type === 'backend_start' || event.type === 'backend_end')
    return { backend: event.backend }
  if (event.type === 'backend_error') {
    // `error.body` is the truncated upstream response — it can carry
    // user-visible text (a `free_tier_limit` envelope is safe, but an HTML
    // error page from a misconfigured proxy may echo the request URL with
    // query string). Redact body by default; surface `kind` + `status` so
    // operators can still classify the failure without raw text.
    const sanitizedError =
      event.error !== undefined
        ? {
            kind: event.error.kind,
            status: event.error.status,
          }
        : undefined
    return {
      backend: event.backend,
      message: event.message,
      recoverable: event.recoverable,
      ...(sanitizedError !== undefined ? { error: sanitizedError } : {}),
    }
  }
  if (event.type === 'task_end') return { status: event.status, reason: event.reason }
  if (event.type === 'text_delta' || event.type === 'reasoning_delta') return { text: event.text }
  return {}
}

/** @stable */
export interface RuntimeEventCollector<
  TState = unknown,
  TAction = unknown,
  TActionResult = unknown,
  TEval extends ControlEvalResult = ControlEvalResult,
> {
  onEvent: (event: AgentRuntimeEvent<TState, TAction, TActionResult, TEval>) => void
  events: Array<Record<string, unknown>>
}

/** @stable */
export type RuntimeStreamEventSink = (event: RuntimeStreamEvent) => void

/** @stable */
export interface RuntimeStreamEventSummary {
  /** Total count of sanitized events collected. */
  eventCount: number
  /** Count of events per `type`. Useful for log-line summaries. */
  eventCountsByType: Record<string, number>
  /** First session id observed in a `session_created` / `session_resumed` event, if any. */
  firstSessionId?: string
  /** Last `final` event's status, if a final event was observed. */
  finalStatus?: AgentTaskStatus
  /** Last `final` event's reason, if a final event was observed. */
  finalReason?: string
  /** Concatenated `text_delta.text` across the stream, even when payloads are redacted. */
  finalText: string
}

/** @stable */
export interface RuntimeStreamEventCollector {
  onEvent: RuntimeStreamEventSink
  events: Array<Record<string, unknown>>
  /** Snapshot of a small streaming-flavored summary derived from collected events. */
  summary(): RuntimeStreamEventSummary
}

/** @stable */
export function createRuntimeEventCollector<
  TState = unknown,
  TAction = unknown,
  TActionResult = unknown,
  TEval extends ControlEvalResult = ControlEvalResult,
>(
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

/**
 * @stable
 *
 * Streaming-event counterpart of `createRuntimeEventCollector`. Pass each
 * event yielded by `runAgentTaskStream` through `onEvent` and read the
 * sanitized copies off `events`; the same `RuntimeTelemetryOptions` redaction
 * flags apply. Kept distinct from `createRuntimeEventCollector` because the
 * stream and non-stream event shapes overlap on `type` literals — dispatching
 * on `type` alone would misroute events.
 */
export function createRuntimeStreamEventCollector(
  options: RuntimeTelemetryOptions = {},
): RuntimeStreamEventCollector {
  const events: Array<Record<string, unknown>> = []
  const eventCountsByType: Record<string, number> = {}
  let firstSessionId: string | undefined
  let finalStatus: AgentTaskStatus | undefined
  let finalReason: string | undefined
  let finalText = ''
  return {
    events,
    onEvent: (event) => {
      events.push(sanitizeRuntimeStreamEvent(event, options))
      eventCountsByType[event.type] = (eventCountsByType[event.type] ?? 0) + 1
      if (event.type === 'text_delta') finalText += event.text
      if (
        !firstSessionId &&
        (event.type === 'session_created' || event.type === 'session_resumed')
      ) {
        firstSessionId = event.session.id
      }
      if (event.type === 'final') {
        finalStatus = event.status
        finalReason = event.reason
      }
    },
    summary() {
      return {
        eventCount: events.length,
        eventCountsByType: { ...eventCountsByType },
        firstSessionId,
        finalStatus,
        finalReason,
        finalText,
      }
    },
  }
}
