import { readFile, writeFile } from 'node:fs/promises'
import {
  type AgentExactRunControlRef,
  interactionResponseCommandDigest,
  NativeContextContinuationRequestSchema,
  type NativeContextContinuationTurn,
  nativeContextContinuationRequestDigest,
  nativeContextContinuationTurnDigest,
} from '@tangle-network/agent-interface'
import { reconnectRetainedRun, startRetainedRun } from '../../src/runtime/retained-run'
import { durableRetainedProvider } from './durable-retained-provider'

const [stateFile, referenceFile, phase] = process.argv.slice(2)
if (!stateFile || !referenceFile || (phase !== 'start' && phase !== 'reconnect')) {
  throw new Error('usage: retained-run-child <state-file> <reference-file> <start|reconnect>')
}

if (phase === 'start') {
  const run = await startRetainedRun({
    provider: durableRetainedProvider(stateFile),
    environment: { profile: { name: 'worker' }, idempotencyKey: 'restart-proof' },
    turn: { prompt: 'start', turnId: 'restart-proof' },
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
} else {
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
  const interactionBinding = {
    runId: run.controlRef.runId,
    provider: run.controlRef.provider,
    environmentId: run.controlRef.environmentId,
    sessionId: run.controlRef.sessionId,
    executionId: run.controlRef.executionId,
    interactionId: 'interaction-1',
    requestDigest: run.controlRef.requestDigest,
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
