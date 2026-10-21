/**
 * Flow graphs resumed from their journal: `runGraph` with `resume: true` over the journal and blob
 * store a prior run wrote, cut where a killed process would have left it.
 *
 * A join's target task must not depend on which member settled last, because a resumed run replays
 * committed members in the walker's order, not the live one; and a routes edge that spawns a node
 * again names that node's settled worker as `successorOf`, live and on resume.
 *
 * Leaves run through `RunGraphOptions.makeLeafAgent`; everything around them is the shipped path.
 */

import {
  type Agent,
  type AgentGraph,
  type AgentSpec,
  type Executor,
  type ExecutorResult,
  type GraphEdge,
  type GraphResult,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type MakeWorkerAgent,
  promptHandle,
  runGraph,
  type SpawnEvent,
  type WorkerSpawnContext,
} from '@tangle-network/agent-runtime/kernel'
import { describe, expect, it } from 'vitest'

const brief = promptHandle('delegates/worker-brief/v1')
const RUN_ID = 'flow-resume'

interface Leaf {
  /** The settle output, from this spawn's task. */
  readonly out: (task: unknown) => unknown
  readonly delayMs?: number
}

interface Spawned {
  readonly node: string
  readonly context: WorkerSpawnContext | undefined
}

/** Offline leaves: `spawned` records every agent built, `executed` every leaf that ran. */
function leaves(script: Record<string, Leaf>, spawned: Spawned[], executed: string[]) {
  const make: MakeWorkerAgent = (profile, context) => {
    const name = profile.name ?? 'leaf'
    spawned.push({ node: name, context })
    const leaf = script[name] as Leaf
    let artifact: ExecutorResult<unknown> | undefined
    const executor: Executor<unknown> = {
      runtime: 'router',
      async execute() {
        executed.push(name)
        if (leaf.delayMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, leaf.delayMs))
        }
        artifact = {
          outRef: `w:${name}:${executed.length}`,
          out: leaf.out(context?.task),
          verdict: { valid: true, score: 1 },
          spent: { iterations: 1, tokens: { input: 5, output: 7 }, usd: 0, ms: 0 },
        }
        return artifact
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: () => {
        if (!artifact) throw new Error(`leaf ${name}: no terminal artifact`)
        return artifact
      },
    }
    const spec: AgentSpec = { profile, harness: null, executor }
    return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
  return make
}

function flow(
  nodes: ReadonlyArray<string>,
  entry: AgentGraph['entry'],
  edges: ReadonlyArray<GraphEdge>,
): AgentGraph {
  return {
    nodes: nodes.map((id) => ({
      id,
      profile: {
        name: id,
        harness: 'cli-base',
        model: { provider: 'offline', default: `offline/${id}` },
        prompt: { systemPrompt: `You are ${id}.` },
      },
    })),
    entry,
    edges,
    deliverable: { describe: 'the flow output', check: () => true },
    budget: { maxIterations: 200, maxTokens: 1_000_000 },
  }
}

const routes = (
  from: Extract<GraphEdge, { kind: 'routes' }>['from'],
  to: Extract<GraphEdge, { kind: 'routes' }>['to'],
  extra: Partial<Extract<GraphEdge, { kind: 'routes' }>> = {},
): GraphEdge => ({ kind: 'routes', from, to, directive: brief, ...extra })

interface Run {
  readonly res: GraphResult
  readonly spawned: Spawned[]
  readonly executed: string[]
  readonly events: SpawnEvent[]
}

async function run(
  graph: AgentGraph,
  script: Record<string, Leaf>,
  stores: { journal: InMemorySpawnJournal; blobs: InMemoryResultBlobStore },
  resume = false,
): Promise<Run> {
  const spawned: Spawned[] = []
  const executed: string[] = []
  const res = await runGraph(graph, {
    runId: RUN_ID,
    ...stores,
    ...(resume ? { resume: true } : {}),
    makeLeafAgent: leaves(script, spawned, executed),
  })
  return { res, spawned, executed, events: (await stores.journal.loadTree(RUN_ID)) ?? [] }
}

/** The journal a process killed right after `cut` was appended would leave on disk. */
async function killedAt(
  events: ReadonlyArray<SpawnEvent>,
  cut: (event: SpawnEvent) => boolean,
): Promise<InMemorySpawnJournal> {
  const at = events.findIndex(cut)
  if (at < 0) throw new Error('the cut event is not in the journal')
  const journal = new InMemorySpawnJournal()
  await journal.beginTree(RUN_ID, new Date(0).toISOString())
  for (const event of events.slice(0, at + 1)) await journal.appendEvent(RUN_ID, event)
  return journal
}

const spawnedRows = (events: ReadonlyArray<SpawnEvent>, label: string) =>
  events.filter(
    (event): event is Extract<SpawnEvent, { kind: 'spawned' }> =>
      event.kind === 'spawned' && event.label === label,
  )
const settledDone = (id: string) => (event: SpawnEvent) =>
  event.kind === 'settled' && event.id === id && event.status === 'done'
const refusals = (res: GraphResult) =>
  res.ledger.filter((row) => row.outcome !== 'delivered').map((row) => row.reason)

/** Deterministic shuffle, so a failing resume names the order that broke it. */
function shuffled<T>(items: ReadonlyArray<T>, seed: number): T[] {
  const out = [...items]
  let state = seed
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

describe('flow graphs — a join resumed from its journal', () => {
  const members = ['critic-a', 'critic-b'] as const
  const joinGraph = flow(
    [...members, 'merge'],
    members.map((node) => ({ node, task: `review as ${node}` })),
    [routes([...members], 'merge')],
  )
  // Each member settles after a delay from its place in a shuffled order, so across resumes the
  // member that completed the join live is sometimes the one the walker replays last and
  // sometimes not.
  const script = (order: ReadonlyArray<string>): Record<string, Leaf> => ({
    ...Object.fromEntries(
      order.map((node, i) => [node, { out: () => ({ critic: node }), delayMs: 5 + 25 * i }]),
    ),
    merge: { out: (task) => ({ merged: (task as { evidence: unknown }).evidence }) },
  })
  const mergeOut = {
    merge: { merged: { 'critic-a': { critic: 'critic-a' }, 'critic-b': { critic: 'critic-b' } } },
  }

  it('hands the target every member in declared order, whichever settled last', async () => {
    for (const order of [members, [...members].reverse()]) {
      const live = await run(joinGraph, script(order), {
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
      })
      expect(live.res.result.kind).toBe('winner')
      expect(live.spawned.find((s) => s.node === 'merge')?.context?.task).toEqual({
        from: { nodes: ['critic-a', 'critic-b'] },
        evidence: { 'critic-a': { critic: 'critic-a' }, 'critic-b': { critic: 'critic-b' } },
      })
    }
  })

  it('comes back committed over 20 resumes whose members settled in shuffled order', async () => {
    const lastLive = new Set<string>()
    for (let seed = 1; seed <= 20; seed += 1) {
      const order = shuffled(members, seed)
      const blobs = new InMemoryResultBlobStore()
      const live = await run(joinGraph, script(order), {
        journal: new InMemorySpawnJournal(),
        blobs,
      })
      expect(live.res.result.kind, `seed ${seed}`).toBe('winner')
      const memberOf = new Map(
        members.map((m) => [spawnedRows(live.events, m)[0]?.id as string, m] as const),
      )
      const memberSettles = live.events.filter(
        (event) => event.kind === 'settled' && memberOf.has(event.id),
      )
      lastLive.add(memberOf.get(memberSettles.at(-1)?.id as string) as string)

      const merge = spawnedRows(live.events, 'merge')[0]?.id as string
      const journal = await killedAt(live.events, settledDone(merge))
      const resumed = await run(joinGraph, script(order), { journal, blobs }, true)

      expect(refusals(resumed.res), `seed ${seed}`).toEqual([])
      expect(resumed.res.result.kind, `seed ${seed}`).toBe('winner')
      if (resumed.res.result.kind === 'winner') expect(resumed.res.result.out).toEqual(mergeOut)
      // Every step was committed at the kill: the resume replays it and runs nothing.
      expect(resumed.executed, `seed ${seed}`).toEqual([])
      expect(spawnedRows(resumed.events, 'merge').map((row) => row.id)).toEqual([merge])
    }
    // Both members completed the join live in some run, so both replay orders were exercised.
    expect([...lastLive].sort()).toEqual([...members])
  })

  it('runs a target that was spawned but never settled once, under its own key', async () => {
    const blobs = new InMemoryResultBlobStore()
    const live = await run(joinGraph, script([...members].reverse()), {
      journal: new InMemorySpawnJournal(),
      blobs,
    })
    const merge = spawnedRows(live.events, 'merge')[0]
    const journal = await killedAt(live.events, (event) => event === merge)
    const resumed = await run(joinGraph, script([...members].reverse()), { journal, blobs }, true)
    expect(refusals(resumed.res)).toEqual([])
    expect(resumed.res.result.kind).toBe('winner')
    if (resumed.res.result.kind === 'winner') expect(resumed.res.result.out).toEqual(mergeOut)
    expect(resumed.executed).toEqual(['merge'])
  })
})

describe('flow graphs — a repair loop names its predecessor', () => {
  // critic → verify → critic, capped at two repairs: verify asks for another draft until the third.
  const repairGraph = flow(
    ['critic', 'verify'],
    [{ node: 'critic', task: 'draft the critique' }],
    [
      routes('critic', 'verify'),
      routes('verify', 'critic', {
        when: { pointer: '/verdict', equals: 'concerns' },
        maxTraversals: 2,
      }),
      routes('verify', { finish: 'sound' }),
    ],
  )
  type Task = { from?: { result?: { draft?: number; round?: number } } }
  const script: Record<string, Leaf> = {
    critic: { out: (task) => ({ draft: ((task as Task).from?.result?.round ?? 0) + 1 }) },
    verify: {
      out: (task) => {
        const draft = (task as Task).from?.result?.draft ?? 0
        return { verdict: draft < 3 ? 'concerns' : 'sound', round: draft }
      },
    },
  }

  it('journals and hands each critic spawn its predecessor, and a resume replays the row', async () => {
    const blobs = new InMemoryResultBlobStore()
    const live = await run(repairGraph, script, { journal: new InMemorySpawnJournal(), blobs })
    expect(live.res.result.kind).toBe('winner')
    if (live.res.result.kind === 'winner') {
      expect(live.res.result.out).toEqual({ verify: { verdict: 'sound', round: 3 } })
    }
    const critics = spawnedRows(live.events, 'critic')
    const ids = critics.map((row) => row.id)
    expect(ids).toHaveLength(3)
    // The journal row and the executor seam name the latest settled critic; the first names none.
    expect(critics.map((row) => row.successorOf)).toEqual([undefined, ids[0], ids[1]])
    expect(
      live.spawned.filter((s) => s.node === 'critic').map((s) => s.context?.successorOf),
    ).toEqual([undefined, ids[0], ids[1]])
    // Every re-spawned node names its own latest settled worker, verify included.
    const verifies = spawnedRows(live.events, 'verify').map((row) => row.id)
    expect(spawnedRows(live.events, 'verify').map((row) => row.successorOf)).toEqual([
      undefined,
      verifies[0],
      verifies[1],
    ])

    // Killed right after the second critic settled: its row replays, and the third critic, which
    // runs in the new process, still names the second.
    const journal = await killedAt(live.events, settledDone(ids[1] as string))
    const resumed = await run(repairGraph, script, { journal, blobs }, true)
    expect(refusals(resumed.res)).toEqual([])
    expect(resumed.res.result.kind).toBe('winner')
    if (resumed.res.result.kind === 'winner') {
      expect(resumed.res.result.out).toEqual({ verify: { verdict: 'sound', round: 3 } })
    }
    expect(resumed.executed).toEqual(['verify', 'critic', 'verify'])
    const after = spawnedRows(resumed.events, 'critic')
    expect(after.slice(0, 2)).toEqual(critics.slice(0, 2))
    expect(after.map((row) => row.successorOf)).toEqual([undefined, ids[0], ids[1]])
    expect(
      resumed.spawned.filter((s) => s.node === 'critic').map((s) => s.context?.successorOf),
    ).toEqual([undefined, ids[0], ids[1]])
  })
})
