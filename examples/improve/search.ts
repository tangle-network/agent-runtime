/**
 * Runtime's native search, offline and deterministic: `improve()` with
 * `searchMethod(...)` grows a tree of prompt candidates on Eval's search
 * kernel, ranks them on a private selection split, and claims once on a sealed
 * test split. The ledger it writes is the only checkpoint: run the file again
 * with the same directory and the search continues where it stopped.
 *
 *   pnpm tsx examples/improve/search.ts [runDir]
 *
 * The agent and judge make no model calls. Each prompt line is a rule with a
 * fixed effect on the score, plus deterministic per-task variation, so the
 * example shows the mechanics (paired units, successive halving, the claim),
 * not a real improvement.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SurfaceProposer } from '@tangle-network/agent-eval/campaign'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import type { EvaluationClaim } from '@tangle-network/agent-eval/experiment'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import {
  type ImproveSearchResult,
  improve,
  type ReadonlyAgentProfile,
  routerLane,
  searchMethod,
} from '@tangle-network/agent-runtime'

export interface RuleScenario extends Scenario {
  kind: 'rule-task'
}

const tasks = (prefix: string, count: number): RuleScenario[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, kind: 'rule-task' as const }))

export const trainScenarios = tasks('train', 4)
export const selectionScenarios = tasks('selection', 12)
export const testScenarios = tasks('test', 24)

/** Each rule's true effect on every task's score. */
export const ruleEffects: Readonly<Record<string, number>> = {
  'Cite the source of every figure.': 0.12,
  'State the assumption before the answer.': 0.02,
  'Answer in one paragraph.': -0.05,
  'Check the arithmetic twice.': 0.08,
  'Prefer the most recent document.': 0,
  'Quote the question back.': -0.03,
}

/** A number in [-1, 1) fixed by its key. */
function jitter(key: string): number {
  const hex = canonicalCandidateDigest(key).slice('sha256:'.length, 'sha256:'.length + 8)
  return (Number.parseInt(hex, 16) / 0x1_0000_0000) * 2 - 1
}

/** The agent returns its prompt; one metered call per cell keeps the cost known. */
export const agent = async (
  candidate: ReadonlyAgentProfile,
  _scenario: RuleScenario,
  ctx: DispatchContext,
): Promise<string> => {
  const paid = await ctx.cost.runPaidCall({
    channel: 'agent',
    actor: 'search-example',
    model: 'deterministic-example',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => candidate.prompt?.systemPrompt ?? '',
    receipt: () => ({
      model: 'deterministic-example',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

/** Score: a per-task base, plus each present rule's effect and a small
 * task-by-rule interaction. */
export const judge: JudgeConfig<string, RuleScenario> = {
  name: 'rule-effects',
  dimensions: [{ key: 'quality', description: 'rule effects on this task' }],
  score: ({ artifact, scenario }) => {
    let score = 0.5 + 0.2 * jitter(`base:${scenario.id}`)
    for (const [rule, effect] of Object.entries(ruleEffects)) {
      if (artifact.includes(rule)) score += effect + 0.04 * jitter(`${rule}:${scenario.id}`)
    }
    const composite = Math.min(1, Math.max(0, score))
    return { dimensions: { quality: composite }, composite, notes: '' }
  },
}

/**
 * Add one rule the parent lacks. The proposer reads only the train split:
 * `ctx.train` before its first await, and the train summary.
 */
export const ruleProposer: SurfaceProposer = {
  kind: 'example-rule-proposer',
  async propose(ctx) {
    const parent = String(ctx.currentSurface)
    const parentId = ctx.parents?.[0]?.nodeId
    const trainUnits = parentId ? (ctx.train?.unitScores(parentId).length ?? 0) : 0
    const rules = Object.keys(ruleEffects)
    const offset = ctx.generation % rules.length
    const next = [...rules.slice(offset), ...rules.slice(0, offset)].find(
      (rule) => !parent.includes(rule),
    )
    if (!next) return [parent]
    return [
      {
        surface: `${parent}\n${next}`,
        label: `add: ${next.slice(0, 32)}`,
        rationale: `The parent lacks this rule; its train view holds ${trainUnits} scored units.`,
      },
    ]
  },
}

export const profile: AgentProfile = {
  name: 'search-example',
  prompt: { systemPrompt: 'Answer the question from the documents.' },
}

export const executionRef = canonicalCandidateDigest({
  callback: 'examples/improve/search/agent',
  model: 'deterministic-example',
})

export const claim: EvaluationClaim = {
  use: 'comparison',
  population: { id: 'rule-tasks', description: 'the example rule tasks' },
  samplingFrame: 'every generated rule task',
  independentUnit: 'id',
  generalization: 'new-units',
  minimumEffect: 0.1,
}

export async function runSearchExample(runDir: string): Promise<ImproveSearchResult> {
  return improve(profile, {
    surface: 'prompt',
    executionRef,
    method: searchMethod({
      proposer: ruleProposer,
      maxExpansions: 8,
      // Each cell makes one priced call with an enforced $0.0001 maximum, so the
      // lane can hold each cell to it.
      lanes: [routerLane({ capacity: 4, cellUsd: 0.0001 })],
    }),
    claim,
    trainScenarios,
    selectionScenarios,
    testScenarios,
    judges: [judge],
    agent,
    costCeiling: 1,
    runDir,
  })
}

async function main(): Promise<void> {
  const runDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'improve-search-'))
  const result = await runSearchExample(runDir)
  const { summary } = result.searchHistory
  console.log(`ledger: ${result.searchHistory.ledger.uri}`)
  console.log(
    `nodes ${summary.nodes}, edges ${summary.edges}, cells ${summary.cells}, claim ${result.claim.decision}`,
  )
  console.log(`decision: ${result.decision} (${result.reason})`)
  if (result.liftInterval) {
    console.log(
      `test lift ${result.lift?.toFixed(3)} [${result.liftInterval.low.toFixed(3)}, ${result.liftInterval.high.toFixed(3)}]`,
    )
  }
  console.log(`kept prompt:\n${result.candidate.profile.prompt?.systemPrompt}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
