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
