/** Public read-only snapshot contracts shared by file and SQL inspection. */
import type { PursuitProjection } from '../durable/observer-projection'
import type { RouteFlowEvent } from '../mcp/tools/coordination-route-contracts'
import type { HarnessTranscriptEvidence } from '../runtime/harness-transcript'
import type {
  Budget,
  ExecutionBindingReceipt,
  NodeExecutionIdentity,
  ProfileMaterializationReceipt,
  Spend,
} from '../runtime/supervise/types'

export interface TopSnapshot {
  readonly root: string
  readonly generatedAt: number
  readonly supervisors: SupervisorView[]
  /** Canonical facts, including unknown accounting and requested/observed identities. */
  readonly pursuit?: PursuitProjection
  /** `partial` when at least one discovered source could not be read completely. */
  readonly completeness: TopSnapshotCompleteness
  /** One bounded entry per skipped or partially read source; empty when complete. */
  readonly diagnostics: ReadonlyArray<TopSnapshotDiagnostic>
  /** Run directories found under the runs roots, readable or not. */
  readonly discovered: number
  /** Run directories projected into a valid supervisor view. */
  readonly loaded: number
}

export type TopSnapshotCompleteness = 'complete' | 'partial'

export type TopSnapshotDiagnosticSource =
  | 'observer-journal'
  | 'supervisor-state'
  | 'journal'
  | 'progress'
  | 'worker-tail'

export type TopSnapshotDiagnosticReason =
  | 'unreadable'
  | 'partial-json'
  | 'invalid-state'
  | 'missing'

/**
 * One skipped or partially read snapshot source. `path` is relative to the run directory and
 * never carries file contents, so a diagnostic is safe to show or log without leaking run data.
 */
export interface TopSnapshotDiagnostic {
  readonly source: TopSnapshotDiagnosticSource
  readonly path: string
  readonly reason: TopSnapshotDiagnosticReason
  readonly runId?: string
}

interface SupervisorBase {
  readonly reason?: string
  readonly id: string
  readonly status: string
  readonly task: string
  readonly workspaceDir: string
  readonly budget: number
  readonly budgetKnown?: boolean
  readonly verifyCmd?: string
  readonly workerModel?: string
  readonly driverModel?: string
  readonly verdict?: string
  readonly progress?: string
  readonly startedAt?: string
  readonly completedAt?: string
  readonly maxSandboxes?: number
  readonly maxLifetimeSeconds?: number
  readonly idleTimeoutSeconds?: number
  readonly maxUsd?: number
  readonly maxDepth?: number
}

export interface SupervisorView extends SupervisorBase {
  readonly stateDir: string
  readonly outcome?:
    | { readonly kind: 'winner' }
    | { readonly kind: 'no-winner' | 'failed'; readonly reason: string }
  readonly lastRoute?: Extract<RouteFlowEvent, { kind: 'stopped' | 'unrouted' }>
  /** Epoch milliseconds of actual recorded executor activity, independent of tail truncation. */
  readonly lastActivityAt?: number
  /** Median gap between all recorded activity instants, including real zero gaps. */
  readonly medianEventGapMs?: number
  readonly resultSpentUsd?: number
  readonly resultSpentTokens?: number
  readonly workers: WorkerView[]
  readonly progressTail: string[]
  readonly journalTail: TopJournalEvent[]
  readonly driverSpend: SpendStats
  readonly totals: SupervisorTotals
}

export interface WorkerView {
  readonly harnessTranscript?: HarnessTranscriptEvidence
  readonly identity?: NodeExecutionIdentity
  readonly materialization?: ProfileMaterializationReceipt
  readonly executionBindings?: readonly ExecutionBindingReceipt[]
  readonly id: string
  readonly label: string
  readonly eventFile?: string
  readonly parent?: string
  readonly runtime?: string
  readonly status: 'running' | 'done' | 'down' | 'cancelled'
  readonly verdict?: string
  readonly infra?: boolean
  readonly startedAt?: string
  readonly endedAt?: string
  readonly latencyMs: number
  readonly budget?: BudgetStats
  readonly spend: SpendStats
  readonly metered: SpendStats
  readonly liveTail: string[]
  /** Epoch milliseconds of actual recorded executor activity, independent of tail truncation. */
  readonly lastActivityAt?: number
  /** Median gap between all recorded activity instants, including real zero gaps. */
  readonly medianEventGapMs?: number
  readonly outRef?: string
  /** The conversation the executor retained at settlement, when it retained one. */
  readonly transcript?: { readonly ref: string; readonly harness: string }
  readonly reason?: string
}

export interface SupervisorTotals
  extends Pick<SpendStats, 'tokensInput' | 'tokensOutput' | 'usd' | 'usdKnown' | 'tokensKnown'> {
  readonly workers: number
  readonly running: number
  readonly done: number
  readonly down: number
  readonly cancelled: number
  readonly inFlight: number
  readonly settled: number
  readonly tokensTotal: number
  readonly latencyMs: number
  readonly workerLatency: Distribution
}

export interface Distribution {
  readonly n: number
  readonly min: number
  readonly median: number
  readonly p90: number
  readonly max: number
}

export type BudgetStats = Partial<Pick<Budget, 'maxIterations' | 'maxTokens' | 'maxUsd'>>

export interface SpendStats
  extends Readonly<Pick<Spend, 'iterations' | 'usd' | 'ms' | 'usdKnown' | 'tokensKnown'>> {
  readonly tokensInput: number
  readonly tokensOutput: number
}

export type TopJournalEvent = {
  readonly id: string
  readonly seq?: number
  readonly at?: string
} & (
  | {
      readonly kind: 'spawned'
      readonly identity?: NodeExecutionIdentity
      readonly parent?: string
      readonly label?: string
      readonly budget?: unknown
      readonly runtime?: string
    }
  | {
      readonly kind: 'settled'
      readonly harnessTranscript?: HarnessTranscriptEvidence
      readonly status?: string
      readonly outRef?: string
      readonly verdict?: unknown
      readonly spent?: unknown
      readonly infra?: boolean
    }
  | {
      readonly kind: 'cancelled'
      readonly spent?: unknown
      readonly reason?: string
    }
  | {
      readonly kind: 'metered'
      readonly spend?: unknown
      readonly accountingOnly?: boolean
    }
  | { readonly kind: 'materialized'; readonly receipt: ProfileMaterializationReceipt }
  | { readonly kind: 'seat-materialized'; readonly receipt: ProfileMaterializationReceipt }
  | { readonly kind: 'execution-bound'; readonly binding: ExecutionBindingReceipt }
  | {
      readonly kind: 'progress'
      readonly spend?: unknown
    }
)

export interface SupervisorState extends SupervisorBase {
  readonly result?: {
    readonly spentUsd?: number
    readonly spentTokens?: number
  }
}
