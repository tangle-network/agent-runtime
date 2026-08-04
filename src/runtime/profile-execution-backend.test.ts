import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import { runAgentTaskStream } from '../run'
import type { RuntimeStreamEvent } from '../types'
import { createProfileExecutionBackend } from './profile-execution-backend'
import { createExecutor } from './supervise/runtime'

const profile = {
  name: 'profile-backend-test',
  harness: 'cli-base',
  model: { provider: 'offline', default: 'offline/profile-backend' },
} satisfies AgentProfile

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
})
