import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentGraph,
  digestOfGraph,
  type GraphSessionObservationOptions,
  graphCorpusSummary,
  graphDigest,
  graphFromStored,
  graphRegistry,
  graphRunsFor,
  listGraphRuns,
  loadGraph,
  lookupGraph,
  type ObservedSessionFacts,
  pickBestGraph,
  graphFromSessionFacts as projectSessionFacts,
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
    leadMessages: { value: 2 },
    agent: { value: { model: 'observed-model', harness: 'claude-code' } },
  }
}

// Fixture of the existing trace owner's normalized projection. This suite
// exercises design persistence and joins, not transcript parsing.
function graphFromSessionFacts(
  facts: readonly ObservedSessionFacts[],
  options: GraphSessionObservationOptions,
) {
  return projectSessionFacts(
    facts.map((entry) => ({
      ...entry,
      traceId: 'fixture-trace',
      rootSpanId: { value: `span-${entry.sessionId}` },
    })),
    {
      traceRunId: 'fixture-trace',
      spanRun: {
        present: true,
        traceIds: ['fixture-trace'],
        orphanSpans: 0,
        nodes: facts.map((entry) => ({
          traceId: 'fixture-trace',
          spanId: `span-${entry.sessionId}`,
          parentNodeId: entry.parentSessionId ? `span-${entry.parentSessionId}` : null,
          runtime: entry.harness,
        })),
      },
      ...options,
    },
  )
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
    const second = graphFromSessionFacts([fact('parent-b'), fact('child-b', 'parent-b', 420)], {
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
      spanRun: {
        present: true,
        traceIds: ['fixture-trace'],
        orphanSpans: 0,
        nodes: [
          { traceId: 'fixture-trace', spanId: 'span-parent', parentNodeId: null, runtime: 'codex' },
          {
            traceId: 'fixture-trace',
            spanId: 'span-unread-child',
            parentNodeId: 'span-parent',
            runtime: 'codex',
          },
        ],
      },
    })
    await recordStoredGraphRun(registry, observed.graph, observed.record)
    const [row] = await listGraphRuns(registry)
    expect(row?.outcome.kind).toBe('unknown')
    expect(row?.finishedAt).toBeUndefined()
    expect(row?.cost).toEqual({})
    expect(row?.nodeUsage).toContainEqual({ nodeId: 'n1' })
    expect(row?.unknowns).toContain('workflow selection incomplete; total accounting unavailable')
    expect(observed.graph.budget).toBeUndefined()
    expect(observed.graph.edges).toEqual([{ from: 'n0', to: 'n1' }])
  })

  it('keeps delivered observations out of executable replay and leaves native selection unchanged', async () => {
    const registry = await openRegistry()
    const observed = graphFromSessionFacts([fact('session')], {
      source: { kind: 'fleet', id: 'lane' },
      startedAt: '2026-10-24T10:00:00Z',
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
      traversals: 0,
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

describe('registry observational query policy and independent evidence', () => {
  it('queries and ranks assessed topology groups through the same opt-in registry policy', async () => {
    const registry = await openRegistry()
    const put = async (
      id: string,
      tree: boolean,
      kind: 'delivered' | 'no-winner' | 'running',
      ms: number,
      tokens: number,
      humans: number,
      mergeMs?: number,
    ) => {
      const observed = graphFromSessionFacts(
        tree ? [fact('root'), fact('child', 'root')] : [fact('root')],
        {
          source: { kind: 'claude-code', id },
          taskType: 'feature',
          outcome: kind === 'running' ? { kind, reason: 'still executing' } : { kind },
          ...(kind === 'running' ? {} : { finishedAt: '2026-10-24T10:10:00Z' }),
          ...(mergeMs === undefined
            ? {}
            : {
                evidence: [
                  {
                    kind: 'pr-merged',
                    url: `https://github.com/example/project/pull/${id}`,
                    at: '2026-10-24T10:08:00Z',
                  },
                ],
              }),
        },
      )
      await recordStoredGraphRun(registry, observed.graph, {
        ...observed.record,
        cost: { ms, tokens, humanMessages: humans, ...(mergeMs === undefined ? {} : { mergeMs }) },
      })
      return observed.record.topologyDigest!
    }
    const tree = await put('a1', true, 'delivered', 300, 500, 3, 400)
    await put('a2', true, 'delivered', 100, 100, 1, 200)
    await put('a3', true, 'no-winner', 200, 900, 5)
    await put('a4', true, 'running', 0, 0, 0)
    await put('b1', false, 'delivered', 5, 1, 0, 10)
    await put('b2', false, 'no-winner', 15, 2, 0)
    const content = { observed: true as const, nodes: [], edges: [], deliverable: {} }
    // A source with unknown topology uses its own content hash, never a fabricated one-node graph.
    const unknownGraph = { ...content, digest: graphDigest(content) }
    await recordStoredGraphRun(registry, unknownGraph, {
      graphDigest: unknownGraph.digest,
      taskDigest: 'unknown-task',
      startedAt: '2026-10-24T10:00:00Z',
      source: { kind: 'discovery', id: 'index-only' },
      outcome: { kind: 'unknown', reason: 'index lacks execution topology and delivery labels' },
      cost: {},
      unknowns: ['topology unavailable from run index'],
    })
    const summary = await graphCorpusSummary(registry)
    expect(summary.recordCount).toBe(7)
    expect(summary.groups[0]).toMatchObject({
      topologyDigest: tree,
      delivered: 2,
      assessed: 3,
      unknown: 1,
      deliveredRate: 2 / 3,
      medianWallMs: 200,
      wallMsCount: 3,
      medianMergeMs: 300,
      mergeMsCount: 2,
      medianTokens: 500,
      tokenCount: 3,
      medianHumanMessages: 3,
      humanMessageCount: 3,
    })
    expect(summary.groups.at(-1)).toMatchObject({
      topologyDigest: 'unknown',
      assessed: 0,
      unknown: 1,
      deliveredRate: null,
      medianWallMs: null,
    })
    const records = await listGraphRuns(registry)
    expect(pickBestGraph(records)?.source?.id).toBe('b1')
    expect(pickBestGraph(records, { policy: 'observed' })?.source?.id).toBe('a2')
    expect(
      await graphRunsFor(registry, {
        taskType: 'feature',
        topologyDigest: tree,
        sourceKind: 'claude-code',
      }),
    ).toHaveLength(4)
    expect((await graphCorpusSummary(registry, { sourceKind: 'discovery' })).recordCount).toBe(1)
  })

  it('retains independent labels on fact refresh and permits an explicit correction', async () => {
    const registry = await openRegistry()
    const source = { kind: 'fleet', id: 'one-exact-run' }
    const labeled = graphFromSessionFacts([fact('root')], {
      source,
      taskType: 'bugfix',
      outcome: { kind: 'delivered' },
      startedAt: '2026-10-24T10:00:00Z',
      finishedAt: '2026-10-24T10:10:00Z',
      evidence: [
        {
          kind: 'pr-merged',
          url: 'https://github.com/example/project/pull/7',
          at: '2026-10-24T10:08:00Z',
        },
      ],
    })
    await recordStoredGraphRun(registry, labeled.graph, labeled.record)
    const refresh = graphFromSessionFacts([fact('root', null, 900)], { source })
    await recordStoredGraphRun(registry, refresh.graph, refresh.record, { preserveLabels: true })
    const [retained] = await listGraphRuns(registry)
    expect(retained).toMatchObject({
      taskType: 'bugfix',
      outcome: { kind: 'delivered' },
      cost: { inputTokens: 900, ms: 600_000, mergeMs: 480_000 },
      evidence: labeled.record.evidence,
    })
    await expect(
      recordStoredGraphRun(
        registry,
        refresh.graph,
        { ...refresh.record, startedAt: '2026-10-24T10:01:00Z' },
        { preserveLabels: true },
      ),
    ).rejects.toThrow('same task start and source identity')
    await recordStoredGraphRun(registry, refresh.graph, refresh.record)
    expect((await listGraphRuns(registry))[0]?.outcome.kind).toBe('unknown')
  })

  it('uses canonical span parents and keeps unproven lead roles and task clocks unknown', async () => {
    const registry = await openRegistry()
    const input = {
      ...fact('root', 'unproven-parent'),
      leadMessages: undefined,
      typedTurnCounts: { value: [{ actor: 'fleet', turns: 80 }] },
    }
    const observed = graphFromSessionFacts([input], {
      source: { kind: 'claude-code', id: 'canonical-only' },
      outcome: { kind: 'delivered' },
      finishedAt: '2026-10-24T10:10:00Z',
      evidence: [
        {
          kind: 'pr-merged',
          url: 'https://github.com/example/project/pull/9',
          at: '2026-10-24T10:08:00Z',
        },
      ],
      spanRun: {
        present: true,
        traceIds: ['fixture-trace'],
        orphanSpans: 0,
        nodes: [
          {
            traceId: 'fixture-trace',
            spanId: 'span-root',
            parentNodeId: null,
            runtime: 'claude-code',
          },
        ],
      },
    })
    await recordStoredGraphRun(registry, observed.graph, observed.record)
    const [row] = await listGraphRuns(registry)
    expect(observed.graph.edges).toEqual([])
    expect(observed.graph.nodes).toHaveLength(1)
    expect(row?.traceRunId).toBe('fixture-trace')
    expect(row?.cost.leadMessages).toBeUndefined()
    expect(row?.cost.ms).toBeUndefined()
    expect(row?.cost.mergeMs).toBeUndefined()
    expect(row?.unknowns).toContain(
      'task start unconfirmed; startedAt is earliest observed activity',
    )
    expect((await graphCorpusSummary(registry)).groups[0]).toMatchObject({
      assessed: 1,
      wallMsCount: 0,
      mergeMsCount: 0,
    })
  })

  it('records generic OTLP boundaries without inventing native session identities', async () => {
    const registry = await openRegistry()
    const observed = projectSessionFacts(
      [
        {
          ...fact('fixture-root'),
          sessionId: null,
          traceId: 'trace-pi',
          rootSpanId: { value: 'root-pi' },
        },
        {
          ...fact('fixture-child', 'fixture-root'),
          sessionId: null,
          traceId: 'trace-pi',
          rootSpanId: { value: 'child-pi' },
        },
      ],
      {
        source: { kind: 'pi', id: 'generic-agent-run' },
        traceRunId: 'trace-pi',
        spanRun: {
          present: true,
          traceIds: ['trace-pi'],
          orphanSpans: 0,
          nodes: [
            { traceId: 'trace-pi', spanId: 'root-pi', parentNodeId: null, runtime: 'pi' },
            { traceId: 'trace-pi', spanId: 'child-pi', parentNodeId: 'root-pi', runtime: 'pi' },
          ],
        },
      },
    )
    await recordStoredGraphRun(registry, observed.graph, observed.record)
    const [row] = await listGraphRuns(registry)
    expect(row?.nodeUsage?.map((node) => node.sourceId)).toEqual([
      'span:["trace-pi","root-pi"]',
      'span:["trace-pi","child-pi"]',
    ])
    expect(row?.cost.tokens).toBe(300)
    expect(observed.graph.edges).toEqual([{ from: 'n0', to: 'n1' }])
    expect(row?.traversals).toBeUndefined()
  })
})
