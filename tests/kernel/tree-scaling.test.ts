/**
 * One pursuit's own tree grows to depth and width: children inherit spawn rights, spawns past the
 * worker-slot bound queue instead of failing, the budget subdivides down the tree, and each manager
 * carries a bounded account of its team up to its lead.
 *
 * The brain is a scripted Router: every manager spawns `FANOUT` children until the last level, whose
 * children are authored as explicit leaves. The children are authored with NO coordination grant,
 * so every level below the root is a manager only because it inherited its parent's spawn rights.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createCoordinationTools } from '../../src/mcp/tools/coordination'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { supervise } from '../../src/runtime/supervise/supervise'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  SpawnEvent,
  Spend,
  SubtreeSummary,
} from '../../src/runtime/supervise/types'
import { createWorkerSlots } from '../../src/runtime/supervise/worker-slots'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })

const FANOUT = 2
const model = { provider: 'tangle-router', default: 'offline-model' } as const

interface ChatMessage {
  readonly role: string
  readonly content?: unknown
  readonly tool_calls?: ReadonlyArray<{ readonly id: string; readonly function: { name: string } }>
  readonly tool_call_id?: string
}

/** A scripted Router brain. A manager at `level` spawns FANOUT children, then awaits each one. */
function treeBrain(depth: number, calls: { count: number }) {
  return async (body: Record<string, unknown>) => {
    calls.count += 1
    const messages = body.messages as ReadonlyArray<ChatMessage>
    const tools = ((body.tools as ReadonlyArray<{ function: { name: string } }>) ?? []).map(
      (tool) => tool.function.name,
    )
    const task = messages.map((message) => String(message.content ?? '')).join('\n')
    const level = Number(/level=(\d+)/u.exec(task)?.[1] ?? 0)
    const reply = (message: Record<string, unknown>) => ({
      model: 'offline-model',
      choices: [{ message, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0 },
    })
    if (!tools.includes('spawn_worker')) return reply({ content: `leaf answer at level ${level}` })
    const callNames = new Map<string, string>()
    for (const message of messages) {
      for (const call of message.tool_calls ?? []) callNames.set(call.id, call.function.name)
    }
    const settled = messages.filter(
      (message) =>
        message.role === 'tool' &&
        callNames.get(message.tool_call_id ?? '') === 'await_event' &&
        /"status":"(done|down)"/u.test(String(message.content)),
    ).length
    const spawned = [...callNames.values()].filter((name) => name === 'spawn_worker').length
    if (spawned === 0) {
      const leafLevel = level + 1 === depth
      return reply({
        content: null,
        tool_calls: Array.from({ length: FANOUT }, (_, index) => ({
          id: `spawn-${level}-${index}`,
          type: 'function',
          function: {
            name: 'spawn_worker',
            arguments: JSON.stringify({
              profile: {
                name: leafLevel ? `leaf-${level + 1}` : `manager-${level + 1}`,
                harness: 'cli-base',
                model,
                // Only the last level is written as an explicit leaf; every other child is
                // authored without any coordination grant and must inherit one.
                ...(leafLevel ? { tools: { agent_runtime_coordination_spawn_worker: false } } : {}),
              } satisfies AgentProfile,
              task: `level=${level + 1} part=${index}`,
            }),
          },
        })),
      })
    }
    if (settled < FANOUT) {
      return reply({
        content: null,
        tool_calls: [
          {
            id: `await-${level}-${settled}-${calls.count}`,
            type: 'function',
            function: { name: 'await_event', arguments: '{}' },
          },
        ],
      })
    }
    return reply({ content: `manager at level ${level} done` })
  }
}

function spawnedEvents(
  journal: InMemorySpawnJournal,
): Array<Extract<SpawnEvent, { kind: 'spawned' }>> {
  const trees = (journal as unknown as { trees: Map<string, { events: SpawnEvent[] }> }).trees
  return [...trees.values()]
    .flatMap((tree) => tree.events)
    .filter(
      (event): event is Extract<SpawnEvent, { kind: 'spawned' }> =>
        event.kind === 'spawned' && event.parent !== undefined,
    )
}

describe('one tree scales to depth and width', () => {
  it('reaches depth five with inherited spawn rights, queued slots, and a bounded team summary', async () => {
    const depth = 5
    const calls = { count: 0 }
    const router = {
      routerBaseUrl: 'http://offline.invalid/v1',
      routerKey: 'offline',
      complete: treeBrain(depth, calls),
    }
    const slots = createWorkerSlots(3)
    const journal = new InMemorySpawnJournal()
    const settledSummaries: SubtreeSummary[] = []
    const result = await supervise(
      {
        name: 'root',
        harness: 'cli-base',
        model,
        tools: runtimeToolDeclarations('spawn_worker', 'await_event', 'cancel_worker'),
      },
      'level=0',
      {
        budget: { maxIterations: 4_000, maxTokens: 40_000_000 },
        perWorker: { maxIterations: 900, maxTokens: 9_000_000 },
        router,
        backend: { backend: 'router', ...router },
        workerSlots: slots,
        deliverable: { check: () => true, describe: 'any answer' },
        awaitTimeoutMs: 60_000,
        journal,
        blobs: new InMemoryResultBlobStore(),
        runId: 'tree-scaling',
        hooks: {
          onEvent: (event) => {
            const subtree = (event.payload as { subtree?: SubtreeSummary } | undefined)?.subtree
            if (event.target === 'agent.child' && subtree) settledSummaries.push(subtree)
          },
        },
      },
    )

    expect(result.kind).toBe('winner')
    const spawned = spawnedEvents(journal)
    // 2 + 4 + 8 + 16 + 32 agents below the root, none refused for concurrency.
    expect(spawned).toHaveLength(62)
    const deepest = Math.max(...spawned.map((event) => event.id.split(':s').length - 1))
    expect(deepest).toBe(depth)
    // Every level below the last was authored without a grant and still led a team.
    const managers = spawned.filter((event) => event.label !== undefined && event.ownedTreeRoot)
    expect(managers).toHaveLength(2 + 4 + 8 + 16)
    expect(slots.working).toBe(0)
    expect(slots.queued).toBe(0)
    // The root's two children each report their whole team, bounded to their own direct children.
    const top = settledSummaries.filter((summary) => summary.agents === 30)
    expect(top).toHaveLength(2)
    for (const summary of top) {
      expect(summary).toMatchObject({ depth: 4, done: 30, down: 0, omitted: 0 })
      expect(summary.results).toHaveLength(FANOUT)
      expect(summary.results.every((entry) => entry.outRef?.startsWith('sha256:'))).toBe(true)
    }
  }, 60_000)

  it('keeps every child a leaf when the play switches inheritance off', async () => {
    const calls = { count: 0 }
    const router = {
      routerBaseUrl: 'http://offline.invalid/v1',
      routerKey: 'offline',
      complete: treeBrain(5, calls),
    }
    const journal = new InMemorySpawnJournal()
    const result = await supervise(
      {
        name: 'root',
        harness: 'cli-base',
        model,
        tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
      },
      'level=0',
      {
        budget: { maxIterations: 400, maxTokens: 4_000_000 },
        router,
        backend: { backend: 'router', ...router },
        inheritSpawnRights: false,
        deliverable: { check: () => true, describe: 'any answer' },
        awaitTimeoutMs: 60_000,
        journal,
        blobs: new InMemoryResultBlobStore(),
        runId: 'tree-scaling-off',
      },
    )
    expect(result.kind).toBe('winner')
    const spawned = spawnedEvents(journal)
    expect(spawned).toHaveLength(FANOUT)
    expect(spawned.every((event) => event.ownedTreeRoot === undefined)).toBe(true)
  }, 60_000)
})

describe('a lead takes back what a stalled worker holds', () => {
  it('cancels a running worker and a queued one, and both slices return to its pool', async () => {
    const stalledSpec = (name: string): Agent<unknown, unknown> & { executorSpec: AgentSpec } => {
      const executor: Executor<unknown> = {
        runtime: 'router',
        // A worker that never runs a turn: it only ends when it is cancelled.
        execute: (_task, signal) =>
          new Promise<ExecutorResult<unknown>>((_resolve, reject) => {
            const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            if (signal.aborted) fail()
            else signal.addEventListener('abort', fail, { once: true })
          }),
        teardown: () => Promise.resolve({ destroyed: true }),
        accounting: () => ({ reported: zeroSpend(), reservation: zeroSpend() }),
        resultArtifact: () => {
          throw new Error('a cancelled worker has no result')
        },
      }
      return {
        name,
        act: async () => undefined,
        executorSpec: {
          profile: testAgentProfile(name, { harness: 'cli-base' }),
          harness: null,
          executor,
        },
      }
    }
    const seen: Record<string, unknown> = {}
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'lead',
        async act(_task, scope) {
          const tools = createCoordinationTools({
            scope,
            blobs: new InMemoryResultBlobStore(),
            makeWorkerAgent: (profile) => stalledSpec(profile.name ?? 'stalled'),
            perWorker: { maxIterations: 10, maxTokens: 1_000 },
          })
          const call = (name: string, args: Record<string, unknown>) =>
            tools.tools.find((tool) => tool.name === name)!.handler(args) as Promise<
              Record<string, unknown>
            >
          const first = await call('spawn_worker', { profile: { name: 'a' }, task: 'hold' })
          const second = await call('spawn_worker', { profile: { name: 'b' }, task: 'hold' })
          seen.statuses = [first.status, second.status]
          seen.heldTokens = scope.budget.tokensLeft
          seen.refusedForeign = (await call('cancel_worker', { workerId: 'someone-else' })).error
          seen.cancelQueued = (await call('cancel_worker', { workerId: second.workerId })).cancelled
          seen.cancelRunning = (await call('cancel_worker', { workerId: first.workerId })).cancelled
          const settled = [
            await call('await_event', { kinds: ['settled'] }),
            await call('await_event', { kinds: ['settled'] }),
          ]
          seen.settled = settled.map((event) => event.status)
          seen.freedTokens = scope.budget.tokensLeft
          seen.working = scope.workerCapacity.working
          return 'reclaimed'
        },
      },
      'task',
      {
        budget: { maxIterations: 20, maxTokens: 2_000 },
        workerSlots: 1,
        runId: 'cancel-reclaims',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )
    expect(result.kind).toBe('winner')
    expect(seen).toEqual({
      statuses: ['acquiring', 'queued'],
      heldTokens: 0,
      refusedForeign: 'not-live',
      cancelQueued: true,
      cancelRunning: true,
      settled: ['down', 'down'],
      freedTokens: 2_000,
      working: 0,
    })
  })
})
