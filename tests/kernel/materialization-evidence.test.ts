import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
} from '../../src/durable/spawn-journal'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import {
  attestRuntimeOwnedExecutor,
  attestRuntimeOwnedScopeOwner,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedPendingExecutorMaterialization,
} from '../../src/runtime/supervise/materialization'
import { bridgeExecutor, createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
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

  it('types a trusted deferred manager down when it never publishes before completing', async () => {
    const journal = new InMemorySpawnJournal()
    const silentManager = attestRuntimeOwnedScopeOwner<Agent<unknown, unknown>>(
      { name: 'silent-manager', act: async () => ({ shouldNotWin: true }) },
      'cli',
    )
    const child = driverChild(
      testAgentProfile('manager', { metadata: { role: 'driver' } }),
      silentManager,
      journal,
    )
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
