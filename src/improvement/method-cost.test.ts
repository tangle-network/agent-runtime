import { CostLedger } from '@tangle-network/agent-eval'
import type { OptimizationMethodInput, Scenario } from '@tangle-network/agent-eval/campaign'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  assertMethodCostRecorded,
  type MethodCostAttribution,
  methodInputWithScopedCost,
  methodInvocationCostLedger,
} from './method-cost'

const evaluationRef = canonicalCandidateDigest({ fixture: 'shared-cost-ledger' })

function scopedInput(
  ledger: CostLedger,
  invocationId: string,
  costAttribution: MethodCostAttribution = 'invocation',
) {
  return methodInputWithScopedCost(
    { costLedger: ledger } as unknown as OptimizationMethodInput<Scenario, unknown>,
    { evaluationRef, invocationId },
    costAttribution,
  )
}

async function recordCost(
  input: ReturnType<typeof scopedInput>,
  cost: number,
  optimizerRun?: string,
): Promise<void> {
  const paid = await input.costLedger.runPaidCall({
    channel: 'driver',
    phase: 'optimizer',
    actor: 'optimizer-model',
    model: 'fixture',
    ...(optimizerRun ? { tags: { optimizerRun } } : {}),
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
        {
          cost: {
            totalCostUsd: 0.25,
            costProvenance: { kind: 'observed', usd: 0.25 },
            accountingComplete: true,
            incompleteReasons: [],
          },
        },
        ledger,
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
        {
          cost: {
            totalCostUsd: 0.25,
            costProvenance: { kind: 'observed', usd: 0.25 },
            accountingComplete: true,
            incompleteReasons: [],
          },
        },
        ledger,
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
          cost: {
            totalCostUsd: 0,
            costProvenance: { kind: 'uncaptured', usd: null },
            accountingComplete: false,
            incompleteReasons: ['provider receipt unavailable'],
          },
        },
        ledger,
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

  it('does not treat arbitrary method provenance as an official optimizer run', async () => {
    const ledger = new CostLedger({ costCeilingUsd: 1 })
    const scope = { evaluationRef, invocationId: 'third-party-invocation' }
    const input = methodInputWithScopedCost(
      { costLedger: ledger } as unknown as OptimizationMethodInput<Scenario, unknown>,
      scope,
    )
    await recordCost(input, 0.1)

    expect(() =>
      assertMethodCostRecorded(
        'third-party',
        {
          cost: {
            totalCostUsd: 0.1,
            costProvenance: { kind: 'observed', usd: 0.1 },
            accountingComplete: true,
            incompleteReasons: [],
          },
          provenance: {
            source: {
              kind: 'package',
              evidence: 'observed',
              package: 'third-party-optimizer',
              version: '1.0.0',
            },
            runId: 'third-party-run-without-optimizer-tag',
            resumed: false,
            evaluationCount: 1,
            artifactDir: '/tmp/third-party',
          },
        },
        input.costLedger,
        methodInvocationCostLedger(ledger, scope),
        1,
      ),
    ).not.toThrow()
  })

  it('retains compatible-run spend across resumed invocations', async () => {
    const ledger = new CostLedger({ costCeilingUsd: 1 })
    const runId = 'compatible-upstream-run'
    const first = scopedInput(ledger, 'invocation-first', 'optimizer-run')
    await recordCost(first, 0.1, runId)

    const secondScope = { evaluationRef, invocationId: 'invocation-resumed' }
    const resumed = methodInputWithScopedCost(
      { costLedger: ledger } as unknown as OptimizationMethodInput<Scenario, unknown>,
      secondScope,
      'optimizer-run',
    )
    const resumedInvocation = methodInvocationCostLedger(ledger, secondScope)

    expect(resumed.costLedger.summary()).toMatchObject({ totalCalls: 0, totalCostUsd: 0 })
    expect(
      resumed.costLedger.summary({
        phase: 'optimizer',
        tags: { optimizerRun: runId },
      }),
    ).toMatchObject({ totalCalls: 1, totalCostUsd: 0.1 })

    await recordCost(resumed, 0.2, runId)
    expect(resumed.costLedger.summary({ phase: 'optimizer' })).toMatchObject({
      totalCalls: 1,
      totalCostUsd: 0.2,
    })
    const compatibleSummary = resumed.costLedger.summary({
      phase: 'optimizer',
      tags: { optimizerRun: runId },
    })
    expect(compatibleSummary.totalCalls).toBe(2)
    expect(compatibleSummary.totalCostUsd).toBeCloseTo(0.3)
    expect(() =>
      assertMethodCostRecorded(
        'fixture',
        {
          cost: {
            totalCostUsd: 0.3,
            costProvenance: { kind: 'observed', usd: 0.3 },
            accountingComplete: true,
            incompleteReasons: [],
          },
          provenance: {
            source: {
              kind: 'package',
              evidence: 'observed',
              package: 'fixture',
              version: '1.0.0',
            },
            runId,
            resumed: true,
            evaluationCount: 1,
            artifactDir: '/tmp/fixture',
          },
        },
        resumed.costLedger,
        resumedInvocation,
        1,
        'optimizer-run',
      ),
    ).not.toThrow()
    expect(resumedInvocation.summary()).toMatchObject({ totalCalls: 1, totalCostUsd: 0.2 })
  })
})
