import { type PairedArmRow, pairArms } from '@tangle-network/agent-eval'
import { type AnalystFinding, assertNoJudgeVerdict } from '@tangle-network/agent-eval/analyst'
import {
  assertCodeSurfaceIdentity,
  codeSurfaceIdentityMaterial,
} from '@tangle-network/agent-eval/campaign'
import type { CodeSurface, Scenario, SelfImproveResult } from '@tangle-network/agent-eval/contract'
import { pairedBootstrap } from '@tangle-network/agent-eval/reporting'
import type {
  AgentCandidateBundle,
  AgentImprovementMeasuredComparison,
  AgentImprovementProposal,
  AgentImprovementReview,
  AgentImprovementReviewDecision,
  AgentImprovementSurface,
  AgentProfile,
  CandidateExecutionEvidence,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  agentCandidateBundleSchema,
  agentCandidateMaterializationReceiptSchema,
  agentCandidateRunReceiptSchema,
  agentImprovementMeasuredComparisonSchema,
  agentImprovementProposalSchema,
  agentImprovementReviewSchema,
  candidateExecutionEvidenceSchema,
} from '@tangle-network/agent-interface'
import { materializeCandidateProfile } from '@tangle-network/agent-profile-materialize'
import { runAnalystLoop } from '../analyst-loop'
import type { RunAnalystLoopOpts, RunAnalystLoopResult } from '../analyst-loop/types'
import {
  type AgentCandidateBundleInput,
  sealAgentCandidateBundle,
} from '../candidate-execution/bundle'
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
  agentCandidateProfileAsAgentProfile,
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
  applyImprovementWinnerToProfile,
  type ImproveOptions,
  type ImproveResult,
  type ImproveSurface,
  improve,
} from '../improvement/improve'

export type {
  AgentImprovementMeasuredComparison,
  AgentImprovementProposal,
  AgentImprovementReview,
  AgentImprovementReviewDecision,
  CandidateExecutionEvidence,
} from '@tangle-network/agent-interface'

export interface ProposeAgentImprovementOptions<TScenario extends Scenario, TArtifact> {
  runId: string
  profile: AgentProfile
  analysis: Omit<RunAnalystLoopOpts, 'runId' | 'improvementAdapter' | 'autoApply'>
  improvement: ImproveOptions<TScenario, TArtifact>
  /** Freezes the measured winner into the exact bundle reviewed for execution. */
  buildCandidate: (input: {
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
  proposal: AgentImprovementProposal
}

export interface CreateAgentImprovementProposalOptions {
  runId: string
  baselineProfile: AgentProfile
  findings: readonly AnalystFinding[]
  evaluation: AgentImprovementMeasuredComparison
  candidateBundle: AgentCandidateBundleInput | AgentCandidateBundle
  now?: () => Date
}

export interface CreateAgentImprovementMeasuredComparisonOptions<
  TScenario extends Scenario,
  TArtifact,
> {
  result: SelfImproveResult<TScenario, TArtifact>
  measuredSurface: ImproveSurface
  baselineProfile: AgentProfile
  candidateBundle: AgentCandidateBundle
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

export type ExecuteApprovedAgentCandidateResult =
  | {
      finalization: Extract<AgentCandidateRunFinalization, { succeeded: false }>
      evidence?: never
    }
  | {
      finalization: Extract<AgentCandidateRunFinalization, { succeeded: true }>
      evidence: CandidateExecutionEvidence
    }

export interface VerifyCandidateExecutionEvidenceOptions {
  proposal: AgentImprovementProposal
  review: AgentImprovementReview
  expectedCount: number
  resolvedResources?: ReadonlyMap<Sha256Digest, string>
}

/** Analyze one run and freeze its measured winner into one exact proposal. */
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
  const analysis = await runAnalystLoop(
    Object.assign({}, options.analysis, { runId: options.runId }),
  )
  const findings = assertNoJudgeVerdict(
    analysis.analystResult.findings,
    'proposeAgentImprovement findings',
  )
  const improvement = await improve(options.profile, [...findings], options.improvement)
  try {
    if (!improvement.shipped) {
      throw new Error('agent improvement proposal requires a passing measured comparison')
    }
    const candidateBundle = sealBuiltCandidate(
      await options.buildCandidate({ analysis, improvement }),
    )
    const proposal = createAgentImprovementProposal({
      runId: options.runId,
      baselineProfile: options.profile,
      findings,
      evaluation: createAgentImprovementMeasuredComparison({
        result: improvement.raw,
        measuredSurface: options.improvement.surface ?? 'prompt',
        baselineProfile: options.profile,
        candidateBundle,
      }),
      candidateBundle,
      ...(options.now ? { now: options.now } : {}),
    })
    return { analysis, improvement, proposal }
  } catch (cause) {
    return rethrowAfterCleanup(cause, () => improvement.dispose(), 'proposeAgentImprovement failed')
  }
}

/**
 * Freeze an already-measured improvement into the one reviewable proposal
 * contract. Products that run analysis or evaluation in separate workers use
 * this constructor instead of rerunning either phase or rebuilding digests.
 */
export function createAgentImprovementProposal(
  options: CreateAgentImprovementProposalOptions,
): AgentImprovementProposal {
  const findings = assertNoJudgeVerdict(
    [...options.findings],
    'createAgentImprovementProposal findings',
  )
  const candidateBundle = sealBuiltCandidate(options.candidateBundle)
  const baselineProfile = parseExactAgentProfile(
    options.baselineProfile,
    'proposal baseline profile',
  )
  const candidateProfile = agentCandidateProfileAsAgentProfile(candidateBundle.profile)
  const evaluation = agentImprovementMeasuredComparisonSchema.parse(options.evaluation)
  if (evaluation.decision.outcome !== 'ship') {
    throw new Error('agent improvement proposal requires a passing measured comparison')
  }
  assertSupportedCandidateBundle(candidateBundle)
  assertMeasuredCandidateBinding(evaluation, baselineProfile, candidateBundle)
  const changedSurfaces = deriveChangedSurfaces(baselineProfile, candidateProfile, candidateBundle)
  const withoutDigest = {
    kind: 'agent-improvement-proposal' as const,
    runId: options.runId,
    changedSurfaces,
    proposedAt: (options.now ?? (() => new Date()))().toISOString(),
    baselineProfile,
    findings: immutableCandidateValue([
      ...findings,
    ]) as unknown as AgentImprovementProposal['findings'],
    evaluation,
    candidateBundle,
  }
  return agentImprovementProposalSchema.parse(
    canonicalCandidateDocument<AgentImprovementProposal>(withoutDigest).value,
  )
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
    if (proposal.evaluation.decision.outcome !== 'ship') {
      throw new Error('candidate cannot be approved without a passing measured comparison')
    }
  }
  const withoutDigest = {
    kind: 'agent-improvement-review' as const,
    proposalDigest: proposal.digest,
    candidateBundleDigest: proposal.candidateBundle.digest,
    decision: input.decision,
    reviewedBy: input.reviewedBy,
    reviewedAt: (input.now ?? (() => new Date()))().toISOString(),
    reason: input.reason,
    ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
  }
  return agentImprovementReviewSchema.parse(
    canonicalCandidateDocument<AgentImprovementReview>(withoutDigest).value,
  )
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
  if (!finalization.succeeded) return { finalization }
  const evidence = canonicalCandidateDocument<CandidateExecutionEvidence>({
    kind: 'agent-candidate-execution-evidence',
    proposalDigest: proposal.digest,
    reviewDigest: review.digest,
    executionId: prepared.executionId,
    succeeded: true,
    materializationReceipt: prepared.materializationReceipt.value,
    profileActivation: prepared.profileActivation,
    receipt: finalization.receipt.value,
  }).value
  const verifiedEvidence = verifyCandidateExecutionEvidence([evidence], {
    proposal,
    review,
    expectedCount: 1,
    resolvedResources: verifiedResourceTextByDigest(verified),
  })[0]!
  return {
    finalization,
    evidence: verifiedEvidence,
  }
}

/** Verify approval, receipts, uniqueness, and the exact native profile files executed. */
export function verifyCandidateExecutionEvidence(
  input: unknown,
  options: VerifyCandidateExecutionEvidenceOptions,
): CandidateExecutionEvidence[] {
  const proposal = verifyAgentImprovementProposal(options.proposal)
  const review = verifyAgentImprovementReview(options.review)
  if (review.decision !== 'approve') throw new Error('candidate review is not an approval')
  if (
    review.proposalDigest !== proposal.digest ||
    review.candidateBundleDigest !== proposal.candidateBundle.digest
  ) {
    throw new Error('candidate review does not bind the proposed bundle')
  }
  if (!Number.isSafeInteger(options.expectedCount) || options.expectedCount < 1) {
    throw new Error('candidate execution evidence expectedCount must be a positive integer')
  }
  if (!Array.isArray(input) || input.length !== options.expectedCount) {
    throw new Error(
      `candidate execution evidence must contain exactly ${options.expectedCount} rows`,
    )
  }
  const executionIds = new Set<string>()
  const runReceiptDigests = new Set<Sha256Digest>()
  const verified = input.map((entry) => {
    const evidence = verifyCanonicalCandidateDocument(
      candidateExecutionEvidenceSchema.parse(entry),
      'candidate execution evidence',
    )
    const receipt = verifyCanonicalCandidateDocument(
      agentCandidateRunReceiptSchema.parse(evidence.receipt),
      'candidate execution run receipt',
    )
    const materializationReceipt = verifyCanonicalCandidateDocument(
      agentCandidateMaterializationReceiptSchema.parse(evidence.materializationReceipt),
      'candidate materialization receipt',
    )
    assertEvidenceMaterialDigest(materializationReceipt.profilePlan, 'candidate profile plan')
    const profilePlan = materializeCandidateProfile(
      proposal.candidateBundle.profile,
      candidateMaterializerHarness(materializationReceipt.harness),
      { resolvedResources: options.resolvedResources },
    )
    const profileActivation = parseAgentCandidateProfileActivation(
      evidence.profileActivation,
      materializationReceipt.profilePlan.digest,
    )
    const regenerated = createAgentCandidateProfileActivation(
      profilePlan,
      materializationReceipt.profilePlan,
    )
    if (regenerated.digest !== profileActivation.digest) {
      throw new Error('candidate profile plan files do not match the executed materialization')
    }
    assertEvidenceMaterialDigest(materializationReceipt.executionPlan, 'candidate execution plan')
    assertEvidenceMaterialDigest(receipt.modelSettlement, 'candidate model settlement')
    assertEvidenceMaterialDigest(receipt.taskOutcome, 'candidate task outcome')
    assertEvidenceMaterialDigest(receipt.benchmarkResult, 'candidate benchmark result')
    if (
      evidence.proposalDigest !== proposal.digest ||
      evidence.reviewDigest !== review.digest ||
      receipt.bundleDigest !== proposal.candidateBundle.digest ||
      materializationReceipt.bundleDigest !== proposal.candidateBundle.digest ||
      receipt.materializationReceiptDigest !== materializationReceipt.digest ||
      receipt.executionPlanDigest !== materializationReceipt.executionPlan.digest ||
      evidence.executionId !== materializationReceipt.executionPlan.material.executionId
    ) {
      throw new Error('candidate execution evidence does not bind the approved candidate')
    }
    if (receipt.termination.kind !== 'exit' || receipt.termination.exitCode !== 0) {
      throw new Error('candidate execution evidence is not a successful process execution')
    }
    if (executionIds.has(evidence.executionId)) {
      throw new Error('candidate execution evidence reuses an execution id')
    }
    if (runReceiptDigests.has(receipt.digest)) {
      throw new Error('candidate execution evidence reuses a run receipt')
    }
    executionIds.add(evidence.executionId)
    runReceiptDigests.add(receipt.digest)
    return immutableCandidateValue(evidence)
  })
  return verified
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

/** Validate a proposal's schema, profile, sealed bundle, and canonical digest. */
export function verifyAgentImprovementProposal(input: unknown): AgentImprovementProposal {
  const proposal = agentImprovementProposalSchema.parse(input)
  const parsedBaselineProfile = parseExactAgentProfile(
    proposal.baselineProfile,
    'proposal baseline profile',
  )
  const parsedBundle = agentCandidateBundleSchema.parse(proposal.candidateBundle)
  const candidateBundle = sealAgentCandidateBundle(omitTopLevelDigest(parsedBundle))
  if (candidateBundle.digest !== parsedBundle.digest)
    throw new Error('proposal candidate bundle digest is invalid')
  const candidateProfile = agentCandidateProfileAsAgentProfile(candidateBundle.profile)
  if (proposal.evaluation.decision.outcome !== 'ship') {
    throw new Error('agent improvement proposal requires a passing measured comparison')
  }
  assertSupportedCandidateBundle(candidateBundle)
  assertMeasuredCandidateBinding(proposal.evaluation, parsedBaselineProfile, candidateBundle)
  const changedSurfaces = deriveChangedSurfaces(
    parsedBaselineProfile,
    candidateProfile,
    candidateBundle,
  )
  if (!sameOrderedValues(proposal.changedSurfaces, changedSurfaces)) {
    throw new Error(
      'proposal changed surfaces do not match the exact baseline and candidate bundle',
    )
  }
  return verifyCanonicalCandidateDocument(proposal, 'agent improvement proposal')
}

function assertMeasuredCandidateBinding(
  evaluation: AgentImprovementMeasuredComparison,
  baselineProfile: AgentProfile,
  candidateBundle: AgentCandidateBundle,
): void {
  if (evaluation.baselineProfileDigest !== canonicalCandidateDigest(baselineProfile)) {
    throw new Error('measured comparison does not bind the included baseline profile')
  }
  if (evaluation.candidateBundleDigest !== candidateBundle.digest) {
    throw new Error('measured comparison does not bind the exact candidate bundle')
  }
}

function assertRawMeasuredWinnerBinding(input: {
  surface: ImproveSurface
  baselineProfile: AgentProfile
  winner: unknown
  candidateBundle: AgentCandidateBundle
}): void {
  const candidateProfile = agentCandidateProfileAsAgentProfile(input.candidateBundle.profile)
  const baselineDigest = canonicalCandidateDigest(input.baselineProfile)
  if (input.surface === 'code') {
    if (canonicalCandidateDigest(candidateProfile) !== baselineDigest) {
      throw new Error('code improvement must retain the measured profile')
    }
    assertMeasuredCodeBundle(input.winner, input.candidateBundle)
  } else if (input.surface === 'memory') {
    throw new Error(
      'memory improvement proposals require a content-addressed bundle binding, which is unsupported',
    )
  } else {
    const measured = measuredWinnerProfile(input.baselineProfile, input.surface, input.winner)
    if (!measured) {
      throw new Error(
        'skill-document improvement proposals require a content-addressed bundle binding, which is unsupported',
      )
    }
    if (canonicalCandidateDigest(candidateProfile) !== canonicalCandidateDigest(measured)) {
      throw new Error('proposal candidate profile does not match the measured winner surface')
    }
  }

  const changedSurfaces = deriveChangedSurfaces(
    input.baselineProfile,
    candidateProfile,
    input.candidateBundle,
  )
  if (input.surface === 'agent-profile') {
    if (changedSurfaces.includes('code') || changedSurfaces.includes('knowledge')) {
      throw new Error('agent-profile measurement does not cover code or knowledge bundle changes')
    }
  } else if (changedSurfaces.length !== 1 || changedSurfaces[0] !== input.surface) {
    throw new Error(
      `measured '${input.surface}' winner does not cover candidate changes: ${changedSurfaces.join(', ')}`,
    )
  }
}

function assertSupportedCandidateBundle(candidateBundle: AgentCandidateBundle): void {
  if (candidateBundle.memory.mode !== 'disabled') {
    throw new Error(
      'memory improvement proposals require a content-addressed policy binding, which is unsupported',
    )
  }
}

const CHANGED_SURFACE_ORDER: readonly AgentImprovementSurface[] = [
  'prompt',
  'skills',
  'tools',
  'mcp',
  'hooks',
  'subagents',
  'agent-profile',
  'memory',
  'code',
  'knowledge',
]

function deriveChangedSurfaces(
  baseline: AgentProfile,
  candidate: AgentProfile,
  bundle: AgentCandidateBundle,
): [AgentImprovementSurface, ...AgentImprovementSurface[]] {
  const changed = new Set<AgentImprovementSurface>()
  const pairs: Array<[AgentImprovementSurface, unknown, unknown]> = [
    [
      'prompt',
      { prompt: baseline.prompt ?? null, instructions: baseline.resources?.instructions ?? null },
      { prompt: candidate.prompt ?? null, instructions: candidate.resources?.instructions ?? null },
    ],
    ['skills', baseline.resources?.skills ?? null, candidate.resources?.skills ?? null],
    [
      'tools',
      { tools: baseline.tools ?? null, resources: baseline.resources?.tools ?? null },
      { tools: candidate.tools ?? null, resources: candidate.resources?.tools ?? null },
    ],
    ['mcp', baseline.mcp ?? null, candidate.mcp ?? null],
    ['hooks', baseline.hooks ?? null, candidate.hooks ?? null],
    [
      'subagents',
      { subagents: baseline.subagents ?? null, resources: baseline.resources?.agents ?? null },
      { subagents: candidate.subagents ?? null, resources: candidate.resources?.agents ?? null },
    ],
    ['agent-profile', opaqueProfileSlice(baseline), opaqueProfileSlice(candidate)],
  ]
  for (const [surface, before, after] of pairs) {
    if (!sameCanonicalValue(before, after)) changed.add(surface)
  }
  if (bundle.memory.mode !== 'disabled') changed.add('memory')
  if (bundle.code.kind !== 'disabled') changed.add('code')
  if (bundle.knowledge) changed.add('knowledge')
  const ordered = CHANGED_SURFACE_ORDER.filter((surface) => changed.has(surface))
  if (ordered.length === 0) {
    throw new Error('candidate bundle does not contain a change from the included baseline profile')
  }
  return ordered as [AgentImprovementSurface, ...AgentImprovementSurface[]]
}

function opaqueProfileSlice(profile: AgentProfile): unknown {
  const {
    prompt: _prompt,
    tools: _tools,
    mcp: _mcp,
    hooks: _hooks,
    subagents: _subagents,
    resources,
    ...opaqueProfile
  } = profile
  const {
    instructions: _instructions,
    skills: _skills,
    tools: _resourceTools,
    agents: _agents,
    ...opaqueResources
  } = resources ?? {}
  return immutableCandidateValue({
    ...opaqueProfile,
    ...(Object.keys(opaqueResources).length > 0 ? { resources: opaqueResources } : {}),
  })
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalCandidateDigest(left) === canonicalCandidateDigest(right)
}

function sameOrderedValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function measuredWinnerProfile(
  baselineProfile: AgentProfile,
  surface: ImproveSurface,
  winner: unknown,
): AgentProfile | null {
  if (typeof winner !== 'string') {
    throw new Error(`measured '${surface}' winner is not a serializable profile surface`)
  }
  if (surface !== 'skills') {
    return applyImprovementWinnerToProfile(baselineProfile, surface, winner)
  }
  try {
    return applyImprovementWinnerToProfile(baselineProfile, surface, winner)
  } catch {
    // A skill document is text stored outside the profile; a skill-ref array is
    // JSON stored on the profile. Only the latter can bind to a profile bundle.
    return null
  }
}

function assertMeasuredCodeBundle(winner: unknown, candidateBundle: AgentCandidateBundle): void {
  assertCodeSurfaceIdentity(winner)
  if (candidateBundle.code.kind !== 'git-patch') {
    throw new Error('code improvement bundle must contain the measured git patch')
  }
  const bundledSurface: CodeSurface = {
    ...winner,
    baseCommit: candidateBundle.code.baseCommit,
    baseTree: candidateBundle.code.baseTree,
    candidateTree: candidateBundle.code.candidateTree,
    patch: {
      format: candidateBundle.code.patch.format,
      sha256: candidateBundle.code.patch.artifact.sha256,
      byteLength: candidateBundle.code.patch.artifact.byteLength,
    },
  }
  assertCodeSurfaceIdentity(bundledSurface)
  if (codeSurfaceIdentityMaterial(winner) !== codeSurfaceIdentityMaterial(bundledSurface)) {
    throw new Error('proposal candidate bundle does not match the measured code winner')
  }
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
  const review = agentImprovementReviewSchema.parse(input)
  return verifyCanonicalCandidateDocument(review, 'agent improvement review')
}

/** Convert agent-eval's paired result into the portable Interface comparison. */
export function createAgentImprovementMeasuredComparison<TScenario extends Scenario, TArtifact>(
  options: CreateAgentImprovementMeasuredComparisonOptions<TScenario, TArtifact>,
): AgentImprovementMeasuredComparison {
  const { result } = options
  const baselineProfile = parseExactAgentProfile(
    options.baselineProfile,
    'measured baseline profile',
  )
  const candidateBundle = sealBuiltCandidate(options.candidateBundle)
  assertSupportedCandidateBundle(candidateBundle)
  assertRawMeasuredWinnerBinding({
    surface: options.measuredSurface,
    baselineProfile,
    winner: result.winner.surface,
    candidateBundle,
  })
  const benchmark = candidateBundle.lineage.benchmark
  if (!benchmark) {
    throw new Error('agent improvement proposal requires a benchmark and heldout split identity')
  }
  const power = result.power
  if (!power) throw new Error('agent improvement proposal requires heldout power analysis')
  if (result.provenance.gate.reasons.length === 0) {
    throw new Error('agent improvement proposal requires measured decision reasons')
  }
  const pairs = pairMeasuredCells(
    result.raw.baselineOnHoldout.cells,
    result.raw.winnerOnHoldout.cells,
  )
  const composite = measuredObjective(
    {
      kind: 'objective',
      name: 'composite',
      direction: 'higher-is-better',
      unit: 'score',
    },
    pairs,
    measuredComposite,
  )
  assertMeasuredNumber(result.lift, composite.delta, 'heldout lift')
  assertMeasuredNumber(result.baseline.compositeMean, composite.baseline, 'heldout baseline')
  assertMeasuredNumber(result.winner.compositeMean, composite.candidate, 'heldout candidate')
  assertMeasuredNumber(result.provenance.heldOutLift, composite.delta, 'provenance heldout lift')
  if (
    result.gateDecision !== result.provenance.gate.decision ||
    power.n !== composite.n ||
    power.confidence !== 0.95
  ) {
    throw new Error('agent improvement measurement sources do not agree')
  }

  const comparison = immutableCandidateValue({
    kind: 'agent-improvement-measured-comparison' as const,
    benchmark,
    baselineProfileDigest: canonicalCandidateDigest(baselineProfile),
    candidateBundleDigest: candidateBundle.digest,
    overall: {
      name: 'composite' as const,
      baseline: composite.baseline,
      candidate: composite.candidate,
      delta: composite.delta,
      confidenceInterval: composite.confidenceInterval,
      n: composite.n,
      direction: 'higher-is-better' as const,
      unit: 'score' as const,
    },
    objectives: measuredObjectives(pairs),
    ...(result.winner.label || result.winner.rationale
      ? {
          candidate: {
            ...(result.winner.label ? { label: result.winner.label } : {}),
            ...(result.winner.rationale ? { rationale: result.winner.rationale } : {}),
          },
        }
      : {}),
    decision: {
      outcome: result.gateDecision,
      reasons: result.provenance.gate.reasons,
      contributingChecks: result.provenance.gate.contributingGates.map((check) => ({
        name: check.name,
        passed: check.passed,
      })),
    },
    power: {
      sufficient: power.scaleAssumed && !power.underpowered,
      n: power.n,
      minimumDetectableDelta: power.mde,
      confidenceLevel: power.confidence,
      scaleAssumed: power.scaleAssumed,
      sharedScorerChannel: power.sharedChannelCaveat !== undefined,
      reason: power.recommendation,
    },
    provenance: {
      kind: 'agent-eval-loop' as const,
      schema: result.provenance.schema,
      runId: result.provenance.runId,
      recordDigest: canonicalCandidateDigest(result.provenance),
      baselineContentHash: result.provenance.baselineContentHash,
      candidateContentHash: result.provenance.winnerContentHash,
    },
    diff: result.diff,
    evaluation: {
      generationsExplored: result.generationsExplored,
      durationMs: result.durationMs,
      totalCostUsd: result.totalCostUsd,
    },
  })
  return agentImprovementMeasuredComparisonSchema.parse(comparison)
}

interface MeasuredEvaluationCell {
  scenarioId: string
  rep: number
  judgeScores: Record<
    string,
    { composite: number; dimensions: Record<string, number>; failed?: true }
  >
  costUsd: number
  tokenUsage?: { input: number; output: number }
  durationMs: number
  error?: string
}

function measuredObjectives(
  pairs: ReadonlyArray<readonly [MeasuredEvaluationCell, MeasuredEvaluationCell]>,
): AgentImprovementMeasuredComparison['objectives'] {
  const qualityColumns = new Map<string, MeasuredQualityColumn>()
  for (const [baseline, candidate] of pairs) {
    for (const cell of [baseline, candidate]) {
      for (const [objective, score] of Object.entries(cell.judgeScores)) {
        if (score.failed) continue
        qualityColumns.set(`objective:${objective}`, {
          kind: 'objective',
          name: objective,
          direction: 'higher-is-better',
          unit: 'score',
        })
        for (const name of Object.keys(score.dimensions)) {
          qualityColumns.set(`dimension:${objective}:${name}`, {
            kind: 'dimension',
            objective,
            name,
            direction: 'higher-is-better',
            unit: 'score',
          })
        }
      }
    }
  }
  const objectives: AgentImprovementMeasuredComparison['objectives'] = [
    ...[...qualityColumns.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, column]) =>
        measuredObjective(column, pairs, (cell) => measuredQuality(cell, column)),
      ),
    measuredCostObjective(pairs),
    measuredObjective(
      {
        kind: 'latency',
        name: 'latency',
        direction: 'lower-is-better',
        unit: 'milliseconds',
      },
      pairs,
      (cell) => cell.durationMs,
    ),
  ]
  return objectives
}

function measuredCostObjective(
  pairs: ReadonlyArray<readonly [MeasuredEvaluationCell, MeasuredEvaluationCell]>,
): AgentImprovementMeasuredComparison['objectives'][number] {
  const cells = pairs.flat()
  for (const cell of cells) finiteMeasuredValue(cell.costUsd, 'cost:cost')
  const reported = cells.some(
    (cell) =>
      cell.costUsd !== 0 ||
      (cell.tokenUsage !== undefined && (cell.tokenUsage.input > 0 || cell.tokenUsage.output > 0)),
  )
  if (!reported) {
    return {
      kind: 'cost',
      name: 'cost',
      availability: 'unavailable',
      reason: 'heldout cells did not report model usage or cost',
      direction: 'lower-is-better',
      unit: 'usd',
    }
  }
  return measuredObjective(
    {
      kind: 'cost',
      name: 'cost',
      direction: 'lower-is-better',
      unit: 'usd',
    },
    pairs,
    (cell) => cell.costUsd,
  )
}

function measuredComposite(cell: MeasuredEvaluationCell): number {
  const values = Object.values(cell.judgeScores)
    .filter((score) => !score.failed)
    .map((score) => score.composite)
    .filter(Number.isFinite)
  if (values.length === 0) {
    throw new Error(`heldout cell ${measuredCellKey(cell)} has no successful composite score`)
  }
  return measuredMean(values)
}

function pairMeasuredCells(
  baselineCells: readonly MeasuredEvaluationCell[],
  candidateCells: readonly MeasuredEvaluationCell[],
): Array<readonly [MeasuredEvaluationCell, MeasuredEvaluationCell]> {
  type MeasuredArmRow = PairedArmRow & { cell: MeasuredEvaluationCell }
  const rows: MeasuredArmRow[] = [
    ...baselineCells
      .filter((cell) => !cell.error)
      .map((cell) => ({
        pairKey: cell.scenarioId,
        repKey: String(cell.rep),
        arm: 'baseline',
        cell,
      })),
    ...candidateCells
      .filter((cell) => !cell.error)
      .map((cell) => ({
        pairKey: cell.scenarioId,
        repKey: String(cell.rep),
        arm: 'candidate',
        cell,
      })),
  ]
  const paired = pairArms(rows, { baselineArm: 'baseline', treatmentArm: 'candidate' })
  if (
    paired.pairs.length === 0 ||
    paired.unpairedBaseline.length > 0 ||
    paired.unpairedTreatment.length > 0
  ) {
    throw new Error('measured objectives require the same non-empty paired heldout cells')
  }
  return paired.pairs.map(
    (pair) =>
      [(pair.baseline as MeasuredArmRow).cell, (pair.treatment as MeasuredArmRow).cell] as const,
  )
}

type MeasuredObjectiveIdentity =
  | {
      kind: 'objective'
      name: string
      direction: 'higher-is-better'
      unit: 'score'
    }
  | {
      kind: 'dimension'
      objective: string
      name: string
      direction: 'higher-is-better'
      unit: 'score'
    }
  | {
      kind: 'cost'
      name: 'cost'
      direction: 'lower-is-better'
      unit: 'usd'
    }
  | {
      kind: 'latency'
      name: 'latency'
      direction: 'lower-is-better'
      unit: 'milliseconds'
    }

type MeasuredQualityColumn = Extract<MeasuredObjectiveIdentity, { kind: 'objective' | 'dimension' }>

function measuredObjective(
  identity: MeasuredObjectiveIdentity,
  pairs: ReadonlyArray<readonly [MeasuredEvaluationCell, MeasuredEvaluationCell]>,
  value: (cell: MeasuredEvaluationCell) => number,
): Extract<AgentImprovementMeasuredComparison['objectives'][number], { availability: 'measured' }> {
  const key = measuredObjectiveKey(identity)
  const baseline = pairs.map(([cell]) => finiteMeasuredValue(value(cell), key))
  const candidate = pairs.map(([, cell]) => finiteMeasuredValue(value(cell), key))
  const interval = pairedBootstrap(baseline, candidate, {
    confidence: 0.95,
    resamples: 2_000,
    statistic: 'mean',
    seed: measuredSeed(key),
  })
  const baselineMean = measuredMean(baseline)
  const candidateMean = measuredMean(candidate)
  const estimate = {
    availability: 'measured',
    baseline: baselineMean,
    candidate: candidateMean,
    delta: candidateMean - baselineMean,
    confidenceInterval: {
      level: interval.confidence,
      lower: interval.low,
      upper: interval.high,
      method: 'paired-bootstrap',
      statistic: 'mean',
      resamples: interval.resamples,
    },
    n: interval.n,
  } as const
  return { ...identity, ...estimate }
}

function measuredQuality(cell: MeasuredEvaluationCell, column: MeasuredQualityColumn): number {
  const objective = column.kind === 'objective' ? column.name : column.objective
  const score = cell.judgeScores[objective]
  if (!score || score.failed) {
    throw new Error(
      `heldout cell ${measuredCellKey(cell)} is missing measured objective '${objective}'`,
    )
  }
  const value = column.kind === 'objective' ? score.composite : score.dimensions[column.name]
  if (value === undefined) {
    throw new Error(
      `heldout cell ${measuredCellKey(cell)} is missing '${objective}' dimension '${column.name}'`,
    )
  }
  return finiteMeasuredValue(value, measuredObjectiveKey(column))
}

function measuredObjectiveKey(identity: MeasuredObjectiveIdentity): string {
  return identity.kind === 'dimension'
    ? `${identity.kind}:${identity.objective}:${identity.name}`
    : `${identity.kind}:${identity.name}`
}

function measuredCellKey(cell: Pick<MeasuredEvaluationCell, 'scenarioId' | 'rep'>): string {
  return `${cell.scenarioId}:${cell.rep}`
}

function finiteMeasuredValue(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`measured objective '${name}' is not finite`)
  return value
}

function measuredMean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('measured objective has no paired values')
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function measuredSeed(value: string): number {
  let seed = 0x811c9dc5
  for (const byte of Buffer.from(value, 'utf8')) {
    seed = Math.imul(seed ^ byte, 0x01000193) >>> 0
  }
  return seed
}

function assertMeasuredNumber(actual: number, expected: number, name: string): void {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)) * 8
  if (
    !Number.isFinite(actual) ||
    !Number.isFinite(expected) ||
    Math.abs(actual - expected) > tolerance
  ) {
    throw new Error(`${name} does not agree across the measured comparison`)
  }
}
