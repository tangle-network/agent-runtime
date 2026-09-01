/**
 * `createExecutor({ backend: 'provider' })` — the composition an
 * `AgentEnvironmentProvider` is consumed through, and the per-turn channel that
 * makes it usable for a subscription seat.
 *
 * The provider fixtures here stand in for `createTangleProvider` from
 * `@tangle-network/agent-provider-tangle`. Runtime does not depend on that package, and must not:
 * the seam accepts the `AgentEnvironmentProvider` contract, so any provider that satisfies the
 * contract composes the same way.
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
import { describe, expect, it } from 'vitest'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import type {
  AgentSpec,
  ExecutorContext,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

function ctx(): ExecutorContext {
  return { signal: new AbortController().signal, seams: {} }
}

/** A caller-owned session credential: the exact shape a subscription seat travels in. */
const seatBackend = {
  model: {
    authMode: 'oauth',
    authFiles: [{ path: '.codex/auth.json', content: '{"tokens":{"access_token":"seat"}}' }],
  },
} as const
const seatCredential = { backend: seatBackend }

function terminalEvents(text: string): AgentEnvironmentEvent[] {
  return [
    { type: 'text', data: { text } },
    { type: 'done', data: { outcome: { type: 'completed' } } },
  ] as AgentEnvironmentEvent[]
}

interface RecordingProvider {
  provider: AgentEnvironmentProvider
  creates: CreateAgentEnvironmentInput[]
  turns: AgentTurnInput[]
  /** Ordered log of what the environment did, so a test can prove score-before-destroy. */
  lifecycle: string[]
}

/** The smallest provider the non-steering executor path needs: create, stream, destroy. */
function recordingProvider(text = 'provider answer'): RecordingProvider {
  const creates: CreateAgentEnvironmentInput[] = []
  const turns: AgentTurnInput[] = []
  const lifecycle: string[] = []
  const provider: AgentEnvironmentProvider = {
    name: 'fixture-provider',
    capabilities: () => ({}) as AgentEnvironmentCapabilities,
    async create(input: CreateAgentEnvironmentInput): Promise<AgentEnvironment> {
      creates.push(input)
      return {
        id: 'env-1',
        provider: 'fixture-provider',
        status: async () => 'running',
        destroy: async () => {
          lifecycle.push('destroy')
        },
        exec: async (command: string) => {
          lifecycle.push(`exec:${command}`)
          return { exitCode: 0, stdout: text, stderr: '' }
        },
        async *stream(turn: AgentTurnInput): AsyncGenerator<AgentEnvironmentEvent> {
          turns.push(turn)
          for (const event of terminalEvents(text)) yield event
        },
      } as unknown as AgentEnvironment
    },
  }
  return { provider, creates, turns, lifecycle }
}

async function settle(
  spec: AgentSpec,
  factory: ReturnType<typeof createExecutor>,
): Promise<ExecutorResult<unknown>> {
  const executor = factory(spec, ctx())
  for await (const _event of executor.execute(
    'write the answer',
    new AbortController().signal,
  ) as AsyncIterable<UsageEvent>) {
    // Drain: the provider stream runs inside the iteration, and the artifact is
    // only readable once it has drained.
  }
  return executor.resultArtifact()
}

const providerProfile: AgentProfile = testAgentProfile('provider-worker', { harness: 'codex' })
const spec: AgentSpec = { profile: providerProfile, harness: null }

describe("createExecutor({ backend: 'provider' })", () => {
  it('runs one AgentProfile through the provider contract and settles its artifact', async () => {
    const { provider, creates, turns } = recordingProvider('ANSWER=42')

    const artifact = await settle(spec, createExecutor({ backend: 'provider', provider }))

    expect(creates).toHaveLength(1)
    expect(creates[0]?.profile).toMatchObject({ name: 'provider-worker', harness: 'codex' })
    expect(turns).toHaveLength(1)
    expect(turns[0]?.prompt).toBe('write the answer')
    expect(artifact.out).toMatchObject({ content: 'ANSWER=42' })
    expect(artifact.spent.iterations).toBe(1)
    // No provider event carries a billing receipt, so the dollar channel stays unproven.
    expect(artifact.spent.usdKnown).toBe(false)
  })

  it('forwards the declared prompt options into every streamed turn', async () => {
    const { provider, turns } = recordingProvider()

    await settle(
      spec,
      createExecutor({
        backend: 'provider',
        provider,
        promptOptions: { backend: seatBackend, timeoutMs: 90_000 },
      }),
    )

    expect(turns[0]?.providerOptions).toEqual(seatCredential)
    expect(turns[0]?.timeoutMs).toBe(90_000)
    // The runtime still owns the turn's abort channel.
    expect(turns[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps the declared credential when taskToTurn sets its own provider options', async () => {
    const { provider, turns } = recordingProvider()

    await settle(
      spec,
      createExecutor({
        backend: 'provider',
        provider,
        promptOptions: { backend: seatBackend },
        taskToTurn: (task) => ({
          prompt: String(task),
          providerOptions: { messages: [{ role: 'user', content: String(task) }] },
        }),
      }),
    )

    expect(turns[0]?.providerOptions?.backend).toEqual(seatCredential.backend)
    expect(turns[0]?.providerOptions?.messages).toHaveLength(1)
  })

  it('refuses a turn-level model rather than recording one the provider did not run', async () => {
    const { provider } = recordingProvider()

    await expect(
      settle(
        spec,
        createExecutor({
          backend: 'provider',
          provider,
          promptOptions: { model: 'some-other-model' } as never,
        }),
      ),
    ).rejects.toThrow(/promptOptions.model is refused/)
  })

  it('scores the worker against the LIVE environment, before it is destroyed', async () => {
    const { provider, lifecycle } = recordingProvider('ANSWER=42')
    const seen: string[] = []

    const artifact = await settle(
      spec,
      createExecutor({
        backend: 'provider',
        provider,
        validator: {
          async validate(out, validationCtx) {
            // The environment is still alive here: the check runs a command inside the box it
            // is scoring, which no post-teardown hook can do.
            const proof = await validationCtx.box?.exec('cat answer.txt')
            seen.push(out.content)
            return { valid: proof?.stdout.includes('ANSWER=42') === true, score: 1 }
          },
        },
      }),
    )

    expect(seen).toEqual(['ANSWER=42'])
    expect(artifact.verdict).toEqual({ valid: true, score: 1 })
    // Ordering is the contract: the score reads the environment, then teardown releases it.
    expect(lifecycle).toEqual(['exec:cat answer.txt', 'destroy'])
  })

  it('carries the declared prompt options through the steerable session', async () => {
    const turns: AgentTurnInput[] = []
    const provider: AgentEnvironmentProvider = {
      name: 'steerable-fixture',
      capabilities: () =>
        ({
          streaming: { live: true },
          sessions: { continue: true },
        }) as AgentEnvironmentCapabilities,
      async create(): Promise<AgentEnvironment> {
        return {
          id: 'env-steer',
          provider: 'steerable-fixture',
          status: async () => 'running',
          destroy: async () => {},
          session: (id: string) => ({
            id,
            status: async () => 'running',
            events: async function* () {},
            result: async () => ({ text: '', success: true }),
            prompt: async () => ({ text: '', success: true }),
            cancel: async () => ({ cancelled: true }),
          }),
          async *stream(turn: AgentTurnInput): AsyncGenerator<AgentEnvironmentEvent> {
            turns.push(turn)
            for (const event of terminalEvents('steered answer')) yield event
          },
        } as unknown as AgentEnvironment
      },
    }

    const steerSpec: AgentSpec = {
      profile: testAgentProfile('steerable-provider-worker', { harness: 'codex' }),
      harness: null,
    }
    const factory = createExecutor({
      backend: 'provider',
      provider,
      steering: {},
      promptOptions: { backend: seatBackend },
    })
    const executor = factory(steerSpec, ctx())
    for await (const _event of executor.execute(
      'write the answer',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Drain the steerable session's turn.
    }

    // The steerable session speaks the Sandbox prompt vocabulary; the adapter raises the
    // credential back onto the provider turn, so the box the provider owns still receives it.
    expect(turns).not.toHaveLength(0)
    expect(turns[0]?.providerOptions?.backend).toEqual(seatCredential.backend)
  })
})
