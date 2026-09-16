import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  bindScopeRetainedOwnerProvider,
  consumeScopeRetainedOwnerResult,
  prepareScopeRetainedOwnerTask,
  registerScopeRetainedOwner,
  releaseScopeRetainedOwnerEnvironment,
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
  it.each([
    { id: 'another-owner', provider: 'owner-provider' },
    { id: 'owner-test', provider: 'another-provider' },
    { id: 'another-owner', provider: 'another-provider' },
  ])('does not reuse the teardown receipt for $id on $provider', async (foreign) => {
    const environmentId = 'shared-environment-id'
    const events: SpawnEvent[] = [
      {
        kind: 'environment-teardown',
        ...foreign,
        environmentId,
        destroyed: true,
        seq: 1,
        at: new Date(0).toISOString(),
      },
    ]
    let gets = 0
    let destroys = 0
    const provider: AgentEnvironmentProvider = {
      name: 'owner-provider',
      capabilities() {
        throw new Error('cleanup must not request execution capabilities')
      },
      async create() {
        throw new Error('cleanup must not create an environment')
      },
      async get(id) {
        expect(id).toBe(environmentId)
        gets++
        return {
          id,
          provider: 'owner-provider',
          status: async () => 'running',
          async *stream() {
            yield* []
          },
          async destroy() {
            destroys++
          },
        }
      },
    }
    await inScope(async (scope) => {
      registerScopeRetainedOwner(scope, {
        rootId: 'owner-test',
        nodeId: 'owner-test',
        blobs: new InMemoryResultBlobStore(),
        priorEvents: events,
        now: () => 0,
        journal: {
          loadTree: async () => [...events],
          beginTree: async () => {},
          appendEvent: async (_root, event) => {
            events.push(event)
          },
        },
      })
      bindScopeRetainedOwnerProvider(scope, provider)
      await scopeRetainedOwnerContext(scope)!.onAdmission({
        phase: 'environment',
        provider: provider.name,
        environmentId,
        idempotencyKey: 'owner-environment-key',
        turnId: 'owner-turn',
        sessionId: 'owner-session',
        executionId: 'owner-execution',
      })

      expect(await releaseScopeRetainedOwnerEnvironment(scope)).toEqual([])
      expect(gets).toBe(1)
      expect(destroys).toBe(1)
      expect(await releaseScopeRetainedOwnerEnvironment(scope)).toEqual([])
    })

    expect(gets).toBe(1)
    expect(destroys).toBe(1)
    expect(events.filter((event) => event.kind === 'environment-teardown')).toMatchObject([
      { ...foreign, environmentId, destroyed: true },
      { id: 'owner-test', provider: provider.name, environmentId, destroyed: true },
    ])
  })

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
