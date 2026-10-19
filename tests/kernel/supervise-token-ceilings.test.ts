import { expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { supervise, workerFromBackend } from '../../src/runtime/supervise/supervise'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { testAgentProfile } from './test-agent-profile'

it('carries visible and total ceilings through supervisor and worker admission to Router requests', async () => {
  const requests: Record<string, unknown>[] = []
  const router = {
    routerBaseUrl: 'http://offline.invalid/v1',
    routerKey: 'offline',
    complete: async (request: Record<string, unknown>) => {
      requests.push(request)
      return {
        model: 'offline-model',
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
      }
    },
  }
  const profile = testAgentProfile('capped', {
    harness: 'cli-base',
    model: {
      provider: 'tangle-router',
      default: 'offline-model',
      maxVisibleOutputTokens: 100,
      maxTotalOutputTokens: 300,
    },
  })
  const worker = workerFromBackend({ backend: 'router', ...router })(profile)
  await createSupervisor<string, unknown>().run(
    {
      name: 'worker-parent',
      async act(task, scope) {
        const spawned = scope.spawn(worker, task, { budget: { maxIterations: 1, maxTokens: 1000 } })
        expect(spawned.ok).toBe(true)
        const settled = await scope.next()
        expect(settled?.kind).toBe('done')
        return settled?.kind === 'done' ? settled.out : undefined
      },
    },
    'work',
    {
      runId: 'capped-worker',
      budget: { maxIterations: 2, maxTokens: 2000 },
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
    },
  )
  expect(requests).toHaveLength(1)
  await supervise(profile, 'coordinate', {
    budget: { maxIterations: 2, maxTokens: 2000 },
    makeWorkerAgent: () => worker,
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    router,
  })
  expect(requests).toHaveLength(2)
  for (const request of requests) {
    expect(request).toMatchObject({ max_tokens: 100, max_completion_tokens: 300 })
  }
})

it('lowers transport provider routing into every Router request a worker and its supervisor send', async () => {
  // Braid's Z.ai-only release proof (all-costs #10337) sent no routing and was served by
  // fireworks/glm-5p3.
  const requests: Record<string, unknown>[] = []
  const router = {
    routerBaseUrl: 'http://offline.invalid/v1',
    routerKey: 'offline',
    routing: { only: ['zai'], allowFallbacks: false, requireModel: true },
    complete: async (request: Record<string, unknown>) => {
      requests.push(request)
      return {
        model: 'offline-model',
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
      }
    },
  }
  const profile = testAgentProfile('routed', {
    harness: 'cli-base',
    model: { provider: 'tangle-router', default: 'offline-model' },
  })
  const worker = workerFromBackend({ backend: 'router', ...router })(profile)
  await supervise(profile, 'coordinate', {
    budget: { maxIterations: 2, maxTokens: 2000 },
    makeWorkerAgent: () => worker,
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    router,
  })
  await createSupervisor<string, unknown>().run(
    {
      name: 'worker-parent',
      async act(task, scope) {
        scope.spawn(worker, task, { budget: { maxIterations: 1, maxTokens: 1000 } })
        const settled = await scope.next()
        return settled?.kind === 'done' ? settled.out : undefined
      },
    },
    'work',
    {
      runId: 'routed-worker',
      budget: { maxIterations: 2, maxTokens: 2000 },
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
    },
  )
  expect(requests.length).toBeGreaterThanOrEqual(2)
  for (const request of requests) {
    expect(request).toMatchObject({
      providerOptions: { gateway: { only: ['zai'], allowFallbacks: false } },
      require_model: true,
    })
  }
})
