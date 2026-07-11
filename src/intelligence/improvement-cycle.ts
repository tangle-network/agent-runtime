import { type AnalystFinding, assertNoJudgeVerdict } from '@tangle-network/agent-eval/analyst'
import type { Scenario, SelfImproveResult } from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateBundle,
  AgentProfile,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import { agentCandidateBundleSchema } from '@tangle-network/agent-interface'
import { runAnalystLoop } from '../analyst-loop'
import type { RunAnalystLoopOpts, RunAnalystLoopResult } from '../analyst-loop/types'
import {
  type AgentCandidateBundleInput,
  sealAgentCandidateBundle,
} from '../candidate-execution/bundle'
import {
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  immutableCandidateValue,
  omitTopLevelDigest,
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
  parseExactAgentProfile,
} from '../candidate-execution/profile'
import type {
  AgentCandidateExecutionPorts,
  AgentCandidateRunFinalization,
  AgentCandidateTaskExecution,
} from '../candidate-execution/types'
import { verifyAgentCandidateBundle } from '../candidate-execution/verify'
import {
  type ImproveOptions,
  type ImproveResult,
  type ImproveSurface,
  improve,
} from '../improvement/improve'

export type AgentImprovementEvaluation<TScenario extends Scenario, TArtifact> = Pick<
  SelfImproveResult<TScenario, TArtifact>,
  | 'baseline'
  | 'winner'
  | 'lift'
  | 'diff'
  | 'provenance'
  | 'gateDecision'
  | 'generationsExplored'
  | 'durationMs'
  | 'totalCostUsd'
  | 'insight'
  | 'power'
>

export interface AgentImprovementProposal<
  TScenario extends Scenario = Scenario,
  TArtifact = unknown,
> {
  schemaVersion: 1
  kind: 'agent-improvement-proposal'
  runId: string
  surface: ImproveSurface
  proposedAt: string
  baselineProfileHash: string
  candidateProfile: AgentProfile
  candidateProfileHash: string
  findings: AnalystFinding[]
  evaluation: AgentImprovementEvaluation<TScenario, TArtifact>
  candidateBundle?: AgentCandidateBundle
  digest: Sha256Digest
}

export type AgentImprovementReviewDecision = 'approve' | 'reject' | 'request-changes'

export interface AgentImprovementReview {
  schemaVersion: 1
  kind: 'agent-improvement-review'
  proposalDigest: Sha256Digest
  candidateBundleDigest?: Sha256Digest
  decision: AgentImprovementReviewDecision
  reviewedBy: string
  reviewedAt: string
  reason: string
  feedback?: string
  digest: Sha256Digest
}

export interface CandidateExecutionEvidence {
  proposalDigest: Sha256Digest
  reviewDigest: Sha256Digest
  bundleDigest: Sha256Digest
  executionId: string
  executionPlanDigest: Sha256Digest
  materializationReceiptDigest: Sha256Digest
  succeeded: boolean
  runReceiptDigest?: Sha256Digest
}

export interface ProposeAgentImprovementOptions<TScenario extends Scenario, TArtifact> {
  runId: string
  profile: AgentProfile
  analysis: Omit<RunAnalystLoopOpts, 'runId' | 'improvementAdapter' | 'autoApply'>
  improvement: ImproveOptions<TScenario, TArtifact>
  /**
   * Optional environment adapter that freezes an executable bundle after the
   * measured comparison recommends the candidate. Return the sealed output of
   * `buildAgentCandidateBundle` directly, or a low-level digest-free input.
   */
  buildCandidate?: (input: {
    analysis: RunAnalystLoopResult
    improvement: ImproveResult<TScenario, TArtifact>
  }) =>
    | AgentCandidateBundleInput
    | AgentCandidateBundle
    | Promise<AgentCandidateBundleInput | AgentCandidateBundle>
  now?: () => Date
}

export interface ProposeAgentImprovementResult<TScenario extends Scenario, TArtifact> {
  analysis: RunAnalystLoopResult
  improvement: ImproveResult<TScenario, TArtifact>
  proposal: AgentImprovementProposal<TScenario, TArtifact>
}

export interface ReviewAgentImprovementInput {
  decision: AgentImprovementReviewDecision
  reviewedBy: string
  reason: string
  feedback?: string
  now?: () => Date
}

export interface ExecuteApprovedAgentCandidateOptions {
  proposal: AgentImprovementProposal
  review: AgentImprovementReview
  /** Product-owned authentication check for the persisted approval record. */
  authorizeReview: (
    review: AgentImprovementReview,
    proposal: AgentImprovementProposal,
  ) => boolean | Promise<boolean>
  task: AgentCandidateTaskExecution
  ports: AgentCandidateExecutionPorts
  preparation?: PrepareAgentCandidateExecutionOptions
  execution: ExecutePreparedAgentCandidateOptions
}

export interface ExecuteApprovedAgentCandidateResult {
  finalization: AgentCandidateRunFinalization
  evidence: CandidateExecutionEvidence
}

/** Analyze one run and produce one measured, review-only improvement proposal. */
export async function proposeAgentImprovement<TScenario extends Scenario, TArtifact>(
  options: ProposeAgentImprovementOptions<TScenario, TArtifact>,
): Promise<ProposeAgentImprovementResult<TScenario, TArtifact>> {
  const writeBackSurface = options.improvement.skills?.writeBack
    ? 'skill'
    : options.improvement.memory?.writeBack
      ? 'memory'
      : null
  if (writeBackSurface) {
    throw new Error(
      `proposeAgentImprovement cannot write ${writeBackSurface} before human approval`,
    )
  }
  const analysis = await runAnalystLoop({
    ...options.analysis,
    runId: options.runId,
  })
  const findings = assertNoJudgeVerdict(
    analysis.analystResult.findings,
    'proposeAgentImprovement findings',
  )
  const improvement = await improve(options.profile, [...findings], options.improvement)
  const candidateBundle =
    improvement.shipped && options.buildCandidate
      ? sealBuiltCandidate(await options.buildCandidate({ analysis, improvement }))
      : undefined
  if (candidateBundle) assertCandidateProfileBinding(improvement.profile, candidateBundle.profile)
  const surface = options.improvement.surface ?? 'prompt'
  const evaluation = canonicalJsonValue(improvementEvaluation(improvement.raw))
  const proposalFindings = canonicalJsonValue([...findings])
  const withoutDigest = {
    schemaVersion: 1 as const,
    kind: 'agent-improvement-proposal' as const,
    runId: options.runId,
    surface,
    proposedAt: (options.now ?? (() => new Date()))().toISOString(),
    baselineProfileHash: canonicalCandidateDigest(options.profile),
    candidateProfile: improvement.profile,
    candidateProfileHash: canonicalCandidateDigest(improvement.profile),
    findings: proposalFindings,
    evaluation,
    ...(candidateBundle ? { candidateBundle } : {}),
  }
  const proposal =
    canonicalCandidateDocument<AgentImprovementProposal<TScenario, TArtifact>>(withoutDigest).value
  return { analysis, improvement, proposal }
}

/** Persist an approve/reject/change-request decision bound to one exact proposal. */
export function reviewAgentImprovementProposal(
  inputProposal: AgentImprovementProposal,
  input: ReviewAgentImprovementInput,
): AgentImprovementReview {
  const proposal = verifyAgentImprovementProposal(inputProposal)
  if (!input.reviewedBy.trim()) throw new Error('candidate review requires reviewedBy')
  if (!input.reason.trim()) throw new Error('candidate review requires a reason')
  if (input.decision === 'approve') {
    if (proposal.evaluation.gateDecision !== 'ship') {
      throw new Error('candidate cannot be approved without a passing measured comparison')
    }
    if (!proposal.candidateBundle) {
      throw new Error('candidate cannot be approved until an executable bundle is sealed')
    }
  }
  const withoutDigest = {
    schemaVersion: 1 as const,
    kind: 'agent-improvement-review' as const,
    proposalDigest: proposal.digest,
    ...(proposal.candidateBundle ? { candidateBundleDigest: proposal.candidateBundle.digest } : {}),
    decision: input.decision,
    reviewedBy: input.reviewedBy,
    reviewedAt: (input.now ?? (() => new Date()))().toISOString(),
    reason: input.reason,
    ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
  }
  return canonicalCandidateDocument<AgentImprovementReview>(withoutDigest).value
}

/** Verify, materialize, run, grade, and receipt only the exact approved bundle. */
export async function executeApprovedAgentCandidate(
  options: ExecuteApprovedAgentCandidateOptions,
): Promise<ExecuteApprovedAgentCandidateResult> {
  const proposal = verifyAgentImprovementProposal(options.proposal)
  const review = verifyAgentImprovementReview(options.review)
  if (review.decision !== 'approve') throw new Error('candidate review is not an approval')
  if (review.proposalDigest !== proposal.digest) {
    throw new Error('candidate approval does not match the proposed improvement')
  }
  const bundle = proposal.candidateBundle
  if (!bundle) throw new Error('approved proposal does not contain an executable candidate bundle')
  if (review.candidateBundleDigest !== bundle.digest) {
    throw new Error('candidate approval does not match the executable bundle')
  }
  if (!(await options.authorizeReview(review, proposal))) {
    throw new Error('candidate approval was not authorized by the configured authority')
  }

  const verified = await verifyAgentCandidateBundle(bundle, options.ports)
  const prepared = await prepareAgentCandidateExecution(
    verified,
    options.task,
    options.ports,
    options.preparation,
  )
  const finalization = await executePreparedAgentCandidate(prepared, options.execution)
  return {
    finalization,
    evidence: {
      proposalDigest: proposal.digest,
      reviewDigest: review.digest,
      bundleDigest: bundle.digest,
      executionId: prepared.executionId,
      executionPlanDigest: prepared.executionPlan.value.digest,
      materializationReceiptDigest: prepared.materializationReceipt.digest,
      succeeded: finalization.succeeded,
      ...(finalization.succeeded ? { runReceiptDigest: finalization.receipt.digest } : {}),
    },
  }
}

/** Validate a proposal's schema, profile, sealed bundle, and canonical digest. */
export function verifyAgentImprovementProposal(input: unknown): AgentImprovementProposal {
  if (
    !isRecord(input) ||
    input.kind !== 'agent-improvement-proposal' ||
    input.schemaVersion !== 1
  ) {
    throw new Error('invalid agent improvement proposal')
  }
  const proposal = input as unknown as AgentImprovementProposal
  const parsedProfile = parseExactAgentProfile(
    proposal.candidateProfile,
    'proposal candidate profile',
  )
  if (proposal.candidateProfileHash !== canonicalCandidateDigest(parsedProfile)) {
    throw new Error('proposal candidateProfileHash does not match candidateProfile')
  }
  if (!Array.isArray(proposal.findings)) throw new Error('proposal findings must be an array')
  if (!isSha256Digest(proposal.digest)) throw new Error('proposal digest is invalid')
  if (proposal.candidateBundle) {
    const parsedBundle = agentCandidateBundleSchema.parse(proposal.candidateBundle)
    const sealed = sealAgentCandidateBundle(omitTopLevelDigest(parsedBundle))
    if (sealed.digest !== parsedBundle.digest)
      throw new Error('proposal candidate bundle digest is invalid')
    assertCandidateProfileBinding(parsedProfile, sealed.profile)
  }
  const actual = canonicalCandidateDigest(omitTopLevelDigest(proposal))
  if (actual !== proposal.digest)
    throw new Error('agent improvement proposal digest does not match')
  return immutableCandidateValue(proposal)
}

function sealBuiltCandidate(
  input: AgentCandidateBundleInput | AgentCandidateBundle,
): AgentCandidateBundle {
  if (!('digest' in input)) return sealAgentCandidateBundle(input)
  const parsed = agentCandidateBundleSchema.parse(input)
  const sealed = sealAgentCandidateBundle(omitTopLevelDigest(parsed))
  if (sealed.digest !== parsed.digest) {
    throw new Error('built candidate bundle digest is invalid')
  }
  return sealed
}

/** Validate a review's decision fields and canonical digest. */
export function verifyAgentImprovementReview(input: unknown): AgentImprovementReview {
  if (!isRecord(input) || input.kind !== 'agent-improvement-review' || input.schemaVersion !== 1) {
    throw new Error('invalid agent improvement review')
  }
  const review = input as unknown as AgentImprovementReview
  if (!isSha256Digest(review.digest) || !isSha256Digest(review.proposalDigest)) {
    throw new Error('candidate review digest is invalid')
  }
  if (review.candidateBundleDigest !== undefined && !isSha256Digest(review.candidateBundleDigest)) {
    throw new Error('candidate review bundle digest is invalid')
  }
  if (!['approve', 'reject', 'request-changes'].includes(review.decision)) {
    throw new Error('candidate review decision is invalid')
  }
  const actual = canonicalCandidateDigest(omitTopLevelDigest(review))
  if (actual !== review.digest) throw new Error('agent improvement review digest does not match')
  return immutableCandidateValue(review)
}

function improvementEvaluation<TScenario extends Scenario, TArtifact>(
  result: SelfImproveResult<TScenario, TArtifact>,
): AgentImprovementEvaluation<TScenario, TArtifact> {
  return {
    baseline: result.baseline,
    winner: result.winner,
    lift: result.lift,
    diff: result.diff,
    provenance: result.provenance,
    gateDecision: result.gateDecision,
    generationsExplored: result.generationsExplored,
    durationMs: result.durationMs,
    totalCostUsd: result.totalCostUsd,
    insight: result.insight,
    ...(result.power === undefined ? {} : { power: result.power }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
}

function canonicalJsonValue<T>(value: T, path = '$'): T {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${path}`)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (entry === undefined) throw new Error(`undefined array entry at ${path}[${index}]`)
      return canonicalJsonValue(entry, `${path}[${index}]`)
    }) as T
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, canonicalJsonValue(entry, `${path}.${key}`)])
    return Object.fromEntries(entries) as T
  }
  throw new Error(`unsupported proposal value at ${path}`)
}
