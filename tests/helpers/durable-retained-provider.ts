import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  type AgentExactRunControlRef,
  type AgentNativeContextContinuationResult,
  type AgentRunCancellationAcknowledgement,
  type AgentRunCancellationRequest,
  AgentRunCancellationRequestSchema,
  canonicalCandidateDigest,
  type InteractionAcknowledgement,
  type InteractionResponseCommand,
  interactionRequestDigest,
  type NativeContextBoundaryProof,
  type NativeContextContinuationRequest,
  NativeContextContinuationRequestSchema,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentNativeContextContinuationOptions,
  AgentSession,
  AgentSessionStatus,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'

interface StoredSession {
  readonly id: string
  controlRef: AgentExactRunControlRef
  status: AgentSessionStatus
  readonly events: AgentEnvironmentEvent[]
  readonly dispatches: Array<Record<string, unknown>>
  readonly prompts: Array<Record<string, unknown>>
  readonly interactionOperations: Record<
    string,
    { digest: string; acknowledgement: InteractionAcknowledgement }
  >
  readonly cancellationOperations: Record<
    string,
    { digest: string; status: 'accepted' | 'replayed'; effect: 'cancelled' | 'not_live' }
  >
  readonly nativeOperations: Record<
    string,
    {
      requestDigest: NativeContextContinuationRequest['requestDigest']
      result: AgentNativeContextContinuationResult
    }
  >
  readonly nativeResponseLosses: Record<string, boolean>
}

interface StoredEnvironment {
  readonly id: string
  readonly sessions: Record<string, StoredSession>
}

interface DurableProviderState {
  readonly environments: Record<string, StoredEnvironment>
}

/** Test-only provider whose complete control state is reconstructed from one JSON file. */
export function durableRetainedProvider(stateFile: string): AgentEnvironmentProvider {
  const providerName = 'durable-test'
  return {
    name: providerName,
    capabilities: retainedCapabilities,
    async create(input) {
      if (!input.idempotencyKey) throw new Error('durable test provider requires a create key')
      const state = readState(stateFile)
      const id = `environment-${input.idempotencyKey}`
      state.environments[id] ??= { id, sessions: {} }
      writeState(stateFile, state)
      return environmentFor(stateFile, providerName, id)
    },
    async get(id) {
      return readState(stateFile).environments[id]
        ? environmentFor(stateFile, providerName, id)
        : null
    },
  }
}

function environmentFor(stateFile: string, provider: string, id: string): AgentEnvironment {
  return {
    id,
    provider,
    status: async () => 'running',
    async *stream(): AsyncIterable<AgentEnvironmentEvent> {
      yield* []
    },
    async dispatch(input) {
      if (!input.turnId) throw new Error('durable test provider requires a turn key')
      const state = readState(stateFile)
      const environment = state.environments[id]
      if (!environment) throw new Error(`missing environment ${id}`)
      // Honor caller-requested identity, deriving only when it is absent —
      // the same contract as agent-provider-tangle's dispatch.
      const sessionId = input.sessionId ?? `session-${input.turnId}`
      const executionId = input.executionId ?? `execution-${input.turnId}`
      let session = environment.sessions[sessionId]
      if (!session) {
        const controlRef: AgentExactRunControlRef = {
          runId: `run-${input.turnId}`,
          provider,
          environmentId: id,
          sessionId,
          executionId,
          requestDigest: canonicalCandidateDigest({
            environmentId: id,
            sessionId,
            turnId: input.turnId,
            prompt: input.prompt ?? null,
            parts: input.parts ?? null,
          }),
        }
        session = {
          id: sessionId,
          controlRef,
          status: 'running',
          events: retainedEvents(controlRef),
          dispatches: [],
          prompts: [],
          interactionOperations: {},
          cancellationOperations: {},
          nativeOperations: {},
          nativeResponseLosses: {},
        }
        environment.sessions[sessionId] = session
      }
      session.dispatches.push(serializableTurn(input))
      writeState(stateFile, state)
      return { id: session.id, provider, controlRef: session.controlRef }
    },
    session(sessionId, options) {
      const stored = sessionState(stateFile, id, sessionId)
      if (
        options?.controlRef &&
        canonicalCandidateDigest(options.controlRef) !== canonicalCandidateDigest(stored.controlRef)
      ) {
        throw new Error('durable test provider received the wrong control reference')
      }
      return sessionFor(stateFile, id, stored)
    },
    async destroy() {
      const state = readState(stateFile)
      delete state.environments[id]
      writeState(stateFile, state)
    },
  }
}

function sessionFor(
  stateFile: string,
  environmentId: string,
  initial: StoredSession,
): AgentSession {
  return {
    id: initial.id,
    controlRef: initial.controlRef,
    async status() {
      return sessionState(stateFile, environmentId, initial.id).status
    },
    async *events(options): AsyncIterable<AgentEnvironmentEvent> {
      const current = sessionState(stateFile, environmentId, initial.id)
      const latestControlRef =
        Object.values(current.nativeOperations).at(-1)?.result.controlRef ?? current.controlRef
      const events = rebindInteractionEvents(current.events, latestControlRef)
      const start =
        options?.since === undefined
          ? 0
          : events.findIndex((event) => event.id === options.since) + 1
      if (options?.since !== undefined && start === 0) {
        throw new Error(`unknown event cursor ${options.since}`)
      }
      for (const event of events.slice(start)) yield structuredClone(event)
    },
    async result() {
      const current = sessionState(stateFile, environmentId, initial.id)
      const latest = Object.values(current.nativeOperations).at(-1)?.result.controlRef
      return {
        text: 'durable result',
        success: true,
        sessionId: initial.id,
        ...(latest?.executionId
          ? {
              metadata: {
                executionId: latest.executionId,
                runId: latest.runId,
                requestDigest: latest.requestDigest,
              },
            }
          : {
              metadata: {
                executionId: initial.controlRef.executionId,
                runId: initial.controlRef.runId,
                requestDigest: initial.controlRef.requestDigest,
              },
            }),
      }
    },
    async prompt(input) {
      const state = readState(stateFile)
      const session = requireSession(state, environmentId, initial.id)
      session.prompts.push(serializableTurn(input))
      writeState(stateFile, state)
      return { text: 'continued', success: true, sessionId: initial.id }
    },
    async respondToInteraction(command) {
      const state = readState(stateFile)
      const session = requireSession(state, environmentId, initial.id)
      const digest = canonicalCandidateDigest(command)
      const existing = session.interactionOperations[command.operationId]
      if (existing) {
        return existing.digest === digest
          ? existing.acknowledgement
          : acknowledgement(command, 'already_resolved_different')
      }
      const exact =
        (command.binding.runId === session.controlRef.runId ||
          command.binding.runId ===
            Object.values(session.nativeOperations).at(-1)?.result.controlRef.runId) &&
        command.binding.environmentId === environmentId &&
        command.binding.sessionId === initial.id &&
        command.binding.interactionId === 'interaction-1'
      const result = acknowledgement(command, exact ? 'accepted' : 'binding_mismatch')
      session.interactionOperations[command.operationId] = { digest, acknowledgement: result }
      writeState(stateFile, state)
      return result
    },
    async contextBoundary(): Promise<NativeContextBoundaryProof> {
      const current = sessionState(stateFile, environmentId, initial.id)
      return {
        runId: current.controlRef.runId,
        provider: current.controlRef.provider,
        environmentId,
        sessionId: initial.id,
        executionId: current.controlRef.executionId,
        requestDigest: current.controlRef.requestDigest,
        boundary: {
          kind: 'messages',
          messageIds: ['message-1'],
          digest: `sha256:${'1'.repeat(64)}`,
        },
        observedAt: '2026-08-02T00:00:03.000Z',
      }
    },
    async continueNative(
      request,
      options: AgentNativeContextContinuationOptions,
    ): Promise<AgentNativeContextContinuationResult> {
      const exactRequest = NativeContextContinuationRequestSchema.parse(request)
      const state = readState(stateFile)
      const session = requireSession(state, environmentId, initial.id)
      const prior = session.nativeOperations[exactRequest.operationId]
      if (prior) {
        if (prior.requestDigest !== exactRequest.requestDigest) {
          return {
            acknowledgement: {
              operationId: exactRequest.operationId,
              requestDigest: exactRequest.requestDigest,
              status: 'conflict',
              historyMessagesSent: 0,
              existingRequestDigest: prior.requestDigest,
            },
          }
        }
        return {
          ...structuredClone(prior.result),
          acknowledgement: { ...prior.result.acknowledgement, status: 'replayed' },
        }
      }
      if (
        exactRequest.run.provider !== session.controlRef.provider ||
        exactRequest.run.environmentId !== environmentId ||
        exactRequest.run.sessionId !== session.id ||
        exactRequest.expectedBoundary.runId !== exactRequest.run.runId ||
        exactRequest.expectedBoundary.provider !== session.controlRef.provider ||
        exactRequest.expectedBoundary.environmentId !== environmentId ||
        exactRequest.expectedBoundary.sessionId !== session.id
      ) {
        return {
          acknowledgement: {
            operationId: exactRequest.operationId,
            requestDigest: exactRequest.requestDigest,
            status: 'unknown_session',
            historyMessagesSent: 0,
          },
        }
      }
      const expectedBoundaryDigest = canonicalCandidateDigest(
        exactRequest.expectedBoundary.boundary,
      )
      const currentBoundaryDigest = canonicalCandidateDigest({
        kind: 'messages',
        messageIds: ['message-1'],
        digest: `sha256:${'1'.repeat(64)}`,
      })
      if (expectedBoundaryDigest !== currentBoundaryDigest) {
        return {
          acknowledgement: {
            operationId: exactRequest.operationId,
            requestDigest: exactRequest.requestDigest,
            status: 'boundary_mismatch',
            historyMessagesSent: 0,
            actualBoundary: nativeBoundaryFor(exactRequest.run),
          },
        }
      }
      if (options.turn.prompt === undefined && options.turn.parts === undefined) {
        return {
          acknowledgement: {
            operationId: exactRequest.operationId,
            requestDigest: exactRequest.requestDigest,
            status: 'transport_failure',
            historyMessagesSent: 0,
            message: 'continuation turn is empty',
          },
        }
      }
      const nextControlRef: AgentExactRunControlRef = {
        ...session.controlRef,
        runId: `native-run-${exactRequest.operationId}`,
        executionId: `native-execution-${exactRequest.operationId}`,
        requestDigest: exactRequest.requestDigest,
      }
      const result: AgentNativeContextContinuationResult = {
        acknowledgement: {
          operationId: exactRequest.operationId,
          requestDigest: exactRequest.requestDigest,
          status: 'accepted',
          historyMessagesSent: 0,
          actualBoundary: nativeBoundaryFor(exactRequest.run),
        },
        result: {
          text: 'continued',
          success: true,
          sessionId: session.id,
          metadata: {
            runId: nextControlRef.runId,
            executionId: nextControlRef.executionId,
            requestDigest: nextControlRef.requestDigest,
          },
        },
        controlRef: nextControlRef,
      }
      session.nativeOperations[exactRequest.operationId] = {
        requestDigest: exactRequest.requestDigest,
        result,
      }
      writeState(stateFile, state)
      if (
        exactRequest.operationId === 'restart-native-operation' &&
        !session.nativeResponseLosses[exactRequest.operationId]
      ) {
        session.nativeResponseLosses[exactRequest.operationId] = true
        writeState(stateFile, state)
        throw new Error('connection lost after continuation commit')
      }
      return structuredClone(result)
    },
    async cancelRun(
      request: AgentRunCancellationRequest,
    ): Promise<AgentRunCancellationAcknowledgement> {
      const exactRequest = AgentRunCancellationRequestSchema.parse(request)
      const state = readState(stateFile)
      const session = requireSession(state, environmentId, initial.id)
      const latestControlRef =
        Object.values(session.nativeOperations).at(-1)?.result.controlRef ?? session.controlRef
      if (
        canonicalCandidateDigest(exactRequest.run) !== canonicalCandidateDigest(latestControlRef)
      ) {
        return {
          operationId: exactRequest.operationId,
          requestDigest: exactRequest.requestDigest,
          run: exactRequest.run,
          status: 'unknown',
          effect: 'unknown',
          message: 'durable test cancellation received the wrong execution',
          retryable: false,
        }
      }
      const digest = exactRequest.requestDigest
      const prior = session.cancellationOperations[exactRequest.operationId]
      if (prior) {
        return {
          operationId: exactRequest.operationId,
          requestDigest: exactRequest.requestDigest,
          run: exactRequest.run,
          status: prior.digest === digest ? 'replayed' : 'conflict',
          effect: prior.digest === digest ? prior.effect : 'unknown',
        }
      }
      const effect = session.status === 'running' ? 'cancelled' : 'not_live'
      session.cancellationOperations[exactRequest.operationId] = {
        digest,
        status: 'accepted',
        effect,
      }
      if (effect === 'cancelled') session.status = 'cancelled'
      writeState(stateFile, state)
      return {
        operationId: exactRequest.operationId,
        requestDigest: exactRequest.requestDigest,
        run: exactRequest.run,
        status: 'accepted',
        effect,
      }
    },
    async cancel() {
      const state = readState(stateFile)
      requireSession(state, environmentId, initial.id).status = 'cancelled'
      writeState(stateFile, state)
    },
  }
}

function acknowledgement(
  command: InteractionResponseCommand,
  status: InteractionAcknowledgement['status'],
): InteractionAcknowledgement {
  return {
    operationId: command.operationId,
    binding: command.binding,
    commandDigest: command.commandDigest,
    status,
  }
}

function nativeBoundaryFor(controlRef: AgentExactRunControlRef): NativeContextBoundaryProof {
  return {
    runId: controlRef.runId,
    provider: controlRef.provider,
    environmentId: controlRef.environmentId,
    sessionId: controlRef.sessionId,
    executionId: controlRef.executionId,
    requestDigest: controlRef.requestDigest,
    boundary: {
      kind: 'messages',
      messageIds: ['message-1'],
      digest: `sha256:${'1'.repeat(64)}`,
    },
    observedAt: '2026-08-02T00:00:03.000Z',
  }
}

function retainedEvents(controlRef: AgentExactRunControlRef): AgentEnvironmentEvent[] {
  const interaction = {
    id: 'interaction-1',
    kind: 'question',
    title: 'Continue?',
    answerSpec: { fields: [] },
    binding: {
      runId: controlRef.runId,
      provider: controlRef.provider,
      environmentId: controlRef.environmentId,
      sessionId: controlRef.sessionId,
      executionId: controlRef.executionId,
      interactionId: 'interaction-1',
    },
  }
  return [
    {
      id: 'event-0',
      type: 'status',
      data: { sequence: 0, occurredAt: '2026-08-02T00:00:00.000Z' },
      normalized: { type: 'status', status: 'started' },
    },
    {
      id: 'event-1',
      type: 'interaction',
      data: { sequence: 1, occurredAt: '2026-08-02T00:00:01.000Z' },
      normalized: {
        type: 'interaction',
        request: {
          ...interaction,
          requestDigest: interactionRequestDigest(interaction),
        },
      },
    },
    {
      id: 'event-2',
      type: 'session.updated',
      data: { sequence: 2, occurredAt: '2026-08-02T00:00:02.000Z' },
      normalized: { type: 'session.updated', sessionId: controlRef.sessionId },
    },
  ]
}

function rebindInteractionEvents(
  events: readonly AgentEnvironmentEvent[],
  controlRef: AgentExactRunControlRef,
): AgentEnvironmentEvent[] {
  return events.map((event) => {
    if (event.normalized?.type !== 'interaction') return structuredClone(event)
    const { requestDigest: _requestDigest, ...requestMaterial } = event.normalized.request
    const material = {
      ...requestMaterial,
      binding: {
        ...event.normalized.request.binding,
        runId: controlRef.runId,
        provider: controlRef.provider,
        environmentId: controlRef.environmentId,
        sessionId: controlRef.sessionId,
        executionId: controlRef.executionId,
        interactionId: event.normalized.request.id,
      },
    }
    return {
      ...structuredClone(event),
      normalized: {
        type: 'interaction',
        request: {
          ...material,
          requestDigest: interactionRequestDigest(material),
        },
      },
    }
  })
}

function serializableTurn(input: AgentTurnInput): Record<string, unknown> {
  const { signal: _signal, controlRef, nativeContinuation, contextTransfer, ...rest } = input
  return {
    ...rest,
    ...(controlRef === undefined ? {} : { controlRef }),
    ...(nativeContinuation === undefined ? {} : { nativeContinuation }),
    ...(contextTransfer === undefined ? {} : { contextTransfer }),
  }
}

function sessionState(stateFile: string, environmentId: string, sessionId: string): StoredSession {
  return requireSession(readState(stateFile), environmentId, sessionId)
}

function requireSession(
  state: DurableProviderState,
  environmentId: string,
  sessionId: string,
): StoredSession {
  const session = state.environments[environmentId]?.sessions[sessionId]
  if (!session) throw new Error(`missing session ${environmentId}/${sessionId}`)
  return session
}

function readState(file: string): DurableProviderState {
  if (!existsSync(file)) return { environments: {} }
  return JSON.parse(readFileSync(file, 'utf8')) as DurableProviderState
}

function writeState(file: string, state: DurableProviderState): void {
  writeFileSync(file, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function retainedCapabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: true,
      systemPrompt: { replace: true, append: true },
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: { files: true, instructions: true },
      runtimeUpdate: true,
      validation: true,
    },
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: true, list: true, messages: true },
    retainedControl: {
      exactRunIdentity: true,
      resultIdentity: true,
      eventIdentity: true,
      cancellationIdempotency: true,
    },
    nativeContinuation: { atomicBoundary: true, requestIdempotency: true },
    interactions: {
      kinds: ['question'],
      answerFieldTypes: ['text'],
      responseScopes: ['interaction'],
      secretAnswers: false,
      concurrentRequests: false,
      replay: true,
      responseIdempotency: true,
    },
    workspace: {
      read: false,
      write: false,
      exec: false,
      git: false,
      upload: false,
      download: false,
    },
    branching: { checkpoint: false, fork: false },
    placement: false,
    usage: false,
    confidential: false,
  }
}
