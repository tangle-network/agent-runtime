import {
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
} from '../../src/durable/spawn-journal'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import {
  attestRuntimeOwnedExecutor,
  attestRuntimeOwnedPendingExecutor,
  attestRuntimeOwnedScopeOwner,
  finalizeRuntimeOwnedPendingExecutor,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedPendingExecutorMaterialization,
} from '../../src/runtime/supervise/materialization'
import { bridgeExecutor, createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import {
  recordScopeOwnerMaterialization,
  scopeOwnerExecutorNodeContext,
} from '../../src/runtime/supervise/scope'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorExecutionBinding,
  ExecutorFactory,
  ExecutorResult,
  Scope,
  SpawnEvent,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

const budget = { maxIterations: 4, maxTokens: 1_000 }
const spent = { iterations: 1, tokens: { input: 2, output: 3 }, usd: 0, ms: 1 }

function leafAgent(name: string, factory: ExecutorFactory<unknown>): Agent<unknown, unknown> {
  const executorSpec: AgentSpec = {
    profile: testAgentProfile(name, {
      model: { provider: 'offline', default: 'test/model' },
    }),
    harness: null,
    executorFactory: factory,
  }
  return { name, executorSpec, act: async () => undefined } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function successfulExecutor(runtime = 'test-runtime'): Executor<unknown> {
  const artifact: ExecutorResult<unknown> = { outRef: 'ignored', out: { ok: true }, spent }
  return {
    runtime,
    execute: async () => artifact,
    teardown: async () => ({ destroyed: true }),
    resultArtifact: () => artifact,
  }
}

/** A two-phase bridge-style executor: it declares its plan up front and only acknowledges the
 * terminal receipt after the work finishes. `dies` throws before it can acknowledge. */
function pendingExecutorAgent(
  name: string,
  behavior: 'dies' | 'acknowledges',
): Agent<unknown, unknown> {
  return leafAgent(name, (spec, ctx) => {
    const runtime = 'test-runtime'
    const declaration = {
      effectiveProfile: spec.profile,
      backend: 'test-bridge',
      model: { status: 'known' as const, id: 'test/model' },
      execution: { kind: 'session', id: ctx.node?.nodeId ?? 'direct' },
      materializer: 'test-materializer',
      plan: { kind: 'test-plan', model: 'test/model' },
    }
    const binding = {
      attemptId: ctx.node?.attemptId ?? 'direct-attempt',
      binding: { endpoint: 'https://bridge.example.test' },
      descriptor: { kind: 'test-session', transport: 'http' },
    } satisfies ExecutorExecutionBinding
    const artifact: ExecutorResult<unknown> = { outRef: 'ignored', out: { ok: true }, spent }
    const executor: Executor<unknown> = {
      runtime,
      execute: async () => {
        if (behavior === 'dies') {
          throw new Error('bridge 503: cli-bridge admission timed out after 30000ms')
        }
        finalizeRuntimeOwnedPendingExecutor(executor, declaration, binding)
        return artifact
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => artifact,
    }
    return attestRuntimeOwnedPendingExecutor(executor, runtime, declaration, binding)
  })
}

async function runOneChild(
  child: Agent<unknown, unknown>,
  journal: InMemorySpawnJournal,
  runId: string,
  executors = createExecutorRegistry(),
) {
  const root: Agent<unknown, unknown> = {
    name: 'root',
    async act(_task, scope) {
      expect('recordMaterialization' in scope).toBe(false)
      expect(() =>
        (
          scope as Scope<unknown> & { recordMaterialization: (value: unknown) => void }
        ).recordMaterialization({ forged: true }),
      ).toThrow(TypeError)
      const spawned = scope.spawn(child, 'work', { label: 'child', budget })
      if (!spawned.ok) throw new Error(spawned.reason)
      return scope.next()
    },
  }
  return createSupervisor<unknown, unknown>().run(root, 'root task', {
    budget: { maxIterations: 20, maxTokens: 20_000 },
    runId,
    journal,
    blobs: new InMemoryResultBlobStore(),
    executors,
  })
}

function childEvents(events: SpawnEvent[] | undefined): SpawnEvent[] {
  return (events ?? []).filter((event) => event.id.endsWith(':s0'))
}

function deferredOwnerProfile() {
  return testAgentProfile('deferred-owner', {
    model: { provider: 'offline', default: 'test/model' },
  })
}

function deferredOwnerDeclaration(profile: ReturnType<typeof deferredOwnerProfile>) {
  return {
    effectiveProfile: profile,
    backend: 'test-bridge',
    model: { status: 'known' as const, id: 'test/model' },
    execution: { kind: 'session', id: 'test-session' },
    materializer: 'test-materializer',
    plan: { kind: 'test-plan', model: 'test/model' },
  }
}

function deferredOwnerBinding(attemptId: string, endpoint = 'https://router.example.test') {
  return {
    attemptId,
    binding: { endpoint },
    descriptor: { kind: 'test-session', transport: 'http' },
  } satisfies ExecutorExecutionBinding
}

function deferredOwnerIdentity(profile: ReturnType<typeof deferredOwnerProfile>) {
  return {
    profileDigest: canonicalAgentProfileDigest(profile),
    taskDigest: canonicalCandidateDigest('root task'),
  }
}

function deferredOwnerRunOptions(
  profile: ReturnType<typeof deferredOwnerProfile>,
  journal: InMemorySpawnJournal,
  blobs: InMemoryResultBlobStore,
  runId: string,
  resume = false,
) {
  return {
    budget: { maxIterations: 4, maxTokens: 1_000 },
    runId,
    journal,
    blobs,
    executors: createExecutorRegistry(),
    rootIdentity: deferredOwnerIdentity(profile),
    rootMaterialization: {
      runtime: 'cli' as const,
      declaration: 'deferred' as const,
      authoredProfile: profile,
    },
    ...(resume ? { resume: true as const } : {}),
  }
}

describe('kernel-owned materialization evidence', () => {
  it('ignores a caller executor that lies through lookalike report methods', async () => {
    const journal = new InMemorySpawnJournal()
    const liar = leafAgent('liar', (_spec, _ctx) =>
      Object.assign(successfulExecutor(), {
        materialization: () => ({ status: 'known', backend: 'forged' }),
        executionBinding: () => ({ bindingDigest: canonicalCandidateDigest({ forged: true }) }),
      }),
    )

    await runOneChild(liar, journal, 'lying-executor')
    const events = childEvents(await journal.loadTree('lying-executor'))
    expect(events.find((event) => event.kind === 'materialized')).toMatchObject({
      receipt: { status: 'unknown', reason: 'executor-did-not-report' },
    })
    expect(events.find((event) => event.kind === 'execution-bound')).toMatchObject({
      binding: { status: 'unknown', reason: 'executor-did-not-report' },
    })
  })

  it('records invalid trusted evidence and refuses execution', async () => {
    const journal = new InMemorySpawnJournal()
    let executeCalls = 0
    const invalid = leafAgent('invalid', (spec, ctx) => {
      const executor = successfulExecutor()
      const originalExecute = executor.execute.bind(executor)
      executor.execute = (task, signal) => {
        executeCalls += 1
        return originalExecute(task, signal)
      }
      return attestRuntimeOwnedExecutor(
        executor,
        {
          effectiveProfile: spec.profile,
          backend: '',
          model: { status: 'known', id: 'test/model' },
          execution: { kind: 'run', id: ctx.node?.nodeId ?? 'direct' },
          materializer: 'test',
          plan: { kind: 'test' },
        },
        {
          attemptId: ctx.node?.attemptId ?? 'direct-attempt',
          binding: { endpoint: 'https://example.test' },
          descriptor: { kind: 'test', transport: 'http' },
        },
      )
    })

    await runOneChild(invalid, journal, 'invalid-evidence')
    expect(executeCalls).toBe(0)
    expect(childEvents(await journal.loadTree('invalid-evidence'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'materialized',
          receipt: expect.objectContaining({
            status: 'unknown',
            reason: 'invalid-executor-report',
          }),
        }),
        expect.objectContaining({
          kind: 'execution-bound',
          binding: expect.objectContaining({
            status: 'unknown',
            reason: 'invalid-executor-report',
          }),
        }),
      ]),
    )
  })

  it('projects the same trusted receipt and binding from journal replay', async () => {
    const journal = new InMemorySpawnJournal()
    const trusted = leafAgent('trusted', (spec, ctx) => {
      const executionId = ctx.node?.nodeId ?? 'direct'
      return attestRuntimeOwnedExecutor(
        successfulExecutor('router'),
        {
          effectiveProfile: spec.profile,
          backend: 'router',
          model: { status: 'known', id: 'test/model' },
          execution: { kind: 'request', id: executionId },
          materializer: 'test-router',
          plan: { kind: 'completion', model: 'test/model' },
        },
        {
          attemptId: ctx.node?.attemptId ?? 'direct-attempt',
          binding: { endpoint: 'https://router.example.test', executionId },
          descriptor: { kind: 'router-request', transport: 'http' },
        },
      )
    })

    const result = await runOneChild(trusted, journal, 'known-evidence')
    const events = await journal.loadTree('known-evidence')
    const replayed = materializeTreeView(events ?? [])
    const live = result.tree.nodes.find((node) => node.id.endsWith(':s0'))
    const replay = replayed.nodes.find((node) => node.id.endsWith(':s0'))
    expect(live?.materialization).toMatchObject({ status: 'known', backend: 'router' })
    expect(live?.executionBindings).toHaveLength(1)
    expect(replay?.materialization).toEqual(live?.materialization)
    expect(replay?.executionBindings).toEqual(live?.executionBindings)
  })

  it('names the terminal outcome, not a pending wait, when a pending executor dies', async () => {
    const journal = new InMemorySpawnJournal()
    await runOneChild(pendingExecutorAgent('doomed', 'dies'), journal, 'pending-executor-died')
    const events = childEvents(await journal.loadTree('pending-executor-died'))

    // The attempt is over, so no receipt can still arrive. A terminal row that says the receipt
    // is pending reads as "not yet known" on a record that is final.
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'materialized',
          receipt: expect.objectContaining({
            status: 'unknown',
            reason: 'executor-failed-before-receipt',
          }),
        }),
        expect.objectContaining({
          kind: 'execution-bound',
          binding: expect.objectContaining({
            status: 'unknown',
            reason: 'executor-failed-before-receipt',
          }),
        }),
        expect.objectContaining({ kind: 'settled', status: 'down' }),
      ]),
    )
    const reasons = events.flatMap((event) => {
      const receipt = (event as { receipt?: { reason?: string } }).receipt
      const binding = (event as { binding?: { reason?: string } }).binding
      return [receipt?.reason, binding?.reason].filter((value) => value !== undefined)
    })
    expect(reasons).not.toContain('executor-receipt-pending')
  })

  it('records known evidence when a pending executor acknowledges, so no survivor is ever pending', async () => {
    const journal = new InMemorySpawnJournal()
    await runOneChild(
      pendingExecutorAgent('healthy', 'acknowledges'),
      journal,
      'pending-executor-ok',
    )
    const events = childEvents(await journal.loadTree('pending-executor-ok'))

    // The healthy path overwrites the pending placeholder with terminal evidence. Together with
    // the test above this is why a pending reason correlated 1:1 with death in a consumer fleet:
    // only the failure path ever wrote it, so the value records a death, it does not predict one.
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'materialized',
          receipt: expect.objectContaining({ status: 'known', backend: 'test-bridge' }),
        }),
        expect.objectContaining({ kind: 'settled', status: 'done' }),
      ]),
    )
  })

  it('types a trusted deferred manager down when it never publishes before completing', async () => {
    const journal = new InMemorySpawnJournal()
    const silentManager = attestRuntimeOwnedScopeOwner<Agent<unknown, unknown>>(
      { name: 'silent-manager', act: async () => ({ shouldNotWin: true }) },
      'cli',
    )
    const child = driverChild(testAgentProfile('manager'), silentManager, journal)
    const executors = withDriverExecutor(createExecutorRegistry())

    await runOneChild(child, journal, 'missing-deferred', executors)
    expect(childEvents(await journal.loadTree('missing-deferred'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'materialized',
          receipt: expect.objectContaining({
            status: 'unknown',
            reason: 'root-agent-did-not-report',
          }),
        }),
        expect.objectContaining({
          kind: 'settled',
          status: 'down',
        }),
      ]),
    )
  })

  it('does not append a second owner binding after a resumed invalid report', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const runId = 'resumed-invalid-owner-report'
    const profile = deferredOwnerProfile()
    const firstRoot: Agent<unknown, unknown> = {
      name: 'first-root',
      async act() {
        throw new Error('first attempt did not reach the backend')
      },
    }

    await createSupervisor<unknown, unknown>().run(
      firstRoot,
      'root task',
      deferredOwnerRunOptions(profile, journal, blobs, runId),
    )

    const resumedRoot: Agent<unknown, unknown> = {
      name: 'resumed-root',
      async act(_task, scope) {
        const attemptId = scopeOwnerExecutorNodeContext(scope).attemptId
        await expect(
          recordScopeOwnerMaterialization(
            scope,
            'cli',
            deferredOwnerDeclaration(profile),
            deferredOwnerBinding(`${attemptId}-wrong`),
          ),
        ).rejects.toThrow('scope owner returned invalid materialization evidence')
        return { recovered: true }
      },
    }

    const result = await createSupervisor<unknown, unknown>().run(
      resumedRoot,
      'root task',
      deferredOwnerRunOptions(profile, journal, blobs, runId, true),
    )
    expect(result.kind).toBe('winner')

    const events = (await journal.loadTree(runId)) ?? []
    const bindings = events.filter(
      (event): event is Extract<SpawnEvent, { kind: 'execution-bound' }> =>
        event.kind === 'execution-bound' && event.id === runId,
    )
    expect(bindings).toHaveLength(2)
    expect(bindings.map((event) => event.binding.reason)).toEqual([
      'root-agent-did-not-report',
      'invalid-executor-report',
    ])
    expect(new Set(bindings.map((event) => event.binding.attemptId)).size).toBe(2)
  })

  it('appends one new known owner binding when a resumed report matches prior materialization', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const runId = 'resumed-valid-owner-report'
    const profile = deferredOwnerProfile()
    const declaration = deferredOwnerDeclaration(profile)
    const firstRoot: Agent<unknown, unknown> = {
      name: 'first-root',
      async act(_task, scope) {
        await recordScopeOwnerMaterialization(
          scope,
          'cli',
          declaration,
          deferredOwnerBinding(scopeOwnerExecutorNodeContext(scope).attemptId),
        )
        throw new Error('first attempt stopped after publishing evidence')
      },
    }

    await createSupervisor<unknown, unknown>().run(
      firstRoot,
      'root task',
      deferredOwnerRunOptions(profile, journal, blobs, runId),
    )

    const resumedRoot: Agent<unknown, unknown> = {
      name: 'resumed-root',
      async act(_task, scope) {
        await recordScopeOwnerMaterialization(
          scope,
          'cli',
          declaration,
          deferredOwnerBinding(
            scopeOwnerExecutorNodeContext(scope).attemptId,
            'https://router-retry.example.test',
          ),
        )
        return { recovered: true }
      },
    }

    const result = await createSupervisor<unknown, unknown>().run(
      resumedRoot,
      'root task',
      deferredOwnerRunOptions(profile, journal, blobs, runId, true),
    )
    expect(result.kind).toBe('winner')

    const events = (await journal.loadTree(runId)) ?? []
    const materializations = events.filter(
      (event) => event.kind === 'materialized' && event.id === runId,
    )
    const bindings = events.filter(
      (event): event is Extract<SpawnEvent, { kind: 'execution-bound' }> =>
        event.kind === 'execution-bound' && event.id === runId,
    )
    expect(materializations).toHaveLength(1)
    expect(bindings).toHaveLength(2)
    expect(bindings.every((event) => event.binding.status === 'known')).toBe(true)
    expect(new Set(bindings.map((event) => event.binding.attemptId)).size).toBe(2)
  })

  it('keeps the built-in bridge profile identity stable while endpoints change per attempt', () => {
    const profile = testAgentProfile('manager', {
      model: { provider: 'test', default: 'model' },
    })
    const executorFor = (bridgeUrl: string, attemptId: string) =>
      bridgeExecutor(
        { profile, harness: 'opencode' },
        {
          signal: new AbortController().signal,
          node: {
            rootId: 'root',
            parentId: 'root',
            nodeId: 'root:s0',
            attemptId,
          },
          seams: {
            bridge: {
              bridgeUrl,
              bridgeBearer: 'never-journal-this',
              model: 'test/model',
              sessionId: 'stable-session',
            },
          },
        },
      )
    const receiptFor = (bridgeUrl: string, attemptId: string) => {
      const executor = executorFor(bridgeUrl, attemptId)
      const pending = runtimeOwnedPendingExecutorMaterialization(executor)
      expect(runtimeOwnedExecutorMaterialization(executor)).toBeUndefined()
      expect(runtimeOwnedExecutorExecutionBinding(executor)).toBeUndefined()
      expect(pending).toBeDefined()
      return {
        declarationDigest: canonicalCandidateDigest(pending!.declaration),
        bindingDigest: canonicalCandidateDigest(pending!.binding),
      }
    }
    const first = receiptFor('http://127.0.0.1:31001', 'attempt-1')
    const second = receiptFor('http://127.0.0.1:31002', 'attempt-2')

    expect(first.declarationDigest).toBe(second.declarationDigest)
    expect(first.bindingDigest).not.toBe(second.bindingDigest)
  })
})
