/**
 * Flow graphs: `runGraph` with `entry` and `routes` edges runs a fixed pipeline, a branch, a
 * bounded repair loop and a stop rule from graph data. No node is a root and no caller brain runs.
 *
 * Leaves run through `RunGraphOptions.makeLeafAgent`, the executor boundary the kernel's graph
 * tests use; every leaf output is a literal JSON settle written here, in the shapes the factory's
 * stages settle (an issue-critic with `missing_inputs`, a design judge `{ choice }`, a build, a
 * verdict `{ verdict }`). The graph machinery around them is the shipped path.
 */

import {
  type Agent,
  type AgentGraph,
  type AgentSpec,
  type EdgeTraversal,
  type Executor,
  type ExecutorResult,
  type GraphEdge,
  type GraphNode,
  type GraphResult,
  GraphRouteError,
  InMemorySpawnJournal,
  type MakeWorkerAgent,
  promptHandle,
  type RunGraphOptions,
  runGraph,
  type WorkerSpawnContext,
} from '@tangle-network/agent-runtime/kernel'
import { describe, expect, it } from 'vitest'

const brief = promptHandle('delegates/worker-brief/v1')
const LEAF_TOKENS = { input: 5, output: 7 }

function node(id: string): GraphNode {
  return {
    id,
    profile: {
      name: id,
      harness: 'cli-base',
      model: { provider: 'offline', default: `offline/${id}` },
      prompt: { systemPrompt: `You are ${id}.` },
    },
  }
}

interface Spawn {
  readonly node: string
  readonly task: unknown
  readonly context: WorkerSpawnContext | undefined
  readonly instructions: ReadonlyArray<string>
}

interface Shot {
  readonly out?: unknown
  readonly fail?: string
  readonly delayMs?: number
  readonly valid?: boolean
  /** Called as the leaf settles, with the nodes spawned so far. */
  readonly probe?: (spawned: ReadonlyArray<string>) => void
}

/** Leaves keyed by node: spawn k of a node settles with `shots[k]` (the last one repeats). */
function leaves(
  shots: Record<string, ReadonlyArray<Shot>>,
  spawns: Spawn[],
  aborted: string[] = [],
): MakeWorkerAgent {
  const attempts = new Map<string, number>()
  return (profile, context) => {
    const name = profile.name ?? 'leaf'
    const attempt = (attempts.get(name) ?? 0) + 1
    attempts.set(name, attempt)
    spawns.push({
      node: name,
      task: context?.task,
      context,
      instructions: (profile.prompt?.instructions as ReadonlyArray<string> | undefined) ?? [],
    })
    const script = shots[name] ?? [{ out: { built: name } }]
    const shot = script[Math.min(attempt - 1, script.length - 1)] as Shot
    let artifact: ExecutorResult<unknown> | undefined
    const executor: Executor<unknown> = {
      runtime: 'router',
      async execute(_task, signal) {
        if (shot.delayMs !== undefined) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, shot.delayMs)
            signal.addEventListener('abort', () => {
              clearTimeout(timer)
              resolve()
            })
          })
        }
        if (signal.aborted) {
          aborted.push(name)
          throw new Error(`leaf ${name}: aborted`)
        }
        shot.probe?.(spawns.map((spawn) => spawn.node))
        if (shot.fail !== undefined) throw new Error(shot.fail)
        artifact = {
          outRef: `w:${name}:${attempt}`,
          out: shot.out,
          verdict: { valid: shot.valid ?? true, score: 1 },
          spent: { iterations: 1, tokens: LEAF_TOKENS, usd: 0, ms: 0 },
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
}

const accept = { describe: 'the flow output', check: () => true }
const budget = { maxIterations: 200, maxTokens: 1_000_000 }

function flow(
  nodes: ReadonlyArray<string>,
  entry: AgentGraph['entry'],
  edges: ReadonlyArray<GraphEdge>,
  deliverable: AgentGraph['deliverable'] = accept,
): AgentGraph {
  return { nodes: nodes.map(node), entry, edges, deliverable, budget }
}

const routes = (
  from: string,
  to: Extract<GraphEdge, { kind: 'routes' }>['to'],
  extra: Partial<Extract<GraphEdge, { kind: 'routes' }>> = {},
): GraphEdge => ({ kind: 'routes', from, to, directive: brief, ...extra })

async function run(
  graph: AgentGraph,
  shots: Record<string, ReadonlyArray<Shot>>,
  extra: Partial<RunGraphOptions> = {},
): Promise<{ res: GraphResult; spawns: Spawn[]; journal: InMemorySpawnJournal }> {
  const spawns: Spawn[] = []
  const journal = new InMemorySpawnJournal()
  const res = await runGraph(graph, {
    runId: 'flow',
    journal,
    makeLeafAgent: leaves(shots, spawns),
    ...extra,
  })
  return { res, spawns, journal }
}

const rows = (ledger: ReadonlyArray<EdgeTraversal>) =>
  ledger.map((row) => `${row.edge} ${row.outcome}${row.reason ? ` (${row.reason})` : ''}`)

describe('flow graphs — sequence', () => {
  it('runs A → B → C with no root model call and hands each stage its exact evidence', async () => {
    const A = { file: 'src/parse.ts', defect: 'drops a trailing comma' }
    const B = { patch: 'keep the trailing comma', test: 'parse.trailing-comma' }
    const C = { verdict: 'sound' }
    const { res, spawns, journal } = await run(
      flow(
        ['A', 'B', 'C'],
        [{ node: 'A', task: 'locate the bug' }],
        [routes('A', 'B', { evidence: ['A'] }), routes('B', 'C', { evidence: ['B'] })],
      ),
      { A: [{ out: A }], B: [{ out: B }], C: [{ out: C }] },
    )
    expect(res.result.kind).toBe('winner')
    if (res.result.kind !== 'winner') return
    expect(res.result.out).toEqual({ C })
    expect(spawns.map((s) => s.node)).toEqual(['A', 'B', 'C'])
    expect(spawns[0]?.task).toBe('locate the bug')
    expect(spawns[1]?.task).toEqual({ from: { node: 'A', result: A }, evidence: { A } })
    // The edge directive rides the target's pinned instructions on each traversal.
    expect(spawns[1]?.instructions.length).toBe(1)
    expect(rows(res.ledger)).toEqual([
      'routes:entry->A delivered',
      'routes:A#1->B delivered',
      'routes:B#1->C delivered',
    ])
    expect(res.ledger.map((row) => row.kind)).toEqual(['routes', 'routes', 'routes'])
    // No root model call: the run's spend is exactly the three leaves' spend.
    const tokens = res.result.spentTotal.tokens
    expect(tokens.input + tokens.output).toBe(3 * (LEAF_TOKENS.input + LEAF_TOKENS.output))
    const events = (await journal.loadTree('flow')) ?? []
    expect(events.some((e) => e.kind === 'metered')).toBe(false)
    expect(events.flatMap((e) => (e.kind === 'edge' ? [e.edge.kind] : []))).toEqual([
      'routes',
      'routes',
      'routes',
    ])
  })

  it('runs a 10-stage fixed pipeline with no root turn budget and no root model call', async () => {
    const stages = Array.from({ length: 10 }, (_, i) => `s${i + 1}`)
    const { res, spawns, journal } = await run(
      flow(
        stages,
        [{ node: 's1', task: 'stage 1' }],
        stages.slice(1).map((to, i) => routes(stages[i] as string, to)),
      ),
      Object.fromEntries(stages.map((id) => [id, [{ out: { stage: id } }]])),
    )
    expect(res.result.kind).toBe('winner')
    expect(spawns.map((s) => s.node)).toEqual(stages)
    expect(res.ledger.every((row) => row.outcome === 'delivered')).toBe(true)
    expect(res.ledger.length).toBe(10)
    // Zero root model calls: no metered root turn, and the spend is the ten leaves' spend only.
    const events = (await journal.loadTree('flow')) ?? []
    expect(events.some((e) => e.kind === 'metered')).toBe(false)
    if (res.result.kind !== 'winner') return
    expect(res.result.out).toEqual({ s10: { stage: 's10' } })
    const tokens = res.result.spentTotal.tokens
    expect(tokens.input + tokens.output).toBe(10 * (LEAF_TOKENS.input + LEAF_TOKENS.output))
  })
})

describe('flow graphs — root metering', () => {
  // The flow root's turns reach no provider, so none is metered. A dollar-capped pool refuses
  // unknown spend; a metered no-usage root turn would end the run before its entry settled.
  it('wins under a dollar-capped budget: the flow root meters no turn', async () => {
    const { res, journal } = await run(
      {
        ...flow(['a', 'b'], [{ node: 'a', task: 'go' }], [routes('a', 'b')]),
        budget: { ...budget, maxUsd: 1 },
      },
      { a: [{ out: { a: 1 } }], b: [{ out: { b: 2 } }] },
    )
    expect(res.result.kind).toBe('winner')
    const events = (await journal.loadTree('flow')) ?? []
    expect(events.some((e) => e.kind === 'metered')).toBe(false)
  })
})

describe('flow graphs — branch, repair and stop', () => {
  it('spawns only the branch a design judge chose', async () => {
    const { res, spawns } = await run(
      flow(
        ['judge', 'reuse', 'redesign'],
        [{ node: 'judge', task: 'pick a design' }],
        [
          routes('judge', 'reuse', { when: { pointer: '/choice', equals: 'design-reuse' } }),
          routes('judge', 'redesign', { when: { pointer: '/choice', equals: 'design-redesign' } }),
        ],
      ),
      { judge: [{ out: { choice: 'design-reuse', rationale: 'changes the least' } }] },
    )
    expect(res.result.kind).toBe('winner')
    expect(spawns.map((s) => s.node)).toEqual(['judge', 'reuse'])
    expect(res.ledger.filter((row) => row.to === 'redesign')).toHaveLength(0)
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ reuse: { built: 'reuse' } })
  })

  const repair = (review: Partial<Extract<GraphEdge, { kind: 'routes' }>>, fallback: boolean) =>
    flow(
      ['build', 'review'],
      [{ node: 'build', task: 'build the change' }],
      [
        routes('build', 'review', { evidence: ['build'] }),
        routes('review', 'build', {
          when: { pointer: '/verdict', equals: 'concerns' },
          evidence: ['review'],
          continuity: 'resume',
          ...review,
        }),
        ...(fallback ? [routes('review', { stop: 'repair-exhausted' })] : []),
      ],
    )

  it('repairs until the verdict is sound, resuming the build session each time', async () => {
    const { res, spawns } = await run(
      flow(
        ['build', 'review'],
        [{ node: 'build', task: 'build the change' }],
        [
          routes('build', 'review', { evidence: ['build'] }),
          routes('review', 'build', {
            when: { pointer: '/verdict', equals: 'concerns' },
            evidence: ['review'],
            continuity: 'resume',
            maxTraversals: 4,
          }),
          routes('review', { finish: 'sound' }),
        ],
      ),
      {
        build: [{ out: { diff: 'v1' } }, { out: { diff: 'v2' } }, { out: { diff: 'v3' } }],
        review: [
          { out: { verdict: 'concerns', concerns: ['no test'] } },
          { out: { verdict: 'concerns', concerns: ['flaky test'] } },
          { out: { verdict: 'sound' } },
        ],
      },
    )
    const builds = spawns.filter((s) => s.node === 'build')
    expect(builds.map((s) => s.context?.continuity)).toEqual(['fresh', 'resume', 'resume'])
    expect(builds[1]?.task).toEqual({
      from: { node: 'review', result: { verdict: 'concerns', concerns: ['no test'] } },
      evidence: { review: { verdict: 'concerns', concerns: ['no test'] } },
    })
    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner')
      expect(res.result.out).toEqual({ review: { verdict: 'sound' } })
    expect(res.ledger.filter((row) => row.to === 'build').map((row) => row.continuity)).toEqual([
      'fresh',
      'resume',
      'resume',
    ])
    expect(res.ledger.at(-1)?.edge).toBe('routes:review#2->finish:sound')
  })

  it('stops with the fallback edge once the repair cap is spent', async () => {
    const { res, spawns } = await run(repair({ maxTraversals: 1 }, true), {
      review: [{ out: { verdict: 'concerns' } }],
    })
    expect(spawns.filter((s) => s.node === 'build')).toHaveLength(2)
    expect(res.stopped?.reason).toBe('repair-exhausted')
    expect(res.stopped?.edge).toBe('routes:review#2->stop:repair-exhausted')
    expect(res.result.kind).toBe('no-winner')
    if (res.result.kind === 'no-winner') expect(res.result.reason).toBe('stopped')
    expect(rows(res.ledger)).toContain(
      'routes:review#1->build unpropagated (traversal-cap-exhausted (max 1))',
    )
    expect(res.exhaustedEdges).toEqual(['routes:review#1->build'])
  })

  it('throws GraphRouteError when the cap is spent and no edge is left to match', async () => {
    const spawns: Spawn[] = []
    const error = await runGraph(repair({ maxTraversals: 1 }, false), {
      runId: 'flow',
      makeLeafAgent: leaves({ review: [{ out: { verdict: 'concerns' } }] }, spawns),
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GraphRouteError)
    const routeError = error as GraphRouteError
    expect(routeError.node).toBe('review')
    expect(routeError.workerId).toMatch(/./)
    expect(routeError.ledger.length).toBeGreaterThan(0)
    expect(routeError.result.kind).toBe('no-winner')
  })

  it('stops for missing inputs an issue critic reports, and spawns nothing after it', async () => {
    const critic = {
      verdict: 'concerns',
      outcome: 'The hook path is configured and proven by one commit.',
      acceptance_command: 'pnpm test',
      missing_inputs: ['the repository whose husky hooksPath is broken'],
    }
    const { res, spawns } = await run(
      flow(
        ['critic', 'design'],
        [{ node: 'critic', task: 'judge the issue' }],
        [
          routes(
            'critic',
            { stop: 'needs-input' },
            {
              when: { pointer: '/missing_inputs/0', exists: true },
            },
          ),
          routes('critic', 'design', { evidence: ['critic'] }),
        ],
      ),
      { critic: [{ out: critic }] },
    )
    expect(res.stopped).toEqual({
      edge: 'routes:critic#1->stop:needs-input',
      at: 'critic',
      workerId: expect.any(String),
      reason: 'needs-input',
    })
    expect(spawns.map((s) => s.node)).toEqual(['critic'])
    expect(res.result.kind).toBe('no-winner')
  })
})

describe('flow graphs — start, entries, matches and failures', () => {
  it('wins with a single slow entry: the start hook spawns it before the first root turn', async () => {
    const { res } = await run(flow(['slow'], [{ node: 'slow', task: 'take your time' }], []), {
      slow: [{ out: { done: true }, delayMs: 300 }],
    })
    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ slow: { done: true } })
  })

  it('runs three entries with no edges once each and outputs all three results', async () => {
    const { res, spawns } = await run(
      flow(
        ['a', 'b', 'c'],
        [
          { node: 'a', task: 'one' },
          { node: 'b', task: 'two' },
          { node: 'c', task: 'three' },
        ],
        [],
      ),
      { a: [{ out: 1 }], b: [{ out: 2 }], c: [{ out: 3 }] },
    )
    expect(spawns.map((s) => s.node).sort()).toEqual(['a', 'b', 'c'])
    expect(spawns.map((s) => s.context?.key).sort()).toEqual([
      'route:entry:a',
      'route:entry:b',
      'route:entry:c',
    ])
    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('starts several entries at once', async () => {
    const seenAtSettle: Array<ReadonlyArray<string>> = []
    const probe = (spawned: ReadonlyArray<string>) => seenAtSettle.push(spawned)
    const { res } = await run(
      flow(
        ['left', 'right'],
        [
          { node: 'left', task: 'l' },
          { node: 'right', task: 'r' },
        ],
        [],
      ),
      {
        left: [{ out: 'L', delayMs: 40, probe }],
        right: [{ out: 'R', delayMs: 40, probe }],
      },
    )
    expect(res.result.kind).toBe('winner')
    // Both were running before either settled.
    expect(seenAtSettle.map((spawned) => spawned.length)).toEqual([2, 2])
  })

  it('fires an all match across a node and its evidence, and finishes otherwise', async () => {
    const graph = flow(
      ['triage', 'build', 'fix'],
      [{ node: 'triage', task: 'triage' }],
      [
        routes('triage', 'build', { evidence: ['triage'] }),
        routes('build', 'fix', {
          evidence: ['triage'],
          when: {
            all: [
              { pointer: '/compiles', equals: false },
              { node: 'triage', pointer: '/kind', in: ['bug', 'regression'] },
            ],
          },
        }),
        routes('build', { finish: 'built' }),
      ],
    )
    const matched = await run(graph, {
      triage: [{ out: { kind: 'bug' } }],
      build: [{ out: { compiles: false } }],
    })
    expect(matched.spawns.map((s) => s.node)).toEqual(['triage', 'build', 'fix'])
    expect(matched.spawns[2]?.task).toEqual({
      from: { node: 'build', result: { compiles: false } },
      evidence: { triage: { kind: 'bug' } },
    })
    const finished = await run(graph, {
      triage: [{ out: { kind: 'feature' } }],
      build: [{ out: { compiles: false } }],
    })
    expect(finished.spawns.map((s) => s.node)).toEqual(['triage', 'build'])
    expect(finished.res.result.kind).toBe('winner')
    if (finished.res.result.kind === 'winner') {
      expect(finished.res.result.out).toEqual({ build: { compiles: false } })
    }
  })

  it('ends the run as all-children-down when a flow leaf settles down', async () => {
    const { res, spawns } = await run(
      flow(['a', 'b'], [{ node: 'a', task: 'go' }], [routes('a', 'b')]),
      { a: [{ fail: 'the sandbox died' }] },
    )
    expect(spawns.map((s) => s.node)).toEqual(['a'])
    expect(res.result.kind).toBe('no-winner')
    if (res.result.kind === 'no-winner') expect(res.result.reason).toBe('all-children-down')
    expect(res.stopped?.at).toBe('a')
    expect(res.stopped?.edge).toBeUndefined()
    expect(res.stopped?.reason).toMatch(/^down: /)
  })

  it('aborts a live sibling entry when a flow leaf settles down', async () => {
    const spawns: Spawn[] = []
    const aborted: string[] = []
    const started = Date.now()
    const res = await runGraph(
      flow(
        ['a', 'b', 'slow'],
        [
          { node: 'a', task: 'go' },
          { node: 'slow', task: 'keep going' },
        ],
        [routes('a', 'b')],
      ),
      {
        runId: 'flow',
        makeLeafAgent: leaves(
          {
            a: [{ fail: 'the sandbox died', delayMs: 20 }],
            slow: [{ out: { late: true }, delayMs: 30_000 }],
          },
          spawns,
          aborted,
        ),
      },
    )
    expect(spawns.map((s) => s.node).sort()).toEqual(['a', 'slow'])
    expect(res.result.kind).toBe('no-winner')
    if (res.result.kind === 'no-winner') expect(res.result.reason).toBe('all-children-down')
    expect(res.stopped?.at).toBe('a')
    // The run ended at the down settle: the sibling was aborted, not awaited.
    expect(aborted).toEqual(['slow'])
    expect(Date.now() - started).toBeLessThan(15_000)
  })

  it('ends the run like a down settle when a routed node settles without a usable result', async () => {
    const { res, spawns } = await run(
      flow(['a', 'b'], [{ node: 'a', task: 'go' }], [routes('a', 'b')]),
      { a: [{ out: { partial: true }, valid: false }] },
    )
    expect(spawns.map((s) => s.node)).toEqual(['a'])
    expect(res.result.kind).toBe('no-winner')
    if (res.result.kind === 'no-winner') expect(res.result.reason).toBe('all-children-down')
    expect(res.stopped?.at).toBe('a')
    expect(res.stopped?.edge).toBeUndefined()
    expect(res.stopped?.reason).toMatch(/^unusable: /)
  })

  it('runs a maps edge inside a flow, and routes its join', async () => {
    const { res, spawns } = await run(
      {
        ...flow(
          ['find', 'check', 'merge'],
          [{ node: 'find', task: 'find files' }],
          [
            {
              kind: 'maps',
              from: 'find',
              pointer: '/files',
              to: 'check',
              join: 'merge',
              directive: brief,
              maxItems: 5,
              concurrency: 2,
              onItemFailure: 'settled-subset',
            },
            routes('merge', { finish: 'merged' }),
          ],
        ),
      },
      {
        find: [{ out: { files: ['a.ts', 'b.ts'] } }],
        check: [{ out: { ok: true } }],
        merge: [{ out: { merged: 2 } }],
      },
    )
    expect(spawns.map((s) => s.node)).toEqual(['find', 'check', 'check', 'merge'])
    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ merge: { merged: 2 } })
  })
})

describe('flow graphs — refusals before compute', () => {
  const opts: RunGraphOptions = { makeLeafAgent: leaves({}, []) }
  const refuses = (graph: AgentGraph, message: RegExp, extra: Partial<RunGraphOptions> = {}) => {
    let thrown: unknown
    try {
      void runGraph(graph, { ...opts, ...extra })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error | undefined)?.name).toBe('ValidationError')
    expect((thrown as Error).message).toMatch(message)
  }
  const entryA: AgentGraph['entry'] = [{ node: 'a', task: 'go' }]

  it('refuses entry with a delegates edge', () => {
    refuses(
      flow(['a', 'b'], entryA, [{ kind: 'delegates', from: 'a', to: 'b', directive: brief }]),
      /no root to delegate/,
    )
  })

  it('refuses a routes edge without entry', () => {
    refuses(
      { nodes: [node('a'), node('b')], edges: [routes('a', 'b')], deliverable: accept, budget },
      /only a flow graph runs/,
    )
  })

  it('refuses an analyzes edge in a flow graph', () => {
    refuses(
      flow(['a', 'b'], entryA, [
        routes('a', 'b'),
        { kind: 'analyzes', analyst: 'b', over: ['a'], to: 'a', directive: brief },
      ]),
      /has no root/,
    )
  })

  it('refuses brain or driverBackend together with entry', () => {
    refuses(flow(['a'], entryA, []), /brain with graph.entry/, {
      brain: async () => ({ toolCalls: [] }),
    })
    refuses(flow(['a'], entryA, []), /driverBackend with graph.entry/, {
      driverBackend: { kind: 'bridge' } as unknown as RunGraphOptions['driverBackend'],
    })
  })

  it('refuses root-manager options a flow root has no reader for', () => {
    refuses(flow(['a'], entryA, []), /finalizer with graph.entry/, {
      finalizer: () => 'mine',
    })
    refuses(flow(['a'], entryA, []), /maxTurns with graph.entry/, { maxTurns: 4 })
    refuses(flow(['a'], entryA, []), /compaction with graph.entry/, {
      compaction: {} as RunGraphOptions['compaction'],
    })
  })

  it('refuses an empty entry', () => {
    refuses(flow(['a'], [], []), /graph.entry must name at least one node/)
  })

  it('refuses unknown nodes in entry, routes, when.node and evidence', () => {
    refuses(flow(['a'], [{ node: 'ghost', task: 1 }], []), /graph.entry\[0\].*'ghost'|"ghost"/)
    refuses(flow(['a'], entryA, [routes('a', 'ghost')]), /unknown node "ghost"/)
    refuses(flow(['a'], entryA, [routes('ghost', 'a')]), /unknown node "ghost"/)
    refuses(
      flow(['a', 'b'], entryA, [
        routes('a', 'b', { when: { node: 'ghost', pointer: '/x', exists: true } }),
      ]),
      /when.node references unknown node "ghost"/,
    )
    refuses(
      flow(['a', 'b'], entryA, [routes('a', 'b', { evidence: ['ghost'] })]),
      /evidence references unknown node "ghost"/,
    )
  })

  it('refuses a when.node that is not in the edge evidence', () => {
    refuses(
      flow(['a', 'b', 'c'], entryA, [
        routes('a', 'b'),
        routes('b', 'c', { when: { node: 'a', pointer: '/x', exists: true } }),
        routes('b', { finish: 'done' }),
      ]),
      /not in its evidence/,
    )
  })

  it('refuses two default edges from one node, and a default edge that is not last', () => {
    refuses(
      flow(['a', 'b', 'c'], entryA, [routes('a', 'b'), routes('a', 'c')]),
      /2 default routes edges/,
    )
    refuses(
      flow(['a', 'b', 'c'], entryA, [
        routes('a', 'b'),
        routes('a', 'c', { when: { pointer: '/x', exists: true } }),
      ]),
      /not the last edge/,
    )
  })

  it('refuses a routes cycle, self-loops included, in which no edge sets maxTraversals', () => {
    refuses(
      flow(['a', 'b'], entryA, [
        routes('a', 'b'),
        routes('b', 'a', { when: { pointer: '/again', equals: true } }),
        routes('b', { finish: 'done' }),
      ]),
      /routes cycle through .* sets no maxTraversals/,
    )
    refuses(
      flow(['a'], entryA, [
        routes('a', 'a', { when: { pointer: '/again', equals: true } }),
        routes('a', { finish: 'done' }),
      ]),
      /routes cycle through a /,
    )
  })

  it('refuses evidence that cannot settle before the edge source', () => {
    refuses(
      flow(['a', 'b', 'c'], entryA, [routes('a', 'b', { evidence: ['c'] }), routes('b', 'c')]),
      /evidence 'c', which cannot settle before 'a'/,
    )
  })

  it('refuses a node unreachable from entry', () => {
    refuses(flow(['a', 'b', 'island'], entryA, [routes('a', 'b')]), /'island' is unreachable/)
  })

  it('refuses an invalid continuity', () => {
    refuses(
      flow(['a', 'b'], entryA, [routes('a', 'b', { continuity: 'rewind' as unknown as 'fresh' })]),
      /invalid continuity "rewind"/,
    )
  })
})
