import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FileResultBlobStore,
  FileSpawnJournal,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import { workerTraceAnalysisStore } from '../../src/runtime/supervise/trace-evidence'
import { createPushTraceSource } from '../../src/runtime/supervise/trace-source'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  ResultBlobStore,
  SpawnJournal,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

const spent = {
  iterations: 1,
  tokens: { input: 2, output: 3 },
  usd: 0.01,
  ms: 4,
}

function makeAgent(
  executor: Executor<unknown>,
): Agent<unknown, unknown> & { executorSpec: AgentSpec } {
  return {
    name: 'trace worker',
    act: async () => undefined,
    executorSpec: { profile: testAgentProfile('trace worker'), harness: null, executor },
  }
}

function makeScope(root: string, journal: SpawnJournal, blobs: ResultBlobStore) {
  return createScope<unknown>({
    parentId: root,
    root,
    pool: createBudgetPool({ maxIterations: 2, maxTokens: 100 }, 0),
    journal,
    blobs,
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    maxDepth: 4,
    signal: new AbortController().signal,
    now: () => 100,
  })
}

describe('durable worker trace evidence', () => {
  it('persists exact tool spans and the result blob before journaling a live settlement', async () => {
    const root = 'live-trace'
    const innerJournal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    let checkedTerminalReferences = false
    const journal: SpawnJournal = {
      loadTree: (id) => innerJournal.loadTree(id),
      beginTree: (id, at) => innerJournal.beginTree(id, at),
      async appendEvent(id, event) {
        if (event.kind === 'settled') {
          expect(event.trace?.status).toBe('available')
          if (event.trace?.status === 'available') {
            expect(await blobs.get(event.trace.traceRef)).toBeDefined()
          }
          if (event.status === 'done') expect(await blobs.get(event.outRef!)).toBeDefined()
          checkedTerminalReferences = true
        }
        await innerJournal.appendEvent(id, event)
      },
    }
    await journal.beginTree(root, new Date(100).toISOString())

    const trace = createPushTraceSource({ runId: 'live-worker', now: () => 101 })
    const output = { final: 'worker prose is a result, not a trace' }
    const executor: Executor<unknown> = {
      runtime: 'router-tools',
      async execute(): Promise<ExecutorResult<unknown>> {
        trace.record({
          toolName: 'read_file',
          args: { path: 'src/index.ts' },
          result: { bytes: 42 },
        })
        return { outRef: 'executor-local-ref', out: output, spent }
      },
      traceSource: () => trace.source,
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => ({ outRef: 'executor-local-ref', out: output, spent }),
    }
    const scope = makeScope(root, journal, blobs)
    expect(
      scope.spawn(makeAgent(executor), 'inspect', {
        budget: { maxIterations: 1, maxTokens: 50 },
        label: 'live trace',
      }).ok,
    ).toBe(true)

    const settled = await scope.next()
    expect(settled).toMatchObject({
      kind: 'done',
      out: output,
      trace: { status: 'available', spanCount: 1 },
    })
    expect(checkedTerminalReferences).toBe(true)
    if (settled?.trace.status !== 'available') throw new Error('expected trace evidence')
    const store = await workerTraceAnalysisStore(settled.trace, blobs)
    await expect(store.getOverview()).resolves.toMatchObject({
      total_traces: 1,
      sample_trace_ids: ['live-worker'],
      tool_names: ['read_file'],
    })
  })

  it('marks an empty Codex bridge source unavailable and never treats final prose as evidence', async () => {
    const root = 'codex-no-trace'
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    await journal.beginTree(root, new Date(100).toISOString())
    const trace = createPushTraceSource({ runId: 'codex-worker' })
    const output = { final: 'I used many tools, trust me' }
    const executor: Executor<unknown> = {
      runtime: 'codex',
      execute: async () => ({ outRef: 'executor-local-ref', out: output, spent }),
      traceSource: () => trace.source,
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => ({ outRef: 'executor-local-ref', out: output, spent }),
    }
    const scope = makeScope(root, journal, blobs)
    expect(
      scope.spawn(makeAgent(executor), 'inspect', {
        budget: { maxIterations: 1, maxTokens: 50 },
        label: 'codex no trace',
      }).ok,
    ).toBe(true)

    const settled = await scope.next()
    expect(settled).toMatchObject({
      kind: 'done',
      out: output,
      trace: { status: 'unavailable', reason: 'no-tool-spans-captured' },
    })
    if (!settled) throw new Error('expected settlement')
    await expect(workerTraceAnalysisStore(settled.trace, blobs)).rejects.toThrow(
      'trace evidence is missing',
    )
  })

  it('retains partial structured trace evidence across a worker crash and process restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worker-trace-restart-'))
    try {
      const root = 'crash-restart-trace'
      const journalPath = join(dir, 'spawn.jsonl')
      const blobPath = join(dir, 'blobs')
      const journal = new FileSpawnJournal(journalPath)
      const blobs = new FileResultBlobStore(blobPath)
      await journal.beginTree(root, new Date(100).toISOString())
      const trace = createPushTraceSource({ runId: 'crashed-worker', now: () => 102 })
      const executor: Executor<unknown> = {
        runtime: 'router-tools',
        async execute() {
          trace.record({
            toolName: 'write_file',
            args: { path: 'partial.ts' },
            status: 'error',
            result: { error: 'disk full' },
          })
          throw new Error('provider session crashed')
        },
        traceSource: () => trace.source,
        teardown: async () => ({ destroyed: true }),
        resultArtifact() {
          throw new Error('result unavailable after crash')
        },
      }
      const scope = makeScope(root, journal, blobs)
      expect(
        scope.spawn(makeAgent(executor), 'mutate', {
          budget: { maxIterations: 1, maxTokens: 50 },
          label: 'crashed trace',
        }).ok,
      ).toBe(true)
      await expect(scope.next()).resolves.toMatchObject({
        kind: 'down',
        reason: 'provider session crashed',
        trace: { status: 'available', spanCount: 1 },
      })

      const restartedJournal = new FileSpawnJournal(journalPath)
      const restartedBlobs = new FileResultBlobStore(blobPath)
      const replayed = await replaySpawnTree(restartedJournal, restartedBlobs, root)
      expect(replayed).toHaveLength(1)
      expect(replayed[0]).toMatchObject({
        kind: 'down',
        reason: 'provider session crashed',
        trace: { status: 'available', spanCount: 1 },
      })
      const resumed = replayed[0]
      if (resumed?.trace.status !== 'available') {
        throw new Error('expected replayed trace evidence')
      }
      const store = await workerTraceAnalysisStore(resumed.trace, restartedBlobs)
      await expect(store.getOverview()).resolves.toMatchObject({
        total_traces: 1,
        sample_trace_ids: ['crashed-worker'],
        tool_names: ['write_file'],
        errors: { trace_count: 1, span_count: 1 },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
