import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  type DriverAgentOptions,
  driverAgent,
} from '../../src/runtime/supervise/coordination-driver'
import { FileCoordinationLog } from '../../src/runtime/supervise/coordination-log'
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
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'
import { type ScriptedTurn, scriptedBrain, wakeEvents } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

type SeenMessages = Array<ReadonlyArray<Record<string, unknown>>>

// ── Offline scripted leaf worker (no network/sandbox/LLM) ────────────────────────
interface WorkerScript {
  readonly out: unknown
  readonly tokens: { input: number; output: number }
  readonly iterations: number
  readonly score: number
}

function workerExecutor(s: WorkerScript, onTeardown?: () => void, delayMs = 0): Executor<unknown> {
  const events: UsageEvent[] = []
  for (let i = 0; i < s.iterations; i += 1) events.push({ kind: 'iteration' })
  events.push({ kind: 'tokens', input: s.tokens.input, output: s.tokens.output })
  return {
    runtime: 'router',
    execute() {
      return (async function* () {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
        for (const ev of events) yield ev
      })()
    },
    teardown: () => {
      onTeardown?.()
      return Promise.resolve({ destroyed: true })
    },
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

function workerLeaf(
  name: string,
  s: WorkerScript,
  onTeardown?: () => void,
  delayMs = 0,
): Agent<unknown, unknown> {
  const spec: AgentSpec = {
    profile: testAgentProfile(name),
    harness: null,
    executor: workerExecutor(s, onTeardown, delayMs),
  }
  return { name, act: async () => s.out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function hangingWorkerLeaf(name: string): Agent<unknown, unknown> {
  const spec: AgentSpec = {
    profile: testAgentProfile(name),
    harness: null,
    executor: {
      runtime: 'router',
      execute(_task: unknown, signal: AbortSignal): Promise<ExecutorResult<unknown>> {
        return new Promise((_, reject) => {
          if (signal.aborted) {
            reject(new Error('aborted'))
            return
          }
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact(): ExecutorResult<unknown> {
        return {
          outRef: 'never',
          out: {},
          verdict: { valid: false, score: 0 },
          spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
        }
      },
    },
  }
  return { name, act: async () => ({}), executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

const spawnOnly = ['spawn_worker'] as const
const listQuestionsOnly = ['list_questions'] as const

function driverOpts(
  name: string,
  brain: ToolLoopChat,
  makeWorkerAgent: (p: AgentProfile) => Agent<unknown, unknown>,
): DriverAgentOptions {
  return {
    name,
    brain,
    blobs: SHARED_BLOBS,
    makeWorkerAgent,
    perWorker,
    toolNames: spawnOnly,
    systemPrompt: `drive the worker to do: <task>`,
    maxTurns: 8,
  }
}

// One shared blob store so observe/finalize reads settled outputs across the whole tree.
let SHARED_BLOBS = new InMemoryResultBlobStore()

describe('driverAgent — the driver BRAIN (LLM tool-loop drives real spawns)', () => {
  it('the tool-loop spawns a worker, ends its turn, and is woken with the settled result', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: SeenMessages = []

    const worker = workerLeaf('w', {
      out: { answer: 42 },
      tokens: { input: 10, output: 5 },
      iterations: 1,
      score: 0.9,
    })
    // The makeWorkerAgent the spawn_worker tool dispatches: this test only spawns the worker leaf.
    const makeAgent = (_p: AgentProfile): Agent<unknown, unknown> => worker

    // Scripted driver LLM: turn 0 spawns a worker, turn 1 ends the turn to wait, turn 2 (the wake)
    // stops with nothing open.
    const chat = scriptedBrain(
      [
        {
          toolCalls: [
            {
              name: 'spawn_worker',
              arguments: { profile: { metadata: { kind: 'worker' } }, task: 'go' },
            },
          ],
        },
        { content: 'waiting for the worker' },
        { content: 'done' },
      ],
      seen,
    )

    const root = driverAgent(driverOpts('root', chat, makeAgent))
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

    // Feed-back proof: turn 2 (the 3rd chat call) is the wake. Its input carries the settlement of
    // the done worker, delivered with no turn spent while the worker ran.
    expect(seen).toHaveLength(3)
    const settled = wakeEvents(seen[2]!).find((event) => event.type === 'settled')
    expect(settled).toMatchObject({ status: 'done' })

    // A real worker spawn is recorded in the journal (not a mock-bypassed result).
    const root_tree = (await journal.loadTree('cd')) as SpawnEvent[]
    expect(root_tree.some((e) => e.kind === 'spawned')).toBe(true)
    expect(root_tree.some((e) => e.kind === 'settled' && e.status === 'done')).toBe(true)
  })

  it('shows a worker overspend to the driver in its wake and again in a resume brief', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const runId = 'cd-overspend'
    const rootIdentity = {
      profileDigest: canonicalCandidateDigest({ name: 'cd-overspend-root' }),
      taskDigest: canonicalCandidateDigest({ task: 'solve it' }),
    }
    // The worker completes, but spends 1,500 tokens against the 1,000 `perWorker` reservation.
    const worker = workerLeaf('w', {
      out: { answer: 42 },
      tokens: { input: 1_500, output: 0 },
      iterations: 1,
      score: 0.9,
    })
    const violation = { overspent: [{ channel: 'tokens', reserved: 1_000, spent: 1_500 }] }
    const seen: SeenMessages = []
    const chat = scriptedBrain(
      [
        {
          toolCalls: [
            {
              name: 'spawn_worker',
              arguments: { profile: { metadata: { kind: 'worker' } }, task: 'go' },
            },
          ],
        },
        { content: 'waiting for the worker' },
        { content: 'done' },
      ],
      seen,
    )
    const runOpts = {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId,
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      rootIdentity,
      maxDepth: 4,
      now: () => 0,
    }
    const first = await createSupervisor<unknown, unknown>().run(
      driverAgent(driverOpts('root', chat, () => worker)),
      'solve it',
      runOpts,
    )
    expect(first.kind).toBe('winner')
    const awaited = wakeEvents(seen[2]!).find((content) => content.type === 'settled')
    expect(awaited).toMatchObject({ status: 'done', budgetViolation: violation })

    const resumedSeen: SeenMessages = []
    await createSupervisor<unknown, unknown>().run(
      driverAgent(
        driverOpts('root', scriptedBrain([{ content: 'done' }], resumedSeen), () => worker),
      ),
      'solve it',
      { ...runOpts, resume: true },
    )
    const brief = resumedSeen[0]
      ?.map((message) => String(message.content))
      .find((content) => content.startsWith('RESUME:'))
    expect(brief).toContain('overspent=tokens 1500 > reserved 1000')
  })

  it('a delivered child the brain never awaited still wins (post-loop drain feeds finalize)', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()

    let markWorkerFinished: (() => void) | undefined
    const workerFinished = new Promise<void>((resolve) => {
      markWorkerFinished = resolve
    })

    const worker = workerLeaf(
      'w',
      {
        out: { answer: 42 },
        tokens: { input: 10, output: 5 },
        iterations: 1,
        score: 0.9,
      },
      () => markWorkerFinished?.(),
    )
    const makeAgent = (_p: AgentProfile): Agent<unknown, unknown> => worker

    // Scripted driver LLM: spawns a worker then ends its turn without reading anything. Runtime
    // wakes it with the settlement; the delivery wins.
    const scripted = scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: { metadata: { kind: 'worker' } }, task: 'go' },
          },
        ],
      },
      { content: 'spawned; stopping without awaiting' },
    ])
    let turn = 0
    const chat: ToolLoopChat = async (messages, options) => {
      // Model inference naturally leaves time between tool rounds. Make that ordering explicit so
      // this test proves the documented case—already-settled work—not a race with journal commit.
      if (turn === 1) await workerFinished
      turn += 1
      return scripted(messages, options)
    }

    const root = driverAgent(driverOpts('root', chat, makeAgent))
    const result = await createSupervisor<unknown, unknown>().run(root, 'solve it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cd-unawaited',
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
  })

  it('one delivered child wins even when siblings the brain spawned went down (drain skips the failures)', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()

    const good = workerLeaf('good', {
      out: { answer: 'READY' },
      tokens: { input: 8, output: 4 },
      iterations: 1,
      score: 1,
    })
    // Alternate good/failing on each spawn_worker dispatch — the brain fans out three workers,
    // two of which crash (down), and stops without awaiting any of them.
    let spawn = 0
    const makeAgent = (_p: AgentProfile): Agent<unknown, unknown> =>
      spawn++ === 0 ? good : hangingWorkerLeaf(`bad-${spawn}`)

    const chat = scriptedBrain([
      {
        toolCalls: [
          { name: 'spawn_worker', arguments: { profile: {}, task: 'go' } },
          { name: 'spawn_worker', arguments: { profile: {}, task: 'go' } },
          { name: 'spawn_worker', arguments: { profile: {}, task: 'go' } },
        ],
      },
      // End the turn once (the wake delivers the good worker), then stop on the last turn the
      // bound allows; the two hanging workers are torn down at run end.
      { content: 'waiting for the workers' },
      { content: 'stopping' },
    ])

    const root = driverAgent({ ...driverOpts('root', chat, makeAgent), maxTurns: 3 })
    const result = await createSupervisor<unknown, unknown>().run(root, 'solve it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cd-mixed',
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 'READY' })
  })

  it('a driver AGENT spawns a driver AGENT spawns a worker (the brain composes with 2a recursion)', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const rootSeen: SeenMessages = []
    const midSeen: SeenMessages = []

    const worker = workerLeaf('leaf', {
      out: { deepest: 'reached-the-bottom' },
      tokens: { input: 5, output: 5 },
      iterations: 1,
      score: 1,
    })

    // The mid driver's script: spawn the worker leaf, await it, stop. Held in this closure (not on
    // the spawned profile) because tool arguments are JSON-serialized through the loop, so a live
    // `seen` reference can't ride along — `makeAgent` looks it up by the profile's `kind`.
    const midTurns: ScriptedTurn[] = [
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: { metadata: { kind: 'worker' } }, task: 'sub' },
          },
        ],
      },
      { content: 'waiting for the worker' },
      { content: 'mid done' },
    ]

    // The recursive resolver: a 'driver' profile → a driverChild wrapping ANOTHER
    // driverAgent (over the same recursive makeAgent); a 'worker' profile → leaf.
    const makeAgent = (profile: AgentProfile): Agent<unknown, unknown> => {
      if (profile.metadata?.kind === 'driver') {
        const childBrain = scriptedBrain(midTurns, midSeen)
        return driverChild(
          testAgentProfile('mid'),
          driverAgent(driverOpts('mid', childBrain, makeAgent)),
          journal,
        )
      }
      return worker
    }

    // The root driver's script: spawn the MID DRIVER, await it, stop.
    const rootChat = scriptedBrain(
      [
        {
          toolCalls: [
            {
              name: 'spawn_worker',
              arguments: { profile: { metadata: { kind: 'driver' } }, task: 'delegate' },
            },
          ],
        },
        { content: 'waiting for the worker' },
        { content: 'root done' },
      ],
      rootSeen,
    )

    const root = driverAgent(driverOpts('root', rootChat, makeAgent))
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

    // The mid driver actually ran its OWN tool-loop inside its nested scope: its wake carried the
    // worker's settlement — proof the inner agent reasoned, not scripted-bypassed.
    expect(midSeen.length).toBeGreaterThanOrEqual(2)
    expect(wakeEvents(midSeen.at(-1)!).some((event) => event.status === 'done')).toBe(true)

    // A SEPARATE nested tree exists under the root — the mid driver's sub-tree, holding the
    // worker spawn. A non-recursive build (mid as a leaf) could not produce a nested tree.
    const nestedKeys = collectTreeKeys(journal).filter((k) => k.startsWith('cd/'))
    expect(nestedKeys.length).toBeGreaterThanOrEqual(1)
    const nested = (await journal.loadTree(nestedKeys[0]!)) as SpawnEvent[]
    expect(nested.some((e) => e.kind === 'spawned')).toBe(true)
    expect(nested.some((e) => e.kind === 'settled' && e.status === 'done')).toBe(true)
  })

  it('default compaction keeps in-flight workers in the compressed driver memory', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seenNormalTurns: SeenMessages = []
    const turnEvents: RuntimeHookEvent[] = []
    let normalTurn = 0
    let compactionCalls = 0
    const worker = hangingWorkerLeaf('slow-worker')

    const chat: ToolLoopChat = async (messages, tools) => {
      const last = String(messages[messages.length - 1]?.content ?? '')
      if (last.includes('CONTEXT COMPACTION')) {
        compactionCalls += 1
        return {
          content: 'Spawned one slow worker; it is still running.',
          toolCalls: [],
          usage: { input: 7, output: 3 },
        }
      }
      seenNormalTurns.push(messages)
      normalTurn += 1
      if (normalTurn === 1) {
        expect(tools.some((t) => t.function.name === 'spawn_worker')).toBe(true)
        return {
          toolCalls: [
            {
              id: 'spawn',
              name: 'spawn_worker',
              arguments: JSON.stringify({ profile: {}, task: 'go' }),
            },
          ],
          usage: { input: 11, output: 5 },
        }
      }
      return { content: 'stop', toolCalls: [], usage: { input: 13, output: 2 } }
    }

    const root = driverAgent({
      ...driverOpts('root', chat, () => worker),
      toolNames: spawnOnly,
      compaction: { thresholdTokens: 1 },
      // Two turns: a third would only follow a wake for a worker that never settles.
      maxTurns: 2,
    })
    const result = await createSupervisor<unknown, unknown>().run(root, 'keep track of work', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cd-live',
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
      hooks: {
        onEvent: (event) => {
          if (event.target === 'agent.turn') turnEvents.push(event)
        },
      },
    })

    expect(result.kind).toBe('no-winner')
    expect(compactionCalls).toBe(1)
    const compacted = String(seenNormalTurns[1]?.[2]?.content ?? '')
    expect(compacted).toContain('Workers in current live scope')
    expect(compacted).toContain('cd-live:s0')
    expect(compacted).toContain('running')

    const kinds = turnEvents.map((event) => (event.payload as { kind?: string }).kind)
    expect(kinds).toEqual(['driver-inference', 'driver-compaction', 'driver-inference'])
    const driverTurns = turnEvents
      .map((event) => event.payload as { kind?: string; turn?: number })
      .filter((event) => event.kind === 'driver-inference')
      .map((event) => event.turn)
    expect(driverTurns).toEqual([0, 1])
  })

  it('a driver that ends its turn spends no turn until its worker settles, then is woken with it', async () => {
    // A worker that delivers after 150 ms. The driver ends its turn at once; the next chat call is
    // the wake, and it carries the settlement. Nothing runs the model in between.
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const seen: SeenMessages = []
    const worker = workerLeaf(
      'slow',
      { out: { answer: 'slow' }, tokens: { input: 1, output: 1 }, iterations: 1, score: 1 },
      undefined,
      150,
    )
    const chat = scriptedBrain(
      [
        { toolCalls: [{ name: 'spawn_worker', arguments: { profile: {}, task: 'go' } }] },
        { content: 'waiting' },
      ],
      seen,
    )
    const root = driverAgent({ ...driverOpts('root', chat, () => worker), wake: { debounceMs: 0 } })
    const result = await createSupervisor<unknown, unknown>().run(root, 'wait for it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cd-wake',
      journal: new InMemorySpawnJournal(),
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
    })
    expect(result.kind).toBe('winner')
    // spawn, end turn, then exactly one wake: the settlement, then the final turn found nothing open.
    expect(seen).toHaveLength(3)
    expect(wakeEvents(seen[2]!)).toEqual([
      expect.objectContaining({ type: 'settled', status: 'done' }),
    ])
  })

  it('a heartbeat wakes a driver whose worker has not reported, so it can reconsider', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const seen: SeenMessages = []
    const chat = scriptedBrain(
      [
        { toolCalls: [{ name: 'spawn_worker', arguments: { profile: {}, task: 'go' } }] },
        { content: 'waiting' },
      ],
      seen,
    )
    const root = driverAgent({
      ...driverOpts('root', chat, () => hangingWorkerLeaf('hang')),
      wake: { heartbeatMs: 30, debounceMs: 0 },
      maxTurns: 3,
    })
    await createSupervisor<unknown, unknown>().run(root, 'wait for it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cd-heartbeat',
      journal: new InMemorySpawnJournal(),
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
    })
    expect(seen).toHaveLength(3)
    // `seen` holds the loop's one live conversation, so read the wake from its messages.
    expect(
      seen[2]!.some(
        (message) =>
          message.role === 'user' && String(message.content).includes('Nothing reached your inbox'),
      ),
    ).toBe(true)
  })
})

/** Discover every tree key the in-memory journal has begun (test-only introspection, mirroring
 *  driver-recursion.test.ts). */
function collectTreeKeys(journal: InMemorySpawnJournal): string[] {
  const trees = (journal as unknown as { trees: Map<string, unknown> }).trees
  return [...trees.keys()]
}

// `list_questions` is always present (no analysts needed), has no side effects, and reserves no
// budget — the ideal benign tool for driving the loop a fixed number of turns.
const benignTurn: ScriptedTurn = { toolCalls: [{ name: 'list_questions', arguments: {} }] }
const dummyWorker = (_p: AgentProfile): Agent<unknown, unknown> =>
  workerLeaf('w', { out: {}, tokens: { input: 0, output: 0 }, iterations: 0, score: 0 })

function bounds0Opts(name: string, brain: ToolLoopChat): DriverAgentOptions {
  return {
    name,
    brain,
    blobs: SHARED_BLOBS,
    makeWorkerAgent: dummyWorker,
    perWorker,
    toolNames: listQuestionsOnly,
    systemPrompt: 'drive',
    maxTurns: 0,
  }
}

describe('driverAgent — maxTurns=0 lifts the turn cap; the conserved pool + deadline + abort are the bounds', () => {
  it('rejects a negative maxTurns (fail loud — no silent zero-turn run)', () => {
    const opts = { ...bounds0Opts('root', scriptedBrain([], [])), maxTurns: -1 }
    expect(() => driverAgent(opts)).toThrow(/maxTurns must be >= 0/)
  })

  it('stops when the conserved pool can no longer afford a worker (the in-loop budget bound)', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: SeenMessages = []
    // A driver that NEVER stops on its own — only the pool bound can halt this loop.
    const chat = scriptedBrain([benignTurn], seen)
    const opts: DriverAgentOptions = {
      name: 'root',
      brain: chat,
      blobs: SHARED_BLOBS,
      makeWorkerAgent: dummyWorker,
      // A worker needs more tokens than the whole run pool holds → no worker is ever affordable.
      perWorker: { maxIterations: 4, maxTokens: 5000 },
      toolNames: listQuestionsOnly,
      systemPrompt: 'drive',
      maxTurns: 0,
    }
    const root = driverAgent(opts)
    const result = await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 1000 }, // < perWorker.maxTokens, nothing reserved
      runId: 'mt0-starved',
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
    })
    // Pool starved at turn 0 → the loop breaks before burning a single driver turn (no spinning to
    // the tripwire), and finalizes honestly: nothing delivered → no winner.
    expect(seen.length).toBe(0)
    expect(result.kind).toBe('no-winner')
  })

  it('runs past the former 2000-turn sentinel until the driver stops on its own', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: SeenMessages = []
    const turns: ScriptedTurn[] = Array.from({ length: 2001 }, () => benignTurn)
    turns.push({ content: 'nothing left to do' })
    const chat = scriptedBrain(turns, seen)

    const root = driverAgent(bounds0Opts('root', chat))
    await createSupervisor<unknown, unknown>().run(root, 'long task', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'mt0',
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
    })

    // 2,001 benign turns + 1 stop proves Runtime did not remap 0 to the old 2,000 sentinel.
    expect(seen.length).toBe(2002)
  })

  it('breaks the unlimited loop the moment the scope signal aborts (mid-loop)', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: SeenMessages = []
    const ac = new AbortController()
    let n = 0
    // A chat that NEVER stops on its own (always asks for another benign tool call) — without the
    // abort break this would spin to the 100k backstop. It aborts the run on its 3rd turn.
    const chat: ToolLoopChat = async (messages) => {
      seen.push(messages)
      n += 1
      if (n === 3) ac.abort()
      return { toolCalls: [{ id: `call-${n}`, name: 'list_questions', arguments: '{}' }] }
    }

    const root = driverAgent(bounds0Opts('root', chat))
    const result = await createSupervisor<unknown, unknown>().run(root, 'never-ending', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'mt0-abort',
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      signal: ac.signal,
      now: () => 0,
    })

    // Turns 0,1,2 ran; the abort fired on turn 2 and turn 3's top-of-loop check broke out — so the
    // never-stopping driver halted at 3 turns, not 100k. The driver delivered nothing → no winner.
    expect(seen.length).toBe(3)
    expect(result.kind).toBe('no-winner')
  })
})

describe('driverAgent — the driver can ACT (call work tools itself), not only SPAWN', () => {
  const echoTool = {
    name: 'echo',
    description: 'echoes its text back',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  }

  it('runs a work tool DIRECTLY and folds its result back (no spawn needed)', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: SeenMessages = []
    const workCalls: Array<{ name: string; args: Record<string, unknown> }> = []

    // The driver calls the work tool itself on turn 0, then stops — it never spawns a worker.
    const chat = scriptedBrain(
      [{ toolCalls: [{ name: 'echo', arguments: { text: 'hi' } }] }, { content: 'acted, done' }],
      seen,
    )
    const opts: DriverAgentOptions = {
      ...driverOpts('root', chat, dummyWorker),
      toolNames: ['echo'],
      extraTools: [echoTool],
      executeExtraTool: async (name, args) => {
        workCalls.push({ name, args })
        return name === 'echo' ? `echoed: ${String(args.text)}` : null
      },
    }
    const root = driverAgent(opts)
    await createSupervisor<unknown, unknown>().run(root, 'echo hi', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'work-act',
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
    })

    // The work tool ran with the model's args, and its result was folded back as a `tool` message —
    // the driver ACTED on its own, no worker spawned.
    expect(workCalls).toEqual([{ name: 'echo', args: { text: 'hi' } }])
    const lastConvo = seen[seen.length - 1]!
    expect(
      lastConvo.some((m) => m.role === 'tool' && String(m.content).includes('echoed: hi')),
    ).toBe(true)
    // 0 worker spawns — the only `spawned` event is the root agent's own run (label 'root'), no child.
    const tree = (await journal.loadTree('work-act')) as SpawnEvent[]
    const childSpawns = tree.filter((e) => e.kind === 'spawned' && e.id !== 'work-act')
    expect(childSpawns).toEqual([])
  })

  it('returns the first directly submitted result that passes the independent check', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: SeenMessages = []
    const chat = scriptedBrain(
      [
        { toolCalls: [{ name: 'submit_result', arguments: { result: { answer: 0 } } }] },
        { toolCalls: [{ name: 'submit_result', arguments: { result: { answer: 42 } } }] },
        { content: 'must not need another turn' },
      ],
      seen,
    )
    const root = driverAgent({
      ...driverOpts('root', chat, dummyWorker),
      toolNames: ['submit_result'],
      deliverable: {
        describe: 'an object whose answer is 42',
        check: (result) => (result as { answer?: unknown }).answer === 42,
      },
    })
    const result = await createSupervisor<unknown, unknown>().run(root, 'solve it directly', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'direct-submit',
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
    })

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
    expect(seen).toHaveLength(2)
    const tree = (await journal.loadTree('direct-submit')) as SpawnEvent[]
    expect(tree.filter((e) => e.kind === 'spawned' && e.id !== 'direct-submit')).toEqual([])
  })

  it('recovers an accepted direct result after the driver dies before it settles', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const runId = 'direct-submit-recovery'
    const rootIdentity = {
      profileDigest: canonicalCandidateDigest({ name: 'direct-submit-recovery-root' }),
      taskDigest: canonicalCandidateDigest({ task: 'solve it' }),
    }
    const logDir = await mkdtemp(join(tmpdir(), 'direct-submit-recovery-'))
    const log = new FileCoordinationLog(join(logDir, 'coordination.jsonl'))
    let checks = 0
    let resumedBrainCalls = 0
    const deliverable = {
      check: (result: unknown) => {
        checks += 1
        return (result as { answer?: unknown }).answer === 42
      },
    }
    try {
      const interrupted = driverAgent({
        ...driverOpts(
          'root',
          scriptedBrain([
            { toolCalls: [{ name: 'submit_result', arguments: { result: { answer: 42 } } }] },
          ]),
          dummyWorker,
        ),
        toolNames: ['submit_result'],
        deliverable,
        onEvent: (_event, record) => log.append(runId, record, 'root'),
        // The submission acknowledgement has returned to the driver. Throw before the root scope
        // settles to model a coordinator process that dies in exactly that window.
        onAcceptedSubmission: () => {
          throw new Error('simulated coordinator loss after accepted submission')
        },
      })
      const first = await createSupervisor<unknown, unknown>().run(interrupted, 'solve it', {
        budget: { maxIterations: 100, maxTokens: 100_000 },
        runId,
        journal,
        blobs: SHARED_BLOBS,
        executors: createExecutorRegistry(),
        rootIdentity,
        maxDepth: 2,
        now: () => 0,
      })
      expect(first.kind).toBe('no-winner')

      const priorCoordination = await log.load(runId, 'root')
      expect(priorCoordination.records.map((record) => record.event.type)).toEqual(['submission'])

      const resumed = driverAgent({
        ...driverOpts(
          'root',
          async () => {
            resumedBrainCalls += 1
            throw new Error('a recovered accepted result must not call the driver again')
          },
          dummyWorker,
        ),
        toolNames: ['submit_result'],
        deliverable,
        priorCoordination,
      })
      const second = await createSupervisor<unknown, unknown>().run(resumed, 'solve it', {
        budget: { maxIterations: 100, maxTokens: 100_000 },
        runId,
        journal,
        blobs: SHARED_BLOBS,
        executors: createExecutorRegistry(),
        rootIdentity,
        maxDepth: 2,
        resume: true,
        now: () => 0,
      })

      expect(second.kind).toBe('winner')
      if (second.kind === 'winner') expect(second.out).toEqual({ answer: 42 })
      expect(checks).toBe(1)
      expect(resumedBrainCalls).toBe(0)
    } finally {
      await rm(logDir, { recursive: true, force: true })
    }
  })

  it('the work tool is tried FIRST; a null return falls through to the coordination dispatch', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: SeenMessages = []
    let extraSawCoordVerb = false

    // The driver calls a coordination verb (list_questions). The work executor returns null for it,
    // so the call must fall through to the real coordination tool — not be swallowed.
    const chat = scriptedBrain([benignTurn, { content: 'done' }], seen)
    const opts: DriverAgentOptions = {
      ...driverOpts('root', chat, dummyWorker),
      toolNames: ['list_questions', 'echo'],
      extraTools: [echoTool],
      executeExtraTool: async (name) => {
        if (name === 'list_questions') extraSawCoordVerb = true
        return name === 'echo' ? 'echoed' : null // null ⇒ not mine
      },
    }
    const root = driverAgent(opts)
    await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'work-fallthrough',
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
    })

    // An ungranted work handler is never invoked for a coordination verb. The coordination tool
    // still runs and returns its questions list, rather than leaking an unselected product action.
    expect(extraSawCoordVerb).toBe(false)
    const lastConvo = seen[seen.length - 1]!
    expect(lastConvo.some((m) => m.role === 'tool' && String(m.content) === 'echoed')).toBe(false)
  })

  it('fails loud on a half-wired seam (extraTools without executeExtraTool)', () => {
    const opts: DriverAgentOptions = {
      ...driverOpts('root', scriptedBrain([], []), dummyWorker),
      extraTools: [echoTool],
    }
    expect(() => driverAgent(opts)).toThrow(/extraTools requires executeExtraTool/)
  })

  it('fails loud at CONSTRUCTION when a work tool shadows a coordination verb', () => {
    const opts: DriverAgentOptions = {
      ...driverOpts('root', scriptedBrain([{ content: 'x' }], []), dummyWorker),
      extraTools: [{ ...echoTool, name: 'spawn_worker' }],
      executeExtraTool: async () => 'nope',
    }
    // The collision guard fires eagerly — NOT buried in a swallowed act() throw.
    expect(() => driverAgent(opts)).toThrow(/collides with a coordination verb/)
  })

  it('refuses a product node tool that shadows spawn_worker before any brain turn', () => {
    const opts: DriverAgentOptions = {
      ...driverOpts('root', scriptedBrain([{ content: 'x' }], []), dummyWorker),
      nodeTools: [
        {
          name: 'spawn_worker',
          description: 'must not shadow coordination',
          inputSchema: { type: 'object' },
          handler: async () => ({}),
        },
      ],
    }
    expect(() => driverAgent(opts)).toThrow(/node tool "spawn_worker" collides/)
  })

  it('refuses duplicate explicit tool grants at construction', () => {
    const opts: DriverAgentOptions = {
      ...driverOpts('root', scriptedBrain([{ content: 'x' }], []), dummyWorker),
      toolNames: ['list_questions', 'list_questions'],
    }
    expect(() => driverAgent(opts)).toThrow(/toolNames contains a duplicate name/)
  })

  it('reserves submit_result even when no independent check is configured', () => {
    const opts: DriverAgentOptions = {
      ...driverOpts('root', scriptedBrain([{ content: 'x' }], []), dummyWorker),
      extraTools: [{ ...echoTool, name: 'submit_result' }],
      executeExtraTool: async () => 'nope',
    }
    expect(() => driverAgent(opts)).toThrow(/collides with a coordination verb/)
  })
})

describe('driverAgent — the analyst up-leg (analysts + analyzeOnSettle pass-through)', () => {
  const noWorker = (_p: AgentProfile): Agent<unknown, unknown> =>
    ({
      name: 'w',
      act: async () => '',
      executorSpec: { profile: testAgentProfile('w'), harness: null },
    }) as Agent<unknown, unknown> & { executorSpec: AgentSpec }
  const analysts = {
    kinds: [{ id: 'progress', description: 'read the settled output', area: 'progress' }],
    run: async () => ({ note: 'ok' }),
  }

  it('fails loud when analyzeOnSettle is set without analysts (matches the extraTools guard)', () => {
    expect(() =>
      driverAgent({
        ...driverOpts('x', scriptedBrain([]), noWorker),
        analyzeOnSettle: ['progress'],
      }),
    ).toThrow(/analyzeOnSettle requires analysts/)
  })

  it('constructs when both analysts and analyzeOnSettle are provided (the up-leg wired)', () => {
    expect(() =>
      driverAgent({
        ...driverOpts('x', scriptedBrain([]), noWorker),
        analysts,
        analyzeOnSettle: ['progress'],
      }),
    ).not.toThrow()
  })
})
