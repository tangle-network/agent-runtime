import { supervise } from '@tangle-network/agent-runtime/loops'
import { buildWorkerEnvironment, demoCheck, demoGoal, resolveSupervisorBrain } from './shared'

async function main(): Promise<void> {
  const worker = buildWorkerEnvironment()
  const providerName = worker.provider.name
  const { brain, label } = resolveSupervisorBrain(1, `${providerName}-solver`)

  console.log(`supervisor-loop · workers=${providerName} · driver=${label}`)

  const result = await supervise(
    {
      name: 'supervisor',
      harness: null,
      systemPrompt:
        'You are a supervisor. Spawn one worker session to produce the required line, await it with ' +
        'await_event, and stop once a worker delivered (valid). Do not answer yourself.',
    },
    demoGoal,
    {
      worker,
      deliverable: { check: demoCheck, describe: 'worker delivers the goal' },
      brain,
      budget: { maxIterations: 100, maxTokens: 2_000_000, maxUsd: 2 },
      perWorker: { maxIterations: 1, maxTokens: 200_000 },
      maxTurns: 12,
      runId: `supervisor-loop-${providerName}`,
    },
  )

  console.log(
    result.kind === 'winner'
      ? `[OK] delivered: ${JSON.stringify(result.out)}`
      : `[--] no winner (${result.reason}, ${result.downCount} down)`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
