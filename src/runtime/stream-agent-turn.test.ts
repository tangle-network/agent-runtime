/**
 * Offline contract tests for `streamAgentTurn` / `collectAgentTurn` — one per
 * backend kind (box via `inProcessSandboxClient`, executor via a stub
 * `ExecutorFactory`, chat via a stub `AgentExecutionBackend`), plus the
 * terminal-guarantee, abort, and timeout paths. No network, no credentials.
 */

import type { SandboxEvent } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import type { AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { inProcessSandboxClient } from './in-process-sandbox-client'
import { collectAgentTurn, streamAgentTurn } from './stream-agent-turn'
import type { Executor, ExecutorFactory, ExecutorResult } from './supervise/types'

function finalOf(events: RuntimeStreamEvent[]): RuntimeStreamEvent & { type: 'final' } {
  const final = events.at(-1)
  if (!final || final.type !== 'final') throw new Error('no terminal final event')
  return final
}

describe('streamAgentTurn: box backend', () => {
  async function makeBox(events: SandboxEvent[]) {
    const client = inProcessSandboxClient({ onPrompt: () => events })
    return client.create()
  }

  it('streams incremental events and terminates with usage', async () => {
    const box = await makeBox([
      { type: 'message.part.updated', data: { part: { type: 'text' }, delta: 'Hello ' } },
      { type: 'message.part.updated', data: { part: { type: 'text' }, delta: 'world' } },
      { type: 'llm_call', data: { model: 'kimi-k2', tokensIn: 100, tokensOut: 40, costUsd: 0.02 } },
      { type: 'result', data: { finalText: 'Hello world' } },
    ] as SandboxEvent[])

    const seen: RuntimeStreamEvent[] = []
    for await (const event of streamAgentTurn({ kind: 'box', box }, 'say hello')) {
      seen.push(event)
    }
    // Incremental events surface in order, before the terminal event.
    expect(seen.map((e) => e.type)).toEqual([
      'backend_start',
      'text_delta',
      'text_delta',
      'llm_call',
      'final',
    ])
    const final = finalOf(seen)
    expect(final.status).toBe('completed')
    expect(final.text).toBe('Hello world')
    expect(final.metadata).toMatchObject({
      tokenUsage: { input: 100, output: 40 },
      costUsd: 0.02,
      model: 'kimi-k2',
    })
  })

  it('collectAgentTurn round-trips the terminal summary', async () => {
    const box = await makeBox([
      { type: 'message.part.updated', data: { part: { type: 'text' }, delta: '42' } },
      { type: 'done', data: { tokenUsage: { inputTokens: 7, outputTokens: 3 } } },
    ] as SandboxEvent[])

    const turn = await collectAgentTurn(streamAgentTurn({ kind: 'box', box }, 'answer'))
    expect(turn.finalText).toBe('42')
    expect(turn.usage).toEqual({ input: 7, output: 3 })
    expect(turn.status).toBe('completed')
    expect(turn.events.map((e) => e.type)).toEqual([
      'backend_start',
      'text_delta',
      'llm_call',
      'final',
    ])
  })

  it('surfaces a throwing box as backend_error + final failed (never throws)', async () => {
    const client = inProcessSandboxClient({
      // biome-ignore lint/correctness/useYield: the throw-before-yield path is the test subject
      onPrompt: async function* (): AsyncIterable<SandboxEvent> {
        throw new Error('box exploded')
      },
    })
    const box = await client.create()
    const turn = await collectAgentTurn(streamAgentTurn({ kind: 'box', box }, 'boom'))
    expect(turn.status).toBe('failed')
    expect(turn.error).toMatchObject({ kind: 'backend', message: 'box exploded' })
    const types = turn.events.map((e) => e.type)
    expect(types).toContain('backend_error')
    expect(types.at(-1)).toBe('final')
  })
})

describe('streamAgentTurn: executor backend', () => {
  function stubFactory(opts?: {
    onTeardown?: () => void
    hangUntilAbort?: boolean
  }): ExecutorFactory<unknown> {
    return (_spec, ctx): Executor<unknown> => ({
      runtime: 'inline',
      async execute(task, signal): Promise<ExecutorResult<unknown>> {
        if (opts?.hangUntilAbort) {
          await new Promise<never>((_resolve, reject) => {
            const onAbort = () => reject(signal.reason ?? new Error('aborted'))
            if (signal.aborted) onAbort()
            else signal.addEventListener('abort', onAbort, { once: true })
            // ctx.signal must be the same channel — assert linkage indirectly.
            if (ctx.signal.aborted) onAbort()
          })
        }
        return {
          outRef: 'stub-1',
          out: { content: `echo: ${String(task)}` },
          spent: { iterations: 1, tokens: { input: 11, output: 6 }, usd: 0.005, ms: 1 },
        }
      },
      async teardown() {
        opts?.onTeardown?.()
        return { destroyed: true }
      },
      resultArtifact(): ExecutorResult<unknown> {
        throw new Error('one-shot executor: resultArtifact unused')
      },
    })
  }

  it('runs the factory once and terminates with the executor usage', async () => {
    let toreDown = 0
    const stream = streamAgentTurn(
      { kind: 'executor', factory: stubFactory({ onTeardown: () => toreDown++ }) },
      'ping',
    )
    const turn = await collectAgentTurn(stream)
    expect(turn.finalText).toBe('echo: ping')
    expect(turn.usage).toEqual({ input: 11, output: 6, costUsd: 0.005 })
    expect(turn.status).toBe('completed')
    // Incremental metering surfaces before the terminal event.
    expect(turn.events.map((e) => e.type)).toEqual(['backend_start', 'llm_call', 'final'])
    expect(toreDown).toBe(1)
  })

  it('abort reaches the executor signal and terminates with status aborted', async () => {
    let toreDown = 0
    const controller = new AbortController()
    const stream = streamAgentTurn(
      {
        kind: 'executor',
        factory: stubFactory({ hangUntilAbort: true, onTeardown: () => toreDown++ }),
      },
      'hang',
      { signal: controller.signal },
    )
    setTimeout(() => controller.abort(new Error('caller cancelled')), 20)
    const turn = await collectAgentTurn(stream)
    expect(turn.status).toBe('aborted')
    expect(turn.error?.message).toBe('caller cancelled')
    expect(toreDown).toBe(1)
  })
})

describe('streamAgentTurn: chat backend', () => {
  function stubChatBackend(opts?: { hangUntilAbort?: boolean }): AgentExecutionBackend {
    return {
      kind: 'stub-chat',
      async *stream(_input, context): AsyncIterable<RuntimeStreamEvent> {
        yield { type: 'text_delta', text: 'partial ' }
        if (opts?.hangUntilAbort) {
          await new Promise<never>((_resolve, reject) => {
            const signal = context.signal
            const onAbort = () => reject(signal?.reason ?? new Error('aborted'))
            if (signal?.aborted) onAbort()
            else signal?.addEventListener('abort', onAbort, { once: true })
          })
        }
        yield { type: 'text_delta', text: 'answer' }
        yield { type: 'llm_call', model: 'glm-4.6', tokensIn: 21, tokensOut: 9 }
      },
    }
  }

  it('streams normalized events and terminates with usage + model', async () => {
    const seen: RuntimeStreamEvent[] = []
    for await (const event of streamAgentTurn({ kind: 'chat', backend: stubChatBackend() }, 'hi')) {
      seen.push(event)
    }
    expect(seen.map((e) => e.type)).toEqual([
      'backend_start',
      'text_delta',
      'text_delta',
      'llm_call',
      'final',
    ])
    // Normalization stamps task/session onto the backend's bare events.
    const delta = seen.at(1)
    if (delta?.type !== 'text_delta') throw new Error('expected text_delta')
    expect(delta.task?.intent).toBe('hi')
    expect(delta.session?.backend).toBe('stub-chat')
    const final = finalOf(seen)
    expect(final.text).toBe('partial answer')
    expect(final.metadata).toMatchObject({
      tokenUsage: { input: 21, output: 9 },
      model: 'glm-4.6',
    })
    expect(final.metadata).not.toHaveProperty('costUsd')
  })

  it('abort mid-stream terminates with status aborted after partial deltas', async () => {
    const controller = new AbortController()
    const stream = streamAgentTurn(
      { kind: 'chat', backend: stubChatBackend({ hangUntilAbort: true }) },
      'hang',
      { signal: controller.signal },
    )
    setTimeout(() => controller.abort(new Error('user stopped')), 20)
    const turn = await collectAgentTurn(stream)
    expect(turn.status).toBe('aborted')
    expect(turn.error?.message).toBe('user stopped')
    // The delta streamed before the abort is preserved on the terminal event.
    expect(turn.finalText).toBe('partial ')
    expect(turn.events.map((e) => e.type)).toEqual([
      'backend_start',
      'text_delta',
      'backend_error',
      'final',
    ])
  })

  it('timeoutMs expiry terminates with status failed (not aborted)', async () => {
    const turn = await collectAgentTurn(
      streamAgentTurn(
        { kind: 'chat', backend: stubChatBackend({ hangUntilAbort: true }) },
        'slow',
        {
          timeoutMs: 25,
        },
      ),
    )
    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain('timed out after 25ms')
  })
})

describe('collectAgentTurn contract', () => {
  it('throws when the stream ends without a terminal final event', async () => {
    async function* truncated(): AsyncIterable<RuntimeStreamEvent> {
      yield { type: 'text_delta', text: 'lost' }
    }
    await expect(collectAgentTurn(truncated())).rejects.toThrow(
      /ended without a terminal 'final' event/,
    )
  })
})
