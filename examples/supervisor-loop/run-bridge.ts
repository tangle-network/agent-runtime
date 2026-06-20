/**
 * The local-worker path — WORKERS run through the OpenAI-compatible bridge in
 * ~/code/cli-bridge, so the heavy compute (each worker is a real local harness CLI:
 * opencode / claude-code / codex / kimi / gemini) runs on your machine + subscription,
 * zero cloud sandbox. The worker leaf is a RESUMABLE cli-bridge session — structurally
 * identical to the sandbox executor's persistent box, just local.
 *
 * The supervisor is the canonical one-call `supervise()`; this runner supplies only the
 * load-bearing cli-bridge seam (`backend: 'bridge'`) and the scripted-brain $0/offline story.
 *
 * ── The supervisor BRAIN is a separate dial ──────────────────────────────────────────
 * The brain must emit `spawn_agent` via OpenAI tool-calling. cli-bridge fronts FULL agents
 * (opencode etc.) that do their own internal tool-use and do NOT return raw `tool_calls`, so
 * the brain CANNOT run through cli-bridge here. Two real options:
 *   • router  — set TANGLE_API_KEY (+ DRIVER_MODEL, a tool-calling model). The boss is only a
 *               handful of decisions, so this stays cheap; workers stay free.
 *   • scripted — the default: a deterministic spawn→await→stop brain (no inference, $0), which
 *               still drives a live Scope. Proves the worker wiring end-to-end.
 * For a 100%-local boss, run opencode AS the supervisor with the coordination MCP
 * (`serveCoordinationMcp`) so it calls `spawn_agent` via its own tool-use — see run-supervisor-mcp.ts.
 *
 * Start the bridge (defaults to port 3344; no auth unless started with BRIDGE_BEARER):
 *   cd ~/code/cli-bridge && pnpm install && pnpm start          # → http://127.0.0.1:3344
 *
 * Run it (scripted boss, free workers — the headline):
 *   WORKER_MODEL=opencode/zai-coding-plan/glm-5.1 pnpm tsx examples/supervisor-loop/run-bridge.ts
 */

import { type ExecutorConfig, routerBrain, supervise } from '@tangle-network/agent-runtime/loops'
import { demoCheck, demoGoal, scriptedSupervisorChat } from './shared'

async function main(): Promise<void> {
  const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:3344'
  const bridgeBearer = process.env.BRIDGE_BEARER ?? 'local'
  const workerModel = process.env.WORKER_MODEL
  if (!workerModel) {
    console.error(
      'run-bridge needs WORKER_MODEL=<harness>/<model> the bridge can serve,\n' +
        '  e.g. WORKER_MODEL=opencode/zai-coding-plan/glm-5.1\n' +
        'Start the bridge first:\n' +
        '  cd ~/code/cli-bridge && pnpm install && pnpm start   (→ http://127.0.0.1:3344)\n' +
        'No bridge handy? The offline wiring is covered by:\n' +
        '  pnpm test tests/loops/coordination-driver.test.ts tests/supervisor-loop-example.test.ts',
    )
    process.exit(1)
  }

  // The worker leaf — a RESUMABLE cli-bridge session (the local twin of the sandbox box).
  const backend: ExecutorConfig = {
    backend: 'bridge',
    bridgeUrl,
    bridgeBearer,
    model: workerModel,
    timeoutMs: 180_000,
  }

  // The supervisor BRAIN — router (real, tool-calling) if a key is present, else scripted ($0).
  // NOT cli-bridge: full-agent harnesses don't return raw tool_calls (see header).
  const routerKey = process.env.TANGLE_API_KEY
  const driverModel = process.env.DRIVER_MODEL
  const brain =
    routerKey && driverModel
      ? routerBrain({
          routerBaseUrl: process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1',
          routerKey,
          model: driverModel,
        })
      : scriptedSupervisorChat(1, 'bridge-solver')
  const driverLabel = routerKey && driverModel ? `router(${driverModel})` : 'scripted'

  console.log(
    `supervisor-loop · BRIDGE · worker=${workerModel} (cli-bridge) · driver=${driverLabel}`,
  )

  const result = await supervise(
    {
      name: 'supervisor',
      harness: null,
      systemPrompt:
        'You are a supervisor. Spawn one worker harness session to produce the required line, ' +
        'await it with await_event, and stop once a worker delivered (valid). Do not answer yourself.',
    },
    demoGoal,
    {
      backend,
      deliverable: { check: demoCheck, describe: 'worker delivers the goal' },
      brain,
      budget: { maxIterations: 100, maxTokens: 1_000_000, maxUsd: 1 },
      perWorker: { maxIterations: 1, maxTokens: 100_000 },
      maxTurns: 12,
      runId: 'supervisor-loop-bridge',
    },
  )

  console.log(
    result.kind === 'winner'
      ? `✅ delivered: ${JSON.stringify(result.out)}`
      : `❌ no winner (${result.reason}, ${result.downCount} down)`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
