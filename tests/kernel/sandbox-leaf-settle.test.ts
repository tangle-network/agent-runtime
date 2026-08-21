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

/** A box that streams a caller-chosen event script, or a client whose create rejects. */
function scriptedClient(events: SandboxEvent[]) {
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      return {
        id: 'box-0',
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          for (const event of events) yield event
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
}

async function settledOut(client: ReturnType<typeof scriptedClient>): Promise<{
  content?: unknown
  output?: unknown
  servedBackend?: unknown
}> {
  const executor = createExecutor({ backend: 'sandbox', sandboxClient: client })(spec, ctx())
  await drain(executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>)
  return executor.resultArtifact().out as {
    content?: unknown
    output?: unknown
    servedBackend?: unknown
  }
}

const doneEvent = { type: 'done', data: { outcome: { type: 'completed' } } } as SandboxEvent

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

  it('records the served backend the platform reported, and leaves it absent otherwise', async () => {
    // Measured 2026-08-17: six children settled `done` with byte-identical empty blobs and nothing
    // named which backend served them. The platform's own report is the only admissible source,
    // so a run where it says nothing must stay unknown rather than echo the request.
    const served = await settledOut(
      scriptedClient([
        {
          type: 'execution.started',
          data: {
            effectiveBackend: {
              provider: 'offline',
              model: 'offline-test-model',
              source: 'environment',
            },
          },
        } as SandboxEvent,
        { type: 'result', data: { finalText: 'delivered' } } as SandboxEvent,
        doneEvent,
      ]),
    )
    expect(served.servedBackend).toEqual({
      provider: 'offline',
      model: 'offline-test-model',
      source: 'environment',
    })

    const silent = await settledOut(
      scriptedClient([
        { type: 'result', data: { finalText: 'delivered' } } as SandboxEvent,
        doneEvent,
      ]),
    )
    expect(silent.servedBackend).toBeUndefined()
  })

  it('separates an empty answer from an answer that was never observed', async () => {
    const empty = await settledOut(
      scriptedClient([{ type: 'result', data: { finalText: '' } } as SandboxEvent, doneEvent]),
    )
    expect(empty.output).toEqual({ kind: 'empty' })
    expect(empty.content).toBeUndefined()

    const absent = await settledOut(scriptedClient([doneEvent]))
    expect(absent.output).toEqual({ kind: 'absent' })
    expect(absent.content).toBeUndefined()

    const answered = await settledOut(
      scriptedClient([
        { type: 'result', data: { finalText: 'delivered' } } as SandboxEvent,
        doneEvent,
      ]),
    )
    expect(answered.output).toEqual({ kind: 'text', bytes: 9 })
    expect(answered.content).toBe('delivered')
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
