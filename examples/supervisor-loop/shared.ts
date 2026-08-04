/**
 * Shared fixtures for the supervisor-loop runners: the demo goal + its deployable
 * completion check, and a SCRIPTED driver brain so the box / cli-bridge runners
 * exercise their wiring with no inference.
 *
 * The supervisor itself is `supervise()` (`@tangle-network/agent-runtime/kernel`);
 * these are only the per-example task + the offline brain it can be driven with.
 */

import { type AgentProfile, harnessTypeSchema } from '@tangle-network/agent-interface'
import type {
  ExecutorConfig,
  SandboxClient as RuntimeSandboxClient,
  ToolLoopChat,
} from '@tangle-network/agent-runtime/kernel'
import { Sandbox } from '@tangle-network/sandbox'

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
export function scriptedSupervisorChat(
  workerCount: number,
  labelPrefix = 'solver',
  workerProfile: AgentProfile = workerProfileFromEnv(),
): ToolLoopChat {
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
            profile: {
              ...workerProfile,
              name: `${labelPrefix}-${i}`,
              prompt: { ...workerProfile.prompt, systemPrompt: `Emit ${expectedAnswer}.` },
            },
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
export function buildWorkerBackend(): { backend: ExecutorConfig; profile: AgentProfile } {
  const profile = workerProfileFromEnv()
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
    const sandboxClient = new Sandbox({ apiKey, baseUrl }) as RuntimeSandboxClient
    return {
      backend: { backend: 'sandbox', sandboxClient, maxIterations: 1 },
      profile,
    }
  }
  if (backend !== 'bridge') {
    throw new Error(`WORKER_BACKEND must be "bridge" or "sandbox" (got ${JSON.stringify(backend)})`)
  }
  return {
    backend: {
      backend: 'bridge',
      bridgeUrl: process.env.BRIDGE_URL ?? 'http://127.0.0.1:3344',
      bridgeBearer: process.env.BRIDGE_BEARER ?? 'local',
      timeoutMs: 180_000,
    },
    profile,
  }
}

function workerProfileFromEnv(): AgentProfile {
  const model = process.env.WORKER_MODEL
  if (!model) {
    throw new Error(
      'Set WORKER_MODEL to the concrete model, plus optional WORKER_HARNESS and WORKER_PROVIDER.',
    )
  }
  return {
    name: 'worker',
    harness: harnessTypeSchema.parse(process.env.WORKER_HARNESS ?? 'pi'),
    model: {
      provider: process.env.WORKER_PROVIDER ?? 'tangle-router',
      default: model,
    },
  }
}

/** The supervisor BRAIN: the real router driver when a key + model are present, else the scripted $0
 *  offline brain. (The brain is NEVER cli-bridge — full-agent harnesses don't return raw tool_calls.) */
export function resolveSupervisorBrain(
  workerCount: number,
  labelPrefix: string,
  workerProfile: AgentProfile,
): { brain?: ToolLoopChat; profile: AgentProfile; label: string } {
  const routerKey = process.env.TANGLE_API_KEY
  const driverModel =
    process.env.DRIVER_MODEL ?? process.env.LOOP_MODEL ?? workerProfile.model?.default
  if (!driverModel) throw new Error('supervisor profile needs a concrete model')
  const profile: AgentProfile = {
    name: 'supervisor',
    harness: 'cli-base',
    model: {
      provider: process.env.DRIVER_PROVIDER ?? 'tangle-router',
      default: driverModel,
      metadata: { maxTurns: 12 },
    },
    prompt: {
      systemPrompt:
        'You are a supervisor. Spawn one worker session, await it with await_event, and stop once ' +
        'it delivered. The worker profile must use the exact execution identity supplied in the task.',
    },
  }
  if (process.env.DRIVER !== 'scripted' && routerKey && driverModel) {
    return {
      profile,
      label: `router(${driverModel})`,
    }
  }
  return {
    brain: scriptedSupervisorChat(workerCount, labelPrefix, workerProfile),
    profile,
    label: 'scripted',
  }
}
