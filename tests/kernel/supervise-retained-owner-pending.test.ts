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

interface Fixture {
  /** Called before each dispatch reaches the provider; throw to refuse it. */
  readonly beforeDispatch?: (call: number) => void
  /** Executions whose result the provider can never return. */
  readonly unresolvable?: (dispatched: number) => boolean
  /** The successful dispatch on which the director submits. */
  readonly submitOn: number
}

async function superviseRoot(fixture: Fixture) {
  const directory = await mkdtemp(join(tmpdir(), 'retained-owner-pending-'))
  directories.push(directory)
  const proxy = await coordinationProxy()
  proxies.push(proxy)
  const stateFile = join(directory, 'provider.json')
  const context = createFileRunContext(join(directory, 'run'))
  let port = 0
  let token = ''
  let calls = 0
  const dispatched: AgentTurnInput[] = []
  const lost = new Set<string>()
  const stopped: string[] = []
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    dispatch: async (turn) => {
      calls += 1
      fixture.beforeDispatch?.(calls)
      const session = await environment.dispatch!(turn)
      if (!dispatched.some((prior) => prior.executionId === turn.executionId)) dispatched.push(turn)
      if (fixture.unresolvable?.(dispatched.length) && turn.executionId) lost.add(turn.executionId)
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
          if (executionId !== undefined && lost.has(executionId))
            throw Object.assign(new Error('retained run not found'), { status: 404 })
          return session.result()
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
    testAgentProfile('root', { harness: 'codex', tools: runtimeToolDeclarations('submit_result') }),
    'Produce the answer.',
    {
      runDir: join(directory, 'run'),
      journal: context.journal,
      blobs: context.blobs,
      runId: 'pending-root',
      backend: { backend: 'provider', provider },
      driverBackend: { backend: 'provider', provider },
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
        authentication: {
          signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
        },
        publicUrl: (address) => {
          port = address.port
          proxy.forwardTo(port)
          return `${proxy.url}/manager`
        },
      },
    },
  )
  const events = ((await context.journal.loadTree('pending-root')) ?? []).filter(
    (event) => event.id === 'pending-root',
  )
  const attempts = events.flatMap((event): DriverAttemptRecord[] =>
    event.kind === 'driver-attempt' ? [event.record] : [],
  )
  return { result, events, attempts, dispatched, stopped }
}

function count(events: readonly SpawnEvent[], kind: SpawnEvent['kind']): number {
  return events.filter((event) => event.kind === kind).length
}

describe('supervised root with a pending retained turn', () => {
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
