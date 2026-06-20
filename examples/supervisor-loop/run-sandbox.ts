/**
 * The sandbox path — each worker is a coding harness running in a real Tangle sandbox box.
 *
 *   TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... pnpm tsx examples/supervisor-loop/run-sandbox.ts
 *
 * The supervisor is the canonical one-call `supervise()`; this runner supplies only the
 * load-bearing sandbox seam — a real `SandboxClient` + `backend: 'sandbox'` (each worker leaf
 * is `createExecutor({ backend: 'sandbox', harness, sandboxClient })`, which composes `runLoop`
 * as a single-task leaf inside a box running `harness`).
 *
 * The driver brain defaults to the router (the box key is already in hand); set DRIVER=scripted
 * for the offline brain. The IDENTICAL supervisor runs against local harness CLIs by swapping
 * the one backend value to `bridge` — see run-bridge.ts. For a fully offline, no-creds wiring
 * check, see tests/loops/coordination-driver.test.ts and tests/supervisor-loop-example.test.ts.
 */

import {
  type ExecutorConfig,
  type SandboxClient as RuntimeSandboxClient,
  routerBrain,
  supervise,
} from '@tangle-network/agent-runtime/loops'
import type { BackendType } from '@tangle-network/sandbox'
import { SandboxClient } from '@tangle-network/sandbox'
import { demoCheck, demoGoal, scriptedSupervisorChat } from './shared'

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

  // The real Tangle sandbox client satisfies the runtime's `SandboxClient` port (it exposes
  // `create(...)`), so it drops straight into the sandbox seam.
  const sandboxClient = new SandboxClient({ apiKey, baseUrl }) as unknown as RuntimeSandboxClient
  const harness = (process.env.LOOP_HARNESS ?? 'opencode') as BackendType
  const backend: ExecutorConfig = { backend: 'sandbox', harness, sandboxClient, maxIterations: 1 }

  // Default to the router brain (the box key is already in hand); DRIVER=scripted for $0 offline.
  const useRouterDriver = process.env.DRIVER !== 'scripted'
  const routerBaseUrl = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'
  const driverModel = process.env.LOOP_MODEL ?? 'deepseek-v4-flash'
  const brain = useRouterDriver
    ? routerBrain({ routerBaseUrl, routerKey: apiKey, model: driverModel })
    : scriptedSupervisorChat(2, 'box-solver')

  console.log(
    `supervisor-loop · SANDBOX · harness=${harness} · driver=${useRouterDriver ? `router(${driverModel})` : 'scripted'}`,
  )

  const result = await supervise(
    {
      name: 'supervisor',
      harness: null,
      systemPrompt:
        'You are a supervisor. Spawn worker coding sessions in boxes, await each, and stop on delivery.',
    },
    demoGoal,
    {
      backend,
      deliverable: { check: demoCheck, describe: 'worker delivers the goal' },
      brain,
      budget: { maxIterations: 100, maxTokens: 2_000_000, maxUsd: 2 },
      perWorker: { maxIterations: 1, maxTokens: 200_000 },
      runId: 'supervisor-loop-sandbox',
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
