import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentSession,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it, vi } from 'vitest'
import { turnEvents } from './environment-lineage'

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('turnEvents polling cancellation', () => {
  it('rejects promptly and cancels a session whose result never settles', async () => {
    const controller = new AbortController()
    const resultStarted = deferred()
    const cancel = vi.fn(async () => {
      throw new Error('provider cancellation failed')
    })
    const result = new Promise<never>(() => {})
    const session: AgentSession = {
      id: 'session-1',
      async status() {
        return 'running'
      },
      async *events(): AsyncIterable<AgentEnvironmentEvent> {},
      async result() {
        resultStarted.resolve()
        return result
      },
      async prompt() {
        return { text: '', success: true }
      },
      cancel,
    }
    const environment: AgentEnvironment = {
      id: 'environment-1',
      provider: 'poll-provider',
      async status() {
        return 'running'
      },
      async *stream(): AsyncIterable<AgentEnvironmentEvent> {},
      async dispatch() {
        return { id: session.id, provider: 'poll-provider' }
      },
      session() {
        return session
      },
    }

    const consume = (async () => {
      for await (const _event of turnEvents(
        'poll',
        environment,
        'solve it',
        session.id,
        controller.signal,
      )) {
        // The pending result never emits an event.
      }
    })()
    await resultStarted.promise
    controller.abort()

    await expect(consume).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
  })
})
