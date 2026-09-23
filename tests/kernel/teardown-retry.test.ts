/**
 * A SETTLED OR CANCELLED RUN LEAVES NO CHILD SANDBOX RUNNING.
 *
 * Measured 2026-09-20: cancelling 20 Discovery lanes left 2 workers running, each named in the run
 * result's `teardownUnconfirmed`, and across that campaign 136 of 612 agents (22%) ended with
 * teardown unconfirmed. A child's first teardown runs inside its settlement with a short
 * acknowledgement window, and one refused or late provider delete was the last word.
 *
 * The rule these tests hold: the join barrier asks each unconfirmed child again, with backoff,
 * until its executor confirms destruction or `teardownConfirmMs` passes. A child still unconfirmed
 * then is named with the provider environment ids a sweeper deletes, on the result and in the
 * journal. Nothing is dropped, and nothing stalls past the window.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  type AgentEnvironment,
  type AgentEnvironmentEvent,
  type AgentEnvironmentProvider,
  providerAsExecutor,
} from '../../src/runtime/environment-provider'
import { driverChild } from '../../src/runtime/supervise/driver-executor'
import { RetainedExecutionPendingError } from '../../src/runtime/supervise/retained-executor'
import { createInMemoryRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  Executor,
  ExecutorFactory,
  ExecutorResult,
  Scope,
  SpawnEvent,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

const REFUSAL = '409 Conflict: environment is still stopping'

/**
 * A provider whose one environment refuses deletion `refusals` times and then deletes. The turn
 * either completes (a settled child) or waits for its abort (a child the run cancels). `live`
 * reads the fleet: whether the environment still exists at the provider.
 */
function refusingProvider(options: { refusals: number; turn: 'completes' | 'waits' }) {
  let destroys = 0
  let live = false
  const completed = async function* (): AsyncIterable<AgentEnvironmentEvent> {
    yield { type: 'message.part.updated', data: { delta: 'the patch ' } }
    yield {
      type: 'result',
      data: { finalText: 'the patch applied' },
      usage: { inputTokens: 7, outputTokens: 11, cost: 0.03 },
    }
  }
  const waiting = async function* (signal: AbortSignal | undefined): AsyncIterable<never> {
    await new Promise<never>((_resolve, reject) => {
      const stop = () => reject(signal?.reason ?? new Error('turn aborted'))
      if (signal === undefined || signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
    })
  }
  const environment: AgentEnvironment = {
    id: 'env-1',
    provider: 'fake-provider',
    status: async () => (live ? 'running' : 'stopped'),
    destroy: async () => {
      destroys += 1
      if (destroys <= options.refusals) throw new Error(REFUSAL)
      live = false
    },
    stream: (input) => (options.turn === 'completes' ? completed() : waiting(input.signal)),
  }
  const provider = {
    name: 'fake-provider',
    capabilities: async () => ({}),
    create: async () => {
      live = true
      return environment
    },
  } as unknown as AgentEnvironmentProvider
  return { provider, destroys: () => destroys, live: () => live }
}

/** A worker whose executor the scope builds per spawn. */
function worker(name: string, factory: ExecutorFactory<unknown>): Agent<unknown, unknown> {
  return Object.assign(
    { name, act: async () => 'unused' },
    { executorSpec: { profile: testAgentProfile(name), harness: null, executorFactory: factory } },
  )
}

/** A leaf that completes at once and whose teardown answers from `teardown`. */
function leaf(
  name: string,
  teardown: () => Promise<{ destroyed: boolean; detail?: string; permanent?: boolean }>,
): Agent<unknown, unknown> & { teardowns: () => number } {
  let teardowns = 0
  const artifact: ExecutorResult<unknown> = {
    outRef: `leaf:${name}`,
    out: `${name} delivered`,
    spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
  }
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute: async () => artifact,
    teardown: () => {
      teardowns += 1
      return teardown()
    },
    resultArtifact: () => artifact,
  }
  return Object.assign(
    { name, act: async () => 'unused' },
    {
      executorSpec: { profile: testAgentProfile(name), harness: null, executor },
      teardowns: () => teardowns,
    },
  )
}

/** A teardown that throws the provider's refusal `refusals` times, then confirms. */
function refusingTeardown(refusals: number) {
  let calls = 0
  return async () => {
    calls += 1
    if (calls <= refusals) throw new Error(REFUSAL)
    return { destroyed: true }
  }
}

/** Spawn each worker and await every settlement. A brutal kill keeps a settlement's own teardown
 *  to the short acknowledgement window, as a cancelled child's is. */
async function spawnAll(scope: Scope<unknown>, workers: ReadonlyArray<Agent<unknown, unknown>>) {
  for (const child of workers) {
    const spawned = scope.spawn(child, 'work', {
      label: child.name,
      budget: { maxIterations: 1, maxTokens: 100 },
      shutdown: 'brutalKill',
    })
    expect(spawned.ok).toBe(true)
  }
  for (const _ of workers) await scope.next()
}

const unconfirmedEvents = (events: ReadonlyArray<SpawnEvent>) =>
  events.filter((event) => event.kind === 'teardown-unconfirmed')

describe('the join barrier retries unconfirmed child teardown', () => {
  it('deletes a settled child sandbox the provider refused three times, and names no leak', async () => {
    const fleet = refusingProvider({ refusals: 3, turn: 'completes' })
    const context = createInMemoryRunContext()
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAll(scope, [worker('worker', providerAsExecutor(fleet.provider))])
          // The stream's own delete and the settlement's teardown were both refused: before this
          // change the run settled here and the sandbox stayed up.
          expect(fleet.live()).toBe(true)
          expect(scope.workerCapacity.unconfirmed).toMatchObject([
            {
              id: 'settled:s0',
              environments: [{ provider: 'fake-provider', environmentId: 'env-1' }],
              attempts: 1,
            },
          ])
          return 'finished'
        },
      },
      'task',
      {
        ...context,
        runId: 'settled',
        budget: { maxIterations: 2, maxTokens: 200 },
        teardownConfirmMs: 3_000,
      },
    )

    expect(result.kind, JSON.stringify(result)).toBe('winner')
    expect(fleet.live()).toBe(false)
    // Stream delete, settlement teardown, one refused retry, one retry the provider accepted.
    expect(fleet.destroys()).toBe(4)
    expect(result.teardownUnconfirmed).toBeUndefined()
    expect(unconfirmedEvents((await context.journal.loadTree('settled')) ?? [])).toEqual([])
  })

  it('deletes the sandbox of a child the run cancelled, after the provider refused twice', async () => {
    const fleet = refusingProvider({ refusals: 2, turn: 'waits' })
    const context = createInMemoryRunContext()
    const cancel = new AbortController()
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          const spawned = scope.spawn(worker('lane', providerAsExecutor(fleet.provider)), 'work', {
            label: 'lane',
            budget: { maxIterations: 1, maxTokens: 100 },
          })
          expect(spawned.ok).toBe(true)
          await expect.poll(() => fleet.live()).toBe(true)
          cancel.abort(new Error('operator cancelled the lane'))
          return await new Promise<never>(() => {})
        },
      },
      'task',
      {
        ...context,
        runId: 'cancelled',
        budget: { maxIterations: 2, maxTokens: 200 },
        signal: cancel.signal,
        teardownConfirmMs: 3_000,
      },
    )

    expect(result.kind).toBe('no-winner')
    expect(fleet.live()).toBe(false)
    expect(fleet.destroys()).toBe(3)
    expect(result.teardownUnconfirmed).toBeUndefined()
    expect(unconfirmedEvents((await context.journal.loadTree('cancelled')) ?? [])).toEqual([])
  })

  it('names the environment a sweeper must delete when the provider never confirms in the window', async () => {
    const fleet = refusingProvider({ refusals: Number.POSITIVE_INFINITY, turn: 'completes' })
    const context = createInMemoryRunContext()
    const started = Date.now()
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAll(scope, [worker('worker', providerAsExecutor(fleet.provider))])
          return 'finished'
        },
      },
      'task',
      {
        ...context,
        runId: 'refused',
        budget: { maxIterations: 2, maxTokens: 200 },
        teardownConfirmMs: 300,
      },
    )

    expect(result.kind, JSON.stringify(result)).toBe('winner')
    // Bounded: the window, a backoff step past it at most, and no more.
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(fleet.live()).toBe(true)
    const [named] = result.teardownUnconfirmed ?? []
    expect(result.teardownUnconfirmed).toHaveLength(1)
    expect(named).toMatchObject({
      id: 'refused:s0',
      label: 'worker',
      environments: [{ provider: 'fake-provider', environmentId: 'env-1' }],
      detail: expect.stringContaining(REFUSAL),
    })
    // The first attempt plus several paced retries, every one of them a real delete.
    expect(named?.attempts).toBeGreaterThanOrEqual(4)
    expect(fleet.destroys()).toBe((named?.attempts ?? 0) + 1)
    // The journal carries the same ids, so a sweeper reading the run record needs nothing else.
    expect(unconfirmedEvents((await context.journal.loadTree('refused')) ?? [])).toMatchObject([
      {
        id: 'refused:s0',
        environments: [{ provider: 'fake-provider', environmentId: 'env-1' }],
        attempts: named?.attempts,
        detail: expect.stringContaining(REFUSAL),
      },
    ])
  })

  it('bounds a teardown that never answers without holding up another child’s retry', async () => {
    const hung = leaf('hung', () => new Promise(() => {}))
    const flaky = leaf('flaky', refusingTeardown(2))
    const started = Date.now()
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAll(scope, [hung, flaky])
          return 'finished'
        },
      },
      'task',
      {
        ...createInMemoryRunContext(),
        runId: 'hung',
        budget: { maxIterations: 4, maxTokens: 400 },
        teardownConfirmMs: 400,
      },
    )

    expect(result.kind, JSON.stringify(result)).toBe('winner')
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(flaky.teardowns()).toBe(3)
    // The hung attempt is awaited by later passes rather than asked again beside itself.
    expect(hung.teardowns()).toBe(2)
    expect(result.teardownUnconfirmed?.map((node) => node.label)).toEqual(['hung'])
  })

  it('stops asking once the executor says its answer is permanent', async () => {
    const preserved = leaf('preserved', async () => ({
      destroyed: false,
      detail: 'provider workspace retention: source preserved',
      permanent: true,
    }))
    const started = Date.now()
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAll(scope, [preserved])
          return 'finished'
        },
      },
      'task',
      {
        ...createInMemoryRunContext(),
        runId: 'preserved',
        budget: { maxIterations: 2, maxTokens: 200 },
        teardownConfirmMs: 60_000,
      },
    )

    // One retry learns the answer cannot change; the run does not wait out a minute for it.
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(preserved.teardowns()).toBe(2)
    expect(result.teardownUnconfirmed).toMatchObject([
      { label: 'preserved', attempts: 2, detail: expect.stringContaining('source preserved') },
    ])
  })

  it('stops releasing a retained child that names no environment to release', async () => {
    // An admission that never got an environment id has nothing a later release can destroy, so
    // the run names the node and settles instead of re-asking for the whole window.
    let releases = 0
    const artifact: ExecutorResult<unknown> = {
      outRef: 'never',
      out: 'never',
      spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
    }
    const unnamed = worker('unnamed', () => ({
      runtime: 'router',
      execute: async () => {
        throw new RetainedExecutionPendingError(new Error('provider result read lost'))
      },
      teardown: async () => ({ destroyed: false, detail: 'retained execution pending' }),
      releaseRetained: async () => {
        releases += 1
        return []
      },
      resultArtifact: () => artifact,
    }))
    const started = Date.now()
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAll(scope, [unnamed])
          return 'finished'
        },
      },
      'task',
      {
        ...createInMemoryRunContext(),
        runId: 'unnamed',
        budget: { maxIterations: 2, maxTokens: 200 },
        teardownConfirmMs: 60_000,
      },
    )

    expect(Date.now() - started).toBeLessThan(5_000)
    // The settlement's own release already learned that nothing can change; no retry follows.
    expect(releases).toBe(1)
    expect(result.teardownUnconfirmed?.map((node) => node.id)).toEqual(['unnamed:s0'])
  })

  it('asks once when teardownConfirmMs is 0', async () => {
    const flaky = leaf('flaky', refusingTeardown(1))
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAll(scope, [flaky])
          return 'finished'
        },
      },
      'task',
      {
        ...createInMemoryRunContext(),
        runId: 'once',
        budget: { maxIterations: 2, maxTokens: 200 },
        teardownConfirmMs: 0,
      },
    )

    expect(flaky.teardowns()).toBe(1)
    expect(result.teardownUnconfirmed).toMatchObject([
      { label: 'flaky', attempts: 1, detail: expect.stringContaining(REFUSAL) },
    ])
  })

  it('reaches a nested manager’s descendant, and confirms the manager once its tree is', async () => {
    const context = createInMemoryRunContext({ withDriver: true })
    const flaky = leaf('nested-leaf', refusingTeardown(2))
    const manager = driverChild(
      testAgentProfile('manager') as AgentProfile,
      {
        name: 'manager',
        async act(_task, scope) {
          await spawnAll(scope, [flaky])
          return 'managed'
        },
      },
      context.journal,
    )
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          expect(
            scope.spawn(manager, 'manage', { budget: { maxIterations: 2, maxTokens: 200 } }).ok,
          ).toBe(true)
          await scope.next()
          // The leaf's refusal holds its manager unconfirmed at the root.
          expect(scope.workerCapacity.unconfirmed.map((node) => node.id)).toEqual(['nested:s0'])
          return 'finished'
        },
      },
      'task',
      {
        ...context,
        runId: 'nested',
        budget: { maxIterations: 4, maxTokens: 400 },
        teardownConfirmMs: 3_000,
      },
    )

    expect(result.kind, JSON.stringify(result)).toBe('winner')
    expect(flaky.teardowns()).toBe(3)
    expect(result.teardownUnconfirmed).toBeUndefined()
  })

  it('refuses a window it cannot honor before any work starts', async () => {
    let acted = false
    await expect(
      createSupervisor<unknown, unknown>().run(
        {
          name: 'root',
          async act() {
            acted = true
            return 'finished'
          },
        },
        'task',
        {
          ...createInMemoryRunContext(),
          runId: 'invalid',
          budget: { maxIterations: 1, maxTokens: 10 },
          teardownConfirmMs: -1,
        },
      ),
    ).rejects.toThrow(/teardownConfirmMs must be a nonnegative finite number/)
    expect(acted).toBe(false)
  })
})
