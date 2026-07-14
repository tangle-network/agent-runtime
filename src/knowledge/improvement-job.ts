import { realpath } from 'node:fs/promises'
import {
  type AgentCandidateCapturedArtifact,
  type AgentCandidateKnowledge,
  type AgentImprovementProposal,
  type AgentImprovementReview,
  agentCandidateKnowledgeSchema,
} from '@tangle-network/agent-interface'
import {
  type BuildEvalKnowledgeBundleOptions,
  evaluateKnowledgeBaseReadiness,
  hashKnowledgeBase,
  improveKnowledgeBase,
  type KnowledgeBaseQualityOptions,
  type KnowledgeImprovementCandidateRef,
  type KnowledgeImprovementOptions,
  type KnowledgeImprovementResult,
  type KnowledgeReadinessSpec,
  knowledgeImprovementCandidateRef,
  promoteKnowledgeCandidate,
  withKnowledgeImprovementCandidate,
} from '@tangle-network/agent-knowledge'
import { canonicalCandidateBytes, embeddedCandidateArtifact } from '../candidate-execution/digest'
import { persistCandidateOutputArtifact } from '../candidate-execution/output-artifacts'
import type { AgentCandidateOutputArtifactPort } from '../candidate-execution/types'
import { captureAgentCandidateWorkspace } from '../candidate-execution/workspace-archive'
import {
  verifyAgentImprovementProposal,
  verifyAgentImprovementReview,
} from '../intelligence/improvement-cycle'
import type { ExecutorConfig } from '../runtime/supervise/runtime'
import type { SuperviseOptions } from '../runtime/supervise/supervise'
import type { SupervisorProfile } from '../runtime/supervise/supervisor-agent'
import type { Budget, SupervisedResult } from '../runtime/supervise/types'
import {
  createSupervisedKnowledgeUpdater,
  type KnowledgeReadinessCheck,
  type KnowledgeReadinessCheckResult,
  type SupervisedKnowledgeUpdateOptions,
} from './supervised-update'

export interface RunKnowledgeImprovementJobOptions
  extends Omit<KnowledgeImprovementOptions, 'updateKnowledge'> {
  budget: Budget
  readinessCheck?: KnowledgeReadinessCheck
  backend?: ExecutorConfig
  makeWorkerAgent?: SuperviseOptions['makeWorkerAgent']
  harness?: string
  supervisorModel?: string
  supervisorSystemPrompt?: string
  superviseOptions?: Partial<
    Omit<
      SuperviseOptions,
      'budget' | 'backend' | 'deliverable' | 'makeWorkerAgent' | 'allowedModels'
    >
  >
  allowedModels?: readonly string[]
  runSupervised?: (
    profile: SupervisorProfile,
    task: unknown,
    opts: SuperviseOptions,
  ) => Promise<SupervisedResult<unknown>>
  candidateArtifacts?: AgentCandidateOutputArtifactPort
  approval?: ApprovedKnowledgeImprovementCandidate
  onMeasurement?: (measurement: KnowledgeImprovementJobMeasurement) => Promise<void> | void
}

export interface ApprovedKnowledgeImprovementCandidate {
  proposal: AgentImprovementProposal
  review: AgentImprovementReview
  authorizeReview: (
    review: AgentImprovementReview,
    proposal: AgentImprovementProposal,
  ) => boolean | Promise<boolean>
}

export interface KnowledgeImprovementJobMeasurement {
  startedAt: string
  finishedAt: string
  durationMs: number
  updateCalls: number
  updateDurationMs: number
  supervisedSpent: {
    iterations: number
    inputTokens: number
    outputTokens: number
    usdKnown: boolean
    usd: number
    ms: number
  }
}

export interface KnowledgeImprovementJobResult {
  improvement: KnowledgeImprovementResult
  candidateKnowledge?: AgentCandidateKnowledge
  measurement: KnowledgeImprovementJobMeasurement
  promoted: boolean
  blocked: boolean
}

export interface AgentKnowledgeReadinessCheckOptions {
  goal: string
  readinessSpecs?: readonly KnowledgeReadinessSpec[]
  readinessTaskId?: string
  readiness?: Omit<BuildEvalKnowledgeBundleOptions, 'taskId' | 'index' | 'specs'>
  strict?: boolean
  kbQuality?: KnowledgeBaseQualityOptions
}

/** Build the default readiness check backed by `@tangle-network/agent-knowledge` validation and scoring. */
export function createAgentKnowledgeReadinessCheck(
  options: AgentKnowledgeReadinessCheckOptions,
): KnowledgeReadinessCheck {
  return async (input): Promise<KnowledgeReadinessCheckResult> => {
    const readiness = await evaluateKnowledgeBaseReadiness({
      root: input.root,
      goal: input.goal ?? options.goal,
      readinessSpecs:
        (input.readinessSpecs as readonly KnowledgeReadinessSpec[] | undefined) ??
        options.readinessSpecs,
      readinessTaskId: input.readinessTaskId ?? options.readinessTaskId,
      readiness:
        (input.readiness as AgentKnowledgeReadinessCheckOptions['readiness'] | undefined) ??
        options.readiness,
      strict: options.strict,
      kbQuality: options.kbQuality,
    })
    return {
      ready: readiness.ready,
      summary: readiness.summary,
      metadata: {
        dimensions: readiness.dimensions,
        validationOk: readiness.validation.ok,
        kbQualityOk: readiness.kbQuality.ok,
        blockingMissing: readiness.readiness?.report.blockingMissingRequirements.length ?? 0,
      },
    }
  }
}

/** Produce a frozen KB candidate, and promote it only when an exact signed review is supplied. */
export async function runKnowledgeImprovementJob(
  options: RunKnowledgeImprovementJobOptions,
): Promise<KnowledgeImprovementJobResult> {
  const {
    allowedModels,
    backend,
    budget,
    candidateArtifacts,
    harness,
    makeWorkerAgent,
    onMeasurement,
    approval,
    readinessCheck,
    runSupervised,
    supervisorModel,
    supervisorSystemPrompt,
    superviseOptions,
    ...knowledgeOptions
  } = options
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const supervisedSpent = emptySpent()
  let updateCalls = 0
  let updateDurationMs = 0

  const readiness = readinessCheck ?? createAgentKnowledgeReadinessCheck(options)
  const updateKnowledge = createSupervisedKnowledgeUpdater({
    root: options.root,
    goal: options.goal,
    readiness,
    readinessSpecs: options.readinessSpecs,
    readinessTaskId: options.readinessTaskId,
    readinessOptions: options.readiness,
    budget,
    backend,
    makeWorkerAgent,
    harness,
    supervisorModel,
    supervisorSystemPrompt,
    superviseOptions,
    allowedModels,
    runSupervised,
  } satisfies SupervisedKnowledgeUpdateOptions)

  const instrumentedUpdateKnowledge: KnowledgeImprovementOptions['updateKnowledge'] = async (
    input,
  ) => {
    const updateStartedAt = Date.now()
    updateCalls += 1
    const result = await updateKnowledge(input)
    updateDurationMs += Date.now() - updateStartedAt
    addSpent(supervisedSpent, result.supervised)
    return result
  }
  let resolvedImprovement: KnowledgeImprovementResult
  let candidateKnowledge: AgentCandidateKnowledge | undefined
  if (approval) {
    const approvedKnowledge = await approvedKnowledgeCandidate(approval)
    const candidate = agentKnowledgeCandidateRef(approvedKnowledge)
    knowledgeOptions.signal?.throwIfAborted()
    await withKnowledgeImprovementCandidate({ root: options.root, candidate }, () => undefined)
    resolvedImprovement = await promoteKnowledgeCandidate({
      root: options.root,
      candidate,
      ...(knowledgeOptions.ownerId ? { ownerId: knowledgeOptions.ownerId } : {}),
      ...(knowledgeOptions.leaseTtlMs ? { leaseTtlMs: knowledgeOptions.leaseTtlMs } : {}),
      ...(knowledgeOptions.now ? { now: knowledgeOptions.now } : {}),
      ...(knowledgeOptions.onState ? { onState: knowledgeOptions.onState } : {}),
    })
    knowledgeOptions.signal?.throwIfAborted()
    const promotedHash = knowledgeDigest(
      await hashKnowledgeBase(options.root),
      'promoted knowledge base',
    )
    if (
      !resolvedImprovement.promoted ||
      promotedHash !== approvedKnowledge.candidate.candidateHash
    ) {
      throw new Error('knowledge promotion did not activate the approved snapshot bytes')
    }
    candidateKnowledge = approvedKnowledge
  } else {
    resolvedImprovement = await improveKnowledgeBase({
      ...knowledgeOptions,
      updateKnowledge: instrumentedUpdateKnowledge,
    } as KnowledgeImprovementOptions)
    if (resolvedImprovement.candidate) {
      candidateKnowledge = await freezeKnowledgeCandidate(
        options.root,
        resolvedImprovement,
        candidateArtifacts,
        knowledgeOptions.signal,
      )
    }
  }
  const finishedAtMs = Date.now()
  const measurement: KnowledgeImprovementJobMeasurement = {
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    updateCalls,
    updateDurationMs,
    supervisedSpent,
  }
  await onMeasurement?.(measurement)
  return {
    improvement: resolvedImprovement,
    ...(candidateKnowledge ? { candidateKnowledge } : {}),
    measurement,
    promoted: resolvedImprovement.promoted,
    blocked: resolvedImprovement.blocked,
  }
}

async function freezeKnowledgeCandidate(
  root: string,
  improvement: KnowledgeImprovementResult,
  artifacts: AgentCandidateOutputArtifactPort | undefined,
  signal: AbortSignal | undefined,
): Promise<AgentCandidateKnowledge> {
  const candidate = knowledgeImprovementCandidateRef(improvement)
  return withKnowledgeImprovementCandidate({ root, candidate }, async (resolved) => {
    const executionId = `knowledge-${candidate.candidateId}`
    const captured = await captureAgentCandidateWorkspace(await realpath(resolved.root), {
      ...(artifacts
        ? {
            artifactPersistence: {
              executionId,
              outputArtifacts: artifacts,
              ...(signal ? { signal } : {}),
            },
          }
        : {}),
    })
    const evaluation = await captureKnowledgeEvidence(
      canonicalCandidateBytes({
        schemaVersion: 1,
        kind: 'agent-knowledge-candidate-evaluation',
        candidate: interfaceKnowledgeCandidateRef(candidate),
        metric: resolved.evaluation,
      }),
      'knowledge-evaluation',
      executionId,
      artifacts,
      signal,
    )
    return agentCandidateKnowledgeSchema.parse({
      candidate: interfaceKnowledgeCandidateRef(candidate),
      snapshot: captured.snapshot,
      evaluation,
    })
  })
}

async function captureKnowledgeEvidence(
  bytes: Uint8Array,
  purpose: 'knowledge-retrieval-config' | 'knowledge-evaluation',
  executionId: string,
  artifacts: AgentCandidateOutputArtifactPort | undefined,
  signal: AbortSignal | undefined,
): Promise<AgentCandidateCapturedArtifact> {
  if (!artifacts) return embeddedCandidateArtifact(bytes)
  return persistCandidateOutputArtifact(artifacts, {
    executionId,
    purpose,
    bytes,
    ...(signal ? { signal } : {}),
  })
}

async function approvedKnowledgeCandidate(
  approval: ApprovedKnowledgeImprovementCandidate,
): Promise<AgentCandidateKnowledge> {
  const proposal = verifyAgentImprovementProposal(approval.proposal)
  const review = verifyAgentImprovementReview(approval.review)
  if (
    proposal.changedSurfaces.length !== 1 ||
    proposal.changedSurfaces[0] !== 'knowledge' ||
    !proposal.candidateBundle.knowledge ||
    review.decision !== 'approve' ||
    review.proposalDigest !== proposal.digest ||
    review.candidateBundleDigest !== proposal.candidateBundle.digest
  ) {
    throw new Error('knowledge promotion requires an approved exact knowledge proposal')
  }
  if (!(await approval.authorizeReview(review, proposal))) {
    throw new Error('knowledge candidate approval was not authorized')
  }
  return proposal.candidateBundle.knowledge
}

function interfaceKnowledgeCandidateRef(
  candidate: KnowledgeImprovementCandidateRef,
): AgentCandidateKnowledge['candidate'] {
  return {
    schemaVersion: 1,
    kind: 'knowledge-improvement-candidate',
    runId: candidate.runId,
    candidateId: candidate.candidateId,
    goalHash: knowledgeDigest(candidate.goalHash, 'knowledge candidate goal'),
    baseHash: knowledgeDigest(candidate.baseHash, 'knowledge candidate base'),
    candidateHash: knowledgeDigest(candidate.candidateHash, 'knowledge candidate snapshot'),
    evidenceHash: knowledgeDigest(candidate.evidenceHash, 'knowledge candidate evidence'),
    promotionPlanHash: knowledgeDigest(
      candidate.promotionPlanHash,
      'knowledge candidate promotion plan',
    ),
  }
}

function agentKnowledgeCandidateRef(
  knowledge: AgentCandidateKnowledge,
): KnowledgeImprovementCandidateRef {
  return {
    schemaVersion: 1,
    kind: 'knowledge-improvement-candidate',
    runId: knowledge.candidate.runId,
    candidateId: knowledge.candidate.candidateId,
    goalHash: rawKnowledgeDigest(knowledge.candidate.goalHash, 'knowledge candidate goal'),
    baseHash: rawKnowledgeDigest(knowledge.candidate.baseHash, 'knowledge candidate base'),
    candidateHash: rawKnowledgeDigest(
      knowledge.candidate.candidateHash,
      'knowledge candidate snapshot',
    ),
    evidenceHash: rawKnowledgeDigest(
      knowledge.candidate.evidenceHash,
      'knowledge candidate evidence',
    ),
    promotionPlanHash: rawKnowledgeDigest(
      knowledge.candidate.promotionPlanHash,
      'knowledge candidate promotion plan',
    ),
  }
}

function knowledgeDigest(value: string, label: string): `sha256:${string}` {
  const digest = value.startsWith('sha256:') ? value : `sha256:${value}`
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${label} is not a SHA-256 digest`)
  }
  return digest as `sha256:${string}`
}

function rawKnowledgeDigest(value: string, label: string): string {
  return knowledgeDigest(value, label).slice('sha256:'.length)
}

function emptySpent(): KnowledgeImprovementJobMeasurement['supervisedSpent'] {
  return { iterations: 0, inputTokens: 0, outputTokens: 0, usdKnown: true, usd: 0, ms: 0 }
}

function addSpent(
  target: KnowledgeImprovementJobMeasurement['supervisedSpent'],
  result: SupervisedResult<unknown>,
): void {
  const spent = result.spentTotal
  target.iterations += spent.iterations
  target.inputTokens += spent.tokens.input
  target.outputTokens += spent.tokens.output
  target.usdKnown = target.usdKnown && spent.usdKnown !== false
  target.usd += spent.usd
  target.ms += spent.ms
}
