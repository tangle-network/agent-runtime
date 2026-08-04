import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import { createIterableBackend } from '../backends'
import { defineConversation } from '../conversation/define-conversation'
import { FORWARD_HEADERS } from '../conversation/headers'
import { runConversation } from '../conversation/run-conversation'
import { runAgentTaskStream } from '../run'
import type { AgentExecutionBackend, RuntimeStreamEvent } from '../types'
import { createProfileExecutionBackend } from './profile-execution-backend'
import { createExecutor } from './supervise/runtime'

const profile = {
  name: 'profile-backend-test',
  harness: 'cli-base',
  model: { provider: 'offline', default: 'offline/profile-backend' },
} satisfies AgentProfile

function fixedTextBackend(text: string): AgentExecutionBackend {
  return createIterableBackend({
    kind: 'fixed-text',
    async *stream(_input, context) {
      yield {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text,
        timestamp: new Date().toISOString(),
      }
    },
  })
}

describe('createProfileExecutionBackend', () => {
  it('runs through runAgentTaskStream with one outer terminal event and the exact profile', async () => {
    const complete = vi.fn(async (_body: Record<string, unknown>) => ({
      model: 'offline/profile-backend',
      choices: [{ message: { content: 'profile-owned answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    }))
    const backend = createProfileExecutionBackend({
      profile,
      executor: createExecutor({
        backend: 'router',
        routerBaseUrl: 'http://offline.invalid/v1',
        routerKey: 'offline',
        complete,
      }),
    })

    const events: RuntimeStreamEvent[] = []
    for await (const event of runAgentTaskStream({
      task: { id: 'profile-task', intent: 'answer from the declared profile' },
      backend,
    })) {
      events.push(event)
    }

    expect(complete).toHaveBeenCalledOnce()
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      model: 'offline/profile-backend',
      messages: [{ role: 'user', content: 'answer from the declared profile' }],
    })
    expect(events.filter((event) => event.type === 'final')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      status: 'completed',
      text: 'profile-owned answer',
    })
    const modelCall = events.find((event) => event.type === 'llm_call')
    expect(modelCall).toMatchObject({
      type: 'llm_call',
      task: { id: 'profile-task' },
      model: 'offline/profile-backend',
      tokensIn: 4,
      tokensOut: 2,
    })
  })

  it('rejects an incomplete profile before constructing an executor', () => {
    const executor = vi.fn()
    expect(() =>
      createProfileExecutionBackend({
        profile: { name: 'incomplete' } as AgentProfile,
        executor,
      }),
    ).toThrow(/AgentProfile\.harness must be explicit/u)
    expect(executor).not.toHaveBeenCalled()
  })

  it('forwards conversation authorization, depth, and trace headers into the Router request', async () => {
    let requestHeaders: Readonly<Record<string, string>> | undefined
    const complete = vi.fn(
      async (
        _body: Record<string, unknown>,
        request?: {
          readonly headers: Readonly<Record<string, string>>
          readonly signal?: AbortSignal
        },
      ) => {
        requestHeaders = request?.headers
        return {
          model: 'offline/profile-backend',
          choices: [{ message: { content: 'ack' } }],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }
      },
    )
    const backend = createProfileExecutionBackend({
      profile,
      executor: createExecutor({
        backend: 'router',
        routerBaseUrl: 'http://offline.invalid/v1',
        routerKey: 'agent-key',
        complete,
      }),
    })
    const conversation = defineConversation({
      participants: [
        { name: 'profile-worker', backend },
        { name: 'other', backend: fixedTextBackend('unused') },
      ],
      policy: { maxTurns: 1 },
    })

    await runConversation(conversation, {
      seed: 'go',
      runId: 'run-headers',
      parentTurnId: 'parent-turn',
      inboundDepth: 2,
      propagatedHeaders: {
        [FORWARD_HEADERS.authorization]: 'Bearer user-key',
      },
    })

    expect(complete).toHaveBeenCalledOnce()
    expect(requestHeaders).toMatchObject({
      authorization: 'Bearer agent-key',
      [FORWARD_HEADERS.authorization]: 'Bearer user-key',
      [FORWARD_HEADERS.depth]: '3',
      [FORWARD_HEADERS.runId]: 'run-headers',
      [FORWARD_HEADERS.parentTurnId]: 'parent-turn',
      [FORWARD_HEADERS.speaker]: 'profile-worker',
      'x-correlation-id': 'run-headers',
    })
    expect(requestHeaders?.[FORWARD_HEADERS.turnId]).toBeDefined()
    expect(requestHeaders?.['idempotency-key']).toBe(requestHeaders?.[FORWARD_HEADERS.turnId])
  })

  it('keeps agent-owned Router credentials without forwarding the caller authorization', async () => {
    let requestHeaders: Readonly<Record<string, string>> | undefined
    const backend = createProfileExecutionBackend({
      profile,
      executor: createExecutor({
        backend: 'router',
        routerBaseUrl: 'http://offline.invalid/v1',
        routerKey: 'agent-key',
        complete: async (_body, request) => {
          requestHeaders = request?.headers
          return {
            model: 'offline/profile-backend',
            choices: [{ message: { content: 'ack' } }],
            usage: { prompt_tokens: 2, completion_tokens: 1 },
          }
        },
      }),
    })
    const conversation = defineConversation({
      participants: [
        { name: 'profile-worker', backend, authSource: 'agent-owned' },
        { name: 'other', backend: fixedTextBackend('unused') },
      ],
      policy: { maxTurns: 1 },
    })

    await runConversation(conversation, {
      seed: 'go',
      runId: 'run-agent-owned',
      propagatedHeaders: {
        [FORWARD_HEADERS.authorization]: 'Bearer user-key',
      },
    })

    expect(requestHeaders?.authorization).toBe('Bearer agent-key')
    expect(requestHeaders?.[FORWARD_HEADERS.authorization]).toBeUndefined()
    expect(requestHeaders?.[FORWARD_HEADERS.depth]).toBe('1')
  })
})
