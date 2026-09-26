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
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import type { WorkerProgress } from '../../src/runtime/supervise/progress'
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

/**
 * A scripted brain for a wide fleet: every manager spawns `fanout` children in one turn, then reads
 * their settlements `batch` at a time with `await_event({ max })`, and counts each receipt once by
 * its workerId. Leaves answer after a short wait so the tree really runs them concurrently.
 */
function fleetBrain(
  fanout: number,
  depth: number,
  batch: number,
  turns: Map<number, number>,
  leaves: { live: number; peak: number },
) {
  return async (body: Record<string, unknown>) => {
    const messages = body.messages as ReadonlyArray<ChatMessage>
    const tools = ((body.tools as ReadonlyArray<{ function: { name: string } }>) ?? []).map(
      (tool) => tool.function.name,
    )
    const task = messages.map((message) => String(message.content ?? '')).join('\n')
    const level = Number(/level=(\d+)/u.exec(task)?.[1] ?? 0)
    turns.set(level, (turns.get(level) ?? 0) + 1)
    const reply = (message: Record<string, unknown>) => ({
      model: 'offline-model',
      choices: [{ message, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0 },
    })
    if (!tools.includes('spawn_worker')) {
      leaves.live += 1
      leaves.peak = Math.max(leaves.peak, leaves.live)
      await new Promise((resolve) => setTimeout(resolve, 200))
      leaves.live -= 1
      return reply({ content: `leaf answer at level ${level}` })
    }
    const names = new Map<string, string>()
    for (const message of messages) {
      for (const call of message.tool_calls ?? []) names.set(call.id, call.function.name)
    }
    const settled = new Set<string>()
    for (const message of messages) {
      if (message.role !== 'tool' || names.get(message.tool_call_id ?? '') !== 'await_event')
        continue
      for (const match of String(message.content).matchAll(/"settled":"([^"]+)"/gu)) {
        settled.add(match[1] as string)
      }
    }
    if (![...names.values()].includes('spawn_worker')) {
      const leafLevel = level + 1 === depth
      return reply({
        content: null,
        tool_calls: Array.from({ length: fanout }, (_, index) => ({
          id: `spawn-${level}-${index}`,
          type: 'function',
          function: {
            name: 'spawn_worker',
            arguments: JSON.stringify({
              profile: {
                name: leafLevel ? 'leaf' : 'manager',
                harness: 'cli-base',
                model,
                ...(leafLevel ? { tools: { agent_runtime_coordination_spawn_worker: false } } : {}),
              } satisfies AgentProfile,
              task: `level=${level + 1} part=${index}`,
              // The lead picks its team's width by the slice it gives each worker.
              budget: leafLevel
                ? { maxIterations: 1_000, maxTokens: 1_000_000 }
                : { maxIterations: 40_000, maxTokens: 40_000_000 },
            }),
          },
        })),
      })
    }
    if (settled.size < fanout) {
      // A real brain thinks for a while between reads, and more workers settle meanwhile.
      await new Promise((resolve) => setTimeout(resolve, 100))
      return reply({
        content: null,
        tool_calls: [
          {
            id: `await-${level}-${names.size}`,
            type: 'function',
            function: { name: 'await_event', arguments: JSON.stringify({ max: batch }) },
          },
        ],
      })
    }
    return reply({ content: `manager at level ${level} read ${settled.size} results` })
  }
}

describe('a fleet of hundreds of agents runs on the defaults', () => {
  it('settles all 420 agents of a 1 + 20 + 400 tree with no turn, slot, or retry count cap', async () => {
    const turns = new Map<number, number>()
    const leaves = { live: 0, peak: 0 }
    const router = {
      routerBaseUrl: 'http://offline.invalid/v1',
      routerKey: 'offline',
      complete: fleetBrain(20, 2, 50, turns, leaves),
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
        // Money is the only bound set here: no maxTurns, no workerSlots, no perWorker.
        budget: { maxIterations: 1_000_000, maxTokens: 1_000_000_000 },
        router,
        backend: { backend: 'router', ...router },
        deliverable: { check: () => true, describe: 'any answer' },
        awaitTimeoutMs: 60_000,
        journal,
        blobs: new InMemoryResultBlobStore(),
        runId: 'fleet-defaults',
      },
    )
    expect(result.kind).toBe('winner')
    const trees = (journal as unknown as { trees: Map<string, { events: SpawnEvent[] }> }).trees
    const events = [...trees.values()].flatMap((tree) => tree.events)
    const spawned = new Set(spawnedEvents(journal).map((event) => event.id))
    expect(spawned.size).toBe(420)
    const settled = events.filter(
      (event): event is Extract<SpawnEvent, { kind: 'settled' }> =>
        event.kind === 'settled' && spawned.has(event.id),
    )
    expect(settled.filter((event) => event.status === 'down')).toEqual([])
    expect(settled.filter((event) => event.status === 'done')).toHaveLength(420)
    // No slot or turn bound held the leaves back: most of the 400 ran at the same time.
    expect(leaves.peak).toBeGreaterThanOrEqual(200)
    // Each manager read its 20 receipts in batches: well under one turn per receipt.
    expect(turns.get(1)).toBeLessThan(20 * 20)
  }, 120_000)
})

describe('a manager with no deadline is still bounded by money', () => {
  it('stops polling a worker that never settles once it has overdrawn its pool', async () => {
    let turns = 0
    const complete = async (body: Record<string, unknown>) => {
      const tools = ((body.tools as ReadonlyArray<{ function: { name: string } }>) ?? []).map(
        (tool) => tool.function.name,
      )
      const reply = (message: Record<string, unknown>) => ({
        model: 'offline-model',
        choices: [{ message, finish_reason: 'stop' }],
        usage: { prompt_tokens: 400, completion_tokens: 100, cost: 0 },
      })
      if (!tools.includes('spawn_worker')) {
        // The worker never answers.
        await new Promise(() => undefined)
      }
      turns += 1
      const name = turns === 1 ? 'spawn_worker' : 'await_event'
      const args =
        turns === 1
          ? {
              profile: {
                name: 'hung',
                harness: 'cli-base',
                model,
                tools: { agent_runtime_coordination_spawn_worker: false },
              },
              task: 'never finish',
              budget: { maxIterations: 10, maxTokens: 5_000 },
            }
          : {}
      return reply({
        content: null,
        tool_calls: [
          {
            id: `call-${turns}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      })
    }
    const router = { routerBaseUrl: 'http://offline.invalid/v1', routerKey: 'offline', complete }
    await supervise(
      {
        name: 'root',
        harness: 'cli-base',
        model,
        tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
      },
      'wait on one worker',
      {
        // No deadline and no turn cap: only the 10,000-token pool bounds the manager's own turns.
        budget: { maxIterations: 1_000, maxTokens: 10_000 },
        router,
        backend: { backend: 'router', ...router },
        deliverable: { check: () => true, describe: 'any answer' },
        awaitTimeoutMs: 5,
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        runId: 'overdraw-guard',
      },
    )
    // Each turn meters 500 tokens: 5,000 free after the worker's slice, then 10,000 more overdrawn.
    expect(turns).toBeGreaterThan(20)
    expect(turns).toBeLessThan(40)
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

describe('a lead reads a manager by the work of its team', () => {
  it('sees a manager whose worker is busy as active, and one whose team went quiet as stalled', async () => {
    const minute = 60_000
    let clock = 1_000_000
    let leafActivityAt = clock
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const leafExecutor: Executor<unknown> = {
      runtime: 'router',
      // A worker that keeps working without reporting usage until it finishes, as a harness in a
      // long tool call does; only its own activity read shows that it is busy.
      execute: async () => {
        await released
        return {
          outRef: 'leaf',
          out: 'checked',
          spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
        }
      },
      progress: () => ({ recentActivity: [{ at: leafActivityAt, kind: 'tool', label: 'bash' }] }),
      teardown: () => Promise.resolve({ destroyed: true }),
    }
    const leaf = {
      name: 'leaf',
      act: async () => 'checked',
      executorSpec: {
        profile: testAgentProfile('leaf', { harness: 'cli-base' }),
        harness: null,
        executor: leafExecutor,
      },
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    let leading: () => void = () => undefined
    const managerLeads = new Promise<void>((resolve) => {
      leading = resolve
    })
    const journal = new InMemorySpawnJournal()
    const manager = driverChild(
      testAgentProfile('manager', { harness: 'cli-base' }),
      {
        name: 'manager',
        async act(_task, scope) {
          await scope.meter({ iterations: 0, tokens: { input: 5, output: 1 }, usd: 0, ms: 0 })
          const spawned = scope.spawn(leaf, 'check', {
            budget: { maxIterations: 5, maxTokens: 100 },
            label: 'leaf',
          })
          if (!spawned.ok) throw new Error(`leaf spawn refused: ${spawned.reason}`)
          leading()
          const settled = await scope.next()
          return settled?.kind === 'done' ? settled.out : undefined
        },
      },
      journal,
    )
    const reads: Record<string, WorkerProgress | undefined> = {}
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'lead',
        async act(_task, scope) {
          const spawned = scope.spawn(manager, 'lead a check', {
            budget: { maxIterations: 20, maxTokens: 1_000 },
            label: 'manager',
          })
          if (!spawned.ok) throw new Error(`manager spawn refused: ${spawned.reason}`)
          await managerLeads
          const read = () => scope.progress(spawned.handle.id, { stallAfterMs: 3 * minute })
          // Ten minutes on, the manager itself reported nothing, but its worker acted a second ago.
          clock += 10 * minute
          leafActivityAt = clock - 1_000
          reads.busy = read()
          // Five more quiet minutes anywhere in the team: now the manager reads stalled.
          clock += 5 * minute
          reads.quiet = read()
          release()
          await scope.next()
          return 'observed'
        },
      },
      'task',
      {
        budget: { maxIterations: 100, maxTokens: 10_000 },
        runId: 'lead-reads-team',
        journal,
        blobs: new InMemoryResultBlobStore(),
        executors: withDriverExecutor(createExecutorRegistry()),
        now: () => clock,
      },
    )
    expect(result.kind).toBe('winner')
    expect(reads.busy).toMatchObject({
      stalled: false,
      idleMs: 1_000,
      turns: 1,
      team: { agents: 1, depth: 1, working: 1, queued: 0, done: 0, down: 0 },
    })
    expect(reads.quiet).toMatchObject({ stalled: true, idleMs: 5 * minute + 1_000 })
  })

  it('never reads a queued worker as stalled', async () => {
    let clock = 0
    const reads: WorkerProgress[] = []
    const holder = (name: string): Agent<unknown, unknown> & { executorSpec: AgentSpec } => ({
      name,
      act: async () => undefined,
      executorSpec: {
        profile: testAgentProfile(name, { harness: 'cli-base' }),
        harness: null,
        executor: {
          runtime: 'router',
          execute: (_task, signal) =>
            new Promise<ExecutorResult<unknown>>((_resolve, reject) => {
              const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
              if (signal.aborted) fail()
              else signal.addEventListener('abort', fail, { once: true })
            }),
          teardown: () => Promise.resolve({ destroyed: true }),
        },
      },
    })
    await createSupervisor<unknown, unknown>().run(
      {
        name: 'lead',
        async act(_task, scope) {
          const first = scope.spawn(holder('a'), 'hold', {
            budget: { maxIterations: 1, maxTokens: 10 },
            label: 'a',
          })
          const second = scope.spawn(holder('b'), 'hold', {
            budget: { maxIterations: 1, maxTokens: 10 },
            label: 'b',
          })
          if (!first.ok || !second.ok) throw new Error('spawn refused')
          clock += 3_600_000
          for (const id of [first.handle.id, second.handle.id]) {
            const read = scope.progress(id, { stallAfterMs: 1_000 })
            if (read) reads.push(read)
          }
          first.handle.abort('done observing')
          second.handle.abort('done observing')
          await scope.next()
          await scope.next()
          return 'observed'
        },
      },
      'task',
      {
        budget: { maxIterations: 10, maxTokens: 100 },
        workerSlots: 1,
        runId: 'queued-not-stalled',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
        now: () => clock,
      },
    )
    expect(reads.map((read) => [read.status, read.stalled])).toEqual([
      ['acquiring', true],
      ['queued', false],
    ])
  })
})
