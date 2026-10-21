import {
  type AgentExactRunControlRef,
  AgentTurnResultSchema,
  canonicalCandidateDigest,
  type InteractionAcknowledgement,
  InteractionAcknowledgementSchema,
  InteractionResponseCommandSchema,
  type NativeContextBoundaryProof,
  NativeContextBoundaryProofSchema,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentSession,
  AgentSessionStatus,
} from '@tangle-network/agent-interface/environment-provider'
import {
  assertBoundaryBinding,
  assertInteractionBinding,
  assertResultBinding,
  assertStableText,
  assertWaitDuration,
  awaitAbortable,
  cancellationRequest,
  copyControlRef,
  delay,
  exactSessionCancel,
  exactSessionResult,
  hasDurableCancel,
  isTerminalSessionStatus,
  RetainedRunProviderContractError,
} from './retained-run-binding'
import { RetainedRunControl } from './retained-run-control'
import { retainedRunEvents } from './retained-run-events'
import {
  beginNativeContinuation,
  executeNativeContinuation,
} from './retained-run-native-continuation'
import type {
  RetainedRunCancellation,
  RetainedRunEffect,
  RetainedRunHandle,
  RetainedRunSnapshot,
} from './retained-run-types'
import { abortError } from './util'

async function snapshot(
  control: RetainedRunControl,
  clock: () => number,
  reason?: string,
  signal?: AbortSignal,
): Promise<RetainedRunSnapshot> {
  if (signal?.aborted) throw abortError(signal.reason)
  control.sync()
  let status: AgentSessionStatus | null
  try {
    status = await awaitAbortable(
      Promise.resolve().then(() => control.session.status({ signal })),
      signal,
    )
  } catch {
    if (signal?.aborted) throw abortError(signal.reason)
    status = 'unknown'
  }
  control.sync()
  const effect: RetainedRunEffect =
    status === 'cancelled'
      ? 'cancelled'
      : status === 'completed' || status === 'failed' || status === 'expired'
        ? 'not_live'
        : 'unknown'
  return {
    runId: control.current.runId,
    controlRef: copyControlRef(control.current),
    status,
    effect,
    observedAt: new Date(clock()).toISOString(),
    ...(reason === undefined ? {} : { reason }),
    ...(signal?.aborted ? { signal: String(signal.reason ?? 'aborted') } : {}),
  }
}

async function retainedStatus(
  control: RetainedRunControl,
  clock: () => number,
  options: Parameters<RetainedRunHandle['status']>[0],
): Promise<RetainedRunSnapshot> {
  const waitMs = options?.waitMs ?? 0
  assertWaitDuration(waitMs, 'retained status wait')
  const initial = await snapshot(control, clock, undefined, options?.signal)
  if (waitMs === 0 || isTerminalSessionStatus(initial.status)) return initial
  const deadline = Date.now() + waitMs
  let current = initial
  while (Date.now() < deadline) {
    await delay(Math.min(25, Math.max(1, deadline - Date.now())), options?.signal)
    current = await snapshot(control, clock, undefined, options?.signal)
    if (current.status !== initial.status || isTerminalSessionStatus(current.status)) {
      return current
    }
  }
  return current
}

async function retainedResult(control: RetainedRunControl) {
  control.sync()
  let candidate: unknown
  try {
    candidate = await exactSessionResult(control.session)
  } catch (error) {
    if (error instanceof RetainedRunProviderContractError) throw error
    throw new RetainedRunProviderContractError(
      error instanceof Error ? error.message : 'provider retained result read failed',
      { code: 'RETAINED_RESULT_READ_FAILED', cause: error },
    )
  }
  const parsed = AgentTurnResultSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new RetainedRunProviderContractError('provider returned an invalid retained result', {
      code: 'RETAINED_RESULT_SCHEMA_INVALID',
      cause: parsed.error,
    })
  }
  control.sync()
  try {
    assertResultBinding(control.current, parsed.data)
  } catch (error) {
    throw new RetainedRunProviderContractError(
      error instanceof Error ? error.message : 'provider returned an unbound retained result',
      { code: 'RETAINED_RESULT_BINDING_INVALID', cause: error },
    )
  }
  return structuredClone(parsed.data)
}

async function respondToRetainedInteraction(
  environment: AgentEnvironment,
  control: RetainedRunControl,
  capabilities: AgentEnvironmentCapabilities,
  command: Parameters<RetainedRunHandle['respondToInteraction']>[0],
  options: Parameters<RetainedRunHandle['respondToInteraction']>[1],
): Promise<InteractionAcknowledgement> {
  const { session } = control
  control.sync()
  const exactCommand = InteractionResponseCommandSchema.parse(command)
  assertInteractionBinding(control.current, exactCommand)
  if (
    capabilities.interactions?.replay !== true ||
    capabilities.interactions.responseIdempotency !== true
  ) {
    throw new Error(
      `provider "${control.current.provider}" does not promise retry-safe interaction responses`,
    )
  }
  const respond = session.respondToInteraction ?? environment.respondToInteraction
  if (!respond) {
    throw new Error(`provider "${control.current.provider}" does not support interaction responses`)
  }
  const acknowledgement = InteractionAcknowledgementSchema.parse(
    await awaitAbortable(
      Promise.resolve().then(() =>
        respond.call(session.respondToInteraction ? session : environment, exactCommand, options),
      ),
      options?.signal,
    ),
  )
  control.sync()
  if (
    acknowledgement.operationId !== exactCommand.operationId ||
    acknowledgement.commandDigest !== exactCommand.commandDigest ||
    canonicalCandidateDigest(acknowledgement.binding) !==
      canonicalCandidateDigest(exactCommand.binding)
  ) {
    throw new Error('provider returned an interaction acknowledgement for another command')
  }
  return structuredClone(acknowledgement)
}

async function retainedContextBoundary(
  control: RetainedRunControl,
  options: Parameters<RetainedRunHandle['contextBoundary']>[0],
): Promise<NativeContextBoundaryProof | null> {
  const { session } = control
  control.sync()
  if (!session.contextBoundary) return null
  const proof = await awaitAbortable(
    Promise.resolve().then(() => session.contextBoundary!(options)),
    options?.signal,
  )
  control.sync()
  if (proof === null) return null
  const exactProof = NativeContextBoundaryProofSchema.parse(proof)
  assertBoundaryBinding(control.current, exactProof)
  return structuredClone(exactProof)
}

async function cancelRetainedRun(
  control: RetainedRunControl,
  clock: () => number,
  options: Parameters<RetainedRunHandle['cancel']>[0],
): Promise<RetainedRunCancellation> {
  control.sync()
  assertStableText(options.operationId, 'retained cancellation operation id')
  if (options.reason !== undefined) assertStableText(options.reason, 'retained cancellation reason')
  if (options.signal?.aborted) throw abortError(options.signal.reason)
  if (!hasDurableCancel(control.session)) {
    throw new Error(
      `provider "${control.current.provider}" does not expose durable cancellation operations`,
    )
  }
  const request = cancellationRequest(control.current, options.operationId, options.reason)
  let effect: RetainedRunEffect = 'unknown'
  let providerStatus: RetainedRunCancellation['status'] | undefined
  try {
    const acknowledgement = await exactSessionCancel(control.session, request, {
      signal: options.signal,
    })
    effect = acknowledgement.effect
    providerStatus = acknowledgement.status
  } catch (error) {
    if (error instanceof RetainedRunProviderContractError) throw error
    if (error instanceof Error && error.name === 'AbortError') throw error
    effect = 'unknown'
  }
  const current = await snapshot(control, clock, options.reason, options.signal)
  const observedEffect =
    effect === 'unknown' && providerStatus === undefined && current.status === 'cancelled'
      ? 'cancelled'
      : effect
  return structuredClone({
    operationId: options.operationId,
    requestDigest: request.requestDigest,
    status: providerStatus ?? (observedEffect === 'unknown' ? 'unknown' : ('accepted' as const)),
    effect: observedEffect,
    snapshot: { ...current, effect: observedEffect },
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.signal?.aborted ? { signal: String(options.signal.reason ?? 'aborted') } : {}),
  })
}

export function createRetainedRunHandle(
  environment: AgentEnvironment,
  session: AgentSession,
  initialControlRef: AgentExactRunControlRef,
  capabilities: AgentEnvironmentCapabilities,
  now: (() => number) | undefined,
): RetainedRunHandle {
  const clock = now ?? Date.now
  const measuredCapabilities = structuredClone(capabilities)
  const control = new RetainedRunControl(session, initialControlRef)
  return {
    get controlRef() {
      control.sync()
      return copyControlRef(control.current)
    },
    get capabilities() {
      return structuredClone(measuredCapabilities)
    },
    status: (options) => retainedStatus(control, clock, options),
    events: (options) => {
      control.sync()
      return retainedRunEvents(session, copyControlRef(control.current), options, clock)
    },
    result: () => retainedResult(control),
    respondToInteraction: (command, options) =>
      respondToRetainedInteraction(environment, control, measuredCapabilities, command, options),
    contextBoundary: (options) => retainedContextBoundary(control, options),
    beginNativeContinuation: (request, turn) =>
      beginNativeContinuation(control, measuredCapabilities, request, turn),
    continueNative: (request, turn) =>
      executeNativeContinuation(control, measuredCapabilities, request, turn),
    cancel: (options) => cancelRetainedRun(control, clock, options),
  }
}
