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
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import type { RuntimeHooks } from '../../runtime-hooks'
import type { LoopTokenUsage } from '../types'
import type { ExecutorProgress, WorkerProgress } from './progress'
import type { TraceSource } from './trace-source'
import type { PendingWait, WaitOutcome, WaitProbeRegistry, WaitRejection, WaitSpec } from './wait'
import type { WorkerTraceResolver } from './worker-trace'

// `LoopTokenUsage = { input, output }` ONLY (../types). Re-exported so keystone impls
// import the budget surface from one place. `usd` is a SEPARATE channel (see `UsageEvent`).
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
 * (Halo/RLM subprocess; `budgetExempt`, excluded from equal-k by construction). A user's
 * own agent (mastra/agno/raw HTTP/anything) is first-class by implementing this interface.
 */
export interface Executor<Out> {
  /** Stable runtime tag for traces + the equal-k exemption check. */
  readonly runtime: Runtime
  /**
   * When true, this executor's spend is NOT metered against the conserved pool and its
   * iterations are excluded from the equal-k assertion (a `cli` subprocess without
   * token accounting). Fail-loud everywhere else: a metered executor MUST report usage.
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
   * this; `Scope.send` then returns `false` for it. Never throws — a malformed message is the
   * executor's to ignore.
   */
  deliver?(msg: unknown): void
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
   * A driver-executor's OWN-inference subtree total (rolled up from its nested tree's `metered`
   * events) — the parent scope journals it as a `metered` event for this node on settle, on BOTH
   * the done AND the down/crash paths, so a crashed sub-driver's partial inference still re-homes
   * (the pool already debited it via `observe`; the journal must match). NOT reconciled, so it never
   * trips the reservation clamp. Read on settle, valid after `execute` resolves OR throws. Leaf
   * executors omit it (returns `undefined`).
   */
  metered?(): Spend | undefined
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
 * `{ input, output }`; `usd` is a SEPARATE channel (never folded into tokens).
 *
 * KNOWN LIMITATION (pre-existing): the `cost` variant can say its dollars are a subtotal
 * (`usdKnown: false`), and the `tokens` variant has NO twin — there is no way to report "this turn
 * happened and its token count is unknown". `Spend.tokensKnown` exists downstream, but nothing
 * upstream of `foldStream` (`scope.ts`) can ever set it, so a STREAMING executor whose provider
 * omitted usage reports the turn as costing zero tokens rather than as unmeasured. Only the
 * non-streaming path, which returns a whole `Spend`, can carry the marker today. Closing it means
 * widening this union (a `tokensKnown: false` field on `tokens`, or an `unknown` variant) and
 * threading it through `foldStream` — a change to the metering contract every executor implements,
 * which is why it is not folded into a streaming-transport fix. Filed separately.
 */
export type UsageEvent =
  | { kind: 'tokens'; input: number; output: number }
  | {
      kind: 'cost'
      /** Known dollar subtotal. When false, `usd` must not be treated as total cost. */
      usdKnown?: false
      usd: number
    }
  | { kind: 'iteration' }

/** The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name.
 * External executors can register additional runtime strings without widening this type. */
export type Runtime = 'router' | 'inline' | 'sandbox' | 'cli' | (string & {})

// ── Executor resolution (OPEN registry, not a switch) ─────────────────────────

/**
 * `AgentProfile` does NOT carry a `harness`/backend field — `harness` lives on the
 * sandbox SDK's `BackendConfig`, not the portable profile. So an agent is mapped to its
 * executor through this MINIMAL wrapper, never by fabricating a field onto `AgentProfile`.
 *
 * Resolution (in `runtime.ts`):
 *  - `executor` present        → BYO: use it verbatim (a user's own `Executor`).
 *  - `harness === null`        → router/inline: a direct Router call, no box.
 *  - `harness` is a `BackendType` → sandbox: compose `runAgentRounds` against `profile` on that backend.
 * Fail loud on an unresolvable spec (no executor and an unknown harness).
 */
export interface AgentSpec {
  readonly profile: AgentProfile
  /** `null` selects router/inline; a `BackendType` selects the sandboxed harness. */
  readonly harness: BackendType | null
  /** Bring-your-own executor: when set, overrides harness-based resolution entirely. */
  readonly executor?: Executor<unknown>
}

/**
 * Builds a fresh `Executor` for one spawn from the resolved spec. Per-spawn (not
 * shared) so each child owns its own box/abort/teardown lifecycle. A BYO factory lets a
 * user supply construction args without pre-instantiating.
 */
export type ExecutorFactory<Out> = (spec: AgentSpec, ctx: ExecutorContext) => Executor<Out>

/** Construction context handed to a `ExecutorFactory` — the seams a built-in needs
 *  (sandbox client for the sandbox executor, router config for router/inline) without
 *  the factory reaching into module globals. */
export interface ExecutorContext {
  readonly signal: AbortSignal
  /** Opaque seams the registry threads through; a built-in narrows what it needs. */
  readonly seams: Readonly<Record<string, unknown>>
}

/**
 * The OPEN resolver: maps an `AgentSpec` to a `ExecutorFactory`. The default
 * registry resolves the three built-ins AND accepts a BYO `executor`/factory; callers
 * register more runtimes by name. NOT a closed switch — registration is the extension
 * point, mirroring the open `Executor` interface.
 */
export interface ExecutorRegistry {
  /** Register a factory for a named runtime. Throws on a duplicate name (fail loud). */
  register<Out>(runtime: Runtime, factory: ExecutorFactory<Out>): void
  /**
   * Resolve a spec to a factory. Precedence: a BYO `spec.executor` → a trivial factory
   * returning it; else `harness === null` → the `'router'` factory; else a registered
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
 *  no dollars, an exceeded recursion ceiling, or a `key` that is still LIVE in this scope (the
 *  same assignment may not run twice concurrently).
 *
 *  `usd-unbudgeted` is separate from `budget-exhausted` because the two call for opposite
 *  responses: an exhausted pool may admit a smaller request, while an unbudgeted dollar channel
 *  refuses every amount until the ROOT budget names a `maxUsd`. */
export type SpawnRejection =
  | 'budget-exhausted'
  | 'usd-unbudgeted'
  | 'depth-exceeded'
  | 'duplicate-key'

/**
 * What a KEYED spawn resolved to when the key had a prior attempt. Absent on a fresh key (and on
 * every unkeyed spawn). `'completed'` is the exactly-once path: NOTHING was spawned — the handle
 * references the prior settled node and `settled` is the committed result. `'retried'` /
 * `'lost'` DID spawn fresh: the prior attempt settled `down` (retried) or was journaled as
 * started but never settled — the process died with it in flight and the built-in executors
 * cannot re-attach to a dead process's work, so the result is explicitly in doubt (lost), never
 * silently duplicated. An executor that CAN re-attach to a still-running external execution (a
 * live sandbox box) extends this union with an adoption state; none of the built-ins can today.
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
 * budget atomically from the shared pool and fails closed when the pool cannot cover it.
 * `next()` waits for one settlement from this scope's live set; `view` reads live state,
 * not the replay log.
 */
export interface Scope<Out> {
  /**
   * Spawn a child. Reserves `opts.budget` from the conserved pool atomically; refunds the
   * unspent remainder on settle. Returns a typed outcome — fail-closed on an exhausted
   * pool, an exceeded depth ceiling, or a still-live duplicate `key` (the caller inspects
   * `ok` before `handle`). A KEYED spawn whose key already settled `done` spends nothing:
   * it returns the committed result on `prior` instead of re-running (see `SpawnOpts.key`).
   */
  spawn<C extends Out>(
    agent: Agent<unknown, C>,
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
   */
  readonly resume?: ResumedWork<Out>
  /** The live tree — reads the in-memory nursery, not the journal. */
  readonly view: TreeView
  /** Conserved-pool readouts (post-reservation). */
  readonly budget: Readonly<{
    tokensLeft: number
    usdLeft: number
    usdCapped: boolean
    deadlineMs: number
    reservedTokens: number
    /** Present and `false` once a turn settled without reporting its tokens: `tokensLeft` is then
     *  a ceiling, not a measurement. Absent means every settled turn reported. */
    tokensKnown?: boolean
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
  /** Executor resolution — the open registry mapping `AgentSpec` → `Executor`. */
  readonly executors: ExecutorRegistry
  /** Predicate resolution for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so
   *  the wait can be journaled and re-armed by a later process; this is what the name resolves
   *  against. Unset ⇒ `poll` waits are refused (`unknown-probe`); `timer` waits are unaffected. */
  readonly probes?: WaitProbeRegistry
  /** Runtime recursion-depth ceiling (paired with the conserved pool per R3). */
  readonly maxDepth?: number
  /**
   * OTP intensity breaker: more than `maxRestarts` child restarts within `withinMs`
   * trips the supervisor to `no-winner` rather than restarting forever.
   */
  readonly maxRestarts?: number
  readonly withinMs?: number
  /**
   * Opt into RESUME-FIRST: read any prior journal tree for this `runId` BEFORE beginning a fresh
   * one, and when a non-empty tree exists rehydrate its committed work onto `Scope.resume`
   * (`replaySpawnTree` + `materializeTreeView`) instead of starting over. Requires a journal +
   * blob store that OUTLIVE the process (`createFileRunContext(dir)`); against the in-memory
   * stores there is never a prior tree, so it is a no-op.
   *
   * Default `false` — a run always begins a fresh tree, which is the behavior every existing
   * consumer has. Resume is a durability contract the caller opts into, never a silent default.
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
   * `TRACE_ID` / `PARENT_SPAN_ID` (see `worker-trace.ts` for the precedence rule and for which
   * backends propagate). Omit and no worker environment is touched at all.
   */
  readonly workerTrace?: WorkerTraceResolver
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

/** Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output. */
export type SupervisedResult<Out> =
  | {
      kind: 'winner'
      out: Out
      outRef: string
      verdict?: DefaultVerdict
      tree: TreeView
      spentTotal: Spend
      /** Where `spentTotal` went: `driverInference` = the drivers' own chat turns (metered via
       *  `Scope.meter`); `childWork` = every spawned child's reconciled spend (the journal sum).
       *  `driverInference + childWork === spentTotal`. Present whenever any driver metered. */
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
       *  off the same journal the `winner` path reads. */
      spentTotal: Spend
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
       *  off the same journal the `winner` path reads. */
      spentTotal: Spend
      /** The driver's own rejection, carried across the typed no-winner boundary so the failure is
       *  recoverable by the caller. A non-`Error` rejection is normalized, never dropped. */
      error: NoWinnerError
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
