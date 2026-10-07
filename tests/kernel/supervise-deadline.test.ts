import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import {
  armDeadlineTimer,
  DEADLINE_CHECK_IN_MESSAGE,
  type DeadlineCheckIn,
  teardownExecutor,
} from '../../src/runtime/supervise/deadline'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  Scope,
  Spend,
  SupervisorOpts,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

const zeroSpend: Spend = {
  iterations: 0,
  tokens: { input: 0, output: 0 },
  usd: 0,
  ms: 0,
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('supervision deadlines', () => {
  it('bounds a teardown promise that never acknowledges brutal kill', async () => {
    const executor = teardownOnlyExecutor(() => new Promise(() => {}))

    await expect(
      teardownExecutor(executor, 'brutalKill', Date.now() + 10, Date.now),
    ).rejects.toThrow(/teardown did not acknowledge/)
  })

  it('refuses a teardown receipt that admits the resource survived', async () => {
    const executor = teardownOnlyExecutor(async () => ({ destroyed: false }))

    await expect(teardownExecutor(executor, 'brutalKill', undefined, Date.now)).rejects.toThrow(
      /destroyed=false/,
    )
  })

  it('chunks delays beyond the Node timer limit instead of firing them after 1 ms', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const onDeadline = vi.fn()
    const maxTimerDelayMs = 2_147_483_647

    armDeadlineTimer(maxTimerDelayMs + 500, onDeadline)
    await vi.advanceTimersByTimeAsync(maxTimerDelayMs)
    expect(onDeadline).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(onDeadline).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the root deadline aborts live work and remains a budget exhaustion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const started = deferred()
    const root: Agent<unknown, unknown> = {
      name: 'deadline-root',
      async act(task, scope: Scope<unknown>): Promise<unknown> {
        const spawned = scope.spawn(blockingLeaf('blocked'), task, {
          budget: { maxIterations: 1, maxTokens: 10 },
          label: 'blocked',
        })
        expect(spawned.ok).toBe(true)
        started.resolve()
        const settled = await scope.next()
        if (settled?.kind === 'down') throw new Error(settled.reason)
        return settled?.out
      },
    }

    const running = createSupervisor<unknown, unknown>().run(
      root,
      'task',
      supervisorOpts({ budget: { maxIterations: 1, maxTokens: 10, deadlineMs: 25 } }),
    )
    await started.promise
    await vi.advanceTimersByTimeAsync(25)

    const result = await running
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'budget-exhausted' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unrefs and clears the root timer when work finishes before the deadline', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const root: Agent<unknown, string> = {
      name: 'quick-root',
      act: async () => 'done',
    }

    const result = await createSupervisor<unknown, string>().run(
      root,
      'task',
      supervisorOpts({ budget: { maxIterations: 1, maxTokens: 10, deadlineMs: 60_000 } }),
    )

    expect(result.kind).toBe('winner')
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
    const timer = setTimeoutSpy.mock.results[0]?.value
    expect(timer).toBeDefined()
    expect(timer.hasRef()).toBe(false)
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer)
  })

  it.each([
    {
      name: 'the child duration is shorter',
      parentDeadlineMs: 100,
      childDeadlineMs: 20,
      expectedMs: 20,
    },
    {
      name: 'the parent duration is shorter',
      parentDeadlineMs: 20,
      childDeadlineMs: 100,
      expectedMs: 20,
    },
  ])('aborts a child at the earlier cutoff when $name', async (testCase) => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    const { scope } = await beginScope({
      maxIterations: 1,
      maxTokens: 10,
      deadlineMs: testCase.parentDeadlineMs,
    })
    const spawned = scope.spawn(blockingLeaf('child'), 'task', {
      budget: {
        maxIterations: 1,
        maxTokens: 10,
        deadlineMs: testCase.childDeadlineMs,
      },
      label: 'child',
    })
    expect(spawned.ok).toBe(true)

    await vi.advanceTimersByTimeAsync(testCase.expectedMs - 1)
    expect(scope.view.inFlight).toBe(1)
    await vi.advanceTimersByTimeAsync(1)

    const settled = await scope.next()
    expect(settled).toMatchObject({ kind: 'down', reason: 'aborted before settle' })
    expect(scope.view.inFlight).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('checks a steerable child in at its own time box instead of stopping it, and keeps what it submits', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(4_000)
    const { scope } = await beginScope({ maxIterations: 1, maxTokens: 10 })
    const child = steerableLeaf('director', { submitOnCheckIn: 'state saved: 3 of 5 sections' })
    const spawned = scope.spawn(child.agent, 'task', {
      budget: { maxIterations: 1, maxTokens: 10, deadlineMs: 100 },
      label: 'director',
    })
    expect(spawned.ok).toBe(true)

    await vi.advanceTimersByTimeAsync(100)
    expect(child.messages).toEqual([{ steer: DEADLINE_CHECK_IN_MESSAGE, interrupt: false }])

    const settled = await scope.next()
    expect(settled).toMatchObject({ kind: 'done', out: 'state saved: 3 of 5 sections' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops a checked-in child only once it makes no progress for the idle bound', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    const { scope } = await beginScope({ maxIterations: 1, maxTokens: 10 }, { idleMs: 1_000 })
    const child = steerableLeaf('silent')
    scope.spawn(child.agent, 'task', { budget: { maxIterations: 1, maxTokens: 10, deadlineMs: 100 }, label: 'silent' })

    await vi.advanceTimersByTimeAsync(100)
    expect(child.messages).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(scope.view.inFlight).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)

    const settled = await scope.next()
    expect(settled).toMatchObject({ kind: 'down', reason: 'aborted before settle' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a checked-in child that is still working past the idle bound', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(6_000)
    const { scope } = await beginScope({ maxIterations: 1, maxTokens: 10 }, { idleMs: 1_000 })
    const child = steerableLeaf('busy', { activeUntil: 6_000 + 100 + 5_000 })
    scope.spawn(child.agent, 'task', { budget: { maxIterations: 1, maxTokens: 10, deadlineMs: 100 }, label: 'busy' })

    await vi.advanceTimersByTimeAsync(100 + 4_500)
    expect(scope.view.inFlight).toBe(1)
    child.finish('finished after the check-in')

    expect(await scope.next()).toMatchObject({ kind: 'done', out: 'finished after the check-in' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops a steerable child at its time box when check-ins are off', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(7_000)
    const { scope } = await beginScope({ maxIterations: 1, maxTokens: 10 }, false)
    const child = steerableLeaf('boxed')
    scope.spawn(child.agent, 'task', { budget: { maxIterations: 1, maxTokens: 10, deadlineMs: 100 }, label: 'boxed' })

    await vi.advanceTimersByTimeAsync(100)
    expect(child.messages).toEqual([])
    expect(await scope.next()).toMatchObject({ kind: 'down', reason: 'aborted before settle' })
  })

  it('stops a steerable child at the run\'s own deadline without a check-in', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(8_000)
    const { scope } = await beginScope({ maxIterations: 1, maxTokens: 10, deadlineMs: 50 })
    const child = steerableLeaf('inherits')
    scope.spawn(child.agent, 'task', { budget: { maxIterations: 1, maxTokens: 10 }, label: 'inherits' })

    await vi.advanceTimersByTimeAsync(50)
    expect(child.messages).toEqual([])
    expect(await scope.next()).toMatchObject({ kind: 'down', reason: 'aborted before settle' })
  })

  it('refuses a malformed check-in policy before any child runs', async () => {
    await expect(beginScope({ maxIterations: 1, maxTokens: 10 }, { idleMs: 0 })).rejects.toThrow(/idleMs/)
  })

  it('clears a child deadline when the child finishes first', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(3_000)
    const { scope } = await beginScope({ maxIterations: 1, maxTokens: 10 })
    const spawned = scope.spawn(immediateLeaf('child'), 'task', {
      budget: { maxIterations: 1, maxTokens: 10, deadlineMs: 100 },
      label: 'child',
    })
    expect(spawned.ok).toBe(true)

    expect((await scope.next())?.kind).toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })
})

async function beginScope(budget: Budget, deadlineCheckIn?: DeadlineCheckIn): Promise<{ scope: Scope<unknown> }> {
  const journal = new InMemorySpawnJournal()
  await journal.beginTree('deadline-scope', new Date(Date.now()).toISOString())
  return {
    scope: createScope({
      parentId: 'deadline-scope',
      root: 'deadline-scope',
      pool: createBudgetPool(budget, Date.now()),
      journal,
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
      now: Date.now,
      ...(deadlineCheckIn === undefined ? {} : { deadlineCheckIn }),
    }),
  }
}

/** A leaf with an inbox: it records what it is told, may submit when checked in, and may report
 *  tool activity until `activeUntil`. It ends when told to finish or when aborted. */
function steerableLeaf(
  name: string,
  options: { submitOnCheckIn?: string; activeUntil?: number } = {},
): { agent: Agent<unknown, unknown>; messages: unknown[]; finish(out: string): void } {
  const messages: unknown[] = []
  let finish: (out: string) => void = () => {}
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute: (_task, signal) =>
      new Promise<ExecutorResult<unknown>>((resolve) => {
        finish = (out) => resolve({ outRef: `out:${name}`, out, spent: zeroSpend })
        if (signal.aborted) finish('aborted')
        else signal.addEventListener('abort', () => finish('aborted'), { once: true })
      }),
    deliver(message: unknown): boolean {
      messages.push(message)
      if (options.submitOnCheckIn !== undefined) queueMicrotask(() => finish(options.submitOnCheckIn as string))
      return true
    },
    progress: () =>
      options.activeUntil !== undefined && Date.now() <= options.activeUntil
        ? { recentActivity: [{ at: Date.now(), kind: 'tool', label: 'edit' }] }
        : undefined,
    teardown: async () => ({ destroyed: true }),
  }
  const agent = { name, act: async () => name, executorSpec: { profile: testAgentProfile(name), harness: null, executor } } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
  return { agent, messages, finish: (out) => finish(out) }
}

function blockingLeaf(name: string): Agent<unknown, unknown> {
  return leaf(
    name,
    (signal) =>
      new Promise<ExecutorResult<unknown>>((resolve) => {
        const finish = () => resolve({ outRef: `blocked:${name}`, out: name, spent: zeroSpend })
        if (signal.aborted) finish()
        else signal.addEventListener('abort', finish, { once: true })
      }),
  )
}

function immediateLeaf(name: string): Agent<unknown, unknown> {
  return leaf(name, async () => ({ outRef: `done:${name}`, out: name, spent: zeroSpend }))
}

function teardownOnlyExecutor(teardown: Executor<unknown>['teardown']): Executor<unknown> {
  return {
    runtime: 'router',
    execute: async () => ({ outRef: 'unused', out: undefined, spent: zeroSpend }),
    teardown,
    resultArtifact: () => ({ outRef: 'unused', out: undefined, spent: zeroSpend }),
  }
}

function leaf(
  name: string,
  execute: (signal: AbortSignal) => Promise<ExecutorResult<unknown>>,
): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute: (_task, signal) => execute(signal),
    teardown: async () => ({ destroyed: true }),
  }
  const executorSpec: AgentSpec = {
    profile: testAgentProfile(name),
    harness: null,
    executor,
  }
  return { name, act: async () => name, executorSpec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function supervisorOpts(over: Partial<SupervisorOpts> = {}): SupervisorOpts {
  return {
    budget: over.budget ?? { maxIterations: 1, maxTokens: 10 },
    runId: 'deadline-supervisor',
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    executors: createExecutorRegistry(),
    now: Date.now,
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
