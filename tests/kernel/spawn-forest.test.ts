import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  aggregateProviderModelEvidence,
  contentAddress,
  FileResultBlobStore,
  FileSpawnJournal,
  InMemorySpawnJournal,
  materializeTreeView,
} from '../../src/durable/spawn-journal'
import { loadSpawnForest } from '../../src/runtime'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { nestedDriverTreeRoot } from '../../src/runtime/supervise/tree-key'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  NodeSnapshot,
  Scope,
  SpawnEvent,
  SpawnForest,
  SpawnForestNode,
  SpawnJournal,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

const rootBudget = { maxIterations: 10, maxTokens: 10_000 }
const childBudget = { maxIterations: 4, maxTokens: 1_000 }

function leaf(
  name: string,
  out: unknown,
  runtime: Executor<unknown>['runtime'] = 'forest-leaf',
): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime,
    execute(): AsyncIterable<UsageEvent> {
      return (async function* () {
        yield { kind: 'tokens', input: 3, output: 2 }
        yield { kind: 'iteration' }
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      return {
        outRef: contentAddress(out),
        out,
        verdict: { valid: true, score: 1 },
        spent: { iterations: 1, tokens: { input: 3, output: 2 }, usd: 0, ms: 0 },
      }
    },
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

async function onlyDone(scope: Scope<unknown>): Promise<unknown> {
  const settled = await scope.next()
  if (settled?.kind !== 'done') throw new Error('expected one completed child')
  return settled.out
}

describe('loadSpawnForest', () => {
  it('cold-loads every node and event from a file-backed root → driver → leaf run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spawn-forest-complete-'))
    try {
      const journalPath = join(dir, 'spawn-journal.jsonl')
      const journal = new FileSpawnJournal(journalPath)
      const blobs = new FileResultBlobStore(join(dir, 'blobs'))
      const nested: Agent<unknown, unknown> = {
        name: 'nested',
        async act(task, scope) {
          const spawned = scope.spawn(leaf('leaf', { answer: 42 }), task, {
            budget: childBudget,
            label: 'leaf',
          })
          if (!spawned.ok) throw new Error(spawned.reason)
          return onlyDone(scope)
        },
      }
      const root: Agent<unknown, unknown> = {
        name: 'root',
        async act(task, scope) {
          const spawned = scope.spawn(
            driverChild(testAgentProfile('nested'), nested, journal),
            task,
            {
              budget: childBudget,
              label: 'nested',
            },
          )
          if (!spawned.ok) throw new Error(spawned.reason)
          return onlyDone(scope)
        },
      }

      const result = await createSupervisor<unknown, unknown>().run(root, 'solve', {
        budget: rootBudget,
        runId: 'forest-complete',
        journal,
        blobs,
        executors: withDriverExecutor(createExecutorRegistry()),
        maxDepth: 4,
      })
      expect(result.kind).toBe('winner')

      const forest = await loadSpawnForest(new FileSpawnJournal(journalPath), 'forest-complete')
      expect(forest.trees).toHaveLength(2)
      expect(forest.nodes.map((node) => node.label).sort()).toEqual(['leaf', 'nested', 'root'])
      expect(forest.nodes.find((node) => node.label === 'nested')?.ownedTreeRoot).toBe(
        nestedDriverTreeRoot('forest-complete', 'forest-complete:s0'),
      )
      expect(forest.events.length).toBeGreaterThan(forest.nodes.length)
      expect(new Set(forest.events.map((entry) => entry.treeRoot))).toEqual(
        new Set(forest.trees.map((tree) => tree.root)),
      )
      expect(forest.inDoubt).toEqual([])
      expect(forest.missingTrees).toEqual([])
      expect(Object.isFrozen(forest)).toBe(true)
      expect(Object.isFrozen(forest.nodes[0])).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('supplies the parent-owned root only while materializing a nested journal view', async () => {
    const journal = new InMemorySpawnJournal()
    const root = 'forest-owned-root'
    const owner = `${root}:s0`
    const nestedRoot = nestedDriverTreeRoot(root, owner)
    const leafId = `${owner}:s0`
    const at = new Date(0).toISOString()
    const turnSpend = {
      iterations: 0,
      tokens: { input: 5, output: 2 },
      usd: 0,
      ms: 1,
    }
    const leafSpend = {
      iterations: 1,
      tokens: { input: 3, output: 1 },
      usd: 0,
      ms: 1,
    }

    await journal.beginTree(root, at)
    await journal.appendEvent(root, {
      kind: 'spawned',
      id: root,
      label: 'root',
      budget: rootBudget,
      runtime: 'inline',
      seq: 0,
      at,
    })
    await journal.appendEvent(root, {
      kind: 'spawned',
      id: owner,
      parent: root,
      label: 'nested-owner',
      budget: childBudget,
      runtime: 'driver',
      ownedTreeRoot: nestedRoot,
      seq: 0,
      at,
    })
    await journal.appendEvent(root, {
      kind: 'settled',
      id: owner,
      status: 'done',
      outRef: 'sha256:owner',
      spent: leafSpend,
      seq: 0,
      at,
    })

    await journal.beginTree(nestedRoot, at)
    await journal.appendEvent(nestedRoot, {
      kind: 'metered',
      id: owner,
      spend: turnSpend,
      providerModel: providerEvidence([['deepseek-v4-flash@fp_a']]),
      seq: 0,
      at,
    })
    await journal.appendEvent(nestedRoot, {
      kind: 'spawned',
      id: leafId,
      parent: owner,
      label: 'nested-leaf',
      budget: childBudget,
      runtime: 'forest-leaf',
      seq: 0,
      at,
    })
    await journal.appendEvent(nestedRoot, {
      kind: 'settled',
      id: leafId,
      status: 'done',
      outRef: 'sha256:leaf',
      spent: leafSpend,
      providerModel: providerEvidence([['deepseek-v4-flash@fp_a']]),
      seq: 0,
      at,
    })

    const rawNested = await journal.loadTree(nestedRoot)
    expect(() => materializeTreeView(rawNested ?? [])).toThrow(
      `spawn journal corrupted: settle/cancel for node '${owner}' with no prior spawn`,
    )

    const forest = await loadSpawnForest(journal, root)
    const nested = forest.trees.find((tree) => tree.root === nestedRoot)
    expect(nested?.view.root).toBe(owner)
    expect(nested?.view.nodes.map((node) => node.id)).toEqual([owner, leafId])
    expect(nested?.view.nodes.find((node) => node.id === owner)?.spent).toMatchObject(turnSpend)
    expect(forest.nodes.map((node) => node.id)).toEqual([root, owner, leafId])
    expect(
      forest.events.some(
        ({ treeRoot, event }) =>
          treeRoot === nestedRoot && event.kind === 'spawned' && event.id === owner,
      ),
    ).toBe(false)
  })

  it('reports pending workers and an unopened driver subtree from a cold lost-work snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spawn-forest-lost-'))
    try {
      const journalPath = join(dir, 'spawn-journal.jsonl')
      const journal: SpawnJournal = new FileSpawnJournal(journalPath)
      const at = new Date(0).toISOString()
      await journal.beginTree('forest-lost', at)
      await journal.appendEvent('forest-lost', {
        kind: 'spawned',
        id: 'forest-lost',
        label: 'root',
        budget: rootBudget,
        runtime: 'inline',
        seq: 0,
        at,
      })
      await journal.appendEvent('forest-lost', {
        kind: 'spawned',
        id: 'forest-lost:s0',
        parent: 'forest-lost',
        label: 'started-driver',
        budget: childBudget,
        runtime: 'driver',
        ownedTreeRoot: nestedDriverTreeRoot('forest-lost', 'forest-lost:s0'),
        seq: 0,
        at,
      })
      await journal.appendEvent('forest-lost', {
        kind: 'spawned',
        id: 'forest-lost:s1',
        parent: 'forest-lost',
        label: 'unopened-driver',
        budget: childBudget,
        runtime: 'driver',
        ownedTreeRoot: nestedDriverTreeRoot('forest-lost', 'forest-lost:s1'),
        seq: 1,
        at,
      })
      const nestedRoot = nestedDriverTreeRoot('forest-lost', 'forest-lost:s0')
      await journal.beginTree(nestedRoot, at)
      await journal.appendEvent(nestedRoot, {
        kind: 'spawned',
        id: 'forest-lost:s0:s0',
        parent: 'forest-lost:s0',
        label: 'lost-leaf',
        budget: childBudget,
        runtime: 'forest-leaf',
        seq: 0,
        at,
      })

      const forest = await loadSpawnForest(new FileSpawnJournal(journalPath), 'forest-lost')
      expect(forest.trees).toHaveLength(2)
      expect(forest.nodes.map((node) => [node.label, node.status])).toEqual(
        expect.arrayContaining([
          ['started-driver', 'pending'],
          ['unopened-driver', 'pending'],
          ['lost-leaf', 'pending'],
        ]),
      )
      expect(forest.inDoubt.map((node) => node.label).sort()).toEqual([
        'lost-leaf',
        'started-driver',
        'unopened-driver',
      ])
      expect(forest.missingTrees).toEqual([
        expect.objectContaining({ ownerNodeId: 'forest-lost:s1' }),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not infer tree ownership from a caller leaf whose open runtime string is driver', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spawn-forest-byo-driver-'))
    try {
      const journalPath = join(dir, 'spawn-journal.jsonl')
      const journal = new FileSpawnJournal(journalPath)
      const blobs = new FileResultBlobStore(join(dir, 'blobs'))
      const root: Agent<unknown, unknown> = {
        name: 'root',
        async act(task, scope) {
          const spawned = scope.spawn(
            leaf('caller-leaf-named-driver', { answer: 7 }, 'driver'),
            task,
            {
              budget: childBudget,
              label: 'caller-leaf-named-driver',
            },
          )
          if (!spawned.ok) throw new Error(spawned.reason)
          return onlyDone(scope)
        },
      }

      const result = await createSupervisor<unknown, unknown>().run(root, 'solve', {
        budget: rootBudget,
        runId: 'forest-byo-driver',
        journal,
        blobs,
        executors: createExecutorRegistry(),
      })
      expect(result.kind).toBe('winner')

      // A pre-field journal may also contain a convention-shaped tree. Absence of the trusted
      // ownership field is authoritative: the cold reader must neither scan nor adopt it.
      const at = new Date(0).toISOString()
      const decoyRoot = nestedDriverTreeRoot('forest-byo-driver', 'forest-byo-driver:s0')
      await journal.beginTree(decoyRoot, at)
      await journal.appendEvent(decoyRoot, {
        kind: 'spawned',
        id: 'decoy:s0',
        parent: 'forest-byo-driver:s0',
        label: 'must-not-be-followed',
        budget: childBudget,
        runtime: 'forest-leaf',
        seq: 0,
        at,
      })

      const forest = await loadSpawnForest(new FileSpawnJournal(journalPath), 'forest-byo-driver')
      expect(forest.trees.map((tree) => tree.root)).toEqual(['forest-byo-driver'])
      expect(forest.nodes.map((node) => node.label)).toEqual(['root', 'caller-leaf-named-driver'])
      expect(forest.missingTrees).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function providerEvidence(
  attempts: ReadonlyArray<ReadonlyArray<string>>,
  models: ReadonlyArray<string> = [...new Set(attempts.flat())],
): NodeSnapshot['providerModel'] {
  return {
    status: 'known',
    attempts: attempts.map((observations) => ({ observations })),
    models,
  }
}

function forestNode(
  treeRoot: string,
  id: string,
  providerModel?: NodeSnapshot['providerModel'],
  ownedTreeRoot?: string,
): SpawnForestNode {
  return {
    treeRoot,
    id,
    label: id,
    status: 'done',
    runtime: 'forest-leaf',
    budget: childBudget,
    spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
    ...(providerModel === undefined ? {} : { providerModel }),
    ...(ownedTreeRoot === undefined ? {} : { ownedTreeRoot }),
  }
}

function forestFixture(
  trees: ReadonlyArray<{
    root: string
    ownerNodeId?: string
    parentTreeRoot?: string
    events: ReadonlyArray<SpawnEvent>
  }>,
  nodes: ReadonlyArray<SpawnForestNode>,
  extra: Partial<Pick<SpawnForest, 'inDoubt' | 'missingTrees'>> = {},
): SpawnForest {
  return {
    root: trees[0]?.root ?? 'forest',
    trees: trees.map((tree) => ({
      ...tree,
      view: { root: tree.root, nodes: [], inFlight: 0, waiting: 0 },
    })),
    nodes,
    events: [],
    inDoubt: extra.inDoubt ?? [],
    missingTrees: extra.missingTrees ?? [],
  }
}

function metered(treeRoot: string, providerModel?: unknown): SpawnEvent {
  return {
    kind: 'metered',
    id: treeRoot,
    spend: { iterations: 1, tokens: { input: 2, output: 1 }, usd: 0, ms: 0 },
    seq: 0,
    at: new Date(0).toISOString(),
    ...(providerModel === undefined ? {} : { providerModel }),
  } as unknown as SpawnEvent
}

function settled(_treeRoot: string, id: string, providerModel?: unknown): SpawnEvent {
  return {
    kind: 'settled',
    id,
    status: 'done',
    outRef: 'sha256:forest',
    spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
    seq: 1,
    at: new Date(0).toISOString(),
    ...(providerModel === undefined ? {} : { providerModel }),
  } as unknown as SpawnEvent
}

describe('aggregateProviderModelEvidence', () => {
  it('flattens owned trees, includes metered and leaf attempts, and skips driver summaries', () => {
    const root = 'forest-evidence'
    const nested = `${root}/driver:s0`
    const served = 'tangle-router/deepseek-v4-flash@fp_a'
    const wrongPlan = {
      status: 'known',
      id: 'declared-plan-alias',
    }
    const forest = forestFixture(
      [
        {
          root,
          events: [
            metered(root, providerEvidence([[served]])),
            settled(root, `${root}:s0`, providerEvidence([['wrong-model@fp_wrong']])),
          ],
        },
        {
          root: nested,
          ownerNodeId: `${root}:s0`,
          parentTreeRoot: root,
          events: [
            metered(nested, providerEvidence([['deepseek-v4-flash', served]])),
            settled(nested, `${root}:s0:s0`, providerEvidence([[served]])),
          ],
        },
      ],
      [
        forestNode(root, root),
        forestNode(root, `${root}:s0`, undefined, nested),
        {
          ...forestNode(nested, `${root}:s0:s0`, providerEvidence([[served]])),
          materialization: { model: wrongPlan } as unknown as NodeSnapshot['materialization'],
        },
      ],
    )

    const result = aggregateProviderModelEvidence(forest)
    expect(result).toEqual({
      status: 'known',
      attempts: [
        { observations: [served] },
        { observations: ['deepseek-v4-flash', served] },
        { observations: [served] },
      ],
      models: [served, 'deepseek-v4-flash'],
    })
  })

  it('canonicalizes a bare observation only when the same attempt has a qualified snapshot', () => {
    const model = 'deepseek-v4-flash@fp_a'
    const root = 'forest-canonical'
    const result = aggregateProviderModelEvidence(
      forestFixture(
        [
          {
            root,
            events: [
              metered(root, providerEvidence([['deepseek-v4-flash', `tangle-router/${model}`]])),
            ],
          },
        ],
        [forestNode(root, root)],
      ),
    )
    expect(result.status).toBe('known')

    const bareOnly = aggregateProviderModelEvidence(
      forestFixture(
        [
          {
            root: `${root}-bare`,
            events: [metered(`${root}-bare`, providerEvidence([['deepseek-v4-flash']]))],
          },
        ],
        [forestNode(`${root}-bare`, `${root}-bare`)],
      ),
    )
    expect(bareOnly).toMatchObject({ status: 'unknown', reason: 'provider-model-missing' })
  })

  it('refuses missing, mixed, in-doubt, and paid-but-unidentified evidence', () => {
    const root = 'forest-invalid'
    const known = providerEvidence([['deepseek-v4-flash@fp_a']])
    const cases: ReadonlyArray<[string, SpawnForest]> = [
      [
        'legacy metered event',
        forestFixture([{ root, events: [metered(root)] }], [forestNode(root, root)]),
      ],
      [
        'legacy leaf settlement',
        forestFixture(
          [{ root, events: [settled(root, `${root}:s0`)] }],
          [forestNode(root, root), forestNode(root, `${root}:s0`)],
        ),
      ],
      [
        'mixed served models',
        forestFixture(
          [
            {
              root,
              events: [metered(root, known), metered(root, providerEvidence([['other@fp_b']]))],
            },
          ],
          [forestNode(root, root)],
        ),
      ],
      [
        'positive spend without identity',
        forestFixture(
          [
            {
              root,
              events: [
                metered(root, {
                  status: 'unknown',
                  attempts: [[]],
                  models: [],
                  reason: 'provider-model-missing',
                }),
              ],
            },
          ],
          [forestNode(root, root)],
        ),
      ],
      [
        'in-doubt node',
        forestFixture([{ root, events: [metered(root, known)] }], [forestNode(root, root)], {
          inDoubt: [
            { treeRoot: root, nodeId: `${root}:s0`, label: 'lost', runtime: 'forest-leaf' },
          ],
        }),
      ],
      [
        'missing owned tree',
        forestFixture([{ root, events: [metered(root, known)] }], [forestNode(root, root)], {
          missingTrees: [
            { parentTreeRoot: root, ownerNodeId: `${root}:s0`, root: `${root}/driver:s0` },
          ],
        }),
      ],
    ]
    for (const [label, forest] of cases) {
      expect(aggregateProviderModelEvidence(forest), label).toMatchObject({ status: 'unknown' })
    }
  })

  it('treats absent legacy evidence as unknown', () => {
    const root = 'forest-legacy'
    const noEvidence = aggregateProviderModelEvidence(
      forestFixture(
        [{ root, events: [settled(root, `${root}:s0`)] }],
        [forestNode(root, root), forestNode(root, `${root}:s0`)],
      ),
    )
    expect(noEvidence).toMatchObject({ status: 'unknown', reason: 'provider-model-missing' })
  })
})
