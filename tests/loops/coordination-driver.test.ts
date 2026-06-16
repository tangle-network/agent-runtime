import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  type CoordinationDriverOptions,
  coordinationDriverAgent,
  type DriverChat,
  type DriverMessage,
  type DriverTurn,
} from '../../src/runtime/supervise/coordination-driver'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  SpawnEvent,
  UsageEvent,
} from '../../src/runtime/supervise/types'

// ── Offline scripted leaf worker (no network/sandbox/LLM) ────────────────────────
interface WorkerScript {
  readonly out: unknown
  readonly tokens: { input: number; output: number }
  readonly iterations: number
  readonly score: number
}

function workerExecutor(s: WorkerScript): Executor<unknown> {
  const events: UsageEvent[] = []
  for (let i = 0; i < s.iterations; i += 1) events.push({ kind: 'iteration' })
  events.push({ kind: 'tokens', input: s.tokens.input, output: s.tokens.output })
  return {
    runtime: 'router',
    execute() {
      return (async function* () {
        for (const ev of events) yield ev
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      return {
        outRef: `w:${JSON.stringify(s.out)}`,
        out: s.out,
        verdict: { valid: true, score: s.score },
        spent: { iterations: s.iterations, tokens: { ...s.tokens }, usd: 0, ms: 0 },
      }
    },
  }
}

function workerLeaf(name: string, s: WorkerScript): Agent<unknown, unknown> {
  const spec: AgentSpec = {
    profile: { name } as AgentProfile,
    harness: null,
    executor: workerExecutor(s),
  }
  return { name, act: async () => s.out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

// ── A scripted driver-LLM: returns a fixed sequence of turns, records the conversation it
//    saw so the test can prove tool RESULTS were fed back into later turns. ──────────────
function scriptedChat(turns: DriverTurn[], seen: DriverMessage[][]): DriverChat {
  let i = 0
  return {
    next: async (input) => {
      seen.push([...input.messages])
      const t = turns[Math.min(i, turns.length - 1)] ?? {}
      i += 1
      return t
    },
  }
}

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

/** A spawn profile the recursive makeAgent dispatches on: a worker carries a script; a driver
 *  carries its own scripted chat (so a driver agent can spawn a driver agent). */
type Profile =
  | { kind: 'worker'; name: string; script: WorkerScript }
  | { kind: 'driver'; name: string; turns: DriverTurn[]; seen: DriverMessage[][] }

function driverOpts(
  name: string,
  chat: DriverChat,
  makeWorkerAgent: (p: unknown) => Agent<unknown, unknown>,
): CoordinationDriverOptions {
  return {
    name,
    chat,
    blobs: SHARED_BLOBS,
    makeWorkerAgent,
    perWorker,
    systemPrompt: `drive the worker to do: <task>`,
    maxTurns: 8,
  }
}

// One shared blob store so observe/finalize reads settled outputs across the whole tree.
let SHARED_BLOBS = new InMemoryResultBlobStore()

describe('coordinationDriverAgent — the driver BRAIN (LLM tool-loop drives real spawns)', () => {
  it('the tool-loop spawns a worker, awaits it, and folds the settled result back', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: DriverMessage[][] = []

    const worker = workerLeaf('w', {
      out: { answer: 42 },
      tokens: { input: 10, output: 5 },
      iterations: 1,
      score: 0.9,
    })
    // The makeWorkerAgent the spawn_worker tool dispatches: this test only spawns the worker leaf.
    const makeAgent = (_p: unknown): Agent<unknown, unknown> => worker

    // Scripted driver LLM: turn 0 spawns a worker, turn 1 awaits it, turn 2 stops (no calls).
    const chat = scriptedChat(
      [
        {
          toolCalls: [
            { name: 'spawn_worker', arguments: { profile: { kind: 'worker' }, task: 'go' } },
          ],
        },
        { toolCalls: [{ name: 'await_next', arguments: {} }] },
        { content: 'done' },
      ],
      seen,
    )

    const root = coordinationDriverAgent(driverOpts('root', chat, makeAgent))
    const result = await createSupervisor<unknown, unknown>().run(root, 'solve it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cd',
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })

    // The driver's act IS the loop — the run produced the worker's output, which only exists if
    // spawn_worker → Scope.spawn → settle actually ran inside the tool-loop.
    expect(result.kind).toBe('winner')

    // Feed-back proof: by turn 2 (the 3rd chat call), the conversation the driver saw contains a
    // `tool` message carrying the await_next settlement — i.e. the tool RESULT was folded back.
    const turn2Convo = seen[2]!
    const toolMsgs = turn2Convo.filter((m) => m.role === 'tool')
    expect(toolMsgs.length).toBeGreaterThanOrEqual(2) // spawn_worker result + await_next result
    expect(toolMsgs.some((m) => m.name === 'await_next' && m.content.includes('done'))).toBe(true)

    // A real worker spawn is recorded in the journal (not a mock-bypassed result).
    const root_tree = (await journal.loadTree('cd')) as SpawnEvent[]
    expect(root_tree.some((e) => e.kind === 'spawned')).toBe(true)
    expect(root_tree.some((e) => e.kind === 'settled' && e.status === 'done')).toBe(true)
  })

  it('a driver AGENT spawns a driver AGENT spawns a worker (the brain composes with 2a recursion)', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const rootSeen: DriverMessage[][] = []
    const midSeen: DriverMessage[][] = []

    const worker = workerLeaf('leaf', {
      out: { deepest: 'reached-the-bottom' },
      tokens: { input: 5, output: 5 },
      iterations: 1,
      score: 1,
    })

    // The recursive resolver: a 'driver' profile → a driverChild wrapping ANOTHER
    // coordinationDriverAgent (over the same recursive makeAgent); a 'worker' profile → leaf.
    const makeAgent = (raw: unknown): Agent<unknown, unknown> => {
      const p = raw as Profile
      if (p?.kind === 'driver') {
        const childChat = scriptedChat(p.turns, p.seen)
        return driverChild(
          p.name,
          coordinationDriverAgent(driverOpts(p.name, childChat, makeAgent)),
          journal,
        )
      }
      return worker
    }

    // The mid driver's script: spawn the worker leaf, await it, stop.
    const midProfile: Profile = {
      kind: 'driver',
      name: 'mid',
      seen: midSeen,
      turns: [
        {
          toolCalls: [
            { name: 'spawn_worker', arguments: { profile: { kind: 'worker' }, task: 'sub' } },
          ],
        },
        { toolCalls: [{ name: 'await_next', arguments: {} }] },
        { content: 'mid done' },
      ],
    }

    // The root driver's script: spawn the MID DRIVER, await it, stop.
    const rootChat = scriptedChat(
      [
        {
          toolCalls: [
            { name: 'spawn_worker', arguments: { profile: midProfile, task: 'delegate' } },
          ],
        },
        { toolCalls: [{ name: 'await_next', arguments: {} }] },
        { content: 'root done' },
      ],
      rootSeen,
    )

    const root = coordinationDriverAgent(driverOpts('root', rootChat, makeAgent))
    const result = await createSupervisor<unknown, unknown>().run(root, 'go', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cd',
      journal,
      // Route a role:'driver' child to the 2a recursive executor.
      executors: withDriverExecutor(createExecutorRegistry()),
      blobs: SHARED_BLOBS,
      maxDepth: 4,
      now: () => 0,
    })

    expect(result.kind).toBe('winner')

    // The mid driver actually ran its OWN tool-loop inside its nested scope: its conversation
    // recorded the worker's settlement fed back — proof the inner agent reasoned, not scripted-bypassed.
    expect(midSeen.length).toBeGreaterThanOrEqual(2)
    const midToolMsgs = midSeen[midSeen.length - 1]!.filter((m) => m.role === 'tool')
    expect(midToolMsgs.some((m) => m.name === 'await_next')).toBe(true)

    // A SEPARATE nested tree exists under the root — the mid driver's sub-tree, holding the
    // worker spawn. A non-recursive build (mid as a leaf) could not produce a nested tree.
    const nestedKeys = collectTreeKeys(journal).filter((k) => k.startsWith('cd/'))
    expect(nestedKeys.length).toBeGreaterThanOrEqual(1)
    const nested = (await journal.loadTree(nestedKeys[0]!)) as SpawnEvent[]
    expect(nested.some((e) => e.kind === 'spawned')).toBe(true)
    expect(nested.some((e) => e.kind === 'settled' && e.status === 'done')).toBe(true)
  })
})

/** Discover every tree key the in-memory journal has begun (test-only introspection, mirroring
 *  driver-recursion.test.ts). */
function collectTreeKeys(journal: InMemorySpawnJournal): string[] {
  const trees = (journal as unknown as { trees: Map<string, unknown> }).trees
  return [...trees.keys()]
}
