/**
 * The cli-bridge path — THE local path. Each worker is a real harness CLI (claude-code /
 * codex / opencode / kimi / gemini) fronted by the OpenAI-compatible bridge in
 * ~/code/cli-bridge, behind one HTTP surface. This runs real harness agents on your machine.
 *
 * Start the bridge (defaults to port 3344; no auth unless started with BRIDGE_BEARER):
 *   cd ~/code/cli-bridge && pnpm install && pnpm install:harness -- opencode && pnpm start
 *   # → http://127.0.0.1:3344
 *
 * Then run a worker per harness session through it:
 *   WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 \
 *   pnpm tsx examples/supervisor-loop/run-bridge.ts
 *
 * `model` is `<harness>/<model>` — it doubles as the harness selector
 * (`claude-code/sonnet`, `codex/gpt-5-codex`, `opencode/<provider>/<model>`, …).
 * BRIDGE_URL defaults to http://127.0.0.1:3344 (the BASE — no `/v1`; the executor appends
 * `/v1/chat/completions`); the bearer defaults to "local" (the bridge ignores it unless
 * started with BRIDGE_BEARER). The worker leaf is
 * `createExecutor({ backend: 'bridge', bridgeUrl, bridgeBearer, model })`.
 *
 * The driver-LLM defaults to `scriptedSupervisorChat` (no inference, no router key) so the
 * bridge wiring is the only moving part. Set TANGLE_API_KEY and the supervisor uses
 * `routerDriverChat` for a real driver brain instead. The same supervisor runs on `sandbox`
 * (a box) with NO code change — only the worker-leaf seam differs. For a fully offline,
 * no-creds wiring check, see the coordination-driver unit tests
 * (tests/loops/coordination-driver.test.ts).
 */

import { type ExecutorConfig, routerDriverChat } from '@tangle-network/agent-runtime/loops'
import { demoTask, reportResult, runSupervisorLoop, scriptedSupervisorChat } from './loop'

async function main(): Promise<void> {
  // Base URL WITHOUT /v1 (the bridge executor appends /v1/chat/completions). Defaults to a
  // local ~/code/cli-bridge on its default port 3344. Bearer defaults to "local" — the bridge
  // ignores it unless it was started with BRIDGE_BEARER set.
  const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:3344'
  const bridgeBearer = process.env.BRIDGE_BEARER ?? 'local'
  const model = process.env.WORKER_MODEL
  if (!model) {
    console.error(
      'run-bridge needs WORKER_MODEL=<harness>/<model> the bridge can serve,\n' +
        '  e.g. WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5\n' +
        'Start the bridge first:\n' +
        '  cd ~/code/cli-bridge && pnpm install && pnpm install:harness -- opencode && pnpm start   (→ http://127.0.0.1:3344)\n' +
        'No bridge handy? The coordination-driver unit tests cover the offline wiring:\n' +
        '  pnpm test tests/loops/coordination-driver.test.ts',
    )
    process.exit(1)
  }

  const backend: ExecutorConfig = {
    backend: 'bridge',
    bridgeUrl,
    bridgeBearer,
    model,
    timeoutMs: 120_000,
  }

  // Default to a scripted driver (no router key needed). A router key opts into a real brain.
  const routerKey = process.env.TANGLE_API_KEY
  const routerBaseUrl = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'
  const driverModel = process.env.LOOP_MODEL ?? 'deepseek-v4-flash'
  const chat = routerKey
    ? routerDriverChat({ routerBaseUrl, routerKey, model: driverModel })
    : scriptedSupervisorChat(2, 'bridge-solver')

  console.log(
    `supervisor-loop · BRIDGE · backend=bridge · model=${model} · driver=${routerKey ? `router(${driverModel})` : 'scripted'}`,
  )

  const result = await runSupervisorLoop({
    task: demoTask,
    backend,
    chat,
    systemPrompt:
      'You are a supervisor. Spawn worker harness sessions, await each, and stop once a worker delivered.',
    perWorker: { maxIterations: 1, maxTokens: 100_000 },
    budget: { maxIterations: 100, maxTokens: 1_000_000, maxUsd: 1 },
    runId: 'supervisor-loop-bridge',
  })

  reportResult(result, `bridge/${model}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
