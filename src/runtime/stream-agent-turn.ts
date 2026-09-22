/**
 * Stream one agent turn through a live environment or an environment provider.
 *
 * Every path yields `RuntimeStreamEvent` values and ends with one `final`
 * event containing final text and reported usage. A caller-owned environment
 * remains live after the turn. An environment created from a provider is
 * always destroyed after the stream settles.
 *
 * The generator is pull-based. Production pauses between yields, allowing a
 * consumer to perform ordered async work before requesting the next event.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { AgentTaskSpec, AgentTaskStatus, AgentTurnError, RuntimeStreamEvent } from '../types'
import { createEnvironmentForSpec } from './environment-create'
import {
  createEnvironmentToolPartState,
  extractEnvironmentFinalText,
  mapAgentEnvironmentEvent,
  mapEnvironmentToolEvent,
} from './environment-events'
import { turnEvents } from './environment-lineage'
import type { AgentRunSpec } from './types'
import { destroyEnvironmentSafe } from './util'

type EnvironmentTurnOptions = Omit<AgentTurnInput, 'prompt' | 'parts' | 'signal'>
type EnvironmentCreateOptions = Omit<CreateAgentEnvironmentInput, 'profile' | 'signal'>

/**
 * The execution target for one turn.
 *
 * @experimental
 */
export type AgentTurnTarget =
  | {
      /** A caller-owned environment. It is not destroyed after the turn. */
      kind: 'environment'
      environment: AgentEnvironment
      /** Provider-neutral fields forwarded with the turn. */
      turn?: EnvironmentTurnOptions
      /** Label stamped on usage events that do not report a model. */
      agentRunName?: string
    }
  | {
      /** Create, prepare, and own one environment for this turn. */
      kind: 'provider'
      provider: AgentEnvironmentProvider
      profile: AgentProfile
      /** Provider-neutral fields forwarded at environment creation. */
      environment?: EnvironmentCreateOptions
      /** Optional setup after creation and before streaming. */
      prepareEnvironment?: AgentRunSpec<unknown>['prepareEnvironment']
      /** Provider-neutral fields forwarded with the turn. */
      turn?: EnvironmentTurnOptions
      /** Label stamped on usage events that do not report a model. */
      agentRunName?: string
    }

/** @experimental */
export interface StreamAgentTurnOptions {
  /** Caller-initiated cancellation. Terminates the stream with `final.status: 'aborted'`. */
  signal?: AbortSignal
  /**
   * Wall-clock deadline for the whole turn in ms. An expired deadline aborts
   * the turn and terminates the stream with `final.status: 'failed'`
   * (a blown deadline is a turn failure, not a caller cancellation).
   */
  timeoutMs?: number
  /**
   * Project provider tool parts as `tool_call` and `tool_result` events.
   * Default false.
   */
  preserveToolParts?: boolean
  /**
   * Called and awaited for every provider event before projection.
   */
  onRawEvent?: (event: AgentEnvironmentEvent) => void | Promise<void>
}

/**
 * Metered usage of one turn, summed over every cost-bearing provider event.
 * `input`/`output` are token counts (0 when the provider reported
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
  error?: AgentTurnError
}

/** Mutable per-turn accumulator threaded through event projection. */
interface TurnAccumulator {
  /** Concatenated incremental text (`text_delta` events). */
  deltaText: string
  /** Final text read from a terminal provider event, when present. */
  terminalText?: string
  input: number
  output: number
  costUsd: number
  model?: string
}

/**
 * Run one agent turn and stream its events. Yields the
 * `RuntimeStreamEvent` vocabulary incrementally and always ends with a `final`
 * event carrying the turn's text and usage (`metadata.tokenUsage`,
 * `metadata.costUsd?`, `metadata.model?`) — on success, failure, abort, and
 * timeout alike. The generator never throws; failures surface in-band as
 * `turn_error` followed by `final`.
 *
 * @experimental
 */
export async function* streamAgentTurn(
  target: AgentTurnTarget,
  prompt: string,
  opts: StreamAgentTurnOptions = {},
): AsyncGenerator<RuntimeStreamEvent> {
  const label =
    target.agentRunName ??
    (target.kind === 'provider' ? target.provider.name : target.environment.provider)
  const task: AgentTaskSpec = { id: `turn-${crypto.randomUUID()}`, intent: prompt }
  const sessionId = target.turn?.sessionId ?? `turn-${crypto.randomUUID()}`
  const acc: TurnAccumulator = { deltaText: '', input: 0, output: 0, costUsd: 0 }
  const deadline = deriveTurnSignal(opts.signal, opts.timeoutMs ?? 0)

  let ownedEnvironment: AgentEnvironment | undefined
  try {
    yield { type: 'turn_start', task, provider: label, sessionId, timestamp: nowIso() }

    const environment =
      target.kind === 'provider'
        ? await createTurnEnvironment(target, deadline.signal)
        : target.environment
    if (target.kind === 'provider') ownedEnvironment = environment
    const inner = driveEnvironmentTurn(environment, prompt, deadline.signal, label, acc, {
      turn: { ...target.turn, sessionId },
      preserveToolParts: opts.preserveToolParts === true,
      ...(opts.onRawEvent ? { onRawEvent: opts.onRawEvent } : {}),
    })
    for await (const event of inner) {
      yield event
      throwIfAborted(deadline.signal)
    }

    yield buildFinalEvent(task, sessionId, acc, { status: 'completed', reason: 'turn completed' })
  } catch (err) {
    const callerAborted = opts.signal?.aborted === true
    const status: AgentTaskStatus = callerAborted ? 'aborted' : 'failed'
    const cause = deadline.signal.aborted ? deadline.signal.reason : err
    const message = cause instanceof Error ? cause.message : String(cause)
    const error = toAgentTurnError(cause)
    yield {
      type: 'turn_error',
      task,
      provider: label,
      sessionId,
      message,
      recoverable: isRecoverableTurnError(error, callerAborted),
      error,
      timestamp: nowIso(),
    }
    yield buildFinalEvent(task, sessionId, acc, { status, reason: message, error })
  } finally {
    await destroyEnvironmentSafe(ownedEnvironment)
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
  if (final?.type !== 'final') {
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

async function createTurnEnvironment(
  target: Extract<AgentTurnTarget, { kind: 'provider' }>,
  signal: AbortSignal,
): Promise<AgentEnvironment> {
  let created: AgentEnvironment | undefined
  const validateProfile = target.provider.validateProfile?.bind(target.provider)
  const trackingProvider: AgentEnvironmentProvider = {
    name: target.provider.name,
    capabilities: () => target.provider.capabilities(),
    ...(validateProfile ? { validateProfile } : {}),
    async create(input) {
      created = await target.provider.create(input)
      return created
    },
  }
  const spec: AgentRunSpec<string> = {
    profile: target.profile,
    taskToPrompt: (task) => task,
    ...(target.environment ? { environment: target.environment } : {}),
    ...(target.prepareEnvironment ? { prepareEnvironment: target.prepareEnvironment } : {}),
  }
  try {
    return await createEnvironmentForSpec(trackingProvider, spec, signal)
  } catch (error) {
    await destroyEnvironmentSafe(created)
    throw error
  }
}

interface EnvironmentTurnConfig {
  /** Provider-neutral turn fields. */
  turn?: EnvironmentTurnOptions
  /** Project tool parts to normalized tool events. */
  preserveToolParts: boolean
  /** Awaited raw-event tap, before projection. */
  onRawEvent?: (event: AgentEnvironmentEvent) => void | Promise<void>
}

/**
 * Stream one provider turn and project its events into runtime events.
 */
async function* driveEnvironmentTurn(
  environment: AgentEnvironment,
  prompt: string,
  signal: AbortSignal,
  agentRunName: string,
  acc: TurnAccumulator,
  cfg: EnvironmentTurnConfig,
): AsyncGenerator<RuntimeStreamEvent> {
  const { sessionId = `turn-${crypto.randomUUID()}`, ...turn } = cfg.turn ?? {}
  const stream = turnEvents('sse', environment, prompt, sessionId, signal, turn)
  const toolParts = cfg.preserveToolParts ? createEnvironmentToolPartState() : undefined
  for await (const event of stream) {
    if (cfg.onRawEvent) await cfg.onRawEvent(event)
    const terminalText = extractEnvironmentFinalText(event)
    if (terminalText !== undefined) acc.terminalText = terminalText
    if (toolParts) {
      for (const toolEvent of mapEnvironmentToolEvent(event, toolParts)) yield toolEvent
    }
    const mapped = mapAgentEnvironmentEvent(event, { agentRunName })
    if (!mapped) continue
    // A mapper fallback label identifies the run, not a reported model.
    foldEvent(mapped, acc, agentRunName)
    yield mapped
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

function buildFinalEvent(
  task: AgentTaskSpec,
  sessionId: string,
  acc: TurnAccumulator,
  outcome: { status: AgentTaskStatus; reason: string; error?: AgentTurnError },
): RuntimeStreamEvent {
  const finalText = acc.terminalText ?? acc.deltaText
  return {
    type: 'final',
    task,
    sessionId,
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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nowIso(): string {
  return new Date().toISOString()
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))
}

function toAgentTurnError(error: unknown): AgentTurnError {
  const message = error instanceof Error ? error.message : String(error)
  if (!error || typeof error !== 'object') return { kind: 'execution', message }
  const record = error as Record<string, unknown>
  const status = finiteNumber(record.status)
  const body = typeof record.body === 'string' ? record.body.slice(0, 2_048) : undefined
  if (status === undefined && body === undefined) return { kind: 'execution', message }
  return {
    kind: 'transport',
    message,
    ...(status !== undefined ? { status } : {}),
    ...(body !== undefined ? { body } : {}),
  }
}

function isRecoverableTurnError(error: AgentTurnError, callerAborted: boolean): boolean {
  if (callerAborted) return false
  if (error.status === undefined) return true
  return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500
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
