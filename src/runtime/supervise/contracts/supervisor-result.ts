import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type { RuntimeFailureCause } from '../../failure-cause'
import type { HarnessTranscriptEvidence } from '../../harness-transcript'
import type { SettledUsage } from '../settled-usage'
import type { Spend, SpendGap } from './accounting'
import type { UnconfirmedTeardown } from './agent-scope'
import type { AgentExecutionRef } from './execution-identity'
import type { TreeView } from './node-lifecycle'

export type { SettledUsage } from '../settled-usage'

/** Provider receipts only; requested aliases never fill missing served identity. */
export type RootProviderModelEvidence = ProviderModelExecutionEvidence

/** Root executor progress, when captured; outRef instead names selected output. */
export interface RootStreamReceipt {
  /** `sha256:<hex>` over the file's bytes as they were when the receipt was taken. */
  readonly ref: string
  /** Committed lines in the file. `0` is a root that drove and produced no observable output. */
  readonly events: number
  /** Subagent sessions the harness itself spawned, as its `task` tool results named them
   *  (#1264: a completed subagent reached no record before). Absent when none were observed. */
  readonly subagentSessionIds?: readonly string[]
}

/** An empty observation list is unknown served identity unless dispatch was proven not started. */
export interface ProviderModelAttemptEvidence {
  readonly observations: ReadonlyArray<string>
  readonly identityConflict?: boolean
  /** Router-owned proof that this attempt never reached a provider. */
  readonly providerDispatch?: 'not_started'
}

/** Durable provider identity evidence, independent from the planned materialization alias. */
export type ProviderModelExecutionEvidence =
  | {
      readonly status: 'known'
      readonly attempts: ReadonlyArray<ProviderModelAttemptEvidence>
      readonly models: ReadonlyArray<string>
    }
  | {
      readonly status: 'unknown'
      readonly attempts: ReadonlyArray<ProviderModelAttemptEvidence>
      readonly models: ReadonlyArray<string>
      readonly reason: 'provider-model-missing' | 'provider-model-conflict'
    }

/** Serializable act() rejection; non-Errors retain name NonError and their message. */
export interface NoWinnerError {
  name: string
  message: string
  stack?: string
  /** Structural failure evidence captured before the rejection becomes message text. */
  failure?: RuntimeFailureCause
}

/** Children across the owned forest after the join barrier and release sweep.
 * spawned === done + down + cancelled + neverSettled. Unlike the breaker's downCount,
 * down includes released retained children. spendGaps and tree read the whole forest (#1189). */
export interface FleetYield {
  /** Spawned children; excludes root and synthetic owned-tree root copies. */
  readonly spawned: number
  readonly done: number
  /** `settled` records with `status: 'down'`, released records included. */
  readonly down: number
  readonly cancelled: number
  /** Spawned without a terminal record: crash-orphaned or retained for resume. */
  readonly neverSettled: number
  /** Released without recovery; a subset of down + cancelled. */
  readonly releasedUnrecovered: number
  /** Teardown unconfirmed; a disjoint subset of down + cancelled. */
  readonly releaseUnconfirmed: number
}

/** Terminal receipt fields accompany every outcome; usage preserves measured lower bounds.
 * The established union arms remain explicit for consumers of the public declaration. */
export type SupervisedResult<Out> =
  | {
      kind: 'winner'
      out: Out
      outRef: string
      verdict?: DefaultVerdict
      tree: TreeView
      spentTotal: Spend
      readonly usage?: SettledUsage
      readonly rootProviderModel?: RootProviderModelEvidence
      readonly rootStream?: RootStreamReceipt
      readonly rootHarnessTranscript?: HarnessTranscriptEvidence
      readonly continuation?: import('../driver-attempt-evidence').DriverContinuationRecord
      readonly execution?: AgentExecutionRef
      readonly providerModel?: ProviderModelExecutionEvidence
      teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>
      spendGaps?: ReadonlyArray<SpendGap>
      fleetYield: FleetYield
      spentBreakdown?: { driverInference: Spend; childWork: Spend }
    }
  | ({
      kind: 'no-winner'
      tree: TreeView
      downCount: number
      spentTotal: Spend
      readonly usage?: SettledUsage
      readonly rootProviderModel?: RootProviderModelEvidence
      readonly rootStream?: RootStreamReceipt
      readonly rootHarnessTranscript?: HarnessTranscriptEvidence
      readonly continuation?: import('../driver-attempt-evidence').DriverContinuationRecord
      readonly execution?: AgentExecutionRef
      readonly providerModel?: ProviderModelExecutionEvidence
      teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>
      leakedReservations?: ReadonlyArray<import('../budget').LeakedReservation>
      spendGaps?: ReadonlyArray<SpendGap>
      fleetYield: FleetYield
      error?: never
    } & (
      | {
          reason:
            | 'all-children-down'
            | 'no-children-spawned'
            | 'no-result-selected'
            | 'stopped'
            | 'budget-exhausted'
            | 'deadline'
            | 'aborted'
        }
      | {
          reason: 'cancelled'
          readonly source: string
          readonly cancellationReason: string
          readonly operationId?: string
          readonly operator?: string
        }
    ))
  | {
      kind: 'no-winner'
      reason: 'driver-failed'
      tree: TreeView
      downCount: number
      spentTotal: Spend
      readonly usage?: SettledUsage
      readonly rootProviderModel?: RootProviderModelEvidence
      readonly rootStream?: RootStreamReceipt
      readonly rootHarnessTranscript?: HarnessTranscriptEvidence
      readonly continuation?: import('../driver-attempt-evidence').DriverContinuationRecord
      readonly execution?: AgentExecutionRef
      readonly providerModel?: ProviderModelExecutionEvidence
      teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>
      leakedReservations?: ReadonlyArray<import('../budget').LeakedReservation>
      spendGaps?: ReadonlyArray<SpendGap>
      fleetYield: FleetYield
      error: NoWinnerError
    }
