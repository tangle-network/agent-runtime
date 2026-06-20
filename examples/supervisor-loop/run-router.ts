/**
 * The router path — REAL inference, both ends, off-box (no sandbox).
 *
 *   TANGLE_API_KEY=sk-... pnpm tsx examples/supervisor-loop/run-router.ts
 *
 * Needs: `TANGLE_API_KEY` (a Tangle router key). Base URL defaults to the public router
 * (`https://router.tangle.tools/v1`); override with `ROUTER_BASE_URL`. Model defaults to a
 * cheap one; override with `LOOP_MODEL`.
 *
 * What is real here:
 *   - the driver-LLM seam is `routerBrain(cfg)` — the supervisor's spawn/await/stop
 *     turns are REAL router tool-calls (the brain decides the loop itself, not a script).
 *   - the worker leaf comes from `createExecutor({ backend: 'router-tools', ... })` — an
 *     off-box tool-using agentic loop over the router (chat → tool_calls → run → repeat).
 *
 * The supervisor + the shared `runSupervisorLoop` are the same across every runner; only the
 * two seams (`brain`, `backend`) differ. THAT is the swap.
 */

import {
  type ExecutorConfig,
  routerBrain,
  type ToolSpec,
} from '@tangle-network/agent-runtime/loops'
import { demoTask, reportResult, runSupervisorLoop } from './loop'

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) {
    console.error(
      'run-router needs TANGLE_API_KEY (a Tangle router key). See the README run matrix.',
    )
    process.exit(1)
  }
  const routerBaseUrl = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'
  const model = process.env.LOOP_MODEL ?? 'deepseek-v4-flash'

  // The worker is an off-box tool-using router agent. It gets one trivial tool so the
  // tool-loop has something to call; its FINAL answer text is what the check reads.
  const workerTools: ToolSpec[] = [
    {
      type: 'function',
      function: {
        name: 'note',
        description: 'Record a short working note (no-op, returns ok).',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    },
  ]

  const backend: ExecutorConfig = {
    backend: 'router-tools',
    routerBaseUrl,
    routerKey,
    model,
    tools: workerTools,
    // The worker's tool surface runs ON THIS HOST (off-box). `note` is a no-op recorder.
    executeToolCall: (name, args) =>
      Promise.resolve(
        name === 'note' ? `noted: ${String(args.text ?? '')}` : `unknown tool ${name}`,
      ),
    maxTurns: 6,
  }

  console.log(
    `supervisor-loop · ROUTER · backend=router-tools · model=${model} · real inference both ends`,
  )

  const result = await runSupervisorLoop({
    task: demoTask,
    backend,
    // Real driver-LLM turns — the brain decides spawn/await/stop itself.
    brain: routerBrain({ routerBaseUrl, routerKey, model }),
    systemPrompt:
      'You are a supervisor. Spawn one or two worker agents to produce the required line, ' +
      'await them with await_event, and stop once a worker delivered (valid). Do not answer yourself.',
    perWorker: { maxIterations: 6, maxTokens: 40_000 },
    budget: { maxIterations: 100, maxTokens: 500_000, maxUsd: 0.5 },
    maxTurns: 12,
    runId: 'supervisor-loop-router',
  })

  reportResult(result, 'router-tools')
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
