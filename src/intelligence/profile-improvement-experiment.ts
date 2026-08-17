import { CostLedger, type CostLedgerHandle } from '@tangle-network/agent-eval'
import {
  type CampaignScenarioIdentity,
  campaignSplitDigestFromIdentities,
} from '@tangle-network/agent-eval/campaign'
import {
  sealAgentProfileImprovementSuite,
  sealAgentProfileImprovementTask,
} from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateEvaluationPolicy,
  AgentImprovementCost,
  AgentImprovementSource,
  AgentProfile,
  AgentProfileImprovementMeasuredComparison,
  AgentProfileImprovementSuiteInputs,
  AgentProfileImprovementTask,
  AgentProfileImprovementTaskMaterial,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  AGENT_IMPROVEMENT_SOURCE_METADATA_KEY,
  agentImprovementSourceMetadata,
  agentProfileImprovementArmSchema,
  numbersApproximatelyEqual,
} from '@tangle-network/agent-interface'
import { immutableCandidateValue } from '../candidate-execution/digest'
import {
  assertNoCallerOptimizationReceipt,
  attachOptimizationActivationReceipt,
  type createOptimizationActivationReceipt,
} from './optimization-receipt'
import type { AgentImprovementProfileStateDigest } from './profile-activation'

export interface ProfileImprovementBenchmarkInput {
  tasks: [AgentProfileImprovementTaskMaterial, ...AgentProfileImprovementTaskMaterial[]]
  reps: number
  seeds: [number, ...number[]]
  policy: AgentCandidateEvaluationPolicy
}

export function createProfileImprovementCostLedger(
  budgetUsd: number,
  context = 'profile improvement',
): CostLedger {
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    throw new Error(`${context} budgetUsd must be a non-negative finite number`)
  }
  return new CostLedger({ costCeilingUsd: budgetUsd })
}

export function profilePolicyWithBudget(
  policy: AgentCandidateEvaluationPolicy,
  budgetUsd: number,
  context = 'profile improvement',
): AgentCandidateEvaluationPolicy {
  if (policy.budgetUsd !== undefined && !numbersApproximatelyEqual(policy.budgetUsd, budgetUsd)) {
    throw new Error(`${context} policy budgetUsd must equal the run budgetUsd`)
  }
  return { ...policy, budgetUsd }
}

export function profilePreparationAccounting(
  costLedger: CostLedgerHandle,
  startedAt: number,
): { wallDurationMs: number; cost: AgentImprovementCost } {
  const summary = costLedger.summary()
  if (!summary.accountingComplete || summary.costProvenance.kind === 'uncaptured') {
    throw new Error('profile improvement preparation cost is incomplete')
  }
  return {
    wallDurationMs: Math.max(0, performance.now() - startedAt),
    cost: {
      usd: summary.costProvenance.usd,
      provenance: summary.costProvenance.kind,
    },
  }
}

export function profileStateDigest(
  stateDigest: AgentImprovementProfileStateDigest,
  identity: string,
  profile: AgentProfile,
): Sha256Digest {
  return agentProfileImprovementArmSchema.parse({
    stateDigest: stateDigest({ identity, profile }),
  }).stateDigest
}

export function sealProfileImprovementBenchmark(
  input: ProfileImprovementBenchmarkInput,
): AgentProfileImprovementSuiteInputs {
  const tasks = input.tasks.map((task) => sealAgentProfileImprovementTask(task)) as [
    AgentProfileImprovementTask,
    ...AgentProfileImprovementTask[],
  ]
  return sealAgentProfileImprovementSuite({
    splitDigest: campaignSplitDigestFromIdentities(
      tasks.map(profileTaskScenarioIdentity),
      input.reps,
    ),
    tasks,
    reps: input.reps,
    seeds: input.seeds,
  })
}

export function profileTaskScenarioIdentity(
  task: AgentProfileImprovementTask,
): CampaignScenarioIdentity {
  return {
    id: task.scenario.id,
    kind: task.scenario.kind,
    scenarioDigest: task.scenario.digest,
  }
}

export function profileImprovementMetadata(
  metadata: AgentProfileImprovementMeasuredComparison['metadata'],
  source: AgentImprovementSource,
  optimizationReceipt?: ReturnType<typeof createOptimizationActivationReceipt>,
): NonNullable<AgentProfileImprovementMeasuredComparison['metadata']> {
  assertNoCallerOptimizationReceipt(metadata)
  if (metadata && Object.hasOwn(metadata, AGENT_IMPROVEMENT_SOURCE_METADATA_KEY)) {
    throw new Error(
      `candidate metadata reserves '${AGENT_IMPROVEMENT_SOURCE_METADATA_KEY}' for Runtime`,
    )
  }
  const merged = { ...(metadata ?? {}), ...agentImprovementSourceMetadata(source) }
  return optimizationReceipt
    ? attachOptimizationActivationReceipt(merged, optimizationReceipt)
    : immutableCandidateValue(merged)
}
