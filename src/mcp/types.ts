/**
 * @experimental
 *
 * MCP delegation tool surface — the typed inputs/outputs the product agent
 * sees over the wire. These types are the contract; the JSON schemas under
 * `tools/*` mirror them for the MCP `tools/list` advertisement.
 *
 * Async semantics: `delegate_code` + `delegate_research` return a `taskId`
 * immediately. The product agent polls `delegation_status` until the task
 * transitions to `completed` | `failed` | `cancelled`. `delegate_feedback`
 * + `delegation_history` are synchronous reads / writes against the local
 * task queue + feedback store.
 */

import type { CoderOutput, CoderTask } from '../profiles/coder'

/** @experimental */
export type DelegationProfile = 'coder' | 'researcher'

/** @experimental */
export type DelegationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

/**
 * Minimal `CoderTask` overrides exposed over the MCP wire. The full
 * `CoderTask` carries fields the kernel synthesizes from `goal` +
 * `repoRoot` — the agent only edits the few that materially gate
 * validator behavior.
 *
 * @experimental
 */
export interface DelegateCodeConfig {
  testCmd?: string
  typecheckCmd?: string
  forbiddenPaths?: string[]
  maxDiffLines?: number
}

/** @experimental */
export interface DelegateCodeArgs {
  /** Natural-language description of what the coder must accomplish. */
  goal: string
  /** Absolute path inside the sandbox where the repo lives. */
  repoRoot: string
  /** Optional free-form context the agent surfaces in the prompt prelude. */
  contextHint?: string
  /**
   * When > 1, dispatches `multiHarnessCoderFanout` across N harnesses
   * (claude-code, codex, opencode-glm) and picks the highest-scoring
   * passing patch. Default 1.
   */
  variants?: number
  /** Validator + prompt overrides the agent knows for this repo. */
  config?: DelegateCodeConfig
  /** Multi-tenant scope (customer-id, workspace-id). */
  namespace?: string
}

/** @experimental */
export interface DelegateCodeResult {
  taskId: string
  /** Best-effort hint — coder loops can take minutes-to-hours. */
  estimatedDurationMs?: number
}

/** @experimental */
export type ResearchSource = 'web' | 'corpus' | 'twitter' | 'github' | 'docs'

/** @experimental */
export interface DelegateResearchConfig {
  recencyWindow?: { since?: string; until?: string }
  maxItems?: number
  minConfidence?: number
}

/** @experimental */
export interface DelegateResearchArgs {
  question: string
  namespace: string
  scope?: string
  sources?: ResearchSource[]
  variants?: number
  config?: DelegateResearchConfig
}

/** @experimental */
export interface DelegateResearchResult {
  taskId: string
  estimatedDurationMs?: number
}

/** @experimental */
export interface FeedbackRefersTo {
  kind: 'delegation' | 'artifact' | 'outcome'
  /** For `'delegation'`, this is the taskId. */
  ref: string
}

/** @experimental */
export interface FeedbackRating {
  /** [0, 1]. */
  score: number
  label?: 'good' | 'bad' | 'neutral' | 'mixed'
  notes: string
}

/** @experimental */
export interface DelegateFeedbackArgs {
  refersTo: FeedbackRefersTo
  rating: FeedbackRating
  by: 'agent' | 'user' | 'downstream-judge'
  /** ISO timestamp; defaults to server clock when omitted. */
  capturedAt?: string
  namespace?: string
}

/** @experimental */
export interface DelegateFeedbackResult {
  recorded: true
  id: string
}

/** @experimental */
export interface DelegationStatusArgs {
  taskId: string
}

/** @experimental */
export interface DelegationProgress {
  iteration: number
  phase: string
}

/** @experimental */
export interface DelegationError {
  message: string
  kind: string
}

/**
 * Polymorphic `result` field: `CoderOutput` when the underlying profile
 * is `'coder'`, a structurally-typed research output when `'researcher'`.
 * The MCP wire carries it as JSON either way.
 *
 * @experimental
 */
export type DelegationResultPayload =
  | { profile: 'coder'; output: CoderOutput }
  | { profile: 'researcher'; output: ResearchOutputShape }

/**
 * Loose shape of a research output over the wire — the substrate cannot
 * import the `ResearchOutput` type from agent-knowledge without inducing
 * a dependency cycle, so the MCP layer treats it structurally.
 *
 * @experimental
 */
export interface ResearchOutputShape {
  items: unknown[]
  citations: unknown[]
  proposedWrites: unknown[]
  gaps?: string[]
  notes?: string
  [key: string]: unknown
}

/** @experimental */
export interface DelegationStatusResult {
  taskId: string
  profile: DelegationProfile
  status: DelegationStatus
  progress?: DelegationProgress
  result?: DelegationResultPayload
  error?: DelegationError
  costUsd?: number
  startedAt: string
  completedAt?: string
}

/** @experimental */
export interface DelegationHistoryArgs {
  namespace?: string
  profile?: DelegationProfile
  /** ISO date — only delegations started at-or-after `since` are returned. */
  since?: string
  /** Default 50. Hard cap 500. */
  limit?: number
}

/** @experimental */
export interface DelegationFeedbackSnapshot {
  id: string
  score: number
  label?: FeedbackRating['label']
  by: DelegateFeedbackArgs['by']
  notes: string
  capturedAt: string
}

/** @experimental */
export interface DelegationHistoryEntry {
  taskId: string
  profile: DelegationProfile
  namespace?: string
  args: DelegateCodeArgs | DelegateResearchArgs
  status: DelegationStatus
  feedback?: DelegationFeedbackSnapshot[]
  costUsd?: number
  startedAt: string
  completedAt?: string
}

/** @experimental */
export interface DelegationHistoryResult {
  delegations: DelegationHistoryEntry[]
}

/**
 * Re-export `CoderTask` so callers wiring custom delegates don't have to
 * import from `./profiles` themselves.
 *
 * @experimental
 */
export type { CoderOutput, CoderTask }
