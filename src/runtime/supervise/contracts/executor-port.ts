import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type { AgentTurnResult } from '@tangle-network/agent-interface'
import type { HarnessTranscriptCapture } from '../../harness-transcript'
import type { RetainedInteractiveRunHandle } from '../../retained-interactive-types'
import type { RetainedRunEffect } from '../../retained-run-types'
import type { ExecutorProgress } from '../progress'
import type { TraceSource } from '../trace-source'
import type { Spend } from './accounting'
import type { UsageEvent } from './execution-events'

/**
 * The leaf runtime — ONE open interface, not a closed union. `execute` returns a
 * `Promise<ExecutorResult>` for one-shot executors OR an `AsyncIterable<UsageEvent>` for
 * streaming ones; a streaming executor reports incremental normalized usage as it runs
 * (the budget pool reconciles against it) and exposes its terminal artifact via
 * `resultArtifact()`. Both shapes normalize usage to `UsageEvent` so the conserved pool
 * meters every runtime identically.
 *
 * Built-in implementations (in `runtime.ts`, NOT variants here): router/inline (a direct
 * Router/HTTP inference call, no box), sandbox (COMPOSES `runAgentRounds` as a leaf, forwarding
 * PR #150's optional `lineage` passthrough — does NOT reinvent checkpoint/fork), cli
 * (Halo/RLM subprocess; `budgetExempt`, refused by budgeted supervision). A user's
 * own agent (mastra/agno/raw HTTP/anything) is first-class by implementing this interface.
 */
export interface Executor<Out> {
  /** Stable runtime tag for traces + the equal-k exemption check. */
  readonly runtime: Runtime
  /**
   * When true, this executor cannot report the usage a conserved pool would need (for example, a
   * subscription CLI with no token receipt). `Executor` can still be used directly, but `Scope`
   * refuses it before `execute` so unknown compute can never appear as measured zero in a
   * supervised or equal-resource run. A metered executor MUST report usage.
   */
  readonly budgetExempt?: boolean
  /**
   * One-shot → resolves a `ExecutorResult`; streaming → yields incremental `UsageEvent`s and
   * the terminal artifact is read from `resultArtifact()` after the stream drains.
   * `signal` is the spawn-scoped abort (chains the acquire lifecycle for sandbox).
   */
  execute(
    task: unknown,
    signal: AbortSignal,
  ): Promise<ExecutorResult<Out>> | AsyncIterable<UsageEvent>
  /** Reattach the exact journaled execution. This must never start replacement work. */
  recover?(
    task: unknown,
    signal: AbortSignal,
  ): Promise<ExecutorResult<Out>> | AsyncIterable<UsageEvent>
  /**
   * Optional inbox: receive an out-of-band message from the driver mid-run (the `send`/`steer_agent`
   * verb). A streaming executor drains pending messages between turns and folds them into the next
   * step (a steer / interrupt / resume). A one-shot executor that can't be steered mid-flight omits
   * this; `Scope.send` then returns `false` for it. Never throws — an inbox that rejects a malformed
   * message returns `false`, and that refusal propagates to the caller.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: void is the legacy contract; boolean adds an acknowledgement without breaking existing executors.
  deliver?(msg: unknown): void | boolean
  /**
   * Optional LIVE progress: what this worker is doing RIGHT NOW, read synchronously and
   * cheaply while `execute` is still streaming. The scope already derives activity timing,
   * turns, and spend from the metered usage stream for EVERY executor; this adds only what
   * the executor alone knows — the harness's tool/file activity, its own turn count, and how
   * many delivered steers it has not yet folded in. Never throws; a read that cannot be
   * answered returns `undefined`.
   *
   * This is the observe half of steering: `deliver` lets a driver correct a worker, and this
   * is the evidence it corrects FROM. An executor that implements neither cannot be supervised
   * mid-flight — it can only be waited on.
   */
  progress?(): ExecutorProgress | undefined
  /**
   * Optional live tool-call trace for the ONLINE detectors (`watchTrace`). An executor that
   * can see its worker's tool calls exposes them here, so a supervisor can run the streaming
   * repeated-action / error-streak panel over a RUNNING worker and raise a `finding` the
   * moment it loops, instead of discovering it at settle. Omitted = no online detection for
   * this runtime (the settle-time analyzers still work).
   */
  traceSource?(): TraceSource | undefined
  /**
   * The exact interactive process this worker runs in, when its execution was started in an
   * attachable terminal. Read through `Scope.interactive`; synchronous and side-effect free, and
   * it must not throw. Omitting it is the honest answer for every headless executor: omission
   * reads as `executor-exposes-no-interactive-session`, never as an empty handle.
   */
  interactive?(): WorkerInteractiveSession
  /** Optional readiness signal for an executor whose exact interactive handle is created inside
   * `execute`. It resolves once to an available handle or a terminal unavailable reason. */
  interactiveReady?(): Promise<WorkerInteractiveSession>
  /**
   * Optional provider-neutral CANCELLATION, distinct from `teardown`: it asks the backend to stop
   * the work and reports what the backend acknowledged, so a caller never has to read a local
   * iterator abort as remote acceptance. `teardown` remains the resource verb — it releases what
   * this process holds and says nothing about remote compute or billing.
   *
   * An executor that cannot ask its backend anything omits this method; one whose backend has no
   * cancel operation implements it and answers `unknown` with the reason in `detail`.
   */
  cancel?(request: ExecutorCancellationRequest): Promise<ExecutorCancellation>
  /**
   * Tear the executor's resources down. `grace` mirrors the OTP shutdown spec
   * (`'brutalKill'` = immediate, a number = ms grace, `'infinity'` = await clean exit).
   */
  teardown(grace: number | 'brutalKill' | 'infinity'): Promise<{
    destroyed: boolean
    /** Why the resource could not be proven destroyed. Present only with `destroyed: false`, so a
     *  caller reporting an unconfirmed teardown can name the cause instead of a bare flag. */
    detail?: string
    /** With `destroyed: false`: asking again cannot change this answer, because the executor
     *  keeps the resource on purpose (a workspace preserved for lack of a verified receipt, an
     *  execution held for reconciliation) or cannot destroy it at all. The settlement retry stops
     *  asking. */
    permanent?: boolean
  }>
  /**
   * Optional acknowledgement window for a remote cleanup requested as `'brutalKill'`.
   * Local executors keep the short default; remote executors may need bounded network time.
   */
  teardownTimeoutMs?: number
  /**
   * Optional release of a RETAINED execution that no later process will recover.
   *
   * `teardown` keeps a pending retained execution's environment alive by construction: the paid
   * work inside it is what a resumed run reconciles. Once the root has reached its own terminal
   * outcome nothing will, and the environment is a leak — measured 2026-09-11, four settled runs
   * held 18 of a 60-slot fleet for 19 to 37 hours this way. The supervisor calls this at root
   * settlement, never on a resumable interruption (an explicit cancellation, a process crash), and
   * journals one `environment-teardown` receipt per environment returned. `signal` bounds the
   * attempt; an executor that holds no retained execution answers with no receipts. After a
   * `destroyed: true` receipt the executor's `teardown` must answer `destroyed: true` as well.
   */
  releaseRetained?(signal: AbortSignal): Promise<ReadonlyArray<EnvironmentTeardownReceipt>>
  /**
   * The provider environments this executor still holds and has not confirmed destroyed. Read
   * synchronously when a teardown stays unconfirmed, so the run can name each environment a
   * sweeper must delete even when the provider never answered. Never throws. An executor that
   * holds no provider environment omits the method.
   */
  heldEnvironments?(): ReadonlyArray<HeldEnvironment>
  /**
   * The environment a settled turn kept because it ended over its budget, so a keyed re-spawn can
   * run the next turn in the same environment and harness session. `undefined` once nothing is
   * held. `release` destroys it; `handOver` gives it to the successor node, after which this
   * executor never destroys it. The scope asks for it through `RetainedExecutorContext.holdOnSettle`.
   */
  heldForContinuation?(): HeldForContinuation | undefined
  /**
   * The replay source (B1): the content-addressed `outRef` + the materialized output the
   * driver branched on, its verdict, and the conserved spend. Read once, after settle.
   */
  resultArtifact(): {
    outRef: string
    out: Out
    verdict?: DefaultVerdict
    spent: Spend
    teardown?: ExecutorTeardownWarning
  }
  /**
   * Optional accounting split for recursive executors.
   * `reported` is the child-work spend written on this node's settlement; `reservation` is the
   * whole amount reconciled against this node's parent reservation.
   * They differ when a driver owns a nested allocation: its child work and own inference consume
   * that allocation together, while the journal keeps those two categories separate.
   * Valid after `execute` resolves or throws; ordinary leaf executors omit it.
   */
  accounting?(): ExecutorAccounting | undefined
  /**
   * A driver-executor's OWN-inference subtree total (rolled up from its nested tree's `metered`
   * events) — the parent scope journals it as a `metered` event for this node on settle, on BOTH
   * the done AND the down/crash paths, so a crashed sub-driver's partial inference still re-homes
   * (the pool already debited it via `observe`; the journal must match). NOT reconciled, so it never
   * trips the reservation clamp. Read on settle, valid after `execute` resolves OR throws. Leaf
   * executors omit it (returns `undefined`).
   */
  metered?(): Spend | undefined
  /**
   * The child's OWN harness transcript, read out of its environment while that environment was
   * still live. Read on settle, valid after `execute` resolves OR throws — the throw half is the
   * point: a child that drops produces no result artifact, so before this the only carrier was
   * the settled result and a dropped child's reasoning died with its box (#1244).
   *
   * An executor with no transcript to offer omits the method entirely; the settle path then
   * records `executor-exposes-no-transcript` rather than an empty artifact that reads as
   * coverage. Never throws. Returns the in-memory capture; the SCOPE persists it under its own
   * content ref and settles the receipt, so no executor ever learns about storage.
   */
  harnessTranscript?(): HarnessTranscriptCapture | undefined /**
   * Resolves once {@link harnessTranscript} holds a copy of the session taken after this
   * execution's turn ended. A streaming executor whose turn an abort ends finishes that turn after
   * the abort has reached the scope: it stops the harness and copies its session, while the scope
   * settles the node. The scope awaits this, bounded, before it reads the transcript or tears the
   * executor down, so a deadline or a cancellation settles with the stopped session rather than the
   * last running copy (2026-10-04 trace proof: a deadline node settled 3 ms after its deadline with
   * `native_snapshot_live`). The executor may still replace the transcript afterwards with a fuller
   * record, such as its failure capture of the whole workspace; the scope keeps the one it read.
   * Never rejects. An executor whose transcript is final when `execute` ends omits it.
   */
  harnessTranscriptSettled?(): Promise<void>
  /**
   * True once this execution's result is committed and `execute` will resolve with it: a
   * manager whose completion check accepted its submission. The scope does not settle such a node
   * `down` when its deadline or an abort arrives while the accepted turn is still ending; it waits
   * for `execute` to resolve, and the executor bounds that wait itself. Measured on Discovery Lab
   * run terraform-economics-20261005f: 5 of 20 nodes with accepted results were settled `down` by
   * deadlines that fell while their turns were still ending.
   */
  resultAccepted?(): boolean
}

/** Why Runtime cannot provide structured tool-call evidence for one settled execution. */
export type WorkerTraceUnavailableReason =
  | 'execution-did-not-start'
  | 'executor-did-not-expose-trace-source'
  | 'trace-source-unavailable'
  | 'no-tool-spans-captured'
  | 'invalid-tool-spans'
  | 'trace-collection-failed'
  | 'trace-persistence-failed'
  | 'legacy-settlement-without-trace-evidence'

/** Durable proof of a worker's structured tool trace, or the exact reason it is unavailable. */
export type WorkerTraceEvidence =
  | {
      readonly status: 'available'
      /** Content-addressed pointer to a persisted `WorkerToolTraceArtifact`. */
      readonly traceRef: string
      readonly spanCount: number
    }
  | {
      readonly status: 'unavailable'
      readonly reason: WorkerTraceUnavailableReason
    }

/** Why Runtime cannot hand a caller the exact interactive process one worker runs in. */
export type WorkerInteractiveUnavailableReason =
  /** No child of this scope carries that node id. */
  | 'unknown-node'
  /** The child settled or was cancelled: there is no process to attach to. */
  | 'not-live'
  /** The worker runs headless. Its executor exposes no interactive session, so there is no
   *  terminal — a headless execution is never converted into an attachment. */
  | 'executor-exposes-no-interactive-session'
  /** The executor is backed by a runner whose provider publishes no interactive-session contract
   *  (the local CLI Bridge today), so no process can be attached to even though one is running. */
  | 'provider-has-no-interactive-contract'
  /** The runner supports interactive sessions but this execution was not started in one. Part of
   *  the `Executor` PORT vocabulary: `Scope.interactive` keeps whatever reason an executor's own
   *  `interactive()` returns, so any executor — including one implemented outside this package —
   *  answers with it. No first-party executor emits it yet: the sandbox arm must first ask its
   *  provider whether it supports control, which agent-runtime#773 tracks. */
  | 'interactive-session-not-started'
  /** A durable worker exists, but its process predates the exact binding contract or failed to
   *  publish one. Runtime never guesses a provider session from conversation metadata. */
  | 'interactive-binding-not-found'
  /** The exact durable reference no longer resolves to a running provider process. */
  | 'interactive-binding-stale'
  /** The binding names a provider that this process did not register. */
  | 'interactive-provider-not-registered'

/**
 * One worker's attachable process, or the named reason there is none.
 *
 * `available` carries the exact `RetainedInteractiveRunHandle` bound to THAT child's admitted
 * execution: input, resize, ordered replay, detach, and an acknowledged close all check every
 * provider answer against the session reference, so a second process that merely resumes the same
 * conversation cannot present itself as this one. `unavailable` names why, and is never a handle.
 */
export type WorkerInteractiveSession =
  | { readonly status: 'available'; readonly handle: RetainedInteractiveRunHandle }
  | { readonly status: 'unavailable'; readonly reason: WorkerInteractiveUnavailableReason }

/** One cancellation ask. `operationId` makes the request idempotent per attempt, exactly as the
 *  worker and retained layers already key their cancellations. */
export interface ExecutorCancellationRequest {
  readonly operationId: string
  readonly reason?: string
  /** Deadline for the acknowledgement itself. Its expiry produces `unknown`, never a claim. */
  readonly signal?: AbortSignal
}

/**
 * What a backend acknowledged about one cancellation ask.
 *
 * `status` is the backend's answer to the ASK; `effect` is what is now known about the RUN, in the
 * one cancellation vocabulary the worker and retained layers already use. A local abort with no
 * provider acknowledgement is `{ status: 'unknown', effect: 'cancel_requested' }` — never
 * `accepted`.
 */
export interface ExecutorCancellation {
  readonly status: 'accepted' | 'rejected' | 'already-terminal' | 'unknown'
  readonly effect: RetainedRunEffect
  /** When the acknowledgement was observed, ISO-8601. */
  readonly observedAt: string
  /** Why the backend answered this way — required reading for `unknown`. */
  readonly detail?: string
  /** Backend-native proof, persisted by digest only. */
  readonly evidence?: unknown
}

/** Split used by a recursive executor when journaled child work differs from the full amount
 * reconciled against its parent reservation. */
export interface ExecutorAccounting {
  readonly reported: Spend
  readonly reservation: Spend
}

/** Terminal artifact of a one-shot `Executor.execute`. */
export interface ExecutorResult<Out> {
  /** Explicit execution outcome; application output and scoring verdicts do not determine failure.
   *  `errorCode` is the provider's machine code for a failure when it reported one. A retry policy
   *  reads the code, never the human `error` text. */
  outcome?: Pick<AgentTurnResult, 'success' | 'error'> & {
    errorCode?: string
    /** Native HTTP failure status, when reported, in the range 400–599. */
    statusCode?: number
  }
  outRef: string
  out: Out
  verdict?: DefaultVerdict
  spent: Spend
  /** A resource teardown that failed AFTER this result settled. Present ONLY on that path, and it
   *  never changes the outcome: the turn completed, the artifact is real, and the spend is what was
   *  metered. See {@link ExecutorTeardownWarning}. */
  teardown?: ExecutorTeardownWarning
}

/**
 * A teardown failure recorded BESIDE a settled result rather than in place of it.
 *
 * The measured failure: a provider environment's second DELETE answered 409, the rejection escaped
 * the executor's `finally`, and a run whose turn had completed (`spent.iterations: 1`, artifact
 * produced) was reported as a failure. Once the stream has yielded its terminal event the result is
 * SETTLED; what happens to the resource afterwards is an operational fact about the resource, not a
 * verdict on the work. The run keeps its outcome and carries this warning, which is the same
 * distinction `teardown-unconfirmed` already draws for a child whose cleanup was never acknowledged.
 */
export interface ExecutorTeardownWarning {
  readonly failed: true
  /** What the teardown threw, as text. */
  readonly error: string
  /** ISO timestamp of the failed attempt. */
  readonly at: string
}

/** One provider environment an executor holds, named by the provider's own id. */
export interface HeldEnvironment {
  readonly provider: string
  /** The provider-issued environment id — the id a fleet listing shows and a delete takes. */
  readonly environmentId: string
  /**
   * Why the environment is held on purpose; absent when it is held only because its destroy was
   * not confirmed. A sweeper never deletes a kept environment.
   * - `resume`: a retained execution kept so a resumed run can reconcile the paid work inside it.
   * - `evidence`: a workspace preserved because the execution has no verified workspace receipt.
   */
  readonly keptFor?: 'resume' | 'evidence' | 'continuation'
}

/** A budget-stopped turn's environment, held for a keyed continuation ({@link Executor.heldForContinuation}). */
export interface HeldForContinuation {
  readonly provider: string
  readonly environmentId: string
  release(signal?: AbortSignal): Promise<{ destroyed: boolean; detail?: string }>
  handOver(): void
}

/** Why a held budget-stop environment was released: its hold ceiling ran out, its manager
 *  cancelled the worker, or the scope reached its join barrier. Journaled on `environment-teardown`. */
export type HeldRelease = 'hold-ceiling' | 'cancel-worker' | 'scope-join'

/**
 * The receipt for one provider environment an executor held for a RETAINED execution and was
 * asked to release at root settlement (see {@link Executor.releaseRetained}). One receipt per
 * environment, naming the provider's own id, so a fleet listing can be reconciled against what
 * the run says it released. `destroyed: false` carries why in `detail`.
 */
export interface EnvironmentTeardownReceipt {
  readonly provider: string
  /** The provider-issued environment id — the same id the `execution-admitted` record carries. */
  readonly environmentId: string
  readonly destroyed: boolean
  /** Why the environment could not be proven destroyed; present exactly when `destroyed` is
   *  false. */
  readonly detail?: string
  /** With `destroyed: false`: another release cannot change this answer, because the executor
   *  keeps the environment on purpose or cannot destroy it at all. The settlement retry stops
   *  asking. */
  readonly permanent?: boolean
}

/** The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name.
 * External executors can register additional runtime strings without widening this type. */
export type Runtime = 'router' | 'inline' | 'sandbox' | 'cli' | (string & {})
