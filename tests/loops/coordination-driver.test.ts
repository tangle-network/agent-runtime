import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  type DriverAgentOptions,
  driverAgent,
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
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { type ScriptedTurn, scriptedBrain } from './scripted-brain'

type SeenMessages = Array<ReadonlyArray<Record<string, unknown>>>

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

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

function driverOpts(
  name: string,
  brain: ToolLoopChat,
  makeWorkerAgent: (p: unknown) => Agent<unknown, unknown>,
): DriverAgentOptions {
  return {
    name,
    brain,
    blobs: SHARED_BLOBS,
    makeWorkerAgent,
    perWorker,
    systemPrompt: `drive the worker to do: <task>`,
    maxTurns: 8,
  }
}

// One shared blob store so observe/finalize reads settled outputs across the whole tree.
let SHARED_BLOBS = new InMemoryResultBlobStore()

describe('driverAgent — the driver BRAIN (LLM tool-loop drives real spawns)', () => {
  it('the tool-loop spawns a worker, awaits it, and folds the settled result back', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: SeenMessages = []

    const worker = workerLeaf('w', {
      out: { answer: 42 },
      tokens: { input: 10, output: 5 },
      iterations: 1,
      score: 0.9,
    })
    // The makeWorkerAgent the spawn_agent tool dispatches: this test only spawns the worker leaf.
    const makeAgent = (_p: unknown): Agent<unknown, unknown> => worker

    // Scripted driver LLM: turn 0 spawns a worker, turn 1 awaits it, turn 2 stops (no calls).
    const chat = scriptedBrain(
      [
        {
          toolCalls: [
            { name: 'spawn_agent', arguments: { profile: { kind: 'worker' }, task: 'go' } },
          ],
        },
        { toolCalls: [{ name: 'await_event', arguments: {} }] },
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
    // spawn_agent → Scope.spawn → settle actually ran inside the tool-loop.
    expect(result.kind).toBe('winner')

    // Feed-back proof: by turn 2 (the 3rd chat call), the conversation the driver saw contains
    // `tool` messages carrying the spawn_agent + await_event settlements — i.e. the tool RESULTS
    // were folded back. The OpenAI tool message is `{ role:'tool', tool_call_id, content }`; the
    // await_event settlement serializes the done worker, so its content carries 'done'.
    const turn2Convo = seen[2]!
    const toolMsgs = turn2Convo.filter((m) => m.role === 'tool')
    expect(toolMsgs.length).toBeGreaterThanOrEqual(2) // spawn_agent result + await_event result
    expect(toolMsgs.some((m) => String(m.content).includes('done'))).toBe(true)

    // A real worker spawn is recorded in the journal (not a mock-bypassed result).
    const root_tree = (await journal.loadTree('cd')) as SpawnEvent[]
    expect(root_tree.some((e) => e.kind === 'spawned')).toBe(true)
    expect(root_tree.some((e) => e.kind === 'settled' && e.status === 'done')).toBe(true)
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
          { name: 'spawn_agent', arguments: { profile: { kind: 'worker' }, task: 'sub' } },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'mid done' },
    ]

    // The recursive resolver: a 'driver' profile → a driverChild wrapping ANOTHER
    // driverAgent (over the same recursive makeAgent); a 'worker' profile → leaf.
    const makeAgent = (raw: unknown): Agent<unknown, unknown> => {
      const p = raw as { kind?: string }
      if (p?.kind === 'driver') {
        const childBrain = scriptedBrain(midTurns, midSeen)
        return driverChild('mid', driverAgent(driverOpts('mid', childBrain, makeAgent)), journal)
      }
      return worker
    }

    // The root driver's script: spawn the MID DRIVER, await it, stop.
    const rootChat = scriptedBrain(
      [
        {
          toolCalls: [
            { name: 'spawn_agent', arguments: { profile: { kind: 'driver' }, task: 'delegate' } },
          ],
        },
        { toolCalls: [{ name: 'await_event', arguments: {} }] },
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

    // The mid driver actually ran its OWN tool-loop inside its nested scope: its conversation
    // recorded the worker's settlement fed back — proof the inner agent reasoned, not scripted-bypassed.
    // The await_event tool result serializes the done worker, so its OpenAI `tool` message carries 'done'.
    expect(midSeen.length).toBeGreaterThanOrEqual(2)
    const midToolMsgs = midSeen[midSeen.length - 1]!.filter((m) => m.role === 'tool')
    expect(midToolMsgs.some((m) => String(m.content).includes('done'))).toBe(true)

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

// `list_questions` is always present (no analysts needed), has no side effects, and reserves no
// budget — the ideal benign tool for driving the loop a fixed number of turns.
const benignTurn: ScriptedTurn = { toolCalls: [{ name: 'list_questions', arguments: {} }] }
const dummyWorker = (_p: unknown): Agent<unknown, unknown> =>
  workerLeaf('w', { out: {}, tokens: { input: 0, output: 0 }, iterations: 0, score: 0 })

function bounds0Opts(name: string, brain: ToolLoopChat): DriverAgentOptions {
  return {
    name,
    brain,
    blobs: SHARED_BLOBS,
    makeWorkerAgent: dummyWorker,
    perWorker,
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

  it('runs the driver PAST the default 16-turn cap until it stops on its own', async () => {
    SHARED_BLOBS = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: SeenMessages = []
    // 20 benign turns then a no-tool-call stop: a run the old default (16) would have force-finalized.
    const turns: ScriptedTurn[] = Array.from({ length: 20 }, () => benignTurn)
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

    // 20 benign turns + 1 stop = 21 driver turns — proof maxTurns=0 blew past the old 16 cap
    // instead of force-finalizing at it.
    expect(seen.length).toBe(21)
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

    // The executor was consulted first (saw the verb name) but returned null, so the coordination
    // tool actually ran — its result (a questions list, never the string "echoed") came back.
    expect(extraSawCoordVerb).toBe(true)
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
      extraTools: [{ ...echoTool, name: 'spawn_agent' }],
      executeExtraTool: async () => 'nope',
    }
    // The collision guard fires eagerly — NOT buried in a swallowed act() throw.
    expect(() => driverAgent(opts)).toThrow(/collides with a coordination verb/)
  })
})
