import {
  type BuildEvalKnowledgeBundleOptions,
  evaluateKnowledgeBaseReadiness,
  improveKnowledgeBase,
  type KnowledgeBaseQualityOptions,
  type KnowledgeImprovementOptions,
  type KnowledgeImprovementResult,
  type KnowledgeReadinessSpec,
} from '@tangle-network/agent-knowledge'
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
    usd: number
    ms: number
  }
}

export interface KnowledgeImprovementJobResult {
  improvement: KnowledgeImprovementResult
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

/** Run the full KB improvement job: candidate workspace, runtime supervisor update, readiness check, and promotion. */
export async function runKnowledgeImprovementJob(
  options: RunKnowledgeImprovementJobOptions,
): Promise<KnowledgeImprovementJobResult> {
  const {
    allowedModels,
    backend,
    budget,
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

  const resolvedImprovement = await improveKnowledgeBase({
    ...knowledgeOptions,
    updateKnowledge: async (input) => {
      const updateStartedAt = Date.now()
      updateCalls += 1
      const result = await updateKnowledge(input)
      updateDurationMs += Date.now() - updateStartedAt
      addSpent(supervisedSpent, result.supervised)
      return result
    },
  } as KnowledgeImprovementOptions)
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
    measurement,
    promoted: resolvedImprovement.promoted,
    blocked: resolvedImprovement.blocked,
  }
}

function emptySpent(): KnowledgeImprovementJobMeasurement['supervisedSpent'] {
  return { iterations: 0, inputTokens: 0, outputTokens: 0, usd: 0, ms: 0 }
}

function addSpent(
  target: KnowledgeImprovementJobMeasurement['supervisedSpent'],
  result: SupervisedResult<unknown>,
): void {
  const spent = result.spentTotal
  target.iterations += spent.iterations ?? 0
  target.inputTokens += spent.tokens?.input ?? 0
  target.outputTokens += spent.tokens?.output ?? 0
  target.usd += spent.usd ?? 0
  target.ms += spent.ms ?? 0
}
