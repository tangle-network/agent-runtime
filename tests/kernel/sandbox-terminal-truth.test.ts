import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import type { AgentSpec, ExecutorContext, UsageEvent } from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

const spec: AgentSpec = {
  profile: testAgentProfile('failed-sandbox-leaf', {
    harness: 'opencode',
    prompt: { systemPrompt: 'do the thing' },
  }),
  harness: 'opencode',
}

function ctx(): ExecutorContext {
  return { signal: new AbortController().signal, seams: {} }
}

function failedSandboxClient() {
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        id: 'failed-box',
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          yield {
            type: 'error',
            data: {
              success: false,
              error: { message: 'No API key found for anthropic' },
            },
          } as SandboxEvent
          // The SDK may synthesize `done` after an error. It must not turn the
          // already-observed failure into an empty successful artifact.
          yield { type: 'done', data: { status: 'failed' } } as SandboxEvent
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
}

async function drain(events: AsyncIterable<UsageEvent>): Promise<void> {
  for await (const _event of events) {
    // terminal truth is asserted by whether the iterable rejects
  }
}

describe('sandbox terminal truth', () => {
  it('fails the single-shot sandbox leaf on the SDK error event', async () => {
    const executor = createExecutor({
      backend: 'sandbox',
      sandboxClient: failedSandboxClient(),
    })(spec, ctx())

    await expect(
      drain(executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>),
    ).rejects.toThrow(/No API key found for anthropic/)
  })

  it('fails the steerable sandbox session on the same SDK error event', async () => {
    const executor = createExecutor({
      backend: 'sandbox',
      sandboxClient: failedSandboxClient(),
      steering: { maxTurns: 1 },
    })(spec, ctx())

    await expect(
      drain(executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>),
    ).rejects.toThrow(/No API key found for anthropic/)
  })
})
