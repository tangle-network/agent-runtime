/**
 * Supervisor + coordinator MCP — workers on sandbox OR cli-bridge, ONE code path.
 *
 * A real coding-harness agent (opencode via the cli-bridge) IS the supervisor: it mounts the
 * coordination MCP (`serveCoordinationMcp`) over a LIVE `Scope` and calls the REAL `spawn_agent`
 * tool natively — a box driving boxes, not an emulated function-tool. Each spawned worker is a
 * leaf built by `workerFromBackend(backend, deliverable)`, gated on a DEPLOYABLE check (its
 * output must contain `ANSWER=42` — the completion oracle reads the worker's real output, never
 * the model's self-judgment).
 *
 * THE ONE KNOB — `WORKER_BACKEND`:
 * The worker leaf is `createExecutor({ backend: process.env.WORKER_BACKEND ?? 'bridge', ...seam })`.
 * Flip `WORKER_BACKEND=sandbox` and the SAME supervisor + SAME coordination MCP + SAME `spawn_agent`
 * flow + SAME deployable check spawn workers in a cloud box instead of behind the local cli-bridge —
 * with zero other changes. The worker backend is the ONLY variable; everything else is identical.
 *
 * Run it (cli-bridge workers — the proven local path):
 *   cd ~/code/cli-bridge && pnpm start          # → http://127.0.0.1:3344
 *   pnpm build                                   # examples resolve @tangle-network/agent-runtime from dist/
 *   WORKER_BACKEND=bridge WORKER_MODEL=opencode/zai-coding-plan/glm-5.1 \
 *     pnpm dlx tsx examples/supervisor-loop/run-supervisor-mcp.ts
 *
 * Same code, sandbox workers (needs a real SandboxClient — key + base URL):
 *   WORKER_BACKEND=sandbox SANDBOX_BASE_URL=https://... TANGLE_API_KEY=sk-... \
 *     pnpm dlx tsx examples/supervisor-loop/run-supervisor-mcp.ts
 *
 * The supervisor BRAIN is fixed (not a variable): a real cli-bridge harness agent with the
 * coordination MCP mounted, exactly like bench/src/atom-mcp-e2e.mts. The bridge fronts full
 * agents that do their own native tool-use, so the supervisor calls `spawn_agent` through its
 * OWN harness tool-loop — that is what makes this the real MCP path, not a scripted driver.
 */

import {
  type AgentProfile,
  harnessTypeSchema,
  reasoningEffortSchema,
} from '@tangle-network/agent-interface'
import {
  type Agent,
  collectAgentTurn,
  createExecutor,
  createExecutorRegistry,
  createSupervisor,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type Scope,
  serveCoordinationMcp,
  streamAgentTurn,
  workerFromBackend,
} from '@tangle-network/agent-runtime/kernel'
import { buildWorkerBackend, demoCheck, expectedAnswer } from './shared'

/** The supervisor's standing instructions — it delegates, it does not solve. */
const supervisorTask =
  `A worker must produce the exact line "${expectedAnswer}".\n\n` +
  'You are a SUPERVISOR with a "coordination" MCP exposing spawn_agent, await_event, and stop. ' +
  'Do NOT write the answer yourself. Author a worker profile (a JSON object with a "name" and a ' +
  `rich "systemPrompt" instructing the worker to emit the exact line "${expectedAnswer}") and call ` +
  'spawn_agent with { profile, task }. Then call await_event to wait for it to settle, and call ' +
  'stop once a worker has delivered (valid:true).'

/** One real bridge harness turn, with the coordination MCP mounted so the supervisor can call
 *  spawn_agent as a NATIVE tool. Same shape as bench/src/atom-mcp-e2e.mts's bridgeChat. */
async function supervisorBridgeChat(opts: { mcpUrl: string }): Promise<string> {
  const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:3344'
  const bridgeBearer = process.env.BRIDGE_BEARER ?? 'local'
  const model = process.env.SUPERVISOR_MODEL ?? process.env.WORKER_MODEL
  if (!model) throw new Error('supervisor needs SUPERVISOR_MODEL or WORKER_MODEL set')
  const profile: AgentProfile = {
    name: 'supervisor',
    harness: harnessTypeSchema.parse(process.env.SUPERVISOR_HARNESS ?? 'pi'),
    model: {
      provider: process.env.SUPERVISOR_PROVIDER ?? 'tangle-router',
      default: model,
      reasoningEffort: reasoningEffortSchema.parse(
        process.env.SUPERVISOR_REASONING_EFFORT ?? 'ultracode',
      ),
    },
    prompt: { systemPrompt: supervisorTask },
    mcp: {
      coordination: { transport: 'http', url: opts.mcpUrl, enabled: true },
    },
  }
  const factory = createExecutor({
    backend: 'bridge',
    bridgeUrl,
    bridgeBearer,
    model,
  })
  const timeoutRaw = process.env.SUPERVISOR_TIMEOUT_MS
  const timeoutMs = timeoutRaw === undefined ? undefined : Number(timeoutRaw)
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
    throw new Error('SUPERVISOR_TIMEOUT_MS must be a positive integer')
  }
  const turn = await collectAgentTurn(
    streamAgentTurn(
      { kind: 'executor', factory, profile, agentRunName: profile.name },
      supervisorTask,
      timeoutMs === undefined ? {} : { timeoutMs },
    ),
  )
  if (turn.status !== 'completed') {
    throw new Error(turn.error?.message ?? `supervisor bridge ended with status ${turn.status}`)
  }
  return turn.finalText
}

async function main(): Promise<void> {
  const backend = buildWorkerBackend()
  const blobs = new InMemoryResultBlobStore()

  console.log(
    `supervisor + coordination MCP · workers via createExecutor({ backend: "${backend.backend}" })` +
      `${backend.backend === 'bridge' ? ` (model=${(backend as { model: string }).model})` : ''}`,
  )

  // The supervisor agent: inside its act() we stand up the coordination MCP over the LIVE scope,
  // then hand the harness a tool it can call. This is the keystone — the harness IS the supervisor.
  const supervisor: Agent<unknown, unknown> = {
    name: 'supervisor',
    async act(_task, scope: Scope<unknown>) {
      const mcp = await serveCoordinationMcp({
        scope,
        blobs,
        // Every spawn_agent call lands here; workerFromBackend builds a createExecutor({ backend })
        // leaf gated on the deployable check (output contains ANSWER=42 — a real artifact).
        makeWorkerAgent: workerFromBackend(backend, {
          check: demoCheck,
          describe: `worker output contains ${expectedAnswer}`,
        }),
        perWorker: { maxIterations: 2, maxTokens: 200_000 },
      })
      try {
        console.log(`[mcp] coordination server at ${mcp.url}`)
        const said = await supervisorBridgeChat({ mcpUrl: mcp.url })
        console.log(`\n── supervisor said ──\n${said.slice(0, 800)}`)

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
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => Date.now(),
  })

  console.log('\n── verdict ──')
  if (result.kind === 'winner') {
    console.log(
      `[OK] supervisor drove a worker via the coordination MCP to a CHECKED delivery on backend "${backend.backend}".`,
    )
    console.log(`   winner output: ${JSON.stringify(result.out)}`)
  } else {
    console.log(`[--] no delivery (result=${result.kind}) — see supervisor transcript above`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
