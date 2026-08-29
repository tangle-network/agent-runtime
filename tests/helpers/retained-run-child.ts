import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import {
  type AgentExactRunControlRef,
  interactionResponseCommandDigest,
  NativeContextContinuationRequestSchema,
  type NativeContextContinuationTurn,
  nativeContextContinuationRequestDigest,
  nativeContextContinuationTurnDigest,
} from '@tangle-network/agent-interface'
import {
  reconnectRetainedRun,
  recoverRetainedRun,
  startRetainedRun,
} from '../../src/runtime/retained-run'
import type {
  RetainedRunAdmission,
  RetainedRunIntentAdmission,
} from '../../src/runtime/retained-run-types'
import { durableRetainedProvider } from './durable-retained-provider'
import { retainedContextTransfer } from './retained-context-transfer'

const phases = [
  'start',
  'reconnect',
  'start-kill-intent',
  'recover-intent',
  'start-kill-dispatched',
  'recover-dispatched',
  'start-kill-environment',
  'recover-environment',
  'start-kill-live',
  'recover-live',
] as const
type Phase = (typeof phases)[number]

const [stateFile, referenceFile, phase] = process.argv.slice(2)
if (!stateFile || !referenceFile || !phases.includes(phase as Phase)) {
  throw new Error(`usage: retained-run-child <state-file> <reference-file> <${phases.join('|')}>`)
}

/** Write and fsync in one call: the record must survive an immediate SIGKILL. */
function persistDurably(file: string, value: unknown): void {
  const fd = openSync(file, 'w', 0o600)
  try {
    writeSync(fd, `${JSON.stringify(value)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

if (phase === 'start') {
  const admissions: RetainedRunAdmission[] = []
  const run = await startRetainedRun({
    provider: durableRetainedProvider(stateFile),
    environment: { profile: { name: 'worker' }, idempotencyKey: 'restart-proof' },
    turn: { prompt: 'start', turnId: 'restart-proof' },
    onAdmission: async (admission) => {
      admissions.push(admission)
      persistDurably(`${referenceFile}.admissions`, admissions)
    },
    now: () => Date.parse('2026-08-02T00:00:10.000Z'),
  })
  const iterator = run.events()[Symbol.asyncIterator]()
  const first = await iterator.next()
  if (first.done) throw new Error('retained test run emitted no event')
  const continuationTurn: NativeContextContinuationTurn = {
    prompt: 'continue after the client restarted',
  }
  const expectedBoundary = await run.contextBoundary()
  if (!expectedBoundary) throw new Error('durable provider did not return a continuation boundary')
  const continuationMaterial = {
    operationId: 'restart-native-operation',
    run: run.controlRef,
    expectedBoundary,
    turnDigest: nativeContextContinuationTurnDigest(continuationTurn),
  }
  const continuation = NativeContextContinuationRequestSchema.parse({
    requestDigest: nativeContextContinuationRequestDigest(continuationMaterial),
    ...continuationMaterial,
  })
  const reference = {
    controlRef: run.controlRef,
    after: { cursor: first.value.cursor ?? first.value.eventId, sequence: first.value.sequence },
    continuation,
    continuationTurn,
  }
  await writeFile(referenceFile, `${JSON.stringify(reference)}\n`, 'utf8')
  await expectLostContinuation(run, continuation, continuationTurn)
  await writeFile(
    `${referenceFile}.output`,
    `${JSON.stringify({ first: first.value, controlRef: run.controlRef })}\n`,
    'utf8',
  )
} else if (phase === 'reconnect') {
  const reference = JSON.parse(await readFile(referenceFile, 'utf8')) as {
    controlRef: AgentExactRunControlRef
    after: { cursor: string; sequence: number }
    continuation: ReturnType<typeof NativeContextContinuationRequestSchema.parse>
    continuationTurn: NativeContextContinuationTurn
  }
  const run = await reconnectRetainedRun({
    provider: durableRetainedProvider(stateFile),
    controlRef: reference.controlRef,
    now: () => Date.parse('2026-08-02T00:00:11.000Z'),
  })
  if (!run) throw new Error('retained run was not reconstructable')
  const continuation = await run.continueNative(reference.continuation, reference.continuationTurn)
  const events = []
  for await (const event of run.events({ after: reference.after })) events.push(event)
  const statusBefore = await run.status()
  const interactionEvent = events.find((event) => event.event.type === 'interaction')?.event
  if (interactionEvent?.type !== 'interaction') {
    throw new Error('retained provider replayed no interaction request')
  }
  if (interactionEvent.request.requestDigest === run.controlRef.requestDigest) {
    throw new Error('interaction request digest unexpectedly matched the retained turn digest')
  }
  const interactionBinding = {
    runId: run.controlRef.runId,
    provider: run.controlRef.provider,
    environmentId: run.controlRef.environmentId,
    sessionId: run.controlRef.sessionId,
    executionId: run.controlRef.executionId,
    interactionId: 'interaction-1',
    requestDigest: interactionEvent.request.requestDigest,
  }
  const interactionResponse = { id: 'interaction-1', outcome: 'accepted' as const }
  const interaction = await run.respondToInteraction({
    operationId: 'answer-after-restart',
    binding: interactionBinding,
    commandDigest: interactionResponseCommandDigest({
      binding: interactionBinding,
      response: interactionResponse,
    }),
    response: interactionResponse,
  })
  const cancellation = await run.cancel({
    operationId: 'restart-cancel-operation',
    reason: 'test cleanup',
  })
  await writeFile(
    `${referenceFile}.output`,
    `${JSON.stringify({
      events,
      statusBefore,
      interaction,
      cancellation,
      continuation,
      result: await run.result(),
    })}\n`,
    'utf8',
  )
} else if (phase === 'start-kill-intent') {
  const contextTransfer = retainedContextTransfer('kill-intent-transfer')
  await startRetainedRun({
    provider: durableRetainedProvider(stateFile),
    environment: { profile: { name: 'worker' }, idempotencyKey: 'kill-intent' },
    turn: { prompt: 'start', turnId: 'kill-intent', contextTransfer },
    onAdmission: async (admission) => {
      if (admission.phase === 'intent') {
        persistDurably(referenceFile, admission)
        process.kill(process.pid, 'SIGKILL')
      }
    },
  })
  throw new Error('the intent admission must kill this process before provider.create')
} else if (phase === 'recover-intent') {
  const admission = JSON.parse(await readFile(referenceFile, 'utf8')) as RetainedRunIntentAdmission
  const admissions: RetainedRunAdmission[] = []
  const contextTransfer = retainedContextTransfer('kill-intent-transfer')
  const result = await recoverRetainedRun({
    provider: durableRetainedProvider(stateFile),
    admission,
    replay: {
      environment: { profile: { name: 'worker' }, idempotencyKey: 'kill-intent' },
      turn: { prompt: 'start', turnId: 'kill-intent', contextTransfer },
    },
    onAdmission: async (recoveredAdmission) => {
      admissions.push(recoveredAdmission)
      persistDurably(`${referenceFile}.recovered-admissions`, admissions)
    },
  })
  if (result.outcome !== 'recovered') {
    throw new Error(`expected the intent recovery to start a run, got ${result.outcome}`)
  }
  await writeFile(
    `${referenceFile}.output`,
    `${JSON.stringify({
      controlRef: result.handle.controlRef,
      dispatches: JSON.parse(await readFile(stateFile, 'utf8')).environments[
        'environment-kill-intent'
      ].sessions[result.handle.controlRef.sessionId].dispatches,
    })}\n`,
    'utf8',
  )
} else if (phase === 'start-kill-dispatched') {
  // Die the way a real process dies: inside the dispatched hook, after the
  // record is durable, before the hook returns. The parent asserts SIGKILL
  // and that the observation marker below never appeared.
  await startRetainedRun({
    provider: durableRetainedProvider(stateFile),
    environment: { profile: { name: 'worker' }, idempotencyKey: 'kill-dispatched' },
    turn: { prompt: 'start', turnId: 'kill-dispatched' },
    onAdmission: async (admission) => {
      if (admission.phase === 'dispatched') {
        persistDurably(referenceFile, admission)
        process.kill(process.pid, 'SIGKILL')
      }
    },
  })
  persistDurably(`${referenceFile}.observed`, { observed: true })
  throw new Error('the dispatched admission must kill this process before resolution')
} else if (phase === 'recover-dispatched') {
  const admission = JSON.parse(await readFile(referenceFile, 'utf8')) as {
    phase: 'dispatched'
    controlRef: AgentExactRunControlRef
  }
  const run = await reconnectRetainedRun({
    provider: durableRetainedProvider(stateFile),
    controlRef: admission.controlRef,
  })
  if (!run) throw new Error('the dispatched admission record did not rebuild the run')
  const events = []
  for await (const event of run.events()) events.push(event)
  const first = events[0]
  if (!first) throw new Error('the recovered run replayed no event')
  const replayed = []
  for await (const event of run.events({
    after: { cursor: first.cursor, sequence: first.sequence },
  })) {
    replayed.push(event)
  }
  const cancellation = await run.cancel({
    operationId: 'kill-dispatched-cancel',
    reason: 'recovered cleanup',
  })
  await writeFile(
    `${referenceFile}.output`,
    `${JSON.stringify({
      controlRef: run.controlRef,
      eventIds: events.map((event) => event.eventId),
      replayedIds: replayed.map((event) => event.eventId),
      cancellation,
    })}\n`,
    'utf8',
  )
} else if (phase === 'start-kill-environment') {
  await startRetainedRun({
    provider: durableRetainedProvider(stateFile),
    environment: { profile: { name: 'worker' }, idempotencyKey: 'kill-environment' },
    turn: { prompt: 'start', turnId: 'kill-environment' },
    identity: {
      sessionId: 'session-kill-environment',
      executionId: 'execution-kill-environment',
    },
    onAdmission: async (admission) => {
      if (admission.phase === 'intent') return
      if (admission.phase === 'environment') {
        persistDurably(referenceFile, admission)
        process.kill(process.pid, 'SIGKILL')
      }
    },
  })
  throw new Error('the environment admission must kill this process before dispatch')
} else if (phase === 'start-kill-live') {
  // The reviewer-proven window: dispatch has ALREADY committed remotely, and
  // the process dies before the dispatched record can be persisted. Only the
  // environment admission survives.
  await startRetainedRun({
    provider: durableRetainedProvider(stateFile),
    environment: { profile: { name: 'worker' }, idempotencyKey: 'kill-live' },
    turn: { prompt: 'start', turnId: 'kill-live' },
    onAdmission: async (admission) => {
      if (admission.phase === 'intent') return
      if (admission.phase === 'environment') {
        persistDurably(referenceFile, admission)
        return
      }
      process.kill(process.pid, 'SIGKILL')
    },
  })
  throw new Error('the dispatched admission must kill this process before persisting')
} else if (phase === 'recover-live') {
  const admission = JSON.parse(await readFile(referenceFile, 'utf8')) as {
    phase: 'environment'
    environmentId: string
    sessionId: string
    executionId: string
  }
  const result = await recoverRetainedRun({
    provider: durableRetainedProvider(stateFile),
    environmentId: admission.environmentId,
    sessionId: admission.sessionId,
    executionId: admission.executionId,
  })
  if (result.outcome !== 'recovered') {
    throw new Error(`expected a recovered live run, got ${result.outcome}`)
  }
  const run = result.handle
  const events = []
  for await (const event of run.events()) events.push(event)
  const cancellation = await run.cancel({
    operationId: 'kill-live-cancel',
    reason: 'recovered live cleanup',
  })
  await writeFile(
    `${referenceFile}.output`,
    `${JSON.stringify({
      controlRef: run.controlRef,
      eventIds: events.map((event) => event.eventId),
      cancellation,
    })}\n`,
    'utf8',
  )
} else {
  const admission = JSON.parse(await readFile(referenceFile, 'utf8')) as {
    phase: 'environment'
    environmentId: string
    sessionId: string
    executionId: string
  }
  const provider = durableRetainedProvider(stateFile)
  const first = await recoverRetainedRun({
    provider,
    environmentId: admission.environmentId,
    sessionId: admission.sessionId,
    executionId: admission.executionId,
  })
  if (!provider.get) throw new Error('durable test provider lost its get contract')
  const orphan = await provider.get(admission.environmentId)
  // Test-owned cleanup through the provider surface; the unverifiable outcome
  // itself never authorizes a destroy.
  if (first.outcome === 'unverifiable') await first.environment.destroy?.()
  const second = await recoverRetainedRun({
    provider,
    environmentId: admission.environmentId,
    sessionId: admission.sessionId,
    executionId: admission.executionId,
  })
  const afterCleanup = await provider.get(admission.environmentId)
  await writeFile(
    `${referenceFile}.output`,
    `${JSON.stringify({
      firstOutcome: first.outcome,
      orphanFound: orphan !== null,
      secondOutcome: second.outcome,
      orphanRemains: afterCleanup !== null,
    })}\n`,
    'utf8',
  )
}

async function expectLostContinuation(
  run: Awaited<ReturnType<typeof startRetainedRun>>,
  request: ReturnType<typeof NativeContextContinuationRequestSchema.parse>,
  turn: NativeContextContinuationTurn,
): Promise<void> {
  try {
    await run.continueNative(request, turn)
  } catch (error) {
    if (error instanceof Error && error.message === 'connection lost after continuation commit') {
      return
    }
    throw error
  }
  throw new Error('continuation response was not lost')
}
