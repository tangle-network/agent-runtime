/** Complete-method prompt improvement, offline and deterministic. */

import { makeFinding } from '@tangle-network/agent-eval'
import { AnalystRegistry } from '@tangle-network/agent-eval/analyst'
import { inMemoryCampaignStorage } from '@tangle-network/agent-eval/campaign'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import {
  type ImproveMethodFactory,
  improve,
  type ReadonlyAgentProfile,
} from '@tangle-network/agent-runtime'
import {
  type ObserveInput,
  observationFromRegistry,
  observe,
} from '@tangle-network/agent-runtime/kernel'

export interface DemoScenario extends Scenario {
  kind: 'demo'
}

export const scenarios: DemoScenario[] = Array.from({ length: 12 }, (_, i) => ({
  id: `s${i}`,
  kind: 'demo' as const,
}))
export const trainScenarios = scenarios.slice(0, 4)
export const selectionScenarios = scenarios.slice(4, 8)
export const testScenarios = scenarios.slice(8)

// The agent returns the surface verbatim with deterministic fixture receipts that exercise accounting.
// This example makes no LLM calls.
export const agent = async (
  candidate: ReadonlyAgentProfile,
  _scenario: DemoScenario,
  ctx: DispatchContext,
): Promise<string> => {
  const paid = await ctx.cost.runPaidCall({
    channel: 'agent',
    actor: 'example',
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

// Deterministic judge: the literal string `PROMOTED` scores 1.0, anything else 0.0 — no LLM.
export const judge: JudgeConfig<string, DemoScenario> = {
  name: 'literal',
  dimensions: [{ key: 'q', description: 'q' }],
  score: ({ artifact }) => {
    const composite = artifact.includes('PROMOTED') ? 1 : 0
    return { dimensions: { q: composite }, composite, notes: '' }
  },
}

// A complete deterministic method for the offline example. Production callers
// pass `officialGepa(...)`, `officialSkillOpt(...)`, or another OptimizationMethod.
export const scriptedWinner: ImproveMethodFactory<DemoScenario, string> = (context) => ({
  name: 'scripted-complete-method',
  async optimize() {
    return {
      winnerSurface: context.findings.length > 0 ? 'PROMOTED' : context.baselineSurface,
      cost: {
        totalCostUsd: 0,
        costProvenance: { kind: 'observed', usd: 0 },
        accountingComplete: true,
        incompleteReasons: [],
      },
    }
  },
})

const registry = new AnalystRegistry()
registry.register({
  id: 'required-check',
  version: '1',
  description: 'Find a missing verification event',
  inputKind: 'custom',
  cost: { kind: 'deterministic' },
  async analyze(input: ObserveInput) {
    if (input.trace.some((event) => event === 'verification-passed')) return []
    return [
      makeFinding({
        analyst_id: 'required-check',
        severity: 'medium',
        area: 'verification',
        claim: 'The attempt has no verification event.',
        confidence: 1,
        evidence_refs: [...(input.evidenceRefs ?? [])],
      }),
    ]
  },
})

export const profile: AgentProfile = { name: 'demo', prompt: { systemPrompt: 'BASELINE' } }
export const executionRef = canonicalCandidateDigest({
  callback: 'examples/improve/agent',
  model: 'deterministic-example',
})

async function main(): Promise<void> {
  const { findings } = await observe(
    {
      task: 'Return the required answer and verify it.',
      output: 'BASELINE',
      trace: [],
      runId: 'demo://attempt',
      evidenceRefs: [{ kind: 'artifact', uri: 'demo://attempt/trace' }],
    },
    {
      analysis: observationFromRegistry(registry, {
        inputs: (input) => ({ custom: { 'required-check': input } }),
        proposalOrigin: 'search',
      }),
    },
  )
  const out = await improve(profile, {
    surface: 'prompt',
    executionRef,
    method: scriptedWinner,
    findings,
    trainScenarios,
    selectionScenarios,
    testScenarios,
    judges: [judge],
    agent,
    runDir: 'mem://improve-example',
    storage: inMemoryCampaignStorage(),
    resamples: 40,
    confidence: 0.95,
  })
  console.log(
    'improve() proposed a detached prompt candidate and measured it on final-test scenarios (offline complete method, deterministic judge):',
  )
  console.log(`decision: ${out.decision}  lift: ${out.lift.toFixed(3)}`)
  console.log(`candidate prompt: ${out.candidate.profile.prompt?.systemPrompt}`)
  console.log(`live prompt unchanged: ${profile.prompt?.systemPrompt}`)
}

// Only run the demo when this file is executed directly — intelligence-recommend.ts imports the
// scaffolding above (scenarios / agent / judge / scriptedWinner / profile) and must not trigger
// this loop on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
