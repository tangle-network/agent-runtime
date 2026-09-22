import type {
  DataAcquisitionPlan,
  KnowledgeReadinessReport,
  UserQuestion,
} from '@tangle-network/agent-eval'
import type {
  AgentTaskSpec,
  AgentTaskStatus,
  BackendErrorDetail,
  KnowledgeReadinessDecision,
  RuntimeSession,
} from './runtime-contracts'

/** Stable events emitted by the task-stream runtime. */
export type RuntimeStreamEvent =
  | { type: 'task_start'; task: AgentTaskSpec; timestamp: string }
  | { type: 'readiness_start'; task: AgentTaskSpec; timestamp: string }
  | {
      type: 'readiness_end'
      task: AgentTaskSpec
      knowledge: KnowledgeReadinessReport
      decision: KnowledgeReadinessDecision
      timestamp: string
    }
  | {
      type: 'questions_start'
      task: AgentTaskSpec
      questions: UserQuestion[]
      timestamp: string
    }
  | {
      type: 'questions_end'
      task: AgentTaskSpec
      questions: UserQuestion[]
      userAnswers: Record<string, string>
      timestamp: string
    }
  | {
      type: 'acquisition_start'
      task: AgentTaskSpec
      acquisitionPlans: DataAcquisitionPlan[]
      timestamp: string
    }
  | {
      type: 'acquisition_end'
      task: AgentTaskSpec
      acquisitionPlans: DataAcquisitionPlan[]
      acquiredEvidenceIds: string[]
      timestamp: string
    }
  | { type: 'session_created'; task: AgentTaskSpec; session: RuntimeSession; timestamp: string }
  | { type: 'session_resumed'; task: AgentTaskSpec; session: RuntimeSession; timestamp: string }
  | {
      type: 'backend_start'
      task: AgentTaskSpec
      session: RuntimeSession
      backend: string
      timestamp: string
    }
  | {
      type: 'text_delta'
      task?: AgentTaskSpec
      session?: RuntimeSession
      text: string
      timestamp?: string
    }
  | {
      type: 'reasoning_delta'
      task?: AgentTaskSpec
      session?: RuntimeSession
      text: string
      timestamp?: string
    }
  | {
      type: 'tool_call'
      task?: AgentTaskSpec
      session?: RuntimeSession
      toolName: string
      toolCallId?: string
      args?: unknown
      timestamp?: string
    }
  | {
      type: 'tool_result'
      task?: AgentTaskSpec
      session?: RuntimeSession
      toolName: string
      toolCallId?: string
      result?: unknown
      timestamp?: string
    }
  | {
      type: 'llm_call'
      task?: AgentTaskSpec
      session?: RuntimeSession
      model: string
      tokensIn?: number
      tokensOut?: number
      costUsd?: number
      latencyMs?: number
      finishReason?: string
      timestamp?: string
    }
  | {
      type: 'artifact'
      task?: AgentTaskSpec
      session?: RuntimeSession
      artifactId: string
      name?: string
      mimeType?: string
      uri?: string
      content?: string
      metadata?: Record<string, unknown>
      timestamp?: string
    }
  | {
      type: 'proposal_created'
      task?: AgentTaskSpec
      session?: RuntimeSession
      proposalId: string
      title: string
      status?: 'pending' | 'approved' | 'rejected'
      content?: string
      timestamp?: string
    }
  | {
      /** Strict provider-independent event carried alongside legacy projections. */
      type: 'canonical_event'
      event: import('@tangle-network/agent-interface').StreamEvent
      eventId?: string
      cursor?: string
      sequence?: number
      occurredAt?: string
      task?: AgentTaskSpec
      session?: RuntimeSession
      timestamp?: string
    }
  | {
      type: 'backend_error'
      task: AgentTaskSpec
      session?: RuntimeSession
      backend: string
      message: string
      recoverable: boolean
      error?: BackendErrorDetail
      timestamp: string
    }
  | {
      type: 'backend_end'
      task: AgentTaskSpec
      session: RuntimeSession
      backend: string
      timestamp: string
    }
  | {
      type: 'task_end'
      task: AgentTaskSpec
      status: AgentTaskStatus
      reason: string
      timestamp: string
    }
  | {
      type: 'final'
      task: AgentTaskSpec
      session?: RuntimeSession
      status: AgentTaskStatus
      reason: string
      text?: string
      metadata?: Record<string, unknown>
      error?: BackendErrorDetail
      timestamp: string
    }
