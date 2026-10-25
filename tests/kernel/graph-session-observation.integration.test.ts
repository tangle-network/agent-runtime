import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentGraph,
  digestOfGraph,
  graphFromSessionFacts,
  graphFromStored,
  graphRegistry,
  listGraphRuns,
  loadGraph,
  lookupGraph,
  type ObservedSessionFacts,
  pickBestGraph,
  recordGraphRun,
  recordStoredGraphRun,
} from '@tangle-network/agent-runtime/kernel'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function openRegistry() {
  const root = await mkdtemp(join(tmpdir(), 'graph-observation-'))
  directories.push(root)
  return graphRegistry(root)
}

function fact(id: string, parent: string | null = null, input = 120): ObservedSessionFacts {
  return {
    sessionId: id,
    parentSessionId: parent,
    harness: 'claude-code',
    firstRecordAt: { value: '2026-10-24T10:00:00Z' },
    lastRecordAt: { value: '2026-10-24T10:05:00Z' },
    tokens: { input, output: 30 },
    humanTurns: { value: parent ? [] : [{ text: 'private transcript material never persisted' }] },
    typedTurnCounts: {
      value: [
        { actor: 'human', turns: parent ? 0 : 1 },
        { actor: 'fleet', turns: 2 },
      ],
    },
    agent: { value: { model: 'observed-model', harness: 'claude-code' } },
  }
}

describe('normalized session observations through the public filesystem registry', () => {
  it('persists a reusable topology, updates one source, and retains exact run usage privately', async () => {
    const registry = await openRegistry()
    const first = graphFromSessionFacts([fact('parent-a'), fact('child-a', 'parent-a')], {
      source: { kind: 'claude-code', id: 'workflow-a', url: 'traces://workflow-a' },
      taskType: 'feature',
      complete: true,
    })
    await recordStoredGraphRun(registry, first.graph, first.record)
    const second = graphFromSessionFacts([fact('child-b', 'parent-b', 420), fact('parent-b')], {
      source: { kind: 'claude-code', id: 'workflow-b' },
      taskType: 'feature',
      complete: true,
    })
    expect(second.graph.digest).toBe(first.graph.digest)
    expect(second.record.topologyDigest).toBe(first.record.topologyDigest)
    expect(second.record.cost).toMatchObject({
      inputTokens: 540,
      outputTokens: 60,
      tokens: 600,
      humanMessages: 1,
      leadMessages: 4,
    })
    await recordStoredGraphRun(registry, second.graph, second.record)
    // A running observation can grow a new node without duplicating its source run.
    const updated = graphFromSessionFacts(
      [fact('parent-a'), fact('child-a', 'parent-a'), fact('grandchild', 'child-a')],
      {
        source: first.record.source!,
        taskType: 'feature',
        complete: true,
        outcome: { kind: 'running', reason: 'the source reports live execution' },
      },
    )
    await recordStoredGraphRun(registry, updated.graph, updated.record)
    const reopened = graphRegistry(registry.root)
    const rows = await listGraphRuns(reopened)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.source?.id === 'workflow-a')?.graphDigest).toBe(
      updated.graph.digest,
    )
    expect(await loadGraph(reopened, second.graph.digest)).toEqual(second.graph)
    const bytes = await readFile(
      join(registry.root, 'graphs', `${first.graph.digest}.json`),
      'utf8',
    )
    expect(bytes).not.toContain('parent-a')
    expect(bytes).not.toContain('private transcript')
    expect(bytes).not.toContain('startedAt')
    expect(bytes).not.toContain('120')
  })

  it('retains missing child accounting as unknown and never treats last activity as completion', async () => {
    const registry = await openRegistry()
    const observed = graphFromSessionFacts([fact('parent')], {
      source: { kind: 'codex', id: 'incomplete' },
      complete: false,
      relationships: [{ sessionId: 'parent', childSessionIds: ['unread-child'] }],
    })
    await recordStoredGraphRun(registry, observed.graph, observed.record)
    const [row] = await listGraphRuns(registry)
    expect(row?.outcome.kind).toBe('unknown')
    expect(row?.finishedAt).toBeUndefined()
    expect(row?.cost).toEqual({})
    expect(row?.nodeUsage).toContainEqual({ nodeId: 'n1', sourceId: 'unread-child' })
    expect(row?.unknowns).toContain('workflow selection incomplete; total accounting unavailable')
    expect(observed.graph.budget).toBeUndefined()
    expect(observed.graph.edges).toEqual([{ kind: 'delegates', from: 'n0', to: 'n1' }])
  })

  it('keeps delivered observations out of executable replay and leaves native selection unchanged', async () => {
    const registry = await openRegistry()
    const observed = graphFromSessionFacts([fact('session')], {
      source: { kind: 'fleet', id: 'lane' },
      taskShape: { task: 'same' },
      taskType: 'bugfix',
      outcome: { kind: 'delivered' },
      finishedAt: '2026-10-24T10:10:00Z',
      evidence: [
        {
          kind: 'pr-merged',
          url: 'https://github.com/example/project/pull/1',
          at: '2026-10-24T10:08:00Z',
        },
      ],
    })
    await recordStoredGraphRun(registry, observed.graph, observed.record)
    expect(observed.record.cost.mergeMs).toBe(480_000)
    expect(() => graphFromStored(observed.graph, () => true)).toThrow(
      'observed topology cannot be replayed',
    )
    expect((await lookupGraph(registry, observed.record.taskDigest)).kind).toBe('author')
    const native: AgentGraph = {
      nodes: [{ id: 'worker', profile: { name: 'worker' } }],
      edges: [],
      budget: { maxIterations: 10, maxTokens: 10_000 },
      deliverable: { check: () => true },
    }
    const nativeRecord = {
      ...observed.record,
      graphDigest: digestOfGraph(native),
      source: undefined,
      cost: { tokens: 9000 },
    }
    await recordGraphRun(registry, native, nativeRecord)
    const replay = await lookupGraph(registry, nativeRecord.taskDigest)
    expect(replay.kind).toBe('replay')
    if (replay.kind === 'replay')
      expect(graphFromStored(replay.graph, () => true).budget).toEqual(native.budget)
    expect(
      pickBestGraph([nativeRecord, { ...nativeRecord, cost: { tokens: 2000 } }])?.cost.tokens,
    ).toBe(2000)
  })

  it('rejects false completion and corrupt graph contents before writing records', async () => {
    const registry = await openRegistry()
    const observed = graphFromSessionFacts([fact('session')], { source: { kind: 'pi', id: 'run' } })
    await expect(
      recordStoredGraphRun(registry, observed.graph, {
        ...observed.record,
        outcome: { kind: 'delivered' },
      }),
    ).rejects.toThrow('terminal outcomes require record.finishedAt')
    await expect(
      recordStoredGraphRun(registry, { ...observed.graph, nodes: [] }, observed.record),
    ).rejects.toThrow('stored graph content does not match its digest')
    expect(await listGraphRuns(registry)).toEqual([])
  })
})
