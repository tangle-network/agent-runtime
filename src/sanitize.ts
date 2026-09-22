/**
 *
 * Sanitization for runtime telemetry. The rule: nothing user-controlled leaks
 * unless the caller opts in with a `RuntimeTelemetryOptions` flag. This is the
 * envelope that ends up in `agent_run.metadata.runtimeEvents` on every
 * consumer, so the default must be safe.
 *
 * @stable
 */

import type { ControlEvalResult, ControlRunResult, ControlStep } from '@tangle-network/agent-eval'
import type { RuntimeTelemetryOptions } from './sanitize-shared'
import {
  redactRecord,
  sanitizeAcquisitionPlan,
  sanitizeKnowledgeReadinessReport,
  sanitizeQuestion,
  sanitizeTask,
} from './sanitize-shared'
import type { AgentRuntimeEvent } from './types'

export {
  type RuntimeTelemetryOptions,
  type SanitizedKnowledgeReadinessReport,
  type SanitizedKnowledgeRequirement,
  sanitizeKnowledgeReadinessReport,
} from './sanitize-shared'
export {
  createRuntimeStreamEventCollector,
  type RuntimeStreamEventCollector,
  type RuntimeStreamEventSink,
  type RuntimeStreamEventSummary,
  sanitizeRuntimeStreamEvent,
} from './sanitize-stream'

/** Reduce an `AgentRuntimeEvent` to a PII-safe, serializable plain object for telemetry. @stable */
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

/** Build an in-memory collector that sanitizes and accumulates `AgentRuntimeEvent`s for inspection. @stable */
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
