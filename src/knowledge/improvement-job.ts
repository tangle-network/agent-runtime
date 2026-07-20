import { realpath } from 'node:fs/promises'
import {
  type AgentCandidateBundle,
  type AgentCandidateCapturedArtifact,
  type AgentCandidateKnowledge,
  agentCandidateKnowledgeSchema,
} from '@tangle-network/agent-interface'
import {
  type BuildEvalKnowledgeBundleOptions,
  evaluateKnowledgeBaseReadiness,
  improveKnowledgeBase,
  type KnowledgeBaseQualityOptions,
  type KnowledgeImprovementOptions,
  type KnowledgeImprovementResult,
  type KnowledgeReadinessSpec,
  knowledgeImprovementCandidateRef,
  toAgentCandidateKnowledgeRef,
  withKnowledgeImprovementComparison,
} from '@tangle-network/agent-knowledge'
import { sealAgentCandidateBundle } from '../candidate-execution/bundle'
import {
  canonicalCandidateBytes,
  embeddedCandidateArtifact,
  omitTopLevelDigest,
} from '../candidate-execution/digest'
import { persistCandidateOutputArtifact } from '../candidate-execution/output-artifacts'
import type { AgentCandidateOutputArtifactPort } from '../candidate-execution/types'
import { captureAgentCandidateWorkspace } from '../candidate-execution/workspace-archive'
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
  onMeasurement?: (measurement: KnowledgeImprovementJobMeasurement) => Promise<void> | void
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
  knowledge?: KnowledgeImprovementCandidatePair
  measurement: KnowledgeImprovementJobMeasurement
  blocked: boolean
}

export interface KnowledgeImprovementCandidatePair {
  reference: AgentCandidateKnowledge['candidate']
  evaluation: AgentCandidateCapturedArtifact
  baseline: AgentCandidateKnowledge['snapshot']
  candidate: AgentCandidateKnowledge['snapshot']
}

export interface KnowledgeImprovementExperimentBundles {
  baseline: AgentCandidateBundle
  candidate: AgentCandidateBundle
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

/** Produce a frozen KB candidate while leaving live knowledge content unchanged. */
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
  const resolvedImprovement = await improveKnowledgeBase({
    ...knowledgeOptions,
    updateKnowledge: instrumentedUpdateKnowledge,
  })
  let knowledge: KnowledgeImprovementCandidatePair | undefined
  if (
    resolvedImprovement.candidate?.status === 'candidate-ready' ||
    resolvedImprovement.candidate?.status === 'promoted'
  ) {
    knowledge = await freezeKnowledgeCandidatePair(
      options.root,
      resolvedImprovement,
      candidateArtifacts,
      knowledgeOptions.signal,
    )
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
    ...(knowledge ? { knowledge } : {}),
    measurement,
    blocked: resolvedImprovement.blocked,
  }
}

/** Attach both frozen knowledge inputs to one otherwise-identical bundle pair. */
export function buildKnowledgeImprovementExperimentBundles(
  bundle: AgentCandidateBundle,
  knowledge: KnowledgeImprovementCandidatePair,
): KnowledgeImprovementExperimentBundles {
  const input = omitTopLevelDigest(bundle)
  const withSnapshot = (snapshot: AgentCandidateKnowledge['snapshot']) =>
    agentCandidateKnowledgeSchema.parse({
      candidate: knowledge.reference,
      snapshot,
      evaluation: knowledge.evaluation,
    })
  return Object.freeze({
    baseline: sealAgentCandidateBundle({ ...input, knowledge: withSnapshot(knowledge.baseline) }),
    candidate: sealAgentCandidateBundle({ ...input, knowledge: withSnapshot(knowledge.candidate) }),
  })
}

async function freezeKnowledgeCandidatePair(
  root: string,
  improvement: KnowledgeImprovementResult,
  artifacts: AgentCandidateOutputArtifactPort | undefined,
  signal: AbortSignal | undefined,
): Promise<KnowledgeImprovementCandidatePair> {
  const candidate = knowledgeImprovementCandidateRef(improvement)
  const candidateRef = toAgentCandidateKnowledgeRef(candidate)
  return withKnowledgeImprovementComparison({ root, candidate }, async (comparison) => {
    const freeze = async (
      target: 'baseline' | 'candidate',
    ): Promise<AgentCandidateKnowledge['snapshot']> => {
      const executionId = `knowledge-${candidate.candidateId}-${target}`
      const captured = await captureAgentCandidateWorkspace(
        await realpath(comparison[target].root),
        {
          ...(artifacts
            ? {
                artifactPersistence: {
                  executionId,
                  outputArtifacts: artifacts,
                  ...(signal ? { signal } : {}),
                },
              }
            : {}),
        },
      )
      return captured.snapshot
    }
    const evaluation = await captureKnowledgeEvidence(
      canonicalCandidateBytes({
        kind: 'agent-knowledge-candidate-evaluation',
        candidate: candidateRef,
        metric: comparison.evaluation,
      }),
      'knowledge-evaluation',
      `knowledge-${candidate.candidateId}`,
      artifacts,
      signal,
    )
    const baseline = await freeze('baseline')
    const proposed = await freeze('candidate')
    return Object.freeze({
      reference: candidateRef,
      evaluation,
      baseline,
      candidate: proposed,
    })
  })
}

async function captureKnowledgeEvidence(
  bytes: Uint8Array,
  purpose: 'knowledge-evaluation',
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
