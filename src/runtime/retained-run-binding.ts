import {
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
  type AgentRunCancellationAcknowledgement,
  AgentRunCancellationAcknowledgementSchema,
  type AgentRunCancellationRequest,
  AgentRunCancellationRequestSchema,
  agentRunCancellationAcknowledgementMatchesRequest,
  agentRunCancellationRequestDigest,
  canonicalCandidateDigest,
  type InteractionResponseCommand,
  type NativeContextBoundaryProof,
  type StreamEvent,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentSession,
  AgentSessionStatus,
  AgentTurnResult,
} from '@tangle-network/agent-interface/environment-provider'

export function exactSession(
  environment: AgentEnvironment,
  controlRef: AgentExactRunControlRef,
): { session: AgentSession; controlRef: AgentExactRunControlRef } {
  if (environment.id !== controlRef.environmentId || environment.provider !== controlRef.provider) {
    throw new Error('provider reconstructed a different retained environment')
  }
  if (!environment.session || !controlRef.sessionId) {
    throw new Error('retained run control requires a provider session id')
  }
  const session = environment.session(controlRef.sessionId, { controlRef })
  if (session.id !== controlRef.sessionId) {
    throw new Error('provider reconstructed a different session')
  }
  if (session.controlRef === undefined) {
    throw new Error('provider session did not return its provider-owned run control reference')
  }
  const currentControlRef = AgentExactRunControlRefSchema.parse(session.controlRef)
  if (!sameControlCoordinates(currentControlRef, controlRef)) {
    throw new Error('provider session reconstructed a different retained session')
  }
  if (canonicalCandidateDigest(currentControlRef) !== canonicalCandidateDigest(controlRef)) {
    throw new Error('provider session did not retain the exact run control reference')
  }
  return { session, controlRef: currentControlRef }
}

export function sameControlCoordinates(
  left: AgentExactRunControlRef,
  right: AgentExactRunControlRef,
): boolean {
  return canonicalCandidateDigest(left) === canonicalCandidateDigest(right)
}

export function freezeControlRef(controlRef: AgentExactRunControlRef): AgentExactRunControlRef {
  return Object.freeze({ ...AgentExactRunControlRefSchema.parse(controlRef) })
}

export function copyControlRef(controlRef: AgentExactRunControlRef): AgentExactRunControlRef {
  return { ...controlRef }
}

export function exactControlRef(
  candidate: unknown,
  expected: { provider: string; environmentId: string; sessionId: string },
): AgentExactRunControlRef {
  if (!candidate) throw new Error('provider dispatch returned no durable run control reference')
  const controlRef = AgentExactRunControlRefSchema.parse(candidate)
  if (
    controlRef.provider !== expected.provider ||
    controlRef.environmentId !== expected.environmentId ||
    controlRef.sessionId !== expected.sessionId
  ) {
    throw new Error('provider dispatch returned control coordinates for another run')
  }
  return controlRef
}

export function exactContinuedControlRef(
  candidate: AgentExactRunControlRef,
  initial: AgentExactRunControlRef,
): AgentExactRunControlRef {
  const controlRef = AgentExactRunControlRefSchema.parse(candidate)
  if (
    controlRef.provider !== initial.provider ||
    controlRef.environmentId !== initial.environmentId ||
    controlRef.sessionId !== initial.sessionId
  ) {
    throw new Error('provider continuation advanced to another retained session')
  }
  if (controlRef.runId === initial.runId && controlRef.executionId === initial.executionId) {
    throw new Error('provider continuation did not return a new exact run execution')
  }
  return controlRef
}

export function assertInteractionBinding(
  controlRef: AgentExactRunControlRef,
  command: InteractionResponseCommand,
): void {
  // This digest identifies the interaction request, not the retained turn.
  // The provider validates it against its durable interaction record.
  if (
    command.binding.runId !== controlRef.runId ||
    command.binding.provider !== controlRef.provider ||
    command.binding.environmentId !== controlRef.environmentId ||
    command.binding.sessionId !== controlRef.sessionId ||
    command.binding.executionId !== controlRef.executionId
  ) {
    throw new Error('interaction response command does not target this retained run')
  }
}

export function assertBoundaryBinding(
  controlRef: AgentExactRunControlRef,
  proof: NativeContextBoundaryProof,
): void {
  if (
    proof.runId !== controlRef.runId ||
    proof.provider !== controlRef.provider ||
    proof.environmentId !== controlRef.environmentId ||
    proof.sessionId !== controlRef.sessionId ||
    proof.executionId !== controlRef.executionId ||
    proof.requestDigest !== controlRef.requestDigest
  ) {
    throw new Error('native context proof does not identify this retained run')
  }
}

export function assertSequence(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
}

export function assertResultBinding(
  controlRef: AgentExactRunControlRef,
  result: AgentTurnResult,
): void {
  if (result.sessionId !== controlRef.sessionId) {
    throw new Error('provider returned a result for another retained session')
  }
  const metadata = result.metadata
  if (controlRef.executionId !== undefined && metadata?.executionId !== controlRef.executionId) {
    throw new Error('provider returned a result for another retained execution')
  }
  if (metadata?.runId !== controlRef.runId) {
    throw new Error('provider returned a result for another retained run')
  }
  if (metadata?.requestDigest !== controlRef.requestDigest) {
    throw new Error('provider returned a result for another retained request')
  }
}

interface ExactCancelOptions {
  readonly signal?: AbortSignal
}

export class RetainedRunProviderContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetainedRunProviderContractError'
  }
}

export function cancellationRequest(
  controlRef: AgentExactRunControlRef,
  operationId: string,
  reason?: string,
): AgentRunCancellationRequest {
  const material = {
    operationId,
    run: AgentExactRunControlRefSchema.parse(controlRef),
    ...(reason === undefined ? {} : { reason }),
  }
  return AgentRunCancellationRequestSchema.parse({
    ...material,
    requestDigest: agentRunCancellationRequestDigest(material),
  })
}

export async function exactSessionCancel(
  session: AgentSession,
  request: AgentRunCancellationRequest,
  options: ExactCancelOptions,
): Promise<AgentRunCancellationAcknowledgement> {
  if (!session.cancelRun) {
    throw new Error('provider session does not expose durable cancellation operations')
  }
  let acknowledgement: unknown
  try {
    acknowledgement = await awaitAbortable(
      Promise.resolve().then(() => session.cancelRun!(request, options)),
      options.signal,
    )
  } catch (error) {
    if (error instanceof RetainedRunProviderContractError) throw error
    throw error
  }
  let exactAcknowledgement: AgentRunCancellationAcknowledgement
  try {
    exactAcknowledgement = AgentRunCancellationAcknowledgementSchema.parse(acknowledgement)
  } catch {
    throw new RetainedRunProviderContractError(
      'provider returned an invalid retained cancellation acknowledgement',
    )
  }
  if (!agentRunCancellationAcknowledgementMatchesRequest(request, exactAcknowledgement)) {
    throw new RetainedRunProviderContractError(
      'provider returned a retained cancellation acknowledgement for another request',
    )
  }
  return exactAcknowledgement
}

export function hasDurableCancel(session: AgentSession): boolean {
  return typeof session.cancelRun === 'function'
}

export async function awaitAbortable<T>(
  work: PromiseLike<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return await work
  if (signal.aborted) {
    void Promise.resolve(work).catch(() => undefined)
    throw abortError(signal.reason)
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      queueMicrotask(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(abortError(signal.reason))
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(work).then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

export async function exactSessionResult(session: AgentSession): Promise<AgentTurnResult> {
  return session.result()
}

export function assertEventBinding(
  source: AgentEnvironmentEvent,
  controlRef: AgentExactRunControlRef,
): void {
  const transport = isRecord(source) ? source : undefined
  const payload = isRecord(source.data) ? source.data : undefined
  const providerEvent = isRecord(source.providerEvent) ? source.providerEvent : undefined
  const bindings = [
    { value: transport, checkSessionId: true },
    {
      value: payload,
      // The canonical session.updated payload identifies the harness-native chat.
      // It is event content, not the retained provider session coordinate.
      checkSessionId: source.type !== 'session.updated',
    },
    { value: providerEvent, checkSessionId: true },
  ]
  for (const { value, checkSessionId } of bindings) {
    if (value === undefined) continue
    if (value.runId !== undefined && value.runId !== controlRef.runId) {
      throw new Error('provider returned an event for another retained run')
    }
    if (value.executionId !== undefined && value.executionId !== controlRef.executionId) {
      throw new Error('provider returned an event for another retained execution')
    }
    if (
      checkSessionId &&
      value.sessionId !== undefined &&
      value.sessionId !== controlRef.sessionId
    ) {
      throw new Error('provider returned an event for another retained session')
    }
  }
}

/** Validate the nested coordinates carried by a canonical interaction request. */
export function assertCanonicalEventBinding(
  controlRef: AgentExactRunControlRef,
  event: StreamEvent,
): void {
  if (event.type !== 'interaction') return
  const binding = event.request.binding
  if (
    binding.runId !== controlRef.runId ||
    binding.provider !== controlRef.provider ||
    binding.environmentId !== controlRef.environmentId ||
    binding.sessionId !== controlRef.sessionId ||
    binding.executionId !== controlRef.executionId ||
    binding.interactionId !== event.request.id
  ) {
    throw new Error('provider returned an interaction for another retained execution')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function assertStableText(value: string, label: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be non-empty and have no outer whitespace`)
  }
}

export function abortError(reason: unknown): Error {
  const error = new Error(
    reason instanceof Error ? reason.message : reason === undefined ? 'aborted' : String(reason),
  )
  error.name = 'AbortError'
  return error
}

export function assertWaitDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
}

/**
 * Whether a session can still change state.
 *
 * Exhaustive over `AgentSessionStatus` by construction: the map below is `satisfies
 * Record<AgentSessionStatus, boolean>`, so a member added upstream fails to compile here instead of
 * being silently classified as non-terminal. Written as a boolean chain, `stopped` was missing —
 * and a `status({ waitMs })` call on an already-stopped session then polled every 25 ms for the
 * whole wait before returning the answer it already had at the first snapshot.
 *
 * `unknown` is deliberately NOT terminal: it says the provider could not tell us, which is the one
 * state where continuing to poll is the point. That differs from
 * `sandboxSessionStatusFromAgentSessionStatus`, which projects `unknown` to `failed` because a run
 * RESULT must never claim success without proof — a different question about the same word.
 */
const sessionStatusIsTerminal = {
  pending: false,
  provisioning: false,
  running: false,
  unknown: false,
  stopped: true,
  completed: true,
  cancelled: true,
  failed: true,
  expired: true,
} satisfies Record<AgentSessionStatus, boolean>

export function isTerminalSessionStatus(status: AgentSessionStatus | null): boolean {
  return status !== null && sessionStatusIsTerminal[status]
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal.reason))
  return new Promise((resolveDelay, rejectDelay) => {
    const timer = setTimeout(finish, ms)
    function finish() {
      signal?.removeEventListener('abort', onAbort)
      resolveDelay()
    }
    function onAbort() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      rejectDelay(abortError(signal?.reason))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
