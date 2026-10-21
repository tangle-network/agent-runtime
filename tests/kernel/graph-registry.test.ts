/**
 * The designer loop over `graph-registry`: first run authors, runs, records;
 * a later run over the SAME workspace replays the recorded graph with NO
 * authoring inference; a failing best record flips the decision to author.
 * Execution uses the injected test brain (offline), the registry is real files
 * in a temp directory standing in for the sandbox workspace.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGraph, GraphResult } from '../../src/runtime/supervise/graph'
import {
  digestOfGraph,
  graphFromStored,
  graphRegistry,
  graphRunsFor,
  listGraphRuns,
  lookupGraph,
  recordGraphRun,
  storedGraphDigests,
  taskShapeDigest,
} from '../../src/runtime/supervise/graph-registry'
import { kernelPromptRegistry, promptHandle } from '../../src/runtime/supervise/prompt-registry'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import { runGraphForTest } from '../helpers/runtime-with-test-brain'
import { scriptedDriverBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'graph-registry-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

const workerProfile = (name: string): AgentProfile =>
  testAgentProfile(name, {
    harness: 'cli-base',
    prompt: { systemPrompt: `You are ${name}.` },
    ...(name === 'root' ? { tools: runtimeToolDeclarations('spawn_worker') } : {}),
  })

function twoNodeGraph(): AgentGraph {
  const registry = kernelPromptRegistry()
  return {
    nodes: [
      { id: 'root', profile: workerProfile('root') },
      { id: 'worker', profile: workerProfile('worker') },
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'root',
        to: 'worker',
        directive: promptHandle('delegates/worker-brief/v1'),
      },
    ],
    deliverable: {
      check: (out: unknown) => out !== undefined,
      describe: 'The finished work.',
    },
    budget: { maxIterations: 10, maxTokens: 100_000 },
  }
}

/** A leaf that settles one worker successfully (the offline execution seam). */
function leafSeam(): (
  profile: typeof testAgentProfile extends (...a: never) => infer P ? P : never,
) => Agent<unknown, unknown> {
  return (profile: { name?: string }) => {
    let artifact: ExecutorResult<unknown> | undefined
    const executor: Executor<unknown> = {
      runtime: 'router',
      async execute() {
        artifact = {
          outRef: `w:${profile.name ?? 'leaf'}`,
          out: { built: profile.name ?? 'leaf' },
          verdict: { valid: true, score: 1 },
          spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
        }
        return artifact
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: () => {
        if (!artifact) throw new Error('leaf: no terminal artifact')
        return artifact
      },
    }
    const spec: AgentSpec = { profile: profile as never, harness: null, executor }
    return { name: profile.name, act: async () => undefined, executorSpec: spec } as Agent<
      unknown,
      unknown
    > & { executorSpec: AgentSpec }
  }
}

/** The brain that drives the two-node graph: spawn once, then settle. */
const solvingBrain = () =>
  scriptedDriverBrain([
    {
      toolCalls: [
        { name: 'spawn_worker', arguments: { profile: { name: 'worker' }, task: 'build it' } },
      ],
    },
    { content: 'done' },
  ])

async function runAndRecord(
  graph: AgentGraph,
  brain: () => ReturnType<typeof scriptedDriverBrain>,
  taskDigest: string,
): Promise<{ result: GraphResult; stored: Awaited<ReturnType<typeof recordGraphRun>> }> {
  const result = await runGraphForTest(graph, {
    brain: brain(),
    registry: kernelPromptRegistry(),
    makeLeafAgent: leafSeam() as never,
  })
  const delivered = result.result.kind === 'winner'
  const spent = result.result.kind === 'winner' ? result.result.spentTotal : undefined
  const stored = await recordGraphRun(graphRegistry(workspace), graph, {
    graphDigest: digestOfGraph(graph),
    taskDigest,
    startedAt: new Date(Date.now() - 5_000).toISOString(),
    finishedAt: new Date().toISOString(),
    outcome: delivered
      ? { kind: 'delivered', summary: 'winner' }
      : { kind: 'no-winner', reason: result.result.kind },
    cost: {
      ...(spent?.iterations !== undefined ? { iterations: spent.iterations } : {}),
      ...(spent?.tokens !== undefined ? { tokens: spent.tokens } : {}),
    },
    traversals: result.ledger.length,
  })
  return { result, stored }
}

describe('graph registry — the designer loop', () => {
  it('first run: no records → author; run + record persists graph and outcome', async () => {
    const task = taskShapeDigest({ kind: 'summarize', source: 'support-tickets' })
    const selection = await lookupGraph(graphRegistry(workspace), task)
    expect(selection).toMatchObject({ kind: 'author', reason: 'first run for this task shape' })

    const { result, stored } = await runAndRecord(twoNodeGraph(), solvingBrain, task)
    expect(result.result.kind).toBe('winner')

    const records = await listGraphRuns(graphRegistry(workspace))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ taskDigest: task, graphDigest: stored.digest })
    expect(await storedGraphDigests(graphRegistry(workspace))).toEqual([stored.digest])
    // The oracle is environment-owned: the stored graph carries the description, never the check.
    expect(stored.deliverable.describe).toBe('The finished work.')
    expect(
      (stored as unknown as { deliverable: { check?: unknown } }).deliverable.check,
    ).toBeUndefined()
  })

  it('second run over the same workspace: REPLAY the recorded graph with zero authoring', async () => {
    const task = taskShapeDigest({ kind: 'summarize', source: 'support-tickets' })
    await runAndRecord(twoNodeGraph(), solvingBrain, task)

    // A fresh process would do exactly this lookup — no authoring brain consulted.
    const selection = await lookupGraph(graphRegistry(workspace), task)
    expect(selection.kind).toBe('replay')
    if (selection.kind !== 'replay') throw new Error('narrow')
    expect(selection.record.outcome.kind).toBe('delivered')

    // Replay: re-bind the environment's check, run the STORED graph verbatim.
    const replayed = graphFromStored(selection.graph, (out: unknown) => out !== undefined)
    expect(replayed.nodes.map((n) => n.id)).toEqual(['root', 'worker'])
    expect(replayed.budget).toEqual(twoNodeGraph().budget)

    const result = await runGraphForTest(replayed, {
      brain: solvingBrain(),
      registry: kernelPromptRegistry(),
      makeLeafAgent: leafSeam() as never,
    })
    expect(result.result.kind).toBe('winner')

    // Record the replayed run too: the registry grows monotonically.
    await recordGraphRun(graphRegistry(workspace), replayed, {
      graphDigest: selection.graph.digest,
      taskDigest: task,
      startedAt: new Date(Date.now() - 1_000).toISOString(),
      finishedAt: new Date().toISOString(),
      outcome: { kind: 'delivered', summary: 'replayed' },
      cost: { traversals: result.ledger.length } as never,
      traversals: result.ledger.length,
    })
    const runs = await graphRunsFor(graphRegistry(workspace), task)
    expect(runs).toHaveLength(2)
    expect(runs.map((row) => row.outcome.kind)).toEqual(['delivered', 'delivered'])
  })

  it('a best record that failed to deliver flips the next decision to author (improve)', async () => {
    const task = taskShapeDigest({ kind: 'extract', source: 'pdfs' })
    const reg = graphRegistry(workspace)
    const graph = twoNodeGraph()
    const digest = digestOfGraph(graph)
    await recordGraphRun(reg, graph, {
      graphDigest: digest,
      taskDigest: task,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      outcome: { kind: 'no-winner', reason: 'budget-exhausted' },
      cost: { iterations: 10 },
      traversals: 0,
    })

    const selection = await lookupGraph(reg, task)
    expect(selection).toMatchObject({
      kind: 'author',
      reason: 'no graph delivered for this task shape yet',
    })
  })

  it('among delivered graphs, the cheaper one wins the replay slot', async () => {
    const task = taskShapeDigest({ kind: 'summarize', source: 'support-tickets' })
    const reg = graphRegistry(workspace)
    const build = (name: string): AgentGraph => {
      const graph = twoNodeGraph()
      return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, profile: workerProfile(name) })) }
    }
    const expensive = build('expensive')
    const cheap = build('cheap')
    await recordGraphRun(reg, expensive, {
      graphDigest: digestOfGraph(expensive),
      taskDigest: task,
      startedAt: new Date('2026-10-11T00:00:00Z').toISOString(),
      finishedAt: new Date('2026-10-11T00:01:00Z').toISOString(),
      outcome: { kind: 'delivered' },
      cost: { tokens: 50_000, iterations: 8 },
      traversals: 3,
    })
    await recordGraphRun(reg, cheap, {
      graphDigest: digestOfGraph(cheap),
      taskDigest: task,
      startedAt: new Date('2026-10-11T01:00:00Z').toISOString(),
      finishedAt: new Date('2026-10-11T01:01:00Z').toISOString(),
      outcome: { kind: 'delivered' },
      cost: { tokens: 5_000, iterations: 2 },
      traversals: 3,
    })

    const selection = await lookupGraph(reg, task)
    expect(selection.kind).toBe('replay')
    if (selection.kind !== 'replay') throw new Error('narrow')
    expect(selection.graph.nodes[0]?.profile.name).toBe('cheap')
  })

  it('records the graph that actually ran — a digest mismatch is refused', async () => {
    const reg = graphRegistry(workspace)
    const graph = twoNodeGraph()
    const other = twoNodeGraph()
    other.deliverable = { ...other.deliverable, describe: 'A different deliverable entirely' }
    await expect(
      recordGraphRun(reg, graph, {
        graphDigest: digestOfGraph(other),
        taskDigest: 't',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: { kind: 'delivered' },
        cost: {},
        traversals: 0,
      }),
    ).rejects.toThrow(/does not match the supplied graph/)
  })
})
