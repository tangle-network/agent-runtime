import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  contentAddress,
  FileResultBlobStore,
  FileSpawnJournal,
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
  Scope,
  SpawnJournal,
  UsageEvent,
} from '../../src/runtime/supervise/types'

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
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor }
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
          const spawned = scope.spawn(driverChild('nested', nested, journal), task, {
            budget: childBudget,
            label: 'nested',
          })
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
