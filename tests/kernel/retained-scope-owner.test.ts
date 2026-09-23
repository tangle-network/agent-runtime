import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { captureAgentCandidateWorkspaceFiles } from '../../src/candidate-execution'
import {
  contentAddress,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/spawn-journal'
import {
  bindScopeRetainedOwnerEnvironmentId,
  bindScopeRetainedOwnerProvider,
  bindScopeRetainedOwnerWorkspaceRetention,
  consumeScopeRetainedOwnerResult,
  prepareScopeRetainedOwnerTask,
  registerScopeRetainedOwner,
  releaseScopeRetainedOwnerEnvironment,
  scopeRetainedOwnerContext,
  scopeRetainedOwnerResourceReader,
  scopeRetainedOwnerResult,
} from '../../src/runtime/supervise/retained-scope-owner'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Scope, SpawnEvent } from '../../src/runtime/supervise/types'
import { createCandidateOutputFixture } from '../helpers/candidate-execution-fixture'

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

  it('preserves a later unreceipted attempt after resumed retention config drifts', async () => {
    const blobs = new InMemoryResultBlobStore()
    const events: SpawnEvent[] = [
      {
        kind: 'execution-input',
        id: 'owner-test',
        taskRef: contentAddress('first-task'),
        workspaceRetention: true,
        seq: 1,
        at: new Date(0).toISOString(),
      },
      {
        kind: 'execution-admitted',
        id: 'owner-test',
        admission: {
          phase: 'environment',
          provider: 'owner-provider',
          environmentId: 'first-source',
          idempotencyKey: 'first-key',
          turnId: 'first-turn',
          sessionId: 'first-session',
          executionId: 'first-execution',
        },
        seq: 2,
        at: new Date(0).toISOString(),
      },
      {
        kind: 'execution-input',
        id: 'owner-test',
        taskRef: contentAddress('second-task'),
        seq: 3,
        at: new Date(0).toISOString(),
      },
      {
        kind: 'execution-admitted',
        id: 'owner-test',
        admission: {
          phase: 'environment',
          provider: 'owner-provider',
          environmentId: 'second-source',
          idempotencyKey: 'second-key',
          turnId: 'second-turn',
          sessionId: 'second-session',
          executionId: 'second-execution',
        },
        seq: 4,
        at: new Date(0).toISOString(),
      },
    ]
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
        blobs,
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
      bindScopeRetainedOwnerWorkspaceRetention(scope, false)
      expect(await releaseScopeRetainedOwnerEnvironment(scope)).toHaveLength(1)
    })
    expect(destroys).toBe(0)
    const teardowns = events.filter((event) => event.kind === 'environment-teardown')
    expect(new Set(teardowns.map((event) => event.environmentId))).toEqual(
      new Set(['first-source', 'second-source']),
    )
    expect(teardowns.every((event) => !event.destroyed)).toBe(true)
  })

  it('preserves an unmarked legacy source when retention remains configured on resume', async () => {
    const environmentId = 'legacy-environment-id'
    const blobs = new InMemoryResultBlobStore()
    const events: SpawnEvent[] = [
      {
        kind: 'execution-input',
        id: 'owner-test',
        taskRef: contentAddress('legacy-task'),
        seq: 1,
        at: new Date(0).toISOString(),
      },
      {
        kind: 'execution-admitted',
        id: 'owner-test',
        admission: {
          phase: 'environment',
          provider: 'owner-provider',
          environmentId,
          idempotencyKey: 'legacy-environment-key',
          turnId: 'legacy-turn',
          sessionId: 'legacy-session',
          executionId: 'legacy-execution',
        },
        seq: 2,
        at: new Date(0).toISOString(),
      },
    ]
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
        blobs,
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
      bindScopeRetainedOwnerWorkspaceRetention(scope, true)

      expect(await releaseScopeRetainedOwnerEnvironment(scope)).toEqual([
        {
          id: 'owner-test',
          label: 'scope owner',
          runtime: provider.name,
          status: 'done',
          // Preserved on purpose as evidence, so it is kept, never offered to a sweeper.
          kept: [{ provider: provider.name, environmentId, keptFor: 'evidence' }],
          detail: expect.stringContaining('no verified workspace receipt'),
        },
      ])
    })

    expect(destroys).toBe(0)
    expect(events.at(-1)).toMatchObject({
      kind: 'environment-teardown',
      id: 'owner-test',
      provider: provider.name,
      environmentId,
      destroyed: false,
      detail: expect.stringContaining('no verified workspace receipt'),
    })
  })

  it.each([
    { name: 'null', invalid: null, destroyed: false },
    { name: 'empty', invalid: {}, destroyed: false },
    { name: 'valid', invalid: undefined, destroyed: true },
  ])('requires a durable owner workspace receipt before deletion ($name)', async (testCase) => {
    const environmentId = 'receipt-source'
    const blobs = new InMemoryResultBlobStore()
    const { outputArtifacts } = createCandidateOutputFixture()
    const valid = await captureAgentCandidateWorkspaceFiles(
      [{ path: 'work.txt', mode: 0o644, bytes: new TextEncoder().encode('retained work') }],
      { artifactPersistence: { executionId: 'owner:input:1', outputArtifacts } },
    )
    const output = {
      workspaceSnapshot: testCase.name === 'valid' ? valid.snapshot : testCase.invalid,
    }
    const outRef = contentAddress(output)
    await blobs.put(outRef, output)
    const events: SpawnEvent[] = [
      {
        kind: 'execution-input',
        id: 'owner-test',
        taskRef: contentAddress('task'),
        workspaceRetention: true,
        seq: 1,
        at: new Date(0).toISOString(),
      },
      {
        kind: 'execution-admitted',
        id: 'owner-test',
        admission: {
          phase: 'environment',
          provider: 'owner-provider',
          environmentId,
          idempotencyKey: 'receipt-key',
          turnId: 'receipt-turn',
          sessionId: 'receipt-session',
          executionId: 'owner:input:1',
        },
        seq: 2,
        at: new Date(0).toISOString(),
      },
      {
        kind: 'execution-result',
        id: 'owner-test',
        outRef,
        spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
        seq: 3,
        at: new Date(0).toISOString(),
      },
    ]
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
        blobs,
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
      bindScopeRetainedOwnerWorkspaceRetention(scope, false)
      expect(await releaseScopeRetainedOwnerEnvironment(scope)).toHaveLength(
        testCase.destroyed ? 0 : 1,
      )
    })
    expect(destroys).toBe(testCase.destroyed ? 1 : 0)
    expect(events.at(-1)).toMatchObject({
      kind: 'environment-teardown',
      environmentId,
      destroyed: testCase.destroyed,
    })
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

describe('scopeRetainedOwnerResourceReader', () => {
  // A manager inside a provider sandbox spawning a child with a file by path. The coordination
  // server cannot open the sandbox filesystem; the provider that created it can. Measured
  // 2026-09-17 (discovery-lab sandbox-a-20260917h): without this channel the director emitted
  // its files as content and destroyed 3 of 7, including its instrument and both drivers.
  function ownerProvider(files: Record<string, string>, environmentId: string) {
    const reads: string[] = []
    const provider: AgentEnvironmentProvider = {
      name: 'owner-provider',
      capabilities() {
        throw new Error('not requested')
      },
      async create() {
        throw new Error('not created here')
      },
      async get(id) {
        if (id !== environmentId) return null
        return {
          id,
          provider: 'owner-provider',
          status: async () => 'running',
          async *stream() {
            yield* []
          },
          async read(path: string) {
            reads.push(path)
            const content = files[path]
            if (content === undefined) {
              throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' })
            }
            return content
          },
        }
      },
    }
    return { provider, reads }
  }

  async function admitted(
    scope: Scope<unknown>,
    provider: AgentEnvironmentProvider,
    environmentId: string,
  ) {
    const events: SpawnEvent[] = []
    registerScopeRetainedOwner(scope, {
      rootId: 'owner-test',
      nodeId: 'owner-test',
      blobs: new InMemoryResultBlobStore(),
      priorEvents: [],
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
      idempotencyKey: 'k',
      turnId: 't',
      sessionId: 's',
      executionId: 'e',
    })
  }

  it('reads a by-path resource from the owner’s own environment, byte-exact', async () => {
    const instrument =
      'def battery(model):\n    """Aligned  columns  and trailing space """ \n    return 1e-4\n'
    const { provider, reads } = ownerProvider({ 'work/instrument.py': instrument }, 'sandbox-1')
    await inScope(async (scope) => {
      await admitted(scope, provider, 'sandbox-1')
      const reader = scopeRetainedOwnerResourceReader(scope)
      expect(reader).toBeDefined()
      expect(reader!.describe).toBe('environment sandbox-1')
      const read = await reader!.read('work/instrument.py')
      expect(read).toMatchObject({
        ok: true,
        content: instrument,
        byteLength: Buffer.byteLength(instrument),
      })
      expect(reads).toEqual(['work/instrument.py'])
    })
  })

  it('refuses, naming the missing piece, before the environment is admitted or the provider bound', async () => {
    const { provider } = ownerProvider({}, 'sandbox-2')
    await inScope(async (scope) => {
      registerScopeRetainedOwner(scope, {
        rootId: 'owner-test',
        nodeId: 'owner-test',
        blobs: new InMemoryResultBlobStore(),
        priorEvents: [],
        now: () => 0,
        journal: {
          loadTree: async () => [],
          beginTree: async () => {},
          appendEvent: async () => {},
        },
      })
      const reader = scopeRetainedOwnerResourceReader(scope)!
      expect(reader.describe).toBe('environment <not yet admitted>')
      expect(await reader.read('x')).toMatchObject({
        ok: false,
        reason: expect.stringContaining('provider is not bound'),
      })
      bindScopeRetainedOwnerProvider(scope, provider)
      expect(await reader.read('x')).toMatchObject({
        ok: false,
        reason: expect.stringContaining('not been admitted'),
      })
    })
  })

  it('refuses, naming the environment, when the provider no longer has it', async () => {
    // The provider serves only 'sandbox-second'; the owner was admitted on 'sandbox-first'. A
    // torn-down or lost box reads as gone, and no other box's file is served in its place.
    const { provider, reads } = ownerProvider({ 'f.txt': 'from the second box' }, 'sandbox-second')
    await inScope(async (scope) => {
      await admitted(scope, provider, 'sandbox-first')
      const reader = scopeRetainedOwnerResourceReader(scope)!
      expect(await reader.read('f.txt')).toMatchObject({
        ok: false,
        reason: expect.stringContaining('sandbox-first is gone'),
      })
      expect(reads).toEqual([])
    })
  })

  it('reads the LIVE environment id from the executor receipt when no admission was ever written', async () => {
    // The production tangle provider declares no retainedControl, so a real sandbox root never
    // writes an `environment` admission. The drive harness binds a resolver over the active
    // executor's materialization receipt instead. A reader that consulted admissions alone
    // refused every read on production while passing every retained-fixture test.
    const { provider, reads } = ownerProvider({ 'work/f.py': 'live bytes' }, 'sandbox-live')
    await inScope(async (scope) => {
      registerScopeRetainedOwner(scope, {
        rootId: 'owner-test',
        nodeId: 'owner-test',
        blobs: new InMemoryResultBlobStore(),
        priorEvents: [],
        now: () => 0,
        journal: {
          loadTree: async () => [],
          beginTree: async () => {},
          appendEvent: async () => {},
        },
      })
      bindScopeRetainedOwnerProvider(scope, provider)
      let live: string | undefined
      bindScopeRetainedOwnerEnvironmentId(scope, () => live)
      const reader = scopeRetainedOwnerResourceReader(scope)!
      expect(await reader.read('work/f.py')).toMatchObject({
        ok: false,
        reason: expect.stringContaining('not been admitted'),
      })
      live = 'sandbox-live' // the turn started; the receipt now names the box
      expect(reader.describe).toBe('environment sandbox-live')
      expect(await reader.read('work/f.py')).toMatchObject({ ok: true, content: 'live bytes' })
      expect(reads).toEqual(['work/f.py'])
    })
  })

  it('refuses when the provider returns a different environment than the one admitted', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'owner-provider',
      capabilities() {
        throw new Error('not requested')
      },
      async create() {
        throw new Error('not created here')
      },
      async get() {
        return {
          id: 'someone-elses-box',
          provider: 'owner-provider',
          status: async () => 'running',
          async *stream() {
            yield* []
          },
          async read() {
            return 'secret'
          },
        }
      },
    }
    await inScope(async (scope) => {
      await admitted(scope, provider, 'sandbox-mine')
      const read = await scopeRetainedOwnerResourceReader(scope)!.read('f')
      expect(read).toMatchObject({
        ok: false,
        reason: expect.stringContaining('another environment'),
      })
    })
  })
})
