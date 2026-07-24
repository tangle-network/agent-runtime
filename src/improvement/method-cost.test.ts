import { CostLedger } from '@tangle-network/agent-eval'
import type { OptimizationMethodInput, Scenario } from '@tangle-network/agent-eval/campaign'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { assertMethodCostRecorded, methodInputWithScopedCost } from './method-cost'

const evaluationRef = canonicalCandidateDigest({ fixture: 'shared-cost-ledger' })

function scopedInput(ledger: CostLedger, invocationId: string) {
  return methodInputWithScopedCost(
    { costLedger: ledger } as unknown as OptimizationMethodInput<Scenario, unknown>,
    { evaluationRef, invocationId },
  )
}

async function recordCost(input: ReturnType<typeof scopedInput>, cost: number): Promise<void> {
  const paid = await input.costLedger.runPaidCall({
    channel: 'driver',
    phase: 'optimizer',
    actor: 'optimizer-model',
    model: 'fixture',
    maximumCharge: { externallyEnforcedMaximumUsd: cost },
    execute: async () => 'candidate',
    receipt: () => ({
      model: 'fixture',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: cost,
    }),
  })
  expect(paid.succeeded).toBe(true)
}

describe('optimizer cost reconciliation', () => {
  it('accepts complete spend recorded through the shared account', async () => {
    const ledger = new CostLedger({ costCeilingUsd: 1 })
    const paid = await ledger.runPaidCall({
      channel: 'driver',
      phase: 'optimizer',
      actor: 'optimizer-model',
      model: 'fixture',
      maximumCharge: { externallyEnforcedMaximumUsd: 0.25 },
      execute: async () => 'candidate',
      receipt: () => ({
        model: 'fixture',
        inputTokens: 1,
        outputTokens: 1,
        actualCostUsd: 0.25,
      }),
    })
    expect(paid.succeeded).toBe(true)

    expect(() =>
      assertMethodCostRecorded(
        'fixture',
        { totalCostUsd: 0.25, accountingComplete: true, incompleteReasons: [] },
        ledger,
        1,
      ),
    ).not.toThrow()
  })

  it('rejects complete spend that bypassed the shared account', () => {
    const ledger = new CostLedger({ costCeilingUsd: 1 })

    expect(() =>
      assertMethodCostRecorded(
        'fixture',
        { totalCostUsd: 0.25, accountingComplete: true, incompleteReasons: [] },
        ledger,
        1,
      ),
    ).toThrow(/reported \$0\.25 but recorded \$0 through input\.costLedger/)
  })

  it('rejects unknown spend before final scoring when a total limit is configured', () => {
    const ledger = new CostLedger({ costCeilingUsd: 1 })

    expect(() =>
      assertMethodCostRecorded(
        'fixture',
        {
          totalCostUsd: 0,
          accountingComplete: false,
          incompleteReasons: ['provider receipt unavailable'],
        },
        ledger,
        1,
      ),
    ).toThrow(/incomplete cost accounting under costCeiling; refusing final scoring/)
  })

  it('isolates parallel invocations that share a resumable evaluation identity', async () => {
    const ledger = new CostLedger({ costCeilingUsd: 1 })
    const first = scopedInput(ledger, 'invocation-first')
    const second = scopedInput(ledger, 'invocation-second')

    await Promise.all([recordCost(first, 0.1), recordCost(second, 0.2)])

    expect(first.costLedger.summary()).toMatchObject({
      totalCalls: 1,
      totalCostUsd: 0.1,
    })
    expect(second.costLedger.summary()).toMatchObject({
      totalCalls: 1,
      totalCostUsd: 0.2,
    })
    expect(ledger.summary().totalCalls).toBe(2)
    expect(ledger.summary().totalCostUsd).toBeCloseTo(0.3)
  })
})
