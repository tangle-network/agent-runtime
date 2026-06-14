/**
 * @experimental
 *
 * The personify layer — the "act like X" knob on top of the recursive keystone.
 *
 * The keystone (`src/loops/supervise/`) is pure STRUCTURE: a recursive `Agent` atom inside
 * a budget-conserving `Scope`, an `ExecutorRegistry` mapping an `AgentSpec` to a runtime,
 * and a `Supervisor` that runs a root agent to a typed `SupervisedResult`. It carries no
 * CONTENT — no model, no prompt, no goal framing, no notion of "who this loop is".
 *
 * This layer adds exactly that content seam without inventing a second engine:
 *  - A `Persona` is a thin record: the root `AgentSpec` (profile + harness + optional BYO
 *    executor), a root `directive` (the goal framing handed to the chosen shape), a
 *    `context` blob (who the loop is acting as), and the executor seams the registry needs.
 *    `definePersona` builds it; it is data, not behavior.
 *  - A `LoopShape` is a reusable act-body FACTORY: `(ctx: ShapeContext) => Agent`. The shape
 *    owns the STRUCTURE (how to decompose / fan out / verify / synthesize); the persona's
 *    content parameterizes it. A new shape is ONE file + one `registerShape` call.
 *  - `Outcome<D>` is the contract every shape synthesizes into: a finished deliverable OR a
 *    list of concrete blockers — "100% done or 100%-defined blockers", never a vague middle.
 *
 * Layering: this module imports ONLY keystone runtime types (`./supervise/types`) and the
 * substrate `AgentProfile`/`BackendType`. It typechecks standalone — no impl, no engine.
 * Extensibility is structural: `Persona` carries an open `extensions` bag so a later
 * world-model / memory field is additive (a new optional key), never a breaking change.
 */

import type { AgentProfile, BackendType } from '@tangle-network/sandbox'
import type {
  Agent,
  AgentSpec,
  Budget,
  ExecutorRegistry,
  ResultBlobStore,
  RootHandle,
  SpawnJournal,
  SupervisedResult,
} from '../supervise/types'
import type { ScopeAnalyst } from './wave-types'

// ── The deliverable contract every shape synthesizes into ──────────────────────

/**
 * The terminal contract Drew wants: a loop returns a FINISHED deliverable, or the concrete
 * list of blockers that stopped it — never a half-done best-effort coercion. A `blocked`
 * outcome with an empty `blockers` list is a contract violation (a shape that can't finish
 * MUST name why); impls fail loud on it rather than emitting a vacuous block.
 *
 * `Outcome` is the `Out` type a personified `Agent`/`Supervisor` is parameterized by, so the
 * keystone's typed `SupervisedResult<Outcome<D>>` carries it end to end with no coercion.
 */
export type Outcome<D> = { kind: 'done'; deliverable: D } | { kind: 'blocked'; blockers: string[] }

// ── The persona: the content seam (data, not an engine) ─────────────────────────

/**
 * The "act like X" record. A thin composition over the keystone's `AgentSpec`: it pairs the
 * root spec (the executor mapping for the root agent the shape builds) with the CONTENT a
 * shape consumes — the goal framing (`directive`) and who the loop is acting as (`context`).
 *
 * The framework never reads `directive`/`context` semantically; it threads them to the shape
 * verbatim through `ShapeContext`. This is the rule the mandate names: the FRAMEWORK is
 * structure, the PERSONA carries model/prompt/tools/directive. No model name, prompt, or
 * persona string is ever hardcoded in a shape or the engine.
 *
 * `D` is the deliverable type this persona's loops produce; it flows into `Outcome<D>`.
 */
export interface Persona<D = unknown> {
  /** Stable persona name — used as the trace/journal label root, never as content. */
  readonly name: string
  /**
   * The root agent's executor mapping (profile + harness + optional BYO executor). The
   * shape's root `Agent` carries THIS as its `executorSpec`; child specs the shape spawns
   * are derived from / resolved against the same persona registry (see `ShapeContext`).
   */
  readonly root: AgentSpec
  /** The goal framing handed to the shape — the "what to achieve", not "how". */
  readonly directive: string
  /** Who the loop is acting as — the opaque persona context blob the shape may inject into
   *  child tasks. Opaque to the framework; only the persona's profiles/prompts interpret it. */
  readonly context: PersonaContext
  /**
   * The executor seams (router endpoint+key, sandbox client, cli bin) the built-in runtimes
   * read off `ExecutorContext.seams`, OR a fully pre-configured registry. The supervisor
   * threads an EMPTY seam bag to the root scope, so a persona that uses built-in metered
   * runtimes MUST supply a registry whose factories close over their seams (or BYO executors
   * on each `AgentSpec`). Carried here so `runPersonified` can build `SupervisorOpts.executors`.
   */
  readonly executors: PersonaExecutors
  /**
   * Forward-compatible extension bag — a later world-model / memory / tool-budget field is an
   * additive key here, never a breaking change to the `Persona` shape. Opaque to the engine.
   */
  readonly extensions?: Readonly<Record<string, unknown>>
  /** Phantom: binds the persona to its deliverable type so `runPersonified` infers `D` from
   *  the persona and the chosen shape must agree. Type-only — never present at runtime. */
  readonly __deliverable?: D
}

/** The persona context blob — who the loop is acting as. Open by intent: a persona names its
 *  own role/audience/constraints; the framework treats it as opaque content. */
export interface PersonaContext {
  /** The role the loop embodies ("senior staff engineer", "equity research analyst", …). */
  readonly role: string
  /** Optional freeform framing the persona's prompts/profiles consume. */
  readonly notes?: string
  /** Open content bag — persona-specific fields a shape's child tasks may carry. */
  readonly [key: string]: unknown
}

/**
 * How a persona supplies executor resolution. Either a pre-built registry (factories already
 * closed over their seams) OR the raw seam bag the engine uses to construct a registry +
 * thread the seams onto each spawn. Exactly one is required — fail loud if neither is set.
 */
export interface PersonaExecutors {
  /** A registry whose factories already capture their seams. Highest precedence. */
  readonly registry?: ExecutorRegistry
  /** Raw seams to thread onto built-in runtimes (`router`/`sandbox`/`cli` keys). */
  readonly seams?: Readonly<Record<string, unknown>>
}

// ── definePersona — the thin builder ─────────────────────────────────────────────

/** The minimal input to build a `Persona`. Mirrors `Persona` but lets the builder default
 *  the executors-supplied invariant check and freeze the record. */
export interface DefinePersonaInput<D = unknown> {
  readonly name: string
  readonly root: AgentSpec
  readonly directive: string
  readonly context: PersonaContext
  readonly executors: PersonaExecutors
  readonly extensions?: Readonly<Record<string, unknown>>
  /** Phantom: pins the input's deliverable type so `definePersona<D>` returns a `Persona<D>`
   *  the caller's shape must agree with. Type-only — never supplied at a call site. */
  readonly __deliverable?: D
}

/** Builds a frozen `Persona`, failing loud on the executors-supplied invariant (neither a
 *  registry nor seams = an unresolvable persona). Pure — no I/O, no engine. */
export type DefinePersona = <D = unknown>(input: DefinePersonaInput<D>) => Persona<D>

// ── The loop shape: reusable structure, parameterized by persona content ─────────

/**
 * Budget knobs a shape reads to size its fanout/children WITHOUT owning the conserved pool.
 * The root budget lives on `SupervisorOpts.budget`; the shape only needs the per-child
 * sizing hints + the fanout width it is allowed to open. All ceilings — the pool reserves
 * against them and fails closed, so an over-eager shape can never overspend.
 */
export interface ShapeBudget {
  /** Per-child spawn budget the shape reserves for each leaf/sub-loop it opens. */
  readonly perChild: Budget
  /** Max children a fanout step may open in one round (the shape's structural width). */
  readonly fanout: number
}

/**
 * The construction context a `LoopShape` factory receives. Carries the persona's resolved
 * executor seams + the budget knobs, plus the ONE helper a shape needs to spawn a child
 * through the keystone: `spawnChild` resolves an `AgentSpec` (or a persona-derived child
 * profile) into an `Agent` the shape hands to `scope.spawn`. The shape never touches the
 * registry directly — it asks the context, keeping resolution single-sourced.
 */
export interface ShapeContext<D = unknown> {
  readonly persona: Persona<D>
  readonly budget: ShapeBudget
  /**
   * Wrap an `AgentSpec` into a leaf `Agent` carrying it as `executorSpec`, so the shape can
   * `scope.spawn(spawnChild(spec), task, opts)`. `name` labels the child for traces. The
   * returned agent's `act` is never invoked by the keystone (it is spawned, not run) — the
   * spec drives the resolved `Executor`; `act` exists only to satisfy the `Agent` shape.
   */
  spawnChild(name: string, spec: AgentSpec): Agent<unknown, Outcome<D>>
  /** Derive a child `AgentSpec` from the persona's root spec with an overridden profile —
   *  the seam a shape uses to give a worker a narrower role/prompt than the root persona. */
  childSpec(profile: AgentProfile, harness?: BackendType | null): AgentSpec
  /** The scope analyst (selector≠judge firewall) the combinator steers from. Absent ⇒ the
   *  dormant default (empty findings → gates read deliverables/state only). */
  readonly analyst?: ScopeAnalyst<D>
}

/**
 * A reusable act-body factory. Given the persona's content + seams (`ShapeContext`), it
 * returns the root `Agent<Task, Outcome<D>>` whose `act` decomposes the task, fans out
 * children through `scope.spawn`, verifies/selects across their settlements (selector≠judge:
 * via `settledToIteration` + `defaultSelectWinner`, never re-ranking behind the driver), and
 * synthesizes the terminal `Outcome<D>`. The shape is STRUCTURE; the persona is CONTENT.
 */
export type LoopShape<Task, D> = (ctx: ShapeContext<D>) => Agent<Task, Outcome<D>>

// ── The open shape registry ──────────────────────────────────────────────────────

/**
 * The open shape registry — the extension point that makes a new loop-shape ONE file + one
 * `registerShape` call with zero edits elsewhere. `resolve` returns a typed outcome (inspect
 * `succeeded` before `value`); `register` fails loud on a duplicate name.
 */
export interface ShapeRegistry {
  register<Task, D>(name: string, factory: LoopShape<Task, D>): void
  resolve<Task, D>(
    name: string,
  ): { succeeded: true; value: LoopShape<Task, D> } | { succeeded: false; error: string }
  /** The registered shape names — for diagnostics + a fail-loud "unknown shape" message. */
  names(): string[]
}

// ── runPersonified — composing the persona + shape onto the supervisor ───────────

/**
 * The end-to-end entrypoint. Builds the persona's root `Agent` from the chosen shape, then
 * runs it through a fresh `createSupervisor` over the persona's executors + the supplied
 * budget/journal/blobs. Returns the keystone's typed `SupervisedResult<Outcome<D>>` — a
 * `winner` carries the synthesized `Outcome<D>`; a `no-winner` is never coerced into one.
 *
 * `shape` is either a resolved `LoopShape` or a registered shape NAME (resolved through the
 * default registry). The journal/blobs default to in-memory impls in the engine when omitted
 * (durable FS impls are passed explicitly for a persisted run).
 */
export interface RunPersonifiedOptions<Task, D> {
  readonly persona: Persona<D>
  /** A resolved shape factory OR a registered shape name. */
  readonly shape: LoopShape<Task, D> | string
  readonly task: Task
  readonly budget: Budget
  /** Per-child sizing + fanout width handed to the shape. Defaults derive from `budget`. */
  readonly shapeBudget?: Partial<ShapeBudget>
  /** Trace/journal root key. Defaults to the persona name + a run discriminator in the engine. */
  readonly runId?: string
  readonly journal?: SpawnJournal
  readonly blobs?: ResultBlobStore
  /** Runtime recursion-depth ceiling, paired with the conserved pool. */
  readonly maxDepth?: number
  /** OTP intensity breaker bounds, forwarded to the supervisor verbatim. */
  readonly maxRestarts?: number
  readonly withinMs?: number
  /** A live root handle to attach (view/signal/abort) before the run starts. */
  readonly handle?: RootHandle<Outcome<D>>
  readonly now?: () => number
  readonly signal?: AbortSignal
  /** Optional scope analyst threaded into the shape's ShapeContext so loopUntil/widen steer
   *  on trace-derived findings instead of the dormant empty default. */
  readonly analyst?: ScopeAnalyst<D>
}

/** The composed run signature. */
export type RunPersonified = <Task, D>(
  options: RunPersonifiedOptions<Task, D>,
) => Promise<SupervisedResult<Outcome<D>>>
