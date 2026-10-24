import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { createCommandModelCredentialResolver } from '@tangle-network/agent-provider-tangle/node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureAgentCandidateWorkspaceFiles } from '../../src/candidate-execution'
import type { ProviderWorkspaceRetentionPort } from '../../src/runtime/provider-workspace-retention'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-attempt-evidence'
import { cancelRun, readRunCancellation } from '../../src/runtime/supervise/run-cancellation'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { createCandidateOutputFixture } from '../helpers/candidate-execution-fixture'
import { completeCapture } from '../helpers/complete-workspace-capture'
import { testContinuation } from '../helpers/continuation'
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
  /** Dispatch rejects before the provider admits a native execution. */
  readonly dispatchFailure?: boolean
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
  /** `'timeout'` retains through a capture that outlives its deadline. `'expired'` refuses the
   *  first environment's first `captureFailures` captures as an expired Platform key does. */
  readonly workspaceRetention?: boolean | 'timeout' | 'expired'
  readonly captureFailures?: number
  /** With `'expired'`: the first environment's captures are refused for this long on the run's
   *  clock from the first refusal, instead of `captureFailures` times. */
  readonly captureRefusedForMs?: number
  /** A turn that completes without submitting, leaving the contract unmet. */
  readonly withholdsSubmit?: (dispatch: number) => boolean
  /** Explicit caller cancellation arrives after capture recovery failed, during source cleanup. */
  readonly cancelDuringTeardown?: boolean
  /** Thrown by environment creation, before any dispatch: a provider command that failed. */
  readonly createFailure?: () => Error | undefined | Promise<Error | undefined>
  /** Awaited by a dispatched turn before it submits the deliverable. */
  readonly beforeSubmit?: (dispatch: number) => Promise<void>
  readonly deadlineMs?: number
  /** Milliseconds from now to the continuation deadline alone; defaults to `deadlineMs`, then
   *  one hour. A director that never submits is only paused by its barren streak, and this
   *  deadline ends its run. */
  readonly continuationDeadlineMs?: number
  /** Continuations without progress the root may make; the test default is 2. */
  readonly maxBarren?: number
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
  let captureResumed = false
  let refusedCaptures = 0
  let sourceCaptures = 0
  let refusedSince: number | undefined
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
      const failure = options.failures(dispatch)
      if (failure?.dispatchFailure) throw new Error(failure.error)
      const dispatched = await environment.dispatch!(turn)
      if (failure !== undefined) {
        failedExecutions.set(dispatched.controlRef!.executionId!, failure)
        if (!failure.afterSubmit) return dispatched
      }
      if (options.withholdsSubmit?.(dispatch)) return dispatched
      await options.beforeSubmit?.(dispatch)
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
  const workspaceRetention: ProviderWorkspaceRetentionPort | undefined =
    options.workspaceRetention !== undefined && options.workspaceRetention !== false
      ? (() => {
          const { outputArtifacts } = createCandidateOutputFixture()
          const timesOut = options.workspaceRetention === 'timeout'
          const expires = options.workspaceRetention === 'expired'
          return {
            timeoutMs: timesOut ? 50 : 5_000,
            artifacts: outputArtifacts,
            async capture(context) {
              if (expires) {
                if (context.environment.id === environmentIds[0]) {
                  sourceCaptures += 1
                  const refuses =
                    options.captureRefusedForMs === undefined
                      ? refusedCaptures < (options.captureFailures ?? Number.POSITIVE_INFINITY)
                      : Date.now() - (refusedSince ?? Date.now()) < options.captureRefusedForMs
                  if (refuses) {
                    refusedSince ??= Date.now()
                    refusedCaptures += 1
                    // Discovery run magnetar-rust-20261016d's capture refusal.
                    throw new Error('This Platform key has expired')
                  }
                }
                return completeCapture(context, outputArtifacts)
              }
              // A multi-GB transfer that is still running when its deadline aborts it.
              if (timesOut && !captureResumed)
                await new Promise((_, reject) =>
                  context.signal.addEventListener('abort', () => reject(context.signal.reason), {
                    once: true,
                  }),
                )
              if (timesOut) return completeCapture(context, outputArtifacts)
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
        journal: options.cancelDuringTeardown
          ? {
              beginTree: context.journal.beginTree.bind(context.journal),
              loadTree: context.journal.loadTree.bind(context.journal),
              async appendEvent(root, event) {
                await context.journal.appendEvent(root, event)
                if (event.kind === 'teardown-unconfirmed')
                  abort.abort(new Error('operator cancelled during capture cleanup'))
              },
            }
          : context.journal,
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
    resumeCapture: () => {
      captureResumed = true
    },
    sourceCaptures: () => sourceCaptures,
    refusedSince: () => refusedSince,
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
    const error = ofKind(events, 'driver-attempt')[0]?.record.error
    expect(error).toBeDefined()
    expect(error).not.toContain(secret)
    expect(error).toContain('REDACTED')
    expect(error!.length).toBeLessThanOrEqual(32_768)
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

  // magnetar-rust-20261016b/d (2026-10-16): an accepted root turn whose workspace capture failed
  // ("This Platform key has expired") exited the supervisor, and each restart met the same
  // failure: 66 supervisor starts in 17 runs, 76.7 wall-hours with nothing driving the run. The
  // failure is evidence debt on the node: the run continues, the source is never mutated, and the
  // owner retries the capture on backoff until one lands.
  async function evidenceDebt(
    events: readonly SpawnEvent[],
    blobs: Awaited<ReturnType<typeof harnessFailureFixture>>['blobs'],
    source: string,
  ) {
    const receipts = await Promise.all(
      ofKind(events, 'execution-evidence').map(
        async (event) =>
          (await blobs.get(event.outRef)) as {
            readonly workspaceCapture?: { readonly environmentId?: string }
          },
      ),
    )
    return {
      rows: ofKind(events, 'evidence-pending'),
      receipts: receipts.filter((output) => output.workspaceCapture?.environmentId === source),
    }
  }

  it('keeps the supervisor up and the result evidence-incomplete while every capture fails', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-retention-expired-kept',
      failures: () => undefined,
      // The first turn is accepted without a submission, so the node continues.
      withholdsSubmit: (dispatch) => dispatch === 1,
      workspaceRetention: 'expired',
    })
    const { result, attempts } = await fixture.run({})
    expect(result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
    expect(attempts.at(-1)).toMatchObject({ stop: 'completed', contract: 'met' })
    expect(fixture.dispatches()).toBe(2)
    const source = fixture.environmentIds[0]!
    // The continuation never ran in the uncaptured source.
    expect(fixture.environmentIds[1]).not.toBe(source)
    const events = await fixture.events()
    expect(ofKind(events, 'execution-abandoned')).toHaveLength(0)
    const { rows, receipts } = await evidenceDebt(events, fixture.blobs, source)
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'harness-retention-expired-kept',
        environmentId: source,
        error: expect.stringContaining('This Platform key has expired'),
        since: expect.any(String),
      }),
    ])
    expect(receipts).toHaveLength(0)
    // Still owed at release: the settled result names the source kept for evidence.
    expect(result.teardownUnconfirmed).toEqual([
      expect.objectContaining({
        kept: [expect.objectContaining({ environmentId: source, keptFor: 'evidence' })],
      }),
    ])
    expect(fixture.destroys()).toBe(1)
  })

  it('pays the evidence debt when the sixth capture lands after five expired-key refusals', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const fixture: Awaited<ReturnType<typeof harnessFailureFixture>> =
        await harnessFailureFixture({
          runId: 'harness-retention-expired-paid',
          failures: () => undefined,
          withholdsSubmit: (dispatch) => dispatch === 1,
          workspaceRetention: 'expired',
          captureFailures: 5,
          deadlineMs: 24 * 60 * 60_000,
          // The second turn runs while the owner retries; it submits once the capture landed. The
          // clock moves 15 fake seconds per 50 ms, so each retry's backoff elapses within a tick.
          beforeSubmit: async (dispatch) => {
            if (dispatch !== 2) return
            while (fixture.sourceCaptures() < 6) {
              vi.setSystemTime(Date.now() + 15_000)
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
          },
        })
      const { result, attempts } = await fixture.run({})
      expect(result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
      expect(attempts.at(-1)).toMatchObject({ stop: 'completed', contract: 'met' })
      expect(fixture.dispatches()).toBe(2)
      expect(fixture.sourceCaptures()).toBe(6)
      const source = fixture.environmentIds[0]!
      expect(fixture.environmentIds[1]).not.toBe(source)
      const { rows, receipts } = await evidenceDebt(await fixture.events(), fixture.blobs, source)
      // One row for the debt, however many captures failed, and the receipt that paid it.
      expect(rows).toHaveLength(1)
      expect(rows[0]?.error).toContain('This Platform key has expired')
      expect(receipts).toHaveLength(1)
      // Nothing is owed at release: no source is kept and both environments are destroyed.
      expect(result.teardownUnconfirmed).toBeUndefined()
      expect(fixture.destroys()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  // H23-store-refuses (durability contract): the evidence target refuses for 10 minutes. The run
  // reads "durable copy behind since T" from the one `evidence-pending` row, the node finishes
  // meanwhile, and once the target answers the capture lands, so no source is left only on the box.
  it('H23: holds one row behind since the first refusal and leaves 0 sources host-only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const fixture: Awaited<ReturnType<typeof harnessFailureFixture>> =
        await harnessFailureFixture({
          runId: 'harness-retention-store-refuses',
          failures: () => undefined,
          withholdsSubmit: (dispatch) => dispatch === 1,
          workspaceRetention: 'expired',
          captureRefusedForMs: 10 * 60_000,
          deadlineMs: 24 * 60 * 60_000,
          beforeSubmit: async (dispatch) => {
            if (dispatch !== 2) return
            const paid = async () =>
              (
                await evidenceDebt(
                  await fixture.events(),
                  fixture.blobs,
                  fixture.environmentIds[0]!,
                )
              ).receipts.length > 0
            while (!(await paid())) {
              vi.setSystemTime(Date.now() + 15_000)
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
          },
        })
      const { result } = await fixture.run({})
      expect(result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
      const source = fixture.environmentIds[0]!
      expect(fixture.environmentIds[1]).not.toBe(source)
      const { rows, receipts } = await evidenceDebt(await fixture.events(), fixture.blobs, source)
      const since = fixture.refusedSince()!
      expect(rows).toHaveLength(1)
      expect(rows[0]?.since).toBe(new Date(since).toISOString())
      // The durable copy landed only after the target answered again.
      expect(receipts).toHaveLength(1)
      expect(Date.now() - since).toBeGreaterThanOrEqual(10 * 60_000)
      // 0 host-only: nothing is kept for evidence and both environments are destroyed.
      expect(result.teardownUnconfirmed).toBeUndefined()
      expect(fixture.destroys()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  // test-acceptance-canary-20261015c (2026-10-15) met 26 credential command failures in 2.2
  // minutes, each before any execution existed, and each counted toward the pending-unresolved
  // stop: 306 such attempts stopped 10 nodes and lost 7 runs from 2026-10-12 to 2026-10-19.
  it('H13: pauses, never stops, while the credential command fails before any dispatch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const startedAt = Date.now()
      let refusals = 0
      const fixture = await harnessFailureFixture({
        runId: 'harness-credential-unavailable',
        failures: () => undefined,
        deadlineMs: 60 * 60_000,
        createFailure: async () => {
          if (Date.now() - startedAt >= 10 * 60_000) return undefined
          refusals += 1
          // The provider process: agent-provider-tangle's own credential resolver running a
          // command that exits 1, which the next attempt meets one fake minute later. The real
          // resolver pins the failure's shape, so a reworded message fails this test instead of
          // silently counting toward pending-unresolved again.
          vi.setSystemTime(Date.now() + 60_000)
          return credentialCommandExit1()
        },
      })
      const { result, attempts } = await fixture.run({ maxConsecutiveFailures: 2, maxAttempts: 3 })
      expect(result).toMatchObject({ kind: 'winner', out: { answer: 'retried' } })
      expect(refusals).toBe(10)
      const paused = attempts.slice(0, -1)
      expect(paused).toHaveLength(10)
      for (const attempt of paused) {
        expect(attempt).toMatchObject({
          classification: 'unavailable',
          unavailableSignal: 'credential-unavailable',
          exitCode: 1,
          resumeAt: expect.any(String),
        })
        expect(attempt.stop).toBeUndefined()
        expect(attempt.error).toContain('Tangle credential command failed (exit 1)')
      }
      expect(attempts.at(-1)).toMatchObject({ stop: 'completed', contract: 'met' })
      expect(attempts.some((attempt) => attempt.stop === 'pending-unresolved')).toBe(false)
      const events = await fixture.events()
      // Each pause is on the run's record, as infrastructure time.
      expect(ofKind(events, 'paused').map((pause) => pause.signal)).toEqual(
        Array.from({ length: 10 }, () => 'credential-unavailable'),
      )
      expect(ofKind(events, 'execution-abandoned')).toHaveLength(0)
      expect(fixture.dispatches()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('honors explicit cancellation during failed-capture cleanup while keeping the accepted source', async () => {
    const fixture = await harnessFailureFixture({
      runId: 'harness-retention-cancel-cleanup',
      failures: () => undefined,
      withholdsSubmit: () => true,
      workspaceRetention: 'timeout',
      cancelDuringTeardown: true,
      // The director never submits: a barren streak only pauses it, and the continuation
      // deadline ends the run.
      continuationDeadlineMs: 5_000,
    })
    const { result } = await fixture.run({})
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'cancelled', source: 'signal' })
    // Every turn's capture timed out, so each continued in a new environment and every source,
    // never mutated after its turn, is kept for evidence.
    const sources = [...new Set(fixture.environmentIds)]
    expect(sources).toHaveLength(fixture.dispatches())
    expect(result.teardownUnconfirmed?.[0]?.kept).toEqual(
      sources.map((environmentId) =>
        expect.objectContaining({ environmentId, keptFor: 'evidence' }),
      ),
    )
    const events = await fixture.events()
    expect(ofKind(events, 'execution-result')).toHaveLength(fixture.dispatches())
    expect(ofKind(events, 'execution-abandoned')).toHaveLength(0)
    for (const event of ofKind(events, 'execution-evidence')) {
      expect(await fixture.blobs.get(event.outRef)).toMatchObject({
        workspaceCaptureFailure: expect.stringContaining('timed out after 50ms'),
      })
    }
    expect(fixture.destroys()).toBe(0)
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
    // Reopening the journal sees both processes' attempts, with one per-node ordinal.
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
