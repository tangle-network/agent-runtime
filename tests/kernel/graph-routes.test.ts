/**
 * Flow graphs: `runGraph` with `entry` and `routes` edges runs a fixed pipeline, a branch, a
 * bounded repair loop and a stop rule from graph data. No node is a root and no caller brain runs.
 *
 * Leaves run through `RunGraphOptions.makeLeafAgent`, the executor boundary the kernel's graph
 * tests use; every leaf output is a literal JSON settle written here, in the shapes the factory's
 * stages settle (an issue-critic with `missing_inputs`, a design judge `{ choice }`, a build, a
 * verdict `{ verdict }`). The graph machinery around them is the shipped path.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Agent,
  type AgentGraph,
  type AgentSpec,
  digestOfGraph,
  type EdgeTraversal,
  type Executor,
  type ExecutorResult,
  type GateDecision,
  type GateRequest,
  type GraphEdge,
  type GraphNode,
  type GraphResult,
  GraphRouteError,
  type GraphTopology,
  graphRegistry,
  InMemorySpawnJournal,
  type MakeWorkerAgent,
  promptHandle,
  type RunGraphOptions,
  recordGraphRun,
  runGraph,
  type WorkerSpawnContext,
} from '@tangle-network/agent-runtime/kernel'
import { describe, expect, it } from 'vitest'
import { journaledGateDecider } from '../../src/runtime/supervise/graph-flow'
import { superviseForTest } from '../helpers/runtime-with-test-brain'
import { scriptedDriverBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

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
  /** Hold this leaf until the named node's leaf has started executing; a leaf that waits 5 s fails,
   *  so two branches run one after the other cannot both settle. */
  readonly awaitStart?: string
  /** The settle output, computed from this spawn's task. */
  readonly outOf?: (task: unknown) => unknown
}

/** Leaves keyed by node: spawn k of a node settles with `shots[k]` (the last one repeats). */
function leaves(
  shots: Record<string, ReadonlyArray<Shot>>,
  spawns: Spawn[],
  aborted: string[] = [],
): MakeWorkerAgent {
  const attempts = new Map<string, number>()
  const started = new Set<string>()
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
        started.add(name)
        if (shot.awaitStart !== undefined) {
          const until = Date.now() + 5_000
          while (!started.has(shot.awaitStart)) {
            if (Date.now() > until)
              throw new Error(`leaf ${name}: ${shot.awaitStart} never started`)
            await new Promise((resolve) => setTimeout(resolve, 5))
          }
        }
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
          out: shot.outOf ? shot.outOf(context?.task) : shot.out,
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
  from: Extract<GraphEdge, { kind: 'routes' }>['from'],
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

describe('flow graphs — fork and join', () => {
  const forkJoin = flow(
    ['plan', 'left', 'right', 'merge'],
    [{ node: 'plan', task: 'split the work' }],
    [routes('plan', ['left', 'right'], { evidence: ['plan'] }), routes(['left', 'right'], 'merge')],
  )

  it('runs both branches of a fork at once, and the join hands the target both results', async () => {
    const L = { side: 'left', lines: 12 }
    const R = { side: 'right', lines: 30 }
    // Each branch's leaf waits until the other has started: run one after the other, neither
    // could settle.
    const { res, spawns } = await run(forkJoin, {
      plan: [{ out: { parts: 2 } }],
      left: [{ out: L, awaitStart: 'right' }],
      right: [{ out: R, awaitStart: 'left' }],
      merge: [{ out: { merged: true } }],
    })
    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ merge: { merged: true } })
    expect(
      spawns
        .map((s) => s.node)
        .slice(1, 3)
        .sort(),
    ).toEqual(['left', 'right'])
    const keys = spawns.filter((s) => s.node !== 'merge').map((s) => s.context?.key)
    expect(keys).toEqual([
      'route:entry:plan',
      'route:routes:plan#1->left+right#1:left',
      'route:routes:plan#1->left+right#1:right',
    ])
    const merge = spawns.find((s) => s.node === 'merge')
    expect((merge?.task as { evidence?: unknown } | undefined)?.evidence).toEqual({
      left: L,
      right: R,
    })
    expect(rows(res.ledger)).toEqual([
      'routes:entry->plan delivered',
      'routes:plan#1->left+right delivered',
      'routes:plan#1->left+right delivered',
      'routes:left+right#1->merge delivered',
    ])
    expect(
      res.ledger.filter((row) => row.edge === 'routes:plan#1->left+right').map((r) => r.to),
    ).toEqual(['left', 'right'])
  })

  it('keeps the join target unspawned until its slow member settles', async () => {
    const atSlowSettle: Array<ReadonlyArray<string>> = []
    const { res, spawns } = await run(forkJoin, {
      left: [{ out: { fast: true } }],
      right: [
        { out: { slow: true }, delayMs: 150, probe: (spawned) => atSlowSettle.push(spawned) },
      ],
    })
    expect(res.result.kind).toBe('winner')
    expect(atSlowSettle).toHaveLength(1)
    expect(atSlowSettle[0]).toEqual(expect.arrayContaining(['plan', 'left', 'right']))
    expect(atSlowSettle[0]).not.toContain('merge')
    expect(spawns.map((s) => s.node).at(-1)).toBe('merge')
    expect(spawns.filter((s) => s.node === 'merge')).toHaveLength(1)
  })

  it('throws GraphRouteError target-live when two plain routes converge on a running node', async () => {
    const error = await runGraph(
      flow(
        ['a', 'b', 'c'],
        [
          { node: 'a', task: 'one' },
          { node: 'b', task: 'two' },
        ],
        [routes('a', 'c'), routes('b', 'c')],
      ),
      {
        runId: 'flow',
        makeLeafAgent: leaves(
          { a: [{ out: 1 }], b: [{ out: 2, delayMs: 20 }], c: [{ out: 3, delayMs: 30_000 }] },
          [],
        ),
      },
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GraphRouteError)
    const routeError = error as GraphRouteError
    expect(routeError.reason).toBe('target-live')
    expect(routeError.node).toBe('b')
    expect(routeError.message).toMatch(/live target/)
    expect(routeError.ledger.filter((row) => row.to === 'c')).toHaveLength(1)
  })
})

describe('flow graphs — a flow inside a maps item and a run_graph subtask', () => {
  type ItemResult = { deliverable: { verify: { item: string; passed: boolean } } }
  const itemFlow: GraphTopology = {
    nodes: [node('critic'), node('verify')],
    entry: [{ node: 'critic', task: { item: true } }],
    edges: [
      routes('critic', 'verify', { evidence: ['critic'] }),
      routes('verify', 'critic', {
        when: { pointer: '/passed', equals: false },
        maxTraversals: 1,
        evidence: ['verify'],
      }),
      routes('verify', { finish: 'verified' }),
    ],
  }
  const mapped = (item: GraphTopology, onItemFailure: 'all-or-refuse' | 'settled-subset') =>
    flow(
      ['plan', 'collect'],
      [{ node: 'plan', task: 'assign the critics' }],
      [
        {
          kind: 'maps',
          from: 'plan',
          pointer: '/assignments',
          graph: item,
          join: 'collect',
          directive: brief,
          maxItems: 5,
          concurrency: 3,
          onItemFailure,
        },
      ],
    )

  it('runs a verify-and-repair loop per item and joins three results in order', async () => {
    // The critic reads its item (the entry task) or, on a repair, the verify result it was handed.
    const criticOut = (task: unknown) =>
      typeof task === 'string'
        ? { item: task, repaired: false }
        : {
            item: (task as { from: { result: { item: string } } }).from.result.item,
            repaired: true,
          }
    const verifyOut = (task: unknown) => {
      const critic = (task as { from: { result: { item: string; repaired: boolean } } }).from.result
      return { item: critic.item, passed: critic.item !== 'b' || critic.repaired }
    }
    const { res, spawns } = await run(mapped(itemFlow, 'all-or-refuse'), {
      plan: [{ out: { assignments: ['a', 'b', 'c'] } }],
      critic: [{ outOf: criticOut }],
      verify: [{ outOf: verifyOut }],
      collect: [{ out: { collected: 3 } }],
    })
    expect(res.result.kind).toBe('winner')
    const critics = spawns.filter((s) => s.node === 'critic')
    // Three items, one repair.
    expect(critics).toHaveLength(4)
    expect(critics.filter((s) => typeof s.task !== 'string')).toHaveLength(1)
    expect(
      critics
        .filter((s) => typeof s.task === 'string')
        .map((s) => s.task)
        .sort(),
    ).toEqual(['a', 'b', 'c'])
    expect(spawns.filter((s) => s.node === 'verify')).toHaveLength(4)
    const join = spawns.find((s) => s.node === 'collect')?.task as {
      items: number
      results: Array<{ index: number; item: string; result: ItemResult }>
      failures: unknown[]
    }
    expect(join.items).toBe(3)
    expect(join.failures).toEqual([])
    expect(join.results.map((r) => [r.index, r.item, r.result.deliverable.verify])).toEqual([
      [0, 'a', { item: 'a', passed: true }],
      [1, 'b', { item: 'b', passed: true }],
      [2, 'c', { item: 'c', passed: true }],
    ])
    // Each item's flow ledgers its own routes; the outer run's ledger holds only its own.
    expect(res.ledger.filter((row) => row.kind === 'routes').map((row) => row.edge)).toEqual([
      'routes:entry->plan',
    ])
  })

  it('a down settle inside one item ends that item only; settled-subset joins the rest', async () => {
    const one: GraphTopology = {
      nodes: [node('check')],
      entry: [{ node: 'check', task: { item: true } }],
      edges: [],
    }
    const { res, spawns } = await run(mapped(one, 'settled-subset'), {
      plan: [{ out: { assignments: ['a', 'b', 'c'] } }],
      check: [
        {
          outOf: (task) => {
            if (task === 'b') throw new Error('the sandbox died')
            return { checked: task }
          },
        },
      ],
      collect: [{ out: { collected: 2 } }],
    })
    expect(res.result.kind).toBe('winner')
    expect(res.stopped).toBeUndefined()
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ collect: { collected: 2 } })
    expect(spawns.filter((s) => s.node === 'check')).toHaveLength(3)
    const join = spawns.find((s) => s.node === 'collect')?.task as {
      results: Array<{ index: number; result: { deliverable: unknown } }>
      failures: Array<{ index: number; item: unknown; outcome: string }>
    }
    expect(join.results.map((r) => [r.index, r.result.deliverable])).toEqual([
      [0, { check: { checked: 'a' } }],
      [2, { check: { checked: 'c' } }],
    ])
    expect(join.failures).toHaveLength(1)
    expect(join.failures[0]).toMatchObject({ index: 1, item: 'b', outcome: 'failed' })
  })

  // The stored form keeps `entry`, so a flow graph run by its digest runs as the inline one does.
  it.each(['inline', 'stored'] as const)(
    'runs a flow graph as a run_graph subtask (%s)',
    async (form) => {
      const spawns: Spawn[] = []
      const journal = new InMemorySpawnJournal()
      const director = testAgentProfile('director', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('run_graph'),
      })
      const graph: GraphTopology = {
        nodes: [node('draft'), node('review')],
        entry: [{ node: 'draft', task: 'write the haiku' }],
        edges: [
          { kind: 'routes', from: 'draft', to: 'review', directive: brief, evidence: ['draft'] },
        ],
      }
      let registry: string | undefined
      let source: { graph: GraphTopology } | { graphDigest: string } = { graph }
      if (form === 'stored') {
        registry = await mkdtemp(join(tmpdir(), 'rg-flow-registry-'))
        const stored: AgentGraph = { ...graph, deliverable: accept, budget }
        const graphDigest = digestOfGraph(stored)
        await recordGraphRun(graphRegistry(registry), stored, {
          graphDigest,
          taskDigest: 'haiku',
          startedAt: '2026-10-21T00:00:00.000Z',
          finishedAt: '2026-10-21T00:00:01.000Z',
          outcome: { kind: 'delivered' },
          cost: {},
          traversals: 2,
        })
        source = { graphDigest }
      }
      await superviseForTest(director, 'write a haiku through a flow graph', {
        runId: 'rg-flow',
        journal,
        ...(registry === undefined ? {} : { graphRegistry: registry }),
        budget: { maxIterations: 100, maxTokens: 200_000 },
        deliverable: { describe: 'the subtask settles', check: () => true },
        makeLeafAgent: leaves(
          { draft: [{ out: { haiku: 'old pond' } }], review: [{ out: { approved: true } }] },
          spawns,
        ),
        brain: scriptedDriverBrain([
          {
            toolCalls: [
              {
                name: 'run_graph',
                arguments: {
                  ...source,
                  deliverable: 'a reviewed haiku',
                  budget: { maxIterations: 30, maxTokens: 40_000 },
                },
              },
            ],
          },
          { content: 'waiting for the graph' },
          { content: 'done' },
        ]),
      })
      expect(spawns.map((s) => s.node)).toEqual(['draft', 'review'])
      expect(spawns[1]?.task).toEqual({
        from: { node: 'draft', result: { haiku: 'old pond' } },
        evidence: { draft: { haiku: 'old pond' } },
      })
      const events = (await journal.loadTree('rg-flow')) ?? []
      expect(
        events.find((event) => event.kind === 'settled' && event.id === 'rg-flow:s0'),
      ).toMatchObject({ status: 'done' })
      // The subtask's flow ledgers its routes under the node that drives it.
      expect(
        events.flatMap((event) =>
          event.kind === 'edge' && event.edge.kind === 'routes' ? [event.edge.to] : [],
        ),
      ).toEqual(['draft', 'review'])
      if (registry !== undefined) await rm(registry, { recursive: true, force: true })
    },
  )
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

  it('refuses an uncapped subcycle inside a component that has one capped edge', () => {
    let thrown: unknown
    try {
      void runGraph(
        flow(['a', 'b', 'c'], entryA, [
          routes('a', 'b', { maxTraversals: 2 }),
          routes('b', 'c', { when: { pointer: '/again', equals: true } }),
          routes('b', 'a', { when: { pointer: '/restart', equals: true } }),
          routes('b', { finish: 'done' }),
          routes('c', 'b'),
        ]),
        opts,
      )
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error | undefined)?.name).toBe('ValidationError')
    const message = (thrown as Error).message
    expect(message).toMatch(/routes cycle through .* sets no maxTraversals/)
    const cycle = /routes cycle through ([^(]+) \(/.exec(message)?.[1]?.split(', ')
    expect([...(cycle ?? [])].sort()).toEqual(['b', 'c'])
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

  it('refuses malformed forks and joins', () => {
    const three = ['a', 'b', 'c', 'd']
    refuses(flow(three, entryA, [routes('a', ['b'])]), /a fork with 1 node\(s\) in to/)
    refuses(flow(three, entryA, [routes('a', ['b', 'c']), routes(['b'], 'd')]), /a join with 1/)
    refuses(
      flow(three, entryA, [routes('a', ['b', 'c']), routes(['b', 'ghost'], 'd')]),
      /unknown node "ghost"/,
    )
    refuses(
      flow(three, entryA, [routes('a', ['b', 'c']), routes(['b', 'b'], 'd')]),
      /lists 'b' twice in its join/,
    )
    refuses(flow(three, entryA, [routes('a', ['b', 'b'])]), /lists 'b' twice in its fork/)
    refuses(
      flow(three, entryA, [
        routes('a', ['b', 'c']),
        routes(['b', 'c'], 'd', { when: { pointer: '/ok', equals: true } }),
      ]),
      /is a join with a when/,
    )
    refuses(
      flow(three, entryA, [
        routes('a', ['b', 'c']),
        routes('b', { stop: 'early' }, { when: { pointer: '/stop', equals: true } }),
        routes(['b', 'c'], 'd'),
      ]),
      /'b' is a member of join .* other outgoing routes edge/,
    )
  })

  it('refuses forks and joins that break reachability or the cycle rule', () => {
    // A join member that waits on the join's own target: the join can never fire.
    refuses(
      flow(['a', 'b', 'c'], entryA, [
        routes('a', 'b'),
        routes(['b', 'c'], 'c', { maxTraversals: 2 }),
      ]),
      /'c' is unreachable from entry/,
    )
    // A fork back into its own source with no cap.
    refuses(
      flow(['a', 'b'], entryA, [
        routes('a', ['a', 'b'], { when: { pointer: '/again', equals: true } }),
        routes('a', { finish: 'done' }),
      ]),
      /routes cycle through .* sets no maxTraversals/,
    )
  })

  it('refuses an invalid continuity', () => {
    refuses(
      flow(['a', 'b'], entryA, [routes('a', 'b', { continuity: 'rewind' as unknown as 'fresh' })]),
      /invalid continuity "rewind"/,
    )
  })
})

describe('flow graphs — human gates', () => {
  const review = { id: 'review', question: 'Ship this build?', choices: ['approve', 'reject'] }
  const choice = (value: string) => ({ when: { pointer: '/choice', equals: value } })
  const built = { patch: 'keep the trailing comma' }
  const gated = (
    exits: ReadonlyArray<GraphEdge>,
    into: Partial<Extract<GraphEdge, { kind: 'routes' }>> = { evidence: ['build'] },
  ): AgentGraph => ({
    ...flow(
      ['build', 'ship'],
      [{ node: 'build', task: 'build it' }],
      [routes('build', 'review', into), ...exits],
    ),
    gates: [review],
  })
  const shipOrStop = gated([
    routes('review', 'ship', choice('approve')),
    routes('review', { stop: 'rejected' }, choice('reject')),
  ])
  /** Answers each visit in turn (the last answer repeats) and records what was asked. */
  const decide = (answers: ReadonlyArray<GateDecision>, asked: GateRequest[]) => {
    return async (request: GateRequest): Promise<GateDecision> => {
      asked.push(request)
      return answers[Math.min(asked.length - 1, answers.length - 1)] as GateDecision
    }
  }
  const gateRows = (ledger: ReadonlyArray<EdgeTraversal>) =>
    ledger.filter((row) => row.gate !== undefined)
  const shots = { build: [{ out: built }], ship: [{ out: { shipped: true } }] }

  it('choose approve continues to the next node with the decision as its source', async () => {
    const asked: GateRequest[] = []
    const { res, spawns } = await run(shipOrStop, shots, {
      decideGate: decide([{ kind: 'choose', choice: 'approve', by: 'drew' }], asked),
    })
    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ ship: { shipped: true } })
    expect(asked).toEqual([
      {
        gate: 'review',
        visit: 1,
        question: 'Ship this build?',
        choices: ['approve', 'reject'],
        evidence: { build: built },
      },
    ])
    expect(spawns.map((s) => s.node)).toEqual(['build', 'ship'])
    expect(spawns[1]?.task).toEqual({
      from: { node: 'review', result: { choice: 'approve', by: 'drew' } },
      evidence: {},
    })
    expect(rows(res.ledger)).toEqual([
      'routes:entry->build delivered',
      'routes:build#1->review delivered',
      'gate:review delivered',
      'routes:review#1->ship delivered',
    ])
  })

  it('choose reject routes to { stop: rejected }', async () => {
    const { res, spawns } = await run(shipOrStop, shots, {
      decideGate: decide([{ kind: 'choose', choice: 'reject', by: 'drew' }], []),
    })
    expect(res.stopped).toEqual({
      edge: 'routes:review#2->stop:rejected',
      at: 'review',
      workerId: 'gate:review#1',
      reason: 'rejected',
    })
    expect(res.result.kind).toBe('no-winner')
    if (res.result.kind === 'no-winner') expect(res.result.reason).toBe('stopped')
    expect(spawns.map((s) => s.node)).toEqual(['build'])
  })

  it('stop ends the run with the given reason and records who stopped it', async () => {
    const { res, spawns, journal } = await run(shipOrStop, shots, {
      decideGate: decide([{ kind: 'stop', reason: 'needs legal sign-off', by: 'legal' }], []),
    })
    expect(res.stopped).toEqual({
      edge: 'gate:review',
      at: 'review',
      workerId: 'gate:review#1',
      reason: 'needs legal sign-off',
    })
    expect(res.result.kind).toBe('no-winner')
    if (res.result.kind === 'no-winner') expect(res.result.reason).toBe('stopped')
    expect(spawns.map((s) => s.node)).toEqual(['build'])
    expect(gateRows(res.ledger).map((row) => row.gate)).toEqual([
      { by: 'legal', stop: 'needs legal sign-off' },
    ])
    const events = (await journal.loadTree('flow')) ?? []
    expect(events.flatMap((e) => (e.kind === 'edge' && e.gate ? [e.gate] : []))).toEqual([
      { by: 'legal', stop: 'needs legal sign-off' },
    ])
  })

  it('asks a gate reached twice with visits 1 and 2, and ledgers one row per visit with its by', async () => {
    const asked: GateRequest[] = []
    const loop = gated([
      routes('review', 'ship', choice('approve')),
      routes('review', 'build', { ...choice('reject'), maxTraversals: 2 }),
    ])
    const { res, spawns, journal } = await run(
      loop,
      { build: [{ out: { draft: 1 } }, { out: { draft: 2 } }], ship: [{ out: { shipped: 2 } }] },
      {
        decideGate: decide(
          [
            { kind: 'choose', choice: 'reject', by: 'reviewer-a' },
            { kind: 'choose', choice: 'approve', by: 'reviewer-b' },
          ],
          asked,
        ),
      },
    )
    expect(res.result.kind).toBe('winner')
    expect(asked.map((request) => [request.visit, request.evidence])).toEqual([
      [1, { build: { draft: 1 } }],
      [2, { build: { draft: 2 } }],
    ])
    expect(spawns.map((s) => s.node)).toEqual(['build', 'build', 'ship'])
    expect(
      gateRows(res.ledger).map((row) => [row.edge, row.kind, row.traversal, row.from, row.gate]),
    ).toEqual([
      ['gate:review', 'routes', 1, 'review', { by: 'reviewer-a', choice: 'reject' }],
      ['gate:review', 'routes', 2, 'review', { by: 'reviewer-b', choice: 'approve' }],
    ])
    const events = (await journal.loadTree('flow')) ?? []
    const twins = events.flatMap((e) =>
      e.kind === 'edge' && e.gate ? [[e.edge.from, e.traversal, e.gate]] : [],
    )
    expect(twins).toEqual([
      ['review', 1, { by: 'reviewer-a', choice: 'reject' }],
      ['review', 2, { by: 'reviewer-b', choice: 'approve' }],
    ])
  })

  it('a finish leaving a gate puts the decision in the output', async () => {
    const graph = gated([
      routes('review', { finish: 'approved' }, choice('approve')),
      routes('review', { stop: 'rejected' }, choice('reject')),
    ])
    const { res } = await run(
      { ...graph, nodes: [node('build')] },
      { build: [{ out: built }] },
      { decideGate: decide([{ kind: 'choose', choice: 'approve', by: 'drew' }], []) },
    )
    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') {
      expect(res.result.out).toEqual({ review: { choice: 'approve', by: 'drew' } })
    }
  })

  // A resumed flow reaching the gate again is unit runtime-flow-durable-resume; this proves the rule
  // it relies on, over the journal a real run wrote: a journaled visit is replayed, never re-asked.
  it('replays a journaled decision without asking, and asks an undecided visit again', async () => {
    const { res, journal } = await run(shipOrStop, shots, {
      decideGate: decide([{ kind: 'choose', choice: 'approve', by: 'drew' }], []),
    })
    expect(res.result.kind).toBe('winner')
    const asked: GateRequest[] = []
    const decider = journaledGateDecider(
      decide([{ kind: 'choose', choice: 'reject', by: 'someone-else' }], asked),
      journal,
      'flow',
    )
    const request = (visit: number): GateRequest => ({
      gate: 'review',
      visit,
      question: review.question,
      choices: review.choices,
      evidence: { build: built },
    })
    expect(await decider(request(1))).toEqual({
      kind: 'choose',
      choice: 'approve',
      by: 'drew',
      replayed: true,
    })
    expect(asked).toEqual([])
    expect(await decider(request(2))).toEqual({
      kind: 'choose',
      choice: 'reject',
      by: 'someone-else',
    })
    expect(asked.map((r) => r.visit)).toEqual([2])
    const events = (await journal.loadTree('flow')) ?? []
    expect(events.filter((e) => e.kind === 'edge' && e.gate !== undefined).length).toBe(1)
  })

  it('fails the run with no decision row when decideGate answers outside the choices or throws', async () => {
    for (const decideGate of [
      async () => ({ kind: 'choose', choice: 'maybe', by: 'drew' }) as GateDecision,
      async (): Promise<GateDecision> => {
        throw new Error('approval service unavailable')
      },
    ]) {
      const { res, spawns } = await run(shipOrStop, shots, { decideGate })
      expect(res.result.kind).toBe('no-winner')
      expect(res.stopped?.reason).toMatch(/route-step-failed: .*(not one of|unavailable)/)
      expect(gateRows(res.ledger)).toEqual([])
      expect(spawns.map((s) => s.node)).toEqual(['build'])
    }
  })

  it('ends an undecided gate at the run deadline with no decision row', async () => {
    const asked: GateRequest[] = []
    const { res } = await run({ ...shipOrStop, budget: { ...budget, deadlineMs: 1_500 } }, shots, {
      decideGate: (request) => {
        asked.push(request)
        return new Promise<GateDecision>(() => undefined)
      },
    })
    expect(asked.map((request) => request.visit)).toEqual([1])
    expect(res.result.kind).toBe('no-winner')
    expect(gateRows(res.ledger)).toEqual([])
  })

  describe('refusals before compute', () => {
    const opts: RunGraphOptions = {
      makeLeafAgent: leaves({}, []),
      decideGate: async () => ({ kind: 'stop', reason: 'no', by: 'test' }),
    }
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
    const exits = [
      routes('review', 'ship', choice('approve')),
      routes('review', { stop: 'rejected' }, choice('reject')),
    ]

    it('refuses a gate id that equals a node id', () => {
      refuses({ ...gated(exits), gates: [{ ...review, id: 'ship' }] }, /also a node id/)
    })

    it('refuses a gate with fewer than two choices', () => {
      refuses(
        { ...gated([exits[0] as GraphEdge]), gates: [{ ...review, choices: ['approve'] }] },
        /at least two distinct non-empty choices/,
      )
    })

    it('refuses a leaving edge whose equals is not one of the choices', () => {
      refuses(
        gated([...exits, routes('review', { stop: 'later' }, choice('defer'))]),
        /leaves gate 'review' without matching one of its choices/,
      )
      refuses(
        gated([routes('review', 'ship'), exits[1] as GraphEdge]),
        /leaves gate 'review' without matching/,
      )
    })

    it('refuses a choice that has no leaving edge, and a choice with two', () => {
      refuses(gated([exits[0] as GraphEdge]), /no leaving edge for choice\(s\) reject/)
      refuses(
        gated([...exits, routes('review', { finish: 'twice' }, choice('approve'))]),
        /second edge for choice 'approve'/,
      )
    })

    it('refuses gates declared without decideGate, and gates without entry', () => {
      refuses(gated(exits), /graph.gates needs opts.decideGate/, { decideGate: undefined })
      const { entry: _entry, ...rooted } = gated(exits)
      refuses(rooted, /graph.gates needs graph.entry/)
    })

    it('refuses a gate used as a maps source, or in a fork or join', () => {
      refuses(
        gated([
          ...exits,
          {
            kind: 'maps',
            from: 'review',
            pointer: '/items',
            to: 'ship',
            join: 'build',
            directive: brief,
            maxItems: 4,
            concurrency: 1,
            onItemFailure: 'all-or-refuse',
          } as GraphEdge,
        ]),
        /expands gate 'review'/,
      )
      refuses(
        { ...gated(exits), edges: [routes('build', ['review', 'ship']), ...exits] },
        /lists gate 'review' in a fork/,
      )
    })

    it('refuses a gate inside a maps item graph or a run_graph subtask', () => {
      const item: GraphTopology = {
        nodes: [node('step')],
        entry: [{ node: 'step', task: { item: true } }],
        edges: [],
        gates: [review],
      }
      refuses(
        flow(
          ['lister', 'joined'],
          [{ node: 'lister', task: 'list' }],
          [
            {
              kind: 'maps',
              from: 'lister',
              pointer: '/items',
              graph: item,
              join: 'joined',
              directive: brief,
              maxItems: 4,
              concurrency: 1,
              onItemFailure: 'all-or-refuse',
            },
          ],
        ),
        /a maps item's graph or a run_graph subtask has none/,
      )
    })
  })
})
