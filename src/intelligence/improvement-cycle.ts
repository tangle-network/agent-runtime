import { type AnalystFinding, assertNoJudgeVerdict } from '@tangle-network/agent-eval/analyst'
import {
  type CandidateExperimentExecutionInput,
  type CompareCandidateExperimentOptions,
  measuredComparisonFromCandidateExperiment,
  runCandidateExperiment,
  type Scenario,
  sealCandidateExperiment,
  verifyCandidateExperiment,
  verifyCandidateExperimentComparison,
} from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateBenchmarkCellRef,
  AgentCandidateBundle,
  AgentCandidateExperiment,
  AgentCandidateExperimentMaterial,
  AgentCandidateExperimentMeasurement,
  AgentCandidateLineage,
  AgentCandidateRunCell,
  AgentImprovementActivation,
  AgentImprovementActivationIntent,
  AgentImprovementMeasuredComparison,
  AgentImprovementProposal,
  AgentImprovementReview,
  AgentImprovementReviewDecision,
  AgentProfile,
  CandidateExecutionEvidence,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  agentCandidateMaterializationReceiptSchema,
  agentCandidateRunReceiptSchema,
  agentImprovementActivationSchema,
  agentImprovementProposalSchema,
  agentImprovementReviewSchema,
  candidateExecutionEvidenceSchema,
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
import { type ImproveOptions, type ImproveResult, improve } from '../improvement/improve'
import {
  type AgentImprovementActivationTargetIdentity,
  assertAgentImprovementActivationTargets,
  buildAgentImprovementActivationTargets,
  deriveChangedSurfaces,
} from './improvement-surfaces'
import {
  assertNoCallerOptimizationReceipt,
  attachOptimizationActivationReceipt,
  createOptimizationActivationReceipt,
  optimizationActivationReceiptFromMetadata,
} from './optimization-receipt'

export type {
  AgentImprovementActivation,
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
  extends Omit<CompareCandidateExperimentOptions, 'experiment' | 'measurements'> {
  experiment: AgentCandidateExperiment
  placeCell: (
    input: CandidateExperimentExecutionInput,
  ) => AgentCandidateExperimentCellPlacement | Promise<AgentCandidateExperimentCellPlacement>
  maxConcurrency?: number
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
  findings: readonly AnalystFinding[]
  evaluation: AgentImprovementMeasuredComparison
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
  now?: () => Date
}

export interface ProposeAgentImprovementOptions<TScenario extends Scenario, TArtifact> {
  runId: string
  profile: AgentProfile
  analysis: Omit<RunAnalystLoopOpts, 'runId' | 'improvementProposalSource'>
  improvement: ImproveOptions<TScenario, TArtifact>
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
  return sealCandidateExperiment({ ...material, candidateLineage })
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

type AnalystImprovementProposal = Omit<AgentImprovementProposal, 'findings'> & {
  findings: AnalystFinding[]
}

/** Execute both arms of one immutable experiment and derive its paired result. */
export async function runAgentCandidateExperiment(
  options: RunAgentCandidateExperimentOptions,
): Promise<RunAgentCandidateExperimentResult> {
  const experiment = verifyCandidateExperiment(options.experiment)
  const measurements = await runCandidateExperiment({
    experiment,
    ...(options.maxConcurrency === undefined ? {} : { maxConcurrency: options.maxConcurrency }),
    ...(options.signal ? { signal: options.signal } : {}),
    execute: async (input) => {
      const placement = await options.placeCell(input)
      return await executeAgentCandidateExperimentCell({ ...input, ...placement })
    },
  })
  const evaluation = createAgentImprovementMeasuredComparison({
    experiment,
    measurements,
    runId: options.runId,
    ...(options.candidate ? { candidate: options.candidate } : {}),
    ...(options.generationsExplored === undefined
      ? {}
      : { generationsExplored: options.generationsExplored }),
    ...(options.searchDurationMs === undefined
      ? {}
      : { searchDurationMs: options.searchDurationMs }),
    ...(options.searchCostUsd === undefined ? {} : { searchCostUsd: options.searchCostUsd }),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  })
  return { experiment, measurements, evaluation }
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

/** Analyze, search, then remeasure the resulting exact candidate before proposing it. */
export async function proposeAgentImprovement<TScenario extends Scenario, TArtifact>(
  options: ProposeAgentImprovementOptions<TScenario, TArtifact>,
): Promise<ProposeAgentImprovementResult<TScenario, TArtifact>> {
  assertNoCallerOptimizationReceipt(options.metadata)
  const analysis = await runAnalystLoop({ ...options.analysis, runId: options.runId })
  const findings = assertNoJudgeVerdict(
    analysis.analystResult.findings,
    'proposeAgentImprovement findings',
  )
  const improvementInput = {
    ...options.improvement,
    findings: [...(options.improvement.findings ?? []), ...findings],
  }
  const improvement =
    improvementInput.surface === 'code'
      ? await improve(improvementInput)
      : await improve(options.profile, improvementInput)
  try {
    if (improvement.decision !== 'ship') {
      throw new Error('agent improvement search did not produce a promotable candidate')
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
      searchDurationMs: improvement.durationMs,
      searchCostUsd: improvement.cost.totalCostUsd,
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
  const findings = assertNoJudgeVerdict(
    [...options.findings],
    'createAgentImprovementProposal findings',
  )
  const evaluation = verifyCandidateExperimentComparison(options.evaluation)
  optimizationActivationReceiptFromMetadata(evaluation.metadata)
  if (evaluation.decision.outcome !== 'ship') {
    throw new Error('agent improvement proposal requires a passing experiment')
  }
  if (options.runId !== evaluation.provenance.runId) {
    throw new Error('proposal runId does not match its measured experiment')
  }
  const changedSurfaces = deriveChangedSurfaces(
    evaluation.experiment.baseline,
    evaluation.experiment.candidate,
  )
  return agentImprovementProposalSchema.parse(
    canonicalCandidateDocument<AnalystImprovementProposal>({
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
  return agentImprovementActivationSchema.parse(
    canonicalCandidateDocument<AgentImprovementActivation>({
      kind: 'agent-improvement-activation',
      proposalDigest: proposal.digest,
      reviewDigest: review.digest,
      experimentDigest: experiment.digest,
      candidateBundleDigest: experiment.candidate.digest,
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
  const evaluation = verifyCandidateExperimentComparison(proposal.evaluation)
  optimizationActivationReceiptFromMetadata(evaluation.metadata)
  if (evaluation.decision.outcome !== 'ship') {
    throw new Error('agent improvement proposal does not contain a passing experiment')
  }
  if (proposal.runId !== evaluation.provenance.runId) {
    throw new Error('proposal runId does not match its measured experiment')
  }
  const changedSurfaces = deriveChangedSurfaces(
    evaluation.experiment.baseline,
    evaluation.experiment.candidate,
  )
  if (!sameOrderedValues(proposal.changedSurfaces, changedSurfaces)) {
    throw new Error('proposal changed surfaces do not match its exact experiment')
  }
  assertNoJudgeDerivedProposalFindings(proposal.findings)
  return proposal
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
    activation.candidateBundleDigest !== experiment.candidate.digest ||
    Date.parse(review.reviewedAt) < Date.parse(proposal.proposedAt) ||
    Date.parse(activation.authorizedAt) < Date.parse(review.reviewedAt)
  ) {
    throw new Error('candidate activation does not bind the measured and approved candidate')
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

function assertNoJudgeDerivedProposalFindings(
  findings: AgentImprovementProposal['findings'],
): void {
  const leaked = findings.filter((finding) => finding.derived_from_judge === true)
  if (leaked.length === 0) return
  const identifiers = leaked.map((finding) =>
    typeof finding.finding_id === 'string' ? finding.finding_id : '<unknown>',
  )
  throw new Error(
    'agent improvement proposal findings: judge-derived findings cannot steer an improvement: ' +
      `[${identifiers.join(', ')}]`,
  )
}
