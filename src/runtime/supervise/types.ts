/**
 *
 * Recursive execution atom — the FROZEN type surface (the keystone contract).
 *
 * One self-similar `Agent` atom runs inside a budget-conserving reactive `Scope`,
 * orchestrated by a `Supervisor` over an event-sourced `SpawnJournal`. A leaf is an
 * `Agent` that never calls `scope.spawn`; a driver is an `Agent` that spawns and runs
 * a policy over its children's streaming results.
 *
 * Two invariants the surface exists to make enforceable:
 *  - Budget is an atomically-reserved CONSERVED pool, so `Σk(treatment) ≡ Σk(blind)` by
 *    construction (reserve-on-spawn, refund-unspent-on-settle, fail-closed admission).
 *  - The journal records a content-addressed `outRef` per child result, so replay
 *    rehydrates the exact `Settled` the driver branched on (the replay invariant below).
 *
 * The leaf RUNTIME is one OPEN `Executor` interface, not a closed `inline|sandbox|cli`
 * union the call site switches on. The built-ins (router/inline, sandbox, cli) are the
 * initial IMPLEMENTATIONS; any user agent is first-class the moment it implements the
 * interface. The interface IS the extension point — no per-vendor adapters live here.
 *
 * Layering: substrate types (`DefaultVerdict`) come from `@tangle-network/agent-eval`;
 * runtime-shaped types (everything else) live here. Pure types/interfaces only — this
 * module typechecks standalone and is imported by every keystone impl.
 *
 * @experimental
 */

import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type { AgentProfile, Sha256Digest } from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import type { RuntimeHooks } from '../../runtime-hooks'
import type { LoopTokenUsage } from '../types'
import type { ExecutorProgress, WorkerProgress } from './progress'
import type { TraceSource } from './trace-source'
import type { PendingWait, WaitOutcome, WaitProbeRegistry, WaitRejection, WaitSpec } from './wait'
import type { WorkerTraceResolver } from './worker-trace'

// `LoopTokenUsage` keeps provider totals plus an optional complete cache split. Re-exported so
// keystone impls import the budget surface from one place. `usd` is a SEPARATE channel.
/** Wait-state vocabulary, re-exported so the keystone surface stays one import. */
export type {
  DefaultVerdict,
  LoopTokenUsage,
  PendingWait,
  WaitOutcome,
  WaitProbeRegistry,
  WaitRejection,
  WaitSpec,
}

/** Options for `Scope.wait`. `label` is the wait's identity within its parent scope — it is what
 *  a resumed run matches to re-adopt a journaled, still-unfired wait, so it must be stable across
 *  processes (a label derived from wall-clock would resume as a NEW wait). */
export interface WaitOpts {
  readonly label: string
}

// ── The atom ────────────────────────────────────────────────────────────────

/**
 * One self-similar atom. A leaf is an `Agent` that never calls `scope.spawn`; a driver
 * is an `Agent` whose `act` spawns children and reacts to them via `scope.next()`. An
 * analyst is an `Agent` whose task is "read these traces → findings" — `where` it runs
 * is its executor, not a separate type.
 *
 * `act` MUST be replay-safe: it may read `verdict`, `spent`, and `out` (rehydrated by
 * `outRef`) off each `Settled`; it MUST NOT read `Date.now`, `Math.random`, or any
 * unordered collection. `scope.next()` delivers strictly in recorded `seq` order.
 */
export interface Agent<Task, Out> {
  readonly name: string
  act(task: Task, scope: Scope<Out>): Promise<Out>
  /**
   * Optional manager inbox. A parent or attached `RootHandle` uses this to deliver the same raw
   * down-message accepted by executor inboxes. Return `false` when the manager has no live receive
   * path; returning `true` means the message was accepted for the current manager session.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: void is the legacy contract; boolean adds an acknowledgement without breaking existing agents.
  deliver?(msg: unknown): void | boolean
}

// ── The open leaf runtime ─────────────────────────────────────────────────────

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
   * Tear the executor's resources down. `grace` mirrors the OTP shutdown spec
   * (`'brutalKill'` = immediate, a number = ms grace, `'infinity'` = await clean exit).
   */
  teardown(grace: number | 'brutalKill' | 'infinity'): Promise<{ destroyed: boolean }>
  /**
   * The replay source (B1): the content-addressed `outRef` + the materialized output the
   * driver branched on, its verdict, and the conserved spend. Read once, after settle.
   */
  resultArtifact(): { outRef: string; out: Out; verdict?: DefaultVerdict; spent: Spend }
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
  | 'not-an-executor'

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

/** Split used by a recursive executor when journaled child work differs from the full amount
 * reconciled against its parent reservation. */
export interface ExecutorAccounting {
  readonly reported: Spend
  readonly reservation: Spend
}

/** Terminal artifact of a one-shot `Executor.execute`. */
export interface ExecutorResult<Out> {
  outRef: string
  out: Out
  verdict?: DefaultVerdict
  spent: Spend
}

/**
 * Normalized usage event — the single channel every executor reports through, so the
 * conserved pool meters all runtimes identically. `tokens` carries `LoopTokenUsage`'s
 * `{ input, output }` plus an optional provider cache split; `usd` is a SEPARATE channel (never
 * folded into tokens).
 *
 * Either channel can explicitly say its numeric subtotal is incomplete. A missing provider receipt
 * therefore remains unknown through live metering and terminal reconciliation instead of becoming
 * a fabricated zero.
 */
export type UsageEvent =
  | {
      kind: 'tokens'
      /** Known token subtotal. When false, these counts are only the observed/estimated floor. */
      tokensKnown?: false
      input: number
      output: number
      /** Newly processed prompt tokens. Present only with a complete cache split. */
      freshInput?: number
      /** Prompt tokens the provider reported reading from cache. */
      cacheRead?: number
      /** Prompt tokens the provider reported writing to cache. */
      cacheWrite?: number
      /**
       * False when this observation cannot classify all positive prompt tokens — including a
       * provider that reports a read with no write counter. The measured counters are still
       * carried; the marker says the remaining prompt tokens are unclassified, so a charge over
       * them is an upper bound. A counter the provider did not report is absent, never zero.
       */
      cacheBreakdownKnown?: false
    }
  | {
      kind: 'cost'
      /** Known dollar subtotal. When false, `usd` must not be treated as total cost. */
      usdKnown?: false
      usd: number
      /**
       * The part of `usd` this runtime priced from a model catalog because no provider receipt
       * covered the work. Requires `usdKnown: false` — a catalog price approximates what a
       * provider would bill and never measures what it did.
       *
       * Absence means this runtime priced nothing here, NOT that `usd` is a receipt. `usdKnown`
       * is what says whether a dollar figure is measured.
       */
      usdEstimated?: number
    }
  | { kind: 'iteration' }

/** The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name.
 * External executors can register additional runtime strings without widening this type. */
export type Runtime = 'router' | 'inline' | 'sandbox' | 'cli' | (string & {})

// ── Executor resolution (OPEN registry, not a switch) ─────────────────────────

/**
 * `AgentProfile` is the complete execution authority. Scope parses and snapshots it before calling
 * any registry, including one that resolves caller-supplied executors and factories. The default
 * registry enforces the same rule when called directly. `AgentSpec.harness` records routing for one
 * concrete run; where a backend consumes both fields, it must agree with `AgentProfile.harness` and
 * cannot fill or override it.
 *
 * Resolution (in `runtime.ts`):
 *  - `executorFactory` present → BYO: build it after admission with the live context.
 *  - `executor` present        → BYO: use it verbatim (a user's own `Executor`).
 *  - `harness === null`        → router/inline: a direct Router call, no box.
 *  - `harness` is a `BackendType` → sandbox: compose `runAgentRounds` against `profile` on that backend.
 * Fail loud on an unresolvable spec (no executor and an unknown harness).
 */
export interface AgentSpec {
  readonly profile: AgentProfile
  /** `null` selects router/inline; a `BackendType` selects the sandboxed harness. */
  readonly harness: BackendType | null
  /** Trusted candidate/campaign attribution supplied by the caller. Profile/task digests are
   *  computed by Scope from the exact values it executes and cannot be supplied here. */
  readonly execution?: AgentExecutionRef
  /** Per-spawn factory carrying caller configuration. Constructed only after admission, with the
   *  real child signal and nested-scope context. */
  readonly executorFactory?: ExecutorFactory<unknown>
  /** Bring-your-own executor: highest routing precedence after exact-profile intake validation. */
  readonly executor?: Executor<unknown>
}

/** Caller-owned identity beyond the exact profile/task bytes Scope can compute itself. */
export interface AgentExecutionRef {
  readonly candidateDigest?: Sha256Digest
  readonly correlation?: Readonly<Record<string, string>>
}

/** Durable identity of one realized node. Missing digests mean the input was not canonical JSON. */
export interface NodeExecutionIdentity extends AgentExecutionRef {
  readonly profileDigest?: Sha256Digest
  readonly taskDigest?: Sha256Digest
}

/** A named model carried into an execution, or an explicit reason the exact model is unknowable. */
export type MaterializedModelIdentity =
  | { readonly status: 'known'; readonly id: string }
  | { readonly status: 'unknown'; readonly reason: string }

/** External execution identity that operators can use to join this node to its backend. */
export interface MaterializedExecutionIdentity {
  /** Backend-native identity kind, for example `request`, `session`, `run`, `process`, or `tree`. */
  readonly kind: string
  readonly id: string
}

/**
 * Data-only declaration from trusted executor code about the exact sealed plan `execute` uses.
 * Scope snapshots this value and computes the durable receipt; callers never provide digests.
 */
export interface ExecutorMaterialization {
  /** Complete profile after trusted runtime-owned attachments or backend overlays were applied. */
  readonly effectiveProfile: AgentProfile
  /** Concrete backend or harness selected for this run. */
  readonly backend: string
  /** Exact selected model, or an explicit unknown reason. */
  readonly model: MaterializedModelIdentity
  /** Backend-native session/run/request/process identity. */
  readonly execution: MaterializedExecutionIdentity
  /** Named implementation that turns the effective profile into executable backend inputs. */
  readonly materializer: string
  /** Finite JSON describing the exact materialization plan. Persisted by digest only. */
  readonly plan: unknown
  /** Trusted runtime-only attachments, such as the coordination MCP. Persisted by digest only. */
  readonly platformAttachments?: unknown
}

/** Volatile execution routing that is true for one attempt but is not profile identity. The full
 * binding is hashed and discarded; only the safe structural descriptor is journaled. */
export interface ExecutorExecutionBinding {
  readonly attemptId: string
  readonly binding: unknown
  readonly descriptor: Readonly<Record<string, string | number | boolean | null>>
}

/** Why exact materialization evidence is unavailable for a node. */
export type UnknownMaterializationReason =
  | 'executor-did-not-report'
  | 'executor-receipt-pending'
  | 'invalid-executor-report'
  | 'root-agent-did-not-report'

/** What the kernel can prove about one node's actual execution plan. */
export type ProfileMaterializationReceipt =
  | {
      readonly status: 'known'
      readonly authoredProfileDigest: Sha256Digest
      readonly effectiveProfileDigest: Sha256Digest
      readonly materializationPlanDigest: Sha256Digest
      readonly platformAttachmentsDigest?: Sha256Digest
      readonly runtime: Runtime
      readonly backend: string
      readonly model: MaterializedModelIdentity
      readonly execution: MaterializedExecutionIdentity
      readonly materializer: string
    }
  | {
      readonly status: 'unknown'
      readonly authoredProfileDigest?: Sha256Digest
      readonly runtime: Runtime
      readonly reason: UnknownMaterializationReason
    }

/** One attempt's immutable link from a stable materialization plan to its actual transport. */
export type ExecutionBindingReceipt =
  | {
      readonly status: 'known'
      readonly attemptId: string
      readonly materializationReceiptDigest: Sha256Digest
      readonly bindingDigest: Sha256Digest
      readonly descriptor: Readonly<Record<string, string | number | boolean | null>>
    }
  | {
      readonly status: 'unknown'
      readonly attemptId: string
      readonly materializationReceiptDigest: Sha256Digest
      readonly reason: UnknownMaterializationReason
    }

/** Trusted root composition evidence. Generic `Agent.act` roots omit this and remain unknown. */
export type RootMaterialization =
  | {
      readonly runtime: Runtime
      readonly declaration: ExecutorMaterialization
      readonly binding: Omit<ExecutorExecutionBinding, 'attemptId'>
    }
  | {
      /** The runtime-owned external adapter will publish the exact declaration after its dynamic
       * platform attachment (for example a coordination URL) exists and before paid work starts. */
      readonly runtime: Runtime
      readonly declaration: 'deferred'
      /** Exact admitted profile used to validate the stable effective identity at publication. */
      readonly authoredProfile: AgentProfile
    }

/** Kernel-owned context for the concrete supervised node a factory is constructing. */
export interface ExecutorNodeContext {
  readonly rootId: NodeId
  readonly parentId: NodeId
  readonly nodeId: NodeId
  /** Kernel-minted identity for this concrete execution attempt. */
  readonly attemptId: string
  readonly identity?: NodeExecutionIdentity
}

/**
 * Builds a fresh `Executor` for one spawn from the resolved, immutable spec. Per-spawn (not shared)
 * so each child owns its own box/abort/teardown lifecycle. A BYO factory lets a user supply
 * construction args without pre-instantiating; it never bypasses exact-profile validation.
 */
export type ExecutorFactory<Out> = (spec: AgentSpec, ctx: ExecutorContext) => Executor<Out>

/** Construction context handed to a `ExecutorFactory` — the seams a built-in needs
 *  (sandbox client for the sandbox executor, router config for router/inline) without
 *  the factory reaching into module globals. */
export interface ExecutorContext {
  readonly signal: AbortSignal
  /**
   * Request headers inherited from an enclosing task or conversation.
   * Network executors forward these after their own connection headers so caller authorization,
   * recursion depth, and trace identity survive the profile-to-executor boundary.
   */
  readonly propagatedHeaders?: Readonly<Record<string, string>>
  /** Present when Scope constructs the executor for a supervised node. */
  readonly node?: ExecutorNodeContext
  /** Opaque seams the registry threads through; a built-in narrows what it needs. */
  readonly seams: Readonly<Record<string, unknown>>
}

/**
 * The OPEN resolver maps an already-admitted `AgentSpec` to an `ExecutorFactory`. Scope validates
 * before invoking any implementation; the default registry repeats validation for direct callers,
 * resolves the three built-ins, and accepts a BYO `executor`/factory. Callers may register more
 * runtimes by name, but registration does not waive exact-profile validation.
 */
export interface ExecutorRegistry {
  /** Register a factory for a named runtime. Throws on a duplicate name (fail loud). */
  register<Out>(runtime: Runtime, factory: ExecutorFactory<Out>): void
  /**
   * Resolve a spec to a factory. Precedence: a BYO `spec.executorFactory` → `spec.executor` →
   * `harness === null` → the `'router'` factory; else a registered
   * factory for the harness-derived runtime. Returns a typed outcome — the caller
   * inspects `succeeded` before `value` (no silent fallback).
   */
  resolve<Out>(
    spec: AgentSpec,
  ): { succeeded: true; value: ExecutorFactory<Out> } | { succeeded: false; error: string }
}

// ── Budget — the conserved reservation pool ───────────────────────────────────

/** A budget envelope on a spawn or the root. All ceilings; the pool reserves against them. */
export interface Budget {
  readonly maxIterations: number
  readonly maxTokens: number
  readonly maxUsd?: number
  readonly deadlineMs?: number
}

/** Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd
 *  are separate channels (never folded). */
export interface Spend {
  iterations: number
  tokens: LoopTokenUsage
  /** Token accounting is known unless explicitly false. A false value marks work that HAPPENED with
   *  an unreported token count: `tokens` then carries the known subtotal (often `{0,0}`) and must
   *  not be read as the measured total. The twin of `usdKnown` on the token channel — an inference
   *  turn whose provider reported no usage is recorded with this flag rather than omitted, because
   *  omitting it makes the turn look free. */
  tokensKnown?: boolean
  /** Dollar accounting is known unless explicitly false. A false value must not be treated as $0
   *  when enforcing a dollar-denominated comparison or limit. */
  usdKnown?: boolean
  usd: number
  /** The part of `usd` priced from a model catalog because no provider receipt covered the work.
   *  `usd - usdEstimated` is what a provider is known to have billed. Present only with
   *  `usdKnown: false`; absence means nothing here was catalog-priced, not that `usd` is
   *  measured. */
  usdEstimated?: number
  ms: number
}

// ── Node lifecycle ────────────────────────────────────────────────────────────

/** OTP child-spec restart class. */
export type Restart = 'temporary' | 'transient' | 'permanent'

/** `'acquiring'` is first-class (M1): a node spends real time + reaps an orphan box
 *  during sandbox acquire BEFORE it is `running`, so abort must be defined over it.
 *  `'waiting'` is first-class for the opposite reason: a wait-state node holds NO executor, NO
 *  box, and no conserved budget — it is neither in flight nor settled, so neither `inFlight` nor
 *  a terminal status describes it (see `Scope.wait`). */
export type NodeStatus =
  | 'pending'
  | 'acquiring'
  | 'running'
  | 'waiting'
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
  readonly restart?: Restart
  /** Teardown grace handed to the executor when this node is reaped. */
  readonly shutdown?: number | 'brutalKill' | 'infinity'
  /**
   * Semantic identity of this assignment ACROSS process lifetimes. A keyed spawn is
   * idempotent per key: once a child spawned under a key settles `done` — in this process or in a
   * journaled prior one — spawning the same key returns that committed result (`prior.state:
   * 'completed'`) instead of paying for the work again. A key whose prior attempt settled `down`
   * or was journaled as started-but-never-settled spawns FRESH but says so explicitly
   * (`prior.state: 'retried' | 'lost'`), and a key that is currently LIVE is refused
   * (`'duplicate-key'`) — the same assignment can never run twice concurrently. Unkeyed spawns
   * (the default) are position-identified and always run.
   */
  readonly key?: string
}

/** Fail-closed spawn rejections: an exhausted pool, a dollar request against a root that budgets
 *  no dollars, an exceeded recursion ceiling, a full tree-wide worker allocation, or a `key` that
 *  is still LIVE in this scope (the same assignment may not run twice concurrently).
 *
 * `usd-unbudgeted` is separate from `budget-exhausted` because the two call for opposite
 *  responses: an exhausted pool may admit a smaller request, while an unbudgeted dollar channel
 * refuses every amount until the ROOT budget names a `maxUsd`. */
export type SpawnRejection =
  | 'budget-exhausted'
  | 'usd-unbudgeted'
  | 'depth-exceeded'
  | 'duplicate-key'
  | 'invalid-identity'
  | 'key-conflict'
  | 'max-live-workers'
  | 'scope-aborted'

/**
 * What a KEYED spawn resolved to when the key had a prior attempt. Absent on a fresh key (and on
 * every unkeyed spawn). `'completed'` is the exactly-once path: NOTHING was spawned — the handle
 * references the prior settled node and `settled` is the committed result. `'retried'` /
 * `'lost'` DID spawn fresh: the prior attempt settled `down` (retried) or was journaled as
 * started but never settled — the process died with it in flight and the built-in executors
 * cannot re-attach to a dead process's work, so the result is explicitly in doubt (lost), never
 * silently duplicated. On restart, an in-doubt attempt's full declared reservation is charged and
 * its telemetry remains unknown; a fresh retry is admitted only from safely remaining capacity.
 * An executor that CAN re-attach to a still-running external execution extends this union with an
 * adoption state; none of the built-ins can today.
 */
export type SpawnPrior<Out = unknown> =
  | { readonly state: 'completed'; readonly settled: Settled<Out> & { kind: 'done' } }
  | { readonly state: 'retried'; readonly priorId: NodeId; readonly reason: string }
  | { readonly state: 'lost'; readonly priorId: NodeId }

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
      /** Epoch ms parsed from the durable settlement record when available. */
      settledAt?: number
      seq: number
    }
  | {
      kind: 'down'
      handle: Handle<Out>
      reason: string
      /** True = infrastructure failure (excluded from merge `n` / equal-k), not a bad result. */
      infra: boolean
      restartCount: number
      /** Partial structured tool evidence captured before this failure was journaled. */
      trace: WorkerTraceEvidence
      /** Partial provider model evidence survives an aborted or failed execution. */
      providerModel?: ProviderModelExecutionEvidence
      /** Epoch ms parsed from the durable settlement/cancellation record when available. */
      settledAt?: number
      seq: number
    }

// ── The reactive Scope ─────────────────────────────────────────────────────────

/**
 * The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves
 * budget atomically from the shared pool and fails closed when the pool cannot cover it.
 * `next()` waits for one settlement from this scope's live set; `view` reads live state,
 * not the replay log.
 *
 * @stable
 */
export interface Scope<Out> {
  /**
   * Spawn a child. For a fresh key or an unkeyed spawn, tree-wide worker admission happens before a
   * lazy factory is called, so a full worker allocation creates no worker, executor, or reservation.
   * Reserves `opts.budget` from the conserved pool atomically; refunds the unspent remainder on
   * settle. Returns a typed outcome — fail-closed on an exhausted pool, an exceeded depth ceiling, a
   * full worker allocation, or a still-live duplicate `key` (the caller inspects `ok` before
   * `handle`). A KEYED spawn whose key already settled `done` invokes the factory only far enough to
   * prepare and authorize the exact profile/task identity, then compares that identity with the
   * journal. On a match it spends nothing, constructs no executor, reserves no budget, and runs no
   * work: it returns the committed result on `prior` (see `SpawnOpts.key`).
   */
  spawn<C extends Out>(
    agent: Agent<unknown, C> | (() => Agent<unknown, C>),
    task: unknown,
    opts: SpawnOpts,
  ): { ok: true; handle: Handle<C>; prior?: SpawnPrior<C> } | { ok: false; reason: SpawnRejection }
  /** ray.wait n=1 over this scope's in-memory live set; resolves as each child settles;
   *  `null` when the live set is empty. */
  next(): Promise<Settled<Out> | null>
  /**
   * Non-blocking twin of `next()`: deliver an ALREADY-settled, undelivered child, or `null`
   * when none is ready — never awaits a live child. The driver's post-loop drain reads this so
   * a child that settled while the driver was busy (or after it stopped pulling) still reaches
   * the finalize ledger instead of being silently lost.
   */
  nextResolved(): Promise<Settled<Out> | null>
  /**
   * Steer a RUNNING child out-of-band — deliver a message to its executor's inbox (the driver's
   * `send` verb: next-instruction, interrupt, or resume). Returns `true` if the message was
   * delivered to a live child whose executor accepts delivery, `false` otherwise (unknown id,
   * already settled, or an executor with no inbox). The executor drains its inbox between turns;
   * a leaf that does not implement `deliver` simply cannot be steered mid-flight. In-process this
   * is a direct call; the sandbox/Agent-Bus transports surface the SAME verb as an MCP tool.
   */
  send(nodeId: NodeId, msg: unknown): boolean
  /**
   * Arm a WAIT-STATE node: a first-class tree node that waits on wall-clock time (`timer`) or on
   * a named external predicate (`poll`) and settles through THIS scope's `next()` cursor like any
   * other child — but holds no executor, no sandbox, and no conserved budget. Waiting costs zero
   * tokens and zero dollars by construction.
   *
   * It is journaled (`waiting` → `woken`) with its ABSOLUTE deadline, so a run that dies mid-wait
   * resumes still waiting: the supervisor surfaces the un-woken waits on `Scope.resume.waits`, and
   * re-arming the same `label` adopts the recorded node id and original instant instead of
   * restarting the countdown.
   *
   * Fail-closed admission, mirroring `spawn`: `invalid-spec`, `unknown-probe` (a `poll` naming a
   * predicate this run's registry cannot resolve), or `deadline-exceeded` (the wait would outlive
   * the pool's hard wall-clock ceiling — a wait never extends a budget guard).
   *
   * NOT `await_event`: that is an in-run rendezvous on the coordination bus whose 15s fence makes
   * the caller re-poll — each re-poll a driver inference turn against a process that must stay up,
   * and nothing about it survives a restart. See `supervise/wait.ts`.
   */
  wait(
    spec: WaitSpec,
    opts: WaitOpts,
  ): { ok: true; handle: Handle<WaitOutcome> } | { ok: false; reason: WaitRejection }
  /**
   * The LIVE read-model of one child, valid WHILE it runs: last-activity timestamp, idle time,
   * a derived `stalled` flag, tokens/turns spent so far, whether a steer can even reach it
   * (`steerable`), and whatever tool activity its executor exposes. `undefined` for an unknown
   * id. This is the counterpart to `send`: a driver that can steer but cannot observe has
   * nothing to steer on, which is precisely why steering went unused.
   *
   * Pull-based and side-effect free — reading it starts no timer and spends nothing. `now` and
   * `stallAfterMs` are injectable so a caller (and a test) controls what counts as stalled.
   */
  progress(
    nodeId: NodeId,
    opts?: { now?: number; stallAfterMs?: number },
  ): WorkerProgress | undefined
  /** The live tool-call trace of one child when its executor exposes one (`Executor.traceSource`),
   *  for running the online detector panel over a RUNNING worker. `undefined` otherwise. */
  traceSource(nodeId: NodeId): TraceSource | undefined
  /** This scope's abort signal — aborted when the run is cancelled, a breaker trips, the pool
   *  is exhausted, or a parent scope cascades. A long-running driver `act` over this scope reads
   *  it to break promptly (the conserved pool + driver-stop are the other bounds). A nested
   *  scope carries its own signal, chained off its driver child's abort. */
  readonly signal: AbortSignal
  /**
   * Meter the driver's OWN compute against the conserved pool — its inference turns, which are
   * real tokens/usd but not a spawned child (no reserve/reconcile). A direct `free → committed`
   * debit, so equal-k counts the driver's tokens AND the in-loop budget guard (`budget.tokensLeft`)
   * halts a driver that thinks the pool dry. `detail` rides an `agent.turn` trace event for live
   * observability (turn index, tool calls, cumulative spend). It also journals a `metered` event —
   * the durable twin of the pool debit (as `settled` is the twin of `reconcile`) — so every
   * journal-based cost reader (`spentFromJournal`, `trajectoryReport`) sums driver inference
   * automatically. A leaf never calls this; a driver meters each chat turn and awaits it (the
   * metered event is cost-critical, so it lands before the join-barrier roll-up).
   */
  meter(spend: Spend, detail?: Record<string, unknown>): Promise<void>
  /**
   * Prior committed work, present ONLY on a resumed run (`undefined` on a fresh run, which is
   * every run that did not pass `SupervisorOpts.resume`). The supervisor `loadTree`s the journal
   * first; when a non-empty tree exists it rehydrates the already-settled children (via
   * `replaySpawnTree`) and hands them here so a resume-aware `act` re-uses them instead of
   * re-spawning committed work. A resume-blind driver simply ignores it and re-spawns — correct
   * but redundant. The scope's spawn ordinal + cursor seq are already advanced past the recorded
   * maxima, so any NEW spawn appends without colliding with a journaled event.
   *
   * @experimental Same-process replay only — live supervised-tree recovery after a
   * coordinator restart is not implemented (docs/agent-managed-compute/README.md).
   */
  readonly resume?: ResumedWork<Out>
  /** The live tree — reads the in-memory nursery, not the journal. */
  readonly view: TreeView
  /** Conserved-pool readouts (post-reservation). */
  readonly budget: Readonly<{
    tokensLeft: number
    /** `false` once a turn settled without reporting its tokens: `tokensLeft` is then a ceiling,
     *  not a measurement. */
    tokensKnown: boolean
    /** `false` once a charged spend arrived without a readable prompt-cache split. That spend was
     *  charged at its rolled-up prompt total, which counts a cached prefix again on every turn that
     *  reads it, so `tokensLeft` is an upper bound on newly-presented work. */
    cacheBreakdownKnown: boolean
    usdLeft: number
    usdCapped: boolean
    usdKnown: boolean
    iterationsLeft: number
    deadlineMs: number
    reservedTokens: number
  }>
  /** One tree-wide view of simultaneous spawned work. Every nested scope reads the same counter;
   *  the root agent itself is not a spawned worker. `freeSlots` is `null` when no limit is set. */
  readonly workerCapacity: Readonly<{
    live: number
    freeSlots: number | null
  }>
}

/**
 * The committed work a resumed run inherits from its journal. `settled` is the replayed
 * `Settled[]` (cursor-ordered, rehydrated from the blob store by `replaySpawnTree`); `view`
 * is the tree as `materializeTreeView` folded it at the recorded cursor position. A
 * resume-aware `act` reads `scope.resume?.settled` to pick up where the crashed run left off.
 */
export interface ResumedWork<Out> {
  readonly settled: ReadonlyArray<Settled<Out>>
  readonly view: TreeView
  /**
   * Wait-state nodes the journal shows as ARMED but never woken — the run died mid-wait. Each
   * carries the ORIGINAL arm instant and absolute deadline, so re-arming the same `label` through
   * `Scope.wait` resumes the countdown instead of restarting it. Empty on a fresh run and on a
   * resumed run that was not waiting.
   */
  readonly waits: ReadonlyArray<PendingWait>
  /**
   * Keyed assignments from the prior journal: `SpawnOpts.key` → what the journal proves about it.
   * `completed`/`down` carry the rehydrated settlement; `in-doubt` means the spawn was journaled
   * but no settlement ever landed — the process died with it in flight. `Scope.spawn` consults
   * this so a keyed re-spawn resolves instead of duplicating (see `SpawnOpts.key`). Empty when no
   * prior spawn carried a key.
   */
  readonly keys: ReadonlyMap<string, ResumedKeyState<Out>>
  /**
   * The conserved spend the prior process(es) already committed for this run, summed off the same
   * journal replay reads: every `settled` child's reconciled spend (`childWork`) plus every
   * `metered` driver-inference record (`driverInference`). What a resume-aware driver reports as
   * "already paid" — the run's final `spentTotal` includes it because the journal spans processes.
   */
  readonly priorSpend: { readonly childWork: Spend; readonly driverInference: Spend }
}

/** What the journal proves about one keyed assignment at resume time. */
export interface ResumedKeyState<Out = unknown> {
  readonly id: NodeId
  readonly label: string
  /** Identity recorded when this key was first admitted. Every reuse must match it exactly. */
  readonly identity?: NodeExecutionIdentity
  readonly state: 'completed' | 'down' | 'in-doubt'
  /** The rehydrated settlement; absent exactly when `state` is `'in-doubt'`. */
  readonly settled?: Settled<Out>
}

// ── Observability view (read off the in-memory nursery) ────────────────────────

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
  /** Kernel-owned execution evidence. `unknown` is distinct from a known zero/empty plan. */
  readonly materialization?: ProfileMaterializationReceipt
  /** Immutable attempt bindings, oldest first. A retried/resumed node may have more than one. */
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>
  /** Epoch ms of the terminal journal record; absent while live or when legacy evidence lacks it. */
  readonly settledAt?: number
  /** Conserved spend so far for this node. */
  readonly spent: Spend
  /** Provider model evidence persisted separately from the execution plan. */
  readonly providerModel?: ProviderModelExecutionEvidence
  /** `outRef` once the node is `done` (the replay/result pointer). */
  readonly outRef?: string
  /** Present on terminal executor nodes; legacy records carry an explicit unavailable reason. */
  readonly trace?: WorkerTraceEvidence
}

/** The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer. */
export interface TreeView {
  readonly root: NodeId
  readonly nodes: ReadonlyArray<NodeSnapshot>
  /** Count of nodes in `running` or `acquiring` — the "what's in flow?" answer. */
  readonly inFlight: number
  /** Count of nodes in `waiting` — armed wait-states. Deliberately NOT folded into `inFlight`:
   *  a wait burns no executor and no budget, so counting it as flow would misreport both idle
   *  capacity and how much work is actually running. */
  readonly waiting: number
}

// ── Event source — the decision/payload split the replay argument rests on ─────

/** Journaled spawn-tree events (B1/B2). `seq` is the cursor order; `at` is an ISO
 *  timestamp for human inspection only (NOT a replay input). */
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
      budget: Budget
      runtime: Runtime
      /** Exact nested journal tree this node owns. Runtime writes this only after privately
       * attesting the executor as a recursive scope owner. Its absence means no tree is followed,
       * including records written before this field existed and caller leaves named `driver`. */
      ownedTreeRoot?: NodeId
      /** Exact profile/task digests plus trusted candidate/campaign attribution when available. */
      identity?: NodeExecutionIdentity
      seq: number
      at: string
    }
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
      verdict?: DefaultVerdict
      spent: Spend
      /** Provider model evidence is independent from the planned materialization receipt. */
      providerModel?: ProviderModelExecutionEvidence
      infra?: boolean
      /** Exact child failure. Present on every new `status: 'down'` record; optional only so
       * journals written before this field existed remain replayable. */
      reason?: string
      /** Structured tool evidence. Optional only for journals written before trace capture. */
      trace?: WorkerTraceEvidence
      seq: number
      at: string
    }
  | { kind: 'cancelled'; id: NodeId; reason: string; seq: number; at: string }
  | {
      /** A wait-state node was ARMED. Lives in the SPAWN-ORDINAL namespace (`seq` is the wait
       *  ordinal within its parent scope), exactly like `spawned` — it creates a node, it does not
       *  settle one. It carries the whole `spec` and the original `armedAt` so a brand-new process
       *  re-arms the identical wait with the identical ABSOLUTE deadline. */
      kind: 'waiting'
      id: NodeId
      parent?: NodeId
      label: string
      spec: WaitSpec
      armedAt: number
      seq: number
      at: string
    }
  | {
      /** A wait-state node SETTLED — the cursor-namespace twin of `settled`, kept distinct so a
       *  reader can tell zero-cost waiting apart from paid work without inspecting payloads. A
       *  wait carries no `spent` (it is free by construction, not by measurement); `outRef`
       *  rehydrates its `WaitOutcome`, absent when the wait was cancelled. */
      kind: 'woken'
      id: NodeId
      by: 'fired' | 'timeout' | 'cancelled'
      outRef?: string
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
      /** Runtime-owned provider attempt evidence for this driver's own inference turn. */
      providerModel?: ProviderModelExecutionEvidence
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
      edge: {
        kind: 'delegates' | 'analyzes'
        from: string
        to: string
        /** The resolved directive reference (`<surface>/v<n>`), never the directive bytes. */
        directive: string
      }
      /** 1-based traversal ordinal for THIS edge within the run. */
      traversal: number
      outcome: 'delivered' | 'stripped' | 'empty' | 'unpropagated'
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

/**
 * The spawn-tree event source (mirrors `ConversationJournal`'s begin/append/load shape).
 * `loadTree` returns events for inspection and completed-settlement replay, not live process
 * recovery; `appendEvent` runs only AFTER the event is observed-committed (never speculative).
 */
export interface SpawnJournal {
  loadTree(root: NodeId): Promise<SpawnEvent[] | undefined>
  beginTree(root: NodeId, at: string): Promise<void>
  appendEvent(root: NodeId, ev: SpawnEvent): Promise<void>
}

/** Content-addressed result blobs (the `outRef` → artifact map) backing the replay
 *  invariant. Split from the journal so the journal stays small (decisions) and the
 *  payloads (evidence) live where a viewer/replayer rehydrates them. */
export interface ResultBlobStore {
  put(outRef: string, artifact: unknown): Promise<void>
  get(outRef: string): Promise<unknown | undefined>
}

// ── The Supervisor ─────────────────────────────────────────────────────────────

/**
 * Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker,
 * and the root handle. `run` executes the root `Agent` to completion; `attach` wires a
 * live `RootHandle` (the Q2 substrate the chat/pi-viz client later consumes).
 *
 * @stable
 */
export interface Supervisor<Task, Out> {
  run(root: Agent<Task, Out>, task: Task, opts: SupervisorOpts): Promise<SupervisedResult<Out>>
  attach(h: RootHandle<Out>): void
}

export interface SupervisorOpts {
  /** The root conserved-pool ceiling (tokens + usd + iterations + deadline). */
  readonly budget: Budget
  /** Exact root profile/task identity supplied by the one-call composition surface. */
  readonly rootIdentity?: NodeExecutionIdentity
  /** Trusted composition evidence for a root whose `act` drives an external backend. A generic
   *  root omits it and is durably marked unknown; model-facing Scope never receives this writer. */
  readonly rootMaterialization?: RootMaterialization
  /** Trace-correlation root + the journal/blob root key. */
  readonly runId: NodeId
  /** Event source — defaults to the in-memory journal in the impl; pass JSONL/FS for durability. */
  readonly journal: SpawnJournal
  /** Result payload store backing `outRef` rehydration. */
  readonly blobs: ResultBlobStore
  /** Executor resolution — the open registry mapping `AgentSpec` → `Executor`. */
  readonly executors: ExecutorRegistry
  /** Predicate resolution for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so
   *  the wait can be journaled and re-armed by a later process; this is what the name resolves
   *  against. Unset ⇒ `poll` waits are refused (`unknown-probe`); `timer` waits are unaffected. */
  readonly probes?: WaitProbeRegistry
  /** Runtime recursion-depth ceiling (paired with the conserved pool per R3). */
  readonly maxDepth?: number
  /** Hard tree-wide cap on simultaneously executing spawned workers. The root is excluded; every
   *  nested driver and leaf shares this one allocation. Omit/`<= 0` leaves worker count uncapped. */
  readonly maxLiveWorkers?: number
  /**
   * OTP intensity breaker: more than `maxRestarts` child restarts within `withinMs`
   * trips the supervisor to `no-winner` rather than restarting forever.
   */
  readonly maxRestarts?: number
  readonly withinMs?: number
  /**
   * How long live children may keep running after the ROOT DRIVER FAILED, before the join barrier
   * cascades the abort into them (#741). A root that dies did not make its children unhealthy: a
   * child mid-unit holds work already paid for, and killing it instantly discards everything it has
   * not yet written. The window applies ONLY to a driver failure on an un-cancelled run, and never
   * extends past the run's own deadline. Omit/`0` = the historical immediate teardown.
   */
  readonly childSettleGraceMs?: number
  /**
   * Opt into RESUME-FIRST: read any prior journal tree for this `runId` BEFORE beginning a fresh
   * one, and when a non-empty tree exists rehydrate its committed work onto `Scope.resume`
   * (`replaySpawnTree` + `materializeTreeView`) instead of starting over. Requires a journal +
   * blob store that OUTLIVE the process (`createFileRunContext(dir)`); against the in-memory
   * stores there is never a prior tree, so it is a no-op.
   *
   * Default `false` — a run always begins a fresh tree, which is the behavior every existing
   * consumer has. Resume is a durability contract the caller opts into, never a silent default.
   *
   * @experimental Rehydrates committed settlements only; live supervised-tree recovery after a
   * coordinator restart is not implemented (docs/agent-managed-compute/README.md).
   */
  readonly resume?: boolean
  readonly now?: () => number
  readonly signal?: AbortSignal
  /** Lifecycle stream sink, threaded into the root `Scope` so every `spawn`/settle emits on the
   *  same `agent.spawn`/`agent.child` stream `runAgentRounds` feeds — one observable recursive tree. */
  readonly hooks?: RuntimeHooks
  /**
   * Trace context to hand DOWN to each spawned worker, so a worker in another process or on another
   * machine emits spans that join THIS run's trace instead of opening its own root. Supply
   * `SupervisorSpanRecorder.workerTrace`; the `Scope` seeds the resolved context onto every child's
   * `ExecutorContext` and the backends with an environment channel stamp it as
   * `TRACEPARENT` plus the legacy `TRACE_ID` / `PARENT_SPAN_ID` pair (see `worker-trace.ts` for
   * the precedence rule and for which backends propagate). Omit and no worker environment is
   * touched at all.
   */
  readonly workerTrace?: WorkerTraceResolver
  /**
   * Declare that this run's worker backend CANNOT carry the trace context
   * (`WORKER_TRACE_PROPAGATION[backend] === false`). With `workerTrace` also set, every spawn then
   * journals a `trace-unpropagated` event naming the severed hop — the host-side record of a
   * distributed trace that will surface disconnected. `supervise()` derives this from its backend;
   * a direct `createSupervisor()` caller may set it for a caller-owned executor registry.
   */
  readonly workerTraceUnpropagated?: {
    readonly backend: string
    readonly reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted'
  }
}

/** Provider-observed model identity for the root manager's settled inference turns.
 * Runtime records this only from a Runtime-owned provider/bridge receipt; an authored profile
 * alias is never substituted when the provider omits the identity. */
export type RootProviderModelEvidence = ProviderModelExecutionEvidence

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
 * A driver's `act()` rejection, normalized to a serializable triple so it survives the typed
 * no-winner boundary (an `Error` does not cross a structured-clone / JSON hop intact). A
 * non-`Error` rejection normalizes to `{ name: 'NonError', message }` — never dropped.
 * Exported so a consumer handling `reason: 'driver-failed'` names this type instead of retyping
 * its fields.
 */
export interface NoWinnerError {
  name: string
  message: string
  stack?: string
}

/** The accounting channels a usage gap leaves incomplete. */
export type SpendChannel = 'tokens' | 'usd'

/**
 * One journaled node whose usage accounting is incomplete — the named gap behind a `false`
 * `tokensKnown`/`usdKnown` on a terminal `spentTotal`. `never-settled`: the spawn is durable but
 * no terminal record landed, so the whole subtree is unaccounted on every channel and
 * `spentTotal` charges its budget ceiling instead of a fabricated zero. `unreported`: a settled
 * or metered record landed without a complete provider receipt, so the summed numbers are a
 * floor on the named channels, never the measured total.
 */
export interface SpendGap {
  readonly id: NodeId
  /** The spawn label, when the node's `spawned` event is in this journal tree. */
  readonly label?: string
  readonly kind: 'never-settled' | 'unreported'
  readonly channels: ReadonlyArray<SpendChannel>
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
      /** Runtime-owned provider evidence reduced across the complete journal forest. */
      readonly providerModel?: ProviderModelExecutionEvidence
      /** The journaled nodes whose usage accounting is incomplete — the named gaps behind a
       *  `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty. */
      spendGaps?: ReadonlyArray<SpendGap>
      /** Where `spentTotal` went: `driverInference` = the drivers' own chat turns (metered via
       *  `Scope.meter`); `childWork` = every spawned child's reconciled spend (the journal sum).
       *  `driverInference + childWork === spentTotal` on `iterations`/`tokens`/`usd`; the
       *  breakdown's `ms` fields stay executor-reported sums while `spentTotal.ms` is wall clock.
       *  Present whenever any driver metered. */
      spentBreakdown?: { driverInference: Spend; childWork: Spend }
    }
  | {
      /**
       * The LIFECYCLE no-winner arms: the supervisor itself proved why nothing was delivered, so
       * the reason is complete on its own and there is no driver rejection to hand back. A tripped
       * breaker or a real `down` child is `all-children-down`, a cascaded abort is `aborted`, an
       * empty pool is `budget-exhausted`. These outrank `driver-failed`: when the driver threw
       * BECAUSE the pool emptied or the run was aborted, the lifecycle cause is the explanation.
       */
      kind: 'no-winner'
      reason: 'all-children-down' | 'budget-exhausted' | 'aborted'
      tree: TreeView
      downCount: number
      /** The conserved spend incurred before the run failed — real cost is paid even when no
       *  worker delivers, so the caller always learns what the delegation actually spent. Summed
       *  off the same journal the `winner` path reads, with the same contract: wall-clock `ms`,
       *  explicit `tokensKnown`/`usdKnown`, gaps named in `spendGaps`. */
      spentTotal: Spend
      /** Runtime-owned provider evidence for the root manager, when the root executed inference. */
      readonly rootProviderModel?: RootProviderModelEvidence
      /** Runtime-owned provider evidence reduced across the complete journal forest. */
      readonly providerModel?: ProviderModelExecutionEvidence
      /** The journaled nodes whose usage accounting is incomplete — the named gaps behind a
       *  `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty. */
      spendGaps?: ReadonlyArray<SpendGap>
      /** Never present on a lifecycle arm — the discriminant, not prose, is what makes
       *  `if (r.reason === 'driver-failed') r.error.message` compile and every other arm refuse it. */
      error?: never
    }
  | {
      /**
       * The DRIVER-FAULT arm: `act()` rejected, no child ever went down, and no lifecycle cause
       * (breaker/abort/budget) outranks it — so nothing about the tree explains the failure and the
       * driver's own rejection is the only thing that does. It is therefore REQUIRED here.
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
      /** Runtime-owned provider evidence reduced across the complete journal forest. */
      readonly providerModel?: ProviderModelExecutionEvidence
      /** The journaled nodes whose usage accounting is incomplete — the named gaps behind a
       *  `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty. */
      spendGaps?: ReadonlyArray<SpendGap>
      /** The driver's own rejection, carried across the typed no-winner boundary so the failure is
       *  recoverable by the caller. A non-`Error` rejection is normalized, never dropped. */
      error: NoWinnerError
    }

/** Live root handle — a chat/pi-viz client uses it to inspect and control one root run. */
export interface RootHandle<Out> {
  view(): TreeView
  /** Optional for structural compatibility with existing view/signal/abort wrappers. Handles
   * minted by `createRootHandle` implement the required form in `SteerableRootHandle`. */
  deliver?(msg: unknown): boolean
  signal(msg: RootSignal): void
  abort(reason?: string): void
  /** Phantom: binds the handle to the supervised run's output type. Type-only — never
   *  present at runtime; lets `attach(h: RootHandle<Out>)` stay output-typed. */
  readonly __out?: Out
}

/** A Runtime-minted root handle that can deliver raw steering or answers to a live manager inbox.
 * Delivery returns `false` when the manager has no receive path; detached calls fail loud. */
export interface SteerableRootHandle<Out> extends RootHandle<Out> {
  deliver(msg: unknown): boolean
}

/** Out-of-band message to a running root. Open by intent — a client extends it. */
export type RootSignal =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'cancel'; reason?: string }
  | { kind: 'ask'; question: string }

// ── Widening governor ────────────────────────────────────────────────────────

/**
 * The progressive-widening gate (MCTS-PW). Decides whether a settled child is
 * `promising` enough to spawn another under the remaining pool. DEFAULTS TO FLAT
 * (`shouldWiden` always false) so a gate run never widens and the selector≠judge
 * firewall conflict (R2) stays dormant. When widening IS enabled, `promising` MUST be
 * derived from TRACE findings (`analyses`), never raw `verdict` — or the gate carries
 * an explicit, argued `judgeExempt: true` (the documented escape hatch, off by default).
 */
export interface WidenGate<Out> {
  /** Default impl returns false for every settlement (flat — never widens). */
  shouldWiden(settled: Settled<Out>, budget: Scope<Out>['budget']): boolean
  /** When true, widening may read `verdict` directly (collides with the steer firewall —
   *  must be explicitly argued per cell, never defaulted on). */
  readonly judgeExempt?: boolean
}
