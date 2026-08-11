import {
  type AgentExactRunControlRef,
  AgentNativeContextContinuationResultSchema,
  AgentTurnResultSchema,
  agentNativeContextContinuationResultMatchesRequest,
  canonicalCandidateDigest,
  type InteractionAcknowledgement,
  InteractionAcknowledgementSchema,
  InteractionResponseCommandSchema,
  type NativeContextBoundaryProof,
  NativeContextBoundaryProofSchema,
  NativeContextContinuationRequestSchema,
  nativeContextContinuationTurnDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentSession,
  AgentSessionStatus,
} from '@tangle-network/agent-interface/environment-provider'
import {
  abortError,
  assertBoundaryBinding,
  assertInteractionBinding,
  assertResultBinding,
  assertStableText,
  assertWaitDuration,
  awaitAbortable,
  cancellationRequest,
  copyControlRef,
  delay,
  exactContinuedControlRef,
  exactSessionCancel,
  exactSessionResult,
  freezeControlRef,
  hasDurableCancel,
  isTerminalSessionStatus,
  RetainedRunProviderContractError,
  sameControlCoordinates,
} from './retained-run-binding'
import { retainedRunEvents } from './retained-run-events'
import type {
  NativeContextContinuationExecution,
  RetainedRunCancellation,
  RetainedRunEffect,
  RetainedRunHandle,
  RetainedRunSnapshot,
} from './retained-run-types'

export function createRetainedRunHandle(
  environment: AgentEnvironment,
  session: AgentSession,
  initialControlRef: AgentExactRunControlRef,
  capabilities: AgentEnvironmentCapabilities,
  now: (() => number) | undefined,
): RetainedRunHandle {
  const clock = now ?? Date.now
  let activeControlRef = freezeControlRef(initialControlRef)
  const snapshot = async (reason?: string, signal?: AbortSignal): Promise<RetainedRunSnapshot> => {
    if (signal?.aborted) throw abortError(signal.reason)
    let status: AgentSessionStatus | null
    try {
      status = await awaitAbortable(
        Promise.resolve().then(() => session.status({ signal })),
        signal,
      )
    } catch {
      if (signal?.aborted) throw abortError(signal.reason)
      status = 'unknown'
    }
    const effect: RetainedRunEffect =
      status === 'cancelled'
        ? 'cancelled'
        : status === 'completed' || status === 'failed' || status === 'expired'
          ? 'not_live'
          : 'unknown'
    return {
      runId: activeControlRef.runId,
      controlRef: copyControlRef(activeControlRef),
      status,
      effect,
      observedAt: new Date(clock()).toISOString(),
      ...(reason === undefined ? {} : { reason }),
      ...(signal?.aborted ? { signal: String(signal.reason ?? 'aborted') } : {}),
    }
  }
  return {
    get controlRef() {
      return copyControlRef(activeControlRef)
    },
    status: async (options) => {
      const waitMs = options?.waitMs ?? 0
      assertWaitDuration(waitMs, 'retained status wait')
      const initial = await snapshot(undefined, options?.signal)
      if (waitMs === 0 || isTerminalSessionStatus(initial.status)) return initial
      const deadline = Date.now() + waitMs
      let current = initial
      while (Date.now() < deadline) {
        await delay(Math.min(25, Math.max(1, deadline - Date.now())), options?.signal)
        current = await snapshot(undefined, options?.signal)
        if (current.status !== initial.status || isTerminalSessionStatus(current.status)) {
          return current
        }
      }
      return current
    },
    events: (options) =>
      retainedRunEvents(session, copyControlRef(activeControlRef), options, clock),
    result: async () => {
      const result = AgentTurnResultSchema.parse(await exactSessionResult(session))
      assertResultBinding(activeControlRef, result)
      return structuredClone(result)
    },
    async respondToInteraction(command, options): Promise<InteractionAcknowledgement> {
      const exactCommand = InteractionResponseCommandSchema.parse(command)
      assertInteractionBinding(activeControlRef, exactCommand)
      if (capabilities.interactions?.responseIdempotency !== true) {
        throw new Error(
          `provider "${activeControlRef.provider}" does not promise retry-safe interaction responses`,
        )
      }
      const respond = session.respondToInteraction ?? environment.respondToInteraction
      if (!respond) {
        throw new Error(
          `provider "${activeControlRef.provider}" does not support interaction responses`,
        )
      }
      const acknowledgement = InteractionAcknowledgementSchema.parse(
        await awaitAbortable(
          Promise.resolve().then(() =>
            respond.call(
              session.respondToInteraction ? session : environment,
              exactCommand,
              options,
            ),
          ),
          options?.signal,
        ),
      )
      if (
        acknowledgement.operationId !== exactCommand.operationId ||
        acknowledgement.commandDigest !== exactCommand.commandDigest ||
        canonicalCandidateDigest(acknowledgement.binding) !==
          canonicalCandidateDigest(exactCommand.binding)
      ) {
        throw new Error('provider returned an interaction acknowledgement for another command')
      }
      return structuredClone(acknowledgement)
    },
    async contextBoundary(options): Promise<NativeContextBoundaryProof | null> {
      if (!session.contextBoundary) return null
      const proof = await awaitAbortable(
        Promise.resolve().then(() => session.contextBoundary!(options)),
        options?.signal,
      )
      if (proof === null) return null
      const exactProof = NativeContextBoundaryProofSchema.parse(proof)
      assertBoundaryBinding(activeControlRef, exactProof)
      return structuredClone(exactProof)
    },
    async continueNative(request, turn): Promise<NativeContextContinuationExecution> {
      const exactRequest = NativeContextContinuationRequestSchema.parse(request)
      if (!sameControlCoordinates(exactRequest.run, activeControlRef)) {
        throw new Error('native continuation request targets another retained run')
      }
      const { timeoutMs, signal, ...semanticTurn } = turn
      if (nativeContextContinuationTurnDigest(semanticTurn) !== exactRequest.turnDigest) {
        throw new Error('native continuation request targets another user turn')
      }
      if (
        capabilities.nativeContinuation?.atomicBoundary !== true ||
        capabilities.nativeContinuation.requestIdempotency !== true ||
        !session.continueNative
      ) {
        throw new Error(
          `provider "${activeControlRef.provider}" does not support retry-safe native continuation`,
        )
      }
      const outcome = AgentNativeContextContinuationResultSchema.parse(
        await awaitAbortable(
          Promise.resolve().then(() =>
            session.continueNative!(exactRequest, {
              turn: semanticTurn,
              ...(timeoutMs === undefined ? {} : { timeoutMs }),
              ...(signal === undefined ? {} : { signal }),
            }),
          ),
          signal,
        ),
      )
      if (
        outcome.acknowledgement.operationId !== exactRequest.operationId ||
        outcome.acknowledgement.requestDigest !== exactRequest.requestDigest
      ) {
        throw new Error('provider returned a native continuation result for another request')
      }
      if (outcome.acknowledgement.actualBoundary !== undefined) {
        const actualBoundary = NativeContextBoundaryProofSchema.parse(
          outcome.acknowledgement.actualBoundary,
        )
        assertBoundaryBinding(exactRequest.run, actualBoundary)
      }
      if (
        outcome.acknowledgement.status !== 'accepted' &&
        outcome.acknowledgement.status !== 'replayed'
      ) {
        return structuredClone(outcome)
      }
      if (!('result' in outcome) || !('controlRef' in outcome)) {
        throw new Error('provider omitted the successful native continuation result')
      }
      if (!agentNativeContextContinuationResultMatchesRequest(exactRequest, outcome)) {
        throw new Error('provider returned a native continuation result for another request')
      }
      const nextControlRef = exactContinuedControlRef(outcome.controlRef, activeControlRef)
      assertResultBinding(nextControlRef, outcome.result)
      activeControlRef = freezeControlRef(nextControlRef)
      return structuredClone({ ...outcome, controlRef: copyControlRef(activeControlRef) })
    },
    async cancel(options): Promise<RetainedRunCancellation> {
      assertStableText(options.operationId, 'retained cancellation operation id')
      if (options.reason !== undefined)
        assertStableText(options.reason, 'retained cancellation reason')
      if (options.signal?.aborted) throw abortError(options.signal.reason)
      if (!hasDurableCancel(session)) {
        throw new Error(
          `provider "${activeControlRef.provider}" does not expose durable cancellation operations`,
        )
      }
      const request = cancellationRequest(activeControlRef, options.operationId, options.reason)
      let effect: RetainedRunEffect = 'unknown'
      let providerStatus: RetainedRunCancellation['status'] | undefined
      try {
        const acknowledgement = await exactSessionCancel(session, request, {
          signal: options.signal,
        })
        effect = acknowledgement.effect
        providerStatus = acknowledgement.status
      } catch (error) {
        if (error instanceof RetainedRunProviderContractError) throw error
        if (error instanceof Error && error.name === 'AbortError') throw error
        effect = 'unknown'
      }
      const current = await snapshot(options.reason, options.signal)
      const observedEffect =
        effect === 'unknown' && providerStatus === undefined && current.status === 'cancelled'
          ? 'cancelled'
          : effect
      const acknowledgement: RetainedRunCancellation = {
        operationId: options.operationId,
        requestDigest: request.requestDigest,
        status:
          providerStatus ?? (observedEffect === 'unknown' ? 'unknown' : ('accepted' as const)),
        effect: observedEffect,
        snapshot: { ...current, effect: observedEffect },
        ...(options.reason === undefined ? {} : { reason: options.reason }),
        ...(options.signal?.aborted ? { signal: String(options.signal.reason ?? 'aborted') } : {}),
      }
      return structuredClone(acknowledgement)
    },
  }
}
