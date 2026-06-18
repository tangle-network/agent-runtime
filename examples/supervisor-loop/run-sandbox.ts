/**
 * The sandbox path — each worker is a coding harness running in a real Tangle sandbox box.
 *
 *   TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... pnpm tsx examples/supervisor-loop/run-sandbox.ts
 *
 * Needs: a real `SandboxClient` (creds + base URL for your Tangle sandbox control plane).
 * The worker leaf is `createExecutor({ backend: 'sandbox', harness, sandboxClient })`, which
 * COMPOSES `runLoop` as a single-task leaf inside a box running `harness` (e.g. `opencode`).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * TEST THIS LOCALLY WITH ZERO CODE CHANGES:
 *
 *   pnpm tsx examples/supervisor-loop/run-local.ts        # the SAME supervisor, backend 'cli'
 *
 * `run-local.ts` drives the IDENTICAL `coordinationDriverAgent` + `runSupervisorLoop` over
 * the `cli` backend — no box, no creds, $0. Only the worker-leaf backend (`createExecutor`'s
 * `backend` field) and the driver-LLM seam differ between the two files. That is the whole
 * point of the swap seam: prove the supervisor topology locally, then point it at a real box.
 * ────────────────────────────────────────────────────────────────────────────────────────
 */

import type {
  DriverChat,
  DriverTurn,
  ExecutorConfig,
  SandboxClient as RuntimeSandboxClient,
} from '@tangle-network/agent-runtime/loops'
import type { BackendType } from '@tangle-network/sandbox'
import { SandboxClient } from '@tangle-network/sandbox'
import { reportResult, runSupervisorLoop, type SupervisorTask } from './loop'

const EXPECTED = 'ANSWER=42'

const task: SupervisorTask = {
  // A sandbox worker returns its harness event stream as `{ events }`; the check scans the
  // serialized events for the delivered marker. A production check runs a real test in the box.
  goal: `Produce the line "${EXPECTED}".`,
  check: (out) => JSON.stringify(out ?? '').includes(EXPECTED),
}

/** A scripted driver works here too; swap in `routerDriverChat` (see run-router.ts) for a
 *  real driver brain once you have a router key. Kept scripted so the box wiring is the
 *  only moving part to debug first. */
function scriptedChat(workerCount: number): DriverChat {
  const turns: DriverTurn[] = []
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({
      toolCalls: [
        {
          name: 'spawn_worker',
          arguments: {
            profile: { name: `box-solver-${i}`, systemPrompt: `Emit ${EXPECTED}.` },
            task: `Emit ${EXPECTED}.`,
            label: `box-solver-${i}`,
          },
        },
      ],
    })
  }
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({ toolCalls: [{ name: 'await_event', arguments: {} }] })
  }
  turns.push({ content: 'stopping' })
  let i = 0
  return {
    next: () => {
      const turn = turns[Math.min(i, turns.length - 1)] ?? {}
      i += 1
      return Promise.resolve(turn)
    },
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.TANGLE_API_KEY
  const baseUrl = process.env.SANDBOX_BASE_URL
  if (!apiKey || !baseUrl) {
    console.error(
      'run-sandbox needs a real sandbox client: set TANGLE_API_KEY + SANDBOX_BASE_URL.\n' +
        'No box handy? Run the SAME supervisor locally at $0:  pnpm tsx examples/supervisor-loop/run-local.ts',
    )
    process.exit(1)
  }

  // The real Tangle sandbox client. It satisfies the runtime's `SandboxClient` port
  // (it exposes `create(...)`), so it drops straight into the sandbox seam.
  const sandboxClient = new SandboxClient({ apiKey, baseUrl }) as unknown as RuntimeSandboxClient
  const harness = (process.env.LOOP_HARNESS ?? 'opencode') as BackendType

  const sandboxBackend: ExecutorConfig = {
    backend: 'sandbox',
    harness,
    sandboxClient,
    maxIterations: 1,
  }

  console.log(`supervisor-loop · SANDBOX · backend=sandbox · harness=${harness} · real boxes`)

  const result = await runSupervisorLoop({
    task,
    backend: sandboxBackend,
    chat: scriptedChat(2),
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
