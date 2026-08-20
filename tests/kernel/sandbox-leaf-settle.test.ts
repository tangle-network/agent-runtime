/**
 * What the sandbox leaf SETTLES — the two halves of "settled ⟺ delivered" on the backend that
 * runs an opaque coding harness.
 *
 * A supervised run selects its output from children that settled `done` AND carry `valid`. A
 * completion oracle writes that verdict when the caller passes one; on this backend, with no
 * oracle, nobody else does — so the leaf owes the run a structural answer: the harness completed a
 * round and returned an artifact, or the round failed and the worker must say so rather than settle
 * on an artifact it never produced.
 */

import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import type { AgentSpec, ExecutorContext, UsageEvent } from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

const spec: AgentSpec = {
  profile: testAgentProfile('leaf', {
    harness: 'opencode',
    prompt: { systemPrompt: 'do the thing' },
  }),
  harness: 'opencode',
}

function ctx(): ExecutorContext {
  return { signal: new AbortController().signal, seams: {} }
}

/** A box that streams one terminal event, or a client whose create rejects. */
function sandboxClient(over: { createFails?: string } = {}) {
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      if (over.createFails) throw new Error(over.createFails)
      return {
        id: 'box-0',
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          yield {
            type: 'message.part.updated',
            data: {
              part: {
                type: 'tool',
                callID: 'call-1',
                tool: 'read',
                state: { status: 'completed', input: { path: 'README.md' }, output: 'ok' },
              },
            },
          } as SandboxEvent
          yield {
            type: 'message.part.updated',
            data: { part: { id: 'answer-1', type: 'text', text: 'delivered' } },
          } as SandboxEvent
          yield { type: 'result', data: { finalText: 'tool noise\ndelivered' } } as SandboxEvent
          yield { type: 'done', data: { outcome: { type: 'completed' } } } as SandboxEvent
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
}

async function drain(events: AsyncIterable<UsageEvent>): Promise<void> {
  for await (const _ of events) {
    // the artifact is read after the stream drains
  }
}

describe('sandbox leaf — the settle contract', () => {
  it('marks a completed round DELIVERED, so a run with no oracle has something to select', async () => {
    const executor = createExecutor({
      backend: 'sandbox',
      sandboxClient: sandboxClient(),
    })(spec, ctx())
    await drain(executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>)
    const artifact = executor.resultArtifact()
    expect(artifact.verdict?.valid).toBe(true)
    expect(artifact.out).toMatchObject({
      content: 'delivered',
      toolCalls: [{ id: 'call-1', name: 'read', arguments: { path: 'README.md' } }],
    })
    expect((artifact.out as { events: SandboxEvent[] }).events.length).toBeGreaterThan(0)
  })

  it('fails the worker with the round’s own error instead of an artifact it never produced', async () => {
    const executor = createExecutor({
      backend: 'sandbox',
      sandboxClient: sandboxClient({ createFails: 'billingOwnerId is required' }),
    })(spec, ctx())
    await expect(
      drain(executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>),
    ).rejects.toThrow(/billingOwnerId is required/)
  })
})
