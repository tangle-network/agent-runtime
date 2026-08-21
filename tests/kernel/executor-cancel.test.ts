/**
 * `Executor.cancel` — what each backend can prove about a cancellation ask.
 *
 * The contract exists because `teardown()` returning `{ destroyed: true }` proved only that the
 * local request stopped. A client that advertises provider cancellation needs to know whether the
 * backend acknowledged anything, so every arm here answers with what it observed and nothing more.
 */

import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import type { AgentSpec, ExecutorContext, UsageEvent } from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

function ctx(): ExecutorContext {
  return { signal: new AbortController().signal, seams: {} }
}

const request = { operationId: 'op-1', reason: 'operator stopped the run' }

describe('Executor.cancel', () => {
  it('never reads a Router abort as provider acceptance', async () => {
    const spec: AgentSpec = {
      profile: testAgentProfile('router', { harness: 'cli-base' }),
      harness: null,
    }
    const executor = createExecutor({
      backend: 'router',
      routerBaseUrl: 'http://router.invalid/v1',
      routerKey: 'k',
      complete: async () => ({ choices: [{ message: { content: 'done' } }] }),
    })(spec, ctx())

    const acknowledgement = await executor.cancel?.(request)
    expect(acknowledgement).toMatchObject({ status: 'unknown', effect: 'cancel_requested' })
    expect(acknowledgement?.detail).toMatch(/no cancel operation/)
  })

  it('uses the exact box session and reports what the platform answered', async () => {
    const interrupts: string[] = []
    let cancelled = true
    const sandboxClient = {
      async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
        return {
          id: 'box-1',
          session(id: string) {
            return {
              async interrupt() {
                interrupts.push(id)
                return { cancelled }
              },
            }
          },
          async *streamPrompt(): AsyncGenerator<SandboxEvent> {
            yield { type: 'result', data: { finalText: 'done' } } as SandboxEvent
            yield { type: 'done', data: { outcome: { type: 'completed' } } } as SandboxEvent
          },
          async delete() {},
        } as unknown as SandboxInstance
      },
    }
    const spec: AgentSpec = {
      profile: testAgentProfile('steerable', { harness: 'opencode' }),
      harness: 'opencode',
    }
    const executor = createExecutor({ backend: 'sandbox', sandboxClient, steering: {} })(
      spec,
      ctx(),
    )

    // Before a box exists there is nothing remote to ask, and that is said plainly.
    expect(await executor.cancel?.(request)).toMatchObject({
      status: 'unknown',
      effect: 'cancel_requested',
    })

    const stream = executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next()

    expect(await executor.cancel?.(request)).toMatchObject({
      status: 'accepted',
      effect: 'cancelled',
    })
    expect(interrupts.length).toBeGreaterThan(0)

    cancelled = false
    expect(await executor.cancel?.(request)).toMatchObject({
      status: 'already-terminal',
      effect: 'not_live',
    })
    await iterator.return?.(undefined)
  })

  it('refuses to claim cancellation for a composed sandbox run that retains no session', async () => {
    const sandboxClient = {
      async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
        return {
          id: 'box-2',
          async *streamPrompt(): AsyncGenerator<SandboxEvent> {
            yield { type: 'done', data: { outcome: { type: 'completed' } } } as SandboxEvent
          },
          async delete() {},
        } as unknown as SandboxInstance
      },
    }
    const spec: AgentSpec = {
      profile: testAgentProfile('leaf', { harness: 'opencode' }),
      harness: 'opencode',
    }
    const executor = createExecutor({ backend: 'sandbox', sandboxClient })(spec, ctx())
    expect(await executor.cancel?.(request)).toMatchObject({
      status: 'unknown',
      effect: 'cancel_requested',
    })
  })

  it('reports the provider path as unacknowledged rather than accepted', async () => {
    const spec: AgentSpec = {
      profile: testAgentProfile('provider', { harness: 'pi' }),
      harness: null,
    }
    const executor = createExecutor({
      backend: 'provider',
      provider: {
        name: 'fixture',
        capabilities: () => ({}) as never,
        create: async () =>
          ({
            id: 'env-1',
            provider: 'fixture',
            status: async () => 'running',
            destroy: async () => {},
            stream: async function* () {},
          }) as never,
      },
    })(spec, ctx())

    const acknowledgement = await executor.cancel?.(request)
    expect(acknowledgement).toMatchObject({ status: 'unknown', effect: 'cancel_requested' })
    expect(acknowledgement?.detail).toMatch(/no durable run reference/)
  })
})
