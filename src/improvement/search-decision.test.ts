import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CostLedger } from '@tangle-network/agent-eval'
import {
  incumbent,
  type SearchClaim,
  type SurfaceProposer,
  uniform,
} from '@tangle-network/agent-eval/campaign'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { type EvaluationClaim, verifySealedExperiment } from '@tangle-network/agent-eval/experiment'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { improve } from './improve'
import type { ImproveSearchResult } from './improve-types'
import type { ReadonlyAgentProfile } from './profile-types'
import { decideSearchImprovement, improveSearchCost, runtimeShipDecision } from './search-decision'
import { routerLane, SearchEnvironmentFault } from './search-executor'
import { searchMethod } from './search-method'

interface RuleScenario extends Scenario {
  kind: 'rule-task'
}

const tasks = (prefix: string, count: number): RuleScenario[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, kind: 'rule-task' as const }))

const RULE = 'Cite the source of every figure.'
const CALL_USD = 0.0001

function jitter(key: string): number {
  const hex = canonicalCandidateDigest(key).slice('sha256:'.length, 'sha256:'.length + 8)
  return (Number.parseInt(hex, 16) / 0x1_0000_0000) * 2 - 1
}

const judge: JudgeConfig<string, RuleScenario> = {
  name: 'rule',
  dimensions: [{ key: 'quality', description: 'the rule raises every task' }],
  score: ({ artifact, scenario }) => {
    const base = 0.4 + 0.1 * jitter(`base:${scenario.id}`)
    const composite = artifact.includes(RULE) ? base + 0.3 + 0.05 * jitter(scenario.id) : base
    return { dimensions: { quality: composite }, composite, notes: '' }
  },
}

const proposer: SurfaceProposer = {
  kind: 'test-rule-proposer',
  async propose(ctx) {
    const parent = String(ctx.currentSurface)
    return parent.includes(RULE)
      ? [parent]
      : [{ surface: `${parent}\n${RULE}`, label: 'add the rule', rationale: 'it raises the score' }]
  },
}

const claim: EvaluationClaim = {
  use: 'comparison',
  population: { id: 'rule-tasks', description: 'generated rule tasks' },
  samplingFrame: 'every generated rule task',
  independentUnit: 'id',
  generalization: 'new-units',
  minimumEffect: 0.1,
}

const profile: AgentProfile = {
  name: 'search-decision-test',
  prompt: { systemPrompt: 'Answer the question from the documents.' },
}

/** A search whose agent's first call on each named task fails in transit with no
 * receipt, as `fetch failed` did; the kernel retries the cell and it passes. */
async function runSearch(runDir: string, failOnce: readonly string[], costCeiling: number) {
  const failed = new Set<string>()
  const agent = async (
    candidate: ReadonlyAgentProfile,
    scenario: RuleScenario,
    ctx: DispatchContext,
  ): Promise<string> => {
    const drop = failOnce.includes(scenario.id) && !failed.has(scenario.id)
    if (drop) failed.add(scenario.id)
    const paid = await ctx.cost.runPaidCall({
      channel: 'agent',
      actor: 'search-decision-test',
      model: 'deterministic-test',
      maximumCharge: { externallyEnforcedMaximumUsd: CALL_USD },
      execute: async () => {
        if (drop) throw new Error('fetch failed')
        return candidate.prompt?.systemPrompt ?? ''
      },
      receipt: () => ({
        model: 'deterministic-test',
        inputTokens: 1,
        outputTokens: 1,
        actualCostUsd: CALL_USD,
      }),
    })
    if (!paid.succeeded)
      throw new SearchEnvironmentFault(`router unreachable: ${paid.error.message}`)
    return paid.value
  }
  return improve(profile, {
    surface: 'prompt',
    executionRef: canonicalCandidateDigest({ test: 'search-decision' }),
    method: searchMethod({
      proposer,
      maxExpansions: 1,
      // The hill climb runs the child on every train and selection task, so it can be a finalist.
      policy: incumbent(),
      allocation: uniform(),
      lanes: [routerLane({ capacity: 8, cellUsd: CALL_USD })],
    }),
    claim,
    trainScenarios: tasks('train', 1),
    selectionScenarios: tasks('selection', 6),
    // A continuous paired test needs 20 units to resolve.
    testScenarios: tasks('test', 20),
    judges: [judge],
    agent,
    costCeiling,
    runDir,
  }) as Promise<ImproveSearchResult>
}

const searchDirOf = (runDir: string) => {
  const [dir] = readdirSync(join(runDir, 'search'))
  return join(runDir, 'search', dir!)
}

describe('a search whose calls failed with no receipt', () => {
  it('ships with the unknown cost counted at its declared maximum, and cites its claim as a promotion', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'search-decision-'))
    const result = await runSearch(runDir, ['selection-1', 'test-3', 'test-7'], 1)

    expect(result.claim.decision, result.claim.reason).toBe('ship')
    expect(result.cost.accountingComplete).toBe(false)
    expect(result.cost.costBound).toEqual({
      unknownCalls: 3,
      unknownMaximumUsd: 3 * CALL_USD,
      totalMaximumUsd: result.cost.totalCostUsd + 3 * CALL_USD,
    })
    expect(result.decision).toBe('ship')
    expect(result.reason).toContain('3 call(s) ended with no receipt')

    // The promotion is what SuperviseRegistry.profiles accepts beside the shipped profile.
    const promotion = result.promotion!
    const digest = canonicalAgentProfileDigest(result.candidate.profile as AgentProfile)
    expect(await verifySealedExperiment(promotion.experiment)).toBe(true)
    expect(promotion.decision.promote).toBe(true)
    expect(
      promotion.experiment.spec.arms.some(
        (arm) => arm.role === 'treatment' && arm.profileDigest === digest,
      ),
    ).toBe(true)
    expect(promotion.experiment.spec.arms[0]).toMatchObject({
      role: 'control',
      profileDigest: canonicalAgentProfileDigest(profile),
    })
    const shipped = result.claim.finalists.find((entry) => entry.nodeId === result.claim.selected)!
    expect([promotion.decision.low, promotion.decision.high]).toEqual(shipped.test!.interval)

    // The closed directory alone gives the same decision and promotion, and spends nothing.
    const costLedger = join(searchDirOf(runDir), 'cost-ledger.jsonl')
    const before = readFileSync(costLedger, 'utf8')
    const again = await decideSearchImprovement({ searchDir: searchDirOf(runDir) })
    expect(again.decision).toBe('ship')
    expect(again.reason).toBe(result.reason)
    expect(again.promotion).toEqual(promotion)
    expect(canonicalAgentProfileDigest(again.candidate)).toBe(digest)
    expect(canonicalAgentProfileDigest(again.baseline)).toBe(canonicalAgentProfileDigest(profile))
    expect(readFileSync(costLedger, 'utf8')).toBe(before)

    // improve() again with the same inputs returns the closed search, decided the same way.
    const rerun = await runSearch(runDir, [], 1)
    expect(rerun.decision).toBe('ship')
    expect(rerun.promotion).toEqual(promotion)
    expect(readFileSync(costLedger, 'utf8')).toBe(before)
  }, 240_000)
})

describe('runtimeShipDecision', () => {
  const shipped = {
    decision: 'ship',
    reason: 'finalist n1 beat the root',
  } as unknown as SearchClaim
  const decide = (cost: Parameters<typeof runtimeShipDecision>[0]['cost'], costCeiling?: number) =>
    runtimeShipDecision({
      claim: shipped,
      verified: true,
      cost,
      costCeiling,
      lowerBound: 0.1,
      minimumLift: 0,
    })
  const bound = { unknownCalls: 3, unknownMaximumUsd: 0.026, totalMaximumUsd: 1.63 }

  it('ships a bounded accounting within the ceiling and discloses the bound', () => {
    const ruled = decide({ accountingComplete: false, costBound: bound }, 18)
    expect(ruled.decision).toBe('ship')
    expect(ruled.reason).toBe(
      'finalist n1 beat the root; 3 call(s) ended with no receipt and count at their declared maximum, $0.0260, so the search cost at most $1.63 of its $18.00 ceiling',
    )
  })

  it('holds a bounded accounting above the ceiling', () => {
    expect(decide({ accountingComplete: false, costBound: bound }, 1.5).decision).toBe('hold')
  })

  it('holds an accounting with an unbounded gap', () => {
    expect(decide({ accountingComplete: false }, 18)).toEqual({
      decision: 'hold',
      reason: 'the claim shipped, but the search cost accounting is incomplete',
    })
  })

  it('ships complete accounting with the claim reason alone', () => {
    expect(decide({ accountingComplete: true }, 18)).toEqual({
      decision: 'ship',
      reason: 'finalist n1 beat the root',
    })
  })
})

describe('improveSearchCost', () => {
  const failedCall = async (ledger: CostLedger, maximum: number | undefined) => {
    await ledger.runPaidCall({
      channel: 'agent',
      phase: 'search.screen',
      actor: 'test',
      model: 'deterministic-test',
      ...(maximum === undefined
        ? {}
        : { maximumCharge: { externallyEnforcedMaximumUsd: maximum } }),
      execute: async () => {
        throw new Error('fetch failed')
      },
      receipt: () => ({ model: 'deterministic-test', inputTokens: 0, outputTokens: 0 }),
    })
  }
  const pricedCall = (ledger: CostLedger) =>
    ledger.runPaidCall({
      channel: 'agent',
      phase: 'search.screen',
      actor: 'test',
      model: 'deterministic-test',
      maximumCharge: { externallyEnforcedMaximumUsd: 1 },
      execute: async () => 'ok',
      receipt: () => ({
        model: 'deterministic-test',
        inputTokens: 1,
        outputTokens: 1,
        actualCostUsd: 0.5,
      }),
    })

  it('bounds calls that failed with no receipt by their declared maximum', async () => {
    const ledger = new CostLedger()
    await pricedCall(ledger)
    await failedCall(ledger, 0.01)
    await failedCall(ledger, 0.02)
    const cost = improveSearchCost(ledger)
    expect(cost.accountingComplete).toBe(false)
    expect(cost.totalCostUsd).toBe(0.5)
    expect(cost.costBound?.unknownCalls).toBe(2)
    expect(cost.costBound?.unknownMaximumUsd).toBeCloseTo(0.03, 12)
    expect(cost.costBound?.totalMaximumUsd).toBeCloseTo(0.53, 12)
  })

  it('gives no bound when a call of unknown cost declared no maximum', async () => {
    const ledger = new CostLedger()
    await failedCall(ledger, 0.01)
    await failedCall(ledger, undefined)
    expect(improveSearchCost(ledger).costBound).toBeUndefined()
  })

  it('gives no bound for complete accounting', async () => {
    const ledger = new CostLedger()
    await pricedCall(ledger)
    expect(improveSearchCost(ledger)).toEqual({
      totalCostUsd: 0.5,
      accountingComplete: true,
      incompleteReasons: [],
    })
  })
})
