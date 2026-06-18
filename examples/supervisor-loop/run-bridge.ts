/**
 * The cli-bridge path — each worker is a real harness CLI (claude-code / codex /
 * opencode / kimi / gemini) fronted by the local OpenAI-compatible bridge in
 * ~/code/cli-bridge, behind one HTTP surface.
 *
 * Start the bridge (defaults to port 3344; no auth unless it's started with BRIDGE_BEARER):
 *   cd ~/code/cli-bridge && pnpm install && pnpm install:harness -- opencode && pnpm start
 *   # → http://127.0.0.1:3344
 *
 * Then run a worker per harness session through it:
 *   WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 \
 *   pnpm tsx examples/supervisor-loop/run-bridge.ts
 *
 * `model` is `<harness>/<model>` — it doubles as the harness selector
 * (`claude-code/sonnet`, `codex/gpt-5-codex`, `opencode/<provider>/<model>`, …).
 * BRIDGE_URL defaults to http://127.0.0.1:3344 (the BASE — no `/v1`; the executor
 * appends `/v1/chat/completions`); the bearer defaults to "local" (the bridge ignores
 * it unless started with BRIDGE_BEARER). The worker leaf is
 * `createExecutor({ backend: 'bridge', bridgeUrl, bridgeBearer, model })`.
 *
 * No bridge/harness handy? The SAME supervisor runs locally at $0:
 *   pnpm tsx examples/supervisor-loop/run-local.ts
 */

import type { DriverChat, DriverTurn, ExecutorConfig } from '@tangle-network/agent-runtime/loops'
import { reportResult, runSupervisorLoop, type SupervisorTask } from './loop'

const EXPECTED = 'ANSWER=42'

const task: SupervisorTask = {
  goal: `Produce the exact line "${EXPECTED}".`,
  check: (out) => {
    const content =
      out && typeof out === 'object' && 'content' in out
        ? String((out as { content: unknown }).content)
        : String(out)
    return content.includes(EXPECTED)
  },
}

function scriptedChat(workerCount: number): DriverChat {
  const turns: DriverTurn[] = []
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({
      toolCalls: [
        {
          name: 'spawn_worker',
          arguments: {
            profile: { name: `bridge-solver-${i}`, systemPrompt: `Emit ${EXPECTED}.` },
            task: `Emit the exact line ${EXPECTED} and nothing else.`,
            label: `bridge-solver-${i}`,
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
  // Base URL WITHOUT /v1 (the bridge executor appends /v1/chat/completions). Defaults to a
  // local ~/code/cli-bridge on its default port 3344. Bearer defaults to "local" — the bridge
  // ignores it unless it was started with BRIDGE_BEARER set.
  const bridgeUrl = process.env.BRIDGE_URL ?? process.env.ROUTER_BASE ?? 'http://127.0.0.1:3344'
  const bridgeBearer = process.env.BRIDGE_BEARER ?? process.env.TANGLE_API_KEY ?? 'local'
  const model = process.env.WORKER_MODEL
  if (!model) {
    console.error(
      'run-bridge needs WORKER_MODEL=<harness>/<model> the bridge can serve,\n' +
        '  e.g. WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5\n' +
        'Start the bridge first:  cd ~/code/cli-bridge && pnpm start   (→ http://127.0.0.1:3344)\n' +
        'No bridge/harness handy? Run the SAME supervisor locally at $0:  pnpm tsx examples/supervisor-loop/run-local.ts',
    )
    process.exit(1)
  }

  const bridgeBackend: ExecutorConfig = {
    backend: 'bridge',
    bridgeUrl,
    bridgeBearer,
    model,
    timeoutMs: 120_000,
  }

  console.log(`supervisor-loop · BRIDGE · backend=bridge · model=${model}`)

  const result = await runSupervisorLoop({
    task,
    backend: bridgeBackend,
    chat: scriptedChat(2),
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
