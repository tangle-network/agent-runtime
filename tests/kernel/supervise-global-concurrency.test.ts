import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { MakeWorkerAgent } from '../../src/mcp/tools/coordination'
import { driverChild } from '../../src/runtime/supervise/driver-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { supervise } from '../../src/runtime/supervise/supervise'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { supervisorAgent } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
} from '../../src/runtime/supervise/types'
import { scriptedBrain } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

const zeroCost = { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 }
const knownZero = {
  iterations: 0,
  tokens: { input: 0, output: 0 },
  usd: 0,
  ms: 0,
}

interface Activity {
  live: number
  peak: number
}

function enter(activity: Activity): void {
  activity.live += 1
  activity.peak = Math.max(activity.peak, activity.live)
}

function leave(activity: Activity): void {
  activity.live -= 1
}

function trackedLeaf(name: string, activity?: Activity, holdMs = 0): Agent<unknown, unknown> {
  const result: ExecutorResult<unknown> = {
    outRef: `leaf:${name}`,
    out: { name },
    verdict: { valid: true, score: 1 },
    spent: zeroCost,
  }
  const executor: Executor<unknown> = {
    runtime: 'router',
    async execute(): Promise<ExecutorResult<unknown>> {
      if (activity) enter(activity)
      try {
        if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs))
        return result
      } finally {
        if (activity) leave(activity)
      }
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => result,
  }
  const spec: AgentSpec = {
    profile: testAgentProfile(name, { harness: 'cli-base' }),
    harness: null,
    executor,
  }
  return { name, act: async () => result.out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function failingLeaf(name: string): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute: () => Promise.reject(new Error('executor failed')),
    teardown: () => Promise.resolve({ destroyed: true }),
    // This fake fails before any provider call. Keep the capacity test independent from the
    // separate fail-closed rule that unknown token usage consumes the remaining capped budget.
    accounting: () => ({ reported: knownZero, reservation: knownZero }),
    resultArtifact: () => {
      throw new Error('failed executor has no result')
    },
  }
  const spec: AgentSpec = {
    profile: testAgentProfile(name, { harness: 'cli-base' }),
    harness: null,
    executor,
  }
  return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function abortableLeaf(name: string): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute(_task, signal): Promise<ExecutorResult<unknown>> {
      return new Promise((_resolve, reject) => {
        const fail = () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }
        if (signal.aborted) fail()
        else signal.addEventListener('abort', fail, { once: true })
      })
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    accounting: () => ({ reported: knownZero, reservation: knownZero }),
    resultArtifact: () => {
      throw new Error('aborted executor has no result')
    },
  }
  const spec: AgentSpec = {
    profile: testAgentProfile(name, { harness: 'cli-base' }),
    harness: null,
    executor,
  }
  return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function profileDepth(profile: AgentProfile): number {
  const value = profile.metadata?.depth
  if (typeof value !== 'number')
    throw new Error(`profile ${profile.name ?? '<unnamed>'} has no depth`)
  return value
}

describe('supervise tree-wide worker capacity', () => {
  it('retains a slot when teardown cannot prove the executor was destroyed', async () => {
    let secondReason: string | undefined
    const unkillable = trackedLeaf('placeholder') as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
    unkillable.executorSpec = {
      profile: testAgentProfile('unkillable', { harness: 'cli-base' }),
      harness: null,
      executor: {
        runtime: 'router',
        execute: () => new Promise<ExecutorResult<unknown>>(() => {}),
        teardown: () => new Promise(() => {}),
        resultArtifact: () => {
          throw new Error('unkillable executor has no result')
        },
      },
    }
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(task, scope): Promise<unknown> {
        const first = scope.spawn(unkillable, task, {
          budget: { maxIterations: 1, maxTokens: 10, deadlineMs: 5 },
          label: 'unkillable',
        })
        expect(first.ok).toBe(true)
        expect((await scope.next())?.kind).toBe('down')
        const second = scope.spawn(() => trackedLeaf('replacement'), task, {
          budget: { maxIterations: 1, maxTokens: 10 },
          label: 'replacement',
        })
        secondReason = second.ok ? 'accepted' : second.reason
        return 'finished'
      },
    }

    const result = await createSupervisor<unknown, unknown>().run(root, 'task', {
      budget: { maxIterations: 2, maxTokens: 20 },
      maxLiveWorkers: 1,
      runId: 'retain-unconfirmed-capacity',
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
    })

    expect(secondReason).toBe('max-live-workers')
    expect(result.kind).toBe('no-winner')
  })

  it('holds one cap across root → manager → sub-manager → worker execution', async () => {
    const cap = 5
    const activity: Activity = { live: 0, peak: 0 }
    const constructedDepths: number[] = []
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()

    let makeWorkerAgent: MakeWorkerAgent
    makeWorkerAgent = (profile, context) => {
      const depth = profileDepth(profile)
      constructedDepths.push(depth)
      if (profile.metadata?.role !== 'driver')
        return trackedLeaf(profile.name ?? 'leaf', activity, 50)

      const childProfiles: AgentProfile[] =
        depth === 1
          ? [
              testAgentProfile(`${profile.name}-sub-manager`, {
                harness: 'cli-base',
                metadata: { role: 'driver', depth: 2 },
              }),
            ]
          : [0, 1].map((index) =>
              testAgentProfile(`${profile.name}-leaf-${index}`, {
                harness: 'cli-base',
                metadata: { role: 'worker', depth: 3 },
              }),
            )
      const brain = scriptedBrain([
        {
          toolCalls: childProfiles.map((child) => ({
            name: 'spawn_agent',
            arguments: { profile: child, task: `run ${child.name}` },
          })),
        },
        { toolCalls: [{ name: 'await_event', arguments: {} }] },
        { content: 'managed' },
      ])
      const nested = supervisorAgent(profile, {
        blobs,
        makeWorkerAgent,
        perWorker:
          depth === 1
            ? { maxIterations: 40, maxTokens: 40_000 }
            : { maxIterations: 10, maxTokens: 10_000 },
        brain,
        maxTurns: 6,
      })
      const tracked: Agent<unknown, unknown> = {
        name: nested.name,
        async act(task, scope): Promise<unknown> {
          enter(activity)
          try {
            return await nested.act(task, scope)
          } finally {
            leave(activity)
          }
        },
      }
      return driverChild(profile, tracked, journal, context?.execution)
    }

    const rootBrain = scriptedBrain([
      {
        toolCalls: [0, 1].map((index) => ({
          name: 'spawn_agent',
          arguments: {
            profile: testAgentProfile(`manager-${index}`, {
              harness: 'cli-base',
              metadata: { role: 'driver', depth: 1 },
            }),
            task: `run branch ${index}`,
          },
        })),
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])

    const result = await supervise(
      testAgentProfile('root', { harness: 'cli-base' }),
      'run a three-level tree',
      {
        budget: { maxIterations: 500, maxTokens: 500_000 },
        perWorker: { maxIterations: 160, maxTokens: 160_000 },
        maxDepth: 5,
        maxLiveWorkers: cap,
        makeWorkerAgent,
        brain: rootBrain,
        journal,
        blobs,
        runId: 'global-cap',
      },
    )

    expect(result.kind).toBe('winner')
    expect(activity.live).toBe(0)
    expect(activity.peak).toBe(cap)
    expect(constructedDepths).toHaveLength(cap)
    expect(constructedDepths.filter((depth) => depth === 1)).toHaveLength(2)
    expect(constructedDepths.filter((depth) => depth === 2)).toHaveLength(2)
    expect(constructedDepths).toContain(3)

    const trees = (
      journal as unknown as { trees: Map<string, { events: Array<{ kind: string; id: string }> }> }
    ).trees
    const spawnedIds = [...trees.values()]
      .flatMap((tree) => tree.events)
      .filter((event) => event.kind === 'spawned')
      .map((event) => event.id)
    expect(spawnedIds.some((id) => id.split(':s').length === 4)).toBe(true)
  })

  it('releases once on construction failure, budget refusal, completion, and completed-key replay', async () => {
    const seen: Record<string, unknown> = {}
    let completedFactoryCalls = 0
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(task, scope: Scope<unknown>): Promise<unknown> {
        try {
          scope.spawn(
            () => {
              throw new Error('construction failed')
            },
            task,
            { budget: { maxIterations: 1, maxTokens: 10 }, label: 'bad-factory' },
          )
        } catch (error) {
          seen.constructionError = error instanceof Error ? error.message : String(error)
        }
        seen.afterConstructionError = scope.workerCapacity.live

        try {
          scope.spawn(() => trackedLeaf('invalid-budget'), task, {
            budget: { maxIterations: -1, maxTokens: 10 },
            label: 'invalid-budget',
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          seen.invalidBudgetRefused = message.includes('non-negative safe integer')
        }
        seen.afterInvalidBudget = scope.workerCapacity.live

        const tooLarge = scope.spawn(() => trackedLeaf('too-large'), task, {
          budget: { maxIterations: 101, maxTokens: 100_001 },
          label: 'too-large',
        })
        seen.tooLarge = tooLarge.ok ? 'accepted' : tooLarge.reason
        seen.afterBudgetRefusal = scope.workerCapacity.live

        const failed = scope.spawn(() => failingLeaf('failed'), task, {
          budget: { maxIterations: 1, maxTokens: 10 },
          label: 'failed',
        })
        seen.failedStarted = failed.ok
        seen.failedSettled = (await scope.next())?.kind
        seen.afterExecutorFailure = scope.workerCapacity.live

        const aborted = scope.spawn(() => abortableLeaf('aborted'), task, {
          budget: { maxIterations: 1, maxTokens: 10 },
          label: 'aborted',
        })
        seen.abortedStarted = aborted.ok
        if (aborted.ok) aborted.handle.abort('test abort')
        seen.abortedSettled = (await scope.next())?.kind
        seen.afterAbort = scope.workerCapacity.live

        const first = scope.spawn(() => trackedLeaf('keyed'), task, {
          budget: { maxIterations: 1, maxTokens: 10 },
          label: 'keyed',
          key: 'assignment',
        })
        seen.first = first.ok
        seen.duringRun = scope.workerCapacity.live
        seen.settled = (await scope.next())?.kind
        seen.afterCompletion = scope.workerCapacity.live

        const replay = scope.spawn(
          () => {
            completedFactoryCalls += 1
            return trackedLeaf('keyed')
          },
          task,
          {
            budget: { maxIterations: 1, maxTokens: 10 },
            label: 'keyed',
            key: 'assignment',
          },
        )
        seen.replay = replay.ok ? replay.prior?.state : replay.reason
        seen.afterReplay = scope.workerCapacity.live
        return 'done'
      },
    }

    const result = await createSupervisor<unknown, unknown>().run(root, 'task', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      maxLiveWorkers: 1,
      runId: 'capacity-release',
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
    })

    expect(result.kind).toBe('winner')
    expect(seen).toEqual({
      constructionError: 'construction failed',
      afterConstructionError: 0,
      invalidBudgetRefused: true,
      afterInvalidBudget: 0,
      tooLarge: 'budget-exhausted',
      afterBudgetRefusal: 0,
      failedStarted: true,
      failedSettled: 'down',
      afterExecutorFailure: 0,
      abortedStarted: true,
      abortedSettled: 'down',
      afterAbort: 0,
      first: true,
      duringRun: 1,
      settled: 'done',
      afterCompletion: 0,
      replay: 'completed',
      afterReplay: 0,
    })
    // Reuse prepares the requested profile/task so the semantic key cannot alias different work.
    // It still constructs no executor, reserves no budget, and runs nothing.
    expect(completedFactoryCalls).toBe(1)
  })
})
