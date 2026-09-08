import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  consumeScopeRetainedOwnerResult,
  prepareScopeRetainedOwnerTask,
  registerScopeRetainedOwner,
  scopeRetainedOwnerContext,
  scopeRetainedOwnerResult,
} from '../../src/runtime/supervise/retained-scope-owner'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Scope, SpawnEvent } from '../../src/runtime/supervise/types'

async function inScope(body: (scope: Scope<unknown>) => Promise<void>) {
  let failure: unknown
  await createSupervisor<unknown, unknown>().run(
    {
      name: 'owner-test',
      async act(_task, scope) {
        try {
          await body(scope)
        } catch (error) {
          failure = error
        }
      },
    },
    'test',
    {
      runId: 'owner-test',
      budget: { maxIterations: 2, maxTokens: 10 },
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
    },
  )
  if (failure) throw failure
}

describe('retained scope owner input and result', () => {
  it('restores original backend input and identity, then allocates a distinct identity for a later drive', async () => {
    const blobs = new InMemoryResultBlobStore()
    const priorEvents: SpawnEvent[] = []
    let originalExecution: string | undefined
    const args = {
      rootId: 'owner-test',
      nodeId: 'owner-test',
      blobs,
      priorEvents,
      now: () => 0,
      journal: {
        loadTree: async () => [...priorEvents],
        beginTree: async () => {},
        appendEvent: async (_root: string, event: SpawnEvent) => {
          priorEvents.push(event)
        },
      },
    }
    await inScope(async (scope) => {
      registerScopeRetainedOwner(scope, args)
      expect(await prepareScopeRetainedOwnerTask(scope, 'original backend prompt')).toBe(
        'original backend prompt',
      )
      originalExecution = scopeRetainedOwnerContext(scope)!.executionId
    })
    await inScope(async (scope) => {
      registerScopeRetainedOwner(scope, args)
      expect(await prepareScopeRetainedOwnerTask(scope, 'regenerated observations')).toBe(
        'original backend prompt',
      )
      const context = scopeRetainedOwnerContext(scope)!
      expect(context.executionId).toBe(originalExecution)
      await context.onResult({
        outRef: 'adapter-ref',
        out: { text: 'manager ended' },
        spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
      })
    })
    await inScope(async (scope) => {
      registerScopeRetainedOwner(scope, args)
      await prepareScopeRetainedOwnerTask(scope, 'new observations')
      expect((await scopeRetainedOwnerResult(scope))?.out).toEqual({ text: 'manager ended' })
      consumeScopeRetainedOwnerResult(scope)
      expect(await prepareScopeRetainedOwnerTask(scope, 'deliberate second drive')).toBe(
        'deliberate second drive',
      )
      expect(scopeRetainedOwnerContext(scope)!.executionId).not.toBe(originalExecution)
      expect(await scopeRetainedOwnerResult(scope)).toBeUndefined()
    })
  })
})
