/**
 * A TEARDOWN FAILURE IS NOT AN OUTCOME.
 *
 * Measured on three real boxes (agent-sdk#280): a provider environment's SECOND delete answered
 * `409`, the rejection escaped `streamProviderExecutor`'s `finally`, and a run whose turn had
 * already completed — terminal event yielded, artifact produced, `spent.iterations: 1` — was
 * reported as a failure. The work was done and the result was thrown away because the cleanup that
 * followed it did not go through.
 *
 * The rule these tests hold: once the stream has yielded its terminal event the result is SETTLED.
 * A teardown failure after that is recorded as a `teardown` warning beside the settled record, with
 * the error, and never replaces the outcome. Before any terminal event there is no outcome to
 * protect, so the failure IS the outcome and still propagates.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  type AgentEnvironment,
  type AgentEnvironmentEvent,
  type AgentEnvironmentProvider,
  providerAsExecutor,
} from '../../src/runtime/environment-provider'
import type { AgentSpec, ExecutorContext, UsageEvent } from '../../src/runtime/supervise/types'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const value of iterable) out.push(value)
  return out
}

const completedTurn = async function* (): AsyncIterable<AgentEnvironmentEvent> {
  yield { type: 'message.part.updated', data: { delta: 'the patch ' } }
  yield {
    type: 'result',
    data: { finalText: 'the patch applied' },
    usage: { inputTokens: 7, outputTokens: 11, cost: 0.03 },
  }
}

/** A provider whose environment completes its turn and then refuses to be deleted — the exact
 *  shape the boxes produced: the delete lands on a resource a prior delete already removed. */
function provider(options: {
  stream: () => AsyncIterable<AgentEnvironmentEvent>
  destroy: () => Promise<void>
  onDestroy?: () => void
}): { provider: AgentEnvironmentProvider; destroys: () => number } {
  let destroys = 0
  const environment: AgentEnvironment = {
    id: 'env-1',
    provider: 'fake-provider',
    status: async () => 'running',
    destroy: async () => {
      destroys += 1
      options.onDestroy?.()
      await options.destroy()
    },
    stream: options.stream,
  }
  return {
    provider: {
      name: 'fake-provider',
      capabilities: () =>
        ({}) as unknown as ReturnType<AgentEnvironmentProvider['capabilities']> extends Promise<
          infer T
        >
          ? T
          : never,
      create: async () => environment,
    } as unknown as AgentEnvironmentProvider,
    destroys: () => destroys,
  }
}

function executorFor(p: AgentEnvironmentProvider) {
  const spec: AgentSpec = { profile: { name: 'worker' } as AgentProfile, harness: null }
  const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
  return { executor: providerAsExecutor(p)(spec, ctx), ctx }
}

describe('a teardown failure never replaces a settled outcome', () => {
  it('a destroy that rejects AFTER a completed turn keeps the outcome and records the warning', async () => {
    const { provider: p } = provider({
      stream: completedTurn,
      destroy: async () => {
        throw new Error('409 Conflict: environment env-1 is already deleted')
      },
    })
    const { executor, ctx } = executorFor(p)

    // The stream drains to completion. Before this change the destroy rejection surfaced here and
    // the whole run was a failure.
    const usage = await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)
    expect(usage).toContainEqual({ kind: 'iteration' })

    const artifact = executor.resultArtifact()
    expect(artifact.out).toMatchObject({ content: 'the patch applied' })
    expect(artifact.spent).toMatchObject({ iterations: 1, tokens: { input: 7, output: 11 } })
    expect(artifact.teardown).toMatchObject({ failed: true })
    expect(artifact.teardown?.error).toContain('409 Conflict')
    expect(Date.parse(artifact.teardown?.at ?? '')).toBeGreaterThan(0)
  })

  it('a destroy that rejects BEFORE any terminal event is still the outcome', async () => {
    const { provider: p } = provider({
      // No terminal event: the turn never completed, so there is no result to protect.
      stream: async function* () {
        yield { type: 'message.part.updated', data: { delta: 'half a ' } }
      },
      destroy: async () => {
        throw new Error('409 Conflict: environment env-1 is already deleted')
      },
    })
    const { executor, ctx } = executorFor(p)

    await expect(
      collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>),
    ).rejects.toThrow(/stream ended without a terminal/)
    // Nothing settled, so nothing was recorded — the failure is the outcome, unchanged.
    expect(() => executor.resultArtifact()).toThrow(/resultArtifact\(\) read before stream drained/)
  })

  it('a turn that failed on its own keeps ITS cause; the teardown failure rides along', async () => {
    // A `finally` that throws discards the in-flight exception. Without care, "the stream ended
    // without a terminal event" would be replaced by "409 Conflict" and the real cause would be
    // gone from the report.
    const { provider: p } = provider({
      stream: async function* () {
        yield { type: 'message.part.updated', data: { delta: 'half a ' } }
      },
      destroy: async () => {
        throw new Error('409 Conflict: environment env-1 is already deleted')
      },
    })
    const { executor, ctx } = executorFor(p)
    const failure = await collect(
      executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>,
    ).then(
      () => undefined,
      (error: unknown) => error as Error,
    )
    expect(failure?.message).toMatch(/stream ended without a terminal/)
    expect((failure?.cause as Error | undefined)?.message).toContain('409 Conflict')
  })

  it('a clean run carries no teardown warning at all', async () => {
    const { provider: p, destroys } = provider({
      stream: completedTurn,
      destroy: async () => {},
    })
    const { executor, ctx } = executorFor(p)
    await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)

    expect(executor.resultArtifact().teardown).toBeUndefined()
    expect(destroys()).toBe(1)
  })

  it('teardown does not delete a second time, which is what produced the 409', async () => {
    const { provider: p, destroys } = provider({
      stream: completedTurn,
      destroy: async () => {
        // Only the FIRST delete is allowed to succeed, exactly like the real API.
        if (destroys() > 1) throw new Error('409 Conflict: already deleted')
      },
    })
    const { executor, ctx } = executorFor(p)
    await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)
    expect(destroys()).toBe(1)

    // The stream already released the environment, so teardown is a confirmed no-op rather than a
    // second delete that the provider would refuse.
    await expect(executor.teardown('brutalKill')).resolves.toEqual({ destroyed: true })
    expect(destroys()).toBe(1)
    expect(executor.resultArtifact().teardown).toBeUndefined()
  })

  it('teardown that genuinely fails reports destroyed:false with the reason, and does not throw', async () => {
    const { provider: p } = provider({
      stream: completedTurn,
      destroy: async () => {
        throw new Error('the control plane is unreachable')
      },
    })
    // `destroyOnSettle: false` leaves the release to `teardown`, which is where a remote failure
    // must read as UNCONFIRMED cleanup — the state the barrier journals as `teardown-unconfirmed` —
    // rather than as an exception that fails the work the executor already finished.
    const spec: AgentSpec = { profile: { name: 'worker' } as AgentProfile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = providerAsExecutor(p, { destroyOnSettle: false })(spec, ctx)
    await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)

    const receipt = await executor.teardown('brutalKill')
    expect(receipt.destroyed).toBe(false)
    expect(receipt.detail).toContain('the control plane is unreachable')
    // The completed turn is untouched by the failed cleanup.
    expect(executor.resultArtifact().spent).toMatchObject({ iterations: 1 })
  })
})
