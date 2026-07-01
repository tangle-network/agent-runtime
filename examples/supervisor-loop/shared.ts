/**
 * Shared fixtures for the supervisor-loop runners: the demo goal + its deployable
 * completion check, and a SCRIPTED driver brain so the box / cli-bridge runners
 * exercise their wiring with no inference.
 *
 * The supervisor itself is `supervise()` (`@tangle-network/agent-runtime/loops`);
 * these are only the per-example task + the offline brain it can be driven with.
 */

import {
  type ExecutorConfig,
  type SandboxClient as RuntimeSandboxClient,
  routerBrain,
  type ToolLoopChat,
} from '@tangle-network/agent-runtime/loops'
import type { BackendType } from '@tangle-network/sandbox'
import { SandboxClient } from '@tangle-network/sandbox'

/** The marker every runner asks its workers to emit; the check confirms it landed. */
export const expectedAnswer = 'ANSWER=42'

/** The deployable completion oracle: a worker settles `valid:true` ONLY when its
 *  output contains `ANSWER=42` — text content for off-box backends, the serialized
 *  harness event stream for a box. Never the model judging itself. */
export const demoCheck = (out: unknown): boolean => {
  if (out && typeof out === 'object' && 'content' in out) {
    return String((out as { content: unknown }).content).includes(expectedAnswer)
  }
  return JSON.stringify(out ?? '').includes(expectedAnswer)
}

/** The shared demo goal: produce the exact line `ANSWER=42`. */
export const demoGoal = `Produce the exact line "${expectedAnswer}".`

/**
 * A SCRIPTED `ToolLoopChat`: spawn `workerCount` workers (the "drive N workers"
 * shape), await each settlement, then stop. This is the exact contract
 * `routerBrain` fills in production — here it returns a fixed turn sequence so the
 * brain runs with no inference (the same offline seam the driver's own unit tests
 * use). The brain still REASONS the loop (spawn → await → stop) against a live
 * `Scope`; only the driver-LLM call is mocked.
 *
 * The canonical loop parses `toolCalls[].arguments` itself, so each scripted call
 * serializes its arguments to a JSON string; the loop JSON.parses them before
 * running the tool.
 */
export function scriptedSupervisorChat(workerCount: number, labelPrefix = 'solver'): ToolLoopChat {
  interface ScriptedTurn {
    content: string
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>
  }
  const turns: ScriptedTurn[] = []
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({
      content: `delegating slice ${i}`,
      toolCalls: [
        {
          name: 'spawn_agent',
          arguments: {
            profile: { name: `${labelPrefix}-${i}`, systemPrompt: `Emit ${expectedAnswer}.` },
            task: `Emit the exact line ${expectedAnswer} and nothing else.`,
            label: `${labelPrefix}-${i}`,
          },
        },
      ],
    })
  }
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({
      content: 'awaiting a worker',
      toolCalls: [{ name: 'await_event', arguments: {} }],
    })
  }
  turns.push({ content: 'all workers delivered — stopping', toolCalls: [] })

  let i = 0
  return (messages) => {
    // This scripted brain deliberately IGNORES `messages` and advances a fixed plan, so
    // do NOT mistake it for the supervisor pattern — a real brain READS the folded worker
    // outputs and composes its next move FROM them (the fold; see examples/driver-loop/).
    // We touch `messages` only so the shape is exercised:
    void messages.length
    const turn = turns[Math.min(i, turns.length - 1)] ?? { content: '', toolCalls: [] }
    i += 1
    return Promise.resolve({
      content: turn.content,
      toolCalls: turn.toolCalls.map((tc, j) => ({
        id: `call-${i}-${j}`,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
    })
  }
}

/**
 * Build the worker-leaf `ExecutorConfig` for the chosen backend — THE one swap seam the supervisor-loop
 * thesis is about. `WORKER_BACKEND=bridge` (default) runs workers through the local cli-bridge (real
 * harness CLIs on your machine, no cloud); `WORKER_BACKEND=sandbox` runs them in real Tangle boxes.
 * Nothing downstream cares which — `workerFromBackend` injects the seam and returns a uniform worker.
 */
export function buildWorkerBackend(): ExecutorConfig {
  const backend = process.env.WORKER_BACKEND ?? 'bridge'
  if (backend === 'sandbox') {
    const apiKey = process.env.TANGLE_API_KEY
    const baseUrl = process.env.SANDBOX_BASE_URL
    if (!apiKey || !baseUrl) {
      throw new Error(
        'WORKER_BACKEND=sandbox needs a real sandbox client: set TANGLE_API_KEY + SANDBOX_BASE_URL.\n' +
          '  No box? WORKER_BACKEND=bridge WORKER_MODEL=opencode/zai-coding-plan/glm-5.1 runs the SAME\n' +
          '  supervisor against local harness CLIs (start the bridge: cd ~/code/cli-bridge && pnpm start).',
      )
    }
    // The real Tangle client satisfies the runtime's `SandboxClient` port (it exposes `create(...)`).
    const sandboxClient = new SandboxClient({ apiKey, baseUrl }) as unknown as RuntimeSandboxClient
    const harness = (process.env.LOOP_HARNESS ?? 'opencode') as BackendType
    return { backend: 'sandbox', harness, sandboxClient, maxIterations: 1 }
  }
  if (backend !== 'bridge') {
    throw new Error(`WORKER_BACKEND must be "bridge" or "sandbox" (got ${JSON.stringify(backend)})`)
  }
  const model = process.env.WORKER_MODEL
  if (!model) {
    throw new Error(
      'WORKER_BACKEND=bridge needs WORKER_MODEL=<harness>/<model> the bridge can serve,\n' +
        '  e.g. WORKER_MODEL=opencode/zai-coding-plan/glm-5.1\n' +
        '  Start the bridge first: cd ~/code/cli-bridge && pnpm start  (→ http://127.0.0.1:3344)',
    )
  }
  return {
    backend: 'bridge',
    bridgeUrl: process.env.BRIDGE_URL ?? 'http://127.0.0.1:3344',
    bridgeBearer: process.env.BRIDGE_BEARER ?? 'local',
    model,
    timeoutMs: 180_000,
  }
}

/** The supervisor BRAIN: the real router driver when a key + model are present, else the scripted $0
 *  offline brain. (The brain is NEVER cli-bridge — full-agent harnesses don't return raw tool_calls.) */
export function resolveSupervisorBrain(
  workerCount: number,
  labelPrefix: string,
): { brain: ToolLoopChat; label: string } {
  const routerKey = process.env.TANGLE_API_KEY
  const driverModel = process.env.DRIVER_MODEL ?? process.env.LOOP_MODEL
  if (process.env.DRIVER !== 'scripted' && routerKey && driverModel) {
    return {
      brain: routerBrain({
        routerBaseUrl: process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1',
        routerKey,
        model: driverModel,
      }),
      label: `router(${driverModel})`,
    }
  }
  return { brain: scriptedSupervisorChat(workerCount, labelPrefix), label: 'scripted' }
}
