export const PROVIDER = 'agent-runtime-upstream-contract'

/**
 * A deterministic provider used by the packed public contract suite.
 *
 * The provider stores state in memory so the suite can isolate Runtime behavior from a network
 * service. It still implements the public provider contract: exact run identity, replay cursors,
 * durable interaction and cancellation operations, native continuation, and interactive control.
 */
export function createUpstreamContractProvider(interfaceModule) {
  const environments = new Map()
  const counters = {
    creates: 0,
    dispatches: 0,
    interactionResponses: 0,
    cancellations: 0,
    nativeContinuations: 0,
    interactiveStarts: 0,
    interactiveClaims: 0,
    interactiveStops: 0,
  }
  const context = { interfaceModule, counters, environments }

  const provider = {
    name: PROVIDER,
    capabilities: async () => retainedCapabilities(),
    async create(input) {
      counters.creates += 1
      const id = `environment-${input.idempotencyKey}`
      const digest = interfaceModule.canonicalCandidateDigest(stripControlFields(input))
      const prior = environments.get(id)
      if (prior && prior.createDigest !== digest) {
        throw new Error('provider create idempotency key was reused with different material')
      }
      if (!prior) {
        environments.set(id, {
          id,
          createDigest: digest,
          metadata: input.metadata ?? {},
          sessions: new Map(),
          interactive: undefined,
        })
      }
      return environmentView(context, environments.get(id), 'created')
    },
    async get(id) {
      const state = environments.get(id)
      return state ? environmentView(context, state) : null
    },
    async list() {
      return [...environments.values()].map((state) => ({
        id: state.id,
        provider: PROVIDER,
        metadata: { ...state.metadata },
        status: 'running',
      }))
    },
  }

  return { provider, counters, environments }
}

function environmentView(context, state, creation) {
  const { interfaceModule, counters, environments } = context
  return {
    id: state.id,
    provider: PROVIDER,
    ...(creation === undefined ? {} : { creation }),
    metadata: { ...state.metadata },
    status: async () => 'running',
    async *stream() {},
    async dispatch(input) {
      counters.dispatches += 1
      if (!input.turnId) throw new Error('contract provider requires a turn id')
      const sessionId = input.sessionId ?? `session-${input.turnId}`
      const executionId = input.executionId ?? `execution-${input.turnId}`
      const prior = state.sessions.get(sessionId)
      if (prior) {
        if (prior.controlRef.executionId !== executionId) {
          throw new Error('contract provider session identity changed')
        }
        return { id: sessionId, provider: PROVIDER, controlRef: prior.controlRef }
      }
      const controlRef = {
        runId: `run-${input.turnId}`,
        provider: PROVIDER,
        environmentId: state.id,
        sessionId,
        executionId,
        requestDigest: interfaceModule.canonicalCandidateDigest({
          kind: 'upstream-contract-run',
          environmentId: state.id,
          sessionId,
          executionId,
          turnId: input.turnId,
          prompt: input.prompt ?? null,
          parts: input.parts ?? null,
        }),
      }
      state.sessions.set(sessionId, makeRetainedSession(context, state, controlRef))
      return { id: sessionId, provider: PROVIDER, controlRef }
    },
    session(sessionId, options) {
      const session = state.sessions.get(sessionId)
      if (!session) throw new Error(`unknown contract session ${sessionId}`)
      if (
        options?.controlRef &&
        interfaceModule.canonicalCandidateDigest(options.controlRef) !==
          interfaceModule.canonicalCandidateDigest(session.controlRef)
      ) {
        throw new Error('contract provider received the wrong control reference')
      }
      return session.view()
    },
    async destroy() {
      environments.delete(state.id)
    },
    async startInteractive(request) {
      counters.interactiveStarts += 1
      if (!state.interactive) {
        state.interactive = makeInteractiveSession(context, request)
      } else if (
        interfaceModule.canonicalCandidateDigest(state.interactive.ref.run) !==
        interfaceModule.canonicalCandidateDigest(request.run)
      ) {
        throw new Error('contract provider interactive identity changed')
      }
      return state.interactive.ref
    },
    interactive() {
      if (!state.interactive) throw new Error('interactive session has not started')
      return state.interactive.view()
    },
  }
}

/** The result a retained session reports for the run it currently points at. */
function retainedResult(session, text) {
  const { controlRef, currentControlRef } = session
  return {
    text,
    success: true,
    sessionId: controlRef.sessionId,
    metadata: {
      runId: currentControlRef.runId,
      executionId: currentControlRef.executionId,
      requestDigest: currentControlRef.requestDigest,
    },
  }
}

/** A retained session: its admitted control reference, replayable operations, and the live view. */
function makeRetainedSession({ interfaceModule, counters }, state, controlRef) {
  const interaction = makeInteraction(interfaceModule, controlRef)
  const session = {
    controlRef,
    interaction,
    events: makeCanonicalEvents(interfaceModule, controlRef, interaction),
    interactionOperations: new Map(),
    cancellationOperations: new Map(),
    nativeOperations: new Map(),
    currentControlRef: controlRef,
    status: 'running',
    view: () => retainedSessionView({ interfaceModule, counters }, state, session),
  }
  return session
}

function retainedSessionView(context, state, session) {
  const { interfaceModule, counters } = context
  const { controlRef } = session
  return {
    id: controlRef.sessionId,
    // Reconnect starts from the originally admitted reference. The provider keeps the
    // latest execution internally so a restarted client can replay a committed operation.
    controlRef,
    async status() {
      return session.status
    },
    async *events(options) {
      const currentEvents = rebindInteractionEvents(
        interfaceModule,
        session.events,
        session.currentControlRef,
      )
      const start =
        options?.since === undefined
          ? 0
          : currentEvents.findIndex((event) => event.id === options.since) + 1
      if (options?.since !== undefined && start === 0) {
        throw new Error(`unknown contract event cursor ${options.since}`)
      }
      for (const event of currentEvents.slice(start)) yield structuredClone(event)
    },
    async result() {
      return retainedResult(session, 'upstream contract result')
    },
    async prompt() {
      return retainedResult(session, 'prompt accepted')
    },
    async respondToInteraction(command) {
      counters.interactionResponses += 1
      return respondToRetainedInteraction(context, state, session, command)
    },
    async contextBoundary() {
      return boundaryFor(session.currentControlRef, interfaceModule)
    },
    async continueNative(request, options) {
      counters.nativeContinuations += 1
      return continueRetainedNative(context, session, request, options)
    },
    async cancelRun(request) {
      counters.cancellations += 1
      return cancelRetainedRun(session, request)
    },
    async cancel() {
      session.status = 'cancelled'
    },
  }
}

/** Acknowledge an interaction response once per operation id; a replay reports whether it matches. */
function respondToRetainedInteraction({ interfaceModule }, state, session, command) {
  const digest = interfaceModule.canonicalCandidateDigest(command)
  const prior = session.interactionOperations.get(command.operationId)
  if (prior) {
    return {
      ...(prior.digest === digest
        ? prior.acknowledgement
        : {
            operationId: command.operationId,
            binding: command.binding,
            commandDigest: command.commandDigest,
            status: 'already_resolved_different',
          }),
      ...(prior.digest === digest ? { status: 'already_resolved_same' } : {}),
    }
  }
  const { currentControlRef } = session
  const isExact =
    command.binding.runId === currentControlRef.runId &&
    command.binding.provider === PROVIDER &&
    command.binding.environmentId === state.id &&
    command.binding.sessionId === session.controlRef.sessionId &&
    command.binding.executionId === currentControlRef.executionId &&
    command.binding.interactionId === session.interaction.id
  const acknowledgement = {
    operationId: command.operationId,
    binding: command.binding,
    commandDigest: command.commandDigest,
    status: isExact ? 'accepted' : 'unknown_interaction',
  }
  session.interactionOperations.set(command.operationId, { digest, acknowledgement })
  return acknowledgement
}

/** Continue the session natively under a new run, replaying a committed operation. */
function continueRetainedNative({ interfaceModule }, session, request, options) {
  const prior = session.nativeOperations.get(request.operationId)
  if (prior) {
    options.onAdmission?.(prior.controlRef)
    return {
      ...structuredClone(prior),
      acknowledgement: { ...prior.acknowledgement, status: 'replayed' },
    }
  }
  if (options?.turn?.prompt === undefined && options?.turn?.parts === undefined) {
    return {
      acknowledgement: {
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        status: 'transport_failure',
        historyMessagesSent: 0,
        message: 'continuation turn is empty',
        retryable: true,
      },
    }
  }
  const nextControlRef = {
    ...session.currentControlRef,
    runId: `native-${request.operationId}`,
    executionId: `native-execution-${request.operationId}`,
    requestDigest: request.requestDigest,
  }
  const result = {
    acknowledgement: {
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      status: 'accepted',
      historyMessagesSent: 0,
      actualBoundary: boundaryFor(session.currentControlRef, interfaceModule),
    },
    result: {
      text: 'native continuation accepted',
      success: true,
      sessionId: session.controlRef.sessionId,
      metadata: {
        runId: nextControlRef.runId,
        executionId: nextControlRef.executionId,
        requestDigest: nextControlRef.requestDigest,
      },
    },
    controlRef: nextControlRef,
  }
  session.nativeOperations.set(request.operationId, structuredClone(result))
  session.currentControlRef = nextControlRef
  options.onAdmission?.(nextControlRef)
  return result
}

/** Cancel the run once per operation id; a replay reports whether it matches. */
function cancelRetainedRun(session, request) {
  const prior = session.cancellationOperations.get(request.operationId)
  if (prior) {
    return {
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      run: request.run,
      status: prior.digest === request.requestDigest ? 'replayed' : 'conflict',
      effect: prior.digest === request.requestDigest ? prior.effect : 'unknown',
    }
  }
  const effect = session.status === 'running' ? 'cancelled' : 'not_live'
  if (effect === 'cancelled') session.status = 'cancelled'
  session.cancellationOperations.set(request.operationId, {
    digest: request.requestDigest,
    effect,
  })
  return {
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    run: request.run,
    status: 'accepted',
    effect,
  }
}

function makeInteractiveSession({ interfaceModule, counters }, request) {
  const live = { generation: 0, running: true }
  const ref = makeInteractiveRef(interfaceModule, request)
  return {
    ref,
    view() {
      return {
        ref,
        async claimControl(command) {
          counters.interactiveClaims += 1
          live.generation += 1
          return {
            operationId: command.operationId,
            requestDigest: command.requestDigest,
            ref,
            status: 'accepted',
            control: controlFor(interfaceModule, ref, live.generation),
          }
        },
        async status() {
          return live.running
            ? { state: 'running', ref }
            : {
                state: 'exited',
                ref,
                endedAt: '2026-08-28T00:00:00.000Z',
                reason: 'stopped',
              }
        },
        async attach() {
          return {
            ref,
            control: controlFor(interfaceModule, ref, live.generation),
            cursors: { earliest: 0, latest: 0 },
            async *events() {},
            async input() {},
            async resize() {},
            async detach() {
              return { status: 'detached', terminalSessionId: 'contract-terminal' }
            },
            async close() {
              live.running = false
              return { status: 'closed', terminalSessionId: 'contract-terminal' }
            },
          }
        },
        async sendPrompt(command) {
          return {
            operationId: command.operationId,
            requestDigest: command.requestDigest,
            ref,
            control: command.control,
            status: 'accepted',
          }
        },
        async stop(command) {
          counters.interactiveStops += 1
          live.running = false
          return {
            operationId: command.operationId,
            requestDigest: command.requestDigest,
            ref,
            control: command.control,
            status: 'accepted',
            effect: 'stopped',
          }
        },
      }
    },
  }
}

function retainedCapabilities() {
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
    nativeContinuation: { atomicBoundary: true, requestIdempotency: true, admissionControl: true },
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
    interactiveAgent: {
      start: true,
      control: true,
      status: true,
      attach: true,
      reattach: true,
      sendPrompt: true,
      input: true,
      resize: true,
      stop: true,
    },
  }
}

function makeInteraction(interfaceModule, controlRef) {
  const material = {
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
  return { ...material, requestDigest: interfaceModule.interactionRequestDigest(material) }
}

function makeCanonicalEvents(interfaceModule, controlRef, interaction) {
  const partBase = { sessionID: controlRef.sessionId, messageID: 'message-1' }
  const plan = {
    id: 'plan-1',
    revision: 1,
    title: 'Contract plan',
    body: 'Run the public contract suite.',
    submittedAt: '2026-08-28T00:00:00.000Z',
  }
  const events = [
    { type: 'message.part.updated', part: { ...partBase, id: 'part-text', type: 'text', text: 'hello' }, delta: 'hello' },
    { type: 'message.part.updated', part: { ...partBase, id: 'part-tool', type: 'tool', tool: 'read', state: { status: 'pending', input: {} } } },
    { type: 'message.part.updated', part: { ...partBase, id: 'part-reasoning', type: 'reasoning', text: 'thinking' } },
    { type: 'message.part.updated', part: { ...partBase, id: 'part-file', type: 'file', filename: 'README.md' } },
    { type: 'message.part.updated', part: { ...partBase, id: 'part-subtask', type: 'subtask', prompt: 'inspect', description: 'inspect', agent: 'worker' } },
    { type: 'tool-heartbeat', toolName: 'read', partId: 'part-tool', elapsedMs: 1 },
    { type: 'tool-slow', toolName: 'read', partId: 'part-tool', elapsedMs: 5, thresholdMs: 3 },
    { type: 'model-processing', phase: 'generating', elapsedMs: 2 },
    { type: 'status', status: 'started' },
    { type: 'warning', code: 'contract-warning', message: 'bounded warning' },
    { type: 'raw', backend: 'contract-provider', event: { kind: 'opaque' } },
    { type: 'session.updated', sessionId: controlRef.sessionId, title: 'Contract session' },
    { type: 'interaction', request: interaction },
    { type: 'interaction.cancel', id: interaction.id, reason: 'contract replay' },
    { type: 'plan.submitted', plan },
    {
      type: 'child-task',
      childId: 'child-1',
      status: 'completed',
      time: { started: 1_725_000_000_000, updated: 1_725_000_001_000, ended: 1_725_000_002_000 },
      runner: 'contract-runner',
      model: 'contract-model',
      usage: { inputTokens: 1, outputTokens: 1 },
      terminalReason: 'completed',
      sourceEventId: 'child-event-1',
      raw: { source: 'fixture' },
    },
  ]
  return events.map((event, index) => ({
    id: `event-${index + 1}`,
    type: event.type,
    data: {
      sequence: index + 1,
      occurredAt: `2026-08-28T00:00:${String(index).padStart(2, '0')}.000Z`,
    },
    normalized: event,
  }))
}

function rebindInteractionEvents(interfaceModule, events, controlRef) {
  return events.map((event) => {
    if (event.normalized?.type !== 'interaction') return structuredClone(event)
    const request = event.normalized.request
    const material = {
      ...request,
      binding: {
        ...request.binding,
        runId: controlRef.runId,
        provider: controlRef.provider,
        environmentId: controlRef.environmentId,
        sessionId: controlRef.sessionId,
        executionId: controlRef.executionId,
      },
    }
    delete material.requestDigest
    return {
      ...structuredClone(event),
      normalized: {
        type: 'interaction',
        request: { ...material, requestDigest: interfaceModule.interactionRequestDigest(material) },
      },
    }
  })
}

function boundaryFor(controlRef, interfaceModule) {
  const boundary = {
    kind: 'messages',
    messageIds: ['message-1'],
    digest: interfaceModule.canonicalCandidateDigest({ kind: 'contract-message-boundary' }),
  }
  return {
    runId: controlRef.runId,
    provider: controlRef.provider,
    environmentId: controlRef.environmentId,
    sessionId: controlRef.sessionId,
    executionId: controlRef.executionId,
    requestDigest: controlRef.requestDigest,
    boundary,
    observedAt: '2026-08-28T00:00:00.000Z',
  }
}

function makeInteractiveRef(interfaceModule, request) {
  const preparation = {
    kind: 'agent-execution-preparation',
    schemaVersion: 1,
    preparationId: 'contract-preparation',
    requestDigest: request.run.requestDigest,
    authoredProfileDigest: request.requestedProfileDigest,
    effectiveProfileDigest: request.requestedProfileDigest,
    backend: PROVIDER,
    harness: request.profile.harness,
    harnessVersion: 'contract-harness-1',
    resolvedModel: {
      requested: request.profile.model?.default ?? 'contract-model',
      resolved: request.profile.model?.default ?? 'contract-model',
    },
    workspace: {
      leaseId: 'contract-workspace-lease',
      provider: PROVIDER,
      identityDigest: digestOf(interfaceModule, 'workspace'),
      isolation: 'per-run',
      sourceSnapshotDigest: digestOf(interfaceModule, 'source'),
      sourceSnapshotPolicy: {
        kind: 'provider-declared',
        name: 'contract-snapshot',
        version: 1,
        digest: digestOf(interfaceModule, 'snapshot-policy'),
      },
      preparedWorkspaceDigest: digestOf(interfaceModule, 'prepared'),
      profileActivationDigest: digestOf(interfaceModule, 'profile'),
    },
    axisResults: [],
    executionPlanDigest: digestOf(interfaceModule, 'plan'),
    materializer: { name: 'contract-materializer', version: '1' },
    expiresAtMs: 4102444800000,
  }
  return {
    run: request.run,
    preparationReceipt: { ...preparation, digest: digestOf(interfaceModule, preparation) },
    incarnationId: 'contract-incarnation',
    startedAt: '2026-08-28T00:00:00.000Z',
  }
}

function controlFor(interfaceModule, ref, generation) {
  return {
    refDigest: interfaceModule.canonicalCandidateDigest(ref),
    generation,
    leaseId: 'contract-lease',
    holderId: 'contract-holder',
    expiresAt: '2126-08-28T00:00:00.000Z',
  }
}

function digestOf(interfaceModule, value) {
  return interfaceModule.canonicalCandidateDigest(value)
}

function stripControlFields(input) {
  const { signal: _signal, idempotencyKey: _idempotencyKey, ...material } = input
  return material
}
