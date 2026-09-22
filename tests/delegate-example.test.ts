import { describe, expect, it } from 'vitest'
import { exactText, makeWorkerEnvironment } from '../examples/delegate/shared'
import { inProcessEnvironmentProvider } from '../src/runtime/in-process-environment-provider'
import { delegate } from '../src/runtime/supervise/delegate'

const routerKey = process.env.TANGLE_API_KEY
const routerBaseUrl = process.env.TANGLE_ROUTER_URL ?? 'https://router.tangle.tools/v1'
const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
const supervisorModel = process.env.SUPERVISOR_MODEL ?? workerModel

describe('delegate example', () => {
  it('fails loud without a supervisor brain or router', async () => {
    const worker = { provider: inProcessEnvironmentProvider({ onTurn: () => [] }) }
    await expect(delegate('do something', { worker })).rejects.toThrow(/router|brain/)
  })

  it.skipIf(!routerKey)(
    'authors a worker and returns measured spend',
    async () => {
      const result = await delegate('Produce the exact word READY.', {
        worker: makeWorkerEnvironment({
          routerBaseUrl,
          routerKey: routerKey!,
          model: workerModel,
        }),
        router: { routerBaseUrl, routerKey: routerKey!, model: supervisorModel },
        model: supervisorModel,
        deliverable: exactText('READY'),
        budget: { maxIterations: 40, maxTokens: 200_000, maxUsd: 0.5 },
      })

      expect(result.kind).toBe('winner')
      expect(result.spentTotal.tokens.input + result.spentTotal.tokens.output).toBeGreaterThan(0)
    },
    180_000,
  )
})
