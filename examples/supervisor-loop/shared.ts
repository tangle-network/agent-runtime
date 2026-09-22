import type { HarnessType } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { createCliBridgeProvider } from '@tangle-network/agent-provider-cli-bridge'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import {
  type EnvironmentWorkerOptions,
  routerBrain,
  type ToolLoopChat,
} from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'

/** The marker every runner asks its workers to emit; the check confirms it landed. */
export const expectedAnswer = 'ANSWER=42'

export const demoCheck = (out: unknown): boolean => {
  if (out && typeof out === 'object' && 'content' in out) {
    return String((out as { content: unknown }).content).includes(expectedAnswer)
  }
  return JSON.stringify(out ?? '').includes(expectedAnswer)
}

export const demoGoal = `Produce the exact line "${expectedAnswer}".`

/**
 * Fixed spawn, wait, stop turns for local tests.
 * Production callers use `routerBrain` or another `ToolLoopChat`.
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
            profile: {
              name: `${labelPrefix}-${i}`,
              prompt: { systemPrompt: `Emit ${expectedAnswer}.` },
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

export type WorkerEnvironment = EnvironmentWorkerOptions & {
  provider: AgentEnvironmentProvider
}

/** Build the worker environment from one configured provider. */
export function buildWorkerEnvironment(): WorkerEnvironment {
  const providerName = process.env.WORKER_PROVIDER ?? 'cli-bridge'
  if (providerName === 'tangle') {
    const apiKey = process.env.TANGLE_API_KEY
    const baseUrl = process.env.SANDBOX_BASE_URL
    if (!apiKey || !baseUrl) {
      throw new Error('WORKER_PROVIDER=tangle needs TANGLE_API_KEY and SANDBOX_BASE_URL')
    }
    const provider = createTangleProvider({
      client: new Sandbox({ apiKey, baseUrl }) as unknown as Parameters<
        typeof createTangleProvider
      >[0]['client'],
    })
    const harness = (process.env.LOOP_HARNESS ?? 'opencode') as HarnessType
    return {
      provider,
      environment: { backend: harness },
      maxIterations: 1,
    }
  }
  if (providerName !== 'cli-bridge') {
    throw new Error(
      `WORKER_PROVIDER must be "cli-bridge" or "tangle" (got ${JSON.stringify(providerName)})`,
    )
  }
  const model = process.env.WORKER_MODEL
  if (!model) {
    throw new Error('WORKER_PROVIDER=cli-bridge needs WORKER_MODEL=<harness>/<model>')
  }
  return {
    provider: createCliBridgeProvider({
      baseUrl: process.env.BRIDGE_URL ?? 'http://127.0.0.1:3344',
      bearerToken: process.env.BRIDGE_BEARER ?? 'local',
      defaultModel: model,
    }),
    environment: {},
    steering: { maxTurns: 200, turnTimeoutMs: 180_000 },
  }
}

/** Use a router model when configured, otherwise use fixed local test turns. */
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
