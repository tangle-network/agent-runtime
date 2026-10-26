import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type { RuntimeFailureCause } from '../../failure-cause'
import type { HarnessTranscriptEvidence } from '../../harness-transcript'
import type { Spend, SpendGap } from './accounting'
import type { UnconfirmedTeardown } from './agent-scope'
import type { AgentExecutionRef } from './execution-identity'
import type { TreeView } from './node-lifecycle'

/** Provider-observed model identity for the root manager's settled inference turns.
 * Runtime records this only from a Runtime-owned provider/bridge receipt; an authored profile
 * alias is never substituted when the provider omits the identity. */
export type RootProviderModelEvidence = ProviderModelExecutionEvidence

/**
 * The root manager's retained provider stream: `<runDir>/root-stream.jsonl`, one line per
 * progress event the root's executor observed, referenced by the content address of the file's
 * bytes and its committed line count. Present exactly when the run had a run directory and a
 * Runtime-driven root that began at least one drive attempt; a caller-supplied harness leaves it
 * absent, never an empty receipt. Distinct from `outRef`, which on a `winner` names the SELECTED
 * CHILD's artifact.
 */
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

/**
 * A driver's `act()` rejection, normalized to serializable evidence so it survives the typed
 * no-winner boundary (an `Error` does not cross a structured-clone / JSON hop intact). A
 * non-`Error` rejection normalizes to `{ name: 'NonError', message }` — never dropped.
 * Exported so a consumer handling `reason: 'driver-failed'` names this type instead of retyping
 * its fields.
 */
export interface NoWinnerError {
  name: string
  message: string
  stack?: string
  /** Structural failure evidence captured before the rejection becomes message text. */
  failure?: RuntimeFailureCause
}

/**
 * How this run's spawned CHILDREN ended, counted by node id off the complete journal FOREST at
 * root settlement — after the join barrier and the release sweep, so the terminal records the
 * sweep wrote are included, and forest-wide so a director's grandchildren count (the population
 * the observer projection shows). Invariant: `spawned === done + down + cancelled + neverSettled`.
 * Distinct from a no-winner's `downCount`, the breaker's tally of ordinary down settlements: a
 * released record is the driver's earlier down re-stated, so the breaker skips it and
 * `downCount` never includes a retained child, while `down` here does. `spendGaps` stays
 * root-tree scoped, so on a nested run the two disagree by design.
 */
export interface FleetYield {
  /** Every `spawned` record with a parent; the run root and an owned tree's re-rooted owner copy
   *  are exempt. */
  readonly spawned: number
  readonly done: number
  /** `settled` records with `status: 'down'`, released records included. */
  readonly down: number
  readonly cancelled: number
  /** Spawned with no terminal record: a crash-orphaned child, or a retained child of a run that
   *  keeps its environments for a resume (`retainedAtSettlement: 'keep'`). Named after
   *  `SpendGap`'s `never-settled`. */
  readonly neverSettled: number
  /** Terminal records marked `retainedExecution: 'released'` — a subset of `down + cancelled`.
   *  A nested manager whose OWN retained execution was released counts here beside the
   *  grandchildren it released, because its execution was destroyed unrecovered too. */
  readonly releasedUnrecovered: number
  /** Terminal records marked `retainedExecution: 'release-unconfirmed'` — a subset of
   *  `down + cancelled`, disjoint from `releasedUnrecovered`: executions a final settlement left
   *  unrecovered without confirming their environment destroyed. */
  readonly releaseUnconfirmed: number
}

/** Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output. */
export type SupervisedResult<Out> =
  | {
      kind: 'winner'
      out: Out
      outRef: string
      verdict?: DefaultVerdict
      tree: TreeView
      /** The run's terminal accounting. `iterations`/`tokens`/`usd` are per-channel journal sums;
       *  `ms` is the wall clock from supervise start (the ORIGINAL root instant on a resumed run)
       *  to this terminal state — executors under-report their own `ms` and parallel children
       *  overlap, so a per-event sum cannot state the run's real duration. `tokensKnown`/`usdKnown`
       *  are always explicit here: `true` is the checked claim that every spawn reached a terminal
       *  record and every settled/metered record carried a complete receipt on that channel;
       *  `false` comes with the unaccounted nodes named in `spendGaps`. */
      spentTotal: Spend
      /** Runtime-owned provider evidence for the root manager, when the root executed inference. */
      readonly rootProviderModel?: RootProviderModelEvidence
      /** The root manager's retained provider stream, when the run directory holds one. */
      readonly rootStream?: RootStreamReceipt
      /** The root manager's native harness session, persisted like a child's receipt. A child's
       *  receipt rides its settle record and the root has none, so the result carries it. Absent
       *  for a router-brained root, which runs no driver. */
      readonly rootHarnessTranscript?: HarnessTranscriptEvidence
      /** What the root's external driver loop did: genuine continuations, failure retries,
       *  environment replacements, why the loop ended, and how the root closed the run. Absent for
       *  a router-brained root, which runs no driver loop. */
      readonly continuation?: import('../driver-attempt-evidence').DriverContinuationRecord
      /** The root's caller-supplied attribution as it registered (`SuperviseOptions.execution`):
       *  a fork's lineage keys, a SearchSpec's `searchSpecDigest`. Absent when the caller set none. */
      readonly execution?: AgentExecutionRef
      /** Runtime-owned provider evidence reduced across the complete journal forest. */
      readonly providerModel?: ProviderModelExecutionEvidence
      /** Settled children whose teardown stayed unconfirmed after the settlement retry window
       *  (`teardownConfirmMs`) — the resources this run could not prove destroyed. Each names the
       *  provider environments a sweeper deletes when its executor reports them, and each is
       *  journaled as a `teardown-unconfirmed` event. Present exactly when non-empty; a healthy run
       *  never carries it. */
      teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>
      /** The journaled nodes whose usage accounting is incomplete — the named gaps behind a
       *  `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty. */
      spendGaps?: ReadonlyArray<SpendGap>
      /** How the fleet ended, see `FleetYield`. Always present: zeros are facts. */
      fleetYield: FleetYield
      /** Where `spentTotal` went: `driverInference` = the drivers' own chat turns (metered via
       *  `Scope.meter`); `childWork` = every spawned child's reconciled spend (the journal sum).
       *  `driverInference + childWork === spentTotal` on `iterations`/`tokens`/`usd`; the
       *  breakdown's `ms` fields stay executor-reported sums while `spentTotal.ms` is wall clock.
       *  Present whenever any driver metered. */
      spentBreakdown?: { driverInference: Spend; childWork: Spend }
    }
  | ({
      /**
       * The LIFECYCLE no-winner arms: the supervisor itself proved why nothing was delivered, so
       * the reason is complete on its own and there is no driver rejection to hand back. A tripped
       * breaker or every child down is `all-children-down`, a cascaded abort is `aborted`, the
       * run's own `budget.deadlineMs` passing is `deadline`, and a spent token, iteration, dollar
       * or resource pool is `budget-exhausted`. A run with no `deadlineMs` has no deadline ending.
       * These outrank `driver-failed`: when the driver threw BECAUSE the pool emptied, the
       * deadline passed or the run was aborted, the lifecycle cause is the explanation.
       * One down child among delivered siblings is not a lifecycle cause; it rides `downCount`.
       */
      kind: 'no-winner'
      tree: TreeView
      downCount: number
      /** The conserved spend incurred before the run failed — real cost is paid even when no
       *  worker delivers, so the caller always learns what the delegation actually spent. Summed
       *  off the same journal the `winner` path reads, with the same contract: wall-clock `ms`,
       *  explicit `tokensKnown`/`usdKnown`, gaps named in `spendGaps`. */
      spentTotal: Spend
      /** Runtime-owned provider evidence for the root manager, when the root executed inference. */
      readonly rootProviderModel?: RootProviderModelEvidence
      /** The root manager's retained provider stream, when the run directory holds one. */
      readonly rootStream?: RootStreamReceipt
      /** The root manager's native harness session, persisted like a child's receipt. A child's
       *  receipt rides its settle record and the root has none, so the result carries it. Absent
       *  for a router-brained root, which runs no driver. */
      readonly rootHarnessTranscript?: HarnessTranscriptEvidence
      /** What the root's external driver loop did: genuine continuations, failure retries,
       *  environment replacements, why the loop ended, and how the root closed the run. Absent for
       *  a router-brained root, which runs no driver loop. */
      readonly continuation?: import('../driver-attempt-evidence').DriverContinuationRecord
      /** The root's caller-supplied attribution as it registered (`SuperviseOptions.execution`):
       *  a fork's lineage keys, a SearchSpec's `searchSpecDigest`. Absent when the caller set none. */
      readonly execution?: AgentExecutionRef
      /** Runtime-owned provider evidence reduced across the complete journal forest. */
      readonly providerModel?: ProviderModelExecutionEvidence
      /** Settled children whose teardown stayed unconfirmed after the settlement retry window
       *  (`teardownConfirmMs`) — the resources this run could not prove destroyed. Each names the
       *  provider environments a sweeper deletes when its executor reports them, and each is
       *  journaled as a `teardown-unconfirmed` event. Present exactly when non-empty; a healthy run
       *  never carries it. */
      teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>
      /** Budget reservations still open when the run reached its join barrier, each named by the
       *  assignment, child id, and lifecycle stage that holds it. The conserved-pool identity
       *  `total ≡ free + reserved + committed` does not hold, so `spentTotal` is a floor rather
       *  than a measurement — the run still settles with the tree and the spend the journal
       *  recorded. Present exactly when non-empty; a healthy run never carries it. */
      leakedReservations?: ReadonlyArray<import('../budget').LeakedReservation>
      /** The journaled nodes whose usage accounting is incomplete — the named gaps behind a
       *  `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty. */
      spendGaps?: ReadonlyArray<SpendGap>
      /** How the fleet ended, see `FleetYield`. Always present: zeros are facts. */
      fleetYield: FleetYield
      /** Never present on a lifecycle arm — the discriminant, not prose, is what makes
       *  `if (r.reason === 'driver-failed') r.error.message` compile and every other arm refuse it. */
      error?: never
    } & (
      | {
          /**
           * `no-children-spawned`: the root ran to completion under budget, selected nothing, and
           * never spawned a child. Until this arm existed that run settled `all-children-down`
           * with `downCount: 0`, which reads as a fleet failure to anyone who did not open the
           * journal; fifteen sandbox-placed directors settled that way in one week while the
           * actual fault was that the root never recursed.
           *
           * `no-result-selected`: the root ran to completion under budget, spawned children, and
           * selected nothing while no child was down when it settled. Until this arm existed that
           * run also settled `all-children-down`: on the 2026-09-20 fleet corpus, 46 of the 57
           * runs carrying that reason had zero down children in their own `fleetYield`, and a
           * reader of the label learned that banking pages was losing. `all-children-down` now
           * asserts what its name says: the supervisor observed a down child, a tripped breaker,
           * or every child down, before the root settled.
           *
           * `stopped`: a flow graph's `stop` edge ended the run (`runGraph` names the edge and its
           * reason on `GraphResult.stopped`). The run returns; it does not throw.
           */
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
          /** Who stopped the run, as its durable cancel request named them. Absent for an
           *  in-process abort and for a request written before `cancelRun` required one. */
          readonly operator?: string
        }
    ))
  | {
      /**
       * The DRIVER-FAULT arm: `act()` rejected and no lifecycle cause (breaker/abort/budget/every
       * child down) outranks it — so nothing about the tree explains the failure and the driver's
       * own rejection is the only thing that does. It is therefore REQUIRED here. One down child
       * among delivered siblings does not outrank it: that count rides `downCount`.
       * `all-children-down` with `downCount: 0` used to be indistinguishable from an honest empty
       * result; this arm is that configuration/authoring fault, named.
       */
      kind: 'no-winner'
      reason: 'driver-failed'
      tree: TreeView
      downCount: number
      /** The conserved spend incurred before the run failed — real cost is paid even when no
       *  worker delivers, so the caller always learns what the delegation actually spent. Summed
       *  off the same journal the `winner` path reads, with the same contract: wall-clock `ms`,
       *  explicit `tokensKnown`/`usdKnown`, gaps named in `spendGaps`. */
      spentTotal: Spend
      /** Runtime-owned provider evidence for the root manager, when the root executed inference. */
      readonly rootProviderModel?: RootProviderModelEvidence
      /** The root manager's retained provider stream, when the run directory holds one. */
      readonly rootStream?: RootStreamReceipt
      /** The root manager's native harness session, persisted like a child's receipt. A child's
       *  receipt rides its settle record and the root has none, so the result carries it. Absent
       *  for a router-brained root, which runs no driver. */
      readonly rootHarnessTranscript?: HarnessTranscriptEvidence
      /** What the root's external driver loop did: genuine continuations, failure retries,
       *  environment replacements, why the loop ended, and how the root closed the run. Absent for
       *  a router-brained root, which runs no driver loop. */
      readonly continuation?: import('../driver-attempt-evidence').DriverContinuationRecord
      /** The root's caller-supplied attribution as it registered (`SuperviseOptions.execution`):
       *  a fork's lineage keys, a SearchSpec's `searchSpecDigest`. Absent when the caller set none. */
      readonly execution?: AgentExecutionRef
      /** Runtime-owned provider evidence reduced across the complete journal forest. */
      readonly providerModel?: ProviderModelExecutionEvidence
      /** Settled children whose teardown stayed unconfirmed after the settlement retry window
       *  (`teardownConfirmMs`) — the resources this run could not prove destroyed. Each names the
       *  provider environments a sweeper deletes when its executor reports them, and each is
       *  journaled as a `teardown-unconfirmed` event. Present exactly when non-empty; a healthy run
       *  never carries it. */
      teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>
      /** Budget reservations still open when the run reached its join barrier, each named by the
       *  assignment, child id, and lifecycle stage that holds it. The conserved-pool identity
       *  `total ≡ free + reserved + committed` does not hold, so `spentTotal` is a floor rather
       *  than a measurement — the run still settles with the tree and the spend the journal
       *  recorded. Present exactly when non-empty; a healthy run never carries it. */
      leakedReservations?: ReadonlyArray<import('../budget').LeakedReservation>
      /** The journaled nodes whose usage accounting is incomplete — the named gaps behind a
       *  `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty. */
      spendGaps?: ReadonlyArray<SpendGap>
      /** How the fleet ended, see `FleetYield`. Always present: zeros are facts. */
      fleetYield: FleetYield
      /** The driver's own rejection, carried across the typed no-winner boundary so the failure is
       *  recoverable by the caller. A non-`Error` rejection is normalized, never dropped. */
      error: NoWinnerError
    }
