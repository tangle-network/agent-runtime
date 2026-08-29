import {
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
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
  const measuredCapabilities = structuredClone(capabilities)
  let activeControlRef = freezeControlRef(initialControlRef)
  // A provider may expose the previous reference while a terminal read catches up.
  // Remember references seen by this handle so that read cannot move control backwards.
  const knownControlRefDigests = new Set([canonicalCandidateDigest(activeControlRef)])
  const synchronizeActiveControlRef = (): void => {
    let candidate: unknown
    try {
      candidate = session.controlRef
    } catch (error) {
      throw new RetainedRunProviderContractError(
        'provider retained session control reference read failed',
        { code: 'RETAINED_CONTROL_REF_READ_FAILED', cause: error },
      )
    }
    if (candidate === undefined) return
    const parsed = AgentExactRunControlRefSchema.safeParse(candidate)
    if (!parsed.success) {
      throw new RetainedRunProviderContractError(
        'provider retained session returned an invalid current control reference',
        { code: 'RETAINED_CONTROL_REF_INVALID', cause: parsed.error },
      )
    }
    const candidateDigest = canonicalCandidateDigest(parsed.data)
    if (
      sameControlCoordinates(parsed.data, activeControlRef) ||
      knownControlRefDigests.has(candidateDigest)
    ) {
      return
    }
    try {
      activeControlRef = freezeControlRef(exactContinuedControlRef(parsed.data, activeControlRef))
      knownControlRefDigests.add(candidateDigest)
    } catch (error) {
      throw new RetainedRunProviderContractError(
        'provider retained session advanced to an invalid control reference',
        { code: 'RETAINED_CONTROL_REF_ADVANCE_INVALID', cause: error },
      )
    }
  }
  const snapshot = async (reason?: string, signal?: AbortSignal): Promise<RetainedRunSnapshot> => {
    if (signal?.aborted) throw abortError(signal.reason)
    synchronizeActiveControlRef()
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
    synchronizeActiveControlRef()
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
      synchronizeActiveControlRef()
      return copyControlRef(activeControlRef)
    },
    get capabilities() {
      return structuredClone(measuredCapabilities)
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
    events: (options) => {
      synchronizeActiveControlRef()
      return retainedRunEvents(session, copyControlRef(activeControlRef), options, clock)
    },
    result: async () => {
      synchronizeActiveControlRef()
      let candidate: unknown
      try {
        candidate = await exactSessionResult(session)
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
      synchronizeActiveControlRef()
      try {
        assertResultBinding(activeControlRef, parsed.data)
      } catch (error) {
        throw new RetainedRunProviderContractError(
          error instanceof Error ? error.message : 'provider returned an unbound retained result',
          { code: 'RETAINED_RESULT_BINDING_INVALID', cause: error },
        )
      }
      return structuredClone(parsed.data)
    },
    async respondToInteraction(command, options): Promise<InteractionAcknowledgement> {
      synchronizeActiveControlRef()
      const exactCommand = InteractionResponseCommandSchema.parse(command)
      assertInteractionBinding(activeControlRef, exactCommand)
      if (
        measuredCapabilities.interactions?.replay !== true ||
        measuredCapabilities.interactions.responseIdempotency !== true
      ) {
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
      synchronizeActiveControlRef()
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
      synchronizeActiveControlRef()
      if (!session.contextBoundary) return null
      const proof = await awaitAbortable(
        Promise.resolve().then(() => session.contextBoundary!(options)),
        options?.signal,
      )
      synchronizeActiveControlRef()
      if (proof === null) return null
      const exactProof = NativeContextBoundaryProofSchema.parse(proof)
      assertBoundaryBinding(activeControlRef, exactProof)
      return structuredClone(exactProof)
    },
    async continueNative(request, turn): Promise<NativeContextContinuationExecution> {
      synchronizeActiveControlRef()
      const exactRequest = NativeContextContinuationRequestSchema.parse(request)
      if (!sameControlCoordinates(exactRequest.run, activeControlRef)) {
        throw new Error('native continuation request targets another retained run')
      }
      const { timeoutMs, signal, ...semanticTurn } = turn
      if (nativeContextContinuationTurnDigest(semanticTurn) !== exactRequest.turnDigest) {
        throw new Error('native continuation request targets another user turn')
      }
      if (
        measuredCapabilities.nativeContinuation?.atomicBoundary !== true ||
        measuredCapabilities.nativeContinuation.requestIdempotency !== true ||
        !session.continueNative
      ) {
        throw new Error(
          `provider "${activeControlRef.provider}" does not support retry-safe native continuation`,
        )
      }
      const continuationSource = activeControlRef
      let outcome: NativeContextContinuationExecution
      try {
        outcome = AgentNativeContextContinuationResultSchema.parse(
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
      } catch (error) {
        try {
          synchronizeActiveControlRef()
        } catch (syncError) {
          throw new AggregateError(
            [error, syncError],
            'native continuation failed and its current control reference could not be read',
          )
        }
        throw error
      }
      synchronizeActiveControlRef()
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
      const nextControlRef = exactContinuedControlRef(outcome.controlRef, continuationSource)
      if (
        !sameControlCoordinates(activeControlRef, continuationSource) &&
        !sameControlCoordinates(activeControlRef, nextControlRef)
      ) {
        throw new Error(
          'provider advanced the retained session while another native continuation was pending',
        )
      }
      assertResultBinding(nextControlRef, outcome.result)
      activeControlRef = freezeControlRef(nextControlRef)
      knownControlRefDigests.add(canonicalCandidateDigest(activeControlRef))
      return structuredClone({ ...outcome, controlRef: copyControlRef(activeControlRef) })
    },
    async cancel(options): Promise<RetainedRunCancellation> {
      synchronizeActiveControlRef()
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
