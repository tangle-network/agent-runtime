import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import type {
  AgentSpec,
  Executor,
  ExecutorContext,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

const spec: AgentSpec = {
  profile: testAgentProfile('failed-sandbox-leaf', {
    harness: 'opencode',
    prompt: { systemPrompt: 'do the thing' },
  }),
  harness: 'opencode',
}

function doneEvent(data: Record<string, unknown> = {}): SandboxEvent {
  return { type: 'done', data: { ...data, outcome: { type: 'completed' } } }
}

function ctx(): ExecutorContext {
  return { signal: new AbortController().signal, seams: {} }
}

/** A box that replays exactly these events, so one factory covers every stream shape below. */
function sandboxClientEmitting(events: readonly SandboxEvent[]) {
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        id: 'test-box',
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          for (const event of events) yield event
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
}

const failedEvents: readonly SandboxEvent[] = [
  {
    type: 'error',
    data: { success: false, error: { message: 'No API key found for anthropic' } },
  } as SandboxEvent,
  // The SDK may synthesize `done` after an error. It must not turn the
  // already-observed failure into an empty successful artifact.
  doneEvent({ status: 'failed' }),
]

/** The measured substitution from agent-runtime#892: the box reports the model it really bound,
 *  and it is not the one the exact profile declared. */
const substitutedEvents: readonly SandboxEvent[] = [
  {
    type: 'execution.started',
    data: {
      effectiveBackend: {
        provider: 'openai-compat',
        model: 'deepseek/deepseek-v4-flash',
        source: 'environment',
        profile: { name: 'failed-sandbox-leaf', digest: 'cb2ad63e0d35e1db' },
      },
    },
  } as SandboxEvent,
  doneEvent({ tokenUsage: { inputTokens: 10, outputTokens: 5 }, totalCostUsd: 0.1 }),
] as readonly SandboxEvent[]

const honestEvents: readonly SandboxEvent[] = [
  {
    type: 'execution.started',
    data: {
      effectiveBackend: { provider: 'offline', model: 'offline-test-model', source: 'request' },
    },
  } as SandboxEvent,
  doneEvent({ tokenUsage: { inputTokens: 10, outputTokens: 5 }, totalCostUsd: 0.1 }),
] as readonly SandboxEvent[]

async function drain(events: AsyncIterable<UsageEvent>): Promise<void> {
  for await (const _event of events) {
    // terminal truth is asserted by whether the iterable rejects
  }
}

async function run(
  events: readonly SandboxEvent[],
  steering?: { maxTurns: number },
): Promise<Executor<unknown>> {
  const executor = createExecutor({
    backend: 'sandbox',
    sandboxClient: sandboxClientEmitting(events),
    ...(steering ? { steering } : {}),
  })(spec, ctx())
  await drain(executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>)
  return executor
}

describe('sandbox terminal truth', () => {
  it.each([
    { label: 'single-shot run error', steering: undefined },
    { label: 'steerable run error', steering: { maxTurns: 1 } },
  ])('$label settles failed with the public outcome', async ({ steering }) => {
    const executor = await run(failedEvents, steering)
    const artifact = executor.resultArtifact()
    expect(artifact.verdict).toEqual({ valid: false, score: 0 })
    expect((artifact.out as { outcome: { status: string; error?: string } }).outcome).toMatchObject(
      {
        status: 'failed',
        error: 'No API key found for anthropic',
      },
    )
  })

  it('does not fail a run because one tool call failed', async () => {
    // A tool that errors is a normal, reportable result. Only the execution's own error and
    // terminal events settle the execution — anything wider makes a working agent unrunnable.
    // The round still has to ANSWER: the verdict reads the output marker, so the answer below is
    // what separates this claim from "a box that produced nothing passes".
    const executor = await run([
      {
        type: 'message.part.updated',
        data: {
          part: {
            type: 'tool',
            callID: 'call-1',
            tool: 'bash',
            state: { status: 'error', error: 'exit 1' },
          },
        },
      } as SandboxEvent,
      { type: 'tool.result', data: { status: 'error', success: false, name: 'bash' } },
      {
        type: 'result',
        data: { finalText: 'the build fails on a missing header' },
      } as SandboxEvent,
      doneEvent({ tokenUsage: { inputTokens: 4, outputTokens: 2 } }),
    ] as readonly SandboxEvent[])
    expect(executor.resultArtifact().verdict).toEqual({ valid: true, score: 1 })
  })

  it('refuses a round that reported a tool call and never answered', async () => {
    const executor = await run([
      {
        type: 'message.part.updated',
        data: {
          part: {
            type: 'tool',
            callID: 'call-1',
            tool: 'bash',
            state: { status: 'error', error: 'exit 1' },
          },
        },
      } as SandboxEvent,
      { type: 'tool.result', data: { status: 'error', success: false, name: 'bash' } },
      doneEvent({ tokenUsage: { inputTokens: 4, outputTokens: 2 } }),
    ] as readonly SandboxEvent[])
    const verdict = executor.resultArtifact().verdict
    expect(verdict?.valid).toBe(false)
    expect(verdict?.notes).toContain('absent')
  })
})

describe('sandbox served-model truth', () => {
  it('fails the single-shot leaf when the box reports serving another model', async () => {
    await expect(run(substitutedEvents)).rejects.toThrow(
      /sandbox served model "deepseek\/deepseek-v4-flash".*instead of the exact profile model "offline-test-model"/,
    )
  })

  it('fails the steerable session when the box reports serving another model', async () => {
    await expect(run(substitutedEvents, { maxTurns: 1 })).rejects.toThrow(
      /sandbox served model "deepseek\/deepseek-v4-flash"/,
    )
  })

  it('names both the served provider and the platform source in the failure', async () => {
    await expect(run(substitutedEvents)).rejects.toThrow(
      /provider "openai-compat", source "environment"/,
    )
  })

  it('accepts the run when the box reports serving the exact declared model', async () => {
    const executor = await run(honestEvents)
    expect(executor.resultArtifact().spent.tokens).toMatchObject({ input: 10, output: 5 })
    expect(
      (executor.resultArtifact().out as { outcome: { status: string } }).outcome,
    ).toMatchObject({
      status: 'success',
    })
  })

  it('accepts a provider-prefixed spelling of the same model', async () => {
    await expect(
      run([
        {
          type: 'execution.started',
          data: {
            effectiveBackend: {
              provider: 'offline',
              model: 'offline/offline-test-model',
              source: 'request',
            },
          },
        } as SandboxEvent,
        doneEvent({ tokenUsage: { inputTokens: 1, outputTokens: 1 } }),
      ] as readonly SandboxEvent[]),
    ).resolves.toBeDefined()
  })

  it('never invents a verdict when the box reports no served model', async () => {
    // Absent is not "matched" and not "mismatched". A platform that reports nothing leaves the
    // served identity unobserved, and an unobserved identity may not fail or pass a run.
    await expect(
      run([
        { type: 'execution.started', data: {} } as SandboxEvent,
        doneEvent({ tokenUsage: { inputTokens: 1, outputTokens: 1 } }),
      ] as readonly SandboxEvent[]),
    ).resolves.toBeDefined()
  })
})
