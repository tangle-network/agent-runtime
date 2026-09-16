import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRuntimeSupervisorRun } from '@tangle-network/agent-eval/supervisor-run'
import { canonicalCandidateJson, sha256Bytes } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileObserverJournal } from '../../src/durable/observer-journal'
import { projectPursuit } from '../../src/durable/observer-projection'
import {
  acquireRunDirectoryLock,
  RUN_DIRECTORY_LOCK_FILE,
  RunDirectoryLockedError,
} from '../../src/durable/run-lock'
import {
  FAILURE_RECORD_FILE,
  readFailureRecord,
  readSettleRecord,
  SETTLE_RECORD_FILE,
  SettledRunDirectoryError,
  settleRecordDigest,
  settleRecordJson,
} from '../../src/durable/settle-record'
import { closesCursorSlot, FileSpawnJournal } from '../../src/durable/spawn-journal'
import { SupervisePursuitError, supervisePursuit } from '../../src/durable/supervise-pursuit'
import { providerAsExecutor } from '../../src/runtime/environment-provider'
import { cancelRun, readRunCancellation } from '../../src/runtime/supervise/run-layout'
import type {
  DriveHarness,
  DriveHarnessOwnerContext,
} from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  SpawnJournal,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }
const perWorker: Budget = { maxIterations: 4, maxTokens: 1_000 }

it.each([true, false])(
  'records durable cancellation after director return with teardown confirmed=%s',
  async (destroyed) => {
    const dir = await mkdtemp(join(tmpdir(), 'cancel-after-director-'))
    const cleanup = new AbortController()
    let started!: () => void
    let finalized!: () => void
    const directorFinalized = new Promise<void>((resolve) => {
      finalized = resolve
    })
    const childStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let aborted = false
    const pending = run(dir, 'cancel-after-director', {
      signal: cleanup.signal,
      childSettleGraceMs: 5_000,
      finalizer: async () => {
        finalized()
        return undefined
      },
      makeWorkerAgent: () =>
        deliveringLeaf(
          'waiting-child',
          async (signal) => {
            started()
            await new Promise<void>((resolve) => {
              const stop = () => {
                aborted = true
                resolve()
              }
              if (signal.aborted) stop()
              else signal.addEventListener('abort', stop, { once: true })
            })
          },
          destroyed,
        ),
      driveHarness: async ({ coordinationMcpUrl }: Parameters<DriveHarness>[0]) => {
        await jsonRpc(coordinationMcpUrl, 'tools/call', {
          name: 'spawn_worker',
          arguments: { profile: testAgentProfile('worker'), task: 'wait', label: 'worker' },
        })
      },
    })
    try {
      await childStarted
      await directorFinalized
      await new Promise<void>((resolve) => setImmediate(resolve))
      cancelRun(dir, 'cancel-drain', { reason: 'operator', source: 'test' })
      await expect.poll(() => aborted, { timeout: 2_000 }).toBe(true)
      const settled = await pending
      expect(aborted).toBe(true)
      const cancellation = readRunCancellation(dir, 'cancel-drain')
      expect(cancellation?.effect).toBe(destroyed ? 'cancelled' : 'unknown')
      if (!destroyed) {
        expect(settled.result.teardownUnconfirmed).toHaveLength(1)
        expect(cancellation?.detail).toContain(settled.result.teardownUnconfirmed?.[0]?.id)
        expect(settled.result.tree.nodes).toHaveLength(1)
      }
    } finally {
      cleanup.abort()
      await pending
      await rm(dir, { recursive: true, force: true })
    }
  },
)

it('fences a nested driver retry when durable cancellation races a backend failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cancel-nested-retry-'))
  let attempts = 0
  try {
    const result = await run(dir, 'cancel-nested-retry', {
      driveHarness: undefined,
      makeWorkerAgent: undefined,
      backend: {
        backend: 'router',
        routerBaseUrl: 'http://unused.invalid',
        routerKey: 'unused',
        model: 'unused/model',
      },
      driverRetry: { initialBackoffMs: 0, maxBackoffMs: 0 },
      childSettleGraceMs: 5_000,
      resolveDriveHarness: (context: DriveHarnessOwnerContext): DriveHarness => {
        if (context.depth === 0)
          return async ({ coordinationMcpUrl }) => {
            await jsonRpc(coordinationMcpUrl, 'tools/call', {
              name: 'spawn_worker',
              arguments: {
                profile: testAgentProfile('manager', { tools: runtimeToolDeclarations('stop') }),
                task: 'work',
                label: 'manager',
              },
            })
          }
        return async () => {
          attempts += 1
          cancelRun(dir, 'retry-race', { reason: 'operator', source: 'test' })
          throw new Error('bridge execution cancelled')
        }
      },
    })
    expect(attempts, JSON.stringify(result.result)).toBe(1)
    expect(result.result.kind).toBe('no-winner')
    expect(readRunCancellation(dir, 'retry-race')?.effect).toBe('cancelled')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function deliveringLeaf(
  name: string,
  beforeExecute?: (signal: AbortSignal) => Promise<void>,
  destroyed = true,
): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'record-test-worker',
    execute(_task, signal) {
      return (async function* () {
        await beforeExecute?.(signal)
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield { kind: 'cost', usd: 0, usdKnown: true, provenance: 'provider-receipt' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `record:${name}`,
      out: { worker: name },
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => ({ worker: name }), executorSpec: spec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

async function jsonRpc(url: string, method: string, params: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) throw new Error(`coordination MCP returned ${response.status}`)
  const body = await response.json()
  if (body.error || body.result?.isError) throw new Error(JSON.stringify(body))
}

const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
  await jsonRpc(coordinationMcpUrl, 'tools/call', {
    name: 'spawn_worker',
    arguments: { profile: testAgentProfile('worker'), task: 'deliver', label: 'worker' },
  })
  await jsonRpc(coordinationMcpUrl, 'tools/call', {
    name: 'await_event',
    arguments: { kinds: ['settled'] },
  })
  await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
}

function run(runDir: string, runId: string, overrides: Record<string, unknown> = {}) {
  return supervisePursuit(
    testAgentProfile('record-root', {
      prompt: { systemPrompt: 'Delegate once, wait, then stop.' },
      tools: runtimeToolDeclarations('spawn_worker', 'await_event', 'stop'),
    }),
    'record one settled run',
    {
      pursuitId: 'pursuit:record',
      runId,
      runDir,
      budget,
      perWorker,
      driveHarness,
      makeWorkerAgent: () => deliveringLeaf('worker'),
      ...overrides,
    },
  )
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

describe('supervisePursuit durable terminal records', () => {
  let runDir: string
  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'pursuit-record-'))
  })
  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true })
  })

  it('writes result.json as the canonical bytes of the returned result and releases the lock', async () => {
    const runId = 'run:record:settle'
    const executed = await run(runDir, runId)

    expect(executed.result.kind).toBe('winner')
    expect(executed.settlePath).toBe(join(runDir, SETTLE_RECORD_FILE))
    const bytes = await readFile(executed.settlePath, 'utf8')
    expect(bytes).toBe(settleRecordJson(executed.result))
    expect(bytes).toBe(canonicalCandidateJson(JSON.parse(JSON.stringify(executed.result))))
    // Canonical bytes make the file's digest the result's candidate digest.
    expect(sha256Bytes(new TextEncoder().encode(bytes))).toBe(settleRecordDigest(executed.result))

    // Eval's reader needs `kind` and `tree.root`, and the root must be the journal root.
    const record = JSON.parse(bytes) as { kind: string; tree: { root: string } }
    expect(record.kind).toBe('winner')
    expect(record.tree.root).toBe(runId)
    expect(await readSettleRecord(runDir)).toEqual(record)
    const sources = await readRuntimeSupervisorRun(runDir)
    expect(sources.result).toBe(bytes)

    expect(await exists(join(runDir, FAILURE_RECORD_FILE))).toBe(false)
    expect(await exists(join(runDir, RUN_DIRECTORY_LOCK_FILE))).toBe(false)
    expect(executed.pursuit.runs).toEqual([
      expect.objectContaining({ runId, attemptIndex: 0, resumeCount: 0, status: 'done' }),
    ])
  })

  it('releases the environment a retained child holds before recording the settle', async () => {
    // The Discovery Lab path the leak was measured on (2026-09-11): a pursuit whose child failed with
    // its retained execution unreconciled settled `no-winner`, recorded result.json, and kept the
    // child's sandbox running for 19 to 37 hours, because the settle record refuses the resume
    // that would have reconciled or released it. 18 of a 60-slot fleet were held that way.
    const stateFile = join(runDir, 'provider.json')
    const provider = (): AgentEnvironmentProvider => {
      const base = durableRetainedProvider(stateFile)
      // The retained execution is admitted and dispatched durably; its result read is lost.
      const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
        ...environment,
        session: (id, options) => ({
          ...environment.session!(id, options),
          result: async () => {
            throw new Error('provider result read lost')
          },
        }),
      })
      return {
        ...base,
        create: async (input) => wrap(await base.create(input)),
        get: async (id) => {
          const environment = await base.get!(id)
          return environment ? wrap(environment) : null
        },
      }
    }
    const held = (): string[] =>
      existsSync(stateFile)
        ? Object.keys(
            (JSON.parse(readFileSync(stateFile, 'utf8')) as { environments: object }).environments,
          )
        : []
    const retainedWorker = (): Agent<unknown, unknown> =>
      Object.assign(
        { name: 'retained-worker', act: async () => 'unused' },
        {
          executorSpec: {
            profile: testAgentProfile('retained-worker'),
            harness: null,
            executorFactory: providerAsExecutor(provider()),
          },
        },
      )

    const settled = await run(runDir, 'retained-release', { makeWorkerAgent: retainedWorker })

    expect(held()).toEqual([])
    expect(settled.result.teardownUnconfirmed).toBeUndefined()
    const events =
      (await new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl')).loadTree(
        'retained-release',
      )) ?? []
    const admitted = events.flatMap((event) =>
      event.kind === 'execution-admitted' && event.admission.phase === 'environment'
        ? [{ id: event.id, environmentId: event.admission.environmentId }]
        : [],
    )
    expect(admitted).toHaveLength(1)
    // One receipt, naming the node and the provider's own environment id.
    expect(events.filter((event) => event.kind === 'environment-teardown')).toMatchObject([
      {
        id: admitted[0]?.id,
        provider: 'durable-test',
        environmentId: admitted[0]?.environmentId,
        destroyed: true,
      },
    ])
    expect(events.some((event) => event.kind === 'teardown-unconfirmed')).toBe(false)
    // The release closed the slot: one terminal record after the receipt, marked released.
    const terminal = events.filter(
      (event) => event.id === admitted[0]?.id && closesCursorSlot(event),
    )
    expect(terminal).toMatchObject([
      { kind: 'settled', status: 'down', retainedExecution: 'released' },
    ])
    expect(events.indexOf(terminal[0]!)).toBeGreaterThan(
      events.findIndex((event) => event.kind === 'environment-teardown'),
    )
    // The settle record still lands, so the run stays final — and it carries the yield, the
    // released marker on the tree, and the gap as a floor rather than a ceiling.
    const result = await readSettleRecord(runDir)
    expect(result).toBeDefined()
    if (result === undefined) return
    expect(result.fleetYield).toMatchObject({ releasedUnrecovered: 1, neverSettled: 0 })
    expect(result.tree.nodes.find((node) => node.id === admitted[0]?.id)).toMatchObject({
      retainedExecution: 'released',
    })
    expect(result.spendGaps).toEqual([
      expect.objectContaining({ id: admitted[0]?.id, kind: 'unreported' }),
    ])
    expect(result.spendGaps?.some((gap) => gap.kind === 'never-settled')).toBe(false)
    // The operator's projection says the same thing off the observer journal.
    const projected = projectPursuit(
      await new FileObserverJournal(settled.observerPath, 'pursuit:record').read(),
    )
    expect(projected.nodes.find((node) => node.id === admitted[0]?.id)).toMatchObject({
      status: 'down',
      retainedExecution: 'released',
      releasedAt: expect.any(Number),
    })
  })

  it("refuses retainedAtSettlement 'keep', which a settle record would contradict", async () => {
    await expect(run(runDir, 'keep-refused', { retainedAtSettlement: 'keep' })).rejects.toThrow(
      /retainedAtSettlement 'keep' cannot hold/,
    )
    expect(await exists(join(runDir, SETTLE_RECORD_FILE))).toBe(false)
  })

  it('refuses to re-enter a directory that holds a settle record, before touching the journal', async () => {
    const runId = 'run:record:reentry'
    const executed = await run(runDir, runId)
    const journalBefore = await readFile(executed.observerPath, 'utf8')

    const sameRun = await run(runDir, runId).catch((error) => error)
    expect(sameRun).toBeInstanceOf(SettledRunDirectoryError)
    expect((sameRun as Error).message).toContain(executed.settlePath)
    expect((sameRun as Error).message).toContain(runId)

    const otherRun = await run(runDir, 'run:record:other').catch((error) => error)
    expect(otherRun).toBeInstanceOf(SettledRunDirectoryError)
    expect((otherRun as Error).message).toContain('needs its own runDir')

    expect(await readFile(executed.observerPath, 'utf8')).toBe(journalBefore)
    expect(await readFile(executed.settlePath, 'utf8')).toBe(settleRecordJson(executed.result))
    expect(await exists(join(runDir, RUN_DIRECTORY_LOCK_FILE))).toBe(false)
  })

  it('records a throw in failure.json, lets a corrected call re-enter, and keeps the attempts apart', async () => {
    const runId = 'run:record:retry'
    // r1's first attempt: the budget refused before any spawn, then the corrected input resumed.
    const failed = await run(runDir, runId, {
      budget: { ...budget, deadlineMs: Number.NaN },
    }).catch((error) => error)
    expect(failed).toBeInstanceOf(SupervisePursuitError)
    expect((failed as SupervisePursuitError).failurePath).toBe(join(runDir, FAILURE_RECORD_FILE))
    const failure = await readFailureRecord(runDir)
    expect(failure).toMatchObject({
      runId,
      pursuitId: 'pursuit:record',
      error: { name: 'Error', message: expect.stringMatching(/deadlineMs/) },
    })
    expect(Number.isFinite(Date.parse(failure?.at ?? ''))).toBe(true)
    expect(await exists(join(runDir, SETTLE_RECORD_FILE))).toBe(false)
    expect(await exists(join(runDir, RUN_DIRECTORY_LOCK_FILE))).toBe(false)
    expect((failed as SupervisePursuitError).pursuit.runs).toEqual([
      expect.objectContaining({ runId, attemptIndex: 0, status: 'down' }),
    ])

    const executed = await run(runDir, runId)
    expect(executed.result.kind).toBe('winner')
    expect(await readFile(executed.settlePath, 'utf8')).toBe(settleRecordJson(executed.result))
    // The failure record stays as history; the settle record is the terminal state.
    expect(await readFailureRecord(runDir)).toEqual(failure)

    const replayed = projectPursuit(
      await new FileObserverJournal(executed.observerPath, 'pursuit:record').read(),
    )
    expect(replayed).toEqual(executed.pursuit)
    expect(
      replayed.runs.map((row) => [row.attemptIndex, row.status, row.error !== undefined]),
    ).toEqual([
      [0, 'down', true],
      [1, 'done', false],
    ])
    expect(replayed.runs[0]?.error).toMatch(/deadlineMs/)
  })

  it('refuses a call while another process holds the directory, naming the holder', async () => {
    const held = await acquireRunDirectoryLock(runDir, 'run:record:holder')
    try {
      const refused = await run(runDir, 'run:record:second').catch((error) => error)
      expect(refused).toBeInstanceOf(RunDirectoryLockedError)
      expect((refused as RunDirectoryLockedError).holder).toMatchObject({
        pid: process.pid,
        runId: 'run:record:holder',
      })
      expect(await exists(join(runDir, 'observer.jsonl'))).toBe(false)
      expect(await exists(join(runDir, FAILURE_RECORD_FILE))).toBe(false)
    } finally {
      await held.release()
    }

    const executed = await run(runDir, 'run:record:second')
    expect(executed.result.kind).toBe('winner')
  })
})

/**
 * agent-runtime#1233: the ROOT's provider stream is retained nowhere Runtime owns. A child's
 * full event stream lives in its `outRef` blob (28k to 76k reasoning characters per child on
 * real runs); the root's is discarded at the drain loop, so a root that dies leaves a 600-byte
 * failure.json and nothing it thought. These tests drive a provider-placed root whose fake
 * environment emits reasoning, text, and tool parts, and hold three things: the lines are on
 * disk WHILE the turn is still streaming, result.json references the stream after settlement,
 * and failure.json references the partial stream when the run throws after the root streamed.
 */
describe('supervisePursuit root stream', () => {
  let runDir: string
  const streamPath = () => join(runDir, 'root-stream.jsonl')
  const rootParts: AgentEnvironmentEvent[] = [
    {
      id: 'root-reasoning',
      type: 'message.part.updated',
      data: { part: { type: 'reasoning', text: 'the root thinks' }, delta: 'the root thinks' },
    },
    {
      id: 'root-text',
      type: 'message.part.updated',
      data: { part: { type: 'text', text: 'the root says' }, delta: 'the root says' },
    },
    {
      id: 'root-tool',
      type: 'message.part.updated',
      data: {
        part: {
          type: 'tool',
          tool: 'read',
          callID: 'call-1',
          state: { status: 'completed', input: { path: 'notes.md' }, output: 'notes' },
        },
      },
    },
  ]
  /** The progress events those three parts project to, in the order the root streamed them. */
  const rootProgress = [
    { kind: 'reasoning_delta', text: 'the root thinks' },
    { kind: 'text_delta', text: 'the root says' },
    { kind: 'tool_call', toolName: 'read', toolCallId: 'call-1', args: { path: 'notes.md' } },
    { kind: 'tool_result', toolName: 'read', toolCallId: 'call-1', result: 'notes' },
  ]

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'pursuit-root-stream-'))
  })
  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true })
  })

  const readStreamLines = async () =>
    (await readFile(streamPath(), 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
      .map(
        (line) =>
          JSON.parse(line) as { seq: number; at: string; attempt: number; event: { kind: string } },
      )

  /**
   * The durable test provider, advertising the coordination attachment a provider-placed root
   * needs, with the root's session prepending the three parts to its retained events. After the
   * parts are handed to Runtime, the session reads the run directory before yielding anything
   * else, so `seenDuringTurn` is what was on disk while the turn was still open.
   */
  function rootProvider(seen: { duringTurn?: number }): AgentEnvironmentProvider {
    const base = durableRetainedProvider(join(runDir, 'provider.json'))
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      session: (id, options) => {
        const session = environment.session!(id, options)
        return {
          ...session,
          async *events(eventOptions) {
            for (const part of rootParts) yield structuredClone(part)
            seen.duringTurn = existsSync(streamPath())
              ? readFileSync(streamPath(), 'utf8')
                  .split('\n')
                  .filter((line) => line.length > 0).length
              : 0
            yield* session.events(eventOptions)
          },
        }
      },
    })
    return {
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
  }

  function providerRootRun(runId: string, overrides: Record<string, unknown> = {}) {
    return supervisePursuit(
      testAgentProfile('stream-root', {
        harness: 'codex',
        tools: runtimeToolDeclarations('stop'),
      }),
      'Think, say, read, then finish.',
      {
        pursuitId: 'pursuit:root-stream',
        runId,
        runDir,
        budget: { maxIterations: 8, maxTokens: 100_000 },
        perWorker: { maxIterations: 1, maxTokens: 10 },
        driverRetry: { enabled: false },
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address: { port: number }) => `http://127.0.0.1:${address.port}/manager`,
        },
        ...overrides,
      },
    )
  }

  it('journals the root stream as it arrives and references it from result.json apart from outRef', async () => {
    const seen: { duringTurn?: number } = {}
    const executed = await providerRootRun('root-stream-settle', {
      backend: { backend: 'provider', provider: rootProvider(seen) },
    })

    // Every part the root had streamed was on disk BEFORE the turn continued: a root killed at
    // that instant keeps what it thought, said, and called.
    expect(seen.duringTurn).toBe(rootProgress.length)

    const lines = await readStreamLines()
    expect(lines.slice(0, rootProgress.length).map((line) => line.event)).toEqual(rootProgress)
    // The retained provider's own interaction request rides the same stream after the parts.
    expect(lines.map((line) => line.event.kind)).toEqual([
      'reasoning_delta',
      'text_delta',
      'tool_call',
      'tool_result',
      'interaction',
    ])
    expect(lines.map((line) => line.seq)).toEqual([1, 2, 3, 4, 5])
    expect(lines.every((line) => line.attempt === 1)).toBe(true)

    const bytes = await readFile(streamPath())
    const receipt = { ref: sha256Bytes(bytes), events: lines.length }
    expect(executed.result.rootStream).toEqual(receipt)
    const record = JSON.parse(await readFile(executed.settlePath, 'utf8')) as {
      rootStream?: unknown
      outRef?: unknown
    }
    expect(record.rootStream).toEqual(receipt)
    // No child delivered, so there is no winner outRef; the root stream never stands in for one.
    expect(executed.result.kind).toBe('no-winner')
    expect(record.outRef).toBeUndefined()
    // Eval's supervisor-run reader consumes the settle record with the additive key unchanged.
    const sources = await readRuntimeSupervisorRun(runDir)
    expect(sources.result).toBe(await readFile(executed.settlePath, 'utf8'))
  })

  it('references the partial root stream from failure.json when the run throws after the root streamed', async () => {
    const seen: { duringTurn?: number } = {}
    // The root drives to completion, then the settlement's journal read fails: the shape of a
    // root that ran and whose run died at its barrier (fourier-e, 2026-09-14: 63 children, a
    // 607-byte failure.json, and nothing of the root).
    let armed = false
    const journalPath = join(runDir, 'spawn-journal.jsonl')
    const file = new FileSpawnJournal(journalPath)
    const journal: SpawnJournal = {
      beginTree: file.beginTree.bind(file),
      appendEvent: file.appendEvent.bind(file),
      loadTree: async (root) => {
        if (armed) throw new Error('spawn journal unreadable at settlement')
        return file.loadTree(root)
      },
    }
    const failed = await providerRootRun('root-stream-failure', {
      backend: { backend: 'provider', provider: rootProvider(seen) },
      journal,
      finalizer: () => {
        armed = true
        return undefined
      },
    }).catch((error) => error)
    expect(failed).toBeInstanceOf(SupervisePursuitError)
    expect((failed as Error).message).toMatch(/spawn journal unreadable/)

    expect(seen.duringTurn).toBe(rootProgress.length)
    const lines = await readStreamLines()
    expect(lines.slice(0, rootProgress.length).map((line) => line.event)).toEqual(rootProgress)
    const bytes = await readFile(streamPath())
    const failure = (await readFailureRecord(runDir)) as
      | { rootStream?: { ref: string; events: number } }
      | undefined
    expect(failure?.rootStream).toEqual({ ref: sha256Bytes(bytes), events: lines.length })
    expect(await exists(join(runDir, SETTLE_RECORD_FILE))).toBe(false)
  })
})
