import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/errors'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import {
  isPreSpawnExecutorFailure,
  resolveWorkerSpawnRetry,
  type WorkerSpawnRetryAttempt,
  withWorkerSpawnRetry,
} from '../../src/runtime/supervise/worker-retry'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

/**
 * The exact message the bridge records when a worker spawn queues past the host executor's single
 * acquire deadline. Measured 2026-08-22 on discovery-lab cells oscnp s2/s3; nothing had started
 * when it was emitted.
 */
const ACQUIRE_TIMEOUT =
  'bridgeExecutor: bridge stream error: host-executor: acquire timeout after 60000ms ' +
  '(in_flight=4/4, queued=1)'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }

function workerProfile(name = 'worker'): AgentProfile {
  return testAgentProfile(name)
}

/**
 * A clock that advances by exactly what the seam slept. No test waits in real time, and the total
 * ceiling is still measured against elapsed time rather than against one backoff.
 */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let clock = 0
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms
    },
  }
}

/**
 * A leaf whose executor fails `failures` times with `reason` and then streams a delivery. Every
 * attempt runs on the SAME executor object, which is what the retry seam requires: the kernel
 * attests materialization per executor object, so a re-entry must not rebuild one.
 */
function flakyLeaf(input: {
  name: string
  failures: number
  reason: string
  /** Yield one usage event BEFORE failing — the proof that the attempt may have metered. */
  yieldFirst?: boolean
}): { agent: Agent<unknown, unknown>; attempts: () => number } {
  let attempts = 0
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute() {
      attempts += 1
      const failing = attempts <= input.failures
      const yieldFirst = input.yieldFirst === true
      return (async function* () {
        if (failing) {
          if (yieldFirst) yield { kind: 'iteration' } as UsageEvent
          throw new Error(input.reason)
        }
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield { kind: 'cost', usd: 0, usdKnown: true, provenance: 'provider-receipt' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${input.name}`,
      out: `${input.name} delivered`,
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = {
    profile: workerProfile(input.name),
    harness: null,
    executorFactory: () => executor,
  }
  return {
    agent: { name: input.name, act: async () => '', executorSpec: spec } as Agent<unknown, unknown>,
    attempts: () => attempts,
  }
}

async function drain(executor: Executor<unknown>): Promise<number> {
  const result = executor.execute('go', new AbortController().signal)
  if (!(Symbol.asyncIterator in Object(result))) throw new Error('expected a streaming executor')
  let events = 0
  for await (const _event of result as AsyncIterable<UsageEvent>) events += 1
  return events
}

describe('isPreSpawnExecutorFailure', () => {
  it('reads the three admission deadlines as pre-spawn and nothing else', () => {
    expect(isPreSpawnExecutorFailure(new Error(ACQUIRE_TIMEOUT))).toBe(true)
    expect(
      isPreSpawnExecutorFailure(new Error('scoped-host-executor: acquire timeout after 60000ms')),
    ).toBe(true)
    expect(
      isPreSpawnExecutorFailure(new Error('container-pool: acquire timeout after 30000ms')),
    ).toBe(true)
  })

  it('refuses every failure that could have followed a metered call', () => {
    // The broad "is this an infrastructure hiccup" question answers true for all of these. This
    // predicate answers "did this fail BEFORE any provider call", which is the question a retry
    // that must not double-spend has to ask.
    for (const message of [
      'ECONNRESET',
      'fetch failed',
      '429 Too Many Requests',
      'bridgeExecutor: bridge stream error: 503 upstream unavailable',
      'This operation was aborted',
      'host-executor: queue is long',
    ]) {
      expect(isPreSpawnExecutorFailure(new Error(message))).toBe(false)
    }
  })

  it('accepts a consumer pre-spawn signature only when the consumer names it', () => {
    const seatFailure = new Error('sandbox-seat: transient box creation failure')
    expect(isPreSpawnExecutorFailure(seatFailure)).toBe(false)
    expect(
      isPreSpawnExecutorFailure(seatFailure, [/^sandbox-seat: transient box creation failure/u]),
    ).toBe(true)
  })
})

describe('resolveWorkerSpawnRetry', () => {
  it('is off when absent or disabled, and refuses a bound a run cannot act on', () => {
    expect(resolveWorkerSpawnRetry(undefined)).toBeUndefined()
    expect(resolveWorkerSpawnRetry({ enabled: false })).toBeUndefined()
    expect(resolveWorkerSpawnRetry({})).toMatchObject({
      maxTotalMs: 900_000,
      initialBackoffMs: 5_000,
      maxBackoffMs: 60_000,
    })
    expect(() => resolveWorkerSpawnRetry({ maxTotalMs: -1 })).toThrow(ValidationError)
    expect(() => resolveWorkerSpawnRetry({ initialBackoffMs: Number.NaN })).toThrow(
      /nonnegative finite number/,
    )
    expect(() =>
      resolveWorkerSpawnRetry({ additionalPreSpawnSignatures: ['nope' as never] }),
    ).toThrow(/must contain RegExp values/)
    // The ceiling can never sit below the first wait: a policy that says otherwise would retry once
    // and then stop on arithmetic rather than on its stated bound.
    expect(resolveWorkerSpawnRetry({ initialBackoffMs: 9_000, maxBackoffMs: 1_000 })).toMatchObject(
      { maxBackoffMs: 9_000 },
    )
  })
})

describe('withWorkerSpawnRetry', () => {
  it('re-enters a spawn the executor refused before it ran', async () => {
    const retries: WorkerSpawnRetryAttempt[] = []
    const leaf = flakyLeaf({ name: 'w1', failures: 2, reason: ACQUIRE_TIMEOUT })
    const make = withWorkerSpawnRetry(
      () => leaf.agent,
      {},
      { ...fakeClock(), onRetry: (a) => retries.push(a) },
    )
    const agent = make(workerProfile('w1'), undefined)
    const spec = (agent as { executorSpec: AgentSpec }).executorSpec
    const executor = spec.executorFactory?.(spec, {
      signal: new AbortController().signal,
      seams: {},
    })
    if (!executor) throw new Error('expected a wrapped executor factory')

    expect(await drain(executor)).toBe(3)
    expect(leaf.attempts()).toBe(3)
    expect(retries.map((attempt) => attempt.attempt)).toEqual([1, 2])
    expect(retries.map((attempt) => attempt.waitMs)).toEqual([5_000, 10_000])
    expect(retries[0]?.worker).toBe('w1')
    expect(retries[0]?.error).toContain('acquire timeout')
  })

  it('stays fatal when the attempt yielded an event, because that attempt may have metered', async () => {
    const leaf = flakyLeaf({ name: 'w1', failures: 1, reason: ACQUIRE_TIMEOUT, yieldFirst: true })
    const make = withWorkerSpawnRetry(() => leaf.agent, {}, fakeClock())
    const agent = make(workerProfile('w1'), undefined)
    const spec = (agent as { executorSpec: AgentSpec }).executorSpec
    const executor = spec.executorFactory?.(spec, {
      signal: new AbortController().signal,
      seams: {},
    })
    if (!executor) throw new Error('expected a wrapped executor factory')
    await expect(drain(executor)).rejects.toThrow(/acquire timeout/)
    expect(leaf.attempts()).toBe(1)
  })

  it('stays fatal for a transport failure that carries no pre-spawn signature', async () => {
    const leaf = flakyLeaf({ name: 'w1', failures: 1, reason: 'ECONNRESET' })
    const make = withWorkerSpawnRetry(() => leaf.agent, {}, fakeClock())
    const agent = make(workerProfile('w1'), undefined)
    const spec = (agent as { executorSpec: AgentSpec }).executorSpec
    const executor = spec.executorFactory?.(spec, {
      signal: new AbortController().signal,
      seams: {},
    })
    if (!executor) throw new Error('expected a wrapped executor factory')
    await expect(drain(executor)).rejects.toThrow('ECONNRESET')
    expect(leaf.attempts()).toBe(1)
  })

  it('stops when the next wait would cross the total ceiling', async () => {
    const leaf = flakyLeaf({ name: 'w1', failures: 10, reason: ACQUIRE_TIMEOUT })
    const retries: WorkerSpawnRetryAttempt[] = []
    const make = withWorkerSpawnRetry(
      () => leaf.agent,
      { maxTotalMs: 12_000, initialBackoffMs: 5_000 },
      { ...fakeClock(), onRetry: (attempt) => retries.push(attempt) },
    )
    const agent = make(workerProfile('w1'), undefined)
    const spec = (agent as { executorSpec: AgentSpec }).executorSpec
    const executor = spec.executorFactory?.(spec, {
      signal: new AbortController().signal,
      seams: {},
    })
    if (!executor) throw new Error('expected a wrapped executor factory')
    // 5s then 10s: the second wait would reach 15s, past the 12s ceiling, so the run stops there.
    await expect(drain(executor)).rejects.toThrow(/acquire timeout/)
    expect(retries.map((attempt) => attempt.waitMs)).toEqual([5_000])
    expect(leaf.attempts()).toBe(2)
  })

  it('passes an unwrapped agent through when the policy is off', () => {
    const leaf = flakyLeaf({ name: 'w1', failures: 0, reason: ACQUIRE_TIMEOUT })
    const make = withWorkerSpawnRetry(() => leaf.agent, { enabled: false })
    expect(make(workerProfile('w1'), undefined)).toBe(leaf.agent)
  })
})

describe('supervise({ workerRetry })', () => {
  it('rescues a backend-derived worker whose spawn a saturated executor refused', async () => {
    const leaf = flakyLeaf({ name: 'w1', failures: 1, reason: ACQUIRE_TIMEOUT })
    const retries: WorkerSpawnRetryAttempt[] = []
    const result = await supervise(
      testAgentProfile('root', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
      }),
      'delegate one unit',
      {
        budget,
        makeLeafAgent: () => leaf.agent,
        workerRetry: { initialBackoffMs: 0, maxBackoffMs: 0 },
        onWorkerRetry: (attempt) => retries.push(attempt),
        brain: scriptedBrain([
          {
            toolCalls: [
              { name: 'spawn_worker', arguments: { profile: workerProfile('w1'), task: 'go' } },
            ],
          },
          { toolCalls: [{ name: 'await_event', arguments: {} }] },
          { content: 'done' },
        ]),
      },
    )
    expect(result.kind).toBe('winner')
    expect(leaf.attempts()).toBe(2)
    expect(retries).toHaveLength(1)
    expect(retries[0]?.worker).toBe('w1')
  })

  it('loses the same worker when no retry policy is declared', async () => {
    const leaf = flakyLeaf({ name: 'w1', failures: 1, reason: ACQUIRE_TIMEOUT })
    const result = await supervise(
      testAgentProfile('root', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
      }),
      'delegate one unit',
      {
        budget,
        makeLeafAgent: () => leaf.agent,
        brain: scriptedBrain([
          {
            toolCalls: [
              { name: 'spawn_worker', arguments: { profile: workerProfile('w1'), task: 'go' } },
            ],
          },
          { toolCalls: [{ name: 'await_event', arguments: {} }] },
          { content: 'done' },
        ]),
      },
    )
    expect(result.kind).not.toBe('winner')
    expect(leaf.attempts()).toBe(1)
  })

  it('refuses workerRetry beside a caller-owned makeWorkerAgent instead of doing nothing', () => {
    // The seam wraps the backend-derived path. A caller that replaced that path with its own
    // factory would otherwise get a run with no retry and no complaint.
    expect(() =>
      supervise(testAgentProfile('root', { harness: 'cli-base' }), 't', {
        budget,
        makeWorkerAgent: () => flakyLeaf({ name: 'w1', failures: 0, reason: '' }).agent,
        workerRetry: {},
        brain: scriptedBrain([{ content: 'done' }]),
      }),
    ).toThrow(/workerRetry applies only to backend-derived workers/)
  })

  it('refuses a workerRetry bound a run cannot act on, before any compute', () => {
    expect(() =>
      supervise(testAgentProfile('root', { harness: 'cli-base' }), 't', {
        budget,
        makeLeafAgent: () => flakyLeaf({ name: 'w1', failures: 0, reason: '' }).agent,
        workerRetry: { maxTotalMs: -5 },
        brain: scriptedBrain([{ content: 'done' }]),
      }),
    ).toThrow(/workerRetry\.maxTotalMs/)
  })
})
