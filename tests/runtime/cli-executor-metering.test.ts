import { describe, expect, it } from 'vitest'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import type { AgentSpec, ExecutorContext, UsageEvent } from '../../src/runtime/supervise/types'

const spec: AgentSpec = {
  profile: {
    name: 'raw-cli-worker',
    harness: 'cli-base',
    model: { provider: 'offline', default: 'offline-test-model' },
  },
  harness: null,
}
const context: ExecutorContext = { signal: new AbortController().signal, seams: {} }

async function drain(stream: AsyncIterable<UsageEvent>): Promise<UsageEvent[]> {
  const events: UsageEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

/**
 * The `cli` backend spawns a subprocess and reads its stdout. It sees no usage receipt, so the
 * only honest report is "this work happened and its cost is unknown" — NOT `{0,0} $0`.
 *
 * The distinction is the whole point. A plain zero is a MEASUREMENT, and every consumer treats it
 * as one: the pool keeps reporting `tokensKnown: true`, so a caller enforcing a token-priced
 * ceiling over this backend holds a ceiling that can never fire while believing it is protected.
 * `Spend.tokensKnown` is the marker that separates the two cases, and the pool already propagates
 * it into its readout.
 */
describe('cli backend reports unmetered work as unknown, never as measured zero', () => {
  it('marks the token channel unknown on the terminal artifact', async () => {
    const executor = createExecutor({ backend: 'cli', bin: 'cat' })(spec, context)
    await drain(
      executor.execute('hello', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    const { spent } = executor.resultArtifact()
    expect(spent.tokens).toEqual({ input: 0, output: 0 })
    expect(spent.usd).toBe(0)
    // The load-bearing assertion: a bare zero here is the trap, not the fix.
    expect(spent.tokensKnown).toBe(false)
    // Wall-clock IS measured by this runtime, so it is not marked unknown.
    expect(spent.ms).toBeGreaterThanOrEqual(0)
    await executor.teardown('brutalKill')
  })

  it('taints a budget pool’s readout so a token ceiling cannot read as enforced', async () => {
    const pool = createBudgetPool({ maxIterations: 4, maxTokens: 1_000 })
    const reservation = pool.reserve({ maxIterations: 1, maxTokens: 100 })
    if (!reservation.ok) throw new Error(`reservation rejected: ${reservation.reason}`)
    const executor = createExecutor({ backend: 'cli', bin: 'cat' })(spec, context)
    await drain(
      executor.execute('hello', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )
    pool.reconcile(reservation.ticket, executor.resultArtifact().spent)

    // The balance is now a CEILING on what might remain, not a measurement of what does.
    expect(pool.readout().tokensKnown).toBe(false)
    await executor.teardown('brutalKill')
  })

  it('marks unknown dollars so a dollar-capped pool refuses an unmetered CLI result', async () => {
    const pool = createBudgetPool({ maxIterations: 4, maxTokens: 1_000, maxUsd: 5 })
    const reservation = pool.reserve({ maxIterations: 1, maxTokens: 100, maxUsd: 1 })
    if (!reservation.ok) throw new Error(`reservation rejected: ${reservation.reason}`)
    const executor = createExecutor({ backend: 'cli', bin: 'cat' })(spec, context)
    await drain(
      executor.execute('hello', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    const { spent } = executor.resultArtifact()
    expect(spent.usdKnown).toBe(false)
    expect(() => pool.reconcile(reservation.ticket, spent)).toThrow(/unknown dollar cost/)
    await executor.teardown('brutalKill')
  })
})
