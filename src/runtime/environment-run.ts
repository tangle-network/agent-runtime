import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { RuntimeHooks, RuntimeHookTarget } from '../runtime-hooks'
import { notifyRuntimeHookEvent } from '../runtime-hooks'
import { notifyAgentEnvironmentEventObserver } from './environment-events'
import { createEnvironmentLineage, type EnvironmentLineageHandle } from './environment-lineage'
import type { AgentRunSpec } from './types'
import { isAbortError, randomSuffix, sleep } from './util'

/** Convert a completed turn into the caller's typed result. */
export type EnvironmentDeliverable<Output> =
  | {
      kind: 'events'
      fromEvents: (events: AgentEnvironmentEvent[]) => Output
    }
  | {
      kind: 'artifact'
      path: string
      fromArtifact: (content: string, events: AgentEnvironmentEvent[]) => Output
    }

/** Result of one turn in a persistent environment. */
export interface EnvironmentTurnResult<Output> {
  output: Output
  events: AgentEnvironmentEvent[]
}

/** Abort error that retains events observed before cancellation. */
export class EnvironmentRunAbortError extends Error {
  override readonly name = 'AbortError'
  readonly events: AgentEnvironmentEvent[]
  readonly readError?: string

  constructor(events: AgentEnvironmentEvent[], readError?: string) {
    super('aborted')
    this.events = events
    if (readError !== undefined) this.readError = readError
  }
}

/** A persistent agent environment and its resumable session. */
export interface EnvironmentRun<Output> {
  readonly environment: AgentEnvironment
  readonly sessionId: string
  turn(prompt: string, options?: EnvironmentTurnOptions): Promise<EnvironmentTurnResult<Output>>
  close(): Promise<void>
}

export type EnvironmentTurnOptions = Omit<AgentTurnInput, 'prompt' | 'parts' | 'sessionId'>
type ProviderTurnOptions = Omit<EnvironmentTurnOptions, 'signal'>

export interface OpenEnvironmentRunBeforeStartContext {
  readonly environment: AgentEnvironment
  readonly sessionId: string
  readonly signal: AbortSignal
}

export interface OpenEnvironmentRunOptions<Output> {
  provider: AgentEnvironmentProvider
  agentRun: AgentRunSpec<string>
  deliverable: EnvironmentDeliverable<Output>
  signal: AbortSignal
  hooks?: RuntimeHooks
  runId?: string
  scenarioId?: string
  /** Reattach to a provider environment and session created by an earlier process. */
  resumeFrom?: {
    environmentId: string
    sessionId: string
  }
  turn?: ProviderTurnOptions
  beforeStart?: (ctx: OpenEnvironmentRunBeforeStartContext) => Promise<void> | void
  onEnvironmentEvent?: (
    event: AgentEnvironmentEvent,
    meta: {
      turnIndex: number
      turnKind: 'start' | 'resume'
      agentRunName: string
    },
  ) => void | PromiseLike<void>
  now?: () => number
  readAttempts?: number
  readRetryDelayMs?: number
}

/**
 * Open one persistent environment, run its first turn, and resume the same
 * provider session on later turns.
 */
export async function openEnvironmentRun<Output>(
  options: OpenEnvironmentRunOptions<Output>,
): Promise<EnvironmentRun<Output>> {
  const capabilities = await options.provider.capabilities()
  if (!capabilities.sessions.continue) {
    throw new Error(
      `openEnvironmentRun: provider "${options.provider.name}" does not support session continuation`,
    )
  }
  if (options.deliverable.kind === 'artifact' && !capabilities.workspace.read) {
    throw new Error(
      `openEnvironmentRun: provider "${options.provider.name}" does not support workspace reads`,
    )
  }

  const runId = options.runId ?? `environment-run-${randomSuffix()}`
  const now = options.now ?? Date.now
  const agentRunName = options.agentRun.name ?? options.agentRun.profile.name ?? 'agent'
  const lineage = createEnvironmentLineage(options.provider, capabilities)
  let handle: EnvironmentLineageHandle | undefined
  let started = false
  let closed = false
  let failed = false
  let runStartedAt: number | undefined
  let turnCount = 0
  type ActiveTurn = {
    controller: AbortController
    promise?: Promise<EnvironmentTurnResult<Output>>
  }
  let activeTurn: ActiveTurn | undefined
  let closePromise: Promise<void> | undefined

  if (options.resumeFrom) {
    if (!options.provider.get) {
      throw new Error(
        `openEnvironmentRun: provider "${options.provider.name}" cannot reattach environments`,
      )
    }
    const environment = await options.provider.get(options.resumeFrom.environmentId)
    if (!environment) {
      throw new Error(
        `openEnvironmentRun: environment "${options.resumeFrom.environmentId}" was not found`,
      )
    }
    handle = lineage.adopt(environment, options.resumeFrom.sessionId)
    started = true
  }

  function emit(event: {
    target: RuntimeHookTarget
    phase: 'before' | 'after' | 'error'
    timestamp: number
    stepIndex?: number
    payload?: Record<string, unknown>
  }): void {
    notifyRuntimeHookEvent(
      options.hooks,
      {
        id: `${runId}:${event.target}:${event.phase}${
          event.stepIndex === undefined ? '' : `:${event.stepIndex}`
        }`,
        runId,
        scenarioId: options.scenarioId,
        target: event.target,
        phase: event.phase,
        timestamp: event.timestamp,
        stepIndex: event.stepIndex,
        payload: event.payload,
        metadata: { producer: 'openEnvironmentRun' },
      },
      { signal: options.signal },
    )
  }

  const runPayload = (): Record<string, unknown> => ({
    agentName: agentRunName,
    profileName: options.agentRun.profile.name,
    provider: options.provider.name,
    backend: options.agentRun.environment?.backend,
    deliverableKind: options.deliverable.kind,
    ...(options.deliverable.kind === 'artifact'
      ? { deliverablePath: options.deliverable.path }
      : {}),
    ...(handle
      ? {
          sessionId: handle.sessionId,
          environmentId: handle.environment.id,
        }
      : {}),
  })

  const turnPayload = (
    prompt: string,
    turnKind: 'start' | 'resume',
    startedAt: number,
    result?: EnvironmentTurnResult<Output>,
    error?: unknown,
  ): Record<string, unknown> => ({
    ...runPayload(),
    turnKind,
    promptChars: prompt.length,
    promptHash: hashText(prompt),
    ...(result !== undefined || error !== undefined
      ? { durationMs: Math.max(0, now() - startedAt) }
      : {}),
    ...(result
      ? {
          eventCount: result.events.length,
          eventTypes: eventTypeCounts(result.events),
        }
      : {}),
    ...(error !== undefined ? { error: errorMessage(error) } : {}),
  })

  async function settle(
    environment: AgentEnvironment,
    events: AsyncIterable<AgentEnvironmentEvent>,
    turnIndex: number,
    turnKind: 'start' | 'resume',
    signal: AbortSignal,
  ): Promise<EnvironmentTurnResult<Output>> {
    const collected: AgentEnvironmentEvent[] = []
    try {
      for await (const event of events) {
        collected.push(event)
        notifyAgentEnvironmentEventObserver(event, options.onEnvironmentEvent, {
          turnIndex,
          turnKind,
          agentRunName,
        })
      }
    } catch (error) {
      if (isAbortError(error)) throw new EnvironmentRunAbortError(collected)
      throw error
    }

    if (signal.aborted) throw new EnvironmentRunAbortError(collected)
    if (options.deliverable.kind === 'events') {
      return {
        output: options.deliverable.fromEvents(collected),
        events: collected,
      }
    }
    if (!environment.read) {
      throw new Error(
        `openEnvironmentRun: environment "${environment.id}" does not support workspace reads`,
      )
    }

    let content: string | undefined
    let readError: string | undefined
    const readAttempts = options.readAttempts ?? 4
    if (!Number.isInteger(readAttempts) || readAttempts < 1) {
      throw new Error('openEnvironmentRun: readAttempts must be a positive integer')
    }
    const readRetryDelayMs = options.readRetryDelayMs ?? 1_000

    for (let attempt = 0; attempt < readAttempts; attempt += 1) {
      if (signal.aborted) {
        throw new EnvironmentRunAbortError(collected, readError)
      }
      try {
        content = await environment.read(options.deliverable.path, {
          sessionId: handle?.sessionId,
        })
        readError = undefined
        break
      } catch (error) {
        readError = errorMessage(error)
        if (attempt < readAttempts - 1 && readRetryDelayMs > 0) {
          await sleep(readRetryDelayMs * (attempt + 1), signal)
        }
      }
    }

    if (content === undefined) {
      throw new Error(
        `openEnvironmentRun: failed to read artifact "${options.deliverable.path}" after ${readAttempts} attempts: ${readError ?? 'unknown error'}`,
      )
    }

    return {
      output: options.deliverable.fromArtifact(content, collected),
      events: collected,
    }
  }

  function assertOpen(): void {
    if (closed) throw new Error('openEnvironmentRun: run is closed')
  }

  async function runTurn(
    prompt: string,
    turnKind: 'start' | 'resume',
    signal: AbortSignal,
    turnOptions?: ProviderTurnOptions,
  ): Promise<EnvironmentTurnResult<Output>> {
    assertOpen()
    const stepIndex = turnCount
    const turnStartedAt = now()
    emit({
      target: 'agent.turn',
      phase: 'before',
      timestamp: turnStartedAt,
      stepIndex,
      payload: turnPayload(prompt, turnKind, turnStartedAt),
    })

    try {
      const events =
        turnKind === 'start'
          ? await startEnvironment(prompt, signal, turnOptions)
          : await resumeEnvironment(prompt, signal, turnOptions)
      if (!handle) throw new Error('openEnvironmentRun: environment was not created')
      const result = await settle(handle.environment, events, stepIndex, turnKind, signal)
      failed = false
      turnCount += 1
      emit({
        target: 'agent.turn',
        phase: 'after',
        timestamp: now(),
        stepIndex,
        payload: turnPayload(prompt, turnKind, turnStartedAt, result),
      })
      return result
    } catch (error) {
      failed = true
      emit({
        target: 'agent.turn',
        phase: 'error',
        timestamp: now(),
        stepIndex,
        payload: turnPayload(prompt, turnKind, turnStartedAt, undefined, error),
      })
      emit({
        target: 'agent.run',
        phase: 'error',
        timestamp: now(),
        payload: { ...runPayload(), turnCount, error: errorMessage(error) },
      })
      throw error
    }
  }

  async function startEnvironment(
    prompt: string,
    signal: AbortSignal,
    turnOptions?: ProviderTurnOptions,
  ): Promise<AsyncIterable<AgentEnvironmentEvent>> {
    if (started) {
      throw new Error(
        'openEnvironmentRun: start() already called; use resume() to continue the session',
      )
    }
    started = true
    const result = await lineage
      .start(options.agentRun as AgentRunSpec<unknown>, prompt, signal, {
        ...options.turn,
        ...turnOptions,
      })
      .catch((error: unknown) => {
        started = false
        throw error
      })
    handle = result.handle
    try {
      await options.beforeStart?.({
        environment: handle.environment,
        sessionId: handle.sessionId,
        signal,
      })
    } catch (error) {
      closed = true
      try {
        await lineage.teardown()
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'openEnvironmentRun: setup and environment destruction failed',
        )
      }
      throw error
    }
    return result.events
  }

  async function resumeEnvironment(
    prompt: string,
    signal: AbortSignal,
    turnOptions?: ProviderTurnOptions,
  ): Promise<AsyncIterable<AgentEnvironmentEvent>> {
    if (!handle) throw new Error('openEnvironmentRun: resume() called before start()')
    return lineage.continue(handle, prompt, signal, { ...options.turn, ...turnOptions })
  }

  function beginTurn(
    prompt: string,
    turnOptions?: EnvironmentTurnOptions,
  ): Promise<EnvironmentTurnResult<Output>> {
    assertOpen()
    if (activeTurn) {
      throw new Error('openEnvironmentRun: another turn is already active')
    }
    if (runStartedAt === undefined) {
      runStartedAt = now()
      emit({
        target: 'agent.run',
        phase: 'before',
        timestamp: runStartedAt,
        payload: { ...runPayload(), turnCount: 0 },
      })
    }

    const turnKind = started ? 'resume' : 'start'
    const controller = new AbortController()
    const signals = [options.signal, turnOptions?.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    )
    const abortListeners = new Map<AbortSignal, () => void>()
    for (const signal of signals) {
      const abort = () => controller.abort(signal.reason)
      abortListeners.set(signal, abort)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    }
    const { signal: _turnSignal, ...providerTurnOptions } = turnOptions ?? {}

    const active: ActiveTurn = { controller }
    activeTurn = active
    const promise = runTurn(prompt, turnKind, controller.signal, providerTurnOptions).finally(
      () => {
        for (const [signal, abort] of abortListeners) {
          signal.removeEventListener('abort', abort)
        }
        if (activeTurn === active) activeTurn = undefined
      },
    )
    active.promise = promise
    return promise
  }

  async function closeRun(): Promise<void> {
    closed = true
    const active = activeTurn
    if (active) {
      active.controller.abort()
      await active.promise?.catch(() => {})
    }
    await lineage.teardown()
    if (runStartedAt !== undefined) {
      emit({
        target: 'agent.run',
        phase: 'after',
        timestamp: now(),
        payload: {
          ...runPayload(),
          turnCount,
          status: failed ? 'error' : 'completed',
          durationMs: Math.max(0, now() - runStartedAt),
        },
      })
    }
  }

  return {
    get environment(): AgentEnvironment {
      if (!handle) {
        throw new Error('openEnvironmentRun: environment unavailable before start()')
      }
      return handle.environment
    },
    get sessionId(): string {
      if (!handle) {
        throw new Error('openEnvironmentRun: sessionId unavailable before start()')
      }
      return handle.sessionId
    },
    async turn(prompt, turnOptions) {
      return beginTurn(prompt, turnOptions)
    },
    close() {
      closePromise ??= closeRun()
      return closePromise
    },
  }
}

function eventTypeCounts(events: AgentEnvironmentEvent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
  return counts
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
