/**
 *
 * The two top-level entry points:
 *
 *  - `runAgentTask` — single-shot lifecycle for adapter-driven tasks.
 *  - `runAgentTaskStream` — streaming lifecycle that delegates execution to an
 *    `AgentExecutionBackend` (model API, sandbox, or custom iterable).
 *
 * Both gate the run on `KnowledgeReadinessReport` from `agent-eval`, emit the
 * same lifecycle event vocabulary (under different shapes — see `types.ts`),
 * and route session lifecycle through a pluggable `RuntimeSessionStore`.
 *
 * @stable
 */

import {
  acquisitionPlansForKnowledgeGaps,
  blockingKnowledgeEval,
  type ControlContext,
  type ControlEvalResult,
  type ControlRunResult,
  type DataAcquisitionPlan,
  FAILURE_CLASSES,
  type FailureClass,
  type KnowledgeReadinessReport,
  type RunRecord,
  runAgentControlLoop,
  scoreKnowledgeReadiness,
  type UserQuestion,
  userQuestionsForKnowledgeGaps,
} from '@tangle-network/agent-eval'

const FAILURE_CLASS_SET = new Set<string>(FAILURE_CLASSES)

/** True when a free-form control failure string is a canonical taxonomy
 *  class — so only real taxonomy tags are promoted to the cross-agent
 *  `RunRecord.failureClass` key; novel strings stay as `failureMode` detail. */
function asFailureClass(value: string | undefined): FailureClass | undefined {
  return value && FAILURE_CLASS_SET.has(value) ? (value as FailureClass) : undefined
}

/** Stamp cross-cutting defaults onto adapter-projected RunRecords without
 *  overriding anything the adapter set explicitly:
 *   - `scenarioId` — the run's scenario, when the record omits one.
 *   - `failureClass` — the control layer's failure classification promoted
 *     onto the canonical cross-agent key, but ONLY when it's a real taxonomy
 *     class. This is what lets the substrate aggregate failures across every
 *     agent in one vocabulary instead of per-agent ad-hoc strings. */
export function applyRunRecordDefaults(
  records: RunRecord[],
  scenarioId: string,
  controlFailureClass: string | undefined,
): RunRecord[] {
  const fc = asFailureClass(controlFailureClass)
  return records.map((record) => {
    let r = record
    if (r.scenarioId === undefined) r = { ...r, scenarioId }
    if (r.failureClass === undefined && fc) r = { ...r, failureClass: fc }
    return r
  })
}

import { normalizeBackendStreamEvent } from './backends'
import { BackendTransportError, SessionMismatchError } from './errors'
import { decideKnowledgeReadiness } from './readiness'
import { newRuntimeSession, nowIso, touchSession } from './sessions'
import type {
  AgentBackendInput,
  AgentExecutionBackend,
  AgentKnowledgeProvider,
  AgentRuntimeEventSink,
  AgentTaskContext,
  AgentTaskRunResult,
  AgentTaskSpec,
  AgentTaskStatus,
  BackendErrorDetail,
  RunAgentTaskOptions,
  RunAgentTaskStreamOptions,
  RuntimeSession,
  RuntimeStreamEvent,
} from './types'

/**
 * Single-shot task lifecycle for adapter-driven tasks: readiness-gated, emits the runtime lifecycle event vocabulary, session-store pluggable.
 *
 * @stable
 */
export async function runAgentTask<
  TState,
  TAction,
  TActionResult,
  TEval extends ControlEvalResult = ControlEvalResult,
>(
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
  const preflight = await runKnowledgePreflight(
    task,
    questions,
    acquisitionPlans,
    options.knowledge,
    options.onEvent,
  )
  if (
    options.knowledge?.refreshReadiness &&
    (Object.keys(preflight.userAnswers).length > 0 || preflight.acquiredEvidenceIds.length > 0)
  ) {
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
  const scenarioId = options.scenarioId ?? task.id
  const control = await runAgentControlLoop<TState, TAction, TActionResult, TEval>({
    intent: task.intent,
    budget: task.budget,
    signal: options.signal,
    store: options.store,
    scenarioId,
    projectId: options.projectId,
    variantId: options.variantId,
    observe: ({ history, abortSignal }) =>
      options.adapter.observe({ task, knowledge, history, abortSignal }),
    validate: async ({ state, history, abortSignal }) => {
      const readinessEval = blockingKnowledgeEval(knowledge, {
        minimumScore: options.minimumReadinessScore,
      })
      const evals = await options.adapter.validate({
        task,
        knowledge,
        state,
        history,
        abortSignal,
      })
      return [readinessEval as TEval, ...evals]
    },
    decide: (ctx) => {
      if (isKnowledgeBlocked(ctx.evals)) {
        return (
          options.adapter.onKnowledgeBlocked?.({
            task,
            knowledge,
            questions,
            acquisitionPlans,
          }) ?? {
            type: 'stop',
            pass: false,
            score: knowledge.readinessScore,
            reason: `knowledge readiness blocked: ${knowledge.reason}`,
          }
        )
      }
      return options.adapter.decide(toAgentContext(task, knowledge, ctx))
    },
    act: (action, ctx) => options.adapter.act(action, toAgentContext(task, knowledge, ctx)),
    shouldStop: options.adapter.shouldStop
      ? (ctx) => options.adapter.shouldStop!(toAgentContext(task, knowledge, ctx))
      : undefined,
    getActionCostUsd: options.adapter.getActionCostUsd
      ? ({ action, result, state, evals, history }) =>
          options.adapter.getActionCostUsd!({ action, result, task, state, evals, history })
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
    runRecords: applyRunRecordDefaults(
      options.adapter.projectRunRecords?.(control, task) ?? [],
      scenarioId,
      control.failureClass,
    ),
  }
}

/**
 * Streaming task lifecycle: delegates execution to an `AgentExecutionBackend` (model API, sandbox, or custom iterable) and yields lifecycle events as they happen.
 *
 * @stable
 */
export async function* runAgentTaskStream<TInput extends AgentBackendInput = AgentBackendInput>(
  options: RunAgentTaskStreamOptions<TInput>,
): AsyncIterable<RuntimeStreamEvent> {
  const task = options.task
  const input = { task, ...(options.input ?? {}) } as TInput
  yield streamEvent({ type: 'task_start', task })

  yield streamEvent({ type: 'readiness_start', task })
  let knowledge = await buildReadiness(task, options.knowledge)
  const questions = userQuestionsForKnowledgeGaps(knowledge.blockingMissingRequirements)
  const acquisitionPlans = acquisitionPlansForKnowledgeGaps([
    ...knowledge.blockingMissingRequirements,
    ...knowledge.nonBlockingGaps,
  ])
  const preflight = await runKnowledgePreflightStream(
    task,
    questions,
    acquisitionPlans,
    options.knowledge,
  )
  for (const event of preflight.events) yield event
  if (
    options.knowledge?.refreshReadiness &&
    (Object.keys(preflight.userAnswers).length > 0 || preflight.acquiredEvidenceIds.length > 0)
  ) {
    yield streamEvent({ type: 'readiness_start', task })
    knowledge = await options.knowledge.refreshReadiness({
      task,
      previous: knowledge,
      userAnswers: preflight.userAnswers,
      acquiredEvidenceIds: preflight.acquiredEvidenceIds,
    })
  }
  const decision = decideKnowledgeReadiness(knowledge, {
    minimumScore: options.minimumReadinessScore,
  })
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
  let session =
    shouldResume && existing
      ? await resumeBackendSession(options.backend, existing, input, {
          task,
          knowledge,
          signal: options.signal,
        })
      : await startBackendSession(
          options.backend,
          input,
          { task, knowledge, signal: options.signal },
          options.sessionId,
        )
  await store?.put(session)
  const sessionEvent = streamEvent({
    type: shouldResume ? 'session_resumed' : 'session_created',
    task,
    session,
  })
  await store?.appendEvent?.(session.id, sessionEvent)
  yield sessionEvent

  const backendStart = streamEvent({
    type: 'backend_start',
    task,
    session,
    backend: options.backend.kind,
  })
  await store?.appendEvent?.(session.id, backendStart)
  yield backendStart

  let finalText = ''
  try {
    for await (const rawEvent of options.backend.stream(input, {
      task,
      knowledge,
      session,
      signal: options.signal,
    })) {
      const event = normalizeBackendStreamEvent(rawEvent, task, session)
      if (event.type === 'text_delta') finalText += event.text
      await store?.appendEvent?.(session.id, event)
      yield event
    }
    const completedStatus: AgentTaskStatus = 'completed'
    session = touchSession({ ...session, status: completedStatus })
    await store?.put(session)
    const backendEnd = streamEvent({
      type: 'backend_end',
      task,
      session,
      backend: options.backend.kind,
    })
    await store?.appendEvent?.(session.id, backendEnd)
    yield backendEnd
    const reason = 'backend completed'
    const taskEnd = streamEvent({ type: 'task_end', task, status: completedStatus, reason })
    await store?.appendEvent?.(session.id, taskEnd)
    yield taskEnd
    const final = streamEvent({
      type: 'final',
      task,
      session,
      status: completedStatus,
      reason,
      text: finalText || undefined,
    })
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
    const combinedMessage = stopErrorMessage
      ? `${message}; backend stop failed: ${stopErrorMessage}`
      : message
    // Typed transport detail — preserves status code + truncated body so
    // consumers can map onto `RunRecord.error` without re-parsing the log
    // string. Required by the runtime's fail-loud contract: silent empty
    // output for a 402 / 401 / 5xx hides the real failure mode.
    const errorDetail: BackendErrorDetail =
      err instanceof BackendTransportError
        ? {
            kind: 'transport',
            message: combinedMessage,
            status: err.status,
            body: err.body,
          }
        : { kind: 'backend', message: combinedMessage }
    const backendError = streamEvent({
      type: 'backend_error',
      task,
      session,
      backend: options.backend.kind,
      message: combinedMessage,
      recoverable: !options.signal?.aborted,
      error: errorDetail,
    })
    await store?.appendEvent?.(session.id, backendError)
    yield backendError
    const status: AgentTaskStatus = options.signal?.aborted ? 'aborted' : 'failed'
    const taskEnd = streamEvent({ type: 'task_end', task, status, reason: message })
    await store?.appendEvent?.(session.id, taskEnd)
    yield taskEnd
    const final = streamEvent({
      type: 'final',
      task,
      session,
      status,
      reason: message,
      text: finalText || undefined,
      error: errorDetail,
    })
    await store?.appendEvent?.(session.id, final)
    yield final
  }
}

async function runKnowledgePreflight<
  TState,
  TAction,
  TActionResult,
  TEval extends ControlEvalResult,
>(
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
    await emit(onEvent, {
      type: 'acquisition_end',
      task,
      acquisitionPlans,
      acquiredEvidenceIds,
    })
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
    events.push(
      streamEvent({ type: 'acquisition_end', task, acquisitionPlans, acquiredEvidenceIds }),
    )
  }
  return { userAnswers, acquiredEvidenceIds, events }
}

function streamEvent<T extends Omit<RuntimeStreamEvent, 'timestamp'>>(
  event: T,
): T & { timestamp: string } {
  return { ...event, timestamp: nowIso() }
}

async function startBackendSession<TInput extends AgentBackendInput>(
  backend: AgentExecutionBackend<TInput>,
  input: TInput,
  context: { task: AgentTaskSpec; knowledge: KnowledgeReadinessReport; signal?: AbortSignal },
  requestedSessionId?: string,
): Promise<RuntimeSession> {
  if (backend.start) return backend.start(input, { ...context, requestedSessionId })
  return newRuntimeSession(backend.kind, requestedSessionId)
}

async function resumeBackendSession<TInput extends AgentBackendInput>(
  backend: AgentExecutionBackend<TInput>,
  session: RuntimeSession,
  input: TInput,
  context: { task: AgentTaskSpec; knowledge: KnowledgeReadinessReport; signal?: AbortSignal },
): Promise<RuntimeSession> {
  if (session.backend !== backend.kind) {
    throw new SessionMismatchError(session.backend, backend.kind)
  }
  if (backend.resume) return backend.resume(session, input, context)
  return touchSession({ ...session, status: 'active' })
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

function statusFromControl(
  control: ControlRunResult<unknown, unknown, unknown, ControlEvalResult>,
): AgentTaskStatus {
  if (control.stoppedBy === 'abort') return 'aborted'
  if (control.reason.includes('knowledge readiness blocked')) return 'blocked'
  if (control.pass) return 'completed'
  return 'failed'
}

async function emit<TState, TAction, TActionResult, TEval extends ControlEvalResult>(
  sink: AgentRuntimeEventSink<TState, TAction, TActionResult, TEval> | undefined,
  event: Parameters<AgentRuntimeEventSink<TState, TAction, TActionResult, TEval>>[0],
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
