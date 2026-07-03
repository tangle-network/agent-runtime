/**
 * `streamAgentTurn` — the ONE run-a-turn event-stream contract over every
 * execution substrate: a sandbox box (`SandboxInstance.streamPrompt`), a
 * one-shot `Executor` (cli-bridge / router / BYO, via `ExecutorFactory`), and
 * an in-process `AgentExecutionBackend` (the `resolveAgentBackend` output).
 *
 * One function, one vocabulary: every backend kind yields the existing
 * `RuntimeStreamEvent` union incrementally and ALWAYS terminates with a
 * `final` event whose `text` is the turn's final text and whose
 * `metadata.tokenUsage` / `metadata.costUsd` / `metadata.model` carry the
 * turn's metered usage. `collectAgentTurn` drains a stream into that terminal
 * summary plus the full event list.
 *
 * This is a UNIFICATION seam, not a new stream parser — each kind is a thin
 * adapter over code that already exists and is already hardened:
 *   - `box`      — `mapSandboxEvent` + `extractLlmCallEvent` (sandbox-events.ts)
 *                  project the sandbox event stream; nothing is re-mapped here.
 *   - `executor` — `inlineSandboxClient` (the ONE executor→box adapter) turns
 *                  the factory into a box, then the box path drives it. The
 *                  executor's settle/teardown lifecycle stays in that adapter.
 *   - `chat`     — the backend's own `stream()` surface, normalized by
 *                  `normalizeBackendStreamEvent` (the same projection
 *                  `runAgentTaskStream` applies).
 *
 * Distinct from `openSandboxRun` (box-only, session resume over one persistent
 * artifact, raw `SandboxEvent` deliverables) and from `runAgentTaskStream`
 * (full task lifecycle: knowledge preflight, session store, resume). This is
 * the minimal turn primitive underneath both worlds: prompt in, one normalized
 * event stream out, terminal result+usage guaranteed on every non-thrown path.
 *
 * Stream envelope: `backend_start` → incremental events → (`backend_error` on
 * failure) → `final`. A caller-initiated abort terminates with
 * `final.status: 'aborted'`; an expired `timeoutMs` deadline with
 * `final.status: 'failed'` — so cancellation stays distinguishable from a
 * blown deadline.
 *
 * @experimental
 */

import { scoreKnowledgeReadiness } from '@tangle-network/agent-eval'
import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { normalizeBackendStreamEvent } from '../backends'
import { BackendTransportError } from '../errors'
import { newRuntimeSession, nowIso } from '../sessions'
import type {
  AgentExecutionBackend,
  AgentTaskSpec,
  AgentTaskStatus,
  BackendErrorDetail,
  RuntimeSession,
  RuntimeStreamEvent,
} from '../types'
import { inlineSandboxClient } from './inline-sandbox-client'
import { mapSandboxEvent } from './sandbox-events'
import type { ExecutorFactory } from './supervise/types'

/**
 * The execution substrate one turn runs on — a closed discriminated union over
 * the three stream surfaces the runtime already owns.
 *
 * @experimental
 */
export type AgentTurnBackend =
  | {
      /** A live sandbox box: the turn is one `box.streamPrompt(prompt)` call. */
      kind: 'box'
      box: SandboxInstance
      /** Model label stamped on cost-only `llm_call` events. Default `'agent'`. */
      agentRunName?: string
    }
  | {
      /**
       * A one-shot `Executor` (cli-bridge / router / BYO): the factory is
       * instantiated fresh for the turn via `inlineSandboxClient`, run once on
       * the prompt, and torn down — the same per-spawn lifecycle the supervise
       * runtime gives it.
       */
      kind: 'executor'
      factory: ExecutorFactory<unknown>
      /** Model label stamped on cost-only `llm_call` events. Default `'agent'`. */
      agentRunName?: string
    }
  | {
      /**
       * An in-process `AgentExecutionBackend` (`resolveAgentBackend` output or
       * any custom backend): the turn is one `backend.stream()` call.
       */
      kind: 'chat'
      backend: AgentExecutionBackend
    }

/** @experimental */
export interface StreamAgentTurnOptions {
  /** Caller-initiated cancellation. Terminates the stream with `final.status: 'aborted'`. */
  signal?: AbortSignal
  /**
   * Wall-clock deadline for the whole turn in ms. An expired deadline aborts
   * the backend and terminates the stream with `final.status: 'failed'`
   * (a blown deadline is a turn failure, not a caller cancellation).
   */
  timeoutMs?: number
}

/**
 * Metered usage of one turn, summed over every cost-bearing event the backend
 * emitted. `input`/`output` are token counts (0 when the backend reported
 * none — the honest sum, never a fabricated estimate). `costUsd`/`model` are
 * present only when the backend actually reported them.
 *
 * @experimental
 */
export interface AgentTurnUsage {
  input: number
  output: number
  costUsd?: number
  model?: string
}

/**
 * A drained turn: the terminal summary plus every event the stream yielded.
 * `status`/`error` mirror the terminal `final` event so a failed or aborted
 * turn stays inspectable without re-scanning `events`.
 *
 * @experimental
 */
export interface CollectedAgentTurn {
  finalText: string
  usage: AgentTurnUsage
  events: RuntimeStreamEvent[]
  status: AgentTaskStatus
  error?: BackendErrorDetail
}

/** Mutable per-turn accumulator threaded through the backend adapters. */
interface TurnAccumulator {
  /** Concatenated incremental text (`text_delta` events). */
  deltaText: string
  /** Final text read off a terminal `result`/`done`/`final` event, when the
   *  backend emitted one. Preferred over `deltaText` for box streams, whose
   *  `message.part.updated` fallback carries running accumulations. */
  terminalText?: string
  input: number
  output: number
  costUsd: number
  model?: string
}

/**
 * Run ONE agent turn on any backend kind and stream its events. Yields the
 * `RuntimeStreamEvent` vocabulary incrementally and always ends with a `final`
 * event carrying the turn's text and usage (`metadata.tokenUsage`,
 * `metadata.costUsd?`, `metadata.model?`) — on success, failure, abort, and
 * timeout alike. The generator never throws; failures surface in-band as
 * `backend_error` + `final` with a typed `error` detail.
 *
 * @experimental
 */
export async function* streamAgentTurn(
  backend: AgentTurnBackend,
  prompt: string,
  opts: StreamAgentTurnOptions = {},
): AsyncGenerator<RuntimeStreamEvent> {
  const label = backend.kind === 'chat' ? backend.backend.kind : backend.kind
  const task: AgentTaskSpec = { id: `turn-${crypto.randomUUID()}`, intent: prompt }
  const acc: TurnAccumulator = { deltaText: '', input: 0, output: 0, costUsd: 0 }
  const deadline = deriveTurnSignal(opts.signal, opts.timeoutMs ?? 0)

  let session: RuntimeSession | undefined
  try {
    session = await startTurnSession(backend, task, prompt, deadline.signal, label)
    yield { type: 'backend_start', task, session, backend: label, timestamp: nowIso() }

    const inner =
      backend.kind === 'chat'
        ? driveChatTurn(backend.backend, task, session, prompt, deadline.signal, acc)
        : driveBoxTurn(
            backend.kind === 'box'
              ? backend.box
              : await inlineSandboxClient(backend.factory).create(),
            prompt,
            deadline.signal,
            backend.agentRunName ?? 'agent',
            acc,
          )
    for await (const event of inner) {
      yield event
      throwIfAborted(deadline.signal)
    }

    yield buildFinalEvent(task, session, acc, { status: 'completed', reason: 'turn completed' })
  } catch (err) {
    const callerAborted = opts.signal?.aborted === true
    const status: AgentTaskStatus = callerAborted ? 'aborted' : 'failed'
    const message = err instanceof Error ? err.message : String(err)
    const error: BackendErrorDetail =
      err instanceof BackendTransportError
        ? { kind: 'transport', message, status: err.status, body: err.body }
        : { kind: 'backend', message }
    yield {
      type: 'backend_error',
      task,
      ...(session ? { session } : {}),
      backend: label,
      message,
      recoverable: !callerAborted,
      error,
      timestamp: nowIso(),
    }
    yield buildFinalEvent(task, session, acc, { status, reason: message, error })
  } finally {
    deadline.dispose()
  }
}

/**
 * Drain a `streamAgentTurn` stream (or any `RuntimeStreamEvent` stream that
 * honors its terminal contract) into the turn summary plus the full event
 * list. Fail-loud: throws when the stream ends without a terminal `final`
 * event — a stream that violates the contract must not read as an empty turn.
 *
 * @experimental
 */
export async function collectAgentTurn(
  stream: AsyncIterable<RuntimeStreamEvent>,
): Promise<CollectedAgentTurn> {
  const events: RuntimeStreamEvent[] = []
  for await (const event of stream) events.push(event)
  const final = events.at(-1)
  if (!final || final.type !== 'final') {
    throw new Error(
      `collectAgentTurn: stream ended without a terminal 'final' event (last: ${final ? final.type : 'none'})`,
    )
  }
  const metadata = final.metadata ?? {}
  const tokenUsage =
    metadata.tokenUsage && typeof metadata.tokenUsage === 'object'
      ? (metadata.tokenUsage as Record<string, unknown>)
      : {}
  const usage: AgentTurnUsage = {
    input: finiteNumber(tokenUsage.input) ?? 0,
    output: finiteNumber(tokenUsage.output) ?? 0,
  }
  const costUsd = finiteNumber(metadata.costUsd)
  if (costUsd !== undefined) usage.costUsd = costUsd
  if (typeof metadata.model === 'string' && metadata.model.length > 0) {
    usage.model = metadata.model
  }
  return {
    finalText: final.text ?? '',
    usage,
    events,
    status: final.status,
    ...(final.error ? { error: final.error } : {}),
  }
}

/** Start the backend's session when it owns one (`chat` kind); mint a local
 *  correlation session otherwise. Box/executor turns carry no server session
 *  here — resume lives in `openSandboxRun`/`SandboxLineage`, not this primitive. */
async function startTurnSession(
  backend: AgentTurnBackend,
  task: AgentTaskSpec,
  prompt: string,
  signal: AbortSignal,
  label: string,
): Promise<RuntimeSession> {
  if (backend.kind === 'chat' && backend.backend.start) {
    return backend.backend.start(
      { task, message: prompt },
      { task, knowledge: emptyReadiness(task), signal },
    )
  }
  return newRuntimeSession(label)
}

/**
 * One turn over a box: `box.streamPrompt` projected through the EXISTING
 * `mapSandboxEvent` (text/reasoning deltas + cost-bearing `llm_call`s). Usage
 * accumulates off the mapped `llm_call` events — the same fold
 * `sumSandboxUsage` applies. Final text prefers the terminal
 * `result`/`done`/`final` payload over concatenated deltas, because the
 * sandbox `message.part.updated` fallback may carry running accumulations.
 */
async function* driveBoxTurn(
  box: SandboxInstance,
  prompt: string,
  signal: AbortSignal,
  agentRunName: string,
  acc: TurnAccumulator,
): AsyncGenerator<RuntimeStreamEvent> {
  for await (const event of box.streamPrompt(prompt, { signal })) {
    const terminalText = terminalTextFromSandboxEvent(event)
    if (terminalText !== undefined) acc.terminalText = terminalText
    const mapped = mapSandboxEvent(event, { agentRunName })
    if (!mapped) continue
    // `mapSandboxEvent` stamps `agentRunName` as the model label when the
    // event carried none — a run label, not a reported model. Exclude it from
    // the terminal usage so `usage.model` is never a fabricated value.
    foldEvent(mapped, acc, agentRunName)
    yield mapped
  }
}

/** One turn over an in-process backend: its own `stream()` surface, projected
 *  through the same `normalizeBackendStreamEvent` the task lifecycle applies. */
async function* driveChatTurn(
  backend: AgentExecutionBackend,
  task: AgentTaskSpec,
  session: RuntimeSession,
  prompt: string,
  signal: AbortSignal,
  acc: TurnAccumulator,
): AsyncGenerator<RuntimeStreamEvent> {
  const input = { task, message: prompt }
  const context = { task, knowledge: emptyReadiness(task), session, signal }
  for await (const raw of backend.stream(input, context)) {
    const event = normalizeBackendStreamEvent(raw, task, session)
    foldEvent(event, acc)
    yield event
  }
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
    acc.input += event.tokensIn ?? 0
    acc.output += event.tokensOut ?? 0
    acc.costUsd += event.costUsd ?? 0
    if (event.model && event.model !== fallbackModelLabel) acc.model = event.model
  }
}

/** Read the final text off a terminal sandbox event, when present. */
function terminalTextFromSandboxEvent(event: SandboxEvent): string | undefined {
  if (!event || typeof event !== 'object') return undefined
  const type = String(event.type ?? '')
  if (type !== 'result' && type !== 'done' && type !== 'final') return undefined
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  for (const key of ['finalText', 'text', 'response', 'content']) {
    const value = data[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function buildFinalEvent(
  task: AgentTaskSpec,
  session: RuntimeSession | undefined,
  acc: TurnAccumulator,
  outcome: { status: AgentTaskStatus; reason: string; error?: BackendErrorDetail },
): RuntimeStreamEvent {
  const finalText = acc.terminalText ?? acc.deltaText
  return {
    type: 'final',
    task,
    ...(session ? { session } : {}),
    status: outcome.status,
    reason: outcome.reason,
    ...(finalText ? { text: finalText } : {}),
    metadata: {
      tokenUsage: { input: acc.input, output: acc.output },
      ...(acc.costUsd > 0 ? { costUsd: acc.costUsd } : {}),
      ...(acc.model ? { model: acc.model } : {}),
    },
    ...(outcome.error ? { error: outcome.error } : {}),
    timestamp: nowIso(),
  }
}

/** Minimal ready-by-construction readiness report for a requirement-free turn. */
function emptyReadiness(task: AgentTaskSpec) {
  return scoreKnowledgeReadiness({ taskId: task.id, requirements: [] })
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function throwIfAborted(signal: AbortSignal): void {
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
function deriveTurnSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer =
    timeoutMs > 0
      ? setTimeout(
          () => controller.abort(new Error(`agent turn timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      : undefined
  if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
    ;(timer as { unref: () => void }).unref()
  }
  const onCallerAbort = () =>
    controller.abort(callerSignal?.reason ?? new Error('agent turn aborted'))
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort()
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}
