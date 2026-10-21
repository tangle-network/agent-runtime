import { assertProposalFindings, type ProposalFinding } from '@tangle-network/agent-eval/analyst'
import {
  verifyAgentProfileImprovementExperimentComparison,
  verifyCandidateExperimentComparison,
} from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateBundle,
  AgentCandidateExperiment,
  AgentImprovementActivation,
  AgentImprovementActivationIntent,
  AgentImprovementActivationOutcome,
  AgentImprovementActivationResult,
  AgentImprovementActivationTarget,
  AgentImprovementEvaluation,
  AgentImprovementProposal,
  AgentImprovementReview,
  AgentImprovementReviewDecision,
  AgentImprovementSurface,
  AgentProfileImprovementChange,
  AgentProfileImprovementExecutionRef,
  AgentProfileImprovementExperiment,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  agentImprovementActivationResultSchema,
  agentImprovementActivationSchema,
  agentImprovementProposalSchema,
  agentImprovementReviewSchema,
  agentProfileImprovementExecutionRefSchema,
  agentProfileImprovementExperimentSchema,
} from '@tangle-network/agent-interface'

import {
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  immutableCandidateValue,
  verifyCanonicalCandidateDocument,
} from '../candidate-execution/digest'
import {
  type AgentImprovementActivationTargetIdentity,
  agentImprovementTargetDigest,
  agentImprovementTargetInput,
  agentProfileImprovementStateDigest,
  assertAgentImprovementActivationTargets,
  buildAgentImprovementActivationTargets,
  deriveChangedSurfaces,
  profileImprovementChangedSurfaces,
  sameAgentImprovementSurfaceSet,
} from './improvement-surfaces'
import { optimizationActivationReceiptFromMetadata } from './optimization-receipt'

export interface CreateAgentImprovementActivationResultOptions {
  completedAt: string
  outcome: AgentImprovementActivationOutcome
}

export interface AgentImprovementActivationTargetPlan extends AgentImprovementActivationTarget {
  desiredDigest: Sha256Digest
  /**
   * Exact measured input the product must apply to reach `desiredDigest`.
   * Transition surfaces such as code and knowledge are applied operations, so
   * their resulting state digest is not the digest of this input document.
   */
  desiredInput: unknown
}

export type AgentProfileImprovementActivationOperation =
  | {
      kind: 'apply-change'
      changes: AgentProfileImprovementChange
    }
  | {
      /** The product must load its own saved state at `desiredStateDigest`. */
      kind: 'restore-state'
    }

export interface AgentProfileImprovementActivationTargetPlan
  extends AgentImprovementActivationTarget {
  desiredDigest: Sha256Digest
  desiredInput: AgentProfileImprovementActivationOperation
}

export interface SealedCandidateActivationTransitionInput {
  kind: 'sealed-candidate'
  activation: AgentImprovementActivation
  candidateBundle: AgentCandidateBundle
  bundle: AgentCandidateBundle
  targets: [AgentImprovementActivationTargetPlan, ...AgentImprovementActivationTargetPlan[]]
  attemptedAt: string
  expired: boolean
}

/**
 * A measured profile change without raw profile bytes.
 * The product owns the private state lookup and atomic write.
 */
export interface ProfileImprovementActivationTransitionInput {
  kind: 'profile-improvement'
  activation: AgentImprovementActivation
  experiment: AgentProfileImprovementExperiment
  sourceStateDigest: Sha256Digest
  desiredStateDigest: Sha256Digest
  operation: AgentProfileImprovementActivationOperation
  targets: [
    AgentProfileImprovementActivationTargetPlan,
    ...AgentProfileImprovementActivationTargetPlan[],
  ]
  attemptedAt: string
  expired: boolean
}

export type AgentImprovementActivationTransitionInput =
  | SealedCandidateActivationTransitionInput
  | ProfileImprovementActivationTransitionInput

export interface AgentImprovementActivationResultStore {
  load(idempotencyKey: Sha256Digest): Promise<unknown | undefined>
  putIfAbsent(result: AgentImprovementActivationResult): Promise<unknown>
}

/**
 * Product-owned or Runtime-composed transition.
 *
 * Implementations resolve a stored result for `activation.digest`, compare
 * every target, and make the write durably idempotent. Co-located targets store
 * the all-or-none write with its result. Other targets throw when result
 * storage fails so a retry can reconcile it. Runtime never invokes this write
 * function after authorization expires.
 */
export type AgentImprovementActivationTransition = (
  input: AgentImprovementActivationTransitionInput,
) => Promise<unknown>

/**
 * Target-read-only check for a prior exact write.
 * It may persist recovered result metadata, but must not change an activation target.
 * Return undefined only when no target write can have committed.
 */
export type AgentImprovementActivationReconciliation = (
  input: AgentImprovementActivationTransitionInput,
) => Promise<unknown | undefined>

export interface ExecuteAgentImprovementActivationInput {
  proposal: AgentImprovementProposal
  review: AgentImprovementReview
  activation: AgentImprovementActivation
}

export interface ExecuteAgentImprovementActivationOptions {
  transition: AgentImprovementActivationTransition
  reconcile?: AgentImprovementActivationReconciliation
  now?: () => Date
}

/** Create the exact result a product stores in the same transaction as its target write. */
export function createAgentImprovementActivationResult(
  transition: AgentImprovementActivationTransitionInput,
  options: CreateAgentImprovementActivationResultOptions,
): AgentImprovementActivationResult {
  const activation = verifyCanonicalCandidateDocument(
    agentImprovementActivationSchema.parse(transition.activation),
    'agent improvement activation',
  )
  assertTransitionInput(activation, transition)
  const result = agentImprovementActivationResultSchema.parse(
    canonicalCandidateDocument<AgentImprovementActivationResult>({
      kind: 'agent-improvement-activation-result',
      idempotencyKey: activation.digest,
      attemptedAt: transition.attemptedAt,
      completedAt: options.completedAt,
      outcome: options.outcome,
    }).value,
  )
  assertResultAgainstActivation(activation, result)
  assertOutcomeDesiredState(
    activation,
    result,
    new Map(transition.targets.map((target) => [targetIdentity(target), target.desiredDigest])),
  )
  return immutableCandidateValue(result)
}

/**
 * Recompute one historical activation result against the exact measured proposal and authority.
 * The result records that attempt; it is not a query of the target's current state.
 */
export function verifyAgentImprovementActivationResult(input: {
  proposal: unknown
  review: unknown
  activation: unknown
  result: unknown
}): AgentImprovementActivationResult {
  const proposal = verifyAgentImprovementProposal(input.proposal)
  const activation = verifyAgentImprovementActivation(input)
  const result = verifyCanonicalCandidateDocument(
    agentImprovementActivationResultSchema.parse(input.result),
    'agent improvement activation result',
  )
  assertResultAgainstActivation(activation, result)
  assertResultDesiredState(proposal, activation, result)
  return result
}

/** Validate and execute one product-owned activation transition. */
export async function executeAgentImprovementActivation(
  input: ExecuteAgentImprovementActivationInput,
  options: ExecuteAgentImprovementActivationOptions,
): Promise<AgentImprovementActivationResult> {
  const proposal = verifyAgentImprovementProposal(input.proposal)
  const activation = verifyAgentImprovementActivation(input)
  const observedAt = (options.now ?? (() => new Date()))().toISOString()
  const attemptedAt =
    Date.parse(observedAt) < Date.parse(activation.authorizedAt)
      ? activation.authorizedAt
      : observedAt
  const expired = Date.parse(attemptedAt) >= Date.parse(activation.expiresAt)
  const transition = immutableCandidateValue<AgentImprovementActivationTransitionInput>(
    proposal.evaluation.kind === 'agent-improvement-measured-comparison'
      ? sealedCandidateTransition(proposal.evaluation.experiment, activation, attemptedAt, expired)
      : profileImprovementTransition(
          proposal.evaluation.experiment,
          activation,
          attemptedAt,
          expired,
        ),
  )

  if (transition.expired) {
    if (!options.reconcile) {
      return uncertainActivationResult(transition, 'RECONCILIATION_UNAVAILABLE')
    }
    let reconciled: unknown
    try {
      reconciled = await options.reconcile(transition)
    } catch {
      return uncertainActivationResult(transition, 'RECONCILIATION_THROW')
    }
    if (reconciled === undefined) {
      return createAgentImprovementActivationResult(transition, {
        completedAt: transition.attemptedAt,
        outcome: { status: 'expired' },
      })
    }
    try {
      return verifyAgentImprovementActivationResult({ ...input, result: reconciled })
    } catch {
      return uncertainActivationResult(transition, 'INVALID_RECONCILIATION')
    }
  }

  let rawResult: unknown
  try {
    rawResult = await options.transition(transition)
  } catch {
    return uncertainActivationResult(transition, 'TRANSITION_THROW')
  }
  try {
    return verifyAgentImprovementActivationResult({ ...input, result: rawResult })
  } catch {
    return uncertainActivationResult(transition, 'INVALID_RESULT')
  }
}

function sealedCandidateTransition(
  experiment: AgentCandidateExperiment,
  activation: AgentImprovementActivation,
  attemptedAt: string,
  expired: boolean,
): SealedCandidateActivationTransitionInput {
  const targetArm = activation.intent === 'activate-candidate' ? 'candidate' : 'baseline'
  return {
    kind: 'sealed-candidate',
    activation,
    candidateBundle: experiment.candidate,
    bundle: experiment[targetArm],
    targets: activation.targets.map((target) => ({
      ...target,
      desiredDigest: agentImprovementTargetDigest(experiment, targetArm, target.surface),
      desiredInput: agentImprovementTargetInput(experiment[targetArm], target.surface),
    })) as SealedCandidateActivationTransitionInput['targets'],
    attemptedAt,
    expired,
  }
}

function profileImprovementTransition(
  experiment: AgentProfileImprovementExperiment,
  activation: AgentImprovementActivation,
  attemptedAt: string,
  expired: boolean,
): ProfileImprovementActivationTransitionInput {
  const sourceArm = activation.intent === 'activate-candidate' ? 'baseline' : 'candidate'
  const targetArm = activation.intent === 'activate-candidate' ? 'candidate' : 'baseline'
  const operation = profileImprovementOperation(experiment, activation.intent)
  return {
    kind: 'profile-improvement',
    activation,
    experiment,
    sourceStateDigest: agentProfileImprovementStateDigest(experiment, sourceArm),
    desiredStateDigest: agentProfileImprovementStateDigest(experiment, targetArm),
    operation,
    targets: activation.targets.map((target) => ({
      ...target,
      desiredDigest: agentProfileImprovementStateDigest(experiment, targetArm),
      desiredInput: operation,
    })) as ProfileImprovementActivationTransitionInput['targets'],
    attemptedAt,
    expired,
  }
}

function profileImprovementOperation(
  experiment: AgentProfileImprovementExperiment,
  intent: AgentImprovementActivation['intent'],
): AgentProfileImprovementActivationOperation {
  return intent === 'activate-candidate'
    ? { kind: 'apply-change', changes: experiment.change }
    : { kind: 'restore-state' }
}

function uncertainActivationResult(
  transition: AgentImprovementActivationTransitionInput,
  code: string,
): AgentImprovementActivationResult {
  return createAgentImprovementActivationResult(transition, {
    completedAt: transition.attemptedAt,
    outcome: {
      status: 'indeterminate',
      code,
      message: 'The product transition did not return a trustworthy commit result.',
    },
  })
}

function assertTransitionInput(
  activation: AgentImprovementActivation,
  transition: AgentImprovementActivationTransitionInput,
): void {
  if (transition.kind === 'sealed-candidate') {
    assertSealedCandidateTransitionInput(activation, transition)
    return
  }
  assertProfileImprovementTransitionInput(activation, transition)
}

function assertSealedCandidateTransitionInput(
  activation: AgentImprovementActivation,
  transition: SealedCandidateActivationTransitionInput,
): void {
  assertAuthorizedTransitionTargets(activation, transition.targets)
  const desiredInputsMatch = transition.targets.every(
    (target) =>
      canonicalCandidateDigest(target.desiredInput) ===
      canonicalCandidateDigest(agentImprovementTargetInput(transition.bundle, target.surface)),
  )
  if (
    transition.expired !== Date.parse(transition.attemptedAt) >= Date.parse(activation.expiresAt) ||
    transition.candidateBundle.digest !== activation.candidateDigest ||
    !desiredInputsMatch ||
    (activation.intent === 'activate-candidate' &&
      transition.bundle.digest !== transition.candidateBundle.digest)
  ) {
    throw new Error('activation transition does not match its authorization')
  }
}

function assertProfileImprovementTransitionInput(
  activation: AgentImprovementActivation,
  transition: ProfileImprovementActivationTransitionInput,
): void {
  assertAuthorizedTransitionTargets(activation, transition.targets)
  const targetsAgentProfile = activation.targets.some(
    (target) => target.surface === 'agent-profile',
  )
  const experiment = agentProfileImprovementExperimentSchema.parse(transition.experiment)
  const sourceArm = activation.intent === 'activate-candidate' ? 'baseline' : 'candidate'
  const targetArm = activation.intent === 'activate-candidate' ? 'candidate' : 'baseline'
  const sourceStateDigest = agentProfileImprovementStateDigest(experiment, sourceArm)
  const desiredStateDigest = agentProfileImprovementStateDigest(experiment, targetArm)
  const operation = profileImprovementOperation(experiment, activation.intent)
  const targetsMatch = transition.targets.every(
    (target) =>
      target.expectedBaseDigest === sourceStateDigest &&
      target.desiredDigest === desiredStateDigest &&
      canonicalCandidateDigest(target.desiredInput) === canonicalCandidateDigest(operation),
  )
  if (
    transition.expired !== Date.parse(transition.attemptedAt) >= Date.parse(activation.expiresAt) ||
    experiment.digest !== activation.experimentDigest ||
    experiment.candidate.stateDigest !== activation.candidateDigest ||
    (targetsAgentProfile &&
      (activation.executionRef === undefined ||
        canonicalCandidateDigest(activation.executionRef) !==
          canonicalCandidateDigest(experiment.executionRef))) ||
    transition.sourceStateDigest !== sourceStateDigest ||
    transition.desiredStateDigest !== desiredStateDigest ||
    canonicalCandidateDigest(transition.operation) !== canonicalCandidateDigest(operation) ||
    !targetsMatch
  ) {
    throw new Error('activation transition does not match its authorization')
  }
}

function assertAuthorizedTransitionTargets(
  activation: AgentImprovementActivation,
  targets: readonly AgentImprovementActivationTargetPlan[],
): void {
  const authorized = targetMap(activation.targets)
  const planned = targetMap(targets)
  if (
    authorized.size !== planned.size ||
    [...authorized.entries()].some(
      ([identity, target]) =>
        planned.get(identity)?.expectedBaseDigest !== target.expectedBaseDigest,
    )
  ) {
    throw new Error('activation transition does not match its authorization')
  }
}

function assertResultAgainstActivation(
  activation: AgentImprovementActivation,
  result: AgentImprovementActivationResult,
): void {
  const attemptedAt = Date.parse(result.attemptedAt)
  const completedAt = Date.parse(result.completedAt)
  const expiresAt = Date.parse(activation.expiresAt)
  if (
    result.idempotencyKey !== activation.digest ||
    attemptedAt < Date.parse(activation.authorizedAt) ||
    completedAt < attemptedAt
  ) {
    throw new Error('activation result does not bind its authorization')
  }
  const expired = attemptedAt >= expiresAt
  if (
    (result.outcome.status === 'expired' && !expired) ||
    (expired && !['expired', 'indeterminate', 'already-applied'].includes(result.outcome.status))
  ) {
    throw new Error('activation result does not honor its authorization expiry')
  }
  if (!('targets' in result.outcome)) return
  const authorized = targetMap(activation.targets)
  const observed = new Set(result.outcome.targets.map(targetIdentity))
  if (
    authorized.size !== observed.size ||
    [...authorized.keys()].some((identity) => !observed.has(identity))
  ) {
    throw new Error('activation result must cover every authorized target exactly once')
  }
  if (
    result.outcome.status === 'applied' &&
    result.outcome.targets.some(
      (target) =>
        target.beforeDigest !== authorized.get(targetIdentity(target))?.expectedBaseDigest,
    )
  ) {
    throw new Error('applied activation did not start from its authorized base state')
  }
}

function assertResultDesiredState(
  proposal: AgentImprovementProposal,
  activation: AgentImprovementActivation,
  result: AgentImprovementActivationResult,
): void {
  if (!('targets' in result.outcome)) return
  const targetArm = activation.intent === 'activate-candidate' ? 'candidate' : 'baseline'
  const desiredStateDigest =
    proposal.evaluation.kind === 'agent-profile-improvement-measured-comparison'
      ? agentProfileImprovementStateDigest(proposal.evaluation.experiment, targetArm)
      : undefined
  const desired = new Map(
    activation.targets.map((target) => [
      targetIdentity(target),
      desiredStateDigest ??
        agentImprovementTargetDigest(
          requireSealedCandidateExperiment(proposal),
          targetArm,
          target.surface,
        ),
    ]),
  )
  assertOutcomeDesiredState(activation, result, desired)
}

function assertOutcomeDesiredState(
  activation: AgentImprovementActivation,
  result: AgentImprovementActivationResult,
  desired: ReadonlyMap<string, Sha256Digest>,
): void {
  if (!('targets' in result.outcome)) return
  if (result.outcome.status === 'applied') {
    if (
      result.outcome.targets.some(
        (target) => target.afterDigest !== desired.get(targetIdentity(target)),
      )
    ) {
      throw new Error('applied activation does not match the requested bundle')
    }
    return
  }
  const allDesired = result.outcome.targets.every(
    (target) => target.currentDigest === desired.get(targetIdentity(target)),
  )
  if (result.outcome.status === 'already-applied') {
    if (!allDesired) throw new Error('already-applied activation is not at the requested state')
    return
  }
  const authorized = targetMap(activation.targets)
  const hasStaleTarget = result.outcome.targets.some(
    (target) => target.currentDigest !== authorized.get(targetIdentity(target))?.expectedBaseDigest,
  )
  if (allDesired || !hasStaleTarget) {
    throw new Error('activation conflict does not identify stale target state')
  }
}

function targetMap<T extends { surface: AgentImprovementSurface; identity: string }>(
  targets: readonly T[],
): Map<string, T> {
  return new Map(targets.map((target) => [targetIdentity(target), target]))
}

function targetIdentity(target: { surface: AgentImprovementSurface; identity: string }): string {
  return `${target.surface}\u0000${target.identity}`
}

export interface CreateAgentImprovementProposalOptions {
  runId: string
  findings: readonly ProposalFinding[]
  evaluation: AgentImprovementEvaluation
  now?: () => Date
}

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

type ProposalFindingImprovementProposal = Omit<AgentImprovementProposal, 'findings'> & {
  findings: ProposalFinding[]
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
function requireSealedCandidateExperiment(
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
    const evaluation = verifyAgentProfileImprovementExperimentComparison(input)
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

function sameOrderedValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
