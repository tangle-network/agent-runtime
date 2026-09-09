import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRuntimeSupervisorRun } from '@tangle-network/agent-eval/supervisor-run'
import { canonicalCandidateJson, sha256Bytes } from '@tangle-network/agent-interface'
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
import { SupervisePursuitError, supervisePursuit } from '../../src/durable/supervise-pursuit'
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
  UsageEvent,
} from '../../src/runtime/supervise/types'
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
