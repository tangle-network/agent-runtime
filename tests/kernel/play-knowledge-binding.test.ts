import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson } from '@tangle-network/agent-eval'
import { createQmdSearchProvider } from '@tangle-network/agent-knowledge'
import {
  type AgentMemoryAdapter,
  type AgentMemoryBranchSnapshot,
  type AgentMemoryWriteInput,
  createAgentMemoryBranch,
  defaultGetMemoryContext,
  forkAgentMemoryBranchSnapshot,
  type PlayMemoryRetrievalReceipt,
} from '@tangle-network/agent-knowledge/memory'
import { describe, expect, it } from 'vitest'
import { createPlayKnowledgeResolver } from '../../examples/play-knowledge/runtime-tools'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import type {
  DriveHarness,
  SupervisorNodeContext,
} from '../../src/runtime/supervise/supervisor-agent'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const budget = { maxIterations: 40, maxTokens: 100_000 }
const run = { runId: 'retained-play', namespace: 'commissioned:retained-play:v1' }
const source = {
  uri: 'fixture://approved/buffer.md',
  text: 'Retained fixture: the buffer bound depends on the cumulative deficit.',
}
const sourceSha256 = createHash('sha256').update(source.text).digest('hex')

// This boundary is an explicit local stand-in for remote storage, not a Hindsight service.
// Fresh adapter objects share only persisted rows, so branch rebind cannot rely on its old closure.
function memoryStore(rows: Map<string, AgentMemoryWriteInput>): AgentMemoryAdapter {
  const adapter: AgentMemoryAdapter = {
    id: 'memory-fixture',
    branchIsolation: { mode: 'scoped' },
    async search(_query, options) {
      return [...rows.values()]
        .filter((row) => canonicalJson(row.scope) === canonicalJson(options?.scope))
        .map((row) => ({
          id: row.id!,
          uri: `fixture://memory/${row.id}`,
          kind: row.kind,
          text: row.text,
        }))
    },
    getContext: (query, options) => defaultGetMemoryContext(adapter, query, options),
    async write(input) {
      rows.set(canonicalJson([input.scope, input.id]), structuredClone(input))
      return {
        accepted: true,
        id: input.id!,
        uri: `fixture://memory/${input.id}`,
        kind: input.kind,
      }
    },
  }
  return adapter
}

function retrieval(scopeId = run.namespace, body = source.text) {
  const qmdPath = 'qmd://approved/buffer.md'
  return createQmdSearchProvider({
    scopeId,
    revision: 'fixture-v1',
    collection: 'approved',
    documents: [
      {
        qmdPath,
        source: {
          id: 'buffer-source',
          uri: source.uri,
          contentHash: sourceSha256,
          createdAt: '2026-10-04T00:00:00.000Z',
        },
      },
    ],
    client: {
      searchLex: async () => [{ filepath: qmdPath, score: 1 }],
      get: async () => ({ filepath: qmdPath, collectionName: 'approved', body }),
    },
  })
}

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  })
  expect(response.ok).toBe(true)
  const value = (await response.json()) as { error?: unknown; result: T }
  expect(value.error).toBeUndefined()
  return value.result
}

async function call(url: string, name: string, args: unknown = {}): Promise<unknown> {
  const result = await rpc<{ isError?: boolean; structuredContent?: unknown }>(url, 'tools/call', {
    name,
    arguments: args,
  })
  expect(result.isError, JSON.stringify(result)).not.toBe(true)
  return result.structuredContent
}

function checkedHarness(harness: DriveHarness, failures: unknown[]): DriveHarness {
  return async (input) => {
    try {
      return await harness(input)
    } catch (error) {
      failures.push(error)
      throw error
    }
  }
}

function branch(rows: Map<string, AgentMemoryWriteInput>, snapshot?: AgentMemoryBranchSnapshot) {
  return createAgentMemoryBranch({
    adapter: memoryStore(rows),
    branchId: 'play-branch-v1',
    baseScope: snapshot?.baseScope ?? { namespace: run.namespace },
    policy: { read: ['shared'], write: 'shared' },
    lifetime: 'resumable',
    ...(snapshot ? { snapshot } : {}),
  })
}

describe('explicit per-play Knowledge binding over the real Runtime MCP path', () => {
  it('shares accepted knowledge with a director and nonspawning descendant under exact grants', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-play-knowledge-'))
    const memory = branch(new Map())
    const contexts: SupervisorNodeContext[] = []
    const driverFailures: unknown[] = []
    const toolSets = new Map<string, string[]>()
    const receipts: PlayMemoryRetrievalReceipt[] = []
    const checkpointPath = join(dir, 'memory-checkpoint.json')
    const resolver = await createPlayKnowledgeResolver({
      run,
      branch: memory,
      qmd: retrieval(),
      onCheckpoint: async (snapshot) => writeFile(checkpointPath, JSON.stringify(snapshot)),
      recordRetrieval: (receipt) => {
        receipts.push(receipt)
      },
    })
    const child = testAgentProfile('director', {
      tools: runtimeToolDeclarations('spawn_worker', 'memory_recall', 'qmd_search'),
    })
    const grandchild = testAgentProfile('nonspawning-worker', {
      tools: {
        ...runtimeToolDeclarations('memory_record', 'qmd_read'),
        agent_runtime_coordination_spawn_worker: false,
        agent_runtime_coordination_qmd_search: false,
      },
    })
    // A manager that spawns returns from its drive; Runtime drives it again when its worker settles.
    const driven = new Set<string>()
    const wokenManagers: string[] = []
    const driveHarness: DriveHarness = async ({ profile, coordinationMcpUrl: url }) => {
      const woken = driven.has(profile.name!)
      driven.add(profile.name!)
      if (woken) wokenManagers.push(profile.name!)
      const listed = await rpc<{ tools: Array<{ name: string }> }>(url, 'tools/list', {})
      toolSets.set(
        profile.name!,
        listed.tools.map((tool: { name: string }) => tool.name),
      )
      if (profile.name === 'root') {
        if (!woken) {
          await call(url, 'memory_record', {
            id: 'root-finding',
            kind: 'fact',
            text: 'prior result from root',
            sourceRefs: [source.uri],
          })
          await call(url, 'spawn_worker', {
            profile: child,
            task: 'consult the retained result',
            key: 'director',
          })
          return
        }
        expect(
          JSON.stringify(await call(url, 'memory_recall', { question: 'prior result' })),
        ).toContain('prior result from descendant')
      } else if (profile.name === 'director') {
        if (woken) return
        expect(
          JSON.stringify(await call(url, 'memory_recall', { question: 'prior result' })),
        ).toContain('prior result from root')
        expect(await call(url, 'qmd_search', { query: 'buffer bound' })).toMatchObject({
          scopeId: run.namespace,
          hits: [{ source: { uri: source.uri, contentHash: sourceSha256 } }],
        })
        await call(url, 'spawn_worker', {
          profile: grandchild,
          task: 'read the exact source',
          key: 'reader',
        })
      } else {
        expect(await call(url, 'qmd_read', { sourceId: 'buffer-source' })).toMatchObject({
          document: {
            text: `1: ${source.text}`,
            source: { uri: source.uri, contentHash: sourceSha256 },
          },
        })
        await call(url, 'memory_record', {
          id: 'child-finding',
          kind: 'observation',
          text: 'prior result from descendant',
          sourceRefs: [source.uri],
        })
      }
    }
    try {
      await supervise(
        testAgentProfile('root', {
          tools: runtimeToolDeclarations('spawn_worker', 'memory_record', 'memory_recall'),
        }),
        'Use only the commissioned sources.',
        {
          budget,
          runDir: dir,
          runId: run.runId,
          inheritSpawnRights: false,
          runContext: { ...createFileRunContext(dir, { withDriver: true }), ...run },
          driveHarness: checkedHarness(driveHarness, driverFailures),
          driverRetry: { enabled: false },
          makeLeafAgent: () => {
            throw new Error('Every fixture child explicitly declares managed tools')
          },
          resolveSupervisorTools: (context) => {
            contexts.push(context)
            return resolver(context)
          },
        },
      )
      expect(driverFailures).toEqual([])
      expect(wokenManagers.sort()).toEqual(['director', 'root'])
      expect(toolSets.get('nonspawning-worker')).toEqual(['memory_record', 'qmd_read'])
      expect(toolSets.get('director')).not.toContain('memory_record')
      expect(toolSets.get('root')).not.toContain('qmd_search')
      expect(contexts.map((context) => context.depth).sort()).toEqual([0, 1, 2])
      expect(new Set(contexts.map((context) => context.runNamespace))).toEqual(
        new Set([run.namespace]),
      )
      expect(new Set(contexts.map((context) => context.nodeId)).size).toBe(3)
      const checkpoint = JSON.parse(
        await readFile(checkpointPath, 'utf8'),
      ) as AgentMemoryBranchSnapshot
      expect(checkpoint.journal).toHaveLength(2)
      expect(receipts).toHaveLength(2)
    } finally {
      await memory.close?.()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rebinds the same checkpoint after reconstruction and forks only into a fresh play scope', async () => {
    const rows = new Map<string, AgentMemoryWriteInput>()
    const original = branch(rows)
    const dir = await mkdtemp(join(tmpdir(), 'runtime-play-resume-'))
    let checkpoint: AgentMemoryBranchSnapshot | undefined
    const receipts: PlayMemoryRetrievalReceipt[] = []
    const recordRetrieval = (receipt: PlayMemoryRetrievalReceipt) => {
      receipts.push(receipt)
    }
    const profile = testAgentProfile('root', {
      tools: runtimeToolDeclarations('memory_record', 'memory_recall'),
    })
    const contexts: SupervisorNodeContext[] = []
    const driverFailures: unknown[] = []
    try {
      const first = await createPlayKnowledgeResolver({
        run,
        branch: original,
        qmd: retrieval(),
        recordRetrieval,
        onCheckpoint: (value) => {
          checkpoint = value
        },
      })
      const options = {
        budget,
        runDir: dir,
        runId: run.runId,
        inheritSpawnRights: false,
        driverRetry: { enabled: false } as const,
        makeLeafAgent: () => {
          throw new Error('No children in this fixture')
        },
      }
      await supervise(profile, 'Retain this finding.', {
        ...options,
        runContext: { ...createFileRunContext(dir, { withDriver: true }), ...run },
        resolveSupervisorTools: (context) => {
          contexts.push(context)
          return first(context)
        },
        driveHarness: checkedHarness(async ({ coordinationMcpUrl }) => {
          await call(coordinationMcpUrl, 'memory_record', {
            id: 'retained',
            kind: 'fact',
            text: 'retained after binding reconstruction',
          })
        }, driverFailures),
      })
      expect(driverFailures).toEqual([])
      expect(checkpoint).toBeDefined()
      await original.close?.()
      const rebound = branch(rows, checkpoint)
      try {
        const resumed = await createPlayKnowledgeResolver({
          run,
          branch: rebound,
          qmd: retrieval(),
          recordRetrieval,
          onCheckpoint: (value) => {
            checkpoint = value
          },
        })
        await supervise(profile, 'Retain this finding.', {
          ...options,
          runContext: { ...createFileRunContext(dir, { withDriver: true }), ...run },
          resolveSupervisorTools: (context) => {
            contexts.push(context)
            return resumed(context)
          },
          driveHarness: checkedHarness(async ({ coordinationMcpUrl }) => {
            expect(
              JSON.stringify(
                await call(coordinationMcpUrl, 'memory_recall', { question: 'retained' }),
              ),
            ).toContain('retained after binding reconstruction')
          }, driverFailures),
        })
        expect(driverFailures).toEqual([])
        expect(contexts).toHaveLength(2)
        expect(contexts[0]?.runNamespace).toBe(contexts[1]?.runNamespace)
        expect(contexts[0]?.ownerId).toBe(contexts[1]?.ownerId)
        expect((await rebound.snapshot()).journal).toHaveLength(1)
        const nextAttempt = { ...run, runId: 'retained-play-second-execution' }
        const nextAttemptResolver = await createPlayKnowledgeResolver({
          run: nextAttempt,
          branch: rebound,
          qmd: retrieval(),
          recordRetrieval,
          onCheckpoint: () => {},
        })
        const nextAttemptDir = join(dir, 'next-execution')
        await supervise(profile, 'Read the same play memory in a newly commissioned execution.', {
          ...options,
          runDir: nextAttemptDir,
          runId: nextAttempt.runId,
          runContext: {
            ...createFileRunContext(nextAttemptDir, { withDriver: true }),
            ...nextAttempt,
          },
          resolveSupervisorTools: (context) => {
            contexts.push(context)
            return nextAttemptResolver(context)
          },
          driveHarness: checkedHarness(async ({ coordinationMcpUrl }) => {
            expect(
              JSON.stringify(
                await call(coordinationMcpUrl, 'memory_recall', { question: 'retained' }),
              ),
            ).toContain('retained after binding reconstruction')
          }, driverFailures),
        })
        expect(driverFailures).toEqual([])
        expect(contexts[1]?.profile.name).toBe(contexts[2]?.profile.name)
        expect(receipts.map((receipt) => JSON.parse(receipt.actorId))).toEqual([
          [run.runId, contexts[1]!.nodeId],
          [nextAttempt.runId, contexts[2]!.nodeId],
        ])
        expect(new Set(receipts.map((receipt) => receipt.actorId)).size).toBe(2)
        await expect(
          Promise.resolve().then(() => nextAttemptResolver(contexts[0]!)),
        ).rejects.toThrow('commissioned play')
        const forkRun = { runId: 'next-play', namespace: 'commissioned:next-play:v1' }
        const forked = await forkAgentMemoryBranchSnapshot({
          snapshot: checkpoint!,
          adapter: memoryStore(rows),
          branchId: 'next-play-branch',
          baseScope: { namespace: forkRun.namespace },
        })
        try {
          expect((await forked.getContext('retained')).text).toContain(
            'retained after binding reconstruction',
          )
          const childResolver = await createPlayKnowledgeResolver({
            run: forkRun,
            branch: forked,
            qmd: retrieval(forkRun.namespace),
            onCheckpoint: () => {},
          })
          await expect(Promise.resolve().then(() => childResolver(contexts[0]!))).rejects.toThrow(
            'commissioned play',
          )
          await expect(
            createPlayKnowledgeResolver({
              run,
              branch: forked,
              qmd: retrieval(),
              onCheckpoint: () => {},
            }),
          ).rejects.toThrow('checkpoint')
          await forked.write({
            id: 'fork-only',
            kind: 'fact',
            text: 'visible only in the new play',
          })
          expect((await rebound.getContext('new play')).text).not.toContain(
            'visible only in the new play',
          )
        } finally {
          await forked.close?.()
        }
      } finally {
        await rebound.close?.()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a declared retrieval tool with no admitted source before the driver runs', async () => {
    const memory = branch(new Map())
    const dir = await mkdtemp(join(tmpdir(), 'runtime-missing-source-'))
    let invoked = false
    const resolver = await createPlayKnowledgeResolver({
      run,
      branch: memory,

      onCheckpoint: () => {},
    })
    try {
      await supervise(
        testAgentProfile('root', { tools: runtimeToolDeclarations('qmd_search') }),
        'Read evidence.',
        {
          budget,
          runId: run.runId,
          inheritSpawnRights: false,
          runContext: { ...createFileRunContext(dir, { withDriver: true }), ...run },
          makeLeafAgent: () => {
            throw new Error('No children')
          },
          resolveSupervisorTools: resolver,
          driveHarness: async () => {
            invoked = true
          },
          driverRetry: { enabled: false },
        },
      )
      expect(invoked).toBe(false)
    } finally {
      await memory.close?.()
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('rejects another play or stale retrieval snapshot before a resolver is available', async () => {
    const memory = branch(new Map())
    try {
      await expect(
        createPlayKnowledgeResolver({
          run,
          branch: memory,
          qmd: retrieval('unrelated-play'),
          onCheckpoint: () => {},
        }),
      ).rejects.toThrow('QMD snapshot')
      await expect(
        createPlayKnowledgeResolver({
          run,
          branch: memory,
          qmd: retrieval(run.namespace, 'changed source bytes'),
          onCheckpoint: () => {},
        }),
      ).rejects.toThrow('stale')
    } finally {
      await memory.close?.()
    }
  })
})
