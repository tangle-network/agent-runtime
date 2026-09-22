import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import {
  createCliBridgeProvider,
  defaultCliBridgeCapabilities,
} from '@tangle-network/agent-provider-cli-bridge'
import { describe, expect, it, vi } from 'vitest'
import {
  type EnvironmentDeliverable,
  EnvironmentRunAbortError,
  openEnvironmentRun,
} from '../../src/runtime/environment-run'
import type { AgentRunSpec } from '../../src/runtime/types'

const deliverable: EnvironmentDeliverable<string> = {
  kind: 'events',
  fromEvents: (events) =>
    String((events.at(-1)?.data as { finalText?: string } | undefined)?.finalText ?? ''),
}

const agentRun: AgentRunSpec<string> = {
  profile: { name: 'worker' },
  name: 'worker',
  taskToPrompt: (task) => task,
}

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

function providerWithStream(options: {
  stream: (input: AgentTurnInput) => AsyncIterable<AgentEnvironmentEvent>
  destroy?: () => Promise<void>
}): AgentEnvironmentProvider {
  return {
    name: 'lifecycle-provider',
    capabilities: defaultCliBridgeCapabilities,
    async create(): Promise<AgentEnvironment> {
      return {
        id: 'environment-1',
        provider: 'lifecycle-provider',
        async status() {
          return 'running'
        },
        stream: options.stream,
        ...(options.destroy ? { destroy: options.destroy } : {}),
      }
    },
  }
}

async function* completedTurn(): AsyncIterable<AgentEnvironmentEvent> {
  yield { type: 'result', data: { finalText: 'done' } }
}

describe('openEnvironmentRun provider continuation', () => {
  it('resumes the official CLI provider by stable session id without session()', async () => {
    const sessionIds: Array<string | null> = []
    const provider = createCliBridgeProvider({
      baseUrl: 'https://cli-bridge.test',
      fetch: async (_input, init) => {
        sessionIds.push(new Headers(init?.headers).get('x-session-id'))
        return new Response(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }],
          })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        )
      },
    })
    const run = await openEnvironmentRun({
      provider,
      agentRun,
      deliverable,
      signal: new AbortController().signal,
    })

    await run.turn('first')
    expect(run.environment.session).toBeUndefined()
    await run.turn('second')
    await run.close()

    expect(sessionIds).toHaveLength(2)
    expect(sessionIds[0]).toMatch(/^round-session-/)
    expect(sessionIds[1]).toBe(sessionIds[0])
  })
})

describe('openEnvironmentRun turn ownership', () => {
  it('rejects a concurrent resume while one turn is active', async () => {
    const resumeStarted = deferred()
    const releaseResume = deferred()
    let calls = 0
    const provider = providerWithStream({
      stream: async function* () {
        calls += 1
        if (calls === 2) {
          resumeStarted.resolve()
          await releaseResume.promise
        }
        yield { type: 'result', data: { finalText: 'done' } }
      },
    })
    const run = await openEnvironmentRun({
      provider,
      agentRun,
      deliverable,
      signal: new AbortController().signal,
    })
    await run.turn('first')
    const activeResume = run.turn('second')
    await resumeStarted.promise

    await expect(run.turn('third')).rejects.toThrow(/turn is already active/)
    expect(calls).toBe(2)

    releaseResume.resolve()
    await activeResume
    await run.close()
  })

  it('close aborts and awaits the active turn before destroying its environment', async () => {
    const streamStarted = deferred()
    const abortObserved = deferred()
    const releaseCleanup = deferred()
    const sequence: string[] = []
    const provider = providerWithStream({
      stream: async function* (input) {
        sequence.push('stream-started')
        streamStarted.resolve()
        await new Promise<never>((_resolve, reject) => {
          const onAbort = () => {
            sequence.push('abort-observed')
            abortObserved.resolve()
            void releaseCleanup.promise.then(() => {
              sequence.push('turn-settled')
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            })
          }
          if (input.signal?.aborted) onAbort()
          else input.signal?.addEventListener('abort', onAbort, { once: true })
        })
      },
      async destroy() {
        sequence.push('destroyed')
      },
    })
    const run = await openEnvironmentRun({
      provider,
      agentRun,
      deliverable,
      signal: new AbortController().signal,
    })
    const turn = run.turn('long turn').catch((error: unknown) => error)
    await streamStarted.promise

    const closing = run.close()
    await abortObserved.promise
    expect(sequence).toEqual(['stream-started', 'abort-observed'])
    await expect(run.turn('too late')).rejects.toThrow(/run is closed/)

    releaseCleanup.resolve()
    expect(await turn).toBeInstanceOf(EnvironmentRunAbortError)
    await closing
    expect(sequence).toEqual(['stream-started', 'abort-observed', 'turn-settled', 'destroyed'])
  })
})

describe('openEnvironmentRun destruction failures', () => {
  it('rejects close when environment destruction fails', async () => {
    const provider = providerWithStream({
      stream: completedTurn,
      async destroy() {
        throw new Error('destroy failed')
      },
    })
    const run = await openEnvironmentRun({
      provider,
      agentRun,
      deliverable,
      signal: new AbortController().signal,
    })
    await run.turn('first')

    await expect(run.close()).rejects.toThrow(/destroy failed/)
  })

  it('rejects close when environment destruction does not settle', async () => {
    vi.useFakeTimers()
    try {
      const provider = providerWithStream({
        stream: completedTurn,
        destroy: () => new Promise<void>(() => {}),
      })
      const run = await openEnvironmentRun({
        provider,
        agentRun,
        deliverable,
        signal: new AbortController().signal,
      })
      await run.turn('first')

      const closing = run.close()
      const rejection = expect(closing).rejects.toThrow(/timed out/)
      await vi.advanceTimersByTimeAsync(15_000)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })
})
