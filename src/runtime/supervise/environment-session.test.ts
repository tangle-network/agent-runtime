import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it, vi } from 'vitest'
import { createSteerableEnvironmentSession } from './environment-session'
import { createInbox } from './inbox'
import type { UsageEvent } from './types'

function capabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: false,
      systemPrompt: true,
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: { files: true, instructions: true },
      runtimeUpdate: false,
      validation: true,
    },
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: true, list: true, messages: true },
    workspace: {
      read: true,
      write: true,
      exec: true,
      git: true,
      upload: true,
      download: true,
    },
    branching: { checkpoint: false, fork: false },
    placement: false,
    usage: true,
    confidential: false,
  }
}

function resultEvent(text: string): AgentEnvironmentEvent {
  return { type: 'result', data: { finalText: text } }
}

describe('createSteerableEnvironmentSession', () => {
  it('continues one provider session, meters both turns, observes events, and destroys once', async () => {
    const turns: AgentTurnInput[] = []
    const destroy = vi.fn(async () => {})
    const environment: AgentEnvironment = {
      id: 'environment-1',
      provider: 'test',
      status: async () => 'running',
      async *stream(input) {
        turns.push(input)
        if (turns.length === 1) {
          yield {
            type: 'llm_call',
            data: { model: 'model', tokensIn: 5, tokensOut: 2, costUsd: 0.01 },
          }
          yield {
            type: 'message.part.updated',
            data: {
              part: {
                type: 'tool',
                tool: 'read',
                callID: 'call-1',
                state: { status: 'completed', input: { path: 'src/a.ts' } },
              },
            },
          }
          yield resultEvent('first')
          return
        }
        yield {
          type: 'llm_call',
          data: { model: 'model', tokensIn: 3, tokensOut: 1, costUsd: 0.005 },
        }
        yield resultEvent('second')
      },
      session(id) {
        return {
          id,
          status: async () => 'running',
          async *events() {},
          result: async () => ({ text: '', success: true }),
          prompt: async () => ({ text: '', success: true }),
          cancel: async () => {},
        }
      },
      destroy,
    }
    const provider: AgentEnvironmentProvider = {
      name: 'test',
      capabilities,
      create: vi.fn(async () => environment),
    }
    const inbox = createInbox()
    const observed: string[] = []
    const observeUsage = vi.fn()
    const session = createSteerableEnvironmentSession({
      controller: new AbortController(),
      profile: { name: 'worker' },
      backend: 'opencode',
      provider,
      environment: { workspace: { cwd: '/repo' } },
      inbox,
      taskToPrompt: (task) => String(task),
      loopCtx: {
        onEnvironmentEvent: (event) => {
          observed.push(event.type)
        },
        runHandle: { observe: observeUsage } as never,
      },
      contentRef: (prefix) => `${prefix}:result`,
    })

    const iterator = session
      .stream('initial task', new AbortController().signal)
      [Symbol.asyncIterator]()
    const usage: UsageEvent[] = []
    usage.push((await iterator.next()).value as UsageEvent)
    inbox.deliver({ steer: 'inspect the failing file', interrupt: false })
    for (;;) {
      const next = await iterator.next()
      if (next.done) break
      usage.push(next.value)
    }

    expect(provider.create).toHaveBeenCalledTimes(1)
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'opencode',
        workspace: { cwd: '/repo' },
      }),
    )
    expect(turns).toHaveLength(2)
    expect(turns[0]?.sessionId).toBe(turns[1]?.sessionId)
    expect(turns[0]?.prompt).toBe('initial task')
    expect(turns[1]?.prompt).toContain('inspect the failing file')
    expect(usage).toEqual([
      { kind: 'tokens', input: 5, output: 2 },
      { kind: 'cost', usd: 0.01 },
      { kind: 'iteration' },
      { kind: 'tokens', input: 3, output: 1 },
      { kind: 'cost', usd: 0.005 },
      { kind: 'iteration' },
    ])
    expect(observed).toEqual(['llm_call', 'message.part.updated', 'result', 'llm_call', 'result'])
    expect(observeUsage).toHaveBeenCalledTimes(2)
    expect(session.artifact()).toMatchObject({
      out: { content: 'second', turns: 2, toolCalls: ['read'] },
      spent: {
        iterations: 2,
        tokens: { input: 8, output: 3 },
        usd: 0.015,
      },
    })
    expect(await session.traceSource().collect()).toHaveLength(1)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('marks dollar cost unknown when a provider reports tokens without cost', async () => {
    const environment: AgentEnvironment = {
      id: 'environment-unknown-cost',
      provider: 'test',
      status: async () => 'running',
      async *stream() {
        yield {
          type: 'llm_call',
          data: { model: 'unpriced-model', tokensIn: 9, tokensOut: 2 },
        }
        yield resultEvent('done')
      },
      session(id) {
        return {
          id,
          status: async () => 'running',
          async *events() {},
          result: async () => ({ text: '', success: true }),
          prompt: async () => ({ text: '', success: true }),
          cancel: async () => {},
        }
      },
      destroy: async () => {},
    }
    const session = createSteerableEnvironmentSession({
      controller: new AbortController(),
      profile: { name: 'worker' },
      provider: {
        name: 'test',
        capabilities,
        create: async () => environment,
      },
      inbox: createInbox(),
      taskToPrompt: String,
      contentRef: (prefix) => prefix,
    })

    for await (const _event of session.stream('task', new AbortController().signal)) {
      // Drain the session so its terminal artifact is available.
    }

    expect(session.artifact()?.spent).toMatchObject({
      iterations: 1,
      tokens: { input: 9, output: 2 },
      usd: 0,
      usdKnown: false,
    })
  })

  it('propagates external cancellation and destroys the environment', async () => {
    const entered = vi.fn()
    const destroy = vi.fn(async () => {})
    const environment: AgentEnvironment = {
      id: 'environment-cancel',
      provider: 'test',
      status: async () => 'running',
      async *stream(input) {
        entered()
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) resolve()
          else input.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      },
      session(id) {
        return {
          id,
          status: async () => 'running',
          async *events() {},
          result: async () => ({ text: '', success: true }),
          prompt: async () => ({ text: '', success: true }),
          cancel: async () => {},
        }
      },
      destroy,
    }
    const provider: AgentEnvironmentProvider = {
      name: 'test',
      capabilities,
      create: async () => environment,
    }
    const controller = new AbortController()
    const session = createSteerableEnvironmentSession({
      controller: new AbortController(),
      profile: { name: 'worker' },
      backend: 'codex',
      provider,
      inbox: createInbox(),
      taskToPrompt: String,
      contentRef: (prefix) => prefix,
    })

    const pending = (async () => {
      for await (const _event of session.stream('task', controller.signal)) {
        // No usage events are expected before cancellation.
      }
    })()
    while (entered.mock.calls.length === 0) await Promise.resolve()
    controller.abort()

    await expect(pending).rejects.toThrow(/aborted/)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('fails instead of dropping steering delivered at the turn limit', async () => {
    const destroy = vi.fn(async () => {})
    const environment: AgentEnvironment = {
      id: 'environment-max-turns',
      provider: 'test',
      status: async () => 'running',
      async *stream() {
        yield resultEvent('first')
      },
      session(id) {
        return {
          id,
          status: async () => 'running',
          async *events() {},
          result: async () => ({ text: '', success: true }),
          prompt: async () => ({ text: '', success: true }),
          cancel: async () => {},
        }
      },
      destroy,
    }
    const provider: AgentEnvironmentProvider = {
      name: 'test',
      capabilities,
      create: async () => environment,
    }
    const inbox = createInbox()
    const session = createSteerableEnvironmentSession({
      controller: new AbortController(),
      profile: { name: 'worker' },
      provider,
      inbox,
      taskToPrompt: String,
      options: { maxTurns: 1 },
      contentRef: (prefix) => prefix,
    })
    const iterator = session.stream('task', new AbortController().signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'iteration' },
    })
    inbox.deliver({ steer: 'late correction', interrupt: false })

    await expect(iterator.next()).rejects.toThrow('maxTurns 1 reached with 1 unread message(s)')
    expect(session.artifact()).toBeUndefined()
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
