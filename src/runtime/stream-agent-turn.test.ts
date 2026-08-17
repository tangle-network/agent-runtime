/**
 * Offline contract tests for `streamAgentTurn` / `collectAgentTurn` — one per
 * backend kind (box via `inProcessSandboxClient`, executor via a stub
 * `ExecutorFactory`, chat via a stub
 * `AgentExecutionBackend`), plus the terminal-guarantee, abort, timeout,
 * tool-part-preservation, raw-event-tap, and pull-based mid-stream-lifecycle
 * paths. No network, no credentials.
 */

import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import type { AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { inProcessSandboxClient } from './in-process-sandbox-client'
import { collectAgentTurn, streamAgentTurn, streamObservedAgentTurn } from './stream-agent-turn'
import { attestRuntimeOwnedExecutor } from './supervise/materialization'
import { createExecutor } from './supervise/runtime'
import type { Executor, ExecutorFactory, ExecutorResult } from './supervise/types'

const TEST_PROFILE = {
  name: 'stream-agent-turn-test',
  harness: 'cli-base',
  model: { provider: 'offline', default: 'offline-test-model' },
} as const

function finalOf(events: RuntimeStreamEvent[]): RuntimeStreamEvent & { type: 'final' } {
  const final = events.at(-1)
  if (final?.type !== 'final') throw new Error('no terminal final event')
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
    for await (const event of streamObservedAgentTurn(
      { kind: 'box', box },
      { prompt: 'say hello' },
    )) {
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

    const turn = await collectAgentTurn(
      streamObservedAgentTurn({ kind: 'box', box }, { prompt: 'answer' }),
    )
    expect(turn.finalText).toBe('42')
    expect(turn.usage).toEqual({ input: 7, output: 3, usdKnown: false })
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
    const turn = await collectAgentTurn(
      streamObservedAgentTurn({ kind: 'box', box }, { prompt: 'boom' }),
    )
    expect(turn.status).toBe('failed')
    expect(turn.error).toMatchObject({ kind: 'backend', message: 'box exploded' })
    const types = turn.events.map((e) => e.type)
    expect(types).toContain('backend_error')
    expect(types.at(-1)).toBe('final')
  })

  it('uses the latest user message when a box turn has provider messages only', async () => {
    const prompts: string[] = []
    const box = await inProcessSandboxClient({
      onPrompt: (prompt): SandboxEvent[] => {
        prompts.push(prompt)
        return [{ type: 'done', data: { finalText: 'answer' } }]
      },
    }).create()

    await collectAgentTurn(
      streamObservedAgentTurn(
        { kind: 'box', box },
        {
          providerOptions: {
            messages: [
              { role: 'user', content: 'latest request' },
              { role: 'assistant', content: 'previous response' },
            ],
          },
        },
      ),
    )

    expect(prompts).toEqual(['latest request'])
  })
})

describe('streamAgentTurn: current Sandbox prompt options', () => {
  it('forwards current prompt options and folds usage identically', async () => {
    const calls: { mode?: string; options?: Record<string, unknown> }[] = []
    const client = inProcessSandboxClient({
      onPrompt: (_prompt, ctx) => {
        calls.push({ options: ctx.options })
        expect(ctx.signal).toBeInstanceOf(AbortSignal)
        return [
          { type: 'message.part.updated', data: { part: { type: 'text' }, delta: 'task output' } },
          {
            type: 'done',
            data: {
              tokenUsage: { inputTokens: 9, outputTokens: 4 },
              totalCostUsd: 0.01,
              model: 'kimi-k2',
            },
          },
        ] as SandboxEvent[]
      },
    })
    const box = await client.create()
    const turn = await collectAgentTurn(
      streamObservedAgentTurn(
        {
          kind: 'box',
          box,
          options: { sessionId: 'sess-1', model: 'kimi-k2' },
        },
        { prompt: 'do the task' },
      ),
    )
    // The options passthrough arrives verbatim at the current prompt verb.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.options).toMatchObject({ sessionId: 'sess-1', model: 'kimi-k2' })
    const start = turn.events[0]
    if (start?.type !== 'backend_start') throw new Error('expected backend_start')
    expect(start.backend).toBe('box')
    expect(turn.finalText).toBe('task output')
    expect(turn.usage).toEqual({
      input: 9,
      output: 4,
      costUsd: 0.01,
      model: 'kimi-k2',
    })
    expect(turn.status).toBe('completed')
  })

  it('timeoutMs aborts a hanging prompt with final.status failed', async () => {
    const client = inProcessSandboxClient({
      onPrompt: async function* (_prompt, ctx): AsyncIterable<SandboxEvent> {
        await new Promise<never>((_resolve, reject) => {
          const onAbort = () => reject(ctx.signal.reason ?? new Error('aborted'))
          if (ctx.signal.aborted) onAbort()
          else ctx.signal.addEventListener('abort', onAbort, { once: true })
        })
      },
    })
    const box = await client.create()
    const turn = await collectAgentTurn(
      streamObservedAgentTurn({ kind: 'box', box }, { prompt: 'hang' }, { timeoutMs: 25 }),
    )
    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain('timed out after 25ms')
  })

  it('enforces its deadline when a Sandbox iterator ignores cancellation', async () => {
    let returnCalls = 0
    const events: AsyncIterable<SandboxEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => await new Promise<IteratorResult<SandboxEvent>>(() => {}),
          return: async () => {
            returnCalls += 1
            return { done: true, value: undefined }
          },
        }
      },
    }
    const box = {
      streamPrompt: () => events,
    } as unknown as SandboxInstance

    const turn = await collectAgentTurn(
      streamObservedAgentTurn({ kind: 'box', box }, { prompt: 'hang' }, { timeoutMs: 25 }),
    )

    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain('timed out after 25ms')
    await Promise.resolve()
    expect(returnCalls).toBe(1)
  })

  it('does not classify a silent iterator close after caller abort as completed', async () => {
    const controller = new AbortController()
    const client = inProcessSandboxClient({
      onPrompt: async function* (_prompt, ctx): AsyncIterable<SandboxEvent> {
        await new Promise<void>((resolve) => {
          if (ctx.signal.aborted) {
            resolve()
            return
          }
          ctx.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    })
    const box = await client.create()
    const pending = collectAgentTurn(
      streamObservedAgentTurn(
        { kind: 'box', box },
        { prompt: 'stop' },
        { signal: controller.signal },
      ),
    )
    controller.abort(new Error('caller stopped'))
    const turn = await pending
    expect(turn.status).toBe('aborted')
    expect(turn.error?.message).toBe('caller stopped')
    expect(turn.events.at(-1)?.type).toBe('final')
  })
})

describe('streamAgentTurn: canonical event precedence', () => {
  async function makeBox(events: SandboxEvent[]) {
    const client = inProcessSandboxClient({ onPrompt: () => events })
    return client.create()
  }

  it.each([
    [
      'message part',
      {
        type: 'message.part.updated',
        data: {
          part: {
            id: 'part-text',
            sessionID: 'session-1',
            messageID: 'message-1',
            type: 'text',
            text: 'canonical text',
          },
          delta: 'canonical text',
        },
      },
      'message.part.updated',
    ],
    ['status', { type: 'status', data: { status: 'processing' } }, 'status'],
    [
      'raw',
      { type: 'raw', data: { backend: 'opencode', event: { providerSecret: 'observer-only' } } },
      'raw',
    ],
  ] as const)(
    'emits one canonical semantic event for one %s source frame',
    async (_label, source, type) => {
      const box = await makeBox([
        source,
        {
          type: 'done',
          data: { finalText: 'finished', tokenUsage: { inputTokens: 1, outputTokens: 1 } },
        },
      ] as SandboxEvent[])
      const turn = await collectAgentTurn(
        streamObservedAgentTurn({ kind: 'box', box }, { prompt: 'canonical' }),
      )
      expect(turn.events.filter((event) => event.type === type)).toHaveLength(1)
      expect(turn.events.filter((event) => event.type === 'text_delta')).toHaveLength(0)
    },
  )

  it('does not expand a canonical tool part into a second tool frame', async () => {
    const box = await makeBox([
      {
        type: 'message.part.updated',
        data: {
          part: {
            id: 'part-tool',
            sessionID: 'session-1',
            messageID: 'message-1',
            type: 'tool',
            callID: 'call-1',
            tool: 'bash',
            state: { status: 'running', input: { command: 'pwd' } },
          },
        },
      },
      { type: 'done', data: { tokenUsage: { inputTokens: 1, outputTokens: 1 } } },
    ] as SandboxEvent[])
    const turn = await collectAgentTurn(
      streamObservedAgentTurn(
        { kind: 'box', box },
        { prompt: 'run pwd' },
        { preserveToolParts: true },
      ),
    )
    expect(turn.events.filter((event) => event.type === 'message.part.updated')).toHaveLength(1)
    expect(turn.events.filter((event) => event.type === 'tool_call')).toHaveLength(0)
  })

  it('keeps an unknown provider payload on the observer path only', async () => {
    const observed: SandboxEvent[] = []
    const box = await makeBox([
      { type: 'provider.secret', data: { token: 'do-not-persist' } },
      { type: 'done', data: { tokenUsage: { inputTokens: 1, outputTokens: 1 } } },
    ] as SandboxEvent[])
    const turn = await collectAgentTurn(
      streamObservedAgentTurn(
        { kind: 'box', box },
        { prompt: 'observe' },
        {
          onRawEvent: (event) => {
            observed.push(event)
          },
        },
      ),
    )
    expect(observed.map((event) => event.type)).toContain('provider.secret')
    expect(turn.events.some((event) => event.type === 'raw')).toBe(false)
  })
})

describe('streamAgentTurn: tool-part preservation (opt-in)', () => {
  const toolFrames = [
    {
      type: 'message.part.updated',
      data: {
        part: {
          type: 'tool',
          callID: 'call-1',
          tool: 'bash',
          state: { status: 'running', input: { cmd: 'ls' } },
        },
      },
    },
    // Repeated non-terminal frame on the same call — must dedupe to nothing.
    {
      type: 'message.part.updated',
      data: {
        part: {
          type: 'tool',
          callID: 'call-1',
          tool: 'bash',
          state: { status: 'running', input: { cmd: 'ls' } },
        },
      },
    },
    {
      type: 'message.part.updated',
      data: {
        part: {
          type: 'tool',
          callID: 'call-1',
          tool: 'bash',
          state: { status: 'completed', input: { cmd: 'ls' }, output: 'file.txt' },
        },
      },
    },
    { type: 'message.part.updated', data: { part: { type: 'text' }, delta: 'listed' } },
    { type: 'done', data: { tokenUsage: { inputTokens: 5, outputTokens: 2 } } },
  ] as SandboxEvent[]

  async function makeBox(events: SandboxEvent[]) {
    const client = inProcessSandboxClient({ onPrompt: () => events })
    return client.create()
  }

  it('preserveToolParts: true surfaces deduped tool_call/tool_result in-stream', async () => {
    const box = await makeBox(toolFrames)
    const turn = await collectAgentTurn(
      streamObservedAgentTurn(
        { kind: 'box', box },
        { prompt: 'list files' },
        { preserveToolParts: true },
      ),
    )
    expect(turn.events.map((e) => e.type)).toEqual([
      'backend_start',
      'tool_call',
      'tool_result',
      'text_delta',
      'llm_call',
      'final',
    ])
    const call = turn.events[1]
    if (call?.type !== 'tool_call') throw new Error('expected tool_call')
    expect(call).toMatchObject({ toolName: 'bash', toolCallId: 'call-1', args: { cmd: 'ls' } })
    const result = turn.events[2]
    if (result?.type !== 'tool_result') throw new Error('expected tool_result')
    expect(result).toMatchObject({ toolName: 'bash', toolCallId: 'call-1', result: 'file.txt' })
    // The projection is additive: text/usage folding is unchanged.
    expect(turn.finalText).toBe('listed')
    expect(turn.usage).toEqual({ input: 5, output: 2, usdKnown: false })
  })

  it('default (off) leaves the stream vocabulary unchanged — no tool events', async () => {
    const box = await makeBox(toolFrames)
    const turn = await collectAgentTurn(
      streamObservedAgentTurn({ kind: 'box', box }, { prompt: 'list files' }),
    )
    expect(turn.events.map((e) => e.type)).toEqual([
      'backend_start',
      'text_delta',
      'llm_call',
      'final',
    ])
  })

  it('a terminal failure status projects a tool_result carrying the error in-band', async () => {
    const box = await makeBox([
      {
        type: 'message.part.updated',
        data: {
          part: {
            type: 'tool',
            callID: 'call-9',
            tool: 'web_fetch',
            state: { status: 'failed', input: { url: 'https://x' }, error: 'connection refused' },
          },
        },
      },
      { type: 'done', data: { tokenUsage: { inputTokens: 1, outputTokens: 1 } } },
    ] as SandboxEvent[])
    const turn = await collectAgentTurn(
      streamObservedAgentTurn(
        { kind: 'box', box },
        { prompt: 'fetch' },
        { preserveToolParts: true },
      ),
    )
    const types = turn.events.map((e) => e.type)
    expect(types).toEqual(['backend_start', 'tool_call', 'tool_result', 'llm_call', 'final'])
    const result = turn.events[2]
    if (result?.type !== 'tool_result') throw new Error('expected tool_result')
    expect(result.result).toEqual({ error: 'connection refused', status: 'failed' })
  })

  it('bare tool.* event types project statelessly', async () => {
    const client = inProcessSandboxClient({
      onPrompt: () =>
        [
          { type: 'tool.call', data: { id: 't-1', name: 'search', input: { q: 'tangle' } } },
          { type: 'tool.result', data: { id: 't-1', name: 'search', output: 'hit' } },
          { type: 'done', data: { tokenUsage: { inputTokens: 3, outputTokens: 1 } } },
        ] as SandboxEvent[],
    })
    const box = await client.create()
    const turn = await collectAgentTurn(
      streamObservedAgentTurn(
        { kind: 'box', box },
        { prompt: 'search' },
        { preserveToolParts: true },
      ),
    )
    expect(turn.events.map((e) => e.type)).toEqual([
      'backend_start',
      'tool_call',
      'tool_result',
      'llm_call',
      'final',
    ])
    expect(turn.events[1]).toMatchObject({ toolName: 'search', toolCallId: 't-1' })
    expect(turn.events[2]).toMatchObject({ toolCallId: 't-1', result: 'hit' })
  })
})

describe('streamAgentTurn: raw-event tap (onRawEvent)', () => {
  it('receives EVERY raw sandbox event — including unmapped ones — before its projection, awaited', async () => {
    const log: string[] = []
    const client = inProcessSandboxClient({
      onPrompt: () =>
        [
          // `step-start` has no chat-UX projection — the tap must still see it.
          { type: 'message.part.updated', data: { part: { type: 'step-start' } } },
          { type: 'message.part.updated', data: { part: { type: 'text' }, delta: 'hi' } },
          { type: 'done', data: { tokenUsage: { inputTokens: 2, outputTokens: 1 } } },
        ] as SandboxEvent[],
    })
    const box = await client.create()
    const stream = streamObservedAgentTurn(
      { kind: 'box', box },
      { prompt: 'go' },
      {
        onRawEvent: async (event) => {
          // Async on purpose: the drive must AWAIT the tap before projecting.
          await Promise.resolve()
          log.push(`raw:${String(event.type)}`)
        },
      },
    )
    for await (const event of stream) log.push(`mapped:${event.type}`)
    expect(log).toEqual([
      'mapped:backend_start',
      'raw:message.part.updated',
      'raw:message.part.updated',
      'mapped:text_delta',
      'raw:done',
      'mapped:llm_call',
      'mapped:final',
    ])
  })
})

describe('streamAgentTurn: mid-stream lifecycle (pull-based, no extra API)', () => {
  it('caller-side async work between events suspends production — nothing is produced past the held event', async () => {
    const log: string[] = []
    const client = inProcessSandboxClient({
      onPrompt: async function* (): AsyncIterable<SandboxEvent> {
        log.push('produced:a')
        yield {
          type: 'message.part.updated',
          data: { part: { type: 'text' }, delta: 'a' },
        } as SandboxEvent
        log.push('produced:b')
        yield {
          type: 'message.part.updated',
          data: { part: { type: 'text' }, delta: 'b' },
        } as SandboxEvent
        log.push('produced:done')
        yield {
          type: 'done',
          data: { tokenUsage: { inputTokens: 1, outputTokens: 1 } },
        } as SandboxEvent
      },
    })
    const box = await client.create()
    for await (const event of streamObservedAgentTurn({ kind: 'box', box }, { prompt: 'go' })) {
      log.push(`consumed:${event.type}`)
      // The mid-stream escape: arbitrary awaited work (a vault sync, a retry
      // decision) runs here while the producer is suspended.
      await new Promise((resolve) => setTimeout(resolve, 1))
      log.push(`synced:${event.type}`)
    }
    expect(log).toEqual([
      'consumed:backend_start',
      'synced:backend_start',
      'produced:a',
      'consumed:text_delta',
      'synced:text_delta',
      'produced:b',
      'consumed:text_delta',
      'synced:text_delta',
      'produced:done',
      'consumed:llm_call',
      'synced:llm_call',
      'consumed:final',
      'synced:final',
    ])
  })

  it('a consumer can run pre-done work on `final` and withhold/replace the terminal event downstream', async () => {
    // The physim pattern: vault-sync BEFORE forwarding a terminal event, and a
    // noop-retry that swallows the first turn's `final` and re-drives.
    const client = inProcessSandboxClient({
      onPrompt: (_prompt, ctx) =>
        ctx.round === 0
          ? ([
              { type: 'done', data: { tokenUsage: { inputTokens: 1, outputTokens: 0 } } },
            ] as SandboxEvent[])
          : ([
              {
                type: 'message.part.updated',
                data: { part: { type: 'text' }, delta: 'real answer' },
              },
              { type: 'done', data: { tokenUsage: { inputTokens: 2, outputTokens: 2 } } },
            ] as SandboxEvent[]),
    })
    const box = await client.create()
    const downstream: string[] = []
    let synced = false

    async function* withLifecycle(): AsyncGenerator<RuntimeStreamEvent> {
      const first = await collectAgentTurn(
        streamObservedAgentTurn({ kind: 'box', box }, { prompt: 'attempt' }),
      )
      const noop = first.finalText === '' && first.status === 'completed'
      if (noop) {
        // Retry with a steering prompt — the first `final` is never forwarded.
        for await (const event of streamObservedAgentTurn(
          { kind: 'box', box },
          { prompt: 'attempt (retry)' },
        )) {
          if (event.type === 'final') {
            synced = true // pre-done lifecycle work completes before forwarding
          }
          yield event
        }
        return
      }
      for (const event of first.events) yield event
    }

    for await (const event of withLifecycle()) downstream.push(event.type)
    expect(synced).toBe(true)
    // Exactly ONE terminal event reached downstream — the retry's, not the noop's.
    expect(downstream.filter((t) => t === 'final')).toHaveLength(1)
    expect(downstream).toContain('text_delta')
  })
})

describe('streamAgentTurn: executor backend', () => {
  function stubFactory(opts?: {
    onTeardown?: () => void
    hangUntilAbort?: boolean
  }): ExecutorFactory<unknown> {
    return (spec, ctx): Executor<unknown> => {
      const attemptId = ctx.node?.attemptId ?? 'stub-attempt'
      const executor: Executor<unknown> = {
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
          const prompt =
            task && typeof task === 'object' && 'prompt' in task && typeof task.prompt === 'string'
              ? task.prompt
              : String(task)
          return {
            outRef: 'stub-1',
            out: { content: `echo: ${prompt}`, transportAttempts: 2 },
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
      }
      return attestRuntimeOwnedExecutor(
        executor,
        {
          effectiveProfile: spec.profile,
          backend: 'inline-test',
          model: { status: 'known', id: 'offline-test-model' },
          execution: { kind: 'request', id: attemptId },
          materializer: 'offline-test-executor',
          plan: { kind: 'offline-test' },
        },
        {
          attemptId,
          binding: { kind: 'offline-test', attemptId },
          descriptor: { kind: 'offline-test', transport: 'in-process' },
        },
      )
    }
  }

  it('rejects an incomplete execution profile before constructing an executor', async () => {
    let factoryCalls = 0
    const factory: ExecutorFactory<unknown> = (...args) => {
      factoryCalls += 1
      return stubFactory()(...args)
    }

    await expect(
      collectAgentTurn(
        streamAgentTurn(
          {
            kind: 'executor',
            factory,
            profile: { name: 'incomplete', model: { default: 'offline-test-model' } },
          },
          { prompt: 'must not run' },
        ),
      ),
    ).rejects.toThrow(/AgentProfile\.harness must be explicit/u)
    expect(factoryCalls).toBe(0)
  })

  it('runs the factory once and terminates with the executor usage', async () => {
    let toreDown = 0
    const stream = streamAgentTurn(
      {
        kind: 'executor',
        factory: stubFactory({ onTeardown: () => toreDown++ }),
        profile: TEST_PROFILE,
      },
      { prompt: 'ping' },
    )
    const turn = await collectAgentTurn(stream)
    expect(turn.finalText).toBe('echo: ping')
    expect(turn.usage).toEqual({
      input: 11,
      output: 6,
      costUsd: 0.005,
    })
    expect(turn.status).toBe('completed')
    expect(turn.transportAttempts).toBe(2)
    const final = turn.events.at(-1)
    expect(final?.type).toBe('final')
    if (final?.type !== 'final') throw new Error('expected final turn event')
    expect(final.metadata).toMatchObject({ transportAttempts: 2 })
    // Incremental metering surfaces before the terminal event.
    expect(turn.events.map((e) => e.type)).toEqual([
      'backend_start',
      'llm_call',
      'artifact',
      'final',
    ])
    expect(toreDown).toBe(1)
  })

  it('uses one detached profile snapshot even when the caller mutates nested input mid-turn', async () => {
    const providerOptions = { mode: 'before' }
    const profile = {
      ...TEST_PROFILE,
      model: {
        ...TEST_PROFILE.model,
        metadata: { extraBody: { provider_options: providerOptions } },
      },
    }
    let sent: Record<string, unknown> | undefined
    const turn = await collectAgentTurn(
      streamAgentTurn(
        {
          kind: 'executor',
          profile,
          factory: createExecutor({
            backend: 'router',
            routerBaseUrl: 'http://injected.invalid/v1',
            routerKey: 'injected-transport',
            complete: async (body) => {
              sent = body
              providerOptions.mode = 'after-transport-started'
              return {
                model: 'offline-test-model',
                choices: [{ message: { content: 'stable response' } }],
                usage: { prompt_tokens: 3, completion_tokens: 2 },
              }
            },
          }),
        },
        { prompt: 'ping' },
      ),
    )

    expect(turn.status).toBe('completed')
    expect(turn.finalText).toBe('stable response')
    expect(sent).toMatchObject({ provider_options: { mode: 'before' } })
  })

  it('abort reaches the executor signal and terminates with status aborted', async () => {
    let toreDown = 0
    const controller = new AbortController()
    const stream = streamAgentTurn(
      {
        kind: 'executor',
        factory: stubFactory({ hangUntilAbort: true, onTeardown: () => toreDown++ }),
        profile: TEST_PROFILE,
      },
      { prompt: 'hang' },
      { signal: controller.signal },
    )
    setTimeout(() => controller.abort(new Error('caller cancelled')), 20)
    const turn = await collectAgentTurn(stream)
    expect(turn.status).toBe('aborted')
    expect(turn.error?.message).toBe('caller cancelled')
    expect(toreDown).toBe(1)
  })

  it('enforces its deadline when an executor promise ignores cancellation', async () => {
    let toreDown = 0
    const factory: ExecutorFactory<unknown> = (spec, ctx) => {
      const attemptId = ctx.node?.attemptId ?? 'uncooperative-attempt'
      return attestRuntimeOwnedExecutor(
        {
          runtime: 'uncooperative',
          execute: async () => await new Promise<ExecutorResult<unknown>>(() => {}),
          async teardown() {
            toreDown += 1
            return { destroyed: true }
          },
          resultArtifact() {
            throw new Error('uncooperative executor has no result')
          },
        },
        {
          effectiveProfile: spec.profile,
          backend: 'inline-test',
          model: { status: 'known', id: 'offline-test-model' },
          execution: { kind: 'request', id: attemptId },
          materializer: 'offline-test-executor',
          plan: { kind: 'offline-test' },
        },
        {
          attemptId,
          binding: { kind: 'offline-test', attemptId },
          descriptor: { kind: 'offline-test', transport: 'in-process' },
        },
      )
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        { kind: 'executor', factory, profile: TEST_PROFILE },
        { prompt: 'hang' },
        { timeoutMs: 25 },
      ),
    )

    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain('timed out after 25ms')
    await Promise.resolve()
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
    for await (const event of streamObservedAgentTurn(
      { kind: 'chat', backend: stubChatBackend() },
      { prompt: 'hi' },
    )) {
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
      usdKnown: false,
    })
    expect(final.metadata).not.toHaveProperty('costUsd')
  })

  it('uses the final provider message as the normalized task intent', async () => {
    const seen: RuntimeStreamEvent[] = []
    for await (const event of streamObservedAgentTurn(
      { kind: 'chat', backend: stubChatBackend() },
      {
        providerOptions: {
          messages: [
            { role: 'system', content: 'Keep the change small.' },
            { role: 'user', content: 'Fix the failing release check.' },
          ],
        },
      },
    )) {
      seen.push(event)
    }

    const delta = seen.find((event) => event.type === 'text_delta')
    expect(delta?.task?.intent).toBe('Fix the failing release check.')
  })

  it('abort mid-stream terminates with status aborted after partial deltas', async () => {
    const controller = new AbortController()
    const stream = streamObservedAgentTurn(
      { kind: 'chat', backend: stubChatBackend({ hangUntilAbort: true }) },
      { prompt: 'hang' },
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
      streamObservedAgentTurn(
        {
          kind: 'chat',
          backend: stubChatBackend({ hangUntilAbort: true }),
        },
        { prompt: 'slow' },
        {
          timeoutMs: 25,
        },
      ),
    )
    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain('timed out after 25ms')
  })

  it('enforces its deadline when chat startup ignores cancellation', async () => {
    const backend: AgentExecutionBackend = {
      kind: 'uncooperative-start',
      start: async () => await new Promise(() => {}),
      async *stream() {
        yield* []
      },
    }

    const turn = await collectAgentTurn(
      streamObservedAgentTurn(
        { kind: 'chat', backend },
        { prompt: 'hang before start' },
        { timeoutMs: 25 },
      ),
    )

    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain('timed out after 25ms')
    expect(turn.events.map((event) => event.type)).toEqual(['backend_error', 'final'])
  })

  it('closes a chat iterator that ignores cancellation', async () => {
    let returnCalls = 0
    const events: AsyncIterable<RuntimeStreamEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => await new Promise<IteratorResult<RuntimeStreamEvent>>(() => {}),
          return: async () => {
            returnCalls += 1
            return { done: true, value: undefined }
          },
        }
      },
    }
    const backend: AgentExecutionBackend = {
      kind: 'uncooperative-stream',
      stream: () => events,
    }

    const turn = await collectAgentTurn(
      streamObservedAgentTurn(
        { kind: 'chat', backend },
        { prompt: 'hang after start' },
        { timeoutMs: 25 },
      ),
    )

    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain('timed out after 25ms')
    await Promise.resolve()
    expect(returnCalls).toBe(1)
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
