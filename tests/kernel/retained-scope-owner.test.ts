import type {
  WorkspaceCheckpointRequest,
  WorkspaceCheckpointResult,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { captureAgentCandidateWorkspaceFiles } from '../../src/candidate-execution'
import { canonicalCandidateDigest } from '../../src/candidate-execution/digest'
import { contentAddress } from '../../src/durable/content-address'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/in-memory-spawn-stores'
import {
  bindScopeRetainedOwnerEnvironmentId,
  bindScopeRetainedOwnerProvider,
  consumeScopeRetainedOwnerResult,
  noteScopeRetainedOwnerCoordination,
  prepareScopeRetainedOwnerTask,
  registerScopeRetainedOwner,
  releaseScopeRetainedOwnerEnvironment,
  scopeRetainedOwnerCheckpointing,
  scopeRetainedOwnerContext,
  scopeRetainedOwnerResourceReader,
  scopeRetainedOwnerResult,
} from '../../src/runtime/supervise/retained-scope-owner'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Scope, SpawnEvent } from '../../src/runtime/supervise/types'
import { createCandidateOutputFixture } from '../helpers/candidate-execution-fixture'
import { forbiddenCheckpointForks } from '../helpers/checkpoint-capture'

function checkpointFixture(
  options: {
    foreign?:
      | 'runId'
      | 'environmentId'
      | 'sessionId'
      | 'executionId'
      | 'provider'
      | 'key'
      | 'digest'
    cleanup?: 'deleted' | 'already_absent' | 'unknown' | 'foreign'
  } = {},
) {
  const events: SpawnEvent[] = []
  const source = {
    runId: 'owner-test',
    provider: 'owner-provider',
    environmentId: 'source-environment',
    sessionId: 'source-session',
    executionId: 'source-execution',
    requestDigest: `sha256:${'a'.repeat(64)}` as const,
  }
  let lost = false
  let deletes = 0
  const files = new Map<string, string>()
  const environment: AgentEnvironment = {
    id: source.environmentId,
    provider: source.provider,
    status: async () => 'running',
    async *stream() {},
    write: async (path, content) => {
      files.set(path, String(content))
    },
    destroy: async () => {
      lost = true
    },
    workspaceBranching: {
      checkpoint: async (
        request: WorkspaceCheckpointRequest,
      ): Promise<WorkspaceCheckpointResult> => {
        const foreign = options.foreign
        const key = foreign === 'key' ? 'foreign-key' : request.idempotencyKey
        const digest =
          foreign === 'digest' ? (`sha256:${'b'.repeat(64)}` as const) : request.requestDigest
        return {
          status: 'created',
          idempotencyKey: key,
          requestDigest: digest,
          checkpoint: {
            checkpointId: 'owned-checkpoint',
            provider: source.provider,
            source:
              foreign && foreign !== 'key' && foreign !== 'digest'
                ? { ...source, [foreign]: `foreign-${foreign}` }
                : source,
            idempotencyKey: key,
            requestDigest: digest,
            createdAt: new Date(0).toISOString(),
          },
        }
      },
      deleteCheckpoint: async (request) => {
        deletes++
        return options.cleanup === 'foreign'
          ? { ...request, targetId: 'another-checkpoint', status: 'deleted' }
          : { ...request, status: options.cleanup ?? 'deleted' }
      },
      lookupCheckpoint: async () => {
        throw new Error('not used')
      },
      ...forbiddenCheckpointForks,
    },
  }
  const provider: AgentEnvironmentProvider = {
    name: source.provider,
    capabilities: async () => ({ create: { workspaceCheckpoint: true } }),
    create: async () => {
      throw new Error('not used')
    },
    get: async (id) => (id === source.environmentId && !lost ? environment : null),
  }
  const register = (scope: Scope<unknown>) => {
    registerScopeRetainedOwner(scope, {
      rootId: 'owner-test',
      nodeId: 'owner-test',
      blobs: new InMemoryResultBlobStore(),
      priorEvents: [...events],
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
  }
  return {
    events,
    register,
    deletes: () => deletes,
    async checkpoint(scope: Scope<unknown>) {
      register(scope)
      const retention = scopeRetainedOwnerContext(scope)!
      await retention.onAdmission({
        phase: 'environment',
        provider: provider.name,
        environmentId: source.environmentId,
        idempotencyKey: 'input-key',
        turnId: 'source-turn',
        sessionId: source.sessionId,
        executionId: source.executionId,
      })
      await retention.onAdmission({
        phase: 'dispatched',
        controlRef: source,
        idempotencyKey: 'input-key',
        turnId: 'source-turn',
      })
      noteScopeRetainedOwnerCoordination(scope)
      await scopeRetainedOwnerCheckpointing(scope)
    },
    lose() {
      lost = true
      events.push({
        kind: 'environment-teardown',
        id: 'owner-test',
        provider: provider.name,
        environmentId: source.environmentId,
        destroyed: true,
        seq: 100,
        at: new Date(0).toISOString(),
      })
    },
  }
}

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
    'runId',
    'environmentId',
    'sessionId',
    'executionId',
    'provider',
    'key',
    'digest',
  ] as const)(
    'refuses a checkpoint with foreign %s before journaling or restore selection',
    async (foreign) => {
      const fixture = checkpointFixture({ foreign })
      await inScope(async (scope) => {
        await fixture.checkpoint(scope)
        expect(fixture.events.filter((event) => event.kind === 'workspace-checkpoint')).toEqual([])
        fixture.lose()
        await prepareScopeRetainedOwnerTask(scope, 'replacement task')
        expect(scopeRetainedOwnerContext(scope)!.restoreWorkspace).toBeUndefined()
      })
    },
  )

  it('cleans a lost source through its original handle and persists confirmation across resume', async () => {
    const fixture = checkpointFixture()
    await inScope(async (scope) => {
      await fixture.checkpoint(scope)
      fixture.lose()
      expect(await releaseScopeRetainedOwnerEnvironment(scope)).toEqual([])
    })
    expect(fixture.deletes()).toBe(1)
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        kind: 'workspace-checkpoint-cleanup',
        environmentId: 'source-environment',
        checkpointId: 'owned-checkpoint',
        confirmed: true,
      }),
    )
    await inScope(async (scope) => {
      fixture.register(scope)
      expect(await releaseScopeRetainedOwnerEnvironment(scope)).toEqual([])
    })
    expect(fixture.deletes()).toBe(1)
  })

  it.each(['unknown', 'foreign'] as const)(
    'reports %s checkpoint cleanup instead of a clean teardown',
    async (cleanup) => {
      const fixture = checkpointFixture({ cleanup })
      await inScope(async (scope) => {
        await fixture.checkpoint(scope)
        expect(await releaseScopeRetainedOwnerEnvironment(scope)).toContainEqual(
          expect.objectContaining({
            label: 'scope owner workspace checkpoint',
            detail: expect.stringContaining('owned-checkpoint'),
          }),
        )
      })
      expect(fixture.events).toContainEqual(
        expect.objectContaining({
          kind: 'workspace-checkpoint-cleanup',
          checkpointId: 'owned-checkpoint',
          confirmed: false,
        }),
      )
      await inScope(async (scope) => {
        fixture.register(scope)
        expect(await releaseScopeRetainedOwnerEnvironment(scope)).toContainEqual(
          expect.objectContaining({ label: 'scope owner workspace checkpoint' }),
        )
      })
    },
  )

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

  it.each([
    { name: 'null', invalid: null },
    { name: 'empty', invalid: {} },
    { name: 'partial', invalid: undefined },
    { name: 'wrong-source', invalid: undefined },
  ])('requires a durable owner workspace receipt before deletion ($name)', async (testCase) => {
    const environmentId = 'receipt-source'
    const blobs = new InMemoryResultBlobStore()
    const { outputArtifacts } = createCandidateOutputFixture()
    const valid = await captureAgentCandidateWorkspaceFiles(
      [{ path: 'work.txt', mode: 0o644, bytes: new TextEncoder().encode('retained work') }],
      { artifactPersistence: { executionId: 'owner:input:1', outputArtifacts } },
    )
    const output = {
      workspaceSnapshot: ['partial', 'wrong-source'].includes(testCase.name)
        ? valid.snapshot
        : testCase.invalid,
      workspaceCapture: {
        environmentId: testCase.name === 'wrong-source' ? 'another-source' : environmentId,
        executionId: 'owner:input:1',
        coverageComplete: testCase.name === 'wrong-source',
        snapshot: valid.snapshot,
      },
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
      expect(await releaseScopeRetainedOwnerEnvironment(scope)).toHaveLength(1)
    })
    expect(destroys).toBe(0)
    expect(events.at(-1)).toMatchObject({
      kind: 'environment-teardown',
      environmentId,
      destroyed: false,
    })
  })

  it.each([
    {
      name: 'over_bound',
      keep: true,
      nativeStoreComplete: false,
      nativeReason: 'over_bound:.local/share/opencode/opencode.db',
      coverageComplete: true,
      processComplete: true,
      eventsComplete: true,
    },
    {
      name: 'nativeStore incomplete',
      keep: true,
      nativeStoreComplete: false,
      nativeReason: undefined,
      coverageComplete: true,
      processComplete: true,
      eventsComplete: true,
    },
    {
      name: 'events_incomplete',
      keep: false,
      nativeStoreComplete: true,
      nativeReason: 'events_incomplete',
      coverageComplete: false,
      processComplete: true,
      eventsComplete: false,
    },
    {
      name: 'process_io_missing',
      keep: false,
      nativeStoreComplete: true,
      nativeReason: 'process_io_missing',
      coverageComplete: false,
      processComplete: false,
      eventsComplete: true,
    },
  ])('keeps a box only for an incomplete native session copy ($name)', async (testCase) => {
    const environmentId = 'receipt-source'
    const blobs = new InMemoryResultBlobStore()
    const { outputArtifacts } = createCandidateOutputFixture()
    const captured = await captureAgentCandidateWorkspaceFiles(
      [{ path: 'work.txt', mode: 0o644, bytes: new TextEncoder().encode('retained work') }],
      { artifactPersistence: { executionId: 'owner-test:input:1', outputArtifacts } },
    )
    const profileDigest = canonicalCandidateDigest({ profile: 'native-store-keep' })
    const requestDigest = canonicalCandidateDigest({ request: 'native-store-keep' })
    const controlRef = {
      runId: 'owner-test',
      provider: 'owner-provider',
      environmentId,
      sessionId: 'receipt-session',
      executionId: 'provider-execution',
      requestDigest,
    }
    const gap =
      testCase.nativeReason === undefined
        ? undefined
        : `provider workspace retention coverage incomplete: ${testCase.nativeReason}`
    const output = {
      workspaceSnapshot: captured.snapshot,
      workspaceCapture: {
        executionId: 'owner-test:input:1',
        environmentId,
        controlRef,
        node: {
          rootId: 'owner-test',
          parentId: 'owner-test',
          nodeId: 'owner-test',
          attemptId: 'attempt-1',
        },
        profileDigest,
        providerSessionId: controlRef.sessionId,
        nativeSessionId: controlRef.sessionId,
        snapshot: captured.snapshot,
        coverageComplete: testCase.coverageComplete,
        ...(gap === undefined ? {} : { incompleteReason: gap }),
        provenance: {
          status: 'reported' as const,
          environmentId,
          executionId: 'owner-test:input:1',
          controlRef,
          workspace: {
            scannedFiles: 1,
            reportedFiles: 1,
            scannedDirectories: 0,
            reportedDirectories: 0,
            complete: true,
          },
          sessions: [
            {
              id: controlRef.sessionId,
              nativeStore: { complete: testCase.nativeStoreComplete },
              ...(testCase.nativeReason === undefined
                ? {}
                : { nativeReason: testCase.nativeReason }),
              processStreams: { complete: testCase.processComplete },
              nativeEvents: { complete: testCase.eventsComplete },
            },
          ],
          missing: testCase.nativeReason === undefined ? [] : [testCase.nativeReason],
        },
      },
    }
    const outRef = contentAddress(output)
    await blobs.put(outRef, output)
    const at = new Date(0).toISOString()
    const events: SpawnEvent[] = [
      {
        kind: 'execution-input',
        id: 'owner-test',
        taskRef: contentAddress('task'),
        workspaceRetention: true,
        seq: 1,
        at,
      },
      {
        kind: 'execution-admitted',
        id: 'owner-test',
        admission: {
          phase: 'intent',
          provider: 'owner-provider',
          idempotencyKey: 'receipt-key',
          turnId: 'receipt-turn',
          sessionId: 'receipt-session',
          executionId: 'provider-execution',
          runId: 'owner-test',
          requestedProfileDigest: profileDigest,
          requestDigest,
        },
        seq: 2,
        at,
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
          executionId: 'provider-execution',
        },
        seq: 3,
        at,
      },
      {
        kind: 'execution-admitted',
        id: 'owner-test',
        admission: {
          phase: 'dispatched',
          idempotencyKey: 'receipt-key',
          turnId: 'receipt-turn',
          controlRef,
        },
        seq: 4,
        at,
      },
      {
        kind: 'execution-bound',
        id: 'owner-test',
        binding: {
          status: 'known',
          attemptId: 'attempt-1',
          materializationReceiptDigest: canonicalCandidateDigest({ receipt: 'native-store' }),
          bindingDigest: canonicalCandidateDigest({ binding: 'native-store' }),
          descriptor: { kind: 'test' },
        },
        seq: 5,
        at,
      },
      {
        kind: 'execution-result',
        id: 'owner-test',
        outRef,
        spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
        seq: 6,
        at,
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
      const cleanup = await releaseScopeRetainedOwnerEnvironment(scope)
      expect(cleanup).toHaveLength(testCase.keep ? 1 : 0)
    })
    expect(destroys).toBe(testCase.keep ? 0 : 1)
    expect(events.at(-1)).toMatchObject({
      kind: 'environment-teardown',
      environmentId,
      destroyed: !testCase.keep,
      ...(testCase.keep
        ? {
            detail: expect.stringContaining(
              testCase.nativeReason?.startsWith('over_bound:')
                ? `native session copy incomplete: ${testCase.nativeReason}`
                : 'native session copy incomplete: nativeStore incomplete',
            ),
          }
        : {}),
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
