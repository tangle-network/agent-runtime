/**
 * The sandbox path — each worker is a coding harness running in a real Tangle sandbox box.
 *
 *   TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... pnpm tsx examples/supervisor-loop/run-sandbox.ts
 *
 * Needs: a real `SandboxClient` (creds + base URL for your Tangle sandbox control plane).
 * The worker leaf is `createExecutor({ backend: 'sandbox', harness, sandboxClient })`, which
 * COMPOSES `runLoop` as a single-task leaf inside a box running `harness` (e.g. `opencode`).
 *
 * The driver-LLM defaults to `scriptedSupervisorChat` (no inference) so the box wiring is the
 * only moving part to debug first; set TANGLE_API_KEY (it is already needed for the box) and
 * the supervisor uses `routerBrain` for a real driver brain instead — same supervisor,
 * just the driver seam changes.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * TEST THIS LOCALLY WITH ZERO CODE CHANGES:
 * The `bridge` backend (~/code/cli-bridge) runs the IDENTICAL supervisor against local
 * harness CLIs — only the worker-leaf seam changes, sandbox → bridge. See run-bridge.ts.
 * For a fully offline, no-creds wiring check, the coordination-driver unit tests cover the
 * spawn → await → checked-settle loop (tests/loops/coordination-driver.test.ts).
 * ────────────────────────────────────────────────────────────────────────────────────────
 */

import {
  type ExecutorConfig,
  type SandboxClient as RuntimeSandboxClient,
  routerBrain,
} from '@tangle-network/agent-runtime/loops'
import type { BackendType } from '@tangle-network/sandbox'
import { SandboxClient } from '@tangle-network/sandbox'
import { demoTask, reportResult, runSupervisorLoop, scriptedSupervisorChat } from './loop'

async function main(): Promise<void> {
  const apiKey = process.env.TANGLE_API_KEY
  const baseUrl = process.env.SANDBOX_BASE_URL
  if (!apiKey || !baseUrl) {
    console.error(
      'run-sandbox needs a real sandbox client: set TANGLE_API_KEY + SANDBOX_BASE_URL.\n' +
        'No box? The bridge backend runs the SAME supervisor against local harness CLIs:\n' +
        '  cd ~/code/cli-bridge && pnpm install && pnpm install:harness -- opencode && pnpm start\n' +
        '  WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 pnpm tsx examples/supervisor-loop/run-bridge.ts',
    )
    process.exit(1)
  }

  // The real Tangle sandbox client. It satisfies the runtime's `SandboxClient` port
  // (it exposes `create(...)`), so it drops straight into the sandbox seam.
  const sandboxClient = new SandboxClient({ apiKey, baseUrl }) as unknown as RuntimeSandboxClient
  const harness = (process.env.LOOP_HARNESS ?? 'opencode') as BackendType

  const backend: ExecutorConfig = {
    backend: 'sandbox',
    harness,
    sandboxClient,
    maxIterations: 1,
  }

  // Default to a scripted driver so the box wiring is the only moving part. The router key is
  // already in hand (the box needs it), so opt into a real driver brain unless DRIVER=scripted.
  const useRouterDriver = process.env.DRIVER !== 'scripted'
  const routerBaseUrl = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'
  const driverModel = process.env.LOOP_MODEL ?? 'deepseek-v4-flash'
  const brain = useRouterDriver
    ? routerBrain({ routerBaseUrl, routerKey: apiKey, model: driverModel })
    : scriptedSupervisorChat(2, 'box-solver')

  console.log(
    `supervisor-loop · SANDBOX · backend=sandbox · harness=${harness} · driver=${useRouterDriver ? `router(${driverModel})` : 'scripted'}`,
  )

  const result = await runSupervisorLoop({
    task: demoTask,
    backend,
    brain,
    systemPrompt:
      'You are a supervisor. Spawn worker coding sessions in boxes, await each, and stop on delivery.',
    perWorker: { maxIterations: 1, maxTokens: 200_000 },
    budget: { maxIterations: 100, maxTokens: 2_000_000, maxUsd: 2 },
    runId: 'supervisor-loop-sandbox',
  })

  reportResult(result, `sandbox/${harness}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
