/**
 * @experimental
 *
 * Driven-loop substrate — type surface.
 *
 * The loop kernel orchestrates around the sandbox SDK; it does not invent
 * its own notion of "what an agent is". Each iteration is a sandbox-SDK
 * `streamPrompt` call against an `AgentProfile`. The kernel owns iteration
 * accounting, concurrency, abort propagation, cost aggregation, and trace
 * emission; the driver owns topology (plan + decide); the validator owns
 * output scoring; the output adapter owns event-stream → typed-output decode.
 */

import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import type { RuntimeHooks } from '../runtime-hooks'
import type { RuntimeRunHandle } from '../runtime-run'

// DefaultVerdict is a substrate primitive — it lives in @tangle-network/agent-eval.
// agent-runtime re-exports it here so existing consumers keep working without
// changing their import paths. The runtime-shaped `Validator<Output, Verdict>`
// interface below stays in agent-runtime because it's coupled to runtime-only
// concerns (ValidationCtx with iteration + signal + traceEmitter).
export type { DefaultVerdict }

/** @experimental */
export interface ValidationCtx {
  /** Iteration index this output came from (0-based). */
  iteration: number
  /**
   * Live sandbox for this iteration. Validators that need execution-grounded
   * evidence can inspect files or run commands here instead of forcing callers
   * to bypass the loop kernel with raw Sandbox SDK orchestration.
   */
  box?: SandboxInstance
  /** Cooperative cancellation channel. */
  signal: AbortSignal
  /**
   * Optional trace emitter. When set, validator implementations that make
   * LLM calls (e.g. an LLM-judge reviewer) emit spans into it.
   * The kernel passes `ctx.traceEmitter` from `ExecCtx` when available.
   */
  traceEmitter?: LoopTraceEmitter
}

/** @experimental */
export interface Validator<Output, Verdict = DefaultVerdict> {
  validate(output: Output, ctx: ValidationCtx): Promise<Verdict>
}

/**
 * Sandbox-SDK-shaped agent specification.
 *
 * The kernel uses `profile` to instantiate a sandbox per iteration, formats
 * `task` into a prompt via `taskToPrompt`, and merges `sandboxOverrides` into
 * the `CreateSandboxOptions` it passes to `client.create`. Heterogeneous
 * fanout supplies multiple `AgentRunSpec`s and the kernel round-robins
 * through them when the driver plans N tasks.
 *
 * @experimental
 */
export interface AgentRunSpec<Task> {
  /** Sandbox SDK profile — what kind of agent runs the task. */
  profile: AgentProfile
  /** Task → prompt formatter. Pure and deterministic. */
  taskToPrompt: (task: Task) => string
  /**
   * Optional pre-prompt sandbox provisioner. Runs after the sandbox is acquired
   * and before the first prompt is streamed into that box. Use this for
   * domain-agnostic setup such as repo snapshots, benchmark fixtures, policy
   * files, or seed datasets. The hook is part of the runtime surface so loop
   * consumers do not hand-roll Sandbox SDK orchestration just to prepare a
   * workspace before the agent sees it.
   *
   * `ctx.recordMount` records what was placed into the box so the run carries a
   * provenance manifest (`LoopResult.provenance.mounts`). It is optional and
   * provenance-only — the kernel never reads box contents and attaches no
   * meaning to the entries; not calling it simply leaves the manifest empty.
   */
  prepareBox?: (
    box: SandboxInstance,
    ctx: { signal: AbortSignal; recordMount: MountRecorder },
  ) => Promise<void> | void
  /**
   * Per-spec stable name. Surfaced in trace events and the default winner
   * selector tiebreak. Falls back to `profile.name ?? 'agent'`.
   */
  name?: string
  /**
   * Optional sandbox-SDK `CreateSandboxOptions` overrides merged on top of
   * the kernel's defaults. `backend.profile` is set to `profile` by the
   * kernel and cannot be overridden here — use `profile` itself for that.
   */
  sandboxOverrides?: Partial<Omit<CreateSandboxOptions, 'backend'>> & {
    backend?: Omit<NonNullable<CreateSandboxOptions['backend']>, 'profile'>
  }
}

/**
 * Stream of `SandboxEvent`s → typed `Output`.
 *
 * Adapters are pure functions over the already-collected event array; they
 * do not receive the live AsyncIterable so they can be replayed against
 * persisted streams during tests / replays.
 *
 * @experimental
 */
export interface OutputAdapter<Output> {
  parse(events: SandboxEvent[]): Output
}

/** LLM token usage. Structurally matches agent-eval's `RunTokenUsage` /
 *  `CampaignTokenUsage` ({ input, output }) so a loop result maps straight
 *  onto `ctx.cost.observeTokens` in a `runProfileMatrix` dispatch — without
 *  which the backend-integrity guard reads the run as a stub. */
export interface LoopTokenUsage {
  input: number
  output: number
}

/**
 * One mounted resource recorded during box preparation — a pure provenance
 * record of what the caller placed into a box before the agent saw it. The
 * kernel never reads box contents itself (it does not know what was mounted);
 * the caller, which owns the bytes inside `prepareBox`, supplies each entry via
 * `recordMount`. Carries no domain semantics — just where the resource landed,
 * its content fingerprint, its size, and where it came from — so a run is
 * auditable after the fact ("what exactly was this agent given?").
 *
 * @experimental
 */
export interface MountManifestEntry {
  /** Destination path inside the box where the resource was placed. */
  path: string
  /** Hex SHA-256 of the mounted bytes. The caller computes it from the bytes
   *  it wrote — the kernel does not hash box contents. */
  sha256: string
  /** Size of the mounted resource in bytes. */
  bytes: number
  /** Free-form origin of the resource (e.g. a repo ref, a corpus id, a local
   *  path, a URL). Provenance only — the kernel attaches no meaning to it. */
  source: string
}

/**
 * A record of one candidate-selection decision: which iteration the selector
 * picked (or rejected) and why. Pure audit trail of the SELECTOR role — it
 * carries the selector's identity, the candidate's score, and an optional
 * human-readable reason, with no domain semantics. The kernel emits one receipt
 * per scored candidate at finalize so a run answers "why did THIS one win?".
 *
 * @experimental
 */
export interface SelectionReceipt {
  /** Iteration index this receipt is about. */
  candidateIndex: number
  /** True for the iteration the selector chose as winner; false otherwise. */
  selected: boolean
  /** The candidate's verdict score, when it has one. */
  score?: number
  /** Why this candidate was (or was not) selected, when the selector states it. */
  reason?: string
  /** Identity of the selector that produced this receipt — `'caller'` (an
   *  explicit `selectWinner`), `'driver'` (a driver-authored winner), or
   *  `'default'` (the kernel's best-valid-score argmax). */
  selector: 'caller' | 'driver' | 'default'
}

/**
 * Domain-free run provenance: a manifest of what was mounted into the run's
 * boxes and the receipts for how the winner was selected. Surfaced on
 * `LoopResult` purely for run auditability — nothing in the kernel branches on
 * it. Empty arrays when the caller recorded no mounts and there was no
 * candidate to select.
 *
 * @experimental
 */
export interface RunProvenance {
  /** Every resource recorded via `prepareBox`'s `recordMount`, in record order. */
  mounts: MountManifestEntry[]
  /** One receipt per scored candidate at finalize, in iteration order. */
  selectionReceipts: SelectionReceipt[]
}

/**
 * Records a mounted resource into the run's provenance manifest. Passed to
 * `prepareBox` so the caller — which owns the bytes it writes into the box —
 * declares what it mounted without the kernel having to inspect box contents.
 *
 * @experimental
 */
export type MountRecorder = (entry: MountManifestEntry) => void

/** @experimental */
export interface Iteration<Task, Output> {
  /** 0-based iteration index assigned by the kernel. */
  index: number
  task: Task
  /** Stable name of the `AgentRunSpec` that produced this iteration. */
  agentRunName: string
  output?: Output
  verdict?: DefaultVerdict
  error?: Error
  /** Raw sandbox event stream collected for this iteration. */
  events: SandboxEvent[]
  startedAt: number
  endedAt: number
  costUsd: number
  /** Summed LLM token usage across every `llm_call` event in this iteration. */
  tokenUsage: LoopTokenUsage
}

/** @experimental */
export interface Driver<Task, Output, Decision> {
  /**
   * Stable identifier surfaced in trace events. Default `'driver'`.
   */
  readonly name?: string
  /**
   * Tasks to issue this iteration. `[task]` → refine; N copies → fanout;
   * `[]` → no more work this round (kernel proceeds to `decide`).
   */
  plan(task: Task, history: ReadonlyArray<Iteration<Task, Output>>): Promise<Task[]>
  /**
   * Inspect history and return the next state. The kernel terminates the
   * loop when `decide` returns a value listed in `isTerminalDecision`
   * (`'stop' | 'pick-winner' | 'fail' | 'done'`), when `maxIterations`
   * is hit, or when the abort signal fires.
   */
  decide(history: ReadonlyArray<Iteration<Task, Output>>): Decision | Promise<Decision>
  /**
   * Optional: describe the move `plan()` just produced, for trace emission.
   * The kernel calls this immediately after `plan()` and emits the result in
   * the `loop.plan` event so a topology viewer can render the agent's chosen
   * move + rationale (not just the inferred fan-width). Drivers whose topology
   * is a pure function of count (refine/fanout-vote) omit it — the kernel
   * infers `moveKind` from the planned-task count. A driver that authors its
   * own topology returns its chosen move's kind + rationale here.
   */
  describePlan?(): LoopPlanDescription | undefined
  /**
   * Optional: the driver AUTHORS the winner instead of the kernel's argmax. The
   * kernel consults this at finalize ONLY when the caller did not pass an explicit
   * `selectWinner` to runLoop. Return the driver-declared winner (e.g. from a
   * `select` topology move) or `undefined` to fall through to the default
   * (best-valid-score, earliest index). This is the SELECTOR role made
   * agent-authorable — the planner runs the selection, not the kernel.
   * @experimental
   */
  selectWinner?(
    history: ReadonlyArray<Iteration<Task, Output>>,
  ): LoopWinner<Task, Output> | undefined
}

/** @experimental Driver-supplied description of the just-planned move. */
export interface LoopPlanDescription {
  /** Topology move this round — e.g. `'refine' | 'fanout' | 'verify' | 'stop'`. */
  kind: string
  /** Why the driver chose this move (the agent's rationale), when available. */
  rationale?: string
  /**
   * Iteration index this round branches FROM, when the driver declares it.
   * Overrides the kernel's inferred branch point — lets a planner that
   * branches off a specific (non-winner) iteration emit faithful edge lineage.
   * Omit to keep the inferred (best-valid / latest) branch point.
   */
  parentIndex?: number
}

/** @experimental */
export interface LoopWinner<Task, Output> {
  task: Task
  output: Output
  verdict?: DefaultVerdict
  iterationIndex: number
  agentRunName: string
}

/** @experimental */
export interface LoopResult<Task, Output, Decision> {
  decision: Decision
  iterations: Iteration<Task, Output>[]
  winner?: LoopWinner<Task, Output>
  durationMs: number
  /** Sum of every iteration's `costUsd`. */
  costUsd: number
  /** Sum of every iteration's token usage. Forward to
   *  `ctx.cost.observeTokens` in a `runProfileMatrix` dispatch so the
   *  integrity guard sees real LLM activity. */
  tokenUsage: LoopTokenUsage
  /** Domain-free run provenance for auditability: the mount manifest recorded
   *  during `prepareBox` and the selection receipts for how the winner was
   *  chosen. Always present; empty arrays when nothing was recorded. */
  provenance: RunProvenance
}

/**
 * Minimal sandbox client surface the kernel calls. Satisfied structurally by
 * `new Sandbox({ apiKey, baseUrl })` — declared as a structural type so
 * tests can pass a stub without instantiating the SDK.
 *
 * `describePlacement` is optional. When present, the kernel calls it after
 * each `create()` so the `loop.iteration.dispatch` trace event carries fleet
 * coordinates (fleetId + machineId) instead of just the sibling sandboxId.
 * Fleet-aware adapters set this; the raw `Sandbox` SDK class does not, and
 * the kernel falls back to `{ placement: 'sibling', sandboxId: box.id }`.
 *
 * @experimental
 */
export interface SandboxClient {
  create(options?: CreateSandboxOptions): Promise<SandboxInstance>
  describePlacement?(box: SandboxInstance): LoopSandboxPlacement
  /**
   * Optional CRIU capability probe. When present and it resolves
   * `{ available: true }`, the loop's `lineage.fork` seam may checkpoint+fork a
   * parent box so a fanout's branches inherit a shared context prefix; absent or
   * `false`, the fanout degrades to independent fresh boxes. The kernel reads
   * this ONLY through the capability probe — it never branches on backend kind.
   * The raw `Sandbox` SDK class satisfies it; the loop's test fakes omit it
   * (⇒ `canFork = false`).
   * @experimental
   */
  criuStatus?(): Promise<{ available: boolean; criuVersion?: string; reason?: string }>
}

/**
 * Opt-in box-lineage controls for `runLoop`. Default OFF — with both flags
 * unset the kernel's per-iteration behavior is byte-identical to acquiring a
 * fresh box, streaming once, and tearing it down. The independence of N fresh
 * boxes (e.g. `random@k`) is a compute-control invariant; these flags must
 * never apply to it. Enable them ONLY on a steered loop (refine / planner-driven
 * fanout) where reusing the parent's context is intended.
 *
 * Live-box footprint: the lineage keeps every box it starts or forks alive
 * across rounds so a later round can descend from it, and tears them down at
 * loop end. When the driver's branch point is kernel-inferred (no
 * `describePlan` — refine, fanout-vote), the kernel prunes boxes no future
 * round can reach after each round, so the live set tracks the active frontier.
 * When the driver authors its own branch point (`describePlan().parentIndex`),
 * it may descend from any prior
 * iteration, so no box is pruned and the live-box count rises to the total
 * iterations across all rounds. Size `forkFanout` runs accordingly (CRIU forks
 * are copy-on-write, but each is still a live box until loop end).
 *
 * @experimental
 */
export interface LoopLineageOptions {
  /**
   * When true, a refine round (1 planned task) descending from a prior round
   * CONTINUES the parent iteration's session on the SAME box
   * (`streamPrompt({ sessionId })`) instead of acquiring a fresh box and
   * re-injecting prior context as prompt text. Round 0 (no parent) always
   * starts fresh. Usable on any single-task path, not just the refine driver.
   *
   * Requires a platform that honors a client-supplied `sessionId`. The lineage
   * mints the id and `continue` asserts the session is still live
   * (`box.session(id).status()`), failing loud if the platform dropped it — so a
   * non-honoring platform errors instead of silently running contextless turns.
   * Verify continuity against the live platform before enabling: the assertion
   * proves the session EXISTS server-side, not that prior turns replay into it.
   */
  sessionContinuity?: boolean
  /**
   * When true AND the platform reports CRIU fork support, a fanout round (N
   * planned tasks) descending from a prior round FORKS the parent iteration's
   * checkpoint so all N branches inherit a shared context prefix. Without fork
   * support it degrades to N independent fresh boxes (same result, no prefix).
   * Round 0 always starts fresh. NEVER set this for a `random@k` control arm —
   * forking would couple the independent samples.
   *
   * A real fork inherits the parent's IMAGE/PROFILE: per-branch `AgentRunSpec`
   * profiles are honored only on the degraded fresh-box path, so a
   * heterogeneous-profile fanout silently homogenizes to the parent's profile
   * when fork is available. Use this for same-profile branching; for
   * different-per-branch profiles use the unforked fanout path.
   */
  forkFanout?: boolean
  /**
   * Per-turn sandbox streaming mode. Default `'sse'` (live `streamPrompt` —
   * low-latency, full per-token trace; best for interactive chat). `'poll'`
   * fire-and-detaches via `dispatchPrompt` and awaits the terminal result by
   * status-polling, so a long, quiet in-box turn (clone + build + test) never
   * holds a live stream a proxy idle-timeout can drop mid-execution. Lower trace
   * fidelity (one terminal event), so it is opt-in — intended for BATCH eval
   * runs, which don't need live streaming and were losing long turns to the
   * idle-drop. Applies to the default fresh-box path too, not only when
   * `sessionContinuity`/`forkFanout` are on.
   */
  streaming?: 'sse' | 'poll'
}

/** @experimental */
export interface LoopSandboxPlacement {
  kind: 'sibling' | 'fleet'
  sandboxId?: string
  fleetId?: string
  machineId?: string
}

/** @experimental */
export interface LoopTraceEmitter {
  emit(event: LoopTraceEvent): void | Promise<void>
}

/** @experimental */
export type LoopTraceEvent =
  | { kind: 'loop.started'; runId: string; timestamp: number; payload: LoopStartedPayload }
  | { kind: 'loop.plan'; runId: string; timestamp: number; payload: LoopPlanPayload }
  | {
      kind: 'loop.iteration.started'
      runId: string
      timestamp: number
      payload: LoopIterationStartedPayload
    }
  | {
      kind: 'loop.iteration.dispatch'
      runId: string
      timestamp: number
      payload: LoopIterationDispatchPayload
    }
  | {
      kind: 'loop.iteration.ended'
      runId: string
      timestamp: number
      payload: LoopIterationEndedPayload
    }
  | { kind: 'loop.decision'; runId: string; timestamp: number; payload: LoopDecisionPayload }
  | { kind: 'loop.ended'; runId: string; timestamp: number; payload: LoopEndedPayload }
  | {
      kind: 'loop.teardown.failed'
      runId: string
      timestamp: number
      payload: LoopTeardownFailedPayload
    }

/** @experimental */
export interface LoopStartedPayload {
  driver: string
  agentRunNames: string[]
  maxIterations: number
  maxConcurrency: number
}

/**
 * Emitted once per `plan()` round, immediately after the driver plans. Carries
 * the topology move so a viewer renders WHAT the agent decided + WHY, not just
 * the inferred fan-width. `moveKind` is the driver's `describePlan().kind` when
 * provided, else inferred from `plannedCount` (0→stop, 1→refine, N→fanout).
 *
 * @experimental
 */
export interface LoopPlanPayload {
  /** 0-based plan round (one per `plan()` call). */
  roundIndex: number
  /** Tasks the driver issued this round. */
  plannedCount: number
  /** Topology move — `'refine' | 'fanout' | 'verify' | 'stop'` etc. */
  moveKind: string
  /** Driver rationale for the move, when available. */
  rationale?: string
  /**
   * Iteration index this round branched FROM (the edge source). `undefined`
   * for round 0 (root). Kernel-inferred branch point — the best-valid (else
   * latest) iteration so far — unless a driver later declares it explicitly.
   */
  parentIndex?: number
  /** Iteration indices this round dispatched (the edge targets). */
  childIndices: number[]
}

/** @experimental */
export interface LoopIterationStartedPayload {
  iterationIndex: number
  agentRunName: string
  taskHash: string
  /** Plan round (== `LoopPlanPayload.roundIndex`) this iteration belongs to. */
  groupId?: number
  /** Iteration this one was planned from; `undefined` ⇒ root. */
  parentIndex?: number
}

/**
 * Where the iteration's worker was placed. `sibling` = a fresh sandbox the
 * kernel created via `sandboxClient.create`. `fleet` = an existing machine in
 * a shared-workspace fleet — workers see the caller's filesystem and any diff
 * they write lands on it directly.
 *
 * @experimental
 */
export interface LoopIterationDispatchPayload {
  iterationIndex: number
  agentRunName: string
  placement: 'sibling' | 'fleet'
  /** Set on every placement. Lets analyst loops correlate per-iteration logs. */
  sandboxId?: string
  /** Set only when `placement === 'fleet'`. */
  fleetId?: string
  /** Set only when `placement === 'fleet'`. */
  machineId?: string
  /** Plan round this iteration belongs to. */
  groupId?: number
  /** Iteration this one was planned from; `undefined` ⇒ root. */
  parentIndex?: number
}

/** @experimental */
export interface LoopIterationEndedPayload {
  iterationIndex: number
  agentRunName: string
  outputHash?: string
  verdict?: DefaultVerdict
  error?: string
  costUsd: number
  durationMs: number
  /** Summed LLM token usage for this iteration — maps to gen_ai.usage.* on the
   *  branch span. Omitted when no `llm_call` events carried token counts. */
  tokenUsage?: LoopTokenUsage
  /** Plan round this iteration belongs to. */
  groupId?: number
  /** Iteration this one was planned from; `undefined` ⇒ root. */
  parentIndex?: number
  /** Truncated string preview of the parsed output — for a viewer's drawer.
   *  Bounded to ~280 chars; never the full payload. */
  outputPreview?: string
}

/** @experimental */
export interface LoopDecisionPayload {
  decision: string
  historyLength: number
}

/** @experimental */
export interface LoopEndedPayload {
  winnerIterationIndex?: number
  totalCostUsd: number
  durationMs: number
  iterations: number
}

/** Emitted when a box's `delete()` throws or times out during teardown — the
 *  loop swallows the failure (platform reaps on expiry) but surfaces it here so
 *  a real leak (e.g. mid-loop auth expiry) is observable. @experimental */
export interface LoopTeardownFailedPayload {
  sandboxId?: string
  /** `'timeout'` or the delete error message. */
  reason: string
}

/** @experimental */
export interface ExecCtx {
  /** Sandbox SDK client — the kernel calls `.create()` per iteration. */
  sandboxClient: SandboxClient
  /** Optional runtime hooks. Execution-scoped; never part of `AgentProfile`. */
  hooks?: RuntimeHooks
  /** Optional trace emitter. When set, the kernel emits `loop.*` events. */
  traceEmitter?: LoopTraceEmitter
  /**
   * Optional per-event tee. When set, the kernel forwards EVERY raw event from
   * each iteration's `streamPrompt` stream as it arrives, so a host can stream
   * the agent's live output (tokens, tool calls) token-by-token. The observer
   * receives a defensive copy of each event — mutating it cannot affect the
   * run's own cost accounting or output parsing. Called synchronously in the hot
   * stream loop and never awaited, so a slow or never-settling observer cannot
   * stall the stream; keep it cheap. Both a synchronous throw and a rejected
   * returned promise are caught + ignored so the observer can never break the
   * run — but prefer not to depend on that.
   *
   * @experimental
   */
  onSandboxEvent?: (
    event: SandboxEvent,
    meta: { iterationIndex: number; agentRunName: string },
  ) => void | PromiseLike<void>
  /**
   * Optional production-run handle. When set, every synthesized `llm_call`
   * the kernel infers from a sandbox event stream is forwarded via
   * `runHandle.observe` so per-run cost aggregates pick up loop spend.
   */
  runHandle?: RuntimeRunHandle
  /** Cooperative cancellation signal. */
  signal?: AbortSignal
  /**
   * Trace id for OTEL correlation. When set alongside `traceEmitter`, the
   * exporter uses this as the parent trace for all emitted spans. Typically
   * inherited from TRACE_ID env var in MCP subprocess mode.
   */
  traceId?: string
  /**
   * Parent span id for OTEL correlation. Loop events become children of
   * this span. Typically inherited from PARENT_SPAN_ID env var.
   */
  parentSpanId?: string
}
