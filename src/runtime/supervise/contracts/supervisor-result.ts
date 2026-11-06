import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type { RuntimeFailureCause } from '../../failure-cause'
import type { HarnessTranscriptEvidence } from '../../harness-transcript'
import type { SettledUsage } from '../settled-usage'
import type { Spend, SpendGap } from './accounting'
import type { UnconfirmedTeardown } from './agent-scope'
import type { AgentExecutionRef } from './execution-identity'
import type { TreeView } from './node-lifecycle'

export type { SettledUsage } from '../settled-usage'

/** Provider-observed model identity for the root manager's settled inference turns.
 * Runtime records this only from a Runtime-owned provider/bridge receipt; an authored profile
 * alias is never substituted when the provider omits the identity. */
export type RootProviderModelEvidence = ProviderModelExecutionEvidence

/** Root executor progress retained in root-stream.jsonl; outRef instead names selected output.
 * Absent for caller-supplied harnesses or roots that never began a drive. */
export interface RootStreamReceipt {
  /** `sha256:<hex>` over the file's bytes as they were when the receipt was taken. */
  readonly ref: string
  /** Committed lines in the file. `0` is a root that drove and produced no observable output. */
  readonly events: number
}

/** One provider/harness inference attempt. An empty observation list means the attempt started but
 * no trusted served model identity arrived before it failed or ended, unless Router explicitly
 * proves that admission rejected it before provider dispatch. */
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
 * down includes released retained children. spendGaps remains root-tree scoped. */
export interface FleetYield {
  /** Spawned children; excludes root and synthetic owned-tree root copies. */
  readonly spawned: number
  readonly done: number
  /** `settled` records with `status: 'down'`, released records included. */
  readonly down: number
  readonly cancelled: number
  /** Spawned with no terminal record: a crash-orphaned child, or a retained child of a run that
   *  keeps its environments for a resume (`retainedAtSettlement: 'keep'`). Named after
   *  `SpendGap`'s `never-settled`. */
  readonly neverSettled: number
  /** Released without recovery; a subset of down + cancelled. */
  readonly releasedUnrecovered: number
  /** Teardown unconfirmed; a disjoint subset of down + cancelled. */
  readonly releaseUnconfirmed: number
}

/** Evidence shared by every terminal outcome. Requested models never stand in for served models. */
export interface SettledRunEvidence {
  tree: TreeView
  /** Recorded usage, with explicit completeness flags; ms is elapsed wall time. */
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
}

/** A no-winner never carries a best-effort output; only driver-failed carries an error. */
export type SupervisedResult<Out> = SettledRunEvidence &
  (
    | {
        kind: 'winner'
        out: Out
        outRef: string
        verdict?: DefaultVerdict
        /** Driver inference plus child work equals spentTotal; executor times may overlap. */
        spentBreakdown?: { driverInference: Spend; childWork: Spend }
      }
    | ({
        kind: 'no-winner'
        downCount: number
        /** Open reservations at settlement; usage remains the recorded lower bound. */
        leakedReservations?: ReadonlyArray<import('../budget').LeakedReservation>
        error?: never
      } & (
        | {
            /** Lifecycle causes outrank a driver rejection. */
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
        downCount: number
        leakedReservations?: ReadonlyArray<import('../budget').LeakedReservation>
        error: NoWinnerError
      }
  )
