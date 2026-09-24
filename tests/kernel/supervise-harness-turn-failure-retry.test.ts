import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { captureAgentCandidateWorkspaceFiles } from '../../src/candidate-execution'
import type { ProviderWorkspaceRetentionPort } from '../../src/runtime/environment-provider'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-retry'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { createCandidateOutputFixture } from '../helpers/candidate-execution-fixture'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

// The error text of a production failure measured 2026-09-17 on a Discovery director placed on
// tangle-sandbox with the opencode harness. The turn ended with a failed outcome rather than a
// thrown error, so the root never got the retry its driverRetry policy promised.
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
  readonly error: string
  /** A machine code the provider reports on its own error frame, before the terminal result. */
  readonly code?: string
  /** The turn submits the deliverable before its terminal result reports the failure. */
  readonly afterSubmit?: boolean
  /** The provider loses both its event stream and exact result before a terminal receipt exists. */
  readonly streamFailure?: boolean
}

interface DriverRetry {
  readonly enabled?: boolean
  readonly maxConsecutiveFailures?: number
  readonly maxAttempts?: number
}

/**
 * A retained provider-backed root whose Nth dispatched turn resolves with `failures(N)` as a failed
 * outcome, and whose first turn that does not fail submits the deliverable. `supervise` may be
 * called more than once on the same run directory and provider state, which is how a resume
 * after a process restart is exercised.
 */
async function harnessFailureFixture(options: {
  readonly runId: string
  readonly failures: (dispatch: number) => TurnFailure | undefined
  readonly workspaceRetention?: boolean
}) {
  const directory = await mkdtemp(join(tmpdir(), 'harness-turn-failure-'))
  directories.push(directory)
  const proxy = await coordinationProxy()
  proxies.push(proxy)
  const stateFile = join(directory, 'provider.json')
  const context = createFileRunContext(join(directory, 'run'))
  const environmentIds: string[] = []
  const sessionIds: Array<string | undefined> = []
  const failedExecutions = new Map<string, TurnFailure>()
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
        result: async () => {
          if (failure?.streamFailure) throw new Error(failure.error)
          return {
            ...(await session.result()),
            usage: { inputTokens: 3, outputTokens: 2 },
            ...(failure === undefined ? {} : { success: false, error: failure.error }),
          }
        },
      }
    },
    dispatch: async (turn) => {
      dispatches += 1
      const dispatch = dispatches
      environmentIds.push(environment.id)
      sessionIds.push(turn.sessionId)
      const dispatched = await environment.dispatch!(turn)
      const failure = options.failures(dispatch)
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
      token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
      return wrap(await base.create(input))
    },
    get: async (id) => {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  const workspaceRetention: ProviderWorkspaceRetentionPort | undefined =
    options.workspaceRetention === true
      ? (() => {
          const { outputArtifacts } = createCandidateOutputFixture()
          return {
            timeoutMs: 5_000,
            artifacts: outputArtifacts,
            async capture(context) {
              return (
                await captureAgentCandidateWorkspaceFiles(
                  [
                    {
                      path: 'failed-turn.txt',
                      mode: 0o644,
                      bytes: Uint8Array.from(Buffer.from('failed turn\n')),
                    },
                  ],
                  {
                    artifactPersistence: {
                      executionId: context.executionId,
                      outputArtifacts,
                    },
                  },
                )
              ).snapshot
            },
          }
        })()
      : undefined

  const run = async (
    driverRetry: DriverRetry,
    retainedAtSettlement: 'release' | 'keep' = 'release',
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
          ...(workspaceRetention === undefined ? {} : { workspaceRetention }),
        },
        driverBackend: {
          backend: 'provider',
          provider,
          ...(workspaceRetention === undefined ? {} : { workspaceRetention }),
        },
        budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: 60_000 },
        driverRetry: {
          ...driverRetry,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
          unavailablePauseMs: 0,
          maxUnavailablePauseMs: 0,
        },
        onDriverAttempt: (record) => void attempts.push(record),
        retainedAtSettlement,
        deliverable: {
          describe: 'the answer from a turn that did not fail',
          check: (value) => (value as { answer?: unknown }).answer === 'retried',
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
    ).finally(() => clearTimeout(timer))
    return { result, attempts }
  }
  return {
    run,
    events: async () => (await context.journal.loadTree(options.runId)) ?? [],
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
  it('is retried as a transient driver failure in a new turn on the retained environment', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-failure-then-success',
      failures: (dispatch) => (dispatch === 1 ? { error: UPSTREAM_TIMEOUT } : undefined),
    })
    const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 5 })
    const events = await fixture.events()

    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
    expect(fixture.dispatches()).toBe(2)

    // The failed turn stays on the record: its own input, its failed outcome, and its spend.
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

    // The retained design keeps the owner's environment for the whole scope, so the retry reuses
    // it: one create, both turns in the same environment and provider session, and one release at
    // settlement. A failed turn that tore the environment down would show a second create here.
    expect(fixture.creates()).toBe(1)
    expect(new Set(fixture.environmentIds).size).toBe(1)
    expect(fixture.sessionIds[1]).toBeDefined()
    expect(fixture.destroys()).toBe(1)
    expect(ofKind(events, 'environment-teardown')).toMatchObject([
      { destroyed: true, environmentId: fixture.environmentIds[0] },
    ])
  })

  it('pauses on an unavailable upstream, journals the pause, and never spends an attempt', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-failure-upstream-quota',
      failures: (dispatch) => (dispatch <= 4 ? { error: ROUTER_QUOTA } : undefined),
    })
    // One failure of any other kind would end this run.
    const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 1, maxAttempts: 1 })
    const events = await fixture.events()

    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
    expect(fixture.dispatches()).toBe(5)
    expect(attempts.map((attempt) => [attempt.classification, attempt.stop])).toEqual([
      ['unavailable', undefined],
      ['unavailable', undefined],
      ['unavailable', undefined],
      ['unavailable', undefined],
      [undefined, 'completed'],
    ])
    // Each pause is on the run's own record, against the root, as infrastructure time.
    const pauses = ofKind(events, 'paused')
    expect(pauses).toHaveLength(4)
    expect(pauses.map((pause) => [pause.id, pause.attempt, pause.signal, pause.seq])).toEqual([
      ['harness-failure-upstream-quota', 1, 'provider_quota_exhausted', 0],
      ['harness-failure-upstream-quota', 2, 'provider_quota_exhausted', 1],
      ['harness-failure-upstream-quota', 3, 'provider_quota_exhausted', 2],
      ['harness-failure-upstream-quota', 4, 'provider_quota_exhausted', 3],
    ])
    expect(pauses[0]?.cause).toContain('provider_quota_exhausted')
    expect(pauses.every((pause) => pause.pauseMs === 0 && pause.attemptMs >= 0)).toBe(true)
    // The refused turns keep their own records and the environment is reused throughout.
    expect(ofKind(events, 'execution-result')).toHaveLength(5)
    expect(fixture.creates()).toBe(1)
    expect(fixture.destroys()).toBe(1)
  })

  it('preserves an unreceipted failed owner source through terminal release', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-failure-unreceipted-retention',
      failures: () => ({ error: 'provider stream failed', streamFailure: true }),
      workspaceRetention: true,
    })
    const { result } = await fixture.run({ enabled: false }, 'release')
    const events = await fixture.events()

    expect(result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
    expect(fixture.destroys()).toBe(0)
    expect(ofKind(events, 'execution-result')).toHaveLength(0)
    expect(ofKind(events, 'environment-teardown')).toMatchObject([
      {
        destroyed: false,
        detail: expect.stringContaining('no verified workspace receipt'),
      },
    ])
    expect(ofKind(events, 'teardown-unconfirmed')).toHaveLength(1)
    expect(result.teardownUnconfirmed).toHaveLength(1)
    // The preserved source is evidence: named as kept, never as an environment a sweeper deletes.
    expect(result.teardownUnconfirmed?.[0]).not.toHaveProperty('environments')
    expect(result.teardownUnconfirmed?.[0]?.kept).toMatchObject([
      { environmentId: fixture.environmentIds[0], keptFor: 'evidence' },
    ])
  })

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

  it('keeps an accepted submission when the turn that submitted it then fails', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-failure-after-submit',
      failures: () => ({ error: UPSTREAM_TIMEOUT, afterSubmit: true }),
    })
    const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 5 })
    const events = await fixture.events()

    // Nothing is left to retry for: the completion check already accepted the value.
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
    // The first process has no retry, so it settles on the failed turn. It keeps the environment,
    // as a run a later process may resume does.
    const first = await fixture.run({ enabled: false }, 'keep')
    expect(first.result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
    expect(first.attempts).toMatchObject([{ classification: 'transient', stop: 'retry-disabled' }])
    expect(fixture.dispatches()).toBe(1)

    const resumed = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 5 })
    const events = await fixture.events()

    expect(resumed.result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
    expect(fixture.dispatches()).toBe(2)
    // The replayed failure is attempt 1 of the resumed process; it dispatches nothing itself.
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
