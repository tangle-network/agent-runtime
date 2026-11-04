import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type {
  AgentCandidateArtifactRef,
  Sha256Digest,
  WorkspaceCheckpointRef,
  WorkspaceCheckpointRequest,
} from '@tangle-network/agent-interface'
import type { RuntimeFailureCause } from '../../failure-cause'
import type { HarnessTranscriptEvidence } from '../../harness-transcript'
import type { RetainedRunEffect } from '../../retained-run-types'
import type { DriverAttemptRecord, DriverAttemptStop } from '../driver-attempt-evidence'
import type { EvidencePendingEvent, RetainedPendingCause } from '../retained-executor'
import type { Budget, BudgetViolation, Spend } from './accounting'
import type {
  ExecutionBindingReceipt,
  NodeExecutionIdentity,
  ProfileMaterializationReceipt,
} from './execution-identity'
import type { SpawnModelSubstitution } from './executor-construction'
import type {
  ExecutorResult,
  HeldEnvironment,
  HeldRelease,
  Runtime,
  WorkerTraceEvidence,
} from './executor-port'
import type { NodeId, NodeStatus, RetainedExecutionState, SubtreeSummary } from './node-lifecycle'
import type { RecursiveReservationPolicy, RootSegment } from './supervisor-port'
import type { ProviderModelExecutionEvidence } from './supervisor-result'

/** Journaled spawn-tree events (B1/B2). `seq` is the cursor order; `at` is an ISO
 *  timestamp for human inspection only (NOT a replay input). */

/** The file Runtime writes into a retained owner's workspace immediately before a checkpoint, and
 *  reads back from a restored environment to report whether the marker matches. */
export interface WorkspaceCheckpointMarker {
  /** Workspace-relative path. */
  readonly path: string
  readonly content: string
}

/**
 * The Merkle root over the events an output archived, as a journal record carries it beside that
 * output's `outRef`. `ref` is the content address of the stored `TraceRootArtifact`; `leafCount` is
 * the archived event count plus the summary leaf. Absent where the output archived no events, and
 * on records written before trace roots existed.
 */
export interface TraceRootReceipt {
  readonly root: string
  readonly ref: string
  readonly leafCount: number
}

export type SpawnEvent =
  | {
      kind: 'spawned'
      id: NodeId
      parent?: NodeId
      label: string
      /** The semantic spawn key (`SpawnOpts.key`), when the spawn carried one — what a resumed
       *  run matches to resolve the same assignment to its committed result. */
      key?: string
      /** Manager-scoped assignment identity used to join unkeyed and keyed work alike. */
      assignmentId?: string
      /** The settled sibling node this spawn replaces (`SpawnOpts.successorOf`). */
      successorOf?: NodeId
      /** The budget-stopped node whose held environment and session this node continues. */
      continues?: { ofWorker: NodeId; environmentId: string }
      budget: Budget
      runtime: Runtime
      /** Root-only opt-in owner-share contract. A resumed run must use the same policy; absent on
       * records that set none. */
      recursiveAdmission?: {
        policy: RecursiveReservationPolicy
      }
      /** Exact nested journal tree this node owns. Runtime writes this only after privately
       * attesting the executor as a recursive scope owner. Its absence means no tree is followed,
       * including records written before this field existed and caller leaves named `driver`. */
      ownedTreeRoot?: NodeId
      /** Exact profile/task digests plus trusted candidate/campaign attribution when available. */
      identity?: NodeExecutionIdentity
      /** `ResultBlobStore` key holding the AUTHORED child `AgentProfile` this spawn ran under.
       *  Distinct from `identity.profileDigest`: that is the canonical AgentProfile digest, which
       *  names the agent, while this is the blob store's own content address, which retrieves its
       *  bytes. Absent on records written before the body was persisted. */
      profileRef?: string
      /** Present when authorization ran this node on another model than its parent authored. */
      modelSubstitution?: SpawnModelSubstitution
      seq: number
      at: string
    }
  | {
      /** Exact task bytes durable before admitting a retained invocation. */
      kind: 'execution-input'
      id: NodeId
      taskRef: string
      /** @internal Whether this owner must preserve an unreceipted provider workspace on resume. */
      workspaceRetention?: boolean
      seq: number
      at: string
    }
  | {
      /** Credential-free retained-provider admission, committed before the next external effect. */
      kind: 'execution-admitted'
      id: NodeId
      admission: import('../../retained-run-types').RetainedRunAdmission
      seq: number
      at: string
    }
  | ({
      /** Recoverable output committed before releasing its provider environment. */
      kind: 'execution-result'
      id: NodeId
      traceRoot?: TraceRootReceipt
      seq: number
      at: string
    } & Omit<ExecutorResult<unknown>, 'out' | 'teardown'>)
  | {
      /**
       * Runtime stopped reconciling this node's unfinished retained invocation: it failed
       * reconciliation with the same pending cause on consecutive drives, or once when that
       * failure would otherwise have ended the run, so the next drive starts a new invocation
       * instead of repeating the refusal. Written only for an invocation with no committed result. No admission or result of the abandoned
       * invocation is accepted afterwards, so an execution that does finish later can never be
       * accepted beside its replacement.
       */
      kind: 'execution-abandoned'
      id: NodeId
      /** The `execution-input` sequence of the abandoned invocation. */
      inputSeq: number
      /** The cause every one of the consecutive reconciliation failures carried. */
      pendingCause: RetainedPendingCause
      /** How many consecutive drives failed reconciliation with that cause. */
      failures: number
      /** The last failure, as recorded. */
      detail: string
      /**
       * What the provider confirmed about the abandoned execution. `stopped`: the provider
       * stopped it or reported it not live, so nothing of it still runs. `uncertain`: nothing
       * could be confirmed; it may have run, may still be running, and its spend is unknown.
       */
      outcome: 'stopped' | 'uncertain'
      /** The provider's answer to the stop Runtime requested, when the invocation had dispatched. */
      stop?: { executionId: string; effect: RetainedRunEffect; error?: string }
      seq: number
      at: string
    }
  | {
      /** Capture output retained independently of terminal outcome, spend, and recovery state. */
      kind: 'execution-evidence'
      id: NodeId
      outRef: string
      traceRoot?: TraceRootReceipt
      seq: number
      at: string
    }
  | EvidencePendingEvent
  | {
      /** Volatile transport/session binding for exactly one attempt. The full binding is retained
       * only by digest; descriptor fields are safe structural labels, never credential-bearing URLs. */
      kind: 'execution-bound'
      id: NodeId
      binding: ExecutionBindingReceipt
      seq: number
      at: string
    }
  | {
      /** Trusted runtime transformation from the authorized profile to actual wire bytes. */
      kind: 'materialized'
      id: NodeId
      receipt: ProfileMaterializationReceipt
      seq: number
      at: string
    }
  | {
      kind: 'settled'
      id: NodeId
      status: 'done' | 'down'
      /** Content-addressed result pointer; rehydrates `out` from `ResultBlobStore`. */
      outRef?: string
      /** The trace root of the output at `outRef`, when this process stored it. */
      traceRoot?: TraceRootReceipt
      verdict?: DefaultVerdict
      spent: Spend
      /** Provider model evidence is independent from the planned materialization receipt. */
      providerModel?: ProviderModelExecutionEvidence
      infra?: boolean
      /** Runtime-classified diagnosis; absent only when older records did not carry it. */
      failure?: RuntimeFailureCause
      /** Exact child failure. Present on every new `status: 'down'` record; optional only so
       * journals written before this field existed remain replayable. */
      reason?: string
      /** Structured tool evidence. Optional only for journals written before trace capture. */
      trace?: WorkerTraceEvidence
      /** Whether this child's harness transcript survived, or the named reason it did not.
       *  Absent on journals written before the capture existed — which is not the same fact as
       *  a recorded `unavailable`, and is why this stays optional rather than defaulting. */
      harnessTranscript?: HarnessTranscriptEvidence
      /** Present when the reconciled spend exceeded the reservation, on either status. */
      budgetViolation?: BudgetViolation
      /** `'released'` is written by the release sweep in the settling process, on the same tree,
       *  after every `environment-teardown` receipt for the node reads `destroyed: true` and the
       *  executor's own teardown confirmed — or by `healReleasedSlots` on the next resume, when
       *  that process died between the last `destroyed: true` receipt and this record: the same
       *  builder, `seq` and `at`, read from the `reconciled` record, so the bytes are identical
       *  either way. `'release-unconfirmed'` is written by the same builder at the end of a final
       *  settlement for every retained node the release could not confirm: a `destroyed: false`
       *  receipt, an empty receipt set, or a refused teardown probe. Only a crash before that point
       *  or a `reconciled` record without `settledSeq` leaves the slot open.
       *  `spent` is this node's child-work component of the reconcile the pool committed — for
       *  a leaf the streamed floor itself, for a recursive executor its `accounting().reported`
       *  split with the remainder on its `metered` records — never the reservation ceiling.
       *  `reason`/`infra`/`trace`/`harnessTranscript`/`outRef`/`providerModel` are the
       *  settlement the driver received, verbatim; `seq` is the cursor seq stamped on that
       *  delivery, so replay yields it at the position the driver saw it; `at` is the settlement
       *  instant, and the release instant is on the receipt immediately before it. Typed so a
       *  `'pending'` can never be journaled: the journal states that as `reconciled`. */
      retainedExecution?: Exclude<RetainedExecutionState, 'pending'>
      retainedPendingCause?: RetainedPendingCause
      /** The bounded account of the team this child led, when it led one. */
      subtree?: SubtreeSummary
      seq: number
      at: string
    }
  | {
      kind: 'cancelled'
      id: NodeId
      reason: string
      source?: string
      infra?: boolean
      /** Runtime-classified diagnosis; absent only when older records did not carry it. */
      failure?: RuntimeFailureCause
      spent?: Spend
      providerModel?: ProviderModelExecutionEvidence
      trace?: WorkerTraceEvidence
      /** The child's harness transcript receipt, when the executor could still be read at the
       *  cancel. The settle path writes it on this record exactly as on `settled`. */
      harnessTranscript?: HarnessTranscriptEvidence
      outRef?: string
      traceRoot?: TraceRootReceipt
      budgetViolation?: BudgetViolation
      /** As on `settled`: a retained child that was cancelled settles `cancelled`, and the one
       *  builder writes whichever kind the settlement had. */
      retainedExecution?: Exclude<RetainedExecutionState, 'pending'>
      retainedPendingCause?: RetainedPendingCause
      /** The bounded account of the team this child led, when it led one. */
      subtree?: SubtreeSummary
      seq: number
      at: string
    }
  | {
      /** GRAPH ENGINE fold input: the exact inputs one node instance was given, pinned by content
       *  address BEFORE the instance spawns. `onCrash: 'restart'` re-runs from this ref, never
       *  through a transform someone has since changed. Kernel replay skips it. */
      kind: 'node-inputs-resolved'
      /** The engine instance label (`<node>#<visit>`), which the matching `spawned` also carries. */
      id: NodeId
      node: string
      instance: string
      inputRef: string
      seq: number
      at: string
    }
  | {
      /** GRAPH ENGINE fold input: what the scheduler DECIDED about one edge on one source
       *  completion — distinct from `edge`, which stays delivery observability. Kernel replay
       *  skips it; the engine fold consumes it as authority (never re-judged through changed
       *  guard code). */
      kind: 'edge-verdict'
      id: NodeId
      edge: string
      /** satisfied ⇒ true; dead or failed ⇒ false, with `sourceStatus` distinguishing. */
      fired: boolean
      sourceStatus: 'done' | 'down' | 'invalid'
      /** A consumption the traversal cap refused: the edge stays satisfied, the target may block. */
      capped?: boolean
      inputRef?: string
      toInstance?: string
      seq: number
      at: string
    }
  | {
      /** GRAPH ENGINE fold input: one join release — which gating edges produced it and which
       *  in-flight edges were consumed-once by the wave. Kernel replay skips it. */
      kind: 'join-state'
      id: NodeId
      node: string
      rule: 'all' | 'any' | 'any_failed' | 'all_done'
      satisfiedBy: ReadonlyArray<string>
      consumedPending: ReadonlyArray<string>
      /** The instance this release entered (`<node>#<visit>`). */
      instance: string
      seq: number
      at: string
    }
  | {
      /** A driver's OWN inference spend, journaled separately from spawned-child work — the journal
       *  TWIN of `BudgetPool.observe`, exactly as `settled` is the twin of `reconcile`. So every
       *  journal-based cost reader sums it automatically — the journal is the single cost ledger.
       *  It carries spend only and is NOT a settlement: replay + `materializeTreeView` skip it for
       *  structure, and its `seq` lives outside the cursor-uniqueness namespace. A
       *  driver re-homes its nested subtree's metered total up to its parent (like settled spend),
       *  so summing any sub-tree root yields that sub-tree's true driver-inference cost. */
      kind: 'metered'
      id: NodeId
      spend: Spend
      /** Runtime bookkeeping only; this record carries no provider inference attempt. */
      accountingOnly?: true
      /** Runtime-owned provider attempt evidence for this driver's own inference turn. */
      providerModel?: ProviderModelExecutionEvidence
      seq: number
      at: string
    }
  | {
      /** A live worker's cumulative metered spend, published while its stream is still running.
       * This is observation only: it never settles a node and never enters cost totals. The next
       * terminal `settled` event replaces it in read models, so a live snapshot can show movement
       * without charging the same spend twice. */
      kind: 'progress'
      id: NodeId
      spend: Spend
      /** Present on the row a worker publishes when it starts waiting on its exact result
       *  (`ExecutorProgressEvent` `awaiting-result`): the run page and the keeper see the wait. */
      awaitingResult?: { since: string }
      seq: number
      at: string
    }
  | {
      /** A retained child's reservation was reconciled at the child-work floor its executor had
       *  observed, while its cursor slot stays OPEN so a resume can recover the execution. It stands
       *  in for the `settled` record an open node cannot carry: cost readers and a restored pool
       *  charge this floor for the node instead of its declared ceiling, and a later `settled` or
       *  `cancelled` record for the same node supersedes it. That record has four writers: a
       *  resumed process's recovered settlement, the release sweep's terminal record marked
       *  `retainedExecution: 'released'`, the final settlement's record marked
       *  `'release-unconfirmed'` for a node whose release it could not confirm, or
       *  `healReleasedSlots` on the next resume when the process died between the last
       *  `environment-teardown` receipt and the released record. The last three carry the same
       *  settlement, because each reads it from THIS record or from the live child it mirrors: it
       *  is literally the settlement it stands in for, minus the cursor position it cannot hold. A
       *  driver's own inference travels on its `metered` record as on every other path, so
       *  `reconciled + metered` is what the pool committed. Its `seq` lives outside the
       *  cursor-uniqueness namespace; `settledSeq` is the cursor seq. */
      kind: 'reconciled'
      id: NodeId
      spent: Spend
      /** The transcript receipt of a retained-pending child. This record is the ONLY durable home
       *  it has: the node writes no `settled` record while its slot stays open, and these are the
       *  #1244 children exactly — dropped mid-run with a live box the capture read. A later
       *  terminal record for the node carries the same receipt forward. */
      harnessTranscript?: HarnessTranscriptEvidence
      /** The cursor seq `next()` stamped on the delivery this floor stands in for — what
       *  `finalizeSettlement` holds as `child.settledSeq` and the release sweep writes the
       *  terminal record under. A resume that heals a crashed sweep reads the seq back from here,
       *  so a record without it cannot be healed. Optional only so journals written before this
       *  field existed remain replayable. */
      settledSeq?: number
      /** The settlement the driver received, verbatim, as `settled`/`cancelled` carry it. Optional
       *  only so journals written before these fields existed remain replayable. */
      reason?: string
      retainedPendingCause?: RetainedPendingCause
      infra?: boolean
      /** Runtime-classified diagnosis; absent only when older records did not carry it. */
      failure?: RuntimeFailureCause
      trace?: WorkerTraceEvidence
      outRef?: string
      traceRoot?: TraceRootReceipt
      providerModel?: ProviderModelExecutionEvidence
      /** The overspend the RETAINED reconcile returned, which the open-slot surfaces withhold
       *  (`materializeTreeView` folds only `spent` from this record); journaled so the released
       *  record carries it without recomputation. */
      budgetViolation?: BudgetViolation
      /** Present iff the child had a `RunCancellationReason` when it settled; decides `settled`
       *  vs `cancelled` and its `source` on the released record. */
      cancellation?: { readonly source: string }
      seq: number
      at: string
    }
  | {
      /** A settled child whose executor teardown stayed unconfirmed after the settlement retry
       *  window: the run cannot prove the resource is gone. Recorded so the leak is durable
       *  evidence about the EXECUTOR, and the environment ids a sweeper deletes, rather than a
       *  cause of run failure.
       *  Informational: replay, `materializeTreeView`, and cost readers skip it, and its `seq` lives
       *  outside the cursor-uniqueness namespace. */
      kind: 'teardown-unconfirmed'
      id: NodeId
      label: string
      runtime: Runtime
      /** The node's terminal status when the barrier read it. */
      status: NodeStatus
      /** See `UnconfirmedTeardown.environments`: the ids a sweeper deletes. */
      environments?: ReadonlyArray<HeldEnvironment>
      /** See `UnconfirmedTeardown.kept`: environments held on purpose, never swept. */
      kept?: ReadonlyArray<HeldEnvironment>
      /** How many teardown requests Runtime sent the executor. */
      attempts?: number
      /** Why the last attempt did not confirm destruction. */
      detail?: string
      seq: number
      at: string
    }
  | {
      /** A settled node whose teardown was unconfirmed when the join barrier opened its
       *  settlement retry window (`teardownConfirmMs`). Written before the window, so the
       *  environment ids reach durable storage even if the process dies inside it. Each is
       *  followed by `teardown-confirmed` when a retry confirms the node, or by
       *  `teardown-unconfirmed` when the window closes first. A sweeper reading a journal whose
       *  run never settled deletes the `environments` of each pending node with neither.
       *  Informational: replay and cost readers skip it, and its `seq` lives outside the
       *  cursor-uniqueness namespace. */
      kind: 'teardown-pending'
      id: NodeId
      label: string
      runtime: Runtime
      status: NodeStatus
      /** See `UnconfirmedTeardown.environments`: the ids a sweeper deletes. */
      environments?: ReadonlyArray<HeldEnvironment>
      /** See `UnconfirmedTeardown.kept`: environments held on purpose, never swept. */
      kept?: ReadonlyArray<HeldEnvironment>
      /** How many teardown requests Runtime had sent the executor when the window opened. */
      attempts?: number
      /** Why the last attempt before the window did not confirm destruction. */
      detail?: string
      seq: number
      at: string
    }
  | {
      /** A `teardown-pending` node whose teardown a retry inside the settlement window confirmed:
       *  the executor destroyed what it held. Informational, outside the cursor namespace. */
      kind: 'teardown-confirmed'
      id: NodeId
      seq: number
      at: string
    }
  | {
      /** The provider still has this environment's record, but authoritatively reports its
       * compute terminal. A new invocation may restore its checkpoint in another environment;
       * the source still needs a separate teardown receipt at settlement. */
      kind: 'environment-terminal'
      id: NodeId
      provider: string
      environmentId: string
      status: 'failed' | 'expired'
      seq: number
      at: string
    }
  | {
      /** One provider environment a settled retained-pending child held, released at root
       *  settlement — or not. The run had reached a terminal outcome no later process resumes, so
       *  the environment its executor kept for recovery could never be recovered; this is the
       *  receipt of the supervisor's release, one per environment, naming the provider's own id
       *  so a fleet listing can be reconciled against it. A `destroyed: false` receipt carries why
       *  in `detail`, and the node is then also journaled as `teardown-unconfirmed`. When every
       *  receipt for a node is `destroyed: true` and the executor confirms teardown, the node's
       *  terminal `settled`/`cancelled` record with `retainedExecution: 'released'` follows on
       *  the same tree and closes the cursor slot; when the settling process dies between this
       *  receipt and that record, `healReleasedSlots` writes the same record on the next resume
       *  from the `reconciled` record. After a `destroyed: false` receipt, an empty receipt set, or
       *  an unconfirmed teardown, the environment may still exist: the node is journaled as
       *  `teardown-unconfirmed`, and its slot closes with `retainedExecution:
       *  'release-unconfirmed'` instead, because the settlement is final either way.
       *  Informational: replay, `materializeTreeView`, and cost readers skip it, and its `seq` is
       *  per node, outside the cursor-uniqueness namespace. */
      kind: 'environment-teardown'
      id: NodeId
      provider: string
      environmentId: string
      destroyed: boolean
      detail?: string
      /** Present when the environment was held after a budget stop: why the hold ended. */
      heldRelease?: HeldRelease
      seq: number
      at: string
    }
  | {
      /** Durable intent written before the provider creates a checkpoint. A missing result
       * is reconciled through exact operation lookup before its source can be released.
       * Informational, like `workspace-checkpoint`. */
      kind: 'workspace-checkpoint-requested'
      id: NodeId
      provider: string
      environmentId: string
      request: WorkspaceCheckpointRequest
      marker?: WorkspaceCheckpointMarker
      seq: number
      at: string
    }
  | {
      /** A durable checkpoint of a retained owner's workspace, taken while its manager coordinated.
       *  When the provider later loses the owner's environment, the next invocation is created from
       *  the latest of these, so a re-entered director keeps the files it wrote. `marker` is the
       *  file Runtime wrote into the workspace immediately before the checkpoint; a restored
       *  environment reports whether it holds that file with that content. Informational:
       *  replay, `materializeTreeView`, and cost readers skip it, and its `seq` is per node,
       *  outside the cursor-uniqueness namespace. */
      kind: 'workspace-checkpoint'
      id: NodeId
      provider: string
      /** The environment the checkpoint was taken from. */
      environmentId: string
      checkpoint: WorkspaceCheckpointRef
      marker?: WorkspaceCheckpointMarker
      seq: number
      at: string
    }
  | {
      /** Runtime is about to ask the provider for a fork of a checkpoint, to read its files. The
       *  record comes first, so a fork that a crash left alive is found by this key and destroyed
       *  at the owner's release. Informational, like `workspace-checkpoint`. */
      kind: 'workspace-checkpoint-fork-requested'
      id: NodeId
      provider: string
      /** The environment the checkpoint was taken from. */
      environmentId: string
      checkpointId: string
      idempotencyKey: string
      requestDigest: Sha256Digest
      seq: number
      at: string
    }
  | {
      /** The fork a checkpoint's capture reads exists and was reconstructed; the capture of its
       *  files starts now. It ends in `workspace-checkpoint-capture`, or in a
       *  `workspace-checkpoint-cleanup` that says why the checkpoint was kept. Informational,
       *  like `workspace-checkpoint`. */
      kind: 'workspace-checkpoint-fork-ready'
      id: NodeId
      provider: string
      /** The environment the checkpoint was taken from. */
      environmentId: string
      checkpointId: string
      fork: { idempotencyKey: string; environmentId: string }
      seq: number
      at: string
    }
  | {
      /** Whether the provider confirmed destroying a checkpoint capture's fork. A fork without a
       *  `destroyed` record is asked for again at the owner's release. Informational, like
       *  `workspace-checkpoint`. */
      kind: 'workspace-checkpoint-fork-teardown'
      id: NodeId
      provider: string
      /** The environment the checkpoint was taken from. */
      environmentId: string
      checkpointId: string
      fork: { idempotencyKey: string; environmentId: string }
      destroyed: boolean
      seq: number
      at: string
    }
  | {
      /** A checkpoint's files, read from a fork of it, stored in the run's content-addressed
       *  store as a tree before the checkpoint may be deleted. `tree.digest` names the manifest;
       *  every file it lists is an object of the same store. Informational, like
       *  `workspace-checkpoint`. */
      kind: 'workspace-checkpoint-capture'
      id: NodeId
      provider: string
      /** The environment the checkpoint was taken from. */
      environmentId: string
      checkpointId: string
      /** The fork the capture read, by its request key and environment; destroyed once this
       *  record is written. */
      fork: { idempotencyKey: string; environmentId: string }
      tree: {
        digest: Sha256Digest
        manifest: AgentCandidateArtifactRef
        files: number
        bytes: number
        storedBytes: number
      }
      seq: number
      at: string
    }
  | {
      /** Exact checkpoint cleanup outcome; unconfirmed resources remain pending across resume.
       *  `capturedDigest` is the tree of the checkpoint's files that a `workspace-checkpoint-capture`
       *  stored before the delete was asked for. `refused` says why the checkpoint was kept
       *  without a delete: its files are in no capture, so deleting it would lose them.
       *  Informational, like `workspace-checkpoint`. */
      kind: 'workspace-checkpoint-cleanup'
      id: NodeId
      provider: string
      environmentId: string
      checkpointId: string
      confirmed: boolean
      capturedDigest?: Sha256Digest
      refused?: string
      seq: number
      at: string
    }
  | {
      /** A new environment of a retained owner was created from a `workspace-checkpoint`, and
       *  Runtime read the checkpoint's marker back from it. `verified` is true only when the file
       *  held the exact content written before the checkpoint. Informational, like
       *  `workspace-checkpoint`. */
      kind: 'workspace-restored'
      id: NodeId
      provider: string
      /** The new environment. */
      environmentId: string
      checkpointId: string
      /** The environment the checkpoint was taken from. */
      sourceEnvironmentId: string
      verified: boolean
      detail?: string
      seq: number
      at: string
    }
  | {
      /** An end-of-turn workspace capture of this node's environment was requested; its
       *  `workspace-capture` record follows when it settles, so a capture in flight is one
       *  without that record. Informational, like `workspace-checkpoint`. */
      kind: 'workspace-capture-started'
      id: NodeId
      /** The Runtime invocation the capture belongs to. */
      executionId: string
      environmentId: string
      seq: number
      at: string
    }
  | {
      /** One end-of-turn workspace capture of this node's environment and where its time went.
       *  Captures queue on one port that every recursive environment shares, so `queuedMs` is
       *  the wait behind other nodes' captures and `captureMs` the capture and its verification.
       *  Informational, like `workspace-checkpoint`; `seq` counts this node's records. */
      kind: 'workspace-capture'
      id: NodeId
      /** The Runtime invocation the capture belongs to. */
      executionId: string
      environmentId: string
      /** Captures holding or waiting for a slot when this one was requested. */
      ahead: number
      queuedMs: number
      /** Absent when the capture never held a slot. */
      captureMs?: number
      /** Bytes of the verified workspace archive. */
      archiveBytes?: number
      outcome: 'captured' | 'failed'
      error?: string
      /** The capture port's own split of `captureMs`, in its names and units (ms, bytes). */
      stages?: Readonly<Record<string, number>>
      seq: number
      at: string
    }
  | {
      /** One GRAPH-EDGE traversal (`runGraph`): what the runtime actually DELIVERED across a
       *  delegates/analyzes edge, with byte counts — the observability that makes an edge's
       *  directive trustable and therefore optimizable. Informational: replay,
       *  `materializeTreeView`, and cost readers skip it; its `seq` is the per-run edge-ledger
       *  ordinal, outside the cursor-uniqueness namespace. */
      kind: 'edge'
      /** The destination node when known (a spawned worker's id), else `graph:<node>`. */
      id: NodeId
      /** The node that drives this edge's graph, when a manager started the graph with `run_graph`.
       *  One run journal can then hold several graphs' ledgers; absent for the run's own graph. */
      graph?: NodeId
      edge: {
        kind: 'delegates' | 'analyzes' | 'maps' | 'routes' | 'data'
        from: string
        to: string
        /** The resolved directive reference (`<surface>/v<n>`), never the directive bytes.
         *  Absent on a `data` edge, which carries a port binding instead. */
        directive?: string
        /** `data` edges: the target input port the payload bound to. */
        port?: string
      }
      /** 1-based traversal ordinal for THIS edge within the run. */
      traversal: number
      outcome: 'delivered' | 'stripped' | 'empty' | 'unpropagated' | 'failed'
      /** A maps edge's row: the list's expansion, one item by index, or the join. */
      map?: { phase: 'expand' | 'item' | 'join'; index?: number }
      /** A flow gate's decision row (`from` is the gate, `traversal` its visit): who decided and
       *  the choice or stop reason. A resumed run replays it instead of asking again. */
      gate?: { by: string } & ({ choice: string } | { stop: string })
      /** How the hop CONTINUED the node's work: spawn traversals stamp their effective mode
       *  (`'fresh'` = new session, `'resume'` = re-attached to the node's prior settled session),
       *  and every mid-run delivery into an already-live recipient — a driver steer leg and every
       *  analyzes delivery — stamps `'steer'`. Optional only so journals written before
       *  continuity stamping remain replayable; every new event carries it. */
      continuity?: 'fresh' | 'resume' | 'steer'
      /** Bytes of directive + payload that actually crossed the edge (0 for `empty`). */
      bytes: number
      /** Why a non-`delivered` outcome happened, when the runtime knows. */
      reason?: string
      seq: number
      at: string
    }
  | {
      /** A spawned worker ran WITHOUT the run's trace context because its backend has no channel
       *  to carry one — the severed distributed-trace hop, journaled so a disconnected child trace
       *  is a queryable fact instead of a silent stranger tree. The child-side twin is the
       *  `tangle.trace.unpropagated=true` span attribute a fallback-minted root stamps.
       *  Informational: replay, `materializeTreeView`, and cost readers skip it; `seq` shares the
       *  spawn-ordinal namespace of the `spawned` event it annotates. */
      kind: 'trace-unpropagated'
      id: NodeId
      /** The trace id the worker SHOULD have inherited. */
      expectedTraceId: string
      /** The worker-execution backend that has no propagation channel. */
      backend: string
      reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted'
      seq: number
      at: string
    }
  | {
      /** A subscription segment boundary. Informational: execution and cost replay skip it.
       * The open and close records share a segment index, and never contain credentials. */
      kind: 'seat-segment'
      id: NodeId
      segmentIndex: number
      stageIndex: number
      phase: 'started' | 'ended'
      seat: string
      harness: string
      provider: string
      model: string
      reason?: 'usage-limit' | 'completed' | 'failed' | 'cancelled' | 'paused'
      seq: number
      at: string
    }
  | {
      /** Exact materialization for a later, authorized segment of the node: a subscription seat segment, or for
       *  the root a `root-segment` (another model, effort or harness of its registered profile). */
      kind: 'seat-materialized'
      id: NodeId
      segmentIndex: number
      receipt: ProfileMaterializationReceipt
      seq: number
      at: string
    }
  | {
      /** One completed manager driver attempt, recorded before retry or observer callbacks.
       * Errors are redacted and bounded. Informational: replay and cost readers skip it.
       * `seq` counts this node's driver records across coordinator restarts. */
      kind: 'driver-attempt'
      id: NodeId
      record: DriverAttemptRecord
      /** Runtime execution attempt identity when the manager uses a deferred executor. */
      attemptId?: string
      seq: number
      at: string
    }
  | {
      /** Every authored seat was unavailable. The agent holds no model turn until this reset. */
      kind: 'seat-paused'
      id: NodeId
      resumeAt: string
      seq: number
      at: string
    }
  | ({
      /** A nonterminal root wait handed to the caller's keeper after its idle threshold. */
      kind: 'run-parked'
      id: NodeId
      seq: number
      at: string
    } & import('../run-parking').RunParkingRecord)
  | {
      /** The root entered a new segment of its run (`SupervisorOpts.rootSegment`): its model,
       *  reasoning effort, harness or the caller's stack differs from the segment it last ran. The
       *  run keeps its id, recorded identity and settled children; this record says what the root
       *  runs on from here, since when, and why. `from` is absent on the run's first record when
       *  nothing ran before it. Informational: replay and cost readers skip it. */
      kind: 'root-segment'
      id: NodeId
      from?: RootSegment
      to: RootSegment
      reason: string
      seq: number
      at: string
    }
  | {
      /** A supervisor resumed a run that an earlier process drove, typically one that stopped
       *  without settling it after a host reboot, a crash, or a killed process. `live` names every
       *  worker the journal held open at that moment; `replaced` names those this process
       *  re-placed, so the rest are gone. The root is re-driven with both, and no re-entered drive
       *  counts toward its barren streak until the root has streamed a model event in this
       *  process. Infrastructure evidence: replay and cost readers skip it; `seq` counts this run's
       *  re-entries. */
      kind: 'root-reentered'
      id: NodeId
      live: ReadonlyArray<NodeId>
      replaced: ReadonlyArray<NodeId>
      seq: number
      at: string
    }
  | {
      /** An operator reopened this settled run under its own run id (`supervisePursuit`'s
       *  `reopen`): the settle record was archived byte for byte as `prior.archivedAs`, and the
       *  run resumed from this journal. `budget`, when present, is the budget the reopened run is
       *  held to and the one a later resume must match. Infrastructure evidence: replay and cost
       *  readers skip it; `seq` counts this run's reopens. */
      kind: 'reopened'
      id: NodeId
      operator: string
      reason: string
      /** The caller's idempotency key: a reopen that crashed partway finishes under the same id. */
      operationId: string
      prior: {
        /** The archived result's `kind` and, when it has one, its `reason`. */
        readonly kind: string
        readonly reason?: string
        /** `settleRecordDigest` of the archived result. */
        readonly digest: string
        /** The archive, relative to the run directory, such as `settles/1.json`. */
        readonly archivedAs: string
      }
      budget?: Budget
      seq: number
      at: string
    }
  | {
      /** A manager's driver paused before re-entering instead of failing or stopping. Either an
       *  unavailable upstream refused its turn (an exhausted quota, a rate limit, an overload), or
       *  an opted-in root met a stop and paused in its place (`driverRetry.pauseRootStops`): such
       *  a stop-pause carries `replacesStop`, `streak` and `resumeAt`, and is the operator's
       *  alarm. `attemptMs` is the attempt (0 for an admission refusal), `pauseMs` the wait that
       *  followed. Informational: replay, `materializeTreeView`, and cost readers skip it; `seq`
       *  counts this node's pauses. */
      kind: 'paused'
      id: NodeId
      /** The driver attempt that was refused, 1-based. */
      attempt: number
      /** The code or HTTP status that classified the refusal, such as `provider_quota_exhausted`;
       *  for a stop-pause, the recoverable stop it replaced, such as `max-attempts`. */
      signal: string
      /** The refusal or failure as the driver saw it, redacted and bounded; for a stop-pause with
       *  no failure (an admission or continuation refusal), the stop's name. */
      cause: string
      attemptMs: number
      pauseMs: number
      /** Whether the refused attempt still moved the run toward its deliverable. */
      madeProgress: boolean
      /** The stop an opted-in root paused on instead of ending the run. */
      replacesStop?: DriverAttemptStop
      /** With `replacesStop`: stop-pauses in a row since an attempt last made progress, 1-based. */
      streak?: number
      /** With `replacesStop`: ISO 8601, when the next drive starts unless a steer or a cancel comes
       *  first. */
      resumeAt?: string
      seq: number
      at: string
    }
  | {
      /** A manager's re-entered drives completed without progress `streak` times in a row, at or
       *  past its `continuation.maxBarren`, and the driver paused before the next continuation
       *  instead of ending the run. One row per pause, for an operator alarm. Informational:
       *  replay, `materializeTreeView`, and cost readers skip it; `seq` counts this node's barren
       *  pauses. */
      kind: 'barren-pause'
      id: NodeId
      /** The completed driver attempt the pause follows, 1-based. */
      attempt: number
      streak: number
      pauseMs: number
      /** ISO 8601: when the next drive may start. */
      resumeAt: string
      /** ISO 8601: when the manager's last attempt that made progress ended, or when its driver
       *  loop began in this process if none has. */
      lastProgressAt: string
      seq: number
      at: string
    }

/**
 * The spawn-tree event source (begin/append/load).
 * `loadTree` returns events for inspection and completed-settlement replay, not live process
 * recovery; `appendEvent` runs only AFTER the event is observed-committed (never speculative).
 */
export interface SpawnJournal {
  loadTree(root: NodeId): Promise<SpawnEvent[] | undefined>
  beginTree(root: NodeId, at: string): Promise<void>
  appendEvent(root: NodeId, ev: SpawnEvent): Promise<void>
  /** Publish all events together or none; SQL contexts use this for initialization records. */
  appendEvents?(root: NodeId, events: ReadonlyArray<SpawnEvent>): Promise<void>
}

/** Content-addressed result blobs (the `outRef` → artifact map) backing the replay
 *  invariant. Split from the journal so the journal stays small (decisions) and the
 *  payloads (evidence) live where a viewer/replayer rehydrates them. */
export interface ResultBlobStore {
  put(outRef: string, artifact: unknown): Promise<void>
  get(outRef: string): Promise<unknown | undefined>
}
