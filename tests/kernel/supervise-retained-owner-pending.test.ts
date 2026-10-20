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
 *
 * The same pending-turn boundary decides whether a steer survives. Discovery run 18b's core-4 lost
 * a director ruling to a turn that drained it and then failed. The last block drives a real HTTP
 * cli-bridge peer and a sandbox provider stream through that failure, the 15-minute promotion, and
 * the settle fence, and reads each steer's receipt.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProfile,
  type AgentRunCancellationAcknowledgement,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderWorkspaceRetentionPort } from '../../src/runtime/provider-workspace-retention'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-retry'
import { type InboxReceipt, STEER_PROMOTION_MS } from '../../src/runtime/supervise/inbox'
import { applyRunCancellation } from '../../src/runtime/supervise/run-cancellation'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import {
  cancelRun,
  readRunCancellation,
  readWorkerSteerAcknowledgement,
  writeWorkerSteer,
} from '../../src/runtime/supervise/run-layout'
import { bridgeExecutor, createExecutor } from '../../src/runtime/supervise/runtime'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { Executor, SpawnEvent, UsageEvent } from '../../src/runtime/supervise/types'
import type { SandboxClient } from '../../src/runtime/types'
import { completeCapture, fileWorkspaceArtifacts } from '../helpers/complete-workspace-capture'
import { testContinuation } from '../helpers/continuation'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
const servers: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(servers.splice(0).map((close) => close()))
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
  readonly firstTurnFailure?: { error: string }
  readonly captureFailure?: 'throw' | 'partial' | 'raw-partial' | 'recover'
  /** Rotate from Claude to Codex after the first seat reaches its subscription limit. */
  readonly seatSwitch?: boolean
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
  /** Delay each source lookup between the first failed capture and its recovery. */
  readonly slowSourceLookupMs?: number
  /** The retention port's bound; 5 s unless a slow lookup needs more. */
  readonly retentionTimeoutMs?: number
  /** Re-enter this earlier fixture directory: the same run directory and provider state. */
  readonly directory?: string
}

async function superviseRoot(fixture: Fixture) {
  const directory = fixture.directory ?? (await mkdtemp(join(tmpdir(), 'retained-owner-pending-')))
  if (fixture.directory === undefined) directories.push(directory)
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
  const destroyed: string[] = []
  const environments: string[] = []
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
    ...(fixture.seatSwitch
      ? {
          workspaceBranching: {
            checkpoint: async (request) => ({
              status: 'created' as const,
              idempotencyKey: request.idempotencyKey,
              requestDigest: request.requestDigest,
              checkpoint: {
                checkpointId: `checkpoint-${environment.id}`,
                provider: environment.provider,
                source: request.source,
                idempotencyKey: request.idempotencyKey,
                requestDigest: request.requestDigest,
                createdAt: new Date().toISOString(),
              },
            }),
            lookupCheckpoint: async () => {
              throw new Error('seat switch must use its committed checkpoint')
            },
            deleteCheckpoint: async (request) => ({ ...request, status: 'deleted' as const }),
            fork: async () => {
              throw new Error('seat switch must create from its checkpoint')
            },
            lookupFork: async () => {
              throw new Error('seat switch must create from its checkpoint')
            },
            destroyFork: async () => {
              throw new Error('seat switch must create from its checkpoint')
            },
          },
        }
      : {}),
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
          if (fixture.firstTurnFailure && executionId === dispatched[0]?.executionId) {
            return { ...result, success: false, ...fixture.firstTurnFailure }
          }
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
    destroy: async () => {
      destroyed.push(environment.id)
      await environment.destroy?.()
    },
  })
  const base = durableRetainedProvider(stateFile)
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: {
        runtimeAttachments: { mcp: true },
        ...(fixture.seatSwitch ? { workspaceCheckpoint: true } : {}),
      },
    }),
    create: async (input) => {
      token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
      const environment = await base.create(input)
      environments.push(environment.id)
      if (input.workspace?.checkpoint)
        restoredCheckpointIds.push(input.workspace.checkpoint.checkpointId)
      return wrap(environment)
    },
    get: async (id) => {
      if (fixture.slowSourceLookupMs !== undefined && captureCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, fixture.slowSourceLookupMs))
      }
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  const artifacts = fileWorkspaceArtifacts(join(directory, 'artifacts'))
  let firstCaptureExecution: string | undefined
  let captureCalls = 0
  const retention: ProviderWorkspaceRetentionPort = {
    timeoutMs: fixture.retentionTimeoutMs ?? 5_000,
    requireCompleteProvenance: true,
    artifacts,
    async capture(captureContext) {
      firstCaptureExecution ??= captureContext.executionId
      if (captureContext.executionId === firstCaptureExecution) {
        captureCalls += 1
        if (
          fixture.captureFailure === 'throw' ||
          (fixture.captureFailure === 'recover' && captureCalls === 1)
        )
          throw new Error(
            'process streams incomplete: process_io_missing; process_source_unavailable',
          )
        if (fixture.captureFailure === 'partial') {
          const captured = await completeCapture(captureContext, artifacts)
          return {
            ...captured,
            provenance: {
              ...captured.provenance,
              workspace: { ...captured.provenance.workspace!, complete: false },
              missing: ['process_io_missing'],
            },
          }
        }
        if (fixture.captureFailure === 'raw-partial') {
          const captured = await completeCapture(captureContext, artifacts)
          return {
            ...captured,
            provenance: {
              ...captured.provenance,
              missing: [
                `Sandbox session ${captureContext.controlRef!.sessionId} declared partial raw capture`,
                `Sandbox session ${captureContext.controlRef!.sessionId}: process_io_missing`,
                `Sandbox session ${captureContext.controlRef!.sessionId}: process_io_unavailable`,
                `Sandbox session ${captureContext.controlRef!.sessionId}: process_source_unavailable`,
                `Sandbox session ${captureContext.controlRef!.sessionId}: process_source_unavailable:${captureContext.controlRef!.executionId}`,
                `Sandbox session ${captureContext.controlRef!.sessionId} attempt ${captureContext.controlRef!.executionId}/1: process_io_missing`,
                `Sandbox session ${captureContext.controlRef!.sessionId} attempt ${captureContext.controlRef!.executionId}/1: process_source_unavailable`,
                `Sandbox session ${captureContext.controlRef!.sessionId} has no original process source: ${captureContext.controlRef!.executionId}`,
                `Raw native session capture for Sandbox session ${captureContext.controlRef!.sessionId} is unavailable: process_io_missing; process_io_unavailable; process_source_unavailable; process_source_unavailable:${captureContext.controlRef!.executionId}`,
              ],
              sessions: captured.provenance.sessions!.map((session) => ({
                ...session,
                processStreams: { ...session.processStreams!, complete: false },
              })),
              attempts: captured.provenance.attempts!.map((attempt) => ({
                ...attempt,
                missingReasons: ['process_io_missing', 'process_source_unavailable'],
              })),
            },
          }
        }
      }
      return completeCapture(captureContext, artifacts)
    },
  }
  const result = await supervise(
    testAgentProfile('root', {
      harness: fixture.seatSwitch ? 'claude-code' : 'codex',
      ...(fixture.seatSwitch
        ? {
            model: { provider: 'anthropic', default: 'claude-opus-4-1' },
            seats: [
              {
                harness: 'claude-code',
                provider: 'anthropic',
                model: 'claude-opus-4-1',
                selector: { kind: 'all-eligible' as const },
              },
              {
                harness: 'codex',
                provider: 'openai',
                model: 'gpt-6-sol',
                selector: { kind: 'all-eligible' as const },
              },
            ],
          }
        : {}),
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
        ...(fixture.captureFailure === undefined ? {} : { workspaceRetention: retention }),
        ...(fixture.resultNeverOn === undefined ? {} : { retainedResultWaitMs: 20 }),
      },
      ...(fixture.seatSwitch
        ? {
            selectSeat: async (request: {
              stageIndex: number
              excludedSeatIds: readonly string[]
            }) =>
              request.stageIndex === 0 && request.excludedSeatIds.length > 0
                ? { resumeAt: '2026-01-01T00:00:00.000Z' }
                : {
                    seat: request.stageIndex === 0 ? 'claude-seat' : 'codex-seat',
                    backend: {
                      backend: 'provider' as const,
                      provider,
                      workspaceRetention: retention,
                    },
                  },
          }
        : {}),
      budget: {
        maxIterations: 100,
        maxTokens: 1000,
        deadlineMs: fixture.slowSourceLookupMs === undefined ? 60_000 : 180_000,
      },
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
    environments,
    destroyed,
    firstCaptureExecution,
    base,
    evidence: await Promise.all(
      events.flatMap((event) =>
        event.kind === 'execution-evidence' ? [context.blobs.get(event.outRef)] : [],
      ),
    ),
    captures: await Promise.all(
      events.flatMap((event) =>
        event.kind === 'execution-evidence' || event.kind === 'execution-result'
          ? [context.blobs.get(event.outRef)]
          : [],
      ),
    ),
  }
}

function count(events: readonly SpawnEvent[], kind: SpawnEvent['kind']): number {
  return events.filter((event) => event.kind === kind).length
}

describe('supervised root with a pending retained turn', () => {
  it.each(['throw', 'partial', 'recover'] as const)(
    'continues an unavailable turn with %s capture and delivers the next output',
    async (captureFailure) => {
      const run = await superviseRoot({
        firstTurnFailure: { error: 'HTTP 429 rate_limit_error' },
        captureFailure,
        submitOn: 2,
      })
      expect(
        run.result,
        JSON.stringify({ attempts: run.attempts, dispatched: run.dispatched.length }),
      ).toMatchObject({ kind: 'winner', out: { answer: 'delivered' } })
      expect(run.dispatched).toHaveLength(2)
      expect(run.attempts[0]).toMatchObject({ classification: 'unavailable' })
      expect(run.attempts[0]?.retryInMs).toBeGreaterThan(0)
      expect(run.attempts.some((attempt) => attempt.error?.includes('capture pending'))).toBe(false)
      const first = run.events.find(
        (event) => event.kind === 'execution-admitted' && event.admission.phase === 'dispatched',
      )
      if (first?.kind !== 'execution-admitted' || first.admission.phase !== 'dispatched')
        throw new Error('missing first dispatch')
      if (captureFailure === 'recover') {
        expect(run.environments).toHaveLength(1)
        expect(run.evidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              workspaceCapture: expect.objectContaining({
                executionId: run.firstCaptureExecution,
                controlRef: first.admission.controlRef,
                coverageComplete: true,
              }),
            }),
          ]),
        )
      } else {
        expect(run.environments).toHaveLength(2)
        expect(run.destroyed).not.toContain(run.environments[0])
        expect(await run.base.get!(run.environments[0]!)).not.toBeNull()
        expect(run.evidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              workspaceCaptureFailure: expect.stringContaining(
                'retained workspace capture pending',
              ),
              executionId: run.firstCaptureExecution,
              environmentId: run.environments[0],
              controlRef: first.admission.controlRef,
              node: expect.objectContaining({ nodeId: 'pending-root' }),
              profileDigest: expect.any(String),
            }),
          ]),
        )
      }
    },
  )

  it('recovers an accepted workspace whose source lookup takes longer than 30 s but within the retention bound', async () => {
    // test-acceptance-canary-20261018h (2026-10-18): a box idle about 21 minutes took over 30 s to
    // answer the recovery lookup, the fixed 30 s cap aborted it, and the resumed supervisor exited
    // with its accepted workspace pending.
    const run = await superviseRoot({
      firstTurnFailure: { error: 'HTTP 429 rate_limit_error' },
      captureFailure: 'recover',
      submitOn: 2,
      slowSourceLookupMs: 31_000,
      retentionTimeoutMs: 60_000,
    })
    expect(run.result).toMatchObject({ kind: 'winner', out: { answer: 'delivered' } })
    // The accepted workspace was recaptured in place: no replacement environment, and its receipt.
    expect(run.environments).toHaveLength(1)
    expect(run.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceCapture: expect.objectContaining({
            executionId: run.firstCaptureExecution,
            coverageComplete: true,
          }),
        }),
      ]),
    )
  }, 150_000)

  it.each([false, true])(
    'settles a dead run with a queued cancel as cancelled, with no turn or environment (stale acknowledgement=%s)',
    async (staleAcknowledgement) => {
      // queens21-h22-tree4-20261018a (2026-10-18): a cancel queued on a dead run made its resume
      // throw on the aborted recovery, and the next resume re-ran its work to budget exhaustion.
      await expect(superviseRoot({ captureFailure: 'partial', submitOn: 2 })).rejects.toMatchObject(
        {
          name: 'RetainedWorkspaceCapturePendingError',
        },
      )
      const directory = directories.at(-1)!
      const runDir = join(directory, 'run')
      cancelRun(runDir, 'dead-cancel', { reason: 'operator', source: 'test' })
      // The process that acknowledged the request died before the run settled.
      if (staleAcknowledgement) {
        applyRunCancellation(
          runDir,
          () => {},
          () => new Date().toISOString(),
        )
      }
      const run = await superviseRoot({ captureFailure: 'partial', submitOn: 2, directory })
      expect(run.result).toMatchObject({
        kind: 'no-winner',
        reason: 'cancelled',
        operationId: 'dead-cancel',
      })
      expect(run.dispatched).toHaveLength(0)
      expect(run.environments).toHaveLength(0)
      expect(readRunCancellation(runDir, 'dead-cancel')?.effect).toBe('cancelled')
    },
  )

  it('keeps an accepted turn with incomplete capture open without sealing a winner', async () => {
    await expect(superviseRoot({ captureFailure: 'partial', submitOn: 2 })).rejects.toMatchObject({
      name: 'RetainedWorkspaceCapturePendingError',
    })
    const runDir = join(directories.at(-1)!, 'run')
    const events = (await createFileRunContext(runDir).journal.loadTree('pending-root')) ?? []
    expect(count(events, 'execution-input')).toBe(1)
    expect(count(events, 'execution-result')).toBe(1)
    expect(events.some((event) => event.kind === 'environment-teardown' && event.destroyed)).toBe(
      false,
    )
  })

  it('preserves a raw-partial source through a checkpointed seat switch', async () => {
    const run = await superviseRoot({
      captureFailure: 'raw-partial',
      firstTurnFailure: { error: "You've hit your weekly limit" },
      seatSwitch: true,
      submitOn: 2,
    })
    expect(run.result).toMatchObject({ kind: 'winner', out: { answer: 'delivered' } })
    expect(run.environments).toHaveLength(2)
    expect(run.dispatched).toHaveLength(2)
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'workspace-checkpoint',
          environmentId: run.environments[0],
        }),
      ]),
    )
    expect(run.destroyed).not.toContain(run.environments[0])
    expect(run.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'environment-teardown',
          environmentId: run.environments[0],
          destroyed: true,
        }),
      ]),
    )
  })

  it('continues a retained Codex turn when only raw process capture is partial', async () => {
    const run = await superviseRoot({ captureFailure: 'raw-partial', submitOn: 2 })
    expect(run.result).toMatchObject({ kind: 'winner', out: { answer: 'delivered' } })
    expect(run.dispatched).toHaveLength(2)
    expect(run.environments).toHaveLength(1)
    expect(run.captures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceCapture: expect.objectContaining({
            coverageComplete: false,
            incompleteReason: expect.stringContaining('process_io_missing'),
            provenance: expect.objectContaining({
              workspace: expect.objectContaining({ complete: true }),
            }),
          }),
        }),
      ]),
    )
    expect(run.destroyed).not.toContain(run.environments[0])
  })

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
    const run = await superviseRoot({
      queuedWakesOnFirstResult: true,
      submitOn: Number.POSITIVE_INFINITY,
    })
    expect(run.dispatched.length).toBeGreaterThanOrEqual(2)
    expect(run.steerRecorded).toBe(true)
    expect(run.steerReplayed).toBe(true)
    expect(run.methodReceipt).toBeTruthy()
    const continuedTurns = JSON.stringify(run.dispatched.slice(1))
    expect(continuedTurns).toContain('use the corrected evidence')
    expect(continuedTurns).toContain('knowledge store is locked by this process')
    expect(continuedTurns).toContain(run.methodReceipt!)
    expect(continuedTurns.split('use the corrected evidence')).toHaveLength(2)
    expect(continuedTurns.split('knowledge store is locked by this process')).toHaveLength(2)
    // The steer's receipt ends at the root attempt that read it, never at queue admission.
    expect(readWorkerSteerAcknowledgement(run.runDir, 'retained-root-correction')).toMatchObject({
      effect: 'consumed',
      operationId: 'retained-root-correction',
      detail: 'the root consumed the steer in model attempt pending-root:attempt-2',
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

const RUN_DIGEST = `sha256:${'b'.repeat(64)}`
const STEER = 'the director ruled: do not tag rc15 until the check passes'

/** One turn the fake cli-bridge received: its durable run id and the prompt it carried. */
interface BridgePost {
  readonly runId: string
  readonly prompt: string
}

type BridgeTurn = (post: BridgePost, res: ServerResponse, index: number) => void | Promise<void>

/** A cli-bridge peer on a real socket: capability reads, run cancels, and one scripted answer per
 *  turn. Everything Runtime sends crosses HTTP, as it does to the bridge on a host. */
async function fakeCliBridge(turn: BridgeTurn): Promise<{ url: string; posts: BridgePost[] }> {
  const posts: BridgePost[] = []
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify(
          req.url === '/'
            ? {
                capabilities: {
                  profileMaterialization: 'cli-bridge.profile-materialization.v2',
                  usageCostProvenance: 'cli-bridge.usage-cost.v1',
                },
              }
            : { available: true, admission: { active: 0, maxActive: 4 } },
        ),
      )
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const cancelled = req.url?.match(/^\/v1\/runs\/([^/]+)\/cancel/u)?.[1]
    if (cancelled !== undefined) {
      const runId = decodeURIComponent(cancelled)
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-run-id': runId,
        'x-run-request-digest': RUN_DIGEST,
      })
      res.end(
        JSON.stringify({
          cancelled: true,
          cancel_requested: true,
          terminal: true,
          run: {
            id: runId,
            requestDigest: RUN_DIGEST,
            terminal: true,
            status: 'cancelled',
            state: 'terminal',
          },
        }),
      )
      return
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
      run_id: string
      model: string
      agent_profile: AgentProfile
      messages: Array<{ content: string }>
    }
    const post = { runId: body.run_id, prompt: body.messages.map((m) => m.content).join('\n') }
    posts.push(post)
    // Every answer carries the request's own materialization receipt, so a test turn is one the
    // executor accepts as exact.
    res.setHeader('x-run-id', body.run_id)
    res.setHeader('x-run-request-digest', RUN_DIGEST)
    ;(res as ServerResponse & { bridgeBody?: typeof body }).bridgeBody = body
    await turn(post, res, posts.length - 1)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, posts }
}

function sseFrame(id: number, data: unknown): string {
  return `id: ${id}\ndata: ${JSON.stringify(data)}\n\n`
}

/** The first frame of a turn: text and its billed usage. */
function bridgeTextFrame(text: string): string {
  return sseFrame(1, {
    choices: [{ delta: { content: text } }],
    usage: {
      prompt_tokens: 3,
      completion_tokens: 2,
      cost: 0.001,
      cost_known: true,
      cost_provenance: 'provider-receipt',
    },
  })
}

/** End a turn the way cli-bridge does: the profile receipt, then `[DONE]`. */
function endBridgeTurn(res: ServerResponse): void {
  const body = (
    res as ServerResponse & {
      bridgeBody?: { model: string; agent_profile: AgentProfile }
    }
  ).bridgeBody!
  const parts = body.model.split('/')
  res.end(
    `${sseFrame(2, {
      profile_materialization: {
        schema: 'cli-bridge.profile-materialization.v2',
        effectiveProfileDigest: canonicalAgentProfileDigest(body.agent_profile),
        harness: parts[0],
        provider: parts.length >= 3 ? parts[1] : (body.agent_profile.model?.provider ?? null),
        model: body.model,
        reasoningEffort: { requested: null, applied: null },
        workspacePlanDigest: `sha256:${'a'.repeat(64)}`,
        files: [],
        unsupported: [],
      },
    })}data: [DONE]\n\n`,
  )
}

function answerBridgeTurn(res: ServerResponse, text: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write(bridgeTextFrame(text))
  endBridgeTurn(res)
}

function bridgeWorker(url: string): Executor<unknown> {
  return bridgeExecutor(
    {
      profile: {
        name: 'core-4',
        harness: 'pi',
        model: { provider: 'tangle-router', default: 'glm-5.2' },
      },
      harness: null,
    },
    {
      signal: new AbortController().signal,
      seams: { bridge: { bridgeUrl: url, bridgeBearer: 'test-bearer' } },
    },
  )
}

async function runToEnd(stream: AsyncIterable<UsageEvent>): Promise<void> {
  for await (const _event of stream) {
    // Settlement is read from the executor and the peer, not from the usage stream.
  }
}

/** A steer as the coordination down-leg sends it: its receipt id and the sender's callback. */
function steerWithReceipt(receipts: InboxReceipt[], text = STEER) {
  return {
    steer: text,
    interrupt: false,
    receiptId: 'director-ruling',
    onReceipt: (r: InboxReceipt) => receipts.push(r),
  }
}

describe('a steer reaches a model input or stays pending, never lost with a failed turn', () => {
  it('a settle with an unconsumed steer is refused, and one more bridge turn folds and commits it', async () => {
    const receipts: InboxReceipt[] = []
    let worker!: Executor<unknown>
    const bridge = await fakeCliBridge((_post, res, index) => {
      // Mid-turn: the steer lands after turn 0 leased the inbox.
      if (index === 0) worker.deliver?.(steerWithReceipt(receipts))
      answerBridgeTurn(res, `turn ${index}`)
    })
    worker = bridgeWorker(bridge.url)
    await runToEnd(worker.execute('ship rc15', new AbortController().signal))

    expect(bridge.posts).toHaveLength(2)
    expect(bridge.posts[0]?.prompt).not.toContain(STEER)
    expect(bridge.posts[1]?.prompt).toContain(STEER)
    expect(receipts).toEqual([
      { outcome: 'queued', messageId: 'director-ruling' },
      { outcome: 'consumed', messageId: 'director-ruling', attemptId: bridge.posts[1]?.runId },
    ])
    expect(worker.progress?.()?.pendingMessages).toBe(0)
  })

  it('a steer leased into a bridge turn that fails reaches the next prompt (18b core-4)', async () => {
    const receipts: InboxReceipt[] = []
    let worker!: Executor<unknown>
    const bridge = await fakeCliBridge((_post, res, index) => {
      if (index === 0) worker.deliver?.(steerWithReceipt(receipts))
      // The turn that carries the steer dies before the bridge streams a frame.
      if (index === 1) {
        res.writeHead(502, { 'content-type': 'text/plain' })
        res.end('harness exited')
        return
      }
      answerBridgeTurn(res, `turn ${index}`)
    })
    worker = bridgeWorker(bridge.url)
    await expect(
      runToEnd(worker.execute('ship rc15', new AbortController().signal)),
    ).rejects.toThrow('bridge 502')
    expect(bridge.posts[1]?.prompt).toContain(STEER)
    // The failed turn read nothing: the steer is still held, and no receipt claims otherwise.
    expect(worker.progress?.()?.pendingMessages).toBe(1)
    expect(receipts.map((r) => r.outcome)).toEqual(['queued'])

    // The re-entry's first prompt carries the task and the ruling.
    await runToEnd(worker.execute('ship rc15', new AbortController().signal))
    expect(bridge.posts).toHaveLength(3)
    expect(bridge.posts[2]?.prompt).toContain('ship rc15')
    expect(bridge.posts[2]?.prompt).toContain(STEER)
    expect(receipts.at(-1)).toEqual({
      outcome: 'consumed',
      messageId: 'director-ruling',
      attemptId: bridge.posts[2]?.runId,
    })
    expect(worker.progress?.()?.pendingMessages).toBe(0)
  })

  it('a steer still unread after 15 minutes interrupts the bridge turn and is folded at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const receipts: InboxReceipt[] = []
    let held!: () => void
    const turnHeld = new Promise<void>((resolve) => {
      held = resolve
    })
    const bridge = await fakeCliBridge((_post, res, index) => {
      if (index === 0) {
        // A long turn: one frame, then nothing until Runtime cancels it.
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(bridgeTextFrame('working'))
        held()
        return
      }
      answerBridgeTurn(res, `turn ${index}`)
    })
    const worker = bridgeWorker(bridge.url)
    const run = runToEnd(worker.execute('ship rc15', new AbortController().signal))
    await turnHeld
    worker.deliver?.(steerWithReceipt(receipts))
    await vi.advanceTimersByTimeAsync(STEER_PROMOTION_MS - 1_000)
    expect(bridge.posts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await run

    expect(bridge.posts).toHaveLength(2)
    expect(bridge.posts[1]?.prompt).toContain(STEER)
    expect(receipts.at(-1)).toEqual({
      outcome: 'consumed',
      messageId: 'director-ruling',
      attemptId: bridge.posts[1]?.runId,
    })
  })

  it('a steer leased into a sandbox turn that fails reaches the next prompt', async () => {
    const receipts: InboxReceipt[] = []
    const prompts: string[] = []
    let worker!: Executor<unknown>
    const event = (text: string): SandboxEvent =>
      ({
        type: 'result',
        data: { finalText: text, usage: { inputTokens: 3, outputTokens: 2 } },
      }) as unknown as SandboxEvent
    const box = {
      id: 'fake-box',
      async *streamPrompt(message: string): AsyncGenerator<SandboxEvent> {
        prompts.push(message)
        const index = prompts.length - 1
        if (index === 0) worker.deliver?.(steerWithReceipt(receipts))
        // The provider stream fails before its first event.
        if (index === 1) throw new Error('sandbox stream reset')
        yield event(`turn ${index}`)
      },
      async delete() {},
    } as unknown as SandboxInstance
    const client: SandboxClient = { create: () => Promise.resolve(box) }
    worker = createExecutor({
      backend: 'sandbox',
      sandboxClient: client,
      steering: { maxTurns: 6 },
    })(
      { profile: testAgentProfile('core-4'), harness: 'opencode' },
      { signal: new AbortController().signal, seams: {} },
    )

    await expect(
      runToEnd(worker.execute('ship rc15', new AbortController().signal)),
    ).rejects.toThrow('sandbox stream reset')
    expect(prompts[1]).toContain(STEER)
    expect(receipts.map((r) => r.outcome)).toEqual(['queued'])

    await runToEnd(worker.execute('ship rc15', new AbortController().signal))
    expect(prompts[2]).toContain('ship rc15')
    expect(prompts[2]).toContain(STEER)
    expect(receipts.at(-1)).toMatchObject({
      outcome: 'consumed',
      messageId: 'director-ruling',
      attemptId: expect.stringMatching(/^sandbox-opencode-\d+:turn-0$/),
    })
  })
})
