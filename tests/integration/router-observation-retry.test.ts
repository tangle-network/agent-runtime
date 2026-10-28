import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { createExecutor } from '../../src/runtime'

const run = promisify(execFile)

/**
 * The SDKError of a caller's own agent-core copy. discovery-lab pinned agent-core 1.0.0 while
 * Runtime 2.0.2 required ^1.0.1, so npm installed two copies and the caller's error was not an
 * `instanceof` Runtime's class. Same name, same fields, different class: exactly that case.
 */
class ForeignSDKError extends Error {
  readonly code = 'UNKNOWN'
  readonly context = { phase: 'response_observation' }
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SDKError'
  }
}

/** One real OS process per model call, observed after the request deadline (discovery-lab's
 *  runner/seat-observation scenario 'capture failure after request deadline'). */
async function seatRun(failure: (cause: unknown) => Error) {
  let processes = 0
  const executor = createExecutor({
    backend: 'router-tools',
    routerBaseUrl: 'http://unused.invalid',
    routerKey: 'local-protocol-fixture',
    complete: async (_body, request) => {
      await run(process.execPath, ['-e', 'process.exit(0)'])
      processes += 1
      // The process completed; its capture outlives the per-request deadline and fails.
      if (!request.signal?.aborted) await once(request.signal!, 'abort')
      throw failure(new Error('capture sink refused'))
    },
    tools: [
      {
        type: 'function',
        function: { name: 'write_result', parameters: { type: 'object', properties: {} } },
      },
    ],
    executeToolCall: async () => 'written',
  })(
    {
      profile: {
        name: 'seat-observation',
        harness: 'cli-base',
        model: {
          provider: 'router',
          default: 'gpt-6.1-sol',
          metadata: {
            maxTurns: 1,
            retry: {
              maxAttempts: 3,
              initialBackoffMs: 0,
              maxBackoffMs: 0,
              jitter: 0,
              requestTimeoutMs: 200,
            },
          },
        },
        prompt: { systemPrompt: 'Use the supplied tool.' },
        tools: { write_result: true },
      },
      harness: null,
    },
    { signal: new AbortController().signal, seams: {} },
  )
  let thrown: unknown
  try {
    await executor.execute('Write one result.', new AbortController().signal)
  } catch (error) {
    thrown = error
  } finally {
    await executor.teardown?.(0)
  }
  return { processes, thrown }
}

describe('a Router call whose completed response could not be observed', () => {
  it('never runs the completed call again, whichever agent-core copy threw', async () => {
    const { processes, thrown } = await seatRun(
      (cause) => new ForeignSDKError('Subscription completion observation failed', { cause }),
    )
    expect(processes).toBe(1)
    expect(String((thrown as Error)?.message)).toMatch(/observation failed/u)
  }, 20_000)

  it('still retries a request that failed at its deadline without completing', async () => {
    const { processes } = await seatRun((cause) => new Error('upstream stalled', { cause }))
    expect(processes).toBe(3)
  }, 20_000)
})
