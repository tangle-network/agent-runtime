import { describe, expect, it } from 'vitest'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import type { AgentSpec, ExecutorContext, UsageEvent } from '../../src/runtime/supervise/types'

const spec: AgentSpec = { profile: { name: 'raw-cli-worker' }, harness: null }
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

  it('does NOT mark the dollar channel, which would refuse the exemption it was granted', async () => {
    // A deliberate boundary, pinned so it reads as a decision rather than a missed field.
    // `usdKnown: false` is not a marker on this channel but a REFUSAL: under a dollar-capped root
    // `budget.ts` treats it as a reconcile violation and fails the child. `backend: 'cli'` is
    // `budgetExempt`, i.e. the kernel already agreed to settle it OUT of the conserved pool, so
    // marking it would make an explicitly-exempt worker fail after its work had already burned.
    // Changing that is a policy decision about allowed configurations, not a reporting fix.
    const pool = createBudgetPool({ maxIterations: 4, maxTokens: 1_000, maxUsd: 5 })
    const reservation = pool.reserve({ maxIterations: 1, maxTokens: 100, maxUsd: 1 })
    if (!reservation.ok) throw new Error(`reservation rejected: ${reservation.reason}`)
    const executor = createExecutor({ backend: 'cli', bin: 'cat' })(spec, context)
    await drain(
      executor.execute('hello', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    const { spent } = executor.resultArtifact()
    expect(spent.usdKnown).toBeUndefined()
    expect(() => pool.reconcile(reservation.ticket, spent)).not.toThrow()
    // The token taint still reaches the readout, so the accounting is not silently trusted.
    expect(pool.readout().tokensKnown).toBe(false)
    await executor.teardown('brutalKill')
  })
})
