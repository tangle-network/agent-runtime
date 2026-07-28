import { CostLedger, type CostLedgerHandle } from '@tangle-network/agent-eval'
import { assertProposalFindings, type ProposalFinding } from '@tangle-network/agent-eval/analyst'
import {
  type CampaignScenarioIdentity,
  campaignSplitDigestFromIdentities,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfileImprovementExperimentExecutionInput,
  type CandidateExperimentExecutionInput,
  type CompareCandidateExperimentOptions,
  measuredComparisonFromAgentProfileImprovementExperiment,
  measuredComparisonFromCandidateExperiment,
  runAgentProfileImprovementExperiment,
  runCandidateExperiment,
  type Scenario,
  sealAgentProfileImprovementExperiment,
  sealAgentProfileImprovementSuite,
  sealAgentProfileImprovementTask,
  sealCandidateExperiment,
  verifyAgentProfileImprovementExperimentComparison,
  verifyCandidateExperiment,
  verifyCandidateExperimentComparison,
} from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateBenchmarkCellRef,
  AgentCandidateBundle,
  AgentCandidateEvaluationPolicy,
  AgentCandidateExperiment,
  AgentCandidateExperimentMaterial,
  AgentCandidateExperimentMeasurement,
  AgentCandidateLineage,
  AgentCandidateRunCell,
  AgentImprovementActivation,
  AgentImprovementActivationIntent,
  AgentImprovementCost,
  AgentImprovementEvaluation,
  AgentImprovementMeasuredComparison,
  AgentImprovementProposal,
  AgentImprovementReview,
  AgentImprovementReviewDecision,
  AgentImprovementSource,
  AgentProfile,
  AgentProfileImprovementExecutionRef,
  AgentProfileImprovementExperiment,
  AgentProfileImprovementMeasuredComparison,
  AgentProfileImprovementMeasurement,
  AgentProfileImprovementRunReceipt,
  AgentProfileImprovementSuiteInputs,
  AgentProfileImprovementTask,
  AgentProfileImprovementTaskMaterial,
  CandidateExecutionEvidence,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  AGENT_IMPROVEMENT_SOURCE_METADATA_KEY,
  agentCandidateMaterializationReceiptSchema,
  agentCandidateRunReceiptSchema,
  agentImprovementActivationSchema,
  agentImprovementProposalSchema,
  agentImprovementReviewSchema,
  agentImprovementSourceMetadata,
  agentImprovementSourceSchema,
  agentProfileImprovementArmSchema,
  agentProfileImprovementExecutionRefSchema,
  agentProfileImprovementMeasuredComparisonSchema,
  candidateExecutionEvidenceSchema,
  numbersApproximatelyEqual,
} from '@tangle-network/agent-interface'
import { materializeCandidateProfile } from '@tangle-network/agent-profile-materialize'

import { runAnalystLoop } from '../analyst-loop'
import type { RunAnalystLoopOpts, RunAnalystLoopResult } from '../analyst-loop/types'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  immutableCandidateValue,
  omitTopLevelDigest,
  verifyCanonicalCandidateDocument,
} from '../candidate-execution/digest'
import {
  type ExecutePreparedAgentCandidateOptions,
  executePreparedAgentCandidate,
} from '../candidate-execution/execute'
import {
  type PrepareAgentCandidateExecutionOptions,
  prepareAgentCandidateExecution,
} from '../candidate-execution/prepare'
import {
  assertCandidateProfileBinding,
  candidateMaterializerHarness,
  createAgentCandidateProfileActivation,
  parseAgentCandidateProfileActivation,
  parseExactAgentProfile,
} from '../candidate-execution/profile'
import type {
  AgentCandidateExecutionPorts,
  AgentCandidateRunFinalization,
  AgentCandidateTaskExecution,
} from '../candidate-execution/types'
import {
  verifiedResourceTextByDigest,
  verifyAgentCandidateBundle,
} from '../candidate-execution/verify'
import { rethrowAfterCleanup } from '../improvement/cleanup'
import {
  type ImproveMethodOptions,
  type ImproveMethodResult,
  type ImproveOptions,
  type ImproveResult,
  improve,
} from '../improvement/improve'
import {
  type AgentImprovementActivationTargetIdentity,
  type AgentProfileMeasuredSurface,
  agentImprovementProfileDiffs,
  assertAgentImprovementActivationTargets,
  buildAgentImprovementActivationTargets,
  deriveChangedSurfaces,
  isAgentProfileMeasuredSurface,
  profileImprovementChangedSurfaces,
  sameAgentImprovementSurfaceSet,
} from './improvement-surfaces'
import {
  assertNoCallerOptimizationReceipt,
  attachOptimizationActivationReceipt,
  createOptimizationActivationReceipt,
  optimizationActivationReceiptFromMetadata,
} from './optimization-receipt'
import type { AgentImprovementProfileStateDigest } from './profile-activation'

export type {
  AgentImprovementActivation,
  AgentImprovementEvaluation,
  AgentImprovementMeasuredComparison,
  AgentImprovementProposal,
  AgentImprovementReview,
  AgentImprovementReviewDecision,
  CandidateExecutionEvidence,
} from '@tangle-network/agent-interface'

export interface AgentCandidateExperimentCellPlacement {
  executionId: string
  attempt?: number
  executionRoots: AgentCandidateTaskExecution['executionRoots']
  stagingRoots: AgentCandidateTaskExecution['stagingRoots']
  ports: AgentCandidateExecutionPorts
  preparation?: PrepareAgentCandidateExecutionOptions
  execution: ExecutePreparedAgentCandidateOptions
}

export interface RunAgentCandidateExperimentOptions
  extends Omit<
    CompareCandidateExperimentOptions,
    'experiment' | 'measurements' | 'measurement' | 'preparation'
  > {
  experiment: AgentCandidateExperiment
  placeCell: (
    input: CandidateExperimentExecutionInput,
  ) => AgentCandidateExperimentCellPlacement | Promise<AgentCandidateExperimentCellPlacement>
  maxConcurrency?: number
  /** Work before this call. Omit when this function is only measuring a sealed experiment. */
  preparation?: CompareCandidateExperimentOptions['preparation']
  /** Shared account when preparation and held-out work have one customer budget. */
  costLedger?: CostLedgerHandle
  signal?: AbortSignal
}

export interface RunAgentCandidateExperimentResult {
  experiment: AgentCandidateExperiment
  measurements: AgentCandidateExperimentMeasurement[]
  evaluation: AgentImprovementMeasuredComparison
}

export interface ExecuteAgentCandidateExperimentCellOptions
  extends CandidateExperimentExecutionInput,
    AgentCandidateExperimentCellPlacement {}

export interface VerifyCandidateExecutionEvidenceOptions {
  experiment: AgentCandidateExperiment
  arm: 'baseline' | 'candidate'
  benchmarkCell: AgentCandidateBenchmarkCellRef
  seed: number
  attempt?: number
  resolvedResources?: ReadonlyMap<Sha256Digest, string>
}

/** A failed baseline or candidate cell with its complete Runtime failure result. */
export class AgentCandidateExperimentCellExecutionError extends Error {
  readonly finalization: Extract<AgentCandidateRunFinalization, { succeeded: false }>

  constructor(finalization: Extract<AgentCandidateRunFinalization, { succeeded: false }>) {
    super(`candidate experiment cell failed: ${finalization.reason}`)
    this.name = 'AgentCandidateExperimentCellExecutionError'
    this.finalization = finalization
  }
}

export interface CreateAgentImprovementProposalOptions {
  runId: string
  findings: readonly ProposalFinding[]
  evaluation: AgentImprovementEvaluation
  now?: () => Date
}

export type CreateAgentImprovementMeasuredComparisonOptions = CompareCandidateExperimentOptions

export interface ReviewAgentImprovementInput {
  decision: AgentImprovementReviewDecision
  reviewedBy: string
  reason: string
  feedback?: string
  now?: () => Date
}

export interface CreateAgentImprovementActivationOptions {
  intent: AgentImprovementActivationIntent
  /** Runtime derives each exact source digest; callers identify only the records to change. */
  targets: [AgentImprovementActivationTargetIdentity, ...AgentImprovementActivationTargetIdentity[]]
  fundingOwner: string
  authorizedBy: string
  expiresAt: string
  /** Required only when an activation targets the complete `agent-profile` surface. */
  executionRef?: AgentProfileImprovementExecutionRef
  now?: () => Date
}

export type AgentImprovementAnalysisOptions = Omit<
  RunAnalystLoopOpts,
  | 'runId'
  | 'improvementProposalSource'
  | 'knowledgeProposalSource'
  | 'onEvent'
  | 'log'
  | 'costLedger'
  | 'costPhase'
  | 'signal'
>

type WithProposalFindings<T> = T extends unknown
  ? Omit<T, 'findings'> & { findings?: readonly ProposalFinding[] }
  : never

export interface ProposeAgentImprovementOptions<TScenario extends Scenario, TArtifact> {
  runId: string
  profile: AgentProfile
  analysis: AgentImprovementAnalysisOptions
  improvement: WithProposalFindings<ImproveOptions<TScenario, TArtifact>>
  buildExperiment: (input: {
    analysis: RunAnalystLoopResult
    improvement: ImproveResult<TScenario, TArtifact>
  }) => AgentImprovementExperimentMaterial | Promise<AgentImprovementExperimentMaterial>
  placeCell: RunAgentCandidateExperimentOptions['placeCell']
  maxConcurrency?: number
  signal?: AbortSignal
  candidate?: AgentImprovementMeasuredComparison['candidate']
  metadata?: AgentImprovementMeasuredComparison['metadata']
  now?: () => Date
}

/** Product-supplied experiment material. Runtime supplies optimizer ancestry and the final digest. */
export type AgentImprovementExperimentMaterial = Omit<
  AgentCandidateExperimentMaterial,
  'candidateLineage'
>

export interface ProposeAgentImprovementResult<TScenario extends Scenario, TArtifact> {
  analysis: RunAnalystLoopResult
  improvement: ImproveResult<TScenario, TArtifact>
  experiment: AgentCandidateExperiment
  measurements: AgentCandidateExperimentMeasurement[]
  proposal: AgentImprovementProposal
}

/** Product-owned task material that Runtime freezes before either profile state runs. */
export interface AgentProfileImprovementBenchmark {
  tasks: [AgentProfileImprovementTaskMaterial, ...AgentProfileImprovementTaskMaterial[]]
  reps: number
  seeds: [number, ...number[]]
  policy: AgentCandidateEvaluationPolicy
}

/**
 * One product execution adapter shared by optimizer search and exact profile
 * measurement. `executionRef` must identify both operations and their closure.
 */
export interface AgentProfileImprovementExecutor<TScenario extends Scenario, TArtifact> {
  executionRef: AgentProfileImprovementExecutionRef
  optimize: ImproveMethodOptions<TScenario, TArtifact>['agent']
  measure(
    input: AgentProfileImprovementExperimentExecutionInput & { profile: AgentProfile },
  ): Promise<AgentProfileImprovementRunReceipt>
}

/** The portable profile changes that the measured-profile contract permits. */
export type AgentProfileImprovementMethodOptions<TScenario extends Scenario, TArtifact> = Omit<
  ImproveMethodOptions<TScenario, TArtifact>,
  'agent' | 'executionRef' | 'findings' | 'surface'
> & {
  surface?: AgentProfileMeasuredSurface
  findings?: readonly ProposalFinding[]
}

/**
 * Complete profile-improvement path for a product-owned source.
 * Runtime owns analysis, search ancestry, profile diffs, experiment sealing,
 * paired evaluation, and the reviewable proposal. The product keeps its
 * profile bytes, task executor, billing, trace capture, and persistence.
 */
export interface ProposeAgentProfileImprovementOptions<TScenario extends Scenario, TArtifact> {
  runId: string
  source: AgentImprovementSource
  profile: AgentProfile
  stateDigest: AgentImprovementProfileStateDigest
  analysis: AgentImprovementAnalysisOptions
  improvement: AgentProfileImprovementMethodOptions<TScenario, TArtifact>
  benchmark: AgentProfileImprovementBenchmark
  executor: AgentProfileImprovementExecutor<TScenario, TArtifact>
  /** One customer-approved maximum for analysis, optimization, and measurement. */
  budgetUsd: number
  maxConcurrency?: number
  signal?: AbortSignal
  candidate?: AgentProfileImprovementMeasuredComparison['candidate']
  metadata?: AgentProfileImprovementMeasuredComparison['metadata']
  now?: () => Date
}

export interface ProposeAgentProfileImprovementResult {
  analysis: RunAnalystLoopResult
  improvement: ImproveMethodResult
  experiment: AgentProfileImprovementExperiment
  measurements: AgentProfileImprovementMeasurement[]
  proposal: AgentImprovementProposal
}

function sealAgentImprovementExperiment<TScenario extends Scenario, TArtifact>(
  material: AgentImprovementExperimentMaterial,
  improvement: ImproveResult<TScenario, TArtifact>,
): AgentCandidateExperiment {
  assertRuntimeOwnedExperimentFieldsAbsent(material)
  // Bundle ancestry names the frozen proposal baseline; the optimizer run identifies its full search history.
  const candidateLineage: AgentCandidateLineage = {
    source: 'optimizer',
    parentDigests: [material.baseline.digest],
    runIds: [improvement.lineage.runId],
    developmentSplitDigest: improvement.lineage.developmentSplitDigest,
  }
  const experiment = sealCandidateExperiment({ ...material, candidateLineage })
  assertCandidateReleaseWorkIsFresh(experiment, improvement)
  return experiment
}

function assertRuntimeOwnedExperimentFieldsAbsent(
  material: AgentImprovementExperimentMaterial,
): void {
  if (material === null || typeof material !== 'object' || Array.isArray(material)) {
    throw new Error('agent improvement experiment material must be an object')
  }
  const supplied = ['candidateLineage', 'digest'].filter((field) => Object.hasOwn(material, field))
  if (supplied.length > 0) {
    throw new Error(
      `agent improvement experiment material must not supply Runtime-owned fields: ${supplied.join(', ')}`,
    )
  }
}

type ProposalFindingImprovementProposal = Omit<AgentImprovementProposal, 'findings'> & {
  findings: ProposalFinding[]
}

/** Execute both arms of one immutable experiment and derive its paired result. */
export async function runAgentCandidateExperiment(
  options: RunAgentCandidateExperimentOptions,
): Promise<RunAgentCandidateExperimentResult> {
  const experiment = verifyCandidateExperiment(options.experiment)
  const preparation = options.preparation ?? {
    wallDurationMs: 0,
    cost: { usd: 0, provenance: 'observed' as const },
  }
  const costLedger =
    options.costLedger ??
    (experiment.policy.budgetUsd === undefined
      ? undefined
      : new CostLedger({ costCeilingUsd: experiment.policy.budgetUsd }))
  const run = await runCandidateExperiment({
    experiment,
    ...(options.maxConcurrency === undefined ? {} : { maxConcurrency: options.maxConcurrency }),
    ...(costLedger ? { costLedger } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    execute: async (input) => {
      const placement = await options.placeCell(input)
      return await executeAgentCandidateExperimentCell({ ...input, ...placement })
    },
  })
  const evaluation = createAgentImprovementMeasuredComparison({
    experiment,
    measurements: run.measurements,
    preparation,
    measurement: run.measurement,
    runId: options.runId,
    ...(options.candidate ? { candidate: options.candidate } : {}),
    ...(options.generationsExplored === undefined
      ? {}
      : { generationsExplored: options.generationsExplored }),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  })
  return { experiment, measurements: run.measurements, evaluation }
}

/** Execute one exact arm, task, repetition, seed, and attempt through Runtime. */
export async function executeAgentCandidateExperimentCell(
  options: ExecuteAgentCandidateExperimentCellOptions,
): Promise<CandidateExecutionEvidence> {
  const experiment = verifyCandidateExperiment(options.experiment)
  const bundle = experiment[options.arm]
  assertExactExperimentInput(options, experiment, bundle)
  const attempt = options.attempt ?? 1
  if (attempt > options.task.attempt.maxAttempts) {
    throw new Error('candidate experiment attempt exceeds the signed task policy')
  }
  const runCell = canonicalCandidateDocument<AgentCandidateRunCell>({
    kind: 'agent-candidate-run-cell',
    experimentDigest: experiment.digest,
    arm: options.arm,
    bundleDigest: bundle.digest,
    suiteDigest: options.benchmarkCell.suiteDigest,
    taskDigest: options.task.digest,
    taskIndex: options.benchmarkCell.taskIndex,
    repetition: options.benchmarkCell.repetition,
    seed: options.seed,
    attempt,
  }).value
  const verified = await verifyAgentCandidateBundle(bundle, options.ports)
  const prepared = await prepareAgentCandidateExecution(
    verified,
    {
      executionId: options.executionId,
      runCell,
      benchmarkSuite: experiment.benchmark.suite,
      task: options.task,
      executionRoots: options.executionRoots,
      stagingRoots: options.stagingRoots,
    },
    options.ports,
    options.preparation,
  )
  const finalization = await executePreparedAgentCandidate(prepared, options.execution)
  if (!finalization.succeeded) {
    throw new AgentCandidateExperimentCellExecutionError(finalization)
  }
  const evidence = canonicalCandidateDocument<CandidateExecutionEvidence>({
    kind: 'agent-candidate-execution-evidence',
    materializationReceipt: prepared.materializationReceipt.value,
    receipt: finalization.receipt.value,
  }).value
  return verifyCandidateExecutionEvidence(evidence, {
    experiment,
    arm: options.arm,
    benchmarkCell: options.benchmarkCell,
    seed: options.seed,
    attempt,
    resolvedResources: verifiedResourceTextByDigest(verified),
  })
}

/** Delegate all statistics and promotion checks to agent-eval's receipt-based comparison. */
export function createAgentImprovementMeasuredComparison(
  options: CreateAgentImprovementMeasuredComparisonOptions,
): AgentImprovementMeasuredComparison {
  return verifyCandidateExperimentComparison(measuredComparisonFromCandidateExperiment(options))
}

async function analyzeAgentImprovement(
  runId: string,
  options: AgentImprovementAnalysisOptions,
  costLedger?: CostLedgerHandle,
  signal?: AbortSignal,
): Promise<{ analysis: RunAnalystLoopResult; findings: ProposalFinding[] }> {
  assertMeasuredAnalysisOptions(options)
  const analysis = await runAnalystLoop({
    ...options,
    runId,
    ...(costLedger ? { costLedger, costPhase: 'profile-improvement-analysis' } : {}),
    ...(signal ? { signal } : {}),
  })
  if (costLedger) assertAnalysisCostRecorded(analysis, costLedger)
  const findings = assertProposalFindings(
    analysis.analystResult.findings.map((finding) => ({
      ...finding,
      proposal_origin: 'production' as const,
    })),
    'agent improvement findings',
  )
  return { analysis, findings: [...findings] }
}

function assertMeasuredAnalysisOptions(options: AgentImprovementAnalysisOptions): void {
  const rawOptions = options as RunAnalystLoopOpts
  if (
    rawOptions.knowledgeProposalSource !== undefined ||
    rawOptions.improvementProposalSource !== undefined
  ) {
    throw new Error('measured agent improvement analysis must not run proposal sources')
  }
  if (rawOptions.onEvent !== undefined || rawOptions.log !== undefined) {
    throw new Error('measured agent improvement analysis must not run callbacks')
  }
}

interface ImprovementSearchAccounting {
  costUsd: number
  durationMs: number
}

function completeAnalysisAccounting(analysis: RunAnalystLoopResult): ImprovementSearchAccounting {
  const analysisCost = analysis.analystResult.total_cost_provenance
  if (!analysisCost || analysisCost.kind === 'uncaptured') {
    throw new Error('agent improvement analysis cost is uncaptured')
  }
  if (
    !Number.isFinite(analysis.analystResult.total_cost_usd) ||
    analysis.analystResult.total_cost_usd < 0
  ) {
    throw new Error('agent improvement analysis cost must be finite and non-negative')
  }
  if (analysisCost.usd !== analysis.analystResult.total_cost_usd) {
    throw new Error('agent improvement analysis cost does not match its provenance')
  }
  if (!Number.isFinite(analysis.durationMs) || analysis.durationMs < 0) {
    throw new Error('agent improvement analysis duration must be finite and non-negative')
  }
  return {
    costUsd: analysis.analystResult.total_cost_usd,
    durationMs: analysis.durationMs,
  }
}

function assertAnalysisCostRecorded(
  analysis: RunAnalystLoopResult,
  costLedger: CostLedgerHandle,
): void {
  const reported = completeAnalysisAccounting(analysis)
  const summary = costLedger.summary()
  if (!summary.accountingComplete || summary.costProvenance.kind === 'uncaptured') {
    throw new Error('agent improvement analysis cost is incomplete in the shared account')
  }
  const analysisCost = analysis.analystResult.total_cost_provenance
  if (!analysisCost || analysisCost.kind === 'uncaptured') {
    throw new Error('agent improvement analysis cost is uncaptured')
  }
  if (
    !numbersApproximatelyEqual(summary.totalCostUsd, reported.costUsd) ||
    summary.costProvenance.kind !== analysisCost.kind
  ) {
    throw new Error('agent improvement analysis cost does not match the shared account')
  }
}

function createProfileImprovementCostLedger(budgetUsd: number): CostLedger {
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    throw new Error('profile improvement budgetUsd must be a non-negative finite number')
  }
  return new CostLedger({ costCeilingUsd: budgetUsd })
}

function profilePolicyWithBudget(
  policy: AgentCandidateEvaluationPolicy,
  budgetUsd: number,
): AgentCandidateEvaluationPolicy {
  if (policy.budgetUsd !== undefined && !numbersApproximatelyEqual(policy.budgetUsd, budgetUsd)) {
    throw new Error('profile improvement policy budgetUsd must equal the run budgetUsd')
  }
  return { ...policy, budgetUsd }
}

function profilePreparationAccounting(
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

function completeImprovementSearchAccounting(
  analysis: ImprovementSearchAccounting,
  improvement: {
    cost: {
      totalCostUsd: number
      accountingComplete: boolean
      incompleteReasons: readonly string[]
    }
    durationMs: number
  },
): { searchCostUsd: number; searchDurationMs: number } {
  if (!improvement.cost.accountingComplete) {
    throw new Error(
      `agent improvement optimization cost is incomplete: ${improvement.cost.incompleteReasons.join(', ') || 'unspecified'}`,
    )
  }
  if (!Number.isFinite(improvement.cost.totalCostUsd) || improvement.cost.totalCostUsd < 0) {
    throw new Error('agent improvement optimization cost must be finite and non-negative')
  }
  if (!Number.isFinite(improvement.durationMs) || improvement.durationMs < 0) {
    throw new Error('agent improvement optimization duration must be finite and non-negative')
  }
  return {
    searchCostUsd: analysis.costUsd + improvement.cost.totalCostUsd,
    searchDurationMs: analysis.durationMs + improvement.durationMs,
  }
}

function profileStateDigest(
  stateDigest: AgentImprovementProfileStateDigest,
  identity: string,
  profile: AgentProfile,
): Sha256Digest {
  return agentProfileImprovementArmSchema.parse({
    stateDigest: stateDigest({ identity, profile }),
  }).stateDigest
}

function sealProfileImprovementBenchmark(
  input: AgentProfileImprovementBenchmark,
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

function profileTaskScenarioIdentity(task: AgentProfileImprovementTask): CampaignScenarioIdentity {
  return {
    id: task.scenario.id,
    kind: task.scenario.kind,
    scenarioDigest: task.scenario.digest,
  }
}

function assertReleaseSplitIsFresh<TScenario extends Scenario, TArtifact>(
  heldOutSplitDigest: Sha256Digest,
  improvement: ImproveResult<TScenario, TArtifact>,
): void {
  const consumedSplits = [improvement.lineage.developmentSplitDigest]
  if (improvement.mode === 'method') {
    const finalTestSplitDigest = improvement.lineage.finalTestSplitDigest
    if (!finalTestSplitDigest) {
      throw new Error('method improvement does not retain its final-test split digest')
    }
    consumedSplits.push(finalTestSplitDigest)
  }
  if (consumedSplits.includes(heldOutSplitDigest)) {
    throw new Error('release benchmark reuses an optimizer development or final-test split')
  }
}

function assertReleaseScenariosAreFresh(
  improvement: ImproveMethodResult,
  heldOutScenarios: readonly CampaignScenarioIdentity[],
): void {
  const optimizerScenarios = new Map<string, string>()
  for (const [partition, scenarios] of [
    ['train', improvement.lineage.scenarioPartitions.train],
    ['selection', improvement.lineage.scenarioPartitions.selection],
    ['final-test', improvement.lineage.scenarioPartitions.finalTest],
  ] as const) {
    for (const scenario of scenarios) {
      optimizerScenarios.set(canonicalCandidateDigest(scenario), partition)
    }
  }
  const reused = heldOutScenarios
    .filter((scenario) => optimizerScenarios.has(canonicalCandidateDigest(scenario)))
    .map(
      (scenario) =>
        `${scenario.id} (${optimizerScenarios.get(canonicalCandidateDigest(scenario))})`,
    )
  if (reused.length > 0) {
    throw new Error(`release benchmark reuses optimizer scenario(s): [${reused.join(', ')}]`)
  }
}

function assertCandidateReleaseWorkIsFresh<TScenario extends Scenario, TArtifact>(
  experiment: AgentCandidateExperiment,
  improvement: ImproveResult<TScenario, TArtifact>,
): void {
  for (const splitDigest of new Set(
    experiment.benchmark.tasks.map((task) => task.benchmark.splitDigest),
  )) {
    assertReleaseSplitIsFresh(splitDigest, improvement)
  }
  if (improvement.mode !== 'method') return
  assertReleaseScenariosAreFresh(
    improvement,
    experiment.benchmark.tasks.map((task) => task.scenario),
  )
}

function assertProfileReleaseWorkIsFresh(
  benchmark: AgentProfileImprovementSuiteInputs,
  improvement: ImproveMethodResult,
): void {
  assertReleaseSplitIsFresh(benchmark.suite.splitDigest, improvement)
  assertReleaseScenariosAreFresh(improvement, benchmark.tasks.map(profileTaskScenarioIdentity))
}

function profileImprovementMetadata(
  metadata: AgentProfileImprovementMeasuredComparison['metadata'],
  source: AgentImprovementSource,
  optimizationReceipt: ReturnType<typeof createOptimizationActivationReceipt>,
): NonNullable<AgentProfileImprovementMeasuredComparison['metadata']> {
  assertNoCallerOptimizationReceipt(metadata)
  if (metadata && Object.hasOwn(metadata, AGENT_IMPROVEMENT_SOURCE_METADATA_KEY)) {
    throw new Error(
      `candidate metadata reserves '${AGENT_IMPROVEMENT_SOURCE_METADATA_KEY}' for Runtime`,
    )
  }
  const sourceMetadata = agentImprovementSourceMetadata(source)
  const merged = { ...(metadata ?? {}), ...sourceMetadata }
  return optimizationReceipt
    ? attachOptimizationActivationReceipt(merged, optimizationReceipt)
    : immutableCandidateValue(merged)
}

/**
 * Analyze a product-owned profile, search one profile surface, then run the
 * exact baseline and candidate through the product executor before proposing.
 */
export async function proposeAgentProfileImprovement<TScenario extends Scenario, TArtifact>(
  options: ProposeAgentProfileImprovementOptions<TScenario, TArtifact>,
): Promise<ProposeAgentProfileImprovementResult> {
  const source = agentImprovementSourceSchema.parse(options.source)
  const surface = options.improvement.surface ?? 'prompt'
  if (!isAgentProfileMeasuredSurface(surface)) {
    throw new Error(
      'measured profile improvement supports prompt or skills; use the sealed-candidate path for this surface',
    )
  }
  assertMeasuredAnalysisOptions(options.analysis)
  const inputFindings = assertProposalFindings(
    options.improvement.findings ?? [],
    'profile improvement input findings',
  )
  const costLedger = createProfileImprovementCostLedger(options.budgetUsd)
  const preparationStartedAt = performance.now()
  const profile = parseExactAgentProfile(options.profile, 'profile improvement source')
  const baselineStateDigest = profileStateDigest(
    options.stateDigest,
    source.sourceIdentity,
    profile,
  )
  if (baselineStateDigest !== source.sourceDigest) {
    throw new Error('profile improvement source digest does not match the measured profile state')
  }
  const policy = profilePolicyWithBudget(options.benchmark.policy, options.budgetUsd)
  if (
    options.improvement.costCeiling !== undefined &&
    !numbersApproximatelyEqual(options.improvement.costCeiling, options.budgetUsd)
  ) {
    throw new Error('profile improvement costCeiling must equal the run budgetUsd')
  }
  const { analysis, findings } = await analyzeAgentImprovement(
    options.runId,
    options.analysis,
    costLedger,
    options.signal,
  )
  const improvement = await improve(profile, {
    ...options.improvement,
    executionRef: options.executor.executionRef.digest,
    agent: options.executor.optimize,
    costLedger,
    costCeiling: options.budgetUsd,
    findings: [...inputFindings, ...findings],
  })
  try {
    if (improvement.decision !== 'ship') {
      throw new Error('agent profile improvement search did not produce a promotable candidate')
    }
    const candidateProfile = parseExactAgentProfile(
      improvement.candidate.profile,
      'profile improvement candidate',
    )
    const candidateStateDigest = profileStateDigest(
      options.stateDigest,
      source.sourceIdentity,
      candidateProfile,
    )
    if (candidateStateDigest === baselineStateDigest) {
      throw new Error('profile improvement candidate state digest matches the baseline')
    }
    const change = agentImprovementProfileDiffs(profile, candidateProfile, {
      id: `profile-improvement:${candidateStateDigest}`,
      metadata: {
        sourceIdentity: source.sourceIdentity,
        sourceRevision: source.sourceRevision,
      },
    })
    const profileDiffIds = change.map((step) => {
      if (!step.id) throw new Error('profile improvement change requires an exact diff id')
      return step.id
    })
    const benchmark = sealProfileImprovementBenchmark({ ...options.benchmark, policy })
    assertProfileReleaseWorkIsFresh(benchmark, improvement)
    const experiment = sealAgentProfileImprovementExperiment({
      kind: 'agent-profile-improvement-experiment',
      digestAlgorithm: 'rfc8785-sha256',
      source,
      executionRef: options.executor.executionRef,
      baseline: { stateDigest: baselineStateDigest },
      candidate: { stateDigest: candidateStateDigest },
      change,
      candidateLineage: {
        source: 'optimizer',
        parentDigests: [source.sourceDigest],
        runIds: [improvement.lineage.runId],
        profileDiffIds,
        developmentSplitDigest: improvement.lineage.developmentSplitDigest,
      },
      benchmark,
      policy,
    })
    const profilesByStateDigest = new Map<Sha256Digest, AgentProfile>([
      [baselineStateDigest, profile],
      [candidateStateDigest, candidateProfile],
    ])
    const preparation = profilePreparationAccounting(costLedger, preparationStartedAt)
    const run = await runAgentProfileImprovementExperiment({
      experiment,
      ...(options.maxConcurrency === undefined ? {} : { maxConcurrency: options.maxConcurrency }),
      costLedger,
      ...(options.signal ? { signal: options.signal } : {}),
      execute: async (input) => {
        const measuredProfile = profilesByStateDigest.get(input.stateDigest)
        if (!measuredProfile) {
          throw new Error('profile improvement execution requested an unknown profile state')
        }
        return options.executor.measure({ ...input, profile: measuredProfile })
      },
    })
    const optimizationReceipt = createOptimizationActivationReceipt(improvement)
    const evaluation = verifyAgentProfileImprovementExperimentComparison(
      measuredComparisonFromAgentProfileImprovementExperiment({
        experiment,
        measurements: run.measurements,
        runId: options.runId,
        ...(options.candidate ? { candidate: options.candidate } : {}),
        generationsExplored: improvement.generationsExplored ?? 0,
        preparation,
        measurement: run.measurement,
        metadata: profileImprovementMetadata(options.metadata, source, optimizationReceipt),
      }),
    )
    const proposal = createAgentImprovementProposal({
      runId: options.runId,
      findings,
      evaluation,
      ...(options.now ? { now: options.now } : {}),
    })
    return { analysis, improvement, experiment, measurements: run.measurements, proposal }
  } catch (cause) {
    return rethrowAfterCleanup(
      cause,
      () => improvement.dispose(),
      'proposeAgentProfileImprovement failed',
    )
  }
}

/** Analyze, search, then remeasure the resulting exact candidate before proposing it. */
export async function proposeAgentImprovement<TScenario extends Scenario, TArtifact>(
  options: ProposeAgentImprovementOptions<TScenario, TArtifact>,
): Promise<ProposeAgentImprovementResult<TScenario, TArtifact>> {
  assertNoCallerOptimizationReceipt(options.metadata)
  assertMeasuredAnalysisOptions(options.analysis)
  const inputFindings = assertProposalFindings(
    options.improvement.findings ?? [],
    'agent improvement input findings',
  )
  const { analysis, findings } = await analyzeAgentImprovement(options.runId, options.analysis)
  const analysisAccounting = completeAnalysisAccounting(analysis)
  const improvementInput = {
    ...options.improvement,
    findings: [...inputFindings, ...findings],
  }
  const improvement =
    improvementInput.surface === 'code'
      ? await improve(improvementInput)
      : await improve(options.profile, improvementInput)
  try {
    if (improvement.decision !== 'ship') {
      throw new Error('agent improvement search did not produce a promotable candidate')
    }
    const searchAccounting = completeImprovementSearchAccounting(analysisAccounting, improvement)
    const preparation = {
      wallDurationMs: searchAccounting.searchDurationMs,
      cost: {
        usd: searchAccounting.searchCostUsd,
        provenance: 'estimated' as const,
      },
    }
    const optimizationReceipt =
      improvement.mode === 'method' ? createOptimizationActivationReceipt(improvement) : undefined
    const experiment = sealAgentImprovementExperiment(
      await options.buildExperiment({ analysis, improvement }),
      improvement,
    )
    assertCandidateProfileBinding(options.profile, experiment.baseline.profile)
    assertImprovementCandidateBinding(improvement, experiment)
    const measured = await runAgentCandidateExperiment({
      experiment,
      runId: options.runId,
      placeCell: options.placeCell,
      ...(options.maxConcurrency === undefined ? {} : { maxConcurrency: options.maxConcurrency }),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.candidate ? { candidate: options.candidate } : {}),
      ...(optimizationReceipt
        ? {
            metadata: attachOptimizationActivationReceipt(options.metadata, optimizationReceipt),
          }
        : options.metadata
          ? { metadata: options.metadata }
          : {}),
      ...(improvement.generationsExplored === undefined
        ? {}
        : { generationsExplored: improvement.generationsExplored }),
      preparation,
    })
    const proposal = createAgentImprovementProposal({
      runId: options.runId,
      findings,
      evaluation: measured.evaluation,
      ...(options.now ? { now: options.now } : {}),
    })
    return {
      analysis,
      improvement,
      experiment,
      measurements: measured.measurements,
      proposal,
    }
  } catch (cause) {
    return rethrowAfterCleanup(cause, () => improvement.dispose(), 'proposeAgentImprovement failed')
  }
}

function assertImprovementCandidateBinding<TScenario extends Scenario, TArtifact>(
  improvement: ImproveResult<TScenario, TArtifact>,
  experiment: AgentCandidateExperiment,
): void {
  const candidate = improvement.candidate
  if (candidate.surface !== 'code') {
    try {
      assertCandidateProfileBinding(candidate.profile, experiment.candidate.profile)
    } catch (cause) {
      throw new Error('candidate experiment does not contain the improvement winner', { cause })
    }
    return
  }

  const surface = candidate.value
  const code = experiment.candidate.code
  if (
    typeof surface !== 'object' ||
    surface === null ||
    surface.kind !== 'code' ||
    code.kind !== 'git-patch' ||
    code.baseCommit !== surface.baseCommit ||
    code.baseTree !== surface.baseTree ||
    code.candidateTree !== surface.candidateTree ||
    code.patch.artifact.sha256 !== surface.patch.sha256 ||
    code.patch.artifact.byteLength !== surface.patch.byteLength
  ) {
    throw new Error('candidate experiment does not contain the improvement winner')
  }
  if (
    canonicalCandidateDigest(experiment.baseline.profile) !==
    canonicalCandidateDigest(experiment.candidate.profile)
  ) {
    throw new Error('code improvement candidate changed the agent profile')
  }
}

/** Create the reviewable record only from a complete, recomputable experiment result. */
export function createAgentImprovementProposal(
  options: CreateAgentImprovementProposalOptions,
): AgentImprovementProposal {
  const findings = assertProposalFindings(
    options.findings,
    'createAgentImprovementProposal findings',
  )
  const { evaluation, changedSurfaces } = validateShippableAgentImprovementEvaluation(
    options.evaluation,
    options.runId,
    'agent improvement proposal',
  )
  return agentImprovementProposalSchema.parse(
    canonicalCandidateDocument<ProposalFindingImprovementProposal>({
      kind: 'agent-improvement-proposal',
      runId: options.runId,
      changedSurfaces,
      proposedAt: (options.now ?? (() => new Date()))().toISOString(),
      findings: [...findings],
      evaluation,
    }).value,
  )
}

/** Persist a human or tenant-policy decision bound to one exact proposal. */
export function reviewAgentImprovementProposal(
  inputProposal: AgentImprovementProposal,
  input: ReviewAgentImprovementInput,
): AgentImprovementReview {
  const proposal = verifyAgentImprovementProposal(inputProposal)
  if (!input.reviewedBy.trim()) throw new Error('candidate review requires reviewedBy')
  if (!input.reason.trim()) throw new Error('candidate review requires a reason')
  if (input.decision === 'approve' && proposal.evaluation.decision.outcome !== 'ship') {
    throw new Error('candidate cannot be approved without a passing experiment')
  }
  const reviewedAt = (input.now ?? (() => new Date()))().toISOString()
  if (Date.parse(reviewedAt) < Date.parse(proposal.proposedAt)) {
    throw new Error('candidate review cannot predate its proposal')
  }
  return agentImprovementReviewSchema.parse(
    canonicalCandidateDocument<AgentImprovementReview>({
      kind: 'agent-improvement-review',
      proposalDigest: proposal.digest,
      decision: input.decision,
      reviewedBy: input.reviewedBy,
      reviewedAt,
      reason: input.reason,
      ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
    }).value,
  )
}

/** Authorize product-owned writes only after the exact candidate was measured and approved. */
export function createAgentImprovementActivation(
  inputProposal: AgentImprovementProposal,
  inputReview: AgentImprovementReview,
  options: CreateAgentImprovementActivationOptions,
): AgentImprovementActivation {
  const proposal = verifyAgentImprovementProposal(inputProposal)
  const review = verifyAgentImprovementReview(inputReview)
  if (review.decision !== 'approve' || review.proposalDigest !== proposal.digest) {
    throw new Error('candidate activation requires an approval for the exact proposal')
  }
  if (!options.fundingOwner.trim() || !options.authorizedBy.trim()) {
    throw new Error('candidate activation authority must be non-empty')
  }
  const experiment = proposal.evaluation.experiment
  const authorizedAt = (options.now ?? (() => new Date()))().toISOString()
  if (Date.parse(authorizedAt) < Date.parse(review.reviewedAt)) {
    throw new Error('candidate activation cannot predate its approval')
  }
  const targets = buildAgentImprovementActivationTargets(
    proposal.changedSurfaces,
    experiment,
    options.intent,
    options.targets,
  )
  const executionRef = profileActivationExecutionRef(experiment, targets, options.executionRef)
  return agentImprovementActivationSchema.parse(
    canonicalCandidateDocument<AgentImprovementActivation>({
      kind: 'agent-improvement-activation',
      proposalDigest: proposal.digest,
      reviewDigest: review.digest,
      experimentDigest: experiment.digest,
      candidateDigest: measuredCandidateDigest(proposal),
      ...(executionRef ? { executionRef } : {}),
      intent: options.intent,
      targets,
      fundingOwner: options.fundingOwner,
      authorizedBy: options.authorizedBy,
      authorizedAt,
      expiresAt: options.expiresAt,
    }).value,
  )
}

/** Validate a proposal and recompute every binding to its measured experiment. */
export function verifyAgentImprovementProposal(input: unknown): AgentImprovementProposal {
  const proposal = verifyCanonicalCandidateDocument(
    agentImprovementProposalSchema.parse(input),
    'agent improvement proposal',
  )
  const { changedSurfaces } = validateShippableAgentImprovementEvaluation(
    proposal.evaluation,
    proposal.runId,
    'agent improvement proposal',
  )
  const changedSurfacesMatch =
    proposal.evaluation.kind === 'agent-profile-improvement-measured-comparison'
      ? sameAgentImprovementSurfaceSet(proposal.changedSurfaces, changedSurfaces)
      : sameOrderedValues(proposal.changedSurfaces, changedSurfaces)
  if (!changedSurfacesMatch) {
    throw new Error('proposal changed surfaces do not match its exact experiment')
  }
  assertProposalFindings(proposal.findings, 'agent improvement proposal findings')
  return proposal
}

/** Return a sealed bundle experiment; ordinary profile changes need a product-owned executor. */
export function requireSealedCandidateExperiment(
  proposal: AgentImprovementProposal,
): AgentCandidateExperiment {
  if (proposal.evaluation.kind !== 'agent-improvement-measured-comparison') {
    throw new Error(
      'agent profile improvement activation requires a product profile-diff executor, not a sealed candidate bundle',
    )
  }
  return proposal.evaluation.experiment
}

function measuredCandidateDigest(proposal: AgentImprovementProposal): Sha256Digest {
  return proposal.evaluation.kind === 'agent-profile-improvement-measured-comparison'
    ? proposal.evaluation.experiment.candidate.stateDigest
    : proposal.evaluation.experiment.candidate.digest
}

function profileActivationExecutionRef(
  experiment: AgentImprovementEvaluation['experiment'],
  targets: AgentImprovementActivation['targets'],
  executionRef: AgentProfileImprovementExecutionRef | undefined,
): AgentProfileImprovementExecutionRef | undefined {
  const targetsAgentProfile = targets.some((target) => target.surface === 'agent-profile')
  if (!targetsAgentProfile) {
    if (executionRef !== undefined) {
      throw new Error('profile activation executionRef is valid only for agent-profile targets')
    }
    return undefined
  }
  if (experiment.kind !== 'agent-profile-improvement-experiment') {
    throw new Error('agent-profile activation requires a measured profile experiment')
  }
  if (executionRef === undefined) {
    throw new Error('profile improvement activation requires the measured executor')
  }
  const parsed = agentProfileImprovementExecutionRefSchema.parse(executionRef)
  if (canonicalCandidateDigest(parsed) !== canonicalCandidateDigest(experiment.executionRef)) {
    throw new Error('profile improvement activation executor does not match the measurement')
  }
  return parsed
}

function validateShippableAgentImprovementEvaluation(
  input: unknown,
  runId: string,
  subject: string,
): {
  evaluation: AgentImprovementEvaluation
  changedSurfaces: AgentImprovementProposal['changedSurfaces']
} {
  const evaluation = verifyAgentImprovementEvaluation(input)
  if (evaluation.decision.outcome !== 'ship') {
    throw new Error(`${subject} requires a passing experiment`)
  }
  if (runId !== evaluation.provenance.runId) {
    throw new Error('proposal runId does not match its measured experiment')
  }
  const changedSurfaces =
    evaluation.kind === 'agent-profile-improvement-measured-comparison'
      ? profileImprovementChangedSurfaces(evaluation.experiment.change)
      : deriveChangedSurfaces(evaluation.experiment.baseline, evaluation.experiment.candidate)
  return { evaluation, changedSurfaces }
}

/** Use each owning package's complete measurement validator before a proposal is persisted. */
function verifyAgentImprovementEvaluation(input: unknown): AgentImprovementEvaluation {
  if (
    typeof input === 'object' &&
    input !== null &&
    'kind' in input &&
    input.kind === 'agent-profile-improvement-measured-comparison'
  ) {
    const evaluation = agentProfileImprovementMeasuredComparisonSchema.parse(input)
    optimizationActivationReceiptFromMetadata(evaluation.metadata)
    return evaluation
  }
  const evaluation = verifyCandidateExperimentComparison(input)
  optimizationActivationReceiptFromMetadata(evaluation.metadata)
  return evaluation
}

/** Validate the canonical identity and wire shape of an improvement review. */
export function verifyAgentImprovementReview(input: unknown): AgentImprovementReview {
  return verifyCanonicalCandidateDocument(
    agentImprovementReviewSchema.parse(input),
    'agent improvement review',
  )
}

/** Validate activation authority against the exact proposal, review, experiment, and base state. */
export function verifyAgentImprovementActivation(input: {
  proposal: unknown
  review: unknown
  activation: unknown
}): AgentImprovementActivation {
  const proposal = verifyAgentImprovementProposal(input.proposal)
  const review = verifyAgentImprovementReview(input.review)
  const activation = verifyCanonicalCandidateDocument(
    agentImprovementActivationSchema.parse(input.activation),
    'agent improvement activation',
  )
  const experiment = proposal.evaluation.experiment
  if (
    review.decision !== 'approve' ||
    review.proposalDigest !== proposal.digest ||
    activation.proposalDigest !== proposal.digest ||
    activation.reviewDigest !== review.digest ||
    activation.experimentDigest !== experiment.digest ||
    activation.candidateDigest !== measuredCandidateDigest(proposal) ||
    Date.parse(review.reviewedAt) < Date.parse(proposal.proposedAt) ||
    Date.parse(activation.authorizedAt) < Date.parse(review.reviewedAt)
  ) {
    throw new Error('candidate activation does not bind the measured and approved candidate')
  }
  if (
    activation.targets.some((target) => target.surface === 'agent-profile') &&
    (proposal.evaluation.kind !== 'agent-profile-improvement-measured-comparison' ||
      activation.executionRef === undefined ||
      canonicalCandidateDigest(activation.executionRef) !==
        canonicalCandidateDigest(proposal.evaluation.experiment.executionRef))
  ) {
    throw new Error('profile activation does not bind the measured executor')
  }
  assertAgentImprovementActivationTargets(
    proposal.changedSurfaces,
    experiment,
    activation.intent,
    activation.targets,
  )
  return activation
}

/** Recheck one Runtime receipt against its exact signed experiment cell. */
export function verifyCandidateExecutionEvidence(
  input: unknown,
  options: VerifyCandidateExecutionEvidenceOptions,
): CandidateExecutionEvidence {
  const experiment = verifyCandidateExperiment(options.experiment)
  const bundle = experiment[options.arm]
  const task = experiment.benchmark.tasks[options.benchmarkCell.taskIndex]
  const index =
    options.benchmarkCell.taskIndex * experiment.benchmark.suite.reps +
    options.benchmarkCell.repetition
  if (
    !task ||
    options.benchmarkCell.suiteDigest !== experiment.benchmark.suite.digest ||
    options.seed !== experiment.benchmark.suite.seeds[index]
  ) {
    throw new Error('candidate execution evidence points outside its signed experiment')
  }
  const evidence = verifyCanonicalCandidateDocument(
    candidateExecutionEvidenceSchema.parse(input),
    'candidate execution evidence',
  )
  const materialization = verifyCanonicalCandidateDocument(
    agentCandidateMaterializationReceiptSchema.parse(evidence.materializationReceipt),
    'candidate materialization receipt',
  )
  const receipt = verifyCanonicalCandidateDocument(
    agentCandidateRunReceiptSchema.parse(evidence.receipt),
    'candidate run receipt',
  )
  const plan = materialization.executionPlan
  const cell = plan.material.runCell
  const attempt = options.attempt ?? 1
  if (
    cell.experimentDigest !== experiment.digest ||
    cell.arm !== options.arm ||
    cell.bundleDigest !== bundle.digest ||
    cell.suiteDigest !== experiment.benchmark.suite.digest ||
    cell.taskDigest !== task.digest ||
    cell.taskIndex !== options.benchmarkCell.taskIndex ||
    cell.repetition !== options.benchmarkCell.repetition ||
    cell.seed !== options.seed ||
    cell.attempt !== attempt ||
    canonicalCandidateDigest(omitTopLevelDigest(cell)) !== cell.digest
  ) {
    throw new Error('candidate execution receipt substituted its signed experiment cell')
  }
  assertCapturedInput(
    materialization.benchmark.suite,
    experiment.benchmark.suite,
    'benchmark suite',
  )
  assertCapturedInput(materialization.benchmark.task, task, 'benchmark task')
  assertEvidenceMaterialDigest(plan, 'candidate execution plan')
  assertEvidenceMaterialDigest(
    materialization.profileActivation.profilePlan,
    'candidate profile plan',
  )
  const expectedProfilePlan = materializeCandidateProfile(
    bundle.profile,
    candidateMaterializerHarness(materialization.harness),
    { resolvedResources: options.resolvedResources },
  )
  const activation = parseAgentCandidateProfileActivation(
    materialization.profileActivation,
    materialization.profileActivation.profilePlan.digest,
  )
  const regeneratedActivation = createAgentCandidateProfileActivation(
    expectedProfilePlan,
    materialization.profileActivation.profilePlan,
  )
  if (activation.digest !== regeneratedActivation.digest) {
    throw new Error('candidate profile activation does not match the experiment bundle')
  }
  if (
    materialization.bundleDigest !== bundle.digest ||
    receipt.bundleDigest !== bundle.digest ||
    receipt.runCellDigest !== cell.digest ||
    receipt.materializationReceiptDigest !== materialization.digest ||
    receipt.executionPlanDigest !== plan.digest
  ) {
    throw new Error('candidate execution evidence does not bind one exact Runtime run')
  }
  assertEvidenceMaterialDigest(receipt.modelSettlement, 'candidate model settlement')
  assertEvidenceMaterialDigest(receipt.taskOutcome, 'candidate task outcome')
  assertEvidenceMaterialDigest(receipt.benchmarkResult, 'candidate benchmark result')
  return immutableCandidateValue(evidence)
}

function assertExactExperimentInput(
  input: CandidateExperimentExecutionInput,
  experiment: AgentCandidateExperiment,
  bundle: AgentCandidateBundle,
): void {
  const task = experiment.benchmark.tasks[input.benchmarkCell.taskIndex]
  const index =
    input.benchmarkCell.taskIndex * experiment.benchmark.suite.reps + input.benchmarkCell.repetition
  if (
    input.experiment.digest !== experiment.digest ||
    input.bundle.digest !== bundle.digest ||
    !task ||
    input.task.digest !== task.digest ||
    input.benchmarkCell.suiteDigest !== experiment.benchmark.suite.digest ||
    input.seed !== experiment.benchmark.suite.seeds[index]
  ) {
    throw new Error('Runtime received a substituted candidate experiment cell')
  }
}

function assertCapturedInput(
  captured: { digest: Sha256Digest; material: { sha256: Sha256Digest; byteLength: number } },
  expected: { digest: Sha256Digest },
  label: string,
): void {
  const bytes = canonicalCandidateBytes(omitTopLevelDigest(expected))
  if (
    captured.digest !== expected.digest ||
    captured.material.sha256 !== expected.digest ||
    captured.material.byteLength !== bytes.byteLength
  ) {
    throw new Error(`candidate materialization substituted its ${label}`)
  }
}

function assertEvidenceMaterialDigest(
  evidence: {
    digest: Sha256Digest
    material: unknown
    artifact: { sha256: Sha256Digest; byteLength: number }
  },
  label: string,
): void {
  const bytes = canonicalCandidateBytes(evidence.material)
  if (
    canonicalCandidateDigest(evidence.material) !== evidence.digest ||
    evidence.artifact.sha256 !== evidence.digest ||
    evidence.artifact.byteLength !== bytes.byteLength
  ) {
    throw new Error(`${label} digest does not match its canonical material`)
  }
}

function sameOrderedValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
