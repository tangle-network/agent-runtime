/**
 * Detached provider turns and cross-process resume.
 *
 * Dispatch creates one environment, starts one detached session, persists the
 * environment and session ids, then waits without holding the live event
 * stream. Resume resolves those ids through the provider and reads the same
 * session. No provider-private methods are required.
 *
 * @experimental
 */

import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentSession,
  AgentSessionStatus,
  AgentTurnResult,
  PlacementInfo,
} from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../errors'
import { createEnvironmentForSpec } from '../runtime/environment-create'
import type { AgentRunSpec, LoopTraceEmitter, LoopTraceEvent } from '../runtime/types'
import { destroyEnvironmentSafe, sleep, throwAbort, throwIfAborted } from '../runtime/util'
import type { DelegationRecord, DelegationResumeDriver, DelegationResumeTick } from './task-queue'
import type { DelegationProgress, DelegationResultPayload } from './types'

const DEFAULT_TICK_INTERVAL_MS = 5000

/** Decoded `DelegationRecord.detachedSessionRef`. */
export interface DetachedSessionRefParts {
  sessionId: string
  environmentId?: string
}

/**
 * Encode a detached session reference. The environment id is absent before
 * dispatch and required for cross-process resume.
 */
export function formatDetachedSessionRef(parts: DetachedSessionRefParts): string {
  assertRefComponent('sessionId', parts.sessionId)
  if (parts.environmentId === undefined) return `session=${parts.sessionId}`
  assertRefComponent('environmentId', parts.environmentId)
  return `environment=${parts.environmentId};session=${parts.sessionId}`
}

/** Parse a detached session reference and reject retired wire names. */
export function parseDetachedSessionRef(raw: string): DetachedSessionRefParts {
  const fields = new Map<string, string>()
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=')
    const key = eq === -1 ? '' : pair.slice(0, eq)
    const value = eq === -1 ? '' : pair.slice(eq + 1)
    if ((key !== 'session' && key !== 'environment') || value.length === 0 || fields.has(key)) {
      throw new ValidationError(
        `parseDetachedSessionRef: malformed detachedSessionRef ${JSON.stringify(raw)}; expected "session=<id>" or "environment=<id>;session=<id>"`,
      )
    }
    fields.set(key, value)
  }
  const sessionId = fields.get('session')
  if (!sessionId) {
    throw new ValidationError(
      `parseDetachedSessionRef: detachedSessionRef ${JSON.stringify(raw)} carries no session id`,
    )
  }
  const environmentId = fields.get('environment')
  return { sessionId, ...(environmentId !== undefined ? { environmentId } : {}) }
}

function assertRefComponent(name: string, value: string): void {
  if (value.length === 0 || value.includes(';') || value.includes('=')) {
    throw new ValidationError(
      `formatDetachedSessionRef: ${name} ${JSON.stringify(value)} must be non-empty and free of ";" / "="`,
    )
  }
}

/** Terminal payload of a detached provider turn. */
export interface DetachedTurn {
  text: string
  result: AgentTurnResult
}

/** Rebuild the terminal event shape consumed by ordinary output adapters. */
export function detachedTurnEvents(sessionId: string, turn: DetachedTurn): AgentEnvironmentEvent[] {
  const structured = turn.result.metadata?.result ?? turn.result.metadata ?? turn.result
  return [
    ...(turn.result.events ?? []),
    {
      type: 'result',
      id: sessionId,
      data: {
        text: turn.text,
        finalText: turn.text,
        success: turn.result.success,
        result: structured,
        ...(turn.result.error ? { error: turn.result.error } : {}),
      },
      ...(turn.result.usage ? { usage: turn.result.usage } : {}),
    },
  ]
}

export interface RunDetachedTurnOptions {
  provider: AgentEnvironmentProvider
  spec: AgentRunSpec<unknown>
  prompt: string
  /** Requested idempotent session id. */
  sessionId: string
  /** Persist the environment id and provider-returned session id immediately after dispatch. */
  bindEnvironment(environmentId: string, sessionId: string): void
  signal: AbortSignal
  report(progress: DelegationProgress): void
  tickIntervalMs?: number
  /** Forwarded as the provider-neutral turn timeout. */
  wallCapMs?: number
  traceEmitter?: LoopTraceEmitter
}

/**
 * Dispatch one detached session and await its terminal result.
 *
 * Abort cancels the remote session. Every in-process exit destroys the
 * environment; a process death leaves it available for the resume driver.
 */
export async function runDetachedTurn(options: RunDetachedTurnOptions): Promise<DetachedTurn> {
  const intervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS
  const trace = createDetachedTurnTrace(options)
  trace.started()

  let environment: AgentEnvironment | undefined
  let session: AgentSession | undefined
  let abortListener: (() => void) | undefined
  let cancellation: Promise<void> | undefined
  let terminalUsage: AgentTurnResult['usage']
  try {
    const capabilities = await options.provider.capabilities()
    if (!capabilities.streaming.detach) {
      throw new ValidationError(
        `runDetachedTurn: provider "${options.provider.name}" does not support detached turns`,
      )
    }
    environment = await createEnvironmentForSpec(options.provider, options.spec, options.signal)
    if (!environment.dispatch || !environment.session) {
      throw new ValidationError(
        `runDetachedTurn: provider "${environment.provider}" created an environment without dispatch/session support`,
      )
    }

    throwIfAborted(options.signal)
    const dispatched = await environment.dispatch({
      prompt: options.prompt,
      sessionId: options.sessionId,
      turnId: options.sessionId,
      executionId: options.sessionId,
      detach: true,
      ...(options.wallCapMs !== undefined ? { timeoutMs: options.wallCapMs } : {}),
      signal: options.signal,
    })
    session = environment.session(dispatched.id)
    options.bindEnvironment(environment.id, dispatched.id)
    trace.dispatched(environment, await readPlacement(environment))

    abortListener = () => {
      cancellation ??= session?.cancel().catch(() => {})
    }
    options.signal.addEventListener('abort', abortListener, { once: true })

    const result = await waitForDetachedResult(session, intervalMs, options.signal, options.report)
    terminalUsage = result.usage
    if (!result.success) {
      throw new Error(
        `detached turn ${dispatched.id} failed: ${result.error ?? 'provider returned success=false'}`,
      )
    }
    trace.ended(undefined, terminalUsage)
    return { text: result.text, result }
  } catch (error) {
    trace.ended(error instanceof Error ? error.message : String(error), terminalUsage)
    throw error
  } finally {
    if (abortListener) options.signal.removeEventListener('abort', abortListener)
    if (options.signal.aborted) abortListener?.()
    await cancellation
    await destroyEnvironmentSafe(environment)
  }
}

async function waitForDetachedResult(
  session: AgentSession,
  intervalMs: number,
  signal: AbortSignal,
  report: (progress: DelegationProgress) => void,
): Promise<AgentTurnResult> {
  const startedAt = Date.now()
  const terminal = session.result().then(
    (result) => ({ kind: 'result' as const, result }),
    (error: unknown) => ({ kind: 'error' as const, error }),
  )

  for (;;) {
    throwIfAborted(signal)
    const next = await Promise.race([
      terminal,
      sleep(intervalMs, signal).then(() => ({ kind: 'tick' as const })),
    ])
    throwIfAborted(signal)
    if (next.kind === 'result') return next.result
    if (next.kind === 'error') throw next.error
    report({ iteration: 0, phase: detachedRunningPhase(Date.now() - startedAt) })
  }
}

function createDetachedTurnTrace(options: RunDetachedTurnOptions): {
  started(): void
  dispatched(environment: AgentEnvironment, placement: PlacementInfo): void
  ended(error?: string, usage?: AgentTurnResult['usage']): void
} {
  const emitter = options.traceEmitter
  if (!emitter) {
    return { started() {}, dispatched() {}, ended() {} }
  }
  const runId = options.sessionId
  const agentRunName = options.spec.name ?? options.spec.profile.name ?? 'detached-turn'
  const startMs = Date.now()
  let done = false
  const emit = (event: LoopTraceEvent): void => {
    void emitter.emit(event)
  }
  return {
    started(): void {
      emit({
        kind: 'loop.started',
        runId,
        timestamp: startMs,
        payload: {
          driver: 'detached-turn',
          agentRunNames: [agentRunName],
          maxIterations: 1,
          maxConcurrency: 1,
        },
      })
      emit({
        kind: 'loop.iteration.started',
        runId,
        timestamp: startMs,
        payload: { iterationIndex: 0, agentRunName, taskHash: options.sessionId },
      })
    },
    dispatched(environment, placement): void {
      emit({
        kind: 'loop.iteration.dispatch',
        runId,
        timestamp: Date.now(),
        payload: {
          iterationIndex: 0,
          agentRunName,
          placement: placement.kind,
          environmentId: environment.id,
          provider: environment.provider,
          ...(placement.sandboxId ? { sandboxId: placement.sandboxId } : {}),
          ...(placement.fleetId ? { fleetId: placement.fleetId } : {}),
          ...(placement.machineId ? { machineId: placement.machineId } : {}),
          ...(placement.region ? { region: placement.region } : {}),
          ...(placement.providerMetadata ? { providerMetadata: placement.providerMetadata } : {}),
        },
      })
    },
    ended(error?: string, usage?: AgentTurnResult['usage']): void {
      if (done) return
      done = true
      const endMs = Date.now()
      const costUsd = usage?.cost ?? 0
      const tokenUsage =
        usage && (usage.inputTokens || usage.outputTokens)
          ? { input: usage.inputTokens, output: usage.outputTokens }
          : undefined
      emit({
        kind: 'loop.iteration.ended',
        runId,
        timestamp: endMs,
        payload: {
          iterationIndex: 0,
          agentRunName,
          costUsd,
          durationMs: endMs - startMs,
          ...(tokenUsage ? { tokenUsage } : {}),
          ...(error !== undefined ? { error } : {}),
        },
      })
      emit({
        kind: 'loop.ended',
        runId,
        timestamp: endMs,
        payload: {
          ...(error === undefined ? { winnerIterationIndex: 0 } : {}),
          totalCostUsd: costUsd,
          durationMs: endMs - startMs,
          iterations: 1,
        },
      })
    },
  }
}

async function readPlacement(environment: AgentEnvironment): Promise<PlacementInfo> {
  try {
    return (await environment.placement?.()) ?? { kind: 'provider' }
  } catch {
    return { kind: 'provider' }
  }
}

function detachedRunningPhase(elapsedMs: number | undefined): string {
  return elapsedMs === undefined
    ? 'detached-running'
    : `detached-running ${Math.round(elapsedMs / 1000)}s`
}

export interface DetachedTurnResumeDriverOptions {
  /** Provider that created the persisted environment. `get` is required. */
  provider: AgentEnvironmentProvider
  settleOutput(
    turn: DetachedTurn,
    record: DelegationRecord,
    ctx: { signal: AbortSignal },
  ): Promise<DelegationResultPayload['output']> | DelegationResultPayload['output']
  intervalMs?: number
}

/**
 * Resume detached work by resolving the persisted environment and session.
 * Each queue tick performs one status read and settles only on a terminal state.
 */
export function createDetachedTurnResumeDriver(
  options: DetachedTurnResumeDriverOptions,
): DelegationResumeDriver {
  const cancellationHooks = new Map<string, ResumeCancellationHook>()
  return {
    intervalMs: options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS,
    async tick({ record, detachedSessionRef }, ctx): Promise<DelegationResumeTick> {
      let environment: AgentEnvironment | undefined
      try {
        const ref = parseDetachedSessionRef(detachedSessionRef)
        if (ref.environmentId === undefined) {
          await releaseResumeCancellation(cancellationHooks, record.taskId)
          return failedTick(
            'DetachedSessionUnboundError',
            `detached session "${ref.sessionId}" was never bound to an environment; it cannot be resumed`,
          )
        }
        if (!options.provider.get) {
          await releaseResumeCancellation(cancellationHooks, record.taskId)
          return failedTick(
            'DetachedEnvironmentLookupUnsupportedError',
            `provider "${options.provider.name}" cannot resolve environment "${ref.environmentId}"`,
          )
        }

        const resolvedEnvironment = await options.provider.get(ref.environmentId)
        if (!resolvedEnvironment) {
          await releaseResumeCancellation(cancellationHooks, record.taskId)
          return failedTick(
            'DetachedEnvironmentNotFoundError',
            `environment "${ref.environmentId}" no longer exists`,
          )
        }
        environment = resolvedEnvironment
        if (!environment.session) {
          return await finishResumeTick(
            cancellationHooks,
            record.taskId,
            environment,
            failedTick(
              'DetachedSessionLookupUnsupportedError',
              `environment "${ref.environmentId}" does not support session lookup`,
            ),
          )
        }
        const session = environment.session(ref.sessionId)
        attachResumeCancellation(cancellationHooks, record.taskId, ctx.signal, environment, session)
        if (ctx.signal.aborted) throwAbort()

        const status = await session.status()
        if (ctx.signal.aborted) throwAbort()
        if (status === null) {
          return await finishResumeTick(
            cancellationHooks,
            record.taskId,
            environment,
            failedTick(
              'DetachedSessionNotFoundError',
              `session "${ref.sessionId}" no longer exists in environment "${ref.environmentId}"`,
            ),
          )
        }
        if (!isTerminalSessionStatus(status)) {
          if (status === 'unknown') {
            return await finishResumeTick(
              cancellationHooks,
              record.taskId,
              environment,
              failedTick(
                'DetachedSessionStatusUnknownError',
                `provider "${options.provider.name}" returned unknown status for session "${ref.sessionId}"`,
              ),
            )
          }
          ctx.report({ iteration: 0, phase: detachedRunningPhase(undefined) })
          return { state: 'running' }
        }
        if (status === 'failed' || status === 'cancelled' || status === 'expired') {
          return await finishResumeTick(
            cancellationHooks,
            record.taskId,
            environment,
            failedTick(
              'DetachedTurnFailedError',
              `detached turn ${ref.sessionId} ended with status ${status}`,
            ),
          )
        }

        const result = await session.result()
        if (ctx.signal.aborted) throwAbort()
        if (!result.success) {
          return await finishResumeTick(
            cancellationHooks,
            record.taskId,
            environment,
            failedTick(
              'DetachedTurnFailedError',
              `detached turn ${ref.sessionId} failed: ${result.error ?? 'provider returned success=false'}`,
            ),
          )
        }
        const turn = { text: result.text, result }
        const output = await options.settleOutput(turn, record, { signal: ctx.signal })
        if (ctx.signal.aborted) throwAbort()
        return await finishResumeTick(cancellationHooks, record.taskId, environment, {
          state: 'completed',
          output,
        })
      } catch (error) {
        const cleanedOnAbort = await releaseResumeCancellation(cancellationHooks, record.taskId)
        if (!cleanedOnAbort) await destroyEnvironmentSafe(environment)
        throw error
      }
    },
  }
}

interface ResumeCancellationHook {
  signal: AbortSignal
  onAbort: () => void
  cleanup?: Promise<void>
}

function attachResumeCancellation(
  hooks: Map<string, ResumeCancellationHook>,
  taskId: string,
  signal: AbortSignal,
  environment: AgentEnvironment,
  session: AgentSession,
): void {
  if (hooks.has(taskId) || signal.aborted) return
  const hook: ResumeCancellationHook = {
    signal,
    onAbort: () => {
      hook.cleanup ??= Promise.allSettled([
        Promise.resolve().then(() => session.cancel()),
        destroyEnvironmentSafe(environment),
      ]).then(() => {})
    },
  }
  hooks.set(taskId, hook)
  signal.addEventListener('abort', hook.onAbort, { once: true })
}

async function releaseResumeCancellation(
  hooks: Map<string, ResumeCancellationHook>,
  taskId: string,
): Promise<boolean> {
  const hook = hooks.get(taskId)
  if (!hook) return false
  hooks.delete(taskId)
  hook.signal.removeEventListener('abort', hook.onAbort)
  await hook.cleanup
  return hook.cleanup !== undefined
}

async function finishResumeTick(
  hooks: Map<string, ResumeCancellationHook>,
  taskId: string,
  environment: AgentEnvironment,
  tick: DelegationResumeTick,
): Promise<DelegationResumeTick> {
  const cleanedOnAbort = await releaseResumeCancellation(hooks, taskId)
  if (!cleanedOnAbort) await destroyEnvironmentSafe(environment)
  return tick
}

function isTerminalSessionStatus(status: AgentSessionStatus): boolean {
  return (
    status === 'completed' ||
    status === 'stopped' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'expired'
  )
}

function failedTick(kind: string, message: string): DelegationResumeTick {
  return { state: 'failed', error: { kind, message } }
}
