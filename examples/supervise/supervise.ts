import {
  type EnvironmentWorkerResult,
  localEnvironmentProvider,
  supervise,
} from '@tangle-network/agent-runtime/loops'

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('set TANGLE_API_KEY')

  const router = {
    routerBaseUrl: process.env.TANGLE_ROUTER_URL ?? 'https://router.tangle.tools/v1',
    routerKey,
    model: process.env.MODEL ?? 'gemini-2.5-pro',
  }
  const provider = localEnvironmentProvider({
    router: { baseUrl: router.routerBaseUrl, key: router.routerKey, model: router.model },
  })

  const result = await supervise(
    {
      name: 'supervisor',
      harness: null,
      systemPrompt:
        'Delegate the task to one worker, wait for its result, and stop only after it delivers.',
    },
    'Produce the exact line: READY',
    {
      budget: { maxIterations: 50, maxTokens: 500_000, maxUsd: 0.5 },
      router,
      worker: { provider },
      deliverable: {
        check: (out) => (out as EnvironmentWorkerResult).content.trim() === 'READY',
        describe: 'worker output is READY',
      },
    },
  )

  if (result.kind !== 'winner') {
    throw new Error(`supervision stopped without a result: ${result.reason}`)
  }
  console.log(result.out)
  console.log(result.spentTotal)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
