/**
 * provider-executor — run supervised workers on someone else's boxes through the
 * `AgentEnvironmentProvider` contract.
 *
 * `createExecutor({ backend: 'provider', provider })` is the seam that takes an environment
 * provider as data. It is the path to use when the boxes are Tangle Sandbox boxes: in production
 * the provider is `createTangleProvider({ client, ... })` from
 * `@tangle-network/agent-provider-tangle`, and every field a create needs — the profile, the
 * environment, the secrets, the resources, the billing owner — travels on the provider's own
 * `CreateAgentEnvironmentInput`, not on a hand-wrapped `SandboxClient`.
 *
 * Runtime holds no dependency on the Tangle provider package, and that is the point: the seam
 * accepts the contract, so the provider below is a plain object satisfying the same interface.
 * Swap `offlineProvider()` for `createTangleProvider({ client })` and nothing else changes.
 *
 * Two things this example is here to teach:
 *
 *   1. THE COMPOSITION. `provider` → `createExecutor({ backend: 'provider' })` →
 *      `supervise(..., { backend })`. One `ExecutorConfig` value; no adapter, no client wrapper.
 *   2. THE PER-TURN CHANNEL. `promptOptions` rides under every turn the executor streams — the
 *      same field and the same name `ExecCtx.promptOptions` uses on the sandbox path. A
 *      subscription seat is a caller-owned session credential, and a credential belongs to the
 *      call, never to the `AgentProfile`.
 *
 * Run it (offline, no credentials, no network):
 *   pnpm tsx examples/provider-executor/provider-executor.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import {
  type AgentSpec,
  createExecutor,
  type ExecutorConfig,
  type ExecutorContext,
  type ProviderPromptOptions,
  type UsageEvent,
} from '@tangle-network/agent-runtime/kernel'
import { superviseWithTestBrain, type ToolLoopChat } from '../../src/testing'

/** The line the worker must produce; the deliverable check reads the worker's real output. */
const expectedAnswer = 'ANSWER=42'

/**
 * A caller-owned session credential — the shape a subscription seat travels in. `authMode` names
 * how the harness authenticates and `authFiles` are written into the environment's home directory
 * before the CLI starts, so the seat token never becomes part of the portable profile.
 */
const seatBackend: NonNullable<ProviderPromptOptions['backend']> = {
  model: {
    authMode: 'oauth',
    authFiles: [{ path: '.codex/auth.json', content: '{"tokens":{"access_token":"seat"}}' }],
  },
}

/** Everything the provider was asked for, so this example can print what actually arrived. */
interface ProviderTranscript {
  provider: AgentEnvironmentProvider
  creates: CreateAgentEnvironmentInput[]
  turns: AgentTurnInput[]
}

/**
 * An offline stand-in for `createTangleProvider({ client })`.
 *
 * It implements the three members the executor path calls — `capabilities`, `create`, and the
 * environment's `stream` — and answers each turn with a canned event stream. A real provider
 * provisions a box; the contract between it and Runtime is identical.
 */
function offlineProvider(): ProviderTranscript {
  const creates: CreateAgentEnvironmentInput[] = []
  const turns: AgentTurnInput[] = []
  const provider: AgentEnvironmentProvider = {
    name: 'offline-boxes',
    capabilities: () => ({}) as AgentEnvironmentCapabilities,
    async create(input: CreateAgentEnvironmentInput): Promise<AgentEnvironment> {
      creates.push(input)
      return {
        id: `env-${creates.length}`,
        provider: 'offline-boxes',
        status: async () => 'running',
        destroy: async () => {},
        async *stream(turn: AgentTurnInput): AsyncGenerator<AgentEnvironmentEvent> {
          turns.push(turn)
          // A real environment streams the harness's own events. The terminal event is required:
          // without one the executor refuses the turn rather than settling on a truncated stream.
          yield { type: 'text', data: { text: expectedAnswer } } as AgentEnvironmentEvent
          yield {
            type: 'done',
            data: { outcome: { type: 'completed' } },
          } as AgentEnvironmentEvent
        },
      } as unknown as AgentEnvironment
    },
  }
  return { provider, creates, turns }
}

/** The worker instrument. In production the harness and model are the seat's, not the example's. */
const workerProfile: AgentProfile = {
  name: 'provider-worker',
  harness: 'codex',
  model: { provider: 'offline', default: 'offline-test-model' },
  prompt: { systemPrompt: `Emit ${expectedAnswer}.` },
}

const supervisorProfile: AgentProfile = {
  name: 'provider-supervisor',
  harness: 'cli-base',
  model: { provider: 'offline', default: 'offline-test-model', metadata: { maxTurns: 8 } },
  prompt: {
    systemPrompt:
      'You are a supervisor. Spawn one worker, await it with await_event, and stop once it delivered.',
  },
}

/**
 * A scripted driver: spawn one worker, await it, stop. It ignores the folded messages and
 * advances a fixed plan, so it exercises the wiring without inference. A real supervisor READS
 * the worker output and composes its next move from it — see `examples/driver-loop/`.
 */
function scriptedBrain(): ToolLoopChat {
  const turns = [
    {
      content: 'delegating to one provider worker',
      toolCalls: [
        {
          name: 'spawn_worker',
          arguments: {
            profile: workerProfile,
            task: `Emit the exact line ${expectedAnswer} and nothing else.`,
            label: 'provider-worker',
          },
        },
      ],
    },
    { content: 'awaiting the worker', toolCalls: [{ name: 'await_event', arguments: {} }] },
    { content: 'worker delivered — stopping', toolCalls: [] },
  ]
  let index = 0
  return (messages) => {
    void messages.length
    const turn = turns[Math.min(index, turns.length - 1)] ?? { content: '', toolCalls: [] }
    index += 1
    return Promise.resolve({
      content: turn.content,
      toolCalls: turn.toolCalls.map((call, position) => ({
        id: `call-${index}-${position}`,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      })),
    })
  }
}

/**
 * THE COMPOSITION. One value. Replace `provider` with `createTangleProvider({ client })` and the
 * workers run on Tangle boxes, with no other edit anywhere below.
 */
function providerBackend(provider: AgentEnvironmentProvider): ExecutorConfig {
  return {
    backend: 'provider',
    provider,
    // Create-time defaults the provider merges under every environment it makes for this run.
    defaults: { metadata: { pursuit: 'provider-executor-example' } },
    // Per-run prompt options merged under every turn — the same field, the same name, and the
    // same kernel-owned exclusions as `ExecCtx.promptOptions` on the sandbox path. The seat
    // credential rides here because it belongs to the call, not to the agent: an `AgentProfile`
    // is portable and a credential is not.
    promptOptions: { backend: seatBackend, timeoutMs: 120_000 },
  }
}

/** The smallest form: one profile, one environment, one turn, no supervisor. */
async function runOneWorker(backend: ExecutorConfig): Promise<void> {
  const spec: AgentSpec = { profile: workerProfile, harness: null }
  const context: ExecutorContext = { signal: new AbortController().signal, seams: {} }
  const executor = createExecutor(backend)(spec, context)
  for await (const _event of executor.execute(
    `Emit the exact line ${expectedAnswer}.`,
    new AbortController().signal,
  ) as AsyncIterable<UsageEvent>) {
    // The provider stream runs inside the iteration; the artifact reads once it has drained.
  }
  const artifact = executor.resultArtifact()
  console.log(`leaf out: ${JSON.stringify(artifact.out)}`)
  // No provider event carries a billing receipt, so the dollar channel stays unproven.
  console.log(`leaf usd known: ${artifact.spent.usdKnown !== false}`)
}

async function main(): Promise<void> {
  const { provider, creates, turns } = offlineProvider()
  const backend = providerBackend(provider)

  await runOneWorker(backend)

  // The same value is what a supervisor spawns its workers through.
  const result = await superviseWithTestBrain(supervisorProfile, 'Produce the answer.', {
    backend,
    brain: scriptedBrain(),
    deliverable: {
      check: (out: unknown) => JSON.stringify(out ?? '').includes(expectedAnswer),
      describe: 'the worker emitted the expected line',
    },
    // No dollar cap: no provider event carries a billing receipt, so this executor reports its
    // spend as `usdKnown: false`. A dollar-capped pool REFUSES an unknown dollar cost rather than
    // comparing against a floor, which is the correct behavior and would stop this run.
    budget: { maxIterations: 10, maxTokens: 200_000 },
    perWorker: { maxIterations: 1, maxTokens: 50_000 },
    runId: 'provider-executor-example',
  })

  console.log(
    result.kind === 'winner'
      ? `[OK] delivered: ${JSON.stringify(result.out)}`
      : `[--] no winner (${result.reason}, ${result.downCount} down)`,
  )
  console.log(`environments created: ${creates.length}`)
  const createdProfile = creates[0]?.profile
  console.log(
    `create profile: ${JSON.stringify(
      typeof createdProfile === 'string' ? createdProfile : createdProfile?.name,
    )}`,
  )
  console.log(`create metadata: ${JSON.stringify(creates[0]?.metadata)}`)
  // Proof the credential reached the environment rather than being dropped on the way.
  console.log(`turn credential: ${JSON.stringify(turns[0]?.providerOptions?.backend)}`)
  console.log(`turn timeout: ${turns[0]?.timeoutMs}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
