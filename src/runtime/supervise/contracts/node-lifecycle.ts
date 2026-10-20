import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type { RuntimeFailureCause } from '../../failure-cause'
import type { HarnessTranscriptEvidence } from '../../harness-transcript'
import type { RetainedPendingCause } from '../retained-executor'
import type { Budget, BudgetViolation, Spend } from './accounting'
import type {
  ExecutionBindingReceipt,
  NodeExecutionIdentity,
  ProfileMaterializationReceipt,
} from './execution-identity'
import type { SpawnModelSubstitution } from './executor-construction'
import type { Runtime, WorkerTraceEvidence } from './executor-port'
import type { ProviderModelExecutionEvidence } from './supervisor-result'

/** `'queued'` is an admitted child that holds its budget slice and waits for a worker slot
 *  (`workerSlots`); it runs nothing until the allocator grants one. `'acquiring'` is first-class
 *  (M1): a node spends real time + reaps an orphan box during sandbox acquire BEFORE it is
 *  `running`, so abort must be defined over it. */
export type NodeStatus =
  | 'pending'
  | 'queued'
  | 'acquiring'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'

/** Deterministic node id — `${parent}:s${seq}` from the cursor order, never wall-clock. */
export type NodeId = string

export interface SpawnOpts {
  readonly budget: Budget
  readonly label: string
  /** Manager-scoped semantic assignment identity. Unlike `key`, this names every spawn, including
   * unkeyed siblings, so product traces can join authorization, node, and backend execution. */
  readonly assignmentId?: string
  /** Teardown grace handed to the executor when this node is reaped. */
  readonly shutdown?: number | 'brutalKill' | 'infinity'
  /**
   * Semantic identity of this assignment ACROSS process lifetimes. A keyed spawn is
   * idempotent per key: once a child spawned under a key settles `done` — in this process or in a
   * journaled prior one — spawning the same key returns that committed result (`prior.state:
   * 'completed'`) instead of paying for the work again. A key whose prior attempt settled `down`
   * spawns fresh and says so explicitly (`prior.state: 'retried'`); a resume DERIVES that same
   * `down` for an interrupted `inline` attempt, because an in-process execution cannot outlive
   * its process — so a worker killed mid-flight under a plain in-process executor retries under
   * its own key instead of wedging. A key whose un-settled prior attempt may still exist
   * elsewhere (`sandbox`/`cli`/`router` runtimes) is refused (`'in-doubt'`): the remote execution
   * may still be running and must be recovered before replacement. A key that is currently LIVE
   * is refused (`'duplicate-key'`). Unkeyed spawns (the default) are position-identified and
   * always run.
   */
  readonly key?: string
  /** The settled sibling node this spawn replaces, so a run's record names which worker took over
   *  whose work. The caller asserts the relation; the coordination `spawn_worker` tool admits only
   *  a settled worker of the same manager. Journaled on `spawned` and on the `agent.spawn` hook. */
  readonly successorOf?: NodeId
  /**
   * With `key`: when the key's committed result ended over its budget and its environment is still
   * held, continue that session in a NEW node (`prior.state: 'continued'`) instead of returning the
   * result. The coordination tool sets it when the manager re-spawns the key with a `budget`.
   */
  readonly continueHeld?: boolean
}

/** Fail-closed spawn rejections: an exhausted pool, a dollar request against a root that budgets
 *  no dollars, an exceeded recursion ceiling, a full tree-wide worker allocation, a `key` that is
 *  still LIVE in this scope, a key whose prior remote execution has no terminal receipt, or a run
 *  that has already reached its join barrier.
 *
 * `usd-unbudgeted` is separate from `budget-exhausted` because the two call for opposite
 *  responses: an exhausted pool may admit a smaller request, while an unbudgeted dollar channel
 * refuses every amount until the ROOT budget names a `maxUsd`.
 *
 * `scope-settled` is separate from `scope-aborted` for the same reason: nothing cancelled this
 * run, its driver simply finished. A caller that outlived the request it was serving (a background
 * tool invocation still holding the driver's verbs) gets a refusal it can record, instead of a
 * child nobody joins. */
export type SpawnRejection =
  | 'budget-exhausted'
  | 'usd-unbudgeted'
  | 'depth-exceeded'
  | 'duplicate-key'
  | 'in-doubt'
  | 'invalid-identity'
  | 'key-conflict'
  | 'scope-aborted'
  | 'scope-settled'

/**
 * What a KEYED spawn resolved to when the key had a prior attempt. Absent on a fresh key (and on
 * every unkeyed spawn). `'completed'` is the exactly-once path: NOTHING was spawned — the handle
 * references the prior settled node and `settled` is the committed result. `'retried'` DID spawn
 * fresh because the prior attempt settled `down`. A start with no terminal receipt is not a prior
 * result: `spawn` refuses it as `'in-doubt'`, retains its charged reservation, and requires exact
 * recovery before a replacement can run.
 */
export type SpawnPrior<Out = unknown> =
  | { readonly state: 'completed'; readonly settled: Settled<Out> & { kind: 'done' } }
  /** A NEW node continues the prior node's held environment and session (`SpawnOpts.continueHeld`). */
  | { readonly state: 'continued'; readonly priorId: NodeId; readonly environmentId: string }
  | { readonly state: 'retried'; readonly priorId: NodeId; readonly reason: string }

/**
 * A live child handle. `abort()` is defined over the ACQUIRE lifecycle: it chains into
 * the `acquireSandbox` signal and reaps a find-by-name orphan box, so a node aborted
 * mid-acquire never leaks (M1).
 */
export interface Handle<Out> {
  readonly id: NodeId
  readonly label: string
  readonly status: NodeStatus
  /** Manager-scoped assignment identity supplied at admission. */
  readonly assignmentId?: string
  /** Durable identity of the authorized profile/task/candidate represented by this handle. */
  readonly identity?: NodeExecutionIdentity
  /** Stable execution plan once Runtime has committed it. */
  readonly materialization?: ProfileMaterializationReceipt
  /** Immutable per-attempt backend bindings committed so far, oldest first. */
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>
  /** Present when authorization ran this child on another model than its parent authored. */
  readonly modelSubstitution?: SpawnModelSubstitution
  abort(reason?: string): void
  /** Phantom: binds the handle to the child's output type so `spawn<C>` returns a
   *  `Handle<C>` distinct from a `Handle<other>`. Type-only — never present at runtime. */
  readonly __out?: Out
}

/**
 * A settled child, delivered by `scope.next()`. `seq` is the monotonic cursor order
 * `next()` yielded this settlement (B2) — NOT wall-clock — and replay delivers strictly
 * in `seq` order. `outRef` rehydrates `out` from the `ResultBlobStore` on replay.
 */
export type Settled<Out> =
  | {
      kind: 'done'
      handle: Handle<Out>
      out: Out
      outRef: string
      verdict?: DefaultVerdict
      spent: Spend
      /** Provider model evidence for every inference attempt owned by this node. */
      providerModel?: ProviderModelExecutionEvidence
      /** Structured tool evidence captured before this settlement was journaled. */
      trace: WorkerTraceEvidence
      /** Whether the child's OWN harness transcript survived its environment, or why it did not.
       *  A SIBLING of `trace`, not a field inside it: `trace` carries the supervisor's tool spans
       *  (toolName, args, status, callId, startedAt === endedAt) and nothing the child said, and a
       *  child with zero tool spans has an UNAVAILABLE trace — so a receipt nested inside the
       *  available arm could never describe exactly the children that need it most (#1244). */
      harnessTranscript?: HarnessTranscriptEvidence
      /** Present when the measured spend exceeded this child's reservation. */
      budgetViolation?: BudgetViolation
      /** Present when this child led workers of its own: a bounded account of its team. */
      subtree?: SubtreeSummary
      /** Epoch ms parsed from the durable settlement record when available. */
      settledAt?: number
      seq: number
    }
  | {
      kind: 'down'
      handle: Handle<Out>
      reason: string
      /** Retained output evidence, when execution returned an artifact before this failure.
       * Its presence does not make the result successful or eligible for selection. */
      outRef?: string
      /** `true` = the platform, not the work, ended this child (excluded from merge `n` /
       *  equal-k); `false` = the runtime knows the work itself failed (an ordinary thrown result);
       *  absent = the executor's envelope reported a failure the runtime cannot attribute either
       *  way. Absent is a stated unknown, never a euphemism for `false`: until 2026-09-20 the
       *  envelope path stamped `false` unconditionally and caught 1 of 78 platform losses. */
      infra?: boolean
      /** Partial structured tool evidence captured before this failure was journaled. */
      trace: WorkerTraceEvidence
      /** The child's own harness transcript, read out of its environment at the last moment it
       *  was live, or the named reason it could not be. This is the path the capture existed
       *  for and never covered: a dropped child produces no result artifact, so before #1244
       *  its reasoning was destroyed with its box. */
      harnessTranscript?: HarnessTranscriptEvidence
      /** Partial provider model evidence survives an aborted or failed execution. */
      providerModel?: ProviderModelExecutionEvidence
      /** Present when the spend reconciled for this child exceeded its reservation. */
      budgetViolation?: BudgetViolation
      /** Present only when this child's provider execution was RETAINED (see
       *  `RetainedExecutionState`); absent on an ordinary down. `'pending'` on the settlement the
       *  driver receives at the reconcile; `'released'` or `'release-unconfirmed'` on the
       *  replayed settlement of a node a final settlement closed. The driver and every replay
       *  reader see the fact the journal
       *  states, so a reader never splits this population on `reason` text — which is identical
       *  on every one of these children. */
      retainedExecution?: RetainedExecutionState
      /** WHY the retained execution has no accepted result, as a value: the safety refusal
       *  (`'unobservable'`) against a provider contract violation, a rejected request, a lost
       *  transport, or a nested recovery that could not be reconstructed. Present iff
       *  `retainedExecution` is; the `reason` text names the same thing, but a reader must never
       *  have to parse it (#1204). */
      retainedPendingCause?: RetainedPendingCause
      /** Why the executor threw, classified from the thrown error and the child's abort signal
       *  while both were still values. Present on a live settlement whose executor threw; the
       *  journal does not record it, so a replayed settlement leaves it to
       *  `settlementFailureCause`. */
      failure?: RuntimeFailureCause
      /** Present when this child led workers of its own: a bounded account of its team. */
      subtree?: SubtreeSummary
      /** Epoch ms parsed from the durable settlement/cancellation record when available. */
      settledAt?: number
      seq: number
    }

/**
 * A bounded account of the team a manager led, carried up on its settlement.
 *
 * A lead reads its children's summaries instead of every descendant's output: the counts cover
 * the whole subtree, and `results` lists only the manager's own direct children, best first.
 * Every listed result stays addressable by its content address (`outRef`), so the lead can read
 * any one of them in full. The summary is bounded at every level, so a tree of hundreds of agents
 * reaches its root as a handful of summaries.
 */
export interface SubtreeSummary {
  /** Spawned agents below this node, at every depth. */
  readonly agents: number
  /** Levels below this node: `1` when it led only workers that led no one. */
  readonly depth: number
  /** Agents below this node that settled done. */
  readonly done: number
  /** Agents below this node that settled down or were cancelled. */
  readonly down: number
  /** This node's own direct children, done before down and then by score, at most
   *  `SUBTREE_RESULT_LIMIT` of them. */
  readonly results: ReadonlyArray<SubtreeResult>
  /** Direct children not listed in `results`. */
  readonly omitted: number
}

/** One direct child of a manager, as its lead sees it in a {@link SubtreeSummary}. */
export interface SubtreeResult {
  readonly id: NodeId
  readonly label: string
  readonly status: 'done' | 'down'
  /** Content address of the child's retained output, when it produced one. */
  readonly outRef?: string
  readonly score?: number
  /** Agents in this child's own subtree, itself excluded. */
  readonly agents: number
}

export interface NodeSnapshot {
  readonly id: NodeId
  readonly parent?: NodeId
  readonly label: string
  readonly status: NodeStatus
  readonly runtime: Runtime
  readonly budget: Budget
  /** Exact nested journal tree owned by this node, when Runtime attested recursive ownership. */
  readonly ownedTreeRoot?: NodeId
  /** Manager-scoped assignment identity, including deterministic ids for unkeyed siblings. */
  readonly assignmentId?: string
  readonly identity?: NodeExecutionIdentity
  /** Present when authorization ran this node on another model than its parent authored. */
  readonly modelSubstitution?: SpawnModelSubstitution
  /** Kernel-owned execution evidence. `unknown` is distinct from a known zero/empty plan. */
  readonly materialization?: ProfileMaterializationReceipt
  /** Immutable attempt bindings, oldest first. A retried/resumed node may have more than one. */
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>
  /** Epoch ms of the terminal journal record; absent while live or when legacy evidence lacks it. */
  readonly settledAt?: number
  /** Epoch ms of the spawn journal record; absent when legacy evidence lacks a parseable `at`. */
  readonly spawnedAt?: number
  /** Conserved spend so far for this node. */
  readonly spent: Spend
  /**
   * The node's executor has FINISHED and its settlement is queued for the manager to drain with
   * its next wake/`next()`, but `status` still reads as it did while running because the settle
   * transition happens at drain time. Present only in that window; absent once drained or while
   * the executor is still live. Carries the terminal kind so a manager polling `observe_agent`
   * can tell "still working" from "finished, waiting for you to read it".
   *
   * Measured 2026-09-17 (discovery-lab sandbox-a-20260917h): two children finished 30 s after
   * dispatch; the manager polled `observe_agent` eleven times over 56 minutes, read `running`
   * each time, stopped draining because the status said work was in flight, and recorded the
   * opposite of the truth about its own experiment. agent-runtime#1279.
   */
  readonly settlementPending?: { readonly kind: 'done' | 'down' }
  /** Provider model evidence persisted separately from the execution plan. */
  readonly providerModel?: ProviderModelExecutionEvidence
  /** Canonical retained output pointer; a failed or cancelled node may also have useful evidence. */
  readonly outRef?: string
  /** Present on terminal executor nodes; legacy records carry an explicit unavailable reason. */
  readonly trace?: WorkerTraceEvidence
  /** Present once a settled node's measured spend exceeded its reservation. */
  readonly budgetViolation?: BudgetViolation
  /** Present on a retained child: `'pending'` while its cursor slot is open, `'released'` or
   *  `'release-unconfirmed'` once a final settlement closed it. The live view (`makeTreeView`)
   *  and the journal view (`materializeTreeView`) state the same fact, so a settle record's
   *  `tree` answers the retained-vs-down question without the observer journal. */
  readonly retainedExecution?: RetainedExecutionState
  /** Why a retained child has no accepted result; see `RetainedPendingCause`. */
  readonly retainedPendingCause?: RetainedPendingCause
}

/** The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer. */
export interface TreeView {
  readonly root: NodeId
  readonly nodes: ReadonlyArray<NodeSnapshot>
  /** Count of nodes in `queued`, `acquiring`, or `running` — the "what's in flow?" answer. */
  readonly inFlight: number
}

/**
 * The recorded fate of a child whose provider execution was RETAINED: admitted durably, with no
 * accepted terminal result when local observation stopped (the `RetainedExecutionPendingError`
 * path). Not a failure classification — the child is `down` either way.
 *
 * - `'pending'`: the reservation was reconciled at a floor, the cursor slot is open, and the
 *   environment is kept so a resume can reconcile the paid execution. Only ever on the in-memory
 *   `Settled` and the first `agent.child` payload; the journal states it as the `reconciled`
 *   record and replay never yields it. For an executor without `releaseRetained` it means only
 *   that nothing could be released.
 * - `'released'`: root settlement under `retainedAtSettlement: 'release'` destroyed the
 *   environment (executor-confirmed) before any process recovered the execution; this is the
 *   node's terminal record, written by the release sweep in the settling process or by
 *   `healReleasedSlots` on the next resume when that process died between the last
 *   `destroyed: true` receipt and the record (same builder, `seq` and `at`, from the
 *   `reconciled` record). The pool's own admission fault, if the reconcile raised one, is not
 *   on this record.
 * - `'release-unconfirmed'`: root settlement under `retainedAtSettlement: 'release'` ended with
 *   the execution unrecovered and its environment NOT confirmed destroyed: the provider refused
 *   the delete, the executor could not confirm it, or the admission never named an environment
 *   (a create that timed out). The settlement is final, so no process will recover the execution
 *   and the slot closes anyway, with the same builder, `seq` and `at` as `'released'`. What the
 *   node may still hold stays named by its `teardown-unconfirmed` record and in
 *   `teardownUnconfirmed`, for a sweeper.
 *
 * Absent = an ordinary child. The live `Settled` a driver branched on carried `'pending'` where
 * replay yields `'released'` or `'release-unconfirmed'` for the same seq, so a resume-aware driver
 * must not branch on these values. No `'recovered'` value exists yet: a live-adopted recovery
 * settles on the ordinary path and the recorded-result path writes no marker.
 */
export type RetainedExecutionState = 'pending' | 'released' | 'release-unconfirmed'
