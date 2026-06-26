/**
 * @experimental
 *
 * MCP delegation tool surface — the typed inputs/outputs the product agent
 * sees over the wire. These types are the contract; the JSON schemas under
 * `tools/*` mirror them for the MCP `tools/list` advertisement.
 *
 * Async semantics: `delegate_ui_audit` returns a `taskId` immediately. The
 * product agent polls `delegation_status` until the task transitions to
 * `completed` | `failed` | `cancelled`. `delegate_feedback` +
 * `delegation_history` are synchronous reads / writes against the local
 * task queue + feedback store.
 */

import type { CoderTask } from '../profiles/coder'
import type { UiFinding, UiLens } from '../profiles/ui-auditor/substrate'
import type { DelegationTraceSpan } from './delegation-trace'
import type { CoderOutput } from './detached-coder'

/** @experimental */
export type DelegationProfile = 'coder' | 'researcher' | 'ui-auditor'

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
  /**
   * Return the delegation's compact loop-trace span tree alongside the
   * status. Default false — status polls stay light; opt in when you need
   * the topology (which iterations ran, where they were placed, what each
   * cost) rather than just the state machine.
   */
  includeTrace?: boolean
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
  | { profile: 'ui-auditor'; output: UiAuditorDelegationOutput }

/**
 * Wire-shape of a completed UI-audit delegation. The `findings` array
 * contains every finding persisted to the workspace during the run,
 * already enriched with `id` and `createdAt` by the writer. `workspaceDir`
 * is the absolute path to the workspace; `indexFile` is the workspace-
 * relative path to the regenerated index.md.
 *
 * @experimental
 */
export interface UiAuditorDelegationOutput {
  workspaceDir: string
  indexFile: string
  findings: UiFinding[]
  /** Total iterations the loop ran for this delegation. */
  iterations: number
}

/** @experimental */
export type UiAuditLensFilter = readonly UiLens[]

/** Optional per-route capture spec the agent surfaces over the wire. */
export interface DelegateUiAuditRoute {
  /** Stable route name (used in screenshot filenames + finding metadata). */
  name: string
  /** Fully-qualified URL. */
  url: string
  /** Viewports to capture at. Defaults to `[{ width: 1280, height: 800 }]`. */
  viewports?: readonly { width: number; height: number }[]
  /** Default false. Full-page captures for the broad lenses. */
  fullPage?: boolean
  /** Selector to wait for before capture. */
  waitFor?: string
}

/** @experimental */
export interface DelegateUiAuditConfig {
  /**
   * Lenses to iterate. Default: every lens except `'other'`. Order is
   * preserved — the driver iterates lens-by-lens.
   */
  lenses?: UiAuditLensFilter
  /** Maximum total iterations across all (lens × route) pairs. Default 33 (11 lenses × 3 routes). */
  maxIterations?: number
  /** Maximum concurrent iterations within a single plan() round. Default 2. */
  maxConcurrency?: number
  /** Free-form product context surfaced to the judge. */
  productContext?: string
}

/** @experimental */
export interface DelegateUiAuditArgs {
  /** Workspace root for the audit (absolute path). */
  workspaceDir: string
  /** Routes to audit. Must be non-empty. */
  routes: readonly DelegateUiAuditRoute[]
  /** Multi-tenant scope. */
  namespace?: string
  config?: DelegateUiAuditConfig
}

/** @experimental */
export interface DelegateUiAuditResult {
  taskId: string
  estimatedDurationMs?: number
}

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
  /** Compact loop-trace span tree; present only when `includeTrace: true` was passed and spans were recorded. */
  trace?: DelegationTraceSpan[]
  /** Present when oldest trace spans were dropped to honor the trace caps. */
  traceTruncated?: true
  /** Inherited trace identity recorded at submit — join key into the caller's trace. */
  traceId?: string
  /** Caller span that dispatched the delegation, when one was inherited. */
  parentSpanId?: string
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
  args: DelegateCodeArgs | DelegateResearchArgs | DelegateUiAuditArgs
  status: DelegationStatus
  feedback?: DelegationFeedbackSnapshot[]
  costUsd?: number
  startedAt: string
  completedAt?: string
  /**
   * True when the record carries a journaled loop trace. History stays
   * light by design — fetch the spans via
   * `delegation_status { taskId, includeTrace: true }`.
   */
  hasTrace: boolean
  /** Inherited trace identity recorded at submit — join key into the caller's trace. */
  traceId?: string
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
