import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUpstreamContractProvider, PROVIDER } from './upstream-contract-provider.mjs'

export const UPSTREAM_CONTRACTS = Object.freeze({
  'UP-02': Object.freeze({
    description: 'interaction responses bind to one run and replay by operation id',
    publicModules: Object.freeze(['@tangle-network/agent-runtime/kernel', '@tangle-network/agent-interface']),
    sourceTests: Object.freeze(['src/runtime/retained-run.test.ts']),
  }),
  'UP-03': Object.freeze({
    description: 'canonical events retain identity, order, and replay cursors',
    publicModules: Object.freeze(['@tangle-network/agent-runtime/kernel', '@tangle-network/agent-interface']),
    sourceTests: Object.freeze(['src/runtime/retained-run.test.ts']),
  }),
  'UP-04': Object.freeze({
    description: 'one public run handle reconnects, reports, answers, and cancels',
    publicModules: Object.freeze(['@tangle-network/agent-runtime/kernel', '@tangle-network/agent-interface']),
    sourceTests: Object.freeze(['src/runtime/retained-run.test.ts']),
  }),
  'UP-10': Object.freeze({
    description: 'supervisor controls are typed, durable, and owned by the Runtime loop',
    publicModules: Object.freeze(['@tangle-network/agent-runtime/kernel', '@tangle-network/agent-interface']),
    sourceTests: Object.freeze([
      'tests/kernel/worker-cancellation.test.ts',
      'tests/runtime/mid-flight-steering.test.ts',
    ]),
  }),
  'UP-11': Object.freeze({
    description: 'the Runtime archive installs with the exact first-party cohort',
    publicModules: Object.freeze(['@tangle-network/agent-runtime/kernel', '@tangle-network/agent-interface']),
    sourceTests: Object.freeze(['scripts/verify-packed-cohort.mjs']),
  }),
  'UP-12': Object.freeze({
    description: 'unsupported capabilities fail closed before an action is dispatched',
    publicModules: Object.freeze(['@tangle-network/agent-runtime/kernel', '@tangle-network/agent-interface']),
    sourceTests: Object.freeze(['src/runtime/retained-run.test.ts']),
  }),
  'UP-13': Object.freeze({
    description: 'fresh context transfer and native continuation keep distinct identity boundaries',
    publicModules: Object.freeze(['@tangle-network/agent-runtime/kernel', '@tangle-network/agent-interface']),
    sourceTests: Object.freeze(['src/runtime/retained-run.test.ts']),
  }),
})

const CANONICAL_EVENT_TYPES = Object.freeze([
  'message.part.updated',
  'tool-heartbeat',
  'tool-slow',
  'model-processing',
  'status',
  'warning',
  'raw',
  'session.updated',
  'interaction',
  'interaction.cancel',
  'plan.submitted',
  'child-task',
])

const PROFILE = Object.freeze({
  name: 'upstream-contract-profile',
  harness: 'pi',
  model: { provider: PROVIDER, default: 'upstream-contract-model' },
})

/** Run one Braid upstream requirement through the packed Runtime public surface. */
export async function runUpstreamContract({ check, runtime, interfaceModule }) {
  if (!UPSTREAM_CONTRACTS[check]) throw new Error(`unknown upstream contract ${check}`)
  if (!runtime || !interfaceModule) throw new Error('Runtime and Interface modules are required')
  const publicImports = assertPublicExports(check, runtime, interfaceModule)
  const providerState = createUpstreamContractProvider(interfaceModule)
  let evidence
  if (check === 'UP-02') evidence = await runInteractionContract(runtime, interfaceModule, providerState)
  if (check === 'UP-03') evidence = await runEventContract(runtime, interfaceModule, providerState)
  if (check === 'UP-04') evidence = await runHandleContract(runtime, interfaceModule, providerState)
  if (check === 'UP-10') evidence = await runSupervisorControlContract(runtime, interfaceModule, providerState)
  if (check === 'UP-11') evidence = runCohortImportContract(runtime, interfaceModule)
  if (check === 'UP-12') evidence = await runCapabilityContract(runtime, interfaceModule)
  if (check === 'UP-13') evidence = await runContextContract(runtime, interfaceModule, providerState)
  return {
    schema: 'agent-runtime/upstream-contract-result/v1',
    check,
    description: UPSTREAM_CONTRACTS[check].description,
    publicImports,
    sourceTests: UPSTREAM_CONTRACTS[check].sourceTests,
    evidence,
  }
}

function assertPublicExports(check, runtime, interfaceModule) {
  const requiredRuntime = [
    'startRetainedRun',
    'reconnectRetainedRun',
    'startRetainedRunInEnvironment',
    'supervisorRunDir',
    'writeWorkerSteer',
    'readWorkerSteerAcknowledgement',
    'cancelWorker',
    'readWorkerCancellation',
  ]
  const requiredInterface = [
    'canonicalCandidateDigest',
    'interactionRequestDigest',
    'interactionResponseCommandDigest',
    'nativeContextContinuationTurnDigest',
    'nativeContextContinuationRequestDigest',
  ]
  const needsSupervisor = check === 'UP-10'
  if (needsSupervisor) requiredRuntime.push('provisionSupervisor')
  for (const symbol of requiredRuntime) {
    if (typeof runtime[symbol] !== 'function') throw new Error(`${check} missing Runtime export ${symbol}`)
  }
  for (const symbol of requiredInterface) {
    if (typeof interfaceModule[symbol] !== 'function') {
      throw new Error(`${check} missing Interface export ${symbol}`)
    }
  }
  return {
    runtime: requiredRuntime,
    interface: requiredInterface,
  }
}

async function runInteractionContract(runtime, interfaceModule, providerState) {
  const { handle, admissions } = await startRun(runtime, providerState, 'up-02')
  const events = await collectEvents(handle)
  const request = interactionFrom(events)
  const command = responseCommand(interfaceModule, handle.controlRef, request, 'interaction-op')
  const accepted = await handle.respondToInteraction(command)
  const replayed = await handle.respondToInteraction(command)
  const changed = responseCommand(interfaceModule, handle.controlRef, request, 'interaction-op', {
    outcome: 'declined',
  })
  const conflict = await handle.respondToInteraction(changed)
  const unknownInteraction = await handle.respondToInteraction(
    responseCommand(interfaceModule, handle.controlRef, request, 'unknown-interaction-op', {
      interactionId: 'other-interaction',
      responseId: 'other-interaction',
    }),
  )
  const wrongRun = responseCommand(interfaceModule, handle.controlRef, request, 'wrong-run-op', {
    runId: 'another-run',
  })
  const wrongRunError = await rejectedMessage(() => handle.respondToInteraction(wrongRun))
  assert(accepted.status === 'accepted', `UP-02 expected accepted response, got ${accepted.status}`)
  assert(replayed.status === 'already_resolved_same', `UP-02 expected replayed response, got ${replayed.status}`)
  assert(conflict.status === 'already_resolved_different', 'UP-02 did not reject changed operation material')
  assert(unknownInteraction.status === 'unknown_interaction', 'UP-02 did not reject another interaction')
  assert(wrongRunError.includes('does not target this retained run'), 'UP-02 did not reject another run binding')
  return {
    binding: request.binding,
    accepted: accepted.status,
    replayed: replayed.status,
    conflict: conflict.status,
    unknownInteraction: unknownInteraction.status,
    wrongRunRejected: true,
    providerInteractionCalls: providerState.counters.interactionResponses,
    admissionPhases: admissions.map((admission) => admission.phase),
  }
}

async function runEventContract(runtime, interfaceModule, providerState) {
  const { handle } = await startRun(runtime, providerState, 'up-03')
  const events = await collectEvents(handle)
  const kinds = [...new Set(events.map((envelope) => envelope.event.type))]
  assert(kinds.length === CANONICAL_EVENT_TYPES.length, `UP-03 emitted ${kinds.length} canonical event kinds`)
  for (const type of CANONICAL_EVENT_TYPES) {
    assert(kinds.includes(type), `UP-03 omitted canonical event kind ${type}`)
  }
  for (let index = 0; index < events.length; index += 1) {
    const envelope = events[index]
    assert(envelope.sequence === index + 1, 'UP-03 event sequence is not contiguous')
    assert(envelope.eventId === `event-${index + 1}`, 'UP-03 event identity changed')
    assert(envelope.cursor === envelope.eventId, 'UP-03 replay cursor is not stable')
  }
  const anchor = events[4]
  const replay = await collectEvents(handle, { after: { cursor: anchor.cursor, sequence: anchor.sequence } })
  assert(replay.length === events.length - 5, 'UP-03 replay returned the wrong exclusive window')
  assert(replay[0].eventId === events[5].eventId, 'UP-03 replay did not resume after the cursor')
  const secondRead = await collectEvents(handle)
  assert(JSON.stringify(secondRead) === JSON.stringify(events), 'UP-03 replay changed event identity')
  void interfaceModule
  void providerState
  return {
    eventCount: events.length,
    canonicalEventKinds: kinds,
    firstReplayEvent: replay[0].eventId,
    replayCount: replay.length,
  }
}

async function runHandleContract(runtime, interfaceModule, providerState) {
  const { handle } = await startRun(runtime, providerState, 'up-04')
  const reconnected = await runtime.reconnectRetainedRun({
    provider: providerState.provider,
    controlRef: handle.controlRef,
    now: fixedClock,
  })
  assert(reconnected !== null, 'UP-04 could not reconnect the retained run')
  const initialStatus = await handle.status()
  const reconnectedStatus = await reconnected.status()
  const request = interactionFrom(await collectEvents(reconnected))
  const command = responseCommand(interfaceModule, reconnected.controlRef, request, 'up-04-interaction')
  const response = await reconnected.respondToInteraction(command)
  const firstCancel = await reconnected.cancel({ operationId: 'up-04-cancel', reason: 'contract complete' })
  const replayCancel = await reconnected.cancel({ operationId: 'up-04-cancel', reason: 'contract complete' })
  const finalStatus = await runtime.reconnectRetainedRun({
    provider: providerState.provider,
    controlRef: reconnected.controlRef,
    now: fixedClock,
  })
  assert(finalStatus !== null, 'UP-04 lost the run after cancellation')
  assert(initialStatus.status === 'running', 'UP-04 start handle did not report running')
  assert(reconnectedStatus.status === 'running', 'UP-04 reconnect handle did not report running')
  assert(response.status === 'accepted', 'UP-04 reconnect handle could not answer')
  assert(firstCancel.effect === 'cancelled', `UP-04 expected cancellation, got ${firstCancel.effect}`)
  assert(replayCancel.status === 'replayed', `UP-04 expected cancellation replay, got ${replayCancel.status}`)
  assert((await finalStatus.status()).status === 'cancelled', 'UP-04 final status was not cancelled')
  return {
    runId: handle.controlRef.runId,
    reconnected: true,
    statuses: [initialStatus.status, reconnectedStatus.status, (await finalStatus.status()).status],
    interaction: response.status,
    cancellation: firstCancel.effect,
    cancellationReplay: replayCancel.status,
  }
}

async function runSupervisorControlContract(runtime, interfaceModule, providerState) {
  const root = mkdtempSync(join(tmpdir(), 'agent-runtime-upstream-supervisor-'))
  let provisioned
  try {
    provisioned = await runtime.provisionSupervisor({
      invocationId: 'up-10-supervisor',
      task: 'hold until the control contract cancels this worker',
      profile: PROFILE,
      workspaceDir: root,
      timeoutMs: 10_000,
      pollMs: 5,
      connection: { provider: providerState.provider },
    })
    const eventDir = runtime.supervisorRunDir(provisioned.rootDir, provisioned.supervisorId)
    const firstSteer = runtime.writeWorkerSteer(
      provisioned.rootDir,
      provisioned.supervisorId,
      provisioned.workerId,
      { operationId: 'up-10-steer', message: 'continue', source: 'packed-contract' },
    )
    const replaySteer = runtime.writeWorkerSteer(
      provisioned.rootDir,
      provisioned.supervisorId,
      provisioned.workerId,
      { operationId: 'up-10-steer', message: 'continue', source: 'packed-contract' },
    )
    const steerAcknowledgement = await waitFor(
      () => runtime.readWorkerSteerAcknowledgement(eventDir, 'up-10-steer'),
      (value) => value?.effect === 'delivered',
    )
    const firstCancel = runtime.cancelWorker(
      eventDir,
      provisioned.workerId,
      'up-10-cancel',
      { reason: 'packed contract', source: 'packed-contract' },
    )
    const cancellation = await waitFor(
      () => runtime.readWorkerCancellation(eventDir, 'up-10-cancel'),
      (value) => value?.effect === 'cancelled',
    )
    const cleanup = await provisioned.cleanup()
    const replayCancel = runtime.cancelWorker(
      eventDir,
      provisioned.workerId,
      'up-10-cancel',
      { reason: 'packed contract', source: 'packed-contract' },
    )
    const afterReconnect = runtime.readWorkerCancellation(eventDir, 'up-10-cancel')
    assert(firstSteer.replayed === false, 'UP-10 first steer was not admitted')
    assert(replaySteer.replayed === true, 'UP-10 steer retry was not idempotent')
    assert(steerAcknowledgement?.effect === 'delivered', 'UP-10 Runtime did not acknowledge steer delivery')
    assert(firstCancel.effect === 'unknown', 'UP-10 queued cancel should be unknown before acknowledgement')
    assert(cancellation?.effect === 'cancelled', 'UP-10 Runtime did not acknowledge worker cancellation')
    assert(JSON.stringify(replayCancel) === JSON.stringify(cancellation), 'UP-10 cancel retry changed the durable record')
    assert(JSON.stringify(afterReconnect) === JSON.stringify(cancellation), 'UP-10 reconnect read changed the durable record')
    assert(cleanup.resourcesReleased === true, 'UP-10 cleanup did not prove resource release')
    return {
      supervisorId: provisioned.supervisorId,
      workerId: provisioned.workerId,
      steer: steerAcknowledgement.effect,
      steerReplay: replaySteer.replayed,
      cancel: cancellation.effect,
      cancelReplay: replayCancel.effect,
      reconnectRead: afterReconnect.effect,
      cleanup: cleanup.resourcesReleased,
      providerInteractiveCalls: {
        starts: providerState.counters.interactiveStarts,
        claims: providerState.counters.interactiveClaims,
        stops: providerState.counters.interactiveStops,
      },
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function runCohortImportContract(runtime, interfaceModule) {
  assert(typeof runtime.startRetainedRun === 'function', 'UP-11 Runtime public import failed')
  assert(typeof interfaceModule.canonicalCandidateDigest === 'function', 'UP-11 Interface public import failed')
  return {
    runtimeImported: true,
    interfaceImported: true,
    packageBoundary: 'exact-packed-archive',
  }
}

async function runCapabilityContract(runtime, interfaceModule) {
  const cases = []
  for (const capability of ['interactions', 'nativeContinuation', 'retainedControl']) {
    const state = createUpstreamContractProvider(interfaceModule)
    const baseCapabilities = await state.provider.capabilities()
    const disabled = { ...baseCapabilities }
    if (capability === 'interactions') disabled.interactions = undefined
    if (capability === 'nativeContinuation') disabled.nativeContinuation = undefined
    if (capability === 'retainedControl') {
      disabled.retainedControl = { ...baseCapabilities.retainedControl, eventIdentity: false }
    }
    state.provider.capabilities = async () => disabled
    let error
    if (capability === 'nativeContinuation') {
      const started = await startRun(runtime, state, `up-12-${capability}`)
      const boundary = await started.handle.contextBoundary()
      const turn = { prompt: 'unsupported native continuation' }
      const material = {
        operationId: `up-12-${capability}`,
        turnDigest: interfaceModule.nativeContextContinuationTurnDigest(turn),
        run: started.handle.controlRef,
        expectedBoundary: boundary,
      }
      const request = {
        ...material,
        requestDigest: interfaceModule.nativeContextContinuationRequestDigest(material),
      }
      error = await rejectedMessage(() => started.handle.continueNative(request, turn))
      assert(state.counters.nativeContinuations === 0, 'UP-12 called a disabled native continuation')
    } else {
      const turn = capability === 'interactions' ? { prompt: 'unsupported', interactions: { question: true } } : { prompt: 'unsupported' }
      error = await rejectedMessage(() =>
        runtime.startRetainedRun({
          provider: state.provider,
          environment: { profile: PROFILE, idempotencyKey: `up-12-${capability}` },
          turn: { ...turn, turnId: `up-12-${capability}` },
          onAdmission: async () => {},
        }),
      )
      assert(state.counters.creates === 0, `UP-12 dispatched while ${capability} was disabled`)
    }
    cases.push({ capability, rejected: true, message: error })
  }
  return { disabledCapabilities: cases }
}

async function runContextContract(runtime, interfaceModule, providerState) {
  const initial = await startRun(runtime, providerState, 'up-13-initial')
  const initialControlRef = initial.handle.controlRef
  const boundary = await initial.handle.contextBoundary()
  assert(boundary !== null, 'UP-13 provider did not publish a native boundary')
  const turn = { prompt: 'continue in the existing native conversation' }
  const material = {
    operationId: 'up-13-native',
    turnDigest: interfaceModule.nativeContextContinuationTurnDigest(turn),
    run: initial.handle.controlRef,
    expectedBoundary: boundary,
  }
  const request = {
    ...material,
    requestDigest: interfaceModule.nativeContextContinuationRequestDigest(material),
  }
  assert(
    typeof initial.handle.beginNativeContinuation === 'function',
    'UP-13 Runtime did not expose admission-first native continuation',
  )
  const nativeHandle = initial.handle.beginNativeContinuation(request, turn)
  const admitted = await nativeHandle.admission
  const native = await nativeHandle.result
  const restarted = await runtime.reconnectRetainedRun({
    provider: providerState.provider,
    controlRef: initialControlRef,
    now: fixedClock,
  })
  assert(restarted !== null, 'UP-13 could not reconnect for a native continuation retry')
  const replayHandle = restarted.beginNativeContinuation(request, turn)
  const replayAdmission = await replayHandle.admission
  const nativeReplay = await replayHandle.result
  const fresh = await runtime.startRetainedRunInEnvironment({
    provider: providerState.provider,
    environment: {
      id: initial.handle.controlRef.environmentId,
      idempotencyKey: 'up-13-initial-environment',
    },
    turn: { prompt: 'start a fresh provider session', turnId: 'up-13-fresh' },
    onAdmission: async () => {},
  })
  assert(native.acknowledgement.status === 'accepted', 'UP-13 native continuation was not accepted')
  assert(nativeReplay.acknowledgement.status === 'replayed', 'UP-13 native continuation was not idempotent')
  assert(
    interfaceModule.canonicalCandidateDigest(admitted) ===
      interfaceModule.canonicalCandidateDigest(native.controlRef),
    'UP-13 native admission did not identify the terminal run',
  )
  assert(
    interfaceModule.canonicalCandidateDigest(replayAdmission) ===
      interfaceModule.canonicalCandidateDigest(nativeReplay.controlRef),
    'UP-13 replay admission did not identify the replayed run',
  )
  assert(native.acknowledgement.historyMessagesSent === 0, 'UP-13 native continuation duplicated history')
  assert(native.controlRef.sessionId === initialControlRef.sessionId, 'UP-13 native continuation changed sessions')
  assert(fresh.controlRef.sessionId !== initialControlRef.sessionId, 'UP-13 fresh context reused native session')
  assert(providerState.counters.dispatches === 2, 'UP-13 fresh context dispatched more than one new session')
  return {
    nativeStatus: native.acknowledgement.status,
    nativeReplay: nativeReplay.acknowledgement.status,
    admissionControl: true,
    historyMessagesSent: native.acknowledgement.historyMessagesSent,
    nativeSessionId: native.controlRef.sessionId,
    freshSessionId: fresh.controlRef.sessionId,
    freshDispatches: providerState.counters.dispatches - 1,
  }
}

async function startRun(runtime, providerState, suffix) {
  const admissions = []
  const handle = await runtime.startRetainedRun({
    provider: providerState.provider,
    environment: {
      profile: PROFILE,
      idempotencyKey: `${suffix}-environment`,
      metadata: { contract: suffix },
    },
    turn: {
      prompt: `run ${suffix}`,
      turnId: `${suffix}-turn`,
      interactions: { question: true },
    },
    onAdmission: async (admission) => admissions.push(admission),
    now: fixedClock,
  })
  return { handle, admissions }
}

function responseCommand(interfaceModule, controlRef, request, operationId, overrides = {}) {
  const binding = {
    ...request.binding,
    requestDigest: request.requestDigest,
    ...(overrides.runId === undefined ? {} : { runId: overrides.runId }),
    ...(overrides.interactionId === undefined ? {} : { interactionId: overrides.interactionId }),
  }
  const response = {
    id: overrides.responseId ?? binding.interactionId,
    outcome: overrides.outcome ?? 'accepted',
  }
  return {
    operationId,
    binding,
    commandDigest: interfaceModule.interactionResponseCommandDigest({ binding, response }),
    response,
  }
}

function interactionFrom(events) {
  const event = events.find((envelope) => envelope.event.type === 'interaction')
  if (!event) throw new Error('contract provider emitted no interaction request')
  return event.event.request
}

async function collectEvents(handle, options) {
  const events = []
  for await (const event of handle.events(options)) events.push(event)
  return events
}

async function waitFor(read, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  let value
  while (Date.now() < deadline) {
    value = read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for Runtime control acknowledgement: ${JSON.stringify(value)}`)
}

async function rejectedMessage(action) {
  try {
    await action()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected Runtime action to reject')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function fixedClock() {
  return Date.parse('2026-08-28T00:00:00.000Z')
}
