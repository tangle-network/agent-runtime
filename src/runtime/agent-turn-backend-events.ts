import { scoreKnowledgeReadiness } from '@tangle-network/agent-eval'
import type { HarnessType } from '@tangle-network/agent-interface'
import type { AgentTurnInput } from '@tangle-network/agent-interface/environment-provider'
import type { PromptOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { type AgentRunOutcome, createAgentRunOutcomeTracker } from '@tangle-network/sandbox/runtime'
import { normalizeBackendStreamEvent } from '../backends'
import { ValidationError } from '../errors'
import { newRuntimeSession, nowIso } from '../sessions'
import type {
  AgentBackendInput,
  AgentExecutionBackend,
  AgentTaskSpec,
  AgentTaskStatus,
  BackendErrorDetail,
  RuntimeSession,
  RuntimeStreamEvent,
} from '../types'
import type { RuntimeFailureCause } from './failure-cause'
import { awaitAbortable } from './retained-run-binding'
import { createSandboxUsageLedger } from './sandbox-events'
import {
  createSandboxToolPartState,
  mapSandboxEvent,
  mapSandboxToolEvent,
  terminalTextFromSandboxEvent,
} from './sandbox-executor-output'
import { projectSandboxOutcome, readSandboxOutcome } from './sandbox-outcome'
import { canonicalStreamEventFromSandboxEvent } from './sandbox-transport-events'
import type { AgentTurnBackend } from './stream-agent-turn'
import { armDeadlineTimer } from './supervise/deadline'
import type { Executor, ExecutorProgressEvent, ExecutorResult, UsageEvent } from './supervise/types'
import { promptFromAgentTurnInput, promptOptionsFromAgentTurnInput } from './turn-input'
import { isAsyncIterable } from './util'

/** Lower-level observation adapters. They normalize an already-created execution surface but do
 * not bind an AgentProfile to it, so they are deliberately absent from the public kernel export. */
export type ObservedAgentTurnBackend =
  | {
      /** A live sandbox box: the turn is one `box.streamPrompt(prompt)` call. */
      kind: 'box'
      box: SandboxInstance
      /**
       * Per-turn `PromptOptions` forwarded verbatim to `streamPrompt`
       * (`sessionId`, `turnId`, `model`, `backend` profile, `timeoutMs`, …).
       * The turn's derived abort signal (caller `signal` + `timeoutMs`
       * deadline) is always installed as `signal` — pass cancellation through
       * `StreamAgentTurnOptions`, not here.
       */
      options?: Omit<PromptOptions, 'signal'>
      /** Model label stamped on cost-only `llm_call` events. Default `'agent'`. */
      agentRunName?: string
    }
  | {
      /**
       * A caller-supplied in-process `AgentExecutionBackend`: the turn is one
       * `backend.stream()` call.
       */
      kind: 'chat'
      backend: AgentExecutionBackend
    }

function turnBackendInput(task: AgentTaskSpec, input: AgentTurnInput): AgentBackendInput {
  return {
    task,
    ...(input.prompt === undefined ? {} : { message: input.prompt }),
    ...(input.parts === undefined ? {} : { parts: structuredClone(input.parts) }),
    ...(input.interactions === undefined ? {} : { interactions: input.interactions }),
    ...(input.providerOptions === undefined
      ? {}
      : { providerOptions: structuredClone(input.providerOptions) }),
  }
}

/** Mutable per-turn accumulator threaded through the backend adapters. */
export interface TurnAccumulator {
  /** Concatenated incremental text (`text_delta` events). */
  deltaText: string
  /** Final text read off a terminal `result`/`done`/`final` event, when the
   *  backend emitted one. Preferred over `deltaText` for box streams, whose
   *  `message.part.updated` fallback carries running accumulations. */
  terminalText?: string
  input: number
  output: number
  costUsd: number
  estimatedCostUsd: number
  sawEstimatedCost: boolean
  promptCache: Record<string, number | string>
  reasoningTokens?: number
  tokensKnown: boolean
  usdKnown: boolean
  sawLlmCall: boolean
  sawTokenUsage: boolean
  sawCostUsage: boolean
  model?: string
  stopReason?: string
  transportAttempts?: number
  result?: ExecutorResult<unknown>
  sandboxOutcome?: AgentRunOutcome
}

export function assertTurnTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs === undefined) return
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(Date.now() + timeoutMs)
  ) {
    throw new ValidationError(
      'streamAgentTurn: timeoutMs must be a positive safe integer with a safe deadline',
    )
  }
}

/** Start the backend's session when it owns one (`chat` kind); mint a local
 *  correlation session otherwise. Box/executor turns carry no server session
 *  here — resume lives in `openSandboxRun`/`SandboxLineage`, not this primitive. */
export async function startTurnSession(
  backend: AgentTurnBackend | ObservedAgentTurnBackend,
  task: AgentTaskSpec,
  input: AgentTurnInput,
  signal: AbortSignal,
  label: string,
): Promise<RuntimeSession> {
  if (backend.kind === 'chat' && backend.backend.start) {
    return backend.backend.start(turnBackendInput(task, input), {
      task,
      knowledge: emptyReadiness(task),
      signal,
    })
  }
  return newRuntimeSession(label)
}

/** Box-drive configuration derived from the backend kind + turn options. */
interface BoxTurnConfig {
  /** Caller `PromptOptions` forwarded to `streamPrompt`; the turn's derived
   *  signal is installed over any caller value. */
  options?: Omit<PromptOptions, 'signal'>
  /** Project tool parts to `tool_call`/`tool_result` (see `mapSandboxToolEvent`). */
  preserveToolParts: boolean
  /** Awaited raw-event tap, before projection. */
  onRawEvent?: (event: SandboxEvent) => void | Promise<void>
  /** The profile's harness, so a harness that reports usage only in its own event is metered. */
  harness?: HarnessType
}

/**
 * One turn over a box: `box.streamPrompt` projected through the existing
 * `mapSandboxEvent` (text/reasoning deltas +
 * cost-bearing `llm_call`s), plus the opt-in `mapSandboxToolEvent` tool-part
 * projection. Final text prefers the terminal
 * `result`/`done`/`final` payload over concatenated deltas, because the
 * sandbox `message.part.updated` fallback may carry running accumulations.
 *
 * Usage rides ONE {@link SandboxUsageLedger} for the turn — the same accounting the leaf kernel,
 * the steerable session, and `sumSandboxUsage` use — so a harness that reports its tokens only
 * inside its own event is metered here too, and a turn reporting both sources is charged once.
 * The ledger settles when the stream ends AND on the error path, because a turn that failed
 * mid-stream still spent what the harness already reported.
 */
export async function* driveBoxTurn(
  box: SandboxInstance,
  input: AgentTurnInput,
  signal: AbortSignal,
  agentRunName: string,
  acc: TurnAccumulator,
  cfg: BoxTurnConfig,
): AsyncGenerator<RuntimeStreamEvent> {
  const callOptions: PromptOptions = { ...(cfg.options ?? {}), signal }
  const stream = box.streamPrompt(promptFromAgentTurnInput(input), {
    ...callOptions,
    ...promptOptionsFromAgentTurnInput(input),
    signal,
  })
  const toolParts = cfg.preserveToolParts ? createSandboxToolPartState() : undefined
  const outcomeTracker = createAgentRunOutcomeTracker()
  const usageLedger = createSandboxUsageLedger(cfg.harness)
  try {
    for await (const event of abortableValues(stream, signal)) {
      outcomeTracker.observe(event)
      if (cfg.onRawEvent) {
        await awaitAbortable(
          Promise.resolve().then(() => cfg.onRawEvent!(event)),
          signal,
        )
      }
      const terminalText = terminalTextFromSandboxEvent(event)
      if (terminalText !== undefined) acc.terminalText = terminalText
      // Read usage BEFORE the canonical short-circuit: a harness-native receipt rides a transport
      // type the canonical decoder answers for, and a `continue` past it would lose the turn.
      // `mapSandboxEvent` re-derives the SAME canonical call below, so only this fold runs.
      const call = usageLedger.observe(event, agentRunName)
      if (call) foldEvent(call, acc, agentRunName)
      const canonical = canonicalStreamEventFromSandboxEvent(event)
      if (canonical) {
        yield canonical
        continue
      }

      if (toolParts) {
        for (const toolEvent of mapSandboxToolEvent(event, toolParts)) {
          yield toolEvent
        }
      }
      const mapped = mapSandboxEvent(event, { agentRunName })
      if (mapped) {
        // `mapSandboxEvent` stamps `agentRunName` as the model label when the
        // event carried none — a run label, not a reported model. Exclude it from
        // the terminal usage so `usage.model` is never a fabricated value.
        if (mapped.type !== 'llm_call') foldEvent(mapped, acc, agentRunName)
        yield mapped
      }

      // Unknown provider events stay available through onRawEvent. Do not copy
      // arbitrary provider payloads into the public stream.
    }
  } catch (err) {
    const aborted = usageLedger.settleTurn(agentRunName)
    if (aborted) {
      foldEvent(aborted, acc, agentRunName)
      yield aborted
    }
    throw err
  }
  const settled = usageLedger.settleTurn(agentRunName)
  if (settled) {
    foldEvent(settled, acc, agentRunName)
    yield settled
  }
  acc.sandboxOutcome = outcomeTracker.finish()
  const projection = projectSandboxOutcome(acc.sandboxOutcome)
  if (projection.status === 'failed') {
    throw new Error(projection.reason)
  }
}

/** One turn over an in-process backend: its own `stream()` surface, projected
 *  through the same `normalizeBackendStreamEvent` the task lifecycle applies. */
export async function* driveChatTurn(
  backend: AgentExecutionBackend,
  task: AgentTaskSpec,
  session: RuntimeSession,
  input: AgentTurnInput,
  signal: AbortSignal,
  acc: TurnAccumulator,
): AsyncGenerator<RuntimeStreamEvent> {
  const backendInput = turnBackendInput(task, input)
  const context = { task, knowledge: emptyReadiness(task), session, signal }
  for await (const raw of abortableValues(backend.stream(backendInput, context), signal)) {
    const event = normalizeBackendStreamEvent(raw, task, session)
    foldEvent(event, acc)
    yield event
  }
}

export async function* driveExecutorTurn(
  executor: Executor<unknown>,
  task: AgentTaskSpec,
  session: RuntimeSession,
  input: AgentTurnInput,
  signal: AbortSignal,
  acc: TurnAccumulator,
  declaredModel: string | undefined,
): AsyncGenerator<RuntimeStreamEvent> {
  const taskValue = executorTaskValue(input)
  const run = executor.execute(taskValue, signal)
  let result: ExecutorResult<unknown>
  if (isAsyncIterable<UsageEvent>(run)) {
    for await (const usage of abortableValues(run, signal)) {
      if (usage.kind === 'progress') {
        // A wait on the exact result is node state for the journal and the keeper; the public
        // turn vocabulary has no event for it, so the turn's stream carries nothing.
        if (usage.progress.kind === 'awaiting-result') continue
        const projected = executorProgressStreamEvent(usage.progress, task, session)
        foldEvent(projected, acc)
        yield projected
        throwIfAborted(signal)
        continue
      }
      foldUsageEvent(usage, acc)
      throwIfAborted(signal)
    }
    result = executor.resultArtifact()
  } else {
    result = await awaitAbortable(run, signal)
  }
  acc.result = result
  acc.sandboxOutcome = readSandboxOutcome(result.out)
  acc.terminalText = executorResultText(result.out)
  acc.input = result.spent.tokens.input
  acc.output = result.spent.tokens.output
  acc.costUsd = result.spent.usd
  const estimatedCostUsd = executorResultEstimatedCost(result.out)
  if (estimatedCostUsd !== undefined) {
    acc.estimatedCostUsd = estimatedCostUsd
    acc.sawEstimatedCost = true
  }
  Object.assign(acc.promptCache, executorResultPromptCache(result.out))
  acc.reasoningTokens = executorResultReasoningTokens(result.out)
  acc.tokensKnown = result.spent.tokensKnown !== false
  acc.usdKnown = result.spent.usdKnown !== false
  acc.sawLlmCall = true

  // Usage model identity is observational: the executor must report what answered. The profile's
  // declared model remains available in materialization evidence, but it is not fabricated into
  // `usage.model` when the provider/transport omitted an actual response model.
  const model = executorResultModel(result.out)
  if (model) acc.model = model
  acc.stopReason = executorResultStopReason(result.out)
  acc.transportAttempts = executorResultTransportAttempts(result.out)
  const latencyMs = result.spent.ms
  yield {
    type: 'llm_call',
    task,
    session,
    model: model ?? declaredModel ?? executor.runtime,
    ...(acc.tokensKnown ? { tokensIn: acc.input, tokensOut: acc.output } : {}),
    ...(acc.usdKnown ? { costUsd: acc.costUsd } : {}),
    ...(acc.tokensKnown ? {} : { tokensKnown: false }),
    ...(acc.usdKnown ? {} : { usdKnown: false }),
    ...(acc.sawEstimatedCost ? { estimatedCostUsd: acc.estimatedCostUsd } : {}),
    ...(Object.keys(acc.promptCache).length > 0 ? { promptCache: acc.promptCache } : {}),
    latencyMs,
    timestamp: nowIso(),
  }
  for (const call of executorResultToolCalls(result.out)) {
    yield {
      type: 'tool_call',
      task,
      session,
      toolName: call.name,
      ...(call.id ? { toolCallId: call.id } : {}),
      args: call.arguments,
      timestamp: nowIso(),
    }
  }
  yield {
    type: 'artifact',
    task,
    session,
    artifactId: result.outRef,
    name: 'agent-turn-result',
    metadata: {
      spend: result.spent,
      ...(result.verdict ? { verdict: result.verdict } : {}),
    },
    timestamp: nowIso(),
  }
  if (acc.sandboxOutcome && projectSandboxOutcome(acc.sandboxOutcome).status === 'failed') {
    throw new Error(projectSandboxOutcome(acc.sandboxOutcome).reason)
  }
}

function executorTaskValue(input: AgentTurnInput): unknown {
  const messages = input.providerOptions?.messages
  if (Array.isArray(messages)) {
    return { messages: structuredClone(messages) }
  }
  return {
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    ...(input.parts === undefined ? {} : { parts: structuredClone(input.parts) }),
    ...(input.interactions === undefined ? {} : { interactions: input.interactions }),
  }
}

/**
 * Pull one provider iterator under Runtime's deadline.
 *
 * Providers still receive the signal for native cancellation, but correctness
 * does not depend on them observing it. A losing iterator is asked to close;
 * its late rejection is observed and cannot delay the terminal Runtime event.
 */
export async function* abortableValues<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]()
  let completed = false
  try {
    for (;;) {
      const next = await awaitAbortable(
        Promise.resolve().then(() => iterator.next()),
        signal,
      )
      if (next.done) {
        completed = true
        return
      }
      yield next.value
    }
  } finally {
    if (!completed) {
      try {
        void Promise.resolve(iterator.return?.()).catch(() => undefined)
      } catch {
        // The Runtime deadline already owns the observable terminal result.
      }
    }
  }
}

function executorResultText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const content = (value as Record<string, unknown>).content
  return typeof content === 'string' ? content : ''
}

function executorResultModel(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const model = (value as Record<string, unknown>).model
  return typeof model === 'string' && model.length > 0 ? model : undefined
}

function executorResultStopReason(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const reason = (value as Record<string, unknown>).finishReason
  return typeof reason === 'string' && reason.length > 0 ? reason : undefined
}

function executorResultTransportAttempts(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const attempts = (value as Record<string, unknown>).transportAttempts
  return typeof attempts === 'number' && Number.isSafeInteger(attempts) && attempts > 0
    ? attempts
    : undefined
}

function executorResultEstimatedCost(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  return finiteNumber((value as Record<string, unknown>).estimatedCostUsd)
}

function executorResultPromptCache(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== 'object') return {}
  const raw = (value as Record<string, unknown>).promptCache
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const cache: Record<string, number | string> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if ((typeof entry === 'number' && Number.isFinite(entry)) || typeof entry === 'string') {
      cache[key] = entry
    }
  }
  return cache
}

function executorResultReasoningTokens(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const count = (value as Record<string, unknown>).reasoningTokens
  return Number.isSafeInteger(count) && (count as number) >= 0 ? (count as number) : undefined
}

/**
 * Read the terminal tool calls an executor artifact published. Every Runtime-owned executor
 * reports `ExecutorToolCall[]`, so an artifact carrying any other shape is a defect in that
 * executor rather than a turn without tool calls: refuse it instead of dropping the calls.
 */
function executorResultToolCalls(
  value: unknown,
): Array<{ id?: string; name: string; arguments: string }> {
  if (!value || typeof value !== 'object') return []
  const raw = (value as Record<string, unknown>).toolCalls
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    throw new ValidationError(
      `streamAgentTurn: executor artifact toolCalls must be an ExecutorToolCall array, received ${typeof raw}`,
    )
  }
  return raw.map((entry) => {
    const call = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined
    if (!call || typeof call.name !== 'string' || call.name.length === 0) {
      throw new ValidationError(
        'streamAgentTurn: executor artifact toolCalls entries require a non-empty name',
      )
    }
    return {
      ...(typeof call.id === 'string' ? { id: call.id } : {}),
      name: call.name,
      arguments:
        typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
    }
  })
}

/** Project one executor progress event onto the public turn vocabulary. */
function executorProgressStreamEvent(
  progress: Exclude<ExecutorProgressEvent, { kind: 'awaiting-result' }>,
  task: AgentTaskSpec,
  session: RuntimeSession,
): RuntimeStreamEvent {
  const timestamp = nowIso()
  if (progress.kind === 'text_delta') {
    return { type: 'text_delta', task, session, text: progress.text, timestamp }
  }
  if (progress.kind === 'reasoning_delta') {
    return { type: 'reasoning_delta', task, session, text: progress.text, timestamp }
  }
  if (progress.kind === 'tool_call') {
    return {
      type: 'tool_call',
      task,
      session,
      toolName: progress.toolName,
      ...(progress.toolCallId === undefined ? {} : { toolCallId: progress.toolCallId }),
      ...(progress.args === undefined ? {} : { args: progress.args }),
      timestamp,
    }
  }
  if (progress.kind === 'tool_result') {
    return {
      type: 'tool_result',
      task,
      session,
      toolName: progress.toolName,
      ...(progress.toolCallId === undefined ? {} : { toolCallId: progress.toolCallId }),
      ...(progress.result === undefined ? {} : { result: progress.result }),
      timestamp,
    }
  }
  if (progress.kind === 'child_task') {
    return { ...progress.event, task, session, timestamp }
  }
  return { type: 'interaction', request: progress.request, task, session, timestamp }
}

/** Fold one normalized executor usage event into the turn accumulator. */
function foldUsageEvent(event: UsageEvent, acc: TurnAccumulator): void {
  if (event.kind === 'tokens') {
    const known = event.tokensKnown !== false
    acc.tokensKnown = acc.sawTokenUsage ? acc.tokensKnown && known : known
    acc.sawTokenUsage = true
    if (event.mode === 'cumulative') {
      if (event.input < acc.input || event.output < acc.output) {
        throw new ValidationError('cumulative executor tokens must not decrease')
      }
      acc.input = event.input
      acc.output = event.output
    } else {
      acc.input += event.input
      acc.output += event.output
    }
  } else if (event.kind === 'cost') {
    const known = event.usdKnown
    acc.usdKnown = acc.sawCostUsage ? acc.usdKnown && known : known
    acc.sawCostUsage = true
    acc.costUsd += event.usd
    if (event.usdKnown === false && event.usdEstimated !== undefined) {
      acc.estimatedCostUsd += event.usdEstimated
      acc.sawEstimatedCost = true
    }
  }
  if (event.kind === 'tokens' || event.kind === 'cost') acc.sawLlmCall = true
}

/** Fold one normalized event into the turn accumulator (text + usage).
 *  `fallbackModelLabel` — a mapper-stamped run label to exclude from
 *  `usage.model` (it is not a backend-reported model). */
function foldEvent(
  event: RuntimeStreamEvent,
  acc: TurnAccumulator,
  fallbackModelLabel?: string,
): void {
  if (event.type === 'text_delta') {
    acc.deltaText += event.text
    return
  }
  if (event.type === 'llm_call') {
    const tokensReported =
      event.tokensKnown !== false && event.tokensIn !== undefined && event.tokensOut !== undefined
    const usdReported = event.usdKnown !== false && event.costUsd !== undefined
    if (!acc.sawLlmCall) {
      acc.tokensKnown = tokensReported
      acc.usdKnown = usdReported
      acc.sawLlmCall = true
    } else {
      acc.tokensKnown &&= tokensReported
      acc.usdKnown &&= usdReported
    }
    acc.input += event.tokensIn ?? 0
    acc.output += event.tokensOut ?? 0
    acc.costUsd += event.costUsd ?? 0
    if (event.estimatedCostUsd !== undefined) {
      acc.estimatedCostUsd += event.estimatedCostUsd
      acc.sawEstimatedCost = true
    }
    if (event.promptCache) Object.assign(acc.promptCache, event.promptCache)
    if (event.model && event.model !== fallbackModelLabel) acc.model = event.model
  }
}

export function buildFinalEvent(
  task: AgentTaskSpec,
  session: RuntimeSession | undefined,
  acc: TurnAccumulator,
  outcome: {
    status: AgentTaskStatus
    reason: string
    error?: BackendErrorDetail
    failure?: RuntimeFailureCause
  },
  provenance: Record<string, unknown>,
): RuntimeStreamEvent {
  const finalText = acc.terminalText ?? acc.deltaText
  return {
    type: 'final',
    task,
    ...(session ? { session } : {}),
    status: outcome.status,
    reason: outcome.status === 'completed' ? (acc.stopReason ?? outcome.reason) : outcome.reason,
    ...(finalText ? { text: finalText } : {}),
    metadata: {
      tokenUsage: { input: acc.input, output: acc.output },
      ...(acc.tokensKnown ? {} : { tokensKnown: false }),
      ...(acc.usdKnown ? { costUsd: acc.costUsd } : { usdKnown: false }),
      ...(acc.sawEstimatedCost ? { estimatedCostUsd: acc.estimatedCostUsd } : {}),
      ...(Object.keys(acc.promptCache).length > 0 ? { promptCache: acc.promptCache } : {}),
      ...(acc.reasoningTokens !== undefined ? { reasoningTokens: acc.reasoningTokens } : {}),
      ...(acc.model ? { model: acc.model } : {}),
      ...(acc.stopReason ? { stopReason: acc.stopReason } : {}),
      ...(acc.transportAttempts !== undefined ? { transportAttempts: acc.transportAttempts } : {}),
      ...(acc.sandboxOutcome
        ? {
            sandboxOutcome: acc.sandboxOutcome,
            verdict: projectSandboxOutcome(acc.sandboxOutcome).verdict,
          }
        : {}),
      ...(acc.result
        ? {
            result: {
              outRef: acc.result.outRef,
              output: acc.result.out,
              ...(acc.sandboxOutcome
                ? { verdict: projectSandboxOutcome(acc.sandboxOutcome).verdict }
                : acc.result.verdict
                  ? { verdict: acc.result.verdict }
                  : {}),
              spent: acc.result.spent,
            },
          }
        : acc.sandboxOutcome
          ? { result: { verdict: projectSandboxOutcome(acc.sandboxOutcome).verdict } }
          : {}),
      ...provenance,
    },
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.failure ? { failure: outcome.failure } : {}),
    timestamp: nowIso(),
  }
}

/** Minimal ready-by-construction readiness report for a requirement-free turn. */
function emptyReadiness(task: AgentTaskSpec) {
  return scoreKnowledgeReadiness({ taskId: task.id, requirements: [] })
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))
}

/**
 * Derive the turn's effective abort signal: fires when EITHER the caller's
 * signal aborts OR the `timeoutMs` deadline elapses. `dispose()` clears the
 * timer so a finished turn never leaks a pending timeout. `timeoutMs <= 0`
 * disables the deadline. Node-portable (no `AbortSignal.any`, which needs
 * >=20.3 — the package floor is >=20).
 */
export function deriveTurnSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const clearTimer =
    timeoutMs > 0
      ? armDeadlineTimer(timeoutMs, () =>
          controller.abort(new Error(`agent turn timed out after ${timeoutMs}ms`)),
        )
      : undefined
  const onCallerAbort = () =>
    controller.abort(callerSignal?.reason ?? new Error('agent turn aborted'))
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort()
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimer?.()
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}
