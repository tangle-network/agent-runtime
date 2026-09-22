import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import type { RuntimeStreamEvent } from '../types'
import { inProcessEnvironmentProvider } from './in-process-environment-provider'
import { inlineEnvironmentProvider } from './inline-environment-provider'
import { collectAgentTurn, streamAgentTurn } from './stream-agent-turn'
import type { Executor, ExecutorFactory, ExecutorResult } from './supervise/types'

function finalOf(events: RuntimeStreamEvent[]): RuntimeStreamEvent & { type: 'final' } {
  const final = events.at(-1)
  if (final?.type !== 'final') throw new Error('no terminal final event')
  return final
}

const TEST_PROFILE = { name: 'turn-test' }

describe('streamAgentTurn: environment', () => {
  async function makeEnvironment(events: AgentEnvironmentEvent[]) {
    const provider = inProcessEnvironmentProvider({ onTurn: () => events })
    return provider.create({ profile: TEST_PROFILE })
  }

  it('streams incremental events and terminates with usage', async () => {
    const environment = await makeEnvironment([
      { type: 'message.part.updated', data: { part: { type: 'text' }, delta: 'Hello ' } },
      { type: 'message.part.updated', data: { part: { type: 'text' }, delta: 'world' } },
      { type: 'llm_call', data: { model: 'kimi-k2', tokensIn: 100, tokensOut: 40, costUsd: 0.02 } },
      { type: 'result', data: { finalText: 'Hello world' } },
    ])

    const seen: RuntimeStreamEvent[] = []
    for await (const event of streamAgentTurn({ kind: 'environment', environment }, 'say hello')) {
      seen.push(event)
    }
    // Incremental events surface in order, before the terminal event.
    expect(seen.map((e) => e.type)).toEqual([
      'turn_start',
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
    await expect(environment.status()).resolves.toBe('running')
    await environment.destroy?.()
  })

  it('collectAgentTurn round-trips the terminal summary', async () => {
    const environment = await makeEnvironment([
      { type: 'message.part.updated', data: { part: { type: 'text' }, delta: '42' } },
      { type: 'done', data: { tokenUsage: { inputTokens: 7, outputTokens: 3 } } },
    ])

    const turn = await collectAgentTurn(
      streamAgentTurn({ kind: 'environment', environment }, 'answer'),
    )
    expect(turn.finalText).toBe('42')
    expect(turn.usage).toEqual({ input: 7, output: 3 })
    expect(turn.status).toBe('completed')
    expect(turn.events.map((e) => e.type)).toEqual([
      'turn_start',
      'text_delta',
      'llm_call',
      'final',
    ])
  })

  it('surfaces a provider failure as turn_error + final failed without throwing', async () => {
    const provider = inProcessEnvironmentProvider({
      // biome-ignore lint/correctness/useYield: the throw-before-yield path is the test subject
      onTurn: async function* (): AsyncIterable<AgentEnvironmentEvent> {
        throw new Error('provider exploded')
      },
    })
    const environment = await provider.create({ profile: TEST_PROFILE })
    const turn = await collectAgentTurn(
      streamAgentTurn({ kind: 'environment', environment }, 'boom'),
    )
    expect(turn.status).toBe('failed')
    expect(turn.error).toMatchObject({ kind: 'execution', message: 'provider exploded' })
    const types = turn.events.map((e) => e.type)
    expect(types).toContain('turn_error')
    expect(types.at(-1)).toBe('final')
  })
})

describe('streamAgentTurn: turn fields', () => {
  it('forwards session, model, timeout, and provider fields through AgentTurnInput', async () => {
    const calls: Record<string, unknown>[] = []
    const provider = inProcessEnvironmentProvider({
      onTurn: (_prompt, ctx) => {
        calls.push(ctx.input)
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
        ]
      },
    })
    const environment = await provider.create({ profile: TEST_PROFILE })
    const turn = await collectAgentTurn(
      streamAgentTurn(
        {
          kind: 'environment',
          environment,
          turn: {
            sessionId: 'sess-1',
            model: 'kimi-k2',
            timeoutMs: 1_000,
            providerOptions: { maxTurns: 5 },
          },
        },
        'do the task',
      ),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      prompt: 'do the task',
      sessionId: 'sess-1',
      model: 'kimi-k2',
      timeoutMs: 1_000,
      providerOptions: { maxTurns: 5 },
    })
    const start = turn.events[0]
    if (start?.type !== 'turn_start') throw new Error('expected turn_start')
    expect(start.provider).toBe('in-process')
    expect(start.sessionId).toBe('sess-1')
    expect(turn.finalText).toBe('task output')
    expect(turn.usage).toEqual({ input: 9, output: 4, costUsd: 0.01, model: 'kimi-k2' })
    expect(turn.status).toBe('completed')
  })

  it('timeoutMs aborts a hanging environment turn with final.status failed', async () => {
    const provider = inProcessEnvironmentProvider({
      onTurn: async function* (_prompt, ctx): AsyncIterable<AgentEnvironmentEvent> {
        await new Promise<never>((_resolve, reject) => {
          const onAbort = () => reject(ctx.signal.reason ?? new Error('aborted'))
          if (ctx.signal.aborted) onAbort()
          else ctx.signal.addEventListener('abort', onAbort, { once: true })
        })
      },
    })
    const environment = await provider.create({ profile: TEST_PROFILE })
    const turn = await collectAgentTurn(
      streamAgentTurn({ kind: 'environment', environment }, 'hang', { timeoutMs: 25 }),
    )
    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain('timed out after 25ms')
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
  ] as AgentEnvironmentEvent[]

  async function makeEnvironment(events: AgentEnvironmentEvent[]) {
    const provider = inProcessEnvironmentProvider({ onTurn: () => events })
    return provider.create({ profile: TEST_PROFILE })
  }

  it('preserveToolParts: true surfaces deduped tool_call/tool_result in-stream', async () => {
    const environment = await makeEnvironment(toolFrames)
    const turn = await collectAgentTurn(
      streamAgentTurn({ kind: 'environment', environment }, 'list files', {
        preserveToolParts: true,
      }),
    )
    expect(turn.events.map((e) => e.type)).toEqual([
      'turn_start',
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
    expect(turn.finalText).toBe('listed')
    expect(turn.usage).toEqual({ input: 5, output: 2 })
  })

  it('leaves tool events out by default', async () => {
    const environment = await makeEnvironment(toolFrames)
    const turn = await collectAgentTurn(
      streamAgentTurn({ kind: 'environment', environment }, 'list files'),
    )
    expect(turn.events.map((e) => e.type)).toEqual([
      'turn_start',
      'text_delta',
      'llm_call',
      'final',
    ])
  })

  it('a terminal failure status projects a tool_result carrying the error in-band', async () => {
    const environment = await makeEnvironment([
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
    ])
    const turn = await collectAgentTurn(
      streamAgentTurn({ kind: 'environment', environment }, 'fetch', {
        preserveToolParts: true,
      }),
    )
    const types = turn.events.map((e) => e.type)
    expect(types).toEqual(['turn_start', 'tool_call', 'tool_result', 'llm_call', 'final'])
    const result = turn.events[2]
    if (result?.type !== 'tool_result') throw new Error('expected tool_result')
    expect(result.result).toEqual({ error: 'connection refused', status: 'failed' })
  })

  it('projects bare tool event types without cross-event state', async () => {
    const provider = inProcessEnvironmentProvider({
      onTurn: () =>
        [
          { type: 'tool.call', data: { id: 't-1', name: 'search', input: { q: 'tangle' } } },
          { type: 'tool.result', data: { id: 't-1', name: 'search', output: 'hit' } },
          { type: 'done', data: { tokenUsage: { inputTokens: 3, outputTokens: 1 } } },
        ] as AgentEnvironmentEvent[],
    })
    const environment = await provider.create({ profile: TEST_PROFILE })
    const turn = await collectAgentTurn(
      streamAgentTurn({ kind: 'environment', environment }, 'search', {
        preserveToolParts: true,
      }),
    )
    expect(turn.events.map((e) => e.type)).toEqual([
      'turn_start',
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
  it('receives every provider event before projection and awaits the callback', async () => {
    const log: string[] = []
    const provider = inProcessEnvironmentProvider({
      onTurn: () =>
        [
          { type: 'message.part.updated', data: { part: { type: 'step-start' } } },
          { type: 'message.part.updated', data: { part: { type: 'text' }, delta: 'hi' } },
          { type: 'done', data: { tokenUsage: { inputTokens: 2, outputTokens: 1 } } },
        ] as AgentEnvironmentEvent[],
    })
    const environment = await provider.create({ profile: TEST_PROFILE })
    const stream = streamAgentTurn({ kind: 'environment', environment }, 'go', {
      onRawEvent: async (event) => {
        await Promise.resolve()
        log.push(`raw:${String(event.type)}`)
      },
    })
    for await (const event of stream) log.push(`mapped:${event.type}`)
    expect(log).toEqual([
      'mapped:turn_start',
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
    const provider = inProcessEnvironmentProvider({
      onTurn: async function* (): AsyncIterable<AgentEnvironmentEvent> {
        log.push('produced:a')
        yield {
          type: 'message.part.updated',
          data: { part: { type: 'text' }, delta: 'a' },
        }
        log.push('produced:b')
        yield {
          type: 'message.part.updated',
          data: { part: { type: 'text' }, delta: 'b' },
        }
        log.push('produced:done')
        yield {
          type: 'done',
          data: { tokenUsage: { inputTokens: 1, outputTokens: 1 } },
        }
      },
    })
    const environment = await provider.create({ profile: TEST_PROFILE })
    for await (const event of streamAgentTurn({ kind: 'environment', environment }, 'go')) {
      log.push(`consumed:${event.type}`)
      await new Promise((resolve) => setTimeout(resolve, 1))
      log.push(`synced:${event.type}`)
    }
    expect(log).toEqual([
      'consumed:turn_start',
      'synced:turn_start',
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
    const provider = inProcessEnvironmentProvider({
      onTurn: (_prompt, ctx) =>
        ctx.round === 0
          ? ([
              { type: 'done', data: { tokenUsage: { inputTokens: 1, outputTokens: 0 } } },
            ] as AgentEnvironmentEvent[])
          : ([
              {
                type: 'message.part.updated',
                data: { part: { type: 'text' }, delta: 'real answer' },
              },
              { type: 'done', data: { tokenUsage: { inputTokens: 2, outputTokens: 2 } } },
            ] as AgentEnvironmentEvent[]),
    })
    const environment = await provider.create({ profile: TEST_PROFILE })
    const downstream: string[] = []
    let synced = false

    async function* withLifecycle(): AsyncGenerator<RuntimeStreamEvent> {
      const first = await collectAgentTurn(
        streamAgentTurn({ kind: 'environment', environment }, 'attempt'),
      )
      const noop = first.finalText === '' && first.status === 'completed'
      if (noop) {
        for await (const event of streamAgentTurn(
          { kind: 'environment', environment },
          'attempt (retry)',
        )) {
          if (event.type === 'final') {
            synced = true
          }
          yield event
        }
        return
      }
      for (const event of first.events) yield event
    }

    for await (const event of withLifecycle()) downstream.push(event.type)
    expect(synced).toBe(true)
    expect(downstream.filter((t) => t === 'final')).toHaveLength(1)
    expect(downstream).toContain('text_delta')
  })
})

describe('streamAgentTurn: provider-owned environment', () => {
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

  it('runs an inline executor through the provider contract and reports usage', async () => {
    let toreDown = 0
    const provider = inlineEnvironmentProvider(stubFactory({ onTeardown: () => toreDown++ }), {
      name: 'executor-provider',
    })
    const stream = streamAgentTurn({ kind: 'provider', provider, profile: TEST_PROFILE }, 'ping')
    const turn = await collectAgentTurn(stream)
    expect(turn.finalText).toBe('echo: ping')
    expect(turn.usage).toEqual({ input: 11, output: 6, costUsd: 0.005 })
    expect(turn.status).toBe('completed')
    expect(turn.events.map((e) => e.type)).toEqual(['turn_start', 'llm_call', 'final'])
    expect(toreDown).toBe(1)
  })

  it('preserves preparation, cancellation, and provider-owned cleanup', async () => {
    let toreDown = 0
    let preparedEnvironment: AgentEnvironment | undefined
    const controller = new AbortController()
    const provider = inlineEnvironmentProvider(
      stubFactory({ hangUntilAbort: true, onTeardown: () => toreDown++ }),
    )
    const stream = streamAgentTurn(
      {
        kind: 'provider',
        provider,
        profile: TEST_PROFILE,
        prepareEnvironment(environment) {
          preparedEnvironment = environment
        },
      },
      'hang',
      { signal: controller.signal },
    )
    setTimeout(() => controller.abort(new Error('caller cancelled')), 20)
    const turn = await collectAgentTurn(stream)
    expect(turn.status).toBe('aborted')
    expect(turn.error?.message).toBe('caller cancelled')
    expect(toreDown).toBe(1)
    await expect(preparedEnvironment?.status()).resolves.toBe('stopped')
  })

  it('destroys an environment when preparation fails', async () => {
    let createdEnvironment: AgentEnvironment | undefined
    const baseProvider = inProcessEnvironmentProvider({
      onTurn: () => [{ type: 'result', data: { finalText: 'unused' } }],
    })
    const provider = {
      ...baseProvider,
      async create(input: Parameters<typeof baseProvider.create>[0]) {
        createdEnvironment = await baseProvider.create(input)
        return createdEnvironment
      },
    }
    const turn = await collectAgentTurn(
      streamAgentTurn(
        {
          kind: 'provider',
          provider,
          profile: TEST_PROFILE,
          prepareEnvironment() {
            throw new Error('preparation failed')
          },
        },
        'unused',
      ),
    )
    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toBe('preparation failed')
    await expect(createdEnvironment?.status()).resolves.toBe('stopped')
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
