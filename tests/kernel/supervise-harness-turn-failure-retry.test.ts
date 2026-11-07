import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnFailure,
} from '@tangle-network/agent-interface/environment-provider'
import {
  createCommandModelCredentialResolver,
  TangleCredentialCapacityError,
} from '@tangle-network/agent-provider-tangle/node'
import { afterEach, describe, expect, it } from 'vitest'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-attempt-evidence'
import { cancelRun, readRunCancellation } from '../../src/runtime/supervise/run-cancellation'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

// A measured 2026-09-17 opencode failure: a failed outcome, not a throw, so driverRetry never ran.
const UPSTREAM_TIMEOUT = 'opencode execution failed: status code 524 (exit code 1)'
// The refusal that ended four of five anomaly-referee-v3d lead lanes on 2026-09-24.
const ROUTER_QUOTA =
  'opencode execution failed: No provider served model "deepseek/deepseek-v4.1-flash" ' +
  '(provider_quota_exhausted). A provider is configured and was called. (exit code 1)'

const directories: string[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

interface TurnFailure {
  readonly failure?: AgentTurnFailure
  readonly throwResult?: boolean
  readonly error: string
  /** A machine code the provider reports on its own error frame, before the terminal result. */
  readonly code?: string
  /** The turn submits the deliverable before its terminal result reports the failure. */
  readonly afterSubmit?: boolean
  /** The provider loses both its event stream and exact result before a terminal receipt exists. */
  readonly streamFailure?: boolean
  /** Dispatch rejects before the provider admits a native execution. */
  readonly dispatchFailure?: boolean
}

interface HarnessFixtureOptions {
  readonly runId: string
  readonly failures: (dispatch: number) => TurnFailure | undefined
  /** Thrown by environment creation, before any dispatch: a provider command that failed. */
  readonly createFailure?: () => Error | undefined | Promise<Error | undefined>
  readonly deadlineMs?: number
  /** A director that never submits is paused by its barren streak; this deadline ends the run. */
  readonly continuationDeadlineMs?: number
  readonly maxBarren?: number
  /** Sandbox keeps the first execution as the session owner until that execution is cancelled. */
  readonly deadOwnerBlocksReplacement?: boolean
}

interface DriverRetry {
  readonly enabled?: boolean
  readonly maxConsecutiveFailures?: number
  readonly maxAttempts?: number
}

/** Nth dispatch fails. The first success submits. A second supervise call is a resume. */
async function harnessFailureFixture(options: HarnessFixtureOptions) {
  const directory = await mkdtemp(join(tmpdir(), 'harness-turn-failure-'))
  directories.push(directory)
  const proxy = await coordinationProxy()
  proxies.push(proxy)
  const stateFile = join(directory, 'provider.json')
  const context = createFileRunContext(join(directory, 'run'))
  const environmentIds: string[] = []
  const sessionIds: Array<string | undefined> = []
  const failedExecutions = new Map<string, TurnFailure>()
  const releasedExecutions = new Set<string>()
  let ownerExecutionId: string | undefined
  let creates = 0
  let destroys = 0
  let dispatches = 0
  let port = 0
  let token = ''

  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session: (id, sessionOptions) => {
      const session = environment.session!(id, sessionOptions)
      const failure = failedExecutions.get(sessionOptions?.controlRef?.executionId ?? '')
      return {
        ...session,
        async *events(eventOptions): AsyncIterable<AgentEnvironmentEvent> {
          yield* session.events!(eventOptions)
          if (failure?.streamFailure) throw new Error(failure.error)
          if (failure?.code !== undefined) {
            yield {
              id: 'event-error',
              type: 'error',
              data: { message: failure.error, code: failure.code },
            }
          }
        },
        cancelRun: async (request) => {
          releasedExecutions.add(request.run.executionId)
          return session.cancelRun!(request)
        },
        result: async () => {
          if (failure?.streamFailure) throw new Error(failure.error)
          if (failure?.throwResult)
            throw new TangleCredentialCapacityError(
              'provider_quota_exhausted',
              'exhausted',
              failure.failure?.resetAt,
              429,
            )
          return {
            ...(await session.result()),
            usage: { inputTokens: 3, outputTokens: 2 },
            ...(failure === undefined
              ? {}
              : {
                  success: false,
                  error: failure.error,
                  ...(failure.failure ? { failure: failure.failure } : {}),
                }),
          }
        },
      }
    },
    dispatch: async (turn) => {
      dispatches += 1
      const dispatch = dispatches
      environmentIds.push(environment.id)
      sessionIds.push(turn.sessionId)
      if (
        options.deadOwnerBlocksReplacement === true &&
        ownerExecutionId !== undefined &&
        !releasedExecutions.has(ownerExecutionId)
      ) {
        throw Object.assign(
          new Error(
            'sandbox dispatch returned an execution id different from the requested run: another execution owns the session or turn and nothing was dispatched',
          ),
          {
            name: 'TangleDispatchNotAdmittedError',
            code: 'DISPATCH_NOT_ADMITTED',
            sessionId: turn.sessionId ?? 'retained-session',
            requestedExecutionId: turn.executionId,
            activeExecutionId: ownerExecutionId,
          },
        )
      }
      const failure = options.failures(dispatch)
      if (failure?.dispatchFailure) throw new Error(failure.error)
      const dispatched = await environment.dispatch!(turn)
      ownerExecutionId ??= dispatched.controlRef?.executionId
      if (failure !== undefined) {
        failedExecutions.set(dispatched.controlRef!.executionId!, failure)
        if (!failure.afterSubmit) return dispatched
      }
      const response = await fetch(`http://127.0.0.1:${port}/manager`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `submit-${dispatch}`,
          method: 'tools/call',
          params: { name: 'submit_result', arguments: { result: { answer: 'retried' } } },
        }),
      })
      if (!response.ok) throw new Error(`submit_result returned ${response.status}`)
      return dispatched
    },
    destroy: async () => {
      destroys += 1
      await environment.destroy?.()
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
      creates += 1
      const refused = await options.createFailure?.()
      if (refused !== undefined) throw refused
      token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
      return wrap(await base.create(input))
    },
    get: async (id) => {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  const run = async (
    driverRetry: DriverRetry,
    retainedAtSettlement: 'release' | 'keep' = 'release',
    afterAttempt?: (record: DriverAttemptRecord) => void | Promise<void>,
  ) => {
    const attempts: DriverAttemptRecord[] = []
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(new Error('test run timed out')), 20_000)
    const result = await supervise(
      testAgentProfile('root', {
        harness: 'opencode',
        tools: runtimeToolDeclarations('submit_result'),
      }),
      'Produce the answer.',
      {
        runDir: join(directory, 'run'),
        runId: options.runId,
        journal: context.journal,
        blobs: context.blobs,
        signal: abort.signal,
        backend: {
          backend: 'provider',
          provider,
        },
        driverBackend: {
          backend: 'provider',
          provider,
        },
        budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: options.deadlineMs ?? 60_000 },
        driverRetry: {
          ...driverRetry,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
          unavailablePauseMs: 0,
          maxUnavailablePauseMs: 0,
        },
        onDriverAttempt: async (record) => {
          attempts.push(record)
          await afterAttempt?.(record)
        },
        retainedAtSettlement,
        deliverable: {
          describe: 'the answer from a turn that did not fail',
          check: (value) => (value as { answer?: unknown }).answer === 'retried',
        },
        continuation: testContinuation({
          ...(options.maxBarren === undefined ? {} : { maxBarren: options.maxBarren }),
          deadline:
            Date.now() + (options.continuationDeadlineMs ?? options.deadlineMs ?? 3_600_000),
        }),
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
    ).finally(() => clearTimeout(timer))
    return { result, attempts }
  }
  return {
    run,
    runDir: join(directory, 'run'),
    events: async () => (await context.journal.loadTree(options.runId)) ?? [],
    blobs: context.blobs,
    environmentIds,
    sessionIds,
    creates: () => creates,
    destroys: () => destroys,
    dispatches: () => dispatches,
  }
}

function ofKind<K extends SpawnEvent['kind']>(
  events: readonly SpawnEvent[],
  kind: K,
): Array<Extract<SpawnEvent, { kind: K }>> {
  return events.filter((event): event is Extract<SpawnEvent, { kind: K }> => event.kind === kind)
}

function meteredTokens(events: readonly SpawnEvent[]): number {
  return ofKind(events, 'metered').reduce(
    (total, event) => total + event.spend.tokens.input + event.spend.tokens.output,
    0,
  )
}

describe('a root harness turn that ends with a failed outcome', () => {
  it('commits a pre-admission dispatch failure before cancellation and survives cold readback', async () => {
    const runId = 'dispatch-failure-cancelled'
    const failure = 'dispatchPrompt did not receive an execution admission from the sandbox'
    const fixture = await harnessFailureFixture({
      runId,
      failures: () => ({ error: failure, dispatchFailure: true }),
    })
    const { result } = await fixture.run({ maxAttempts: 5 }, 'release', async (record) => {
      const cold = createFileRunContext(fixture.runDir)
      const events = (await cold.journal.loadTree(runId)) ?? []
      expect(ofKind(events, 'driver-attempt')).toMatchObject([
        { id: runId, seq: 0, record: { attempt: 1, error: expect.stringContaining(failure) } },
      ])
      if (record.attempt === 1) {
        cancelRun(fixture.runDir, 'stop-dispatch-retries', {
          operator: 'test-operator',
          source: 'operator',
          reason: 'inspect failure',
        })
        await expect
          .poll(() => readRunCancellation(fixture.runDir, 'stop-dispatch-retries')?.effect)
          .toBe('cancel_requested')
      }
    })
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'cancelled', source: 'operator' })
    expect(fixture.dispatches()).toBe(1)
    const cold = createFileRunContext(fixture.runDir)
    const events = (await cold.journal.loadTree(runId)) ?? []
    expect(
      ofKind(events, 'execution-admitted').every((event) => event.admission.phase !== 'dispatched'),
    ).toBe(true)
    expect(ofKind(events, 'execution-result')).toHaveLength(0)
    expect(ofKind(events, 'driver-attempt')[0]?.record.error).toContain(failure)
    expect(readRunCancellation(fixture.runDir, 'stop-dispatch-retries')?.effect).toBe('cancelled')
  })

  it('bounds and redacts a rejected dispatch before journaling its error', async () => {
    const runId = 'dispatch-failure-redacted'
    const secret = `sk-proj-${'a'.repeat(100)}`
    const fixture = await harnessFailureFixture({
      runId,
      failures: () => ({
        error: `Authorization: Bearer ${secret}${' '.repeat(40_000)}`,
        dispatchFailure: true,
      }),
    })
    const { result } = await fixture.run({ enabled: false })
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
    const events = await fixture.events()
    const attempt = ofKind(events, 'driver-attempt')[0]?.record
    const error = attempt?.error
    expect(error).toBeDefined()
    expect(error).not.toContain(secret)
    expect(error).toContain('REDACTED')
    expect(error!.length).toBeLessThanOrEqual(32_768)
    // The cause's stack rides along, bounded and redacted like the message (#2347).
    const stack = attempt?.errorStack
    expect(stack).toBeDefined()
    expect(stack).not.toContain(secret)
    expect(stack!.length).toBeLessThanOrEqual(32_768)
    expect(stack!.split('\n').length).toBeLessThanOrEqual(40)
    expect(stack).toMatch(/\bat\b/)
  })

  it('is retried as a transient driver failure in a new turn on the retained environment', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-failure-then-success',
      failures: (dispatch) => (dispatch === 1 ? { error: UPSTREAM_TIMEOUT } : undefined),
    })
    const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 5 })
    const events = await fixture.events()

    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
    expect(fixture.dispatches()).toBe(2)

    expect(ofKind(events, 'execution-input')).toHaveLength(2)
    const results = ofKind(events, 'execution-result')
    expect(results).toHaveLength(2)
    expect(results[0]?.outcome).toEqual({ success: false, error: UPSTREAM_TIMEOUT })
    expect(results[1]?.outcome).toBeUndefined()
    // 5 tokens per turn, each metered once: the retry does not re-charge the failed turn.
    expect(meteredTokens(events)).toBe(10)

    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toMatchObject({ attempt: 1, classification: 'transient', retryInMs: 0 })
    expect(attempts[0]?.error).toContain(UPSTREAM_TIMEOUT)
    expect(attempts[0]?.stop).toBeUndefined()
    expect(attempts[1]).toMatchObject({ attempt: 2, stop: 'completed', contract: 'met' })

    // The retry reuses the environment: one create, one session, one release.
    expect(fixture.creates()).toBe(1)
    expect(new Set(fixture.environmentIds).size).toBe(1)
    expect(fixture.sessionIds[1]).toBeDefined()
    expect(fixture.destroys()).toBe(1)
    expect(ofKind(events, 'environment-teardown')).toMatchObject([
      { destroyed: true, environmentId: fixture.environmentIds[0] },
    ])
  })

  it('replaces a SIGKILLed execution instead of retrying against its id', async () => {
    const killed = 'OpenCode exited while a model step was still in progress (killed by SIGKILL)'
    const fixture = await harnessFailureFixture({
      runId: 'sigkill-replaceable',
      deadOwnerBlocksReplacement: true,
      failures: (dispatch) => (dispatch === 1 ? { error: killed } : undefined),
    })
    const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 5 })
    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
    expect(fixture.dispatches()).toBe(2)
    expect(attempts[0]?.error).toContain('SIGKILL')
    expect(attempts.at(-1)).toMatchObject({ stop: 'completed', contract: 'met' })
  })

  it('settles an unchanged unavailable upstream after three drives without spending failure allowances', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-failure-upstream-quota',
      failures: () => ({ error: ROUTER_QUOTA }),
    })
    const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 1, maxAttempts: 1 })
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
    expect(fixture.dispatches()).toBe(3)
    expect(attempts.map((attempt) => [attempt.classification, attempt.stop])).toEqual([
      ['unavailable', undefined],
      ['unavailable', undefined],
      ['unavailable', 'repeated-failure'],
    ])
    const events = await fixture.events()
    expect(ofKind(events, 'paused')).toHaveLength(2)
    expect(ofKind(events, 'execution-result')).toHaveLength(3)
    expect(fixture.creates()).toBe(1)
    expect(fixture.destroys()).toBe(1)
  })

  it.each([
    ['capacity', false, 'unavailable', 'infra'],
    ['capacity', true, 'unavailable', 'infra'],
    ['caller', false, 'terminal', 'deterministic'],
    ['infra', false, 'transient', 'infra'],
    ['work', false, 'transient', 'deterministic'],
  ] as const)(
    'preserves typed %s failure (thrown=%s) through retained execution and retry',
    async (kind, throwResult, classification, failureKind) => {
      const failure: AgentTurnFailure = {
        kind,
        code: throwResult ? 'provider_quota_exhausted' : 'opaque_producer_code',
        ...(kind === 'capacity' && throwResult
          ? { resetAt: new Date(Date.now() + 3_600_000).toISOString() }
          : {}),
      }
      const fixture = await harnessFailureFixture({
        runId: `typed-${kind}-${throwResult}`,
        failures: (dispatch) =>
          dispatch === 1 || kind === 'work' || kind === 'caller'
            ? { error: `Opaque producer result ${dispatch}`, failure, throwResult }
            : undefined,
      })
      const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 4 })
      const events = await fixture.events()
      expect(ofKind(events, 'execution-result')[0]?.outcome).toMatchObject({
        success: false,
        failure,
      })
      expect(attempts[0]).toMatchObject({ classification })
      if (kind === 'capacity' && throwResult) {
        expect(fixture.dispatches()).toBe(1)
        expect(attempts[0]?.stop).toBe('deadline')
      } else if (kind === 'caller') {
        expect(fixture.dispatches()).toBe(1)
        expect(attempts[0]?.stop).toBe('terminal-error')
      } else if (kind === 'work') {
        expect(fixture.dispatches()).toBe(2)
        expect(attempts[0]?.failureKind).toBe(failureKind)
        expect(attempts[1]?.stop).toBeDefined()
      } else {
        expect(result.kind).toBe('winner')
        expect(fixture.dispatches()).toBe(2)
        if (kind === 'capacity') {
          expect(ofKind(events, 'paused')[0]?.signal).toBe(failure.code)
        } else expect(attempts[0]?.failureKind).toBe(failureKind)
      }
    },
  )

  it('stops with no-progress once failed outcomes exceed maxConsecutiveFailures', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-failure-repeated',
      failures: () => ({ error: UPSTREAM_TIMEOUT }),
    })
    const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 10 })
    const events = await fixture.events()

    expect(result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
    if (result.kind === 'no-winner' && result.reason === 'driver-failed') {
      expect(result.error.name).toBe('DriverAttemptsExhaustedError')
      expect(result.error.message).toContain('stopped by no-progress')
      expect(result.error.message).toContain(UPSTREAM_TIMEOUT)
    }
    expect(fixture.dispatches()).toBe(2)
    expect(attempts.map((attempt) => [attempt.classification, attempt.stop])).toEqual([
      ['transient', undefined],
      ['transient', 'no-progress'],
    ])
    expect(ofKind(events, 'execution-result').map((event) => event.outcome)).toEqual([
      { success: false, error: UPSTREAM_TIMEOUT },
      { success: false, error: UPSTREAM_TIMEOUT },
    ])
    expect(meteredTokens(events)).toBe(10)
    expect(fixture.creates()).toBe(1)
    expect(fixture.destroys()).toBe(1)
  })

  it('keeps a deterministic refusal code terminal and never dispatches again', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-failure-deterministic',
      failures: () => ({ error: 'the harness may not use this tool', code: 'capability_denied' }),
    })
    const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 5, maxAttempts: 10 })
    const events = await fixture.events()

    expect(result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
    expect(fixture.dispatches()).toBe(1)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ classification: 'terminal', stop: 'terminal-error' })
    expect(ofKind(events, 'execution-result').map((event) => event.outcome)).toEqual([
      {
        success: false,
        error: 'the harness may not use this tool',
        errorCode: 'capability_denied',
      },
    ])
    expect(fixture.creates()).toBe(1)
    expect(fixture.destroys()).toBe(1)
  })

  it('settles three identical credential command refusals before any dispatch', async () => {
    let refusals = 0
    const fixture = await harnessFailureFixture({
      runId: 'harness-credential-unavailable',
      failures: () => undefined,
      createFailure: async () => {
        refusals++
        return credentialCommandExit1()
      },
    })
    const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 3 })
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
    expect(refusals).toBe(3)
    expect(attempts.at(-1)).toMatchObject({
      classification: 'unavailable',
      stop: 'repeated-failure',
    })
    expect(
      attempts.every((attempt) =>
        attempt.error?.includes('Tangle credential command failed (exit 1)'),
      ),
    ).toBe(true)
    const events = await fixture.events()
    expect(ofKind(events, 'paused')).toHaveLength(2)
    expect(ofKind(events, 'execution-abandoned')).toHaveLength(0)
    expect(fixture.dispatches()).toBe(0)
  })

  it('keeps an accepted submission when the turn that submitted it then fails', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-failure-after-submit',
      failures: () => ({ error: UPSTREAM_TIMEOUT, afterSubmit: true }),
    })
    const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 5 })
    const events = await fixture.events()

    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
    expect(fixture.dispatches()).toBe(1)
    expect(attempts).toMatchObject([{ attempt: 1, stop: 'completed', contract: 'met' }])
    expect(attempts[0]?.classification).toBeUndefined()
    expect(ofKind(events, 'execution-result').map((event) => event.outcome)).toEqual([
      { success: false, error: UPSTREAM_TIMEOUT },
    ])
  })

  it('replays a committed failed turn as a failure on resume and runs a new turn', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-failure-resumed',
      failures: (dispatch) => (dispatch === 1 ? { error: UPSTREAM_TIMEOUT } : undefined),
    })
    // No retry, so the first process settles failed and keeps the environment for a resume.
    const first = await fixture.run({ enabled: false }, 'keep')
    expect(first.result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
    expect(first.attempts).toMatchObject([{ classification: 'transient', stop: 'retry-disabled' }])
    expect(fixture.dispatches()).toBe(1)

    const resumed = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 5 })
    const events = await fixture.events()

    expect(resumed.result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
    expect(fixture.dispatches()).toBe(2)
    const cold = createFileRunContext(fixture.runDir)
    const durable = ofKind(
      (await cold.journal.loadTree('harness-failure-resumed')) ?? [],
      'driver-attempt',
    )
    expect(durable.map((event) => [event.seq, event.record.attempt])).toEqual([
      [0, 1],
      [1, 1],
      [2, 2],
    ])
    expect(durable[0]?.record.error).toContain(UPSTREAM_TIMEOUT)
    expect(durable[1]?.record.error).toContain(UPSTREAM_TIMEOUT)
    expect(durable[2]?.record.stop).toBe('completed')
    expect(resumed.attempts).toMatchObject([
      { attempt: 1, classification: 'transient', retryInMs: 0 },
      { attempt: 2, stop: 'completed', contract: 'met' },
    ])
    expect(ofKind(events, 'execution-input')).toHaveLength(2)
    expect(ofKind(events, 'execution-result').map((event) => event.outcome)).toEqual([
      { success: false, error: UPSTREAM_TIMEOUT },
      undefined,
    ])
    expect(meteredTokens(events)).toBe(10)
    expect(fixture.creates()).toBe(1)
    expect(new Set(fixture.environmentIds).size).toBe(1)
    expect(fixture.destroys()).toBe(1)
  })
})

/** The rejection agent-provider-tangle's credential command resolver raises when its command exits 1. */
async function credentialCommandExit1(): Promise<Error> {
  const resolve = createCommandModelCredentialResolver({
    command: [
      process.execPath,
      '-e',
      "process.stdin.resume(); process.stdin.once('end', () => { process.exitCode = 1 })",
    ],
  })
  const profile = testAgentProfile('credential-unavailable', {
    model: {
      provider: 'offline',
      default: 'offline-test-model',
      metadata: { credentialSource: 'subscription' },
    },
  })
  try {
    await resolve({ profile, idempotencyKey: 'credential-unavailable' })
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('the credential command resolver did not reject its failing command')
}
