/**
 * Shared task, session, readiness, and transport contracts.
 *
 * These records are the lower-level vocabulary used by both the task APIs and
 * the stream event union. Keeping them below those compositions prevents the
 * public type hub from becoming a dependency of its own event types.
 *
 * @stable
 */

import type { ControlBudget, KnowledgeReadinessReport, KnowledgeRequirement } from '@tangle-network/agent-eval'
import type { AgentRunControlRef } from '@tangle-network/agent-interface'

/** @stable */
export interface AgentTaskSpec {
  id: string
  intent: string
  /** Domain is metadata, not an architectural boundary: tax, legal, gtm, creative, blueprint, redteam, etc. */
  domain?: string
  inputs?: Record<string, unknown>
  requiredKnowledge?: KnowledgeRequirement[]
  budget?: Partial<ControlBudget>
  metadata?: Record<string, unknown>
}

/** @stable */
export type AgentTaskStatus = 'completed' | 'blocked' | 'failed' | 'aborted'

/**
 * Typed transport / backend failure detail. Carried on `backend_error` and
 * `final` events when the backend's stream throws or the upstream HTTP call
 * returns a non-success status.
 *
 * @stable
 */
export interface BackendErrorDetail {
  /** `'transport'` is an upstream failure; `'backend'` is an adapter failure. */
  kind: 'transport' | 'backend'
  message: string
  /** Upstream HTTP status when known. `0` for connection / abort errors. */
  status?: number
  /** Truncated response body (≤2 KiB). Diagnostic only — never machine-parsed. */
  body?: string
}

/** @stable */
export interface RuntimeSession {
  id: string
  backend: string
  status: 'active' | 'completed' | 'failed' | 'aborted'
  resumeToken?: string
  /** Stable provider coordinates when this session controls a retained run. */
  controlRef?: AgentRunControlRef
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
}

/** @stable */
export interface KnowledgeReadinessDecision {
  passed: boolean
  status: 'ready' | 'blocked' | 'caveat'
  reason: string
  readinessScore: number
  recommendedAction: KnowledgeReadinessReport['recommendedAction']
  severity: KnowledgeReadinessReport['severity']
  blockingGapIds: string[]
  nonBlockingGapIds: string[]
}
