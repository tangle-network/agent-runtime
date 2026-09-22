import { createCliBridgeProvider } from '@tangle-network/agent-provider-cli-bridge'
import {
  type Agent,
  collectAgentTurn,
  createInMemoryRunContext,
  createSupervisor,
  type Scope,
  serveCoordinationMcp,
  streamAgentTurn,
  workerFromEnvironment,
} from '@tangle-network/agent-runtime/loops'
import { buildWorkerEnvironment, demoCheck, expectedAnswer } from './shared'

const supervisorTask =
  `A worker must produce the exact line "${expectedAnswer}".\n\n` +
  'You are a SUPERVISOR with a "coordination" MCP exposing spawn_agent, await_event, and stop. ' +
  'Do NOT write the answer yourself. Author a worker profile (a JSON object with a "name" and a ' +
  `rich "systemPrompt" instructing the worker to emit the exact line "${expectedAnswer}") and call ` +
  'spawn_agent with { profile, task }. Then call await_event to wait for it to settle, and call ' +
  'stop once a worker has delivered (valid:true).'

async function runSupervisorTurn(mcpUrl: string): Promise<string> {
  const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:3344'
  const bridgeBearer = process.env.BRIDGE_BEARER ?? 'local'
  const model = process.env.SUPERVISOR_MODEL ?? process.env.WORKER_MODEL
  if (!model) throw new Error('supervisor needs SUPERVISOR_MODEL or WORKER_MODEL set')
  const provider = createCliBridgeProvider({
    baseUrl: bridgeUrl,
    bearerToken: bridgeBearer,
    defaultModel: model,
  })
  const turn = await collectAgentTurn(
    streamAgentTurn(
      {
        kind: 'provider',
        provider,
        profile: {
          name: 'supervisor',
          mcp: {
            coordination: {
              transport: 'http',
              url: mcpUrl,
            },
          },
        },
      },
      supervisorTask,
      { timeoutMs: 900_000 },
    ),
  )
  if (turn.status !== 'completed') {
    throw new Error(turn.error?.message ?? `supervisor turn ${turn.status}`)
  }
  return turn.finalText
}

async function main(): Promise<void> {
  const worker = buildWorkerEnvironment()
  const workerProviderName = worker.provider.name
  const context = createInMemoryRunContext()
  const blobs = context.blobs

  console.log(`supervisor + coordination MCP · workers=${workerProviderName}`)

  const supervisor: Agent<unknown, unknown> = {
    name: 'supervisor',
    async act(_task, scope: Scope<unknown>) {
      const mcp = await serveCoordinationMcp({
        scope,
        blobs,
        makeWorkerAgent: workerFromEnvironment(worker, {
          check: demoCheck,
          describe: `worker output contains ${expectedAnswer}`,
        }),
        perWorker: { maxIterations: 2, maxTokens: 200_000 },
      })
      try {
        console.log(`[mcp] coordination server at ${mcp.url}`)
        const said = await runSupervisorTurn(mcp.url)
        console.log(`\nsupervisor said:\n${said.slice(0, 800)}`)

        const settled = mcp.settled()
        const delivered = settled.filter((w) => w.status === 'done' && w.valid === true)
        console.log(
          `\n[mcp] spawn_agent calls observed: ${settled.length}; delivered (check passed): ${delivered.length}`,
        )
        console.log(
          `[mcp] bus events: ${mcp.history().length}; stats: ${JSON.stringify(mcp.stats())}`,
        )
        return delivered[0]?.outRef ? await blobs.get(delivered[0].outRef) : undefined
      } finally {
        await mcp.close()
      }
    },
  }

  const result = await createSupervisor<unknown, unknown>().run(supervisor, supervisorTask, {
    budget: { maxIterations: 100, maxTokens: 2_000_000, maxUsd: 1 },
    runId: 'supervisor-mcp',
    journal: context.journal,
    blobs,
    executors: context.executors,
    maxDepth: 4,
    now: () => Date.now(),
  })

  console.log('\nverdict:')
  if (result.kind === 'winner') {
    console.log(
      `[OK] supervisor delivered checked output through worker provider "${workerProviderName}".`,
    )
    console.log(`   winner output: ${JSON.stringify(result.out)}`)
  } else {
    console.log(`[--] no delivery (result=${result.kind}); see supervisor transcript above`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
