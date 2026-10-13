/**
 * A supervised root whose next turn stays pending must not end the run.
 *
 * Discovery run terraform-dc-tokens-20261006d (2026-10-07) settled `driver-failed` 23 minutes
 * before its deadline: its root's next turn was refused by the subscription credential owner
 * before dispatch, the refusal was named "requires reconciliation before replacement", and 20
 * identical re-entries later the barren bound stopped the run. These tests drive `supervise` with
 * a retained provider through the same two situations under strict retry bounds, where three
 * barren failures end a run: a capacity refusal before dispatch, which the driver must wait out,
 * and an admitted execution the provider can no longer resolve, which Runtime must abandon.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRunCancellationAcknowledgement } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-retry'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import {
  readWorkerSteerAcknowledgement,
  writeWorkerSteer,
} from '../../src/runtime/supervise/run-layout'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

/** agent-provider-tangle's `TangleCredentialCapacityError`, by structure. */
function credentialCapacityRefusal(): Error {
  return Object.assign(new Error('Subscription account capacity is unavailable'), {
    name: 'TangleCredentialCapacityError',
    code: 'provider_quota_exhausted',
    reason: 'exhausted',
  })
}

/** agent-provider-tangle's `TangleDispatchNotAdmittedError`, by structure. */
function dispatchNotAdmitted(): Error {
  return Object.assign(
    new Error('sandbox dispatch returned an execution id different from the requested run'),
    {
      name: 'TangleDispatchNotAdmittedError',
      code: 'DISPATCH_NOT_ADMITTED',
      sessionId: 'retained-session',
      requestedExecutionId: 'retained-execution-requested',
      activeExecutionId: 'retained-execution-active',
    },
  )
}

interface Fixture {
  /** Called before each dispatch reaches the provider; throw to refuse it. */
  readonly beforeDispatch?: (call: number) => void
  /** Executions whose result the provider can never return. */
  readonly unresolvable?: (dispatched: number) => boolean
  /** A terminal-less provider stream whose exact result read never settles. */
  readonly resultNeverOn?: (dispatched: number) => boolean
  /** Queue a root steer and a failed asynchronous method at the first exact result. */
  readonly queuedWakesOnFirstResult?: boolean
  /** The successful dispatch on which the director submits. */
  readonly submitOn: number
}

async function superviseRoot(fixture: Fixture) {
  const directory = await mkdtemp(join(tmpdir(), 'retained-owner-pending-'))
  directories.push(directory)
  const proxy = await coordinationProxy()
  proxies.push(proxy)
  const stateFile = join(directory, 'provider.json')
  const runDir = join(directory, 'run')
  const context = createFileRunContext(runDir)
  let port = 0
  let token = ''
  let calls = 0
  const dispatched: AgentTurnInput[] = []
  const lost = new Set<string>()
  const neverReturns = new Set<string>()
  const stopped: string[] = []
  let rejectMethod!: (error: Error) => void
  const methodResult = new Promise<unknown>((_resolve, reject) => {
    rejectMethod = reject
  })
  let methodReceipt: string | undefined
  let firstResultWakesQueued = false
  let steerRecorded = false
  let steerReplayed = false
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    dispatch: async (turn) => {
      calls += 1
      fixture.beforeDispatch?.(calls)
      const session = await environment.dispatch!(turn)
      if (!dispatched.some((prior) => prior.executionId === turn.executionId)) dispatched.push(turn)
      if (fixture.unresolvable?.(dispatched.length) && turn.executionId) lost.add(turn.executionId)
      if (fixture.resultNeverOn?.(dispatched.length) && turn.executionId)
        neverReturns.add(turn.executionId)
      if (fixture.queuedWakesOnFirstResult && dispatched.length === 1) {
        const response = await fetch(`http://127.0.0.1:${port}/manager`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'method',
            method: 'tools/call',
            params: { name: 'failing_record', arguments: { text: 'save evidence' } },
          }),
        })
        if (!response.ok) throw new Error(`failing_record returned ${response.status}`)
        const reply = (await response.json()) as {
          result?: { structuredContent?: { running?: boolean; receipt?: string } }
        }
        if (reply.result?.structuredContent?.running !== true)
          throw new Error('failing_record did not return an asynchronous receipt')
        methodReceipt = reply.result.structuredContent.receipt
      }
      if (dispatched.length === fixture.submitOn) {
        const response = await fetch(`http://127.0.0.1:${port}/manager`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'submission',
            method: 'tools/call',
            params: { name: 'submit_result', arguments: { result: { answer: 'delivered' } } },
          }),
        })
        if (!response.ok) throw new Error(`submit_result returned ${response.status}`)
      }
      return session
    },
    session: (id, options) => {
      const session = environment.session!(id, options)
      const executionId = options?.controlRef?.executionId
      return {
        ...session,
        result: async () => {
          if (executionId !== undefined && neverReturns.has(executionId))
            return await new Promise<Awaited<ReturnType<typeof session.result>>>(() => {})
          if (executionId !== undefined && lost.has(executionId))
            throw Object.assign(new Error('retained run not found'), { status: 404 })
          const result = await session.result()
          if (fixture.queuedWakesOnFirstResult && !firstResultWakesQueued) {
            firstResultWakesQueued = true
            const steer = {
              eventDir: runDir,
              operationId: 'retained-root-correction',
              message: 'use the corrected evidence',
              interrupt: false,
            }
            const admitted = writeWorkerSteer(directory, 'pending-root', 'pending-root', steer)
            steerRecorded = !admitted.replayed && admitted.acknowledgement === undefined
            steerReplayed = writeWorkerSteer(
              directory,
              'pending-root',
              'pending-root',
              steer,
            ).replayed
            rejectMethod(new Error('knowledge store is locked by this process'))
          }
          return result
        },
        // Sandbox stops one run without ending the session the next turn continues.
        cancelRun: async (request): Promise<AgentRunCancellationAcknowledgement> => {
          stopped.push(request.run.executionId)
          return {
            operationId: request.operationId,
            requestDigest: request.requestDigest,
            run: request.run,
            status: 'accepted',
            effect: 'cancelled',
          }
        },
      }
    },
  })
  const base = durableRetainedProvider(stateFile)
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: { runtimeAttachments: { mcp: true } },
    }),
    create: async (input) => {
      token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
      return wrap(await base.create(input))
    },
    get: async (id) => {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  const result = await supervise(
    testAgentProfile('root', {
      harness: 'codex',
      tools: runtimeToolDeclarations(
        'submit_result',
        ...(fixture.queuedWakesOnFirstResult ? ['failing_record'] : []),
      ),
    }),
    'Produce the answer.',
    {
      runDir,
      journal: context.journal,
      blobs: context.blobs,
      runId: 'pending-root',
      backend: { backend: 'provider', provider },
      driverBackend: {
        backend: 'provider',
        provider,
        ...(fixture.resultNeverOn === undefined ? {} : { retainedResultWaitMs: 20 }),
      },
      budget: { maxIterations: 100, maxTokens: 1000, deadlineMs: 60_000 },
      // Strict: three barren failures end the run, with no outage window to shelter them.
      driverRetry: {
        transientOutageMs: 0,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        unavailablePauseMs: 1,
        maxUnavailablePauseMs: 1,
      },
      continuation: testContinuation({ maxBarren: 3 }),
      retainedAtSettlement: 'release',
      teardownConfirmMs: 0,
      deliverable: {
        describe: 'the delivered answer',
        check: (value) => (value as { answer?: unknown }).answer === 'delivered',
      },
      coordination: {
        ...(fixture.queuedWakesOnFirstResult ? { requestTimeoutMs: 1_000 } : {}),
        authentication: {
          signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
        },
        publicUrl: (address) => {
          port = address.port
          proxy.forwardTo(port)
          return `${proxy.url}/manager`
        },
      },
      ...(fixture.queuedWakesOnFirstResult
        ? {
            resolveSupervisorTools: async () => [
              {
                name: 'failing_record',
                description: 'Persist one result',
                inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
                handler: async () => methodResult,
              },
            ],
          }
        : {}),
    },
  )
  const events = ((await context.journal.loadTree('pending-root')) ?? []).filter(
    (event) => event.id === 'pending-root',
  )
  const attempts = events.flatMap((event): DriverAttemptRecord[] =>
    event.kind === 'driver-attempt' ? [event.record] : [],
  )
  return {
    result,
    events,
    attempts,
    dispatched,
    stopped,
    runDir,
    methodReceipt,
    steerRecorded,
    steerReplayed,
  }
}

function count(events: readonly SpawnEvent[], kind: SpawnEvent['kind']): number {
  return events.filter((event) => event.kind === kind).length
}

describe('supervised root with a pending retained turn', () => {
  it('settles a root from its exact result when its provider stream has no terminal event', async () => {
    // The durable provider emits only nonterminal frames. The root can still commit its result and
    // enter the existing continuation path after the exact retained result is read.
    const run = await superviseRoot({ submitOn: 1 })
    expect(run.result.kind).toBe('winner')
    expect(count(run.events, 'execution-input')).toBe(1)
    expect(count(run.events, 'execution-result')).toBe(1)
    expect(run.dispatched).toHaveLength(1)
  })

  it('wakes a retained root with one accepted steer and a failed asynchronous tool outcome', async () => {
    const run = await superviseRoot({ queuedWakesOnFirstResult: true, submitOn: 2 })
    if (run.result.kind !== 'winner') {
      throw new Error(
        JSON.stringify({
          result: run.result,
          attempts: run.attempts,
          dispatched: run.dispatched,
          methodReceipt: run.methodReceipt,
          steerAcknowledgement: readWorkerSteerAcknowledgement(
            run.runDir,
            'retained-root-correction',
          ),
        }),
      )
    }
    expect(run.result.kind).toBe('winner')
    expect(run.dispatched).toHaveLength(2)
    expect(run.steerRecorded).toBe(true)
    expect(run.steerReplayed).toBe(true)
    expect(run.methodReceipt).toBeTruthy()
    const nextTurn = JSON.stringify(run.dispatched[1])
    expect(nextTurn).toContain('use the corrected evidence')
    expect(nextTurn).toContain('knowledge store is locked by this process')
    expect(nextTurn).toContain(run.methodReceipt!)
    expect(nextTurn.split('use the corrected evidence')).toHaveLength(2)
    expect(readWorkerSteerAcknowledgement(run.runDir, 'retained-root-correction')).toMatchObject({
      effect: 'delivered',
      operationId: 'retained-root-correction',
      detail: 'the root inbox accepted the steer; consumption is not confirmed',
    })
  })

  it('reports a bounded lost-terminal root instead of waiting forever for its exact result', async () => {
    const run = await superviseRoot({
      resultNeverOn: (dispatched) => dispatched === 1,
      submitOn: Number.POSITIVE_INFINITY,
    })
    expect(run.result.kind).toBe('no-winner')
    expect(run.attempts.at(-1)).toMatchObject({
      classification: 'terminal',
      pendingCause: 'terminal-event-lost',
    })
    expect(count(run.events, 'execution-result')).toBe(0)
    expect(run.dispatched).toHaveLength(1)
  })

  it('waits out a credential capacity refusal before dispatch instead of ending the run', async () => {
    // The second turn's dispatch is refused eight times: run d's root met 20 such refusals.
    const run = await superviseRoot({
      beforeDispatch: (call) => {
        if (call >= 2 && call <= 9) throw credentialCapacityRefusal()
      },
      submitOn: 2,
    })
    expect(run.result.kind).toBe('winner')
    const refused = run.attempts.filter((attempt) => attempt.classification === 'unavailable')
    expect(refused).toHaveLength(8)
    expect(refused[0]).toMatchObject({ unavailableSignal: 'provider_quota_exhausted' })
    expect(refused[0]?.error).toContain('refused before it ran; nothing to reconcile')
    // The refused turn was never replaced: one input per turn, each with one result.
    expect(count(run.events, 'execution-input')).toBe(2)
    expect(count(run.events, 'execution-result')).toBe(2)
    expect(count(run.events, 'execution-abandoned')).toBe(0)
    expect(run.dispatched).toHaveLength(2)
  })

  it('stops on a dispatch that Sandbox did not admit instead of retrying it', async () => {
    // expr-calculator-20261010b (2026-10-10): every later turn met a session that Sandbox still
    // reported as running a dead execution, and 38 attempts in 20m27s retried that answer.
    const run = await superviseRoot({
      beforeDispatch: (call) => {
        if (call >= 2) throw dispatchNotAdmitted()
      },
      submitOn: Number.POSITIVE_INFINITY,
    })
    expect(run.result.kind).not.toBe('winner')
    const refused = run.attempts.filter((attempt) =>
      attempt.error?.includes('nothing to reconcile'),
    )
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({ classification: 'terminal' })
    expect(run.attempts.at(-1)?.classification).toBe('terminal')
    // Refused before it ran: the turn was neither replaced nor abandoned.
    expect(count(run.events, 'execution-abandoned')).toBe(0)
    expect(count(run.events, 'execution-input')).toBe(2)
    expect(run.dispatched).toHaveLength(1)
  })

  it('abandons a turn the provider can no longer resolve and finishes in a new invocation', async () => {
    const run = await superviseRoot({
      unresolvable: (dispatched) => dispatched === 2,
      submitOn: 3,
    })
    expect(run.result.kind).toBe('winner')
    const abandoned = run.events.filter((event) => event.kind === 'execution-abandoned')
    expect(abandoned).toEqual([
      expect.objectContaining({
        pendingCause: 'unobservable',
        failures: 2,
        outcome: 'stopped',
        stop: expect.objectContaining({
          executionId: run.dispatched[1]?.executionId,
          effect: 'cancelled',
        }),
      }),
    ])
    // Stopped at the provider before the replacement started; settlement stops others too.
    expect(run.stopped).toContain(run.dispatched[1]?.executionId)
    expect(run.attempts.filter((attempt) => attempt.abandoned)).toHaveLength(1)
    // Three invocations: two committed results, and the abandoned one never commits one.
    expect(count(run.events, 'execution-input')).toBe(3)
    expect(count(run.events, 'execution-result')).toBe(2)
    expect(new Set(run.dispatched.map((turn) => turn.executionId)).size).toBe(3)
    expect(new Set(run.dispatched.map((turn) => turn.sessionId)).size).toBe(1)
  })

  it('ends with a typed pending-unresolved stop when every replacement stays unresolved', async () => {
    // terraform-dc-build-20261009g-fork (2026-10-09): every replacement continued one stopped
    // sandbox and failed reconciliation the same way, so abandoning again could not help.
    const run = await superviseRoot({
      unresolvable: (dispatched) => dispatched >= 2,
      submitOn: Number.POSITIVE_INFINITY,
    })
    expect(run.result.kind).toBe('no-winner')
    const abandoned = run.events.filter((event) => event.kind === 'execution-abandoned')
    // The default maxConsecutiveFailures bounds the abandonments in a row.
    expect(abandoned).toHaveLength(3)
    expect(run.attempts.at(-1)).toMatchObject({
      stop: 'pending-unresolved',
      pendingCause: 'unobservable',
      madeProgress: false,
    })
    expect(JSON.stringify(run.result)).toContain('stopped by pending-unresolved')
    // One committed first turn, then four invocations: three abandoned, one left unresolved.
    expect(count(run.events, 'execution-input')).toBe(5)
    expect(count(run.events, 'execution-result')).toBe(1)
  })
})
