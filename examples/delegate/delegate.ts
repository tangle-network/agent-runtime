import { delegate } from '@tangle-network/agent-runtime/loops'
import { exactText, makeWorkerEnvironment } from './shared'

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('set TANGLE_API_KEY')

  const routerBaseUrl = process.env.TANGLE_ROUTER_URL ?? 'https://router.tangle.tools/v1'
  const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const supervisorModel = process.env.SUPERVISOR_MODEL ?? workerModel
  const worker = makeWorkerEnvironment({ routerBaseUrl, routerKey, model: workerModel })

  const result = await delegate('Produce the exact word READY.', {
    worker,
    router: { routerBaseUrl, routerKey, model: supervisorModel },
    model: supervisorModel,
    deliverable: exactText('READY'),
    budget: { maxIterations: 40, maxTokens: 200_000, maxUsd: 0.5 },
  })

  if (result.kind !== 'winner') {
    throw new Error(`delegation stopped without a result: ${result.reason}`)
  }
  console.log(result.out)
  console.log(result.spentTotal)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
