import {
  type AgentProfile,
  buildAgentExecutionPreparationReceipt,
  buildAgentWorkspaceLeaseRecord,
  canonicalCandidateDigest,
  profileMaterializationRequests,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  loadSpawnForest,
  materializeTreeView,
} from '../../src/durable/spawn-journal'
import {
  attestRuntimeOwnedExecutor,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
} from '../../src/runtime/supervise/materialization'
import {
  createPreparedExecutorFactory,
  type RuntimeExecutorPreparationRequest,
  type RuntimePreparedExecutorResult,
  runtimeOwnedExecutorPreparation,
} from '../../src/runtime/supervise/prepared-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import {
  prepareScopeOwnerExecutor,
  recordScopeOwnerMaterialization,
  scopeOwnerExecutorNodeContext,
} from '../../src/runtime/supervise/scope'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  ExecutorFactory,
  ExecutorResult,
  NodeExecutionIdentity,
  Scope,
  SpawnEvent,
} from '../../src/runtime/supervise/types'

const nowMs = 1_000
const childBudget = { maxIterations: 2, maxTokens: 1_000 }
const rootBudget = { maxIterations: 10, maxTokens: 10_000 }
const spent = {
  iterations: 1,
  tokens: { input: 2, output: 3 },
  usd: 0.01,
  ms: 4,
}

function sha(character: string): Sha256Digest {
  return `sha256:${character.repeat(64)}` as Sha256Digest
}

function preparedResult(
  request: RuntimeExecutorPreparationRequest,
  events: string[],
): RuntimePreparedExecutorResult {
  const profileActivation = { digest: sha('4') }
  const executionPlanDigest = canonicalCandidateDigest({
    kind: 'test-prepared-plan',
    requestDigest: request.requestDigest,
  })
  const leaseBase = {
    kind: 'agent-workspace-lease' as const,
    schemaVersion: 1 as const,
    leaseId: `lease-${request.node.attemptId}`,
    ownerId: 'test-owner',
    workspace: {
      provider: 'test-private-workspace',
      root: `/tmp/${request.node.nodeId}`,
      identityDigest: sha('2'),
    },
    isolation: 'per-run' as const,
    sourceSnapshotDigest: sha('3'),
    sourceSnapshotPolicy: {
      kind: 'provider-declared' as const,
      name: 'test-source-policy',
      version: 1,
      digest: sha('1'),
    },
    preparedWorkspaceDigest: sha('5'),
    profileActivationDigest: profileActivation.digest,
    createdAtMs: 100,
    expiresAtMs: 10_000,
    cleanupAttempts: 0 as const,
  }
  const sealedLease = buildAgentWorkspaceLeaseRecord({
    ...leaseBase,
    phase: 'workspace-sealed',
    updatedAtMs: 200,
  })
  const requests = new Map(
    [
      ...profileMaterializationRequests(request.authoredProfile),
      ...profileMaterializationRequests(request.executionProfile),
    ].map((profileRequest) => [`${profileRequest.axis}:${profileRequest.path}`, profileRequest]),
  )
  const receipt = buildAgentExecutionPreparationReceipt({
    preparationId: `preparation-${request.node.attemptId}`,
    requestDigest: request.requestDigest,
    authoredProfile: request.authoredProfile,
    effectiveProfile: request.executionProfile,
    backend: 'test-backend',
    harness: 'codex',
    harnessVersion: 'test-harness-1',
    resolvedModel: {
      requested: request.executionProfile.model?.default ?? '',
      resolved: request.executionProfile.model?.default ?? 'test/model',
    },
    workspaceLease: sealedLease,
    profileActivation,
    axisResults: [...requests.values()].map((profileRequest) => {
      const authored = readPointer(request.authoredProfile, profileRequest.path)
      const effective = readPointer(request.executionProfile, profileRequest.path)
      const changed = JSON.stringify(authored) !== JSON.stringify(effective)
      return {
        ...profileRequest,
        disposition: changed ? ('overridden' as const) : ('behavior' as const),
        owner: 'executor' as const,
        mechanism: 'test-materializer',
        ...(changed ? { reason: 'trusted runtime attachment' } : {}),
      }
    }),
    executionPlanDigest,
    materializer: { name: 'test-materializer', version: '1.0.0' },
    expiresAtMs: 10_000,
    nowMs,
  })
  const workspaceLease = buildAgentWorkspaceLeaseRecord({
    ...leaseBase,
    phase: 'execution-bound',
    updatedAtMs: 300,
    executionPreparationDigest: receipt.digest,
  })
  return {
    receipt,
    effectiveProfile: request.executionProfile,
    executionPlanDigest,
    profileActivation,
    workspaceLease,
    async release() {
      events.push('release')
    },
  }
}

function readPointer(value: unknown, pointer: string): unknown {
  let current = value
  for (const encoded of pointer.split('/').slice(1)) {
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~')
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function testExecutorFactory(
  events: string[],
  teardown: () => Promise<{ destroyed: boolean }> = async () => ({ destroyed: true }),
): ExecutorFactory<unknown> {
  return (spec, context) => {
    events.push('construct')
    const artifact: ExecutorResult<unknown> = {
      outRef: 'inner-output-is-readdressed-by-runtime',
      out: { prepared: true },
      spent,
    }
    return attestRuntimeOwnedExecutor(
      {
        runtime: 'test-runtime',
        async execute() {
          events.push('execute')
          return artifact
        },
        async teardown() {
          events.push('teardown')
          return teardown()
        },
        resultArtifact() {
          return artifact
        },
      },
      {
        effectiveProfile: spec.profile,
        backend: 'test-backend',
        model: { status: 'known', id: spec.profile.model?.default ?? 'test/model' },
        execution: { kind: 'test-run', id: context.node?.nodeId ?? 'unscoped' },
        materializer: 'test-materializer',
        plan: { kind: 'test-prepared-plan' },
      },
      {
        attemptId: context.node?.attemptId ?? 'unscoped-attempt',
        binding: { executionId: context.node?.nodeId ?? 'unscoped' },
        descriptor: { kind: 'test-executor', transport: 'in-process' },
      },
    )
  }
}

async function prepareDirect(
  factory: ExecutorFactory<unknown>,
  profile: AgentProfile,
  task: unknown,
): Promise<ExecutorResultFixture> {
  const identity: NodeExecutionIdentity = {
    profileDigest: canonicalCandidateDigest(profile),
    taskDigest: canonicalCandidateDigest(task),
  }
  const node = {
    rootId: 'direct-root',
    parentId: 'direct-root',
    nodeId: 'direct-node',
    attemptId: 'direct-attempt',
  }
  const executor = factory(
    { profile, harness: null },
    { signal: new AbortController().signal, node, seams: {} },
  )
  const preparation = runtimeOwnedExecutorPreparation(executor)
  if (!preparation) throw new Error('test factory omitted Runtime preparation')
  const requestDigest = canonicalCandidateDigest({
    kind: 'supervised-executor-preparation-request',
    ...node,
    role: preparation.role,
    identity,
  })
  await preparation.prepare(task, requestDigest)
  return { executor }
}

interface ExecutorResultFixture {
  readonly executor: ReturnType<ExecutorFactory<unknown>>
}

function leafAgent(
  profile: AgentProfile,
  factory: ExecutorFactory<unknown>,
): Agent<unknown, unknown> {
  const executorSpec: AgentSpec = { profile, harness: null, executorFactory: factory }
  return { name: profile.name ?? 'worker', act: async () => undefined, executorSpec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

async function runChild(
  factory: ExecutorFactory<unknown>,
  journal: InMemorySpawnJournal,
  runId: string,
) {
  const child = leafAgent({ name: 'prepared-worker', model: { default: 'test/model' } }, factory)
  const root: Agent<unknown, unknown> = {
    name: 'root',
    async act(_task, scope) {
      const spawned = scope.spawn(child, 'do prepared work', {
        label: 'prepared-child',
        budget: childBudget,
      })
      if (!spawned.ok) throw new Error(spawned.reason)
      return scope.next()
    },
  }
  return createSupervisor<unknown, unknown>().run(root, 'root task', {
    budget: rootBudget,
    runId,
    journal,
    blobs: new InMemoryResultBlobStore(),
    executors: createExecutorRegistry(),
    now: () => nowMs,
  })
}

function childEvents(events: SpawnEvent[] | undefined): SpawnEvent[] {
  return (events ?? []).filter((event) => event.id.endsWith(':s0'))
}

describe('prepared executor', () => {
  it('commits exact preparation before compute and releases the private workspace last', async () => {
    const events: string[] = []
    const journal = new InMemorySpawnJournal()
    const factory = createPreparedExecutorFactory({
      runtime: 'test-runtime',
      executorFactory: testExecutorFactory(events),
      backend: 'test-backend',
      harness: 'codex',
      harnessVersion: 'test-harness-1',
      now: () => nowMs,
      async prepare(request) {
        events.push('prepare')
        expect(request.role).toBe('worker')
        expect(Object.isFrozen(request)).toBe(true)
        expect(Object.isFrozen(request.authoredProfile)).toBe(true)
        expect(Object.isFrozen(request.executionProfile)).toBe(true)
        return preparedResult(request, events)
      },
    })

    const result = await runChild(factory, journal, 'prepared-success')
    expect(events).toEqual(['prepare', 'construct', 'execute', 'teardown', 'release'])

    const durable = childEvents(await journal.loadTree('prepared-success'))
    expect(durable.map((event) => event.kind)).toEqual([
      'spawned',
      'prepared',
      'materialized',
      'execution-bound',
      'settled',
    ])
    const prepared = durable.find((event) => event.kind === 'prepared')
    expect(prepared).toMatchObject({
      evidence: {
        role: 'worker',
        attemptId: expect.any(String),
        receipt: { backend: 'test-backend', harness: 'codex' },
        workspaceLease: { phase: 'execution-bound' },
      },
    })
    const node = result.tree.nodes.find((entry) => entry.id.endsWith(':s0'))
    expect(node?.executionPreparations).toHaveLength(1)
    expect(node?.executionPreparations?.[0]).toEqual(
      prepared?.kind === 'prepared' ? prepared.evidence : undefined,
    )
  })

  it('makes an invalid receipt a zero-compute failure and still releases once', async () => {
    const events: string[] = []
    const journal = new InMemorySpawnJournal()
    const factory = createPreparedExecutorFactory({
      runtime: 'test-runtime',
      executorFactory: testExecutorFactory(events),
      backend: 'test-backend',
      harness: 'codex',
      harnessVersion: 'test-harness-1',
      now: () => nowMs,
      async prepare(request) {
        events.push('prepare')
        const valid = preparedResult(request, events)
        return {
          ...valid,
          receipt: { ...valid.receipt, requestDigest: sha('0') },
        }
      },
    })

    const result = await runChild(factory, journal, 'prepared-invalid')
    expect(events).toEqual(['prepare', 'release'])
    expect(result.tree.nodes.find((entry) => entry.id.endsWith(':s0'))).toMatchObject({
      status: 'failed',
      spent: {
        iterations: 0,
        tokens: { input: 0, output: 0 },
        usd: 0,
      },
    })
    expect(
      childEvents(await journal.loadTree('prepared-invalid')).map((event) => event.kind),
    ).toEqual(['spawned', 'settled'])
  })

  it('retains the workspace when executor destruction is not confirmed', async () => {
    const events: string[] = []
    const profile = { name: 'prepared-worker', model: { default: 'test/model' } }
    const task = 'retain private workspace'
    const factory = createPreparedExecutorFactory({
      runtime: 'test-runtime',
      executorFactory: testExecutorFactory(events, async () => ({ destroyed: false })),
      backend: 'test-backend',
      harness: 'codex',
      harnessVersion: 'test-harness-1',
      now: () => nowMs,
      async prepare(request) {
        events.push('prepare')
        return preparedResult(request, events)
      },
    })
    const { executor } = await prepareDirect(factory, profile, task)

    await expect(executor.teardown('brutalKill')).resolves.toEqual({ destroyed: false })
    expect(events).toEqual(['prepare', 'construct', 'teardown'])
  })

  it('retains the workspace when executor teardown throws', async () => {
    const events: string[] = []
    const profile = { name: 'prepared-worker', model: { default: 'test/model' } }
    const factory = createPreparedExecutorFactory({
      runtime: 'test-runtime',
      executorFactory: testExecutorFactory(events, async () => {
        throw new Error('still alive')
      }),
      backend: 'test-backend',
      harness: 'codex',
      harnessVersion: 'test-harness-1',
      now: () => nowMs,
      async prepare(request) {
        events.push('prepare')
        return preparedResult(request, events)
      },
    })
    const { executor } = await prepareDirect(factory, profile, 'throw during teardown')

    await expect(executor.teardown('brutalKill')).rejects.toThrow(/prepared teardown failed/)
    expect(events).toEqual(['prepare', 'construct', 'teardown'])
  })

  it('retries a failed private workspace release after confirmed destruction', async () => {
    const events: string[] = []
    let releases = 0
    const profile = { name: 'prepared-worker', model: { default: 'test/model' } }
    const factory = createPreparedExecutorFactory({
      runtime: 'test-runtime',
      executorFactory: testExecutorFactory(events),
      backend: 'test-backend',
      harness: 'codex',
      harnessVersion: 'test-harness-1',
      now: () => nowMs,
      async prepare(request) {
        events.push('prepare')
        const result = preparedResult(request, events)
        return {
          ...result,
          async release() {
            releases += 1
            events.push(`release-${releases}`)
            if (releases === 1) throw new Error('transient cleanup failure')
          },
        }
      },
    })
    const { executor } = await prepareDirect(factory, profile, 'retry workspace release')

    await expect(executor.teardown('brutalKill')).rejects.toThrow(/workspace release failed/)
    await expect(executor.teardown('brutalKill')).resolves.toEqual({ destroyed: true })
    expect(events).toEqual(['prepare', 'construct', 'teardown', 'release-1', 'release-2'])
  })

  it('uses the same preparation path for a root supervisor', async () => {
    const events: string[] = []
    const journal = new InMemorySpawnJournal()
    const profile = { name: 'prepared-supervisor', model: { default: 'test/model' } }
    const executionProfile: AgentProfile = {
      ...profile,
      mcp: {
        coordination: { transport: 'http', url: 'http://127.0.0.1:41001/mcp' },
      },
    }
    const task = { question: 'lead this pursuit' }
    const identity: NodeExecutionIdentity = {
      profileDigest: canonicalCandidateDigest(profile),
      taskDigest: canonicalCandidateDigest(task),
    }
    const root: Agent<typeof task, unknown> = {
      name: 'prepared-supervisor',
      async act(rootTask, scope) {
        const factory = createPreparedExecutorFactory({
          runtime: 'test-runtime',
          executorFactory: testExecutorFactory(events),
          role: 'supervisor',
          authoredProfile: profile,
          backend: 'test-backend',
          harness: 'codex',
          harnessVersion: 'test-harness-1',
          now: () => nowMs,
          async prepare(request) {
            events.push('prepare')
            expect(request.role).toBe('supervisor')
            return preparedResult(request, events)
          },
        })
        const executor = factory(
          { profile: executionProfile, harness: null },
          {
            signal: scope.signal,
            node: scopeOwnerExecutorNodeContext(scope as Scope<unknown>),
            seams: {},
          },
        )
        await prepareScopeOwnerExecutor(scope as Scope<unknown>, executor, rootTask)
        const declaration = runtimeOwnedExecutorMaterialization(executor)
        const binding = runtimeOwnedExecutorExecutionBinding(executor)
        if (!declaration || !binding) throw new Error('prepared root omitted execution evidence')
        await recordScopeOwnerMaterialization(
          scope as Scope<unknown>,
          executor.runtime,
          declaration,
          binding,
        )
        const artifact = await executor.execute(rootTask, scope.signal)
        if (Symbol.asyncIterator in Object(artifact)) throw new Error('test executor streamed')
        await executor.teardown('brutalKill')
        return (await artifact).out
      },
    }

    const result = await createSupervisor<typeof task, unknown>().run(root, task, {
      budget: rootBudget,
      runId: 'prepared-root',
      rootIdentity: identity,
      rootMaterialization: {
        runtime: 'test-runtime',
        declaration: 'deferred',
        authoredProfile: profile,
      },
      journal,
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
      now: () => nowMs,
    })

    expect(result.out).toEqual({ prepared: true })
    expect(events).toEqual(['prepare', 'construct', 'execute', 'teardown', 'release'])
    const durable = await journal.loadTree('prepared-root')
    expect(durable?.map((event) => event.kind)).toEqual([
      'spawned',
      'prepared',
      'materialized',
      'execution-bound',
    ])
    expect(materializeTreeView(durable ?? []).nodes[0]?.executionPreparations).toHaveLength(1)
    const rootPreparation = durable?.find((event) => event.kind === 'prepared')
    expect(rootPreparation?.kind === 'prepared' && rootPreparation.evidence.receipt).toMatchObject({
      authoredProfileDigest: canonicalCandidateDigest(profile),
      effectiveProfileDigest: canonicalCandidateDigest(executionProfile),
    })
  })

  it('refuses a supervisor-role preparation wrapper when it is spawned as a worker', async () => {
    const events: string[] = []
    const journal = new InMemorySpawnJournal()
    const factory = createPreparedExecutorFactory({
      runtime: 'test-runtime',
      executorFactory: testExecutorFactory(events),
      role: 'supervisor',
      backend: 'test-backend',
      harness: 'codex',
      harnessVersion: 'test-harness-1',
      now: () => nowMs,
      async prepare(request) {
        events.push('prepare')
        return preparedResult(request, events)
      },
    })

    const result = await runChild(factory, journal, 'prepared-role-refusal')
    const child = result.tree.nodes.find((entry) => entry.id.endsWith(':s0'))
    expect(child).toMatchObject({ status: 'failed' })
    expect(child?.ownedTreeRoot).toBeUndefined()
    expect(events).toEqual([])
    expect(
      (await journal.loadTree('prepared-role-refusal'))?.some((event) => event.kind === 'prepared'),
    ).toBe(false)
    expect((await loadSpawnForest(journal, 'prepared-role-refusal')).missingTrees).toHaveLength(0)
  })
})
