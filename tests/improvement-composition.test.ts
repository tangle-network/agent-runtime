import { sequentialOptimizationMethod } from '@tangle-network/agent-eval/campaign'
import { describe, expect, it } from 'vitest'
import { improve } from '../src/improvement'
import { improvementOptions } from './helpers/improvement-method-fixture'

describe('composed profile improvement', () => {
  it('retains stage evidence and charges both stages through the shared Runtime account', async () => {
    const baselines: unknown[] = []
    const options = improvementOptions()
    const result = await improve(
      { name: 'composed', prompt: { systemPrompt: 'BASELINE' } },
      {
        ...options,
        method: sequentialOptimizationMethod({
          name: 'explore-then-finish',
          methods: ['INTERMEDIATE', 'PROMOTED'].map((winnerSurface, index) => ({
            name: `stage-${index}`,
            async optimize(input) {
              baselines.push(input.baselineSurface)
              const paid = await input.costLedger.runPaidCall({
                phase: 'optimization',
                channel: 'optimizer',
                actor: `stage-${index}`,
                model: 'deterministic-fixture',
                execute: async () => winnerSurface,
                receipt: () => ({
                  model: 'deterministic-fixture',
                  inputTokens: 11,
                  outputTokens: 17,
                  actualCostUsd: 0.01,
                }),
              })
              if (!paid.succeeded) throw paid.error
              return {
                winnerSurface: paid.value,
                cost: {
                  totalCostUsd: 0.01,
                  costProvenance: { kind: 'observed', usd: 0.01 },
                  accountingComplete: true,
                  incompleteReasons: [],
                },
              }
            },
          })),
        }),
      },
    )
    expect(baselines).toEqual(['BASELINE', 'INTERMEDIATE'])
    expect(result.candidate.profile.prompt?.systemPrompt).toBe('PROMOTED')
    expect(result.decision).toBe('ship')
    expect(result.raw.best.composition?.stages.map((stage) => stage.result.winnerSurface)).toEqual([
      'INTERMEDIATE',
      'PROMOTED',
    ])
    expect(result.raw.optimizationCost.totalCostUsd).toBeCloseTo(0.02)
    expect(result.cost.accountingComplete).toBe(true)
    expect(result.raw.searchHistory.allComplete).toBe(false)
    expect(result.candidatePopulation.status).toBe('unavailable')
  })
})
