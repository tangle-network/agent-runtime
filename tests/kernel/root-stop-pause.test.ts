import { existsSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRunCancellationAcknowledgement } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fullProfileMaterialization } from '../../src/agent/profile-materialization'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { BackendTransportError } from '../../src/errors'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-attempt-evidence'
import {
  cancelRun,
  readRunCancellation,
  runCancelRequestFile,
} from '../../src/runtime/supervise/run-cancellation'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervisorRunDir, writeWorkerSteer } from '../../src/runtime/supervise/run-layout'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Executor,
  SpawnEvent,
  SupervisedResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

/*
 * An opted-in root pauses where it used to stop. Over 259 runs, 8 of the 10 driver stops settled runs that
 * nobody solved or stopped. With `driverRetry.pauseRootStops`, each such stop journals one `paused`
 * row the operator alarms on, and only a solve, a named cancel or a declared deadline settles.
 *
 * Every case runs through `supervise()` with a real run directory and journal; the harness drive
 * is faked at the process boundary, and the clock jumps over each pause once its row is written.
 */

type Paused = Extract<SpawnEvent, { kind: 'paused' }>

const directories: string[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function runDirectory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'root-stop-pause-'))
  directories.push(dir)
  return dir
}

async function callTool(url: string, name: string, args: Record<string, unknown>): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  if (!response.ok) throw new Error(`coordination MCP returned ${response.status}`)
}

/** A journal that hands each `paused` row to the test as soon as it is durable. */
function pacedJournal(dir: string, onPaused: (row: Paused) => void): FileSpawnJournal {
  class PacedJournal extends FileSpawnJournal {
    override async appendEvent(root: string, event: SpawnEvent): Promise<void> {
      await super.appendEvent(root, event)
      if (event.kind === 'paused') onPaused(event)
    }
  }
  return new PacedJournal(join(dir, 'spawn-journal.jsonl'))
}

/** No continuation deadline: only the check, a cancel or a declared budget deadline ends a run. */
function openContinuation() {
  const { deadline: _deadline, ...policy } = testContinuation({ maxBarren: 2 })
  return policy
}

const minutes = (ms: number) => ms / 60_000

/** A leaf that holds its reservation, spending no tokens, until `held` resolves. */
function poolHolder(held: Promise<void>): Agent<unknown, unknown> {
  const executor: Executor<string> = {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      return (async function* () {
        await held
        yield { kind: 'iteration' }
      })()
    },
    teardown: async () => ({ destroyed: true }),
    resultArtifact: () => ({
      outRef: 'mock:pool-holder',
      out: 'released',
      verdict: { score: 0, valid: true },
      spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
    }),
  }
  const executorSpec: AgentSpec = {
    profile: testAgentProfile('pool-holder', { harness: 'cli-base' }),
    harness: null,
    executor: executor as Executor<unknown>,
  }
  return { name: 'pool-holder', act: async () => 'released', executorSpec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

/** These roots never spawn: the drive is the process boundary under test. */
function noWorkers(): never {
  throw new Error('this root does not spawn workers')
}

describe('an opted-in root pauses where it used to stop', () => {
  it('pauses on each stop with a doubling ladder, wakes on a steer, and settles only on a named cancel', async () => {
    const dir = await runDirectory()
    const runId = 'stop-pause'
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const rows: Paused[] = []
    // Each phase is one stop the root pauses on; the journal row of a pause ends the phase.
    let phase = 0
    let steeredAt: number | undefined
    const journal = pacedJournal(dir, (row) => {
      rows.push(row)
      phase += 1
      if (rows.length === 2) {
        // A root steer ends this pause without the clock moving.
        steeredAt = Date.now()
        writeWorkerSteer(dir, runId, runId, { operationId: 'steer-1', message: 'try again now' })
        return
      }
      if (rows.length === 6) {
        // The pool stays spent, so admission pauses again; only the operator settles the run.
        cancelRun(dir, 'stop-1', { operator: 'test-operator', reason: 'test stop' })
        return
      }
      setImmediate(() => vi.advanceTimersByTime(row.pauseMs))
    })
    const drives: Array<{ readonly phase: number; readonly at: number }> = []
    const driveHarness: DriveHarness = async ({ scope }) => {
      drives.push({ phase, at: Date.now() })
      switch (phase) {
        case 0:
          throw new BackendTransportError('bridge', 'HTTP 401 unauthorized', { status: 401 })
        case 1:
          throw Object.assign(new Error('profile files could not be materialized'), {
            code: 'PROFILE_FILES_MATERIALIZE_FAILED',
            status: 422,
          })
        case 2:
          throw Object.assign(
            new Error("mkdir: cannot create directory '/work': Read-only file system"),
            { name: 'PartialFailureError' },
          )
        case 3:
          throw new Error('connect ECONNREFUSED 127.0.0.1:32897')
        case 4:
          await scope.meter({
            iterations: 1,
            tokens: { input: scope.budget.tokensLeft, output: 0 },
            usd: 0,
            ms: 1,
          })
          throw new Error('the turn ended after spending the pool')
        default:
          throw new Error(`no drive is admitted in phase ${phase}`)
      }
    }
    const result = (await supervise(
      testAgentProfile('stop-pause-root', {
        harness: 'codex',
        tools: runtimeToolDeclarations('submit_result'),
      }),
      'Deliver the word done.',
      {
        runDir: dir,
        runId,
        journal,
        steerDir: supervisorRunDir(dir, runId),
        budget: { maxIterations: 100, maxTokens: 10_000 },
        makeWorkerAgent: noWorkers,
        driveHarness,
        driverRetry: {
          pauseRootStops: true,
          initialBackoffMs: 1,
          maxBackoffMs: 1,
          transientOutageMs: 1,
        },
        deliverable: {
          describe: 'The word done.',
          check: (out: unknown) => out === 'done',
          checkState: () => ({ pass: false, composite: 0.5 }),
        },
        continuation: openContinuation(),
      },
    )) as SupervisedResult<unknown>

    expect(
      rows.map((row) => [row.replacesStop, row.signal, row.streak, minutes(row.pauseMs)]),
    ).toEqual([
      ['terminal-error', 'terminal-error', 1, 5],
      ['terminal-error', 'terminal-error', 2, 10],
      ['repeated-failure', 'repeated-failure', 3, 20],
      ['no-progress', 'no-progress', 4, 40],
      ['budget-exhausted', 'budget-exhausted', 5, 60],
      ['budget-exhausted', 'budget-exhausted', 6, 60],
    ])
    for (const row of rows) {
      expect(row.id).toBe(runId)
      expect(Date.parse(row.resumeAt!) - Date.parse(row.at)).toBeLessThanOrEqual(row.pauseMs)
    }
    expect(rows[0]?.cause).toContain('401')
    // Admission had no failure: its row names the stop and took no attempt time.
    expect(rows[5]).toMatchObject({ cause: 'budget-exhausted', attemptMs: 0, madeProgress: false })
    // The steer started the next drive at once: the 10-minute pause was never waited out.
    const afterSteer = drives.find((drive) => drive.phase === 2)
    expect(afterSteer!.at - steeredAt!).toBeLessThan(60_000)
    // Nothing settled until the named cancel.
    expect(result).toMatchObject({
      kind: 'no-winner',
      reason: 'cancelled',
      operationId: 'stop-1',
      operator: 'test-operator',
    })
    expect(result.continuation).toMatchObject({ ended: 'aborted', stopPauses: rows.length })
    expect(readRunCancellation(dir, 'stop-1')?.effect).toBe('cancelled')
  }, 60_000)

  it('ends a budget pause on a steer, pauses again while the pool stays spent, and reads the steer once budget returns', async () => {
    // A worker's reservation and the root's own turn spend the pool, so the root's continuation
    // meets a spent budget. Its release returns the budget, the way a raise reaches a live root's admission.
    const dir = await runDirectory()
    const runId = 'budget-steer'
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    let releaseWorker!: () => void
    const workerHeld = new Promise<void>((resolve) => {
      releaseWorker = resolve
    })
    const rows: Paused[] = []
    class BudgetJournal extends FileSpawnJournal {
      override async appendEvent(root: string, event: SpawnEvent): Promise<void> {
        await super.appendEvent(root, event)
        if (event.kind !== 'paused') return
        rows.push(event)
        if (rows.length === 1) {
          writeWorkerSteer(dir, runId, runId, { operationId: 'steer-budget', message: 'raise it' })
        } else if (rows.length === 2) {
          // The worker ends and returns its reservation; the clock then jumps over the pause.
          releaseWorker()
          setTimeout(() => vi.advanceTimersByTime(event.pauseMs), 200)
        }
      }
    }
    const journal = new BudgetJournal(join(dir, 'spawn-journal.jsonl'))
    const tasks: string[] = []
    const result = (await supervise(
      testAgentProfile('budget-root', {
        harness: 'codex',
        tools: runtimeToolDeclarations('spawn_worker'),
      }),
      'Deliver the word done.',
      {
        runDir: dir,
        runId,
        journal,
        steerDir: supervisorRunDir(dir, runId),
        budget: { maxIterations: 100, maxTokens: 10_000 },
        perWorker: { maxIterations: 10, maxTokens: 9_000 },
        makeWorkerAgent: () => poolHolder(workerHeld),
        teardownConfirmMs: 0,
        driveHarness: async ({ coordinationMcpUrl, scope, task }) => {
          tasks.push(String(task))
          if (tasks.length === 1) {
            await callTool(coordinationMcpUrl, 'spawn_worker', {
              profile: testAgentProfile('pool-holder', { harness: 'cli-base' }),
              task: 'hold the pool',
            })
            // The root's own turn spends what the reservation left.
            await scope.meter({
              iterations: 1,
              tokens: { input: scope.budget.tokensLeft, output: 0 },
              usd: 0,
              ms: 1,
            })
            return
          }
          if (tasks.length === 3)
            cancelRun(dir, 'stop-budget', { operator: 'test-operator', reason: 'steer read' })
        },
        driverRetry: { pauseRootStops: true, initialBackoffMs: 1, maxBackoffMs: 1 },
        deliverable: { describe: 'The word done.', check: (out: unknown) => out === 'done' },
        continuation: openContinuation(),
      },
    )) as SupervisedResult<unknown>

    expect(
      rows.map((row) => [row.replacesStop, row.cause, row.streak, minutes(row.pauseMs)]),
    ).toEqual([
      ['budget-exhausted', 'budget-exhausted', 1, 5],
      ['budget-exhausted', 'budget-exhausted', 2, 10],
    ])
    // The steer ended the first pause without the clock moving; the pool was still spent.
    expect(Date.parse(rows[1]!.at) - Date.parse(rows[0]!.at)).toBeLessThan(60_000)
    // It stayed queued through the second pause: the turn the returned budget admitted is told it
    // waits, and the wake that turn ends in hands it over.
    expect(tasks).toHaveLength(3)
    expect(tasks[1]).toContain('Events waiting for you: 1 (lead-message)')
    expect(tasks[2]).toContain('"type":"lead-message"')
    expect(tasks[2]).toContain('raise it')
    expect(result).toMatchObject({
      kind: 'no-winner',
      reason: 'cancelled',
      operator: 'test-operator',
    })
    expect(result.continuation).toMatchObject({ ended: 'aborted', stopPauses: 2 })
  }, 60_000)

  it('pauses on a pending invocation it cannot resolve and stays open until a cancel', async () => {
    // The `:797` case of supervise-retained-owner-pending.test.ts, opted in: the first turn
    // commits, every replacement stays unresolvable at the provider, and the abandonments run out.
    const dir = await runDirectory()
    const proxy = await coordinationProxy()
    proxies.push(proxy)
    const runDir = join(dir, 'run')
    const context = createFileRunContext(runDir)
    const dispatched: AgentTurnInput[] = []
    const lost = new Set<string>()
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      dispatch: async (turn) => {
        const session = await environment.dispatch!(turn)
        if (!dispatched.some((prior) => prior.executionId === turn.executionId))
          dispatched.push(turn)
        if (dispatched.length >= 2 && turn.executionId) lost.add(turn.executionId)
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
          cancelRun: async (request): Promise<AgentRunCancellationAcknowledgement> => ({
            operationId: request.operationId,
            requestDigest: request.requestDigest,
            run: request.run,
            status: 'accepted',
            effect: 'cancelled',
          }),
        }
      },
    })
    const base = durableRetainedProvider(join(dir, 'provider.json'))
    const provider: AgentEnvironmentProvider = {
      ...base,
      capabilities: async () => ({
        ...(await base.capabilities()),
        create: { runtimeAttachments: { mcp: true } },
      }),
      create: async (input) => wrap(await base.create(input)),
      get: async (id) => {
        const environment = await base.get!(id)
        return environment ? wrap(environment) : null
      },
    }
    const runId = 'stop-pause-pending'
    const rows: Paused[] = []
    const journal = pacedJournal(runDir, (row) => {
      rows.push(row)
      cancelRun(runDir, 'stop-pending', { operator: 'test-operator', reason: 'inspect it' })
    })
    const result = (await supervise(
      testAgentProfile('pending-root', {
        harness: 'codex',
        tools: runtimeToolDeclarations('submit_result'),
      }),
      'Produce the answer.',
      {
        runDir,
        runId,
        journal,
        blobs: context.blobs,
        backend: { backend: 'provider', provider },
        driverBackend: { backend: 'provider', provider },
        budget: { maxIterations: 100, maxTokens: 1000 },
        driverRetry: {
          pauseRootStops: true,
          transientOutageMs: 0,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
          unavailablePauseMs: 1,
          maxUnavailablePauseMs: 1,
        },
        continuation: openContinuation(),
        retainedAtSettlement: 'release',
        teardownConfirmMs: 0,
        deliverable: { describe: 'the answer', check: () => false },
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address) => {
            proxy.forwardTo(address.port)
            return `${proxy.url}/manager`
          },
        },
      },
    )) as SupervisedResult<unknown>
    const events = ((await journal.loadTree(runId)) ?? []).filter((event) => event.id === runId)
    // The real retained-owner path abandoned each replacement before the stop became a pause.
    expect(events.filter((event) => event.kind === 'execution-abandoned').length).toBeGreaterThan(0)
    expect(rows).toEqual([
      expect.objectContaining({
        replacesStop: 'pending-unresolved',
        signal: 'pending-unresolved',
        streak: 1,
        pauseMs: 5 * 60_000,
      }),
    ])
    expect(result).toMatchObject({
      kind: 'no-winner',
      reason: 'cancelled',
      operator: 'test-operator',
    })
    expect(result.continuation).toMatchObject({ ended: 'aborted', stopPauses: 1 })
  }, 60_000)

  it.each([false, true])(
    'retries an AbortError the run did not issue, with no pause row (pauseRootStops=%s)',
    async (pauseRootStops) => {
      const dir = await runDirectory()
      const rows: Paused[] = []
      const attempts: DriverAttemptRecord[] = []
      const journal = pacedJournal(dir, (row) => rows.push(row))
      const startedAt = Date.now()
      const starts: number[] = []
      const result = (await supervise(
        testAgentProfile('lost-stream-root', {
          harness: 'codex',
          tools: runtimeToolDeclarations('submit_result'),
        }),
        'Deliver the word done.',
        {
          runDir: dir,
          runId: 'lost-stream',
          journal,
          budget: { maxIterations: 100, maxTokens: 10_000 },
          makeWorkerAgent: noWorkers,
          driveHarness: async ({ coordinationMcpUrl }) => {
            starts.push(Date.now())
            if (starts.length === 1) {
              throw new DOMException('bridgeExecutor: turn aborted', 'AbortError')
            }
            await callTool(coordinationMcpUrl, 'submit_result', { result: 'done' })
          },
          driverRetry: { pauseRootStops, initialBackoffMs: 1, maxBackoffMs: 1 },
          deliverable: { describe: 'The word done.', check: (out: unknown) => out === 'done' },
          continuation: openContinuation(),
          onDriverAttempt: (record) => void attempts.push(record),
        },
      )) as SupervisedResult<unknown>
      expect(result.kind).toBe('winner')
      expect(attempts[0]).toMatchObject({ classification: 'transient' })
      expect(attempts[0]?.stop).toBeUndefined()
      expect(starts[1]! - startedAt).toBeLessThan(10_000)
      expect(rows).toEqual([])
    },
    30_000,
  )

  it('keeps a nested manager’s stop: it settles down on its first terminal failure', async () => {
    const dir = await runDirectory()
    const rows: Paused[] = []
    const journal = pacedJournal(dir, (row) => rows.push(row))
    const childTools = runtimeToolDeclarations('spawn_worker')
    let rootDrives = 0
    let childDrives = 0
    await supervise(
      testAgentProfile('root', { harness: 'codex', tools: childTools }),
      'Delegate once.',
      {
        runDir: dir,
        runId: 'nested-stop',
        journal,
        backend: {
          backend: 'router',
          routerBaseUrl: 'http://unused.invalid',
          routerKey: 'unused',
          model: 'unused/model',
        },
        budget: { maxIterations: 20, maxTokens: 20_000 },
        perWorker: { maxIterations: 6, maxTokens: 2_000 },
        driveHarness: async ({ authoredProfile, coordinationMcpUrl }) => {
          if (authoredProfile.name === 'child') {
            childDrives += 1
            throw new BackendTransportError('bridge', 'HTTP 401 unauthorized', { status: 401 })
          }
          rootDrives += 1
          if (rootDrives === 1) {
            await callTool(coordinationMcpUrl, 'spawn_worker', {
              profile: testAgentProfile('child', { harness: 'codex', tools: childTools }),
              task: 'fail',
              key: 'nested-child',
            })
          }
        },
        driveHarnessMaterialization: fullProfileMaterialization,
        driverRetry: { pauseRootStops: true, initialBackoffMs: 1 },
      },
    )
    expect(childDrives).toBe(1)
    expect(rows).toEqual([])
    const settled = ((await journal.loadTree('nested-stop')) ?? []).filter(
      (event): event is Extract<SpawnEvent, { kind: 'settled' }> =>
        event.kind === 'settled' && event.id !== 'nested-stop',
    )
    expect(settled).toEqual([expect.objectContaining({ status: 'down' })])
  }, 30_000)

  it('refuses pauseRootStops with enabled: false before any compute', () => {
    expect(() =>
      supervise(testAgentProfile('root', { harness: 'codex' }), 'task', {
        budget: { maxIterations: 1, maxTokens: 10 },
        driveHarness: async () => undefined,
        driverRetry: { pauseRootStops: true, enabled: false },
      }),
    ).toThrow(/pauseRootStops/u)
  })

  it('keeps today’s stop for a root that does not opt in', async () => {
    const dir = await runDirectory()
    const rows: Paused[] = []
    const journal = pacedJournal(dir, (row) => rows.push(row))
    const result = (await supervise(
      testAgentProfile('plain-root', {
        harness: 'codex',
        tools: runtimeToolDeclarations('submit_result'),
      }),
      'Deliver the word done.',
      {
        runDir: dir,
        runId: 'plain-stop',
        journal,
        budget: { maxIterations: 100, maxTokens: 10_000 },
        makeWorkerAgent: noWorkers,
        driveHarness: async () => {
          throw new BackendTransportError('bridge', 'HTTP 401 unauthorized', { status: 401 })
        },
        deliverable: { describe: 'The word done.', check: (out: unknown) => out === 'done' },
        continuation: openContinuation(),
      },
    )) as SupervisedResult<unknown>
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
    expect(result.continuation).toMatchObject({ ended: 'terminal-error', stopPauses: 0 })
    expect(rows).toEqual([])
  }, 30_000)
})

describe('a stop names its operator', () => {
  it('refuses a new cancel request with no operator and writes nothing', async () => {
    const dir = await runDirectory()
    expect(() => cancelRun(dir, 'anonymous', { reason: 'stop' })).toThrow(/operator/u)
    expect(() => cancelRun(dir, 'blank', { operator: '  ' })).toThrow(/operator/u)
    expect(existsSync(runCancelRequestFile(dir))).toBe(false)
  })

  it('replays a request and an acknowledgement written before the operator was required', async () => {
    const dir = await runDirectory()
    await mkdir(join(dir, 'cancellations'), { recursive: true })
    const at = '2026-10-20T00:00:00.000Z'
    writeFileSync(
      runCancelRequestFile(dir),
      JSON.stringify({
        operationId: 'legacy',
        at,
        source: 'discovery-lab/operator',
        reason: 'old',
      }),
    )
    expect(
      cancelRun(dir, 'legacy', { source: 'discovery-lab/operator', reason: 'old' }),
    ).toMatchObject({ operationId: 'legacy', effect: 'unknown' })
    const acknowledgement = {
      operationId: 'legacy',
      effect: 'cancelled' as const,
      requestedAt: at,
      observedAt: at,
      reason: 'old',
    }
    writeFileSync(join(dir, 'cancellations', 'run.json'), JSON.stringify(acknowledgement))
    expect(cancelRun(dir, 'legacy', { source: 'discovery-lab/operator', reason: 'old' })).toEqual(
      acknowledgement,
    )
  })
})
