import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../durable/spawn-journal'
import { createBudgetPool } from './budget'
import { RetainedExecutionPendingError } from './retained-executor'
import { createExecutorRegistry } from './runtime'
import { createScope, releaseRetainedEnvironments } from './scope'
import type { AgentProfile, Executor } from './types'

const profile: AgentProfile = {
  name: 'retained-worker',
  harness: 'claude-code',
  model: { provider: 'fixture', default: 'fixture/model' },
}

/** An executor that behaves exactly like providerAsExecutor does for a retained child whose
 *  sandbox stopped: execute throws RetainedExecutionPendingError, teardown answers
 *  destroyed:false while the retained execution is pending, and releaseRetained can destroy the
 *  environment once the root has settled. */
function retainedExecutor(over: Partial<Executor<unknown>> = {}): Executor<unknown> {
  return {
    runtime: 'fixture',
    execute: async () => {
      throw new RetainedExecutionPendingError(new Error('Sandbox is not running (status: stopped)'))
    },
    teardown: async () => ({
      destroyed: false,
      detail: 'retained execution requires reconciliation',
    }),
    releaseRetained: async () => [
      { provider: 'fixture', environmentId: 'env-1', destroyed: true },
    ],
    resultArtifact: () => {
      throw new Error('no artifact')
    },
    ...over,
  } as Executor<unknown>
}

async function runOne(executor: Executor<unknown>) {
  const journal = new InMemorySpawnJournal()
  const blobs = new InMemoryResultBlobStore()
  await journal.beginTree('root', new Date(0).toISOString())
  const scope = createScope({
    parentId: 'root',
    root: 'root',
    journal,
    blobs,
    pool: createBudgetPool({ maxIterations: 4, maxTokens: 1000 }, 0),
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: new AbortController().signal,
  })
  const spawned = scope.spawn(
    Object.assign(
      { name: profile.name!, act: async () => 'unused' },
      { executorSpec: { profile, harness: null, executorFactory: () => executor } },
    ),
    'task',
    { label: 'retained', budget: { maxIterations: 1, maxTokens: 100 } },
  )
  expect(spawned.ok).toBe(true)
  const settled = await scope.next()
  const beforeRelease = (await journal.loadTree('root')) ?? []
  await releaseRetainedEnvironments(scope)
  const afterRelease = (await journal.loadTree('root')) ?? []
  return { settled, beforeRelease, afterRelease }
}

describe('never-settled repro: the retained release sweep', () => {
  it('writes a terminal settled record when releaseRetained destroys the environment', async () => {
    const { settled, beforeRelease, afterRelease } = await runOne(retainedExecutor())
    expect(settled?.kind).toBe('down')
    // Before the sweep: a reconciled floor and NO terminal record.
    expect(beforeRelease.filter((e) => e.kind === 'reconciled')).toHaveLength(1)
    expect(beforeRelease.filter((e) => e.kind === 'settled')).toHaveLength(0)
    // After the sweep: one teardown receipt and one released terminal record.
    const teardowns = afterRelease.filter((e) => e.kind === 'environment-teardown')
    const terminals = afterRelease.filter((e) => e.kind === 'settled')
    console.log(
      'KINDS AFTER RELEASE:',
      JSON.stringify(
        afterRelease.reduce<Record<string, number>>((acc, e) => {
          acc[e.kind] = (acc[e.kind] ?? 0) + 1
          return acc
        }, {}),
      ),
    )
    expect(teardowns).toHaveLength(1)
    expect(terminals).toHaveLength(1)
    expect(terminals[0]).toMatchObject({ status: 'down', retainedExecution: 'released' })
  })

  it('leaves the slot open when releaseRetained answers with no receipt', async () => {
    const { afterRelease } = await runOne(retainedExecutor({ releaseRetained: async () => [] }))
    expect(afterRelease.filter((e) => e.kind === 'environment-teardown')).toHaveLength(0)
    expect(afterRelease.filter((e) => e.kind === 'settled')).toHaveLength(0)
  })

  it('leaves the slot open when releaseRetained answers destroyed:false', async () => {
    const { afterRelease } = await runOne(
      retainedExecutor({
        releaseRetained: async () => [
          { provider: 'fixture', environmentId: 'env-1', destroyed: false, detail: 'gone' },
        ],
      }),
    )
    expect(afterRelease.filter((e) => e.kind === 'environment-teardown')).toHaveLength(1)
    expect(afterRelease.filter((e) => e.kind === 'settled')).toHaveLength(0)
  })
})

describe('never-settled repro: contract-honouring executor', () => {
  it('writes the released record when teardown answers destroyed:true after release', async () => {
    // types.ts:212 — "After a `destroyed: true` receipt the executor's `teardown` must answer
    // `destroyed: true` as well." providerAsExecutor honours this (pending=false, destroyed=true
    // are set before the receipt returns).
    let released = false
    const executor = retainedExecutor({
      teardown: async () => (released ? { destroyed: true } : {
        destroyed: false,
        detail: 'retained execution requires reconciliation',
      }),
      releaseRetained: async () => {
        released = true
        return [{ provider: 'fixture', environmentId: 'env-1', destroyed: true }]
      },
    })
    const { afterRelease } = await runOne(executor)
    console.log(
      'CONTRACT-HONOURING KINDS:',
      JSON.stringify(
        afterRelease.reduce<Record<string, number>>((acc, e) => {
          acc[e.kind] = (acc[e.kind] ?? 0) + 1
          return acc
        }, {}),
      ),
    )
    const terminals = afterRelease.filter((e) => e.kind === 'settled')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]).toMatchObject({ status: 'down', retainedExecution: 'released' })
  })
})
