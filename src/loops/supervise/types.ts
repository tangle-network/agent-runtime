/**
 * @experimental
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
 * The leaf RUNTIME is one OPEN `LeafExecutor` interface, not a closed `inline|sandbox|cli`
 * union the call site switches on. The built-ins (router/inline, sandbox, cli) are the
 * initial IMPLEMENTATIONS; any user agent is first-class the moment it implements the
 * interface. The interface IS the extension point — no per-vendor adapters live here.
 *
 * Layering: substrate types (`DefaultVerdict`) come from `@tangle-network/agent-eval`;
 * runtime-shaped types (everything else) live here. Pure types/interfaces only — this
 * module typechecks standalone and is imported by every keystone impl.
 */

import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type { AgentProfile, BackendType } from '@tangle-network/sandbox'
import type { LoopTokenUsage } from '../types'

// `LoopTokenUsage = { input, output }` ONLY (../types). Re-exported so keystone impls
// import the budget surface from one place. `usd` is a SEPARATE channel (see `UsageEvent`).
export type { DefaultVerdict, LoopTokenUsage }

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
}

// ── The open leaf runtime ─────────────────────────────────────────────────────

/**
 * The leaf runtime — ONE open interface, not a closed union. `execute` returns a
 * `Promise<LeafResult>` for one-shot executors OR an `AsyncIterable<UsageEvent>` for
 * streaming ones; a streaming executor reports incremental normalized usage as it runs
 * (the budget pool reconciles against it) and exposes its terminal artifact via
 * `resultArtifact()`. Both shapes normalize usage to `UsageEvent` so the conserved pool
 * meters every runtime identically.
 *
 * Built-in implementations (in `runtime.ts`, NOT variants here): router/inline (a direct
 * Router/HTTP inference call, no box), sandbox (COMPOSES `runLoop` as a leaf, forwarding
 * PR #150's optional `lineage` passthrough — does NOT reinvent checkpoint/fork), cli
 * (Halo/RLM subprocess; `budgetExempt`, excluded from equal-k by construction). A user's
 * own agent (mastra/agno/raw HTTP/anything) is first-class by implementing this interface.
 */
export interface LeafExecutor<Out> {
  /** Stable runtime tag for traces + the equal-k exemption check. */
  readonly runtime: Runtime
  /**
   * When true, this executor's spend is NOT metered against the conserved pool and its
   * iterations are excluded from the equal-k assertion (a `cli` subprocess without
   * token accounting). Fail-loud everywhere else: a metered executor MUST report usage.
   */
  readonly budgetExempt?: boolean
  /**
   * One-shot → resolves a `LeafResult`; streaming → yields incremental `UsageEvent`s and
   * the terminal artifact is read from `resultArtifact()` after the stream drains.
   * `signal` is the spawn-scoped abort (chains the acquire lifecycle for sandbox).
   */
  execute(task: unknown, signal: AbortSignal): Promise<LeafResult<Out>> | AsyncIterable<UsageEvent>
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
}

/** Terminal artifact of a one-shot `LeafExecutor.execute`. */
export interface LeafResult<Out> {
  outRef: string
  out: Out
  verdict?: DefaultVerdict
  spent: Spend
}

/**
 * Normalized usage event — the single channel every executor reports through, so the
 * conserved pool meters all runtimes identically. `tokens` carries `LoopTokenUsage`'s
 * `{ input, output }`; `usd` is a SEPARATE channel (never folded into tokens).
 */
export type UsageEvent =
  | { kind: 'tokens'; input: number; output: number }
  | { kind: 'cost'; usd: number }
  | { kind: 'iteration' }

/** The runtime tag of a `LeafExecutor` impl. Open by intent — `string` so a BYO executor
 *  names its own runtime; the built-ins use these literals. */
export type Runtime = 'router' | 'inline' | 'sandbox' | 'cli' | (string & {})

// ── Executor resolution (OPEN registry, not a switch) ─────────────────────────

/**
 * `AgentProfile` does NOT carry a `harness`/backend field — `harness` lives on the
 * sandbox SDK's `BackendConfig`, not the portable profile. So an agent is mapped to its
 * executor through this MINIMAL wrapper, never by fabricating a field onto `AgentProfile`.
 *
 * Resolution (in `runtime.ts`):
 *  - `executor` present        → BYO: use it verbatim (a user's own `LeafExecutor`).
 *  - `harness === null`        → router/inline: a direct Router call, no box.
 *  - `harness` is a `BackendType` → sandbox: compose `runLoop` against `profile` on that backend.
 * Fail loud on an unresolvable spec (no executor and an unknown harness).
 */
export interface AgentSpec {
  readonly profile: AgentProfile
  /** `null` selects router/inline; a `BackendType` selects the sandboxed harness. */
  readonly harness: BackendType | null
  /** Bring-your-own executor: when set, overrides harness-based resolution entirely. */
  readonly executor?: LeafExecutor<unknown>
}

/**
 * Builds a fresh `LeafExecutor` for one spawn from the resolved spec. Per-spawn (not
 * shared) so each child owns its own box/abort/teardown lifecycle. A BYO factory lets a
 * user supply construction args without pre-instantiating.
 */
export type LeafExecutorFactory<Out> = (spec: AgentSpec, ctx: ExecutorContext) => LeafExecutor<Out>

/** Construction context handed to a `LeafExecutorFactory` — the seams a built-in needs
 *  (sandbox client for the sandbox executor, router config for router/inline) without
 *  the factory reaching into module globals. */
export interface ExecutorContext {
  readonly signal: AbortSignal
  /** Opaque seams the registry threads through; a built-in narrows what it needs. */
  readonly seams: Readonly<Record<string, unknown>>
}

/**
 * The OPEN resolver: maps an `AgentSpec` to a `LeafExecutorFactory`. The default
 * registry resolves the three built-ins AND accepts a BYO `executor`/factory; callers
 * register more runtimes by name. NOT a closed switch — registration is the extension
 * point, mirroring the open `LeafExecutor` interface.
 */
export interface ExecutorRegistry {
  /** Register a factory for a named runtime. Throws on a duplicate name (fail loud). */
  register<Out>(runtime: Runtime, factory: LeafExecutorFactory<Out>): void
  /**
   * Resolve a spec to a factory. Precedence: a BYO `spec.executor` → a trivial factory
   * returning it; else `harness === null` → the `'router'` factory; else a registered
   * factory for the harness-derived runtime. Returns a typed outcome — the caller
   * inspects `succeeded` before `value` (no silent fallback).
   */
  resolve<Out>(
    spec: AgentSpec,
  ): { succeeded: true; value: LeafExecutorFactory<Out> } | { succeeded: false; error: string }
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
  usd: number
  ms: number
}

// ── Node lifecycle ────────────────────────────────────────────────────────────

/** OTP child-spec restart class. */
export type Restart = 'temporary' | 'transient' | 'permanent'

/** `'acquiring'` is first-class (M1): a node spends real time + reaps an orphan box
 *  during sandbox acquire BEFORE it is `running`, so abort must be defined over it. */
export type NodeStatus = 'pending' | 'acquiring' | 'running' | 'done' | 'failed' | 'cancelled'

/** Deterministic node id — `${parent}:s${seq}` from the cursor order, never wall-clock. */
export type NodeId = string

export interface SpawnOpts {
  readonly budget: Budget
  readonly label: string
  readonly restart?: Restart
  /** Teardown grace handed to the executor when this node is reaped. */
  readonly shutdown?: number | 'brutalKill' | 'infinity'
}

/**
 * A live child handle. `abort()` is defined over the ACQUIRE lifecycle: it chains into
 * the `acquireSandbox` signal and reaps a find-by-name orphan box, so a node aborted
 * mid-acquire never leaks (M1).
 */
export interface Handle<Out> {
  readonly id: NodeId
  readonly label: string
  readonly status: NodeStatus
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
      seq: number
    }
  | {
      kind: 'down'
      handle: Handle<Out>
      reason: string
      /** True = infrastructure failure (excluded from merge `n` / equal-k), not a bad result. */
      infra: boolean
      restartCount: number
      seq: number
    }

// ── The reactive Scope ─────────────────────────────────────────────────────────

/**
 * The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves
 * budget atomically from the shared pool and FAILS CLOSED when the pool can't cover it;
 * `next()` is a ray.wait cursor (n=1) over THIS scope's IN-MEMORY live set; `view` reads
 * the in-memory nursery (NOT the log), O(live).
 */
export interface Scope<Out> {
  /**
   * Spawn a child. Reserves `opts.budget` from the conserved pool atomically; refunds the
   * unspent remainder on settle. Returns a typed outcome — fail-closed on an exhausted
   * pool or an exceeded depth ceiling (the caller inspects `ok` before `handle`).
   */
  spawn<C extends Out>(
    agent: Agent<unknown, C>,
    task: unknown,
    opts: SpawnOpts,
  ): { ok: true; handle: Handle<C> } | { ok: false; reason: 'budget-exhausted' | 'depth-exceeded' }
  /** ray.wait n=1 over this scope's in-memory live set; resolves as each child settles;
   *  `null` when the live set is empty. */
  next(): Promise<Settled<Out> | null>
  /** The live tree — reads the in-memory nursery, not the journal. */
  readonly view: TreeView
  /** Conserved-pool readouts (post-reservation). */
  readonly budget: Readonly<{
    tokensLeft: number
    usdLeft: number
    deadlineMs: number
    reservedTokens: number
  }>
}

// ── Observability view (read off the in-memory nursery) ────────────────────────

export interface NodeSnapshot {
  readonly id: NodeId
  readonly parent?: NodeId
  readonly label: string
  readonly status: NodeStatus
  readonly runtime: Runtime
  readonly budget: Budget
  /** Conserved spend so far for this node. */
  readonly spent: Spend
  /** `outRef` once the node is `done` (the replay/result pointer). */
  readonly outRef?: string
}

/** The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer. */
export interface TreeView {
  readonly root: NodeId
  readonly nodes: ReadonlyArray<NodeSnapshot>
  /** Count of nodes in `running` or `acquiring` — the "what's in flow?" answer. */
  readonly inFlight: number
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
      budget: Budget
      runtime: Runtime
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
      infra?: boolean
      seq: number
      at: string
    }
  | { kind: 'cancelled'; id: NodeId; reason: string; seq: number; at: string }

/**
 * The spawn-tree event source (mirrors `ConversationJournal`'s begin/append/load shape).
 * `loadTree` replays the full ordered event list for resume/replay; `appendEvent` is
 * called only AFTER the event is observed-committed (never speculative).
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
 */
export interface Supervisor<Task, Out> {
  run(root: Agent<Task, Out>, task: Task, opts: SupervisorOpts): Promise<SupervisedResult<Out>>
  attach(h: RootHandle<Out>): void
}

export interface SupervisorOpts {
  /** The root conserved-pool ceiling (tokens + usd + iterations + deadline). */
  readonly budget: Budget
  /** Trace-correlation root + the journal/blob root key. */
  readonly runId: NodeId
  /** Event source — defaults to the in-memory journal in the impl; pass JSONL/FS for durability. */
  readonly journal: SpawnJournal
  /** Result payload store backing `outRef` rehydration. */
  readonly blobs: ResultBlobStore
  /** Executor resolution — the open registry mapping `AgentSpec` → `LeafExecutor`. */
  readonly executors: ExecutorRegistry
  /** Runtime recursion-depth ceiling (paired with the conserved pool per R3). */
  readonly maxDepth?: number
  /**
   * OTP intensity breaker: more than `maxRestarts` child restarts within `withinMs`
   * trips the supervisor to `no-winner` rather than restarting forever.
   */
  readonly maxRestarts?: number
  readonly withinMs?: number
  readonly now?: () => number
  readonly signal?: AbortSignal
}

/** Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output. */
export type SupervisedResult<Out> =
  | {
      kind: 'winner'
      out: Out
      outRef: string
      verdict?: DefaultVerdict
      tree: TreeView
      spentTotal: Spend
    }
  | {
      kind: 'no-winner'
      reason: 'all-children-down' | 'budget-exhausted' | 'aborted'
      tree: TreeView
      downCount: number
    }

/** Live root handle — the substrate a chat/pi-viz client attaches to (Q2). `signal`
 *  delivers an out-of-band message to the running root; `view()` materializes the tree. */
export interface RootHandle<Out> {
  view(): TreeView
  signal(msg: RootSignal): void
  abort(reason?: string): void
  /** Phantom: binds the handle to the supervised run's output type. Type-only — never
   *  present at runtime; lets `attach(h: RootHandle<Out>)` stay output-typed. */
  readonly __out?: Out
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
