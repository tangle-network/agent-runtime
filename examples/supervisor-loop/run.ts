/**
 * supervisor-loop — the canonical one-call `supervise()` over a real worker backend, where the WORKER
 * BACKEND is the ONLY knob. The SAME supervisor + brain + deployable check drive workers either through
 * the local cli-bridge (real harness CLIs on your machine) or inside real Tangle sandbox boxes; flipping
 * `WORKER_BACKEND` is the whole difference.
 *
 * The supervisor brain must emit `spawn_agent`/`await_event` via OpenAI tool-calling, so it runs on the
 * router (real, tool-calling) when a key is present, else the scripted $0/offline brain — NOT cli-bridge
 * (full-agent harnesses don't return raw tool_calls). All of that is in `shared.ts`.
 *
 * Run — local workers, free scripted brain (the headline, no cloud):
 *   WORKER_BACKEND=bridge WORKER_MODEL=opencode/zai-coding-plan/glm-5.1 \
 *     pnpm tsx examples/supervisor-loop/run.ts
 *   (start the bridge first: cd ~/code/cli-bridge && pnpm install && pnpm start → http://127.0.0.1:3344)
 *
 * Run — sandbox workers (SAME code, one env flip):
 *   WORKER_BACKEND=sandbox TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... \
 *     pnpm tsx examples/supervisor-loop/run.ts
 *
 * For the coordination-MCP variant (a supervisor driving workers via `spawn_agent` over a served MCP),
 * see run-supervisor-mcp.ts. For a fully offline, no-creds wiring check:
 *   pnpm test tests/loops/coordination-driver.test.ts tests/supervisor-loop-example.test.ts
 */
import { supervise } from '@tangle-network/agent-runtime/loops'
import { buildWorkerBackend, demoCheck, demoGoal, resolveSupervisorBrain } from './shared'

async function main(): Promise<void> {
  // THE ONE KNOB — bridge (local CLIs) or sandbox (real boxes). Everything below is identical.
  const backend = buildWorkerBackend()
  const { brain, label } = resolveSupervisorBrain(1, `${backend.backend}-solver`)

  console.log(`supervisor-loop · ${backend.backend.toUpperCase()} · driver=${label}`)

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
      backend,
      deliverable: { check: demoCheck, describe: 'worker delivers the goal' },
      brain,
      budget: { maxIterations: 100, maxTokens: 2_000_000, maxUsd: 2 },
      perWorker: { maxIterations: 1, maxTokens: 200_000 },
      maxTurns: 12,
      runId: `supervisor-loop-${backend.backend}`,
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
