import type {
  DataAcquisitionPlan,
  KnowledgeReadinessReport,
  KnowledgeRequirement,
  UserQuestion,
} from '@tangle-network/agent-eval'
import type { AgentTaskSpec, RuntimeSession, RuntimeStreamEvent } from './types'

export interface RuntimeTelemetryOptions {
  includeInputs?: boolean
  includeRequirementDescriptions?: boolean
  includeEvidenceIds?: boolean
  includeUserAnswers?: boolean
  includeControlPayloads?: boolean
  includeMetadata?: boolean
  includeEvalDetails?: boolean
}

export interface SanitizedKnowledgeRequirement {
  id: string
  description?: string
  requiredFor: string[]
  category: KnowledgeRequirement['category']
  acquisitionMode: KnowledgeRequirement['acquisitionMode']
  importance: KnowledgeRequirement['importance']
  freshness: KnowledgeRequirement['freshness']
  sensitivity: KnowledgeRequirement['sensitivity']
  confidenceNeeded: number
  currentConfidence: number
  evidenceCount: number
  evidenceIds?: string[]
  fallbackPolicy: KnowledgeRequirement['fallbackPolicy']
}

export interface SanitizedKnowledgeReadinessReport {
  taskId: string
  readinessScore: number
  recommendedAction: KnowledgeReadinessReport['recommendedAction']
  severity: KnowledgeReadinessReport['severity']
  reason: string
  blockingMissingRequirements: SanitizedKnowledgeRequirement[]
  nonBlockingGaps: SanitizedKnowledgeRequirement[]
  evidenceCount: number
  evidenceIds?: string[]
  missingRequirementIds: string[]
}

/** Strip private inputs and large evidence blobs from a readiness report. @stable */
export function sanitizeKnowledgeReadinessReport(
  report: KnowledgeReadinessReport,
  options: RuntimeTelemetryOptions = {},
): SanitizedKnowledgeReadinessReport {
  return {
    taskId: report.taskId,
    readinessScore: report.readinessScore,
    recommendedAction: report.recommendedAction,
    severity: report.severity,
    reason: report.reason,
    blockingMissingRequirements: report.blockingMissingRequirements.map((requirement) =>
      sanitizeKnowledgeRequirement(requirement, options),
    ),
    nonBlockingGaps: report.nonBlockingGaps.map((requirement) =>
      sanitizeKnowledgeRequirement(requirement, options),
    ),
    evidenceCount: report.bundle.evidenceIds.length,
    evidenceIds: options.includeEvidenceIds ? report.bundle.evidenceIds : undefined,
    missingRequirementIds: report.bundle.missing.map((requirement) => requirement.id),
  }
}

export function sanitizeTask(
  task: AgentTaskSpec,
  options: RuntimeTelemetryOptions,
): Record<string, unknown> {
  return {
    id: task.id,
    intent: task.intent,
    domain: task.domain,
    inputs: options.includeInputs ? task.inputs : task.inputs ? '[redacted]' : undefined,
    requiredKnowledge: task.requiredKnowledge?.map((requirement) =>
      sanitizeKnowledgeRequirement(requirement, options),
    ),
    metadata: options.includeMetadata ? task.metadata : task.metadata ? '[redacted]' : undefined,
  }
}

export function sanitizeRuntimeSession(
  session: RuntimeSession,
  options: RuntimeTelemetryOptions,
): Record<string, unknown> {
  return {
    id: session.id,
    backend: session.backend,
    status: session.status,
    hasResumeToken: Boolean(session.resumeToken),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    metadata: options.includeMetadata
      ? session.metadata
      : session.metadata
        ? '[redacted]'
        : undefined,
  }
}

function sanitizeKnowledgeRequirement(
  requirement: KnowledgeRequirement,
  options: RuntimeTelemetryOptions,
): SanitizedKnowledgeRequirement {
  const includeDescription =
    options.includeRequirementDescriptions && requirement.sensitivity !== 'secret'
  return {
    id: requirement.id,
    description: includeDescription ? requirement.description : undefined,
    requiredFor: requirement.requiredFor,
    category: requirement.category,
    acquisitionMode: requirement.acquisitionMode,
    importance: requirement.importance,
    freshness: requirement.freshness,
    sensitivity: requirement.sensitivity,
    confidenceNeeded: requirement.confidenceNeeded,
    currentConfidence: requirement.currentConfidence,
    evidenceCount: requirement.evidenceIds.length,
    evidenceIds: options.includeEvidenceIds ? requirement.evidenceIds : undefined,
    fallbackPolicy: requirement.fallbackPolicy,
  }
}

export function sanitizeQuestion(
  question: UserQuestion,
  options: RuntimeTelemetryOptions,
): Record<string, unknown> {
  return {
    id: question.id,
    question:
      options.includeRequirementDescriptions && question.answerType !== 'credential'
        ? question.question
        : undefined,
    reason: options.includeRequirementDescriptions ? question.reason : undefined,
    requirementId: question.requirementId,
    importance: question.importance,
    answerType: question.answerType,
    impactIfUnknown: options.includeRequirementDescriptions ? question.impactIfUnknown : undefined,
    optionCount: question.options?.length ?? 0,
  }
}

export function sanitizeAcquisitionPlan(plan: DataAcquisitionPlan): Record<string, unknown> {
  return {
    id: plan.id,
    requirementIds: plan.requirementIds,
    mode: plan.mode,
    priority: plan.priority,
    expectedEvidenceCount: plan.expectedEvidenceIds?.length ?? 0,
    questionCount: plan.questions?.length ?? 0,
  }
}

export function redactRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(record).map((key) => [key, '[redacted]']))
}

export function pickPublicStreamFields(event: RuntimeStreamEvent): Record<string, unknown> {
  if (event.type === 'session_created' || event.type === 'session_resumed') return {}
  if (event.type === 'backend_start' || event.type === 'backend_end')
    return { backend: event.backend }
  if (event.type === 'backend_error') {
    const error = event.error
    return {
      backend: event.backend,
      message: event.message,
      recoverable: event.recoverable,
      ...(error === undefined ? {} : { error: { kind: error.kind, status: error.status } }),
    }
  }
  if (event.type === 'task_end') return { status: event.status, reason: event.reason }
  if (event.type === 'text_delta' || event.type === 'reasoning_delta') return { text: event.text }
  return {}
}
