/**
 *
 * The RSI-wave type surface — the FROZEN contracts the wave's Core + Compose build to.
 *
 * The keystone (`../supervise/`) is pure execution structure: a recursive `Agent` atom in a
 * budget-conserving `Scope`, run to a typed `SupervisedResult` by a `Supervisor`. The persona
 * layer (`./types`, `./persona`) adds the "act like X" content seam (`Persona` = `AgentSpec` +
 * `directive` + `context`, `LoopShape = (ctx) => Agent`, `Outcome<D>`). This module freezes the
 * remaining four wave seams ON TOP of those — and nothing more:
 *
 *  1. GENERIC COMBINATORS — the content-free act-library. Five composable shapes
 *     (`pipeline`/`fanout`/`loopUntil`/`panel`/`verify`) plus the streaming widener (G5). Each
 *     is a `CombinatorShape` (a `LoopShape` whose `Agent.act` runs the combinator over `Scope`),
 *     so a combinator IS just a `LoopShape` — no new engine type. The SHAPE is here; the DOMAIN
 *     (model, prompt, role) stays on the `Persona`. There is no "research" or "code" combinator:
 *     a research sweep is `fanout` under a research persona; a build is `pipeline` under a coder.
 *  2. ANALYST-ON-SCOPE (G1, a PORT) — `ScopeAnalyst` carries the round-synchronous driver's
 *     analyze→findings→steer wire (dynamic.ts) across to the reactive `Scope`, behind
 *     the same trace-derived firewall (`assertTraceDerivedFindings` semantics): a reactive
 *     combinator steers from trace FINDINGS, never a child's raw `verdict`.
 *  3. CROSS-RUN CORPUS (G2) — `Corpus` is the DURABLE accreted-fact store, DISTINCT from the
 *     per-run `SpawnJournal`/`ResultBlobStore`. `renderCorpusToInstructions` is the read-back:
 *     it projects accreted facts into `AgentProfile.prompt.instructions` / `resources.instructions`
 *     for the next run's persona (the learning-flywheel READ side).
 *  4. TRAJECTORY TRACE + COST LEDGER — `trajectoryReport(journal, blobs)` reconstructs the whole
 *     spawn tree with per-node + rolled-up `Spend`; `equalKOnCost` compares arms on conserved
 *     COST (tokens/usd), NOT raw iteration count — closing the leaf-fanout confound.
 *
 * Layering: imports ONLY keystone runtime types (`../supervise/types`), persona types
 * (`./types`), the substrate `AnalystFinding`/`AgentProfile`, and the durable-store interfaces.
 * Pure types/interfaces — this module typechecks standalone, owns no impl, invents no engine.
 *
 * @experimental
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  Agent,
  AgentSpec,
  Budget,
  DefaultVerdict,
  NodeId,
  ResultBlobStore,
  Scope,
  Settled,
  SpawnJournal,
  Spend,
} from '../supervise/types'
import type { Iteration } from '../types'
import type { LoopShape, Outcome, ShapeContext } from './types'

// ════════════════════════════════════════════════════════════════════════════════════
// 1. GENERIC COMBINATORS — the content-free act-library (five shapes + the widener)
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * A combinator is just a `LoopShape`: a factory `(ShapeContext) => Agent` whose `Agent.act`
 * runs the combinator's structure over the `Scope` (spawn children, drain `next()`, select via
 * the single-sourced `settledToIteration`+`defaultSelectWinner`, synthesize an `Outcome<D>`).
 * Aliased — NOT a new type — so a combinator stays a first-class shape the persona layer's
 * `runPersonified`/`ShapeRegistry` resolve with zero new machinery. The SHAPE is content-free;
 * the persona carries the domain.
 */
export type CombinatorShape<Task, D> = LoopShape<Task, D>

/**
 * `pipeline(stages)` — sequential composition: each stage's `Outcome.deliverable` feeds the next
 * stage's task (via `feed`). The first `blocked` stage short-circuits the whole pipeline (its
 * blockers ARE the pipeline's blockers — never coerced past a failed stage). The terminal
 * stage's `done` deliverable is the pipeline's deliverable. Spawns one child per stage in order;
 * a stage that the conserved pool cannot admit is a concrete blocker.
 *
 * No domain: "code build test" is `pipeline([plan, implement, integrate])` under a coder persona,
 * not a named shape. A stage names only its label + how to derive its task from the prior output.
 */
export interface PipelineStage<Task, StepIn, StepOut> {
  /** Trace/journal label for this stage's spawned child. */
  readonly label: string
  /** Derive this stage's task from the prior stage's deliverable (or the root task for stage 0).
   *  Pure projection — the framework never interprets the result; the resolved leaf does. */
  feed(prior: StepIn, ctx: ShapeContext<unknown>, rootTask: Task): unknown
  /** Read this stage's settled child output into the typed `StepOut` the next stage feeds on.
   *  Fail loud (return a `blocked`) when the child produced nothing usable for the next stage. */
  collect(settled: Settled<Outcome<StepOut>>): Outcome<StepOut>
}

/** `pipeline(stages)` — build the sequential combinator from an ordered stage list. The first
 *  stage's `StepIn` is the root `Task`; the last stage's `StepOut` is the deliverable `D`. */
export type Pipeline = <Task, D>(
  stages: ReadonlyArray<PipelineStage<Task, unknown, unknown>>,
) => CombinatorShape<Task, D>

/**
 * `fanout(items, { synthesize? })` — N children spawned in one round (one per item, bounded by
 * the conserved pool's fail-closed admission), drained via `scope.next()`, then optionally a
 * single SYNTHESIS child over the gathered results. Without `synthesize`, the combinator returns
 * the best-valid child via the single-sourced selector (selector≠judge). A round that admitted
 * zero children, or whose synthesis child could not be admitted, is a concrete blocker.
 *
 * No domain: a "research sweep over angles" is `fanout(angles, { synthesize: cite })` under a
 * research persona; a "fanout-vote" is `fanout(copies)` with the default selector. The item list
 * + the synthesis posture are the SHAPE's args; the prompt that turns an item into work is the
 * persona's.
 */
export interface FanoutOptions<Item, D> {
  /** One child task per item: `item` + the index discriminator. The persona's directive/context
   *  is threaded in by the combinator; this only supplies the per-item discriminator. */
  itemTask(item: Item, index: number, ctx: ShapeContext<D>): unknown
  /** Per-item child label (defaults to `item:<index>` in the impl). */
  label?(item: Item, index: number): string
  /**
   * Optional per-item `AgentSpec` override. When set, each item's child is spawned against the
   * returned spec instead of `persona.root` — the seam a heterogeneous fanout uses to give each
   * item a DISTINCT executor (e.g. N authored harness profiles, each on its own worktree-CLI
   * leaf). Absent ⇒ every item runs against the persona's root spec (the homogeneous default).
   */
  itemSpec?(item: Item, index: number, ctx: ShapeContext<D>): AgentSpec
  /**
   * Optional synthesis over the gathered child results: when present, the combinator spawns ONE
   * synthesis child whose task is built from the drained settlements, and its `done` output is
   * the deliverable. When absent, the deliverable is the best-valid child via `defaultSelectWinner`.
   * The synthesis child is a SEPARATE keystone agent (not a re-rank behind the driver).
   */
  synthesize?: FanoutSynthesis<D>
  /**
   * Winner-selection strategy among the gathered `done` children when there is no `synthesize`.
   * Receives the SAME `Iteration[]` the default selector reads (each child's output is its
   * `Outcome<D>`), so a strategy is a thin re-sort (smallest-diff, highest-readiness, first-valid
   * …) over the candidates — NEVER a re-rank behind a judge. Default = `defaultSelectWinner`
   * semantics (best-valid-score, ties→earliest). Mutually exclusive with `synthesize` (a
   * synthesis child IS the selection); supplying both is a config error.
   */
  selectWinner?: FanoutWinnerSelector<D>
  /**
   * Cap on how many item children run AT ONCE. When set, the fanout dispatches through
   * `rollingDispatch`: it fills `width` slots and admits the next item the moment one settles,
   * instead of opening every item in a single round. Same items, same selection, same conserved
   * pool — only the simultaneity changes.
   *
   * Unset (the default) keeps the single-round batch behavior every existing caller has. Set it
   * when the items outnumber the live capacity a host can actually afford, so the pool is not
   * spent opening children that then queue behind a real fence.
   */
  width?: number
}

/** A winner-selection strategy: argmax/sort over the gathered child iterations (each output is the
 *  child's `Outcome<D>`), returning the chosen iteration or `undefined` when none qualifies. */
export type FanoutWinnerSelector<D> = (
  iterations: Iteration<unknown, Outcome<D>>[],
) => { readonly output?: Outcome<D> | undefined } | undefined

/** Built-in valid-only winner strategies for `selectValidWinner` (selector≠judge): best gated-valid
 *  score, the smallest delivered artifact (via a `sizeOf` extractor), or the earliest valid. */
export type WinnerStrategy = 'highest-score' | 'smallest-artifact' | 'first-valid'

/** How a fanout's synthesis child is built + read. `synthesisTask` projects the drained child
 *  settlements into the synthesis child's task; `collect` reads its settled output into the
 *  deliverable `Outcome<D>`. */
export interface FanoutSynthesis<D> {
  synthesisTask(gathered: ReadonlyArray<Settled<Outcome<D>>>, ctx: ShapeContext<D>): unknown
  collect(settled: Settled<Outcome<D>>): Outcome<D>
}

/** `fanout(items, opts)` — build the fanout combinator over a static item list. */
export type Fanout = <Task, Item, D>(
  items: ReadonlyArray<Item>,
  opts: FanoutOptions<Item, D>,
) => CombinatorShape<Task, D>

/**
 * `loopUntil({ until, step })` — iterative deepening inside the conserved pool: spawn one `step`
 * child per round, ask `until` whether the accumulated state satisfies the goal, and stop when it
 * does OR when the pool can no longer admit a step (budget IS the loop bound — no unbounded
 * while). The deployable, non-oracle stop: `until` is the satisfiability gate, read from trace
 * findings + accumulated deliverables, never a fresh raw verdict the loop minted to stop itself.
 *
 * No domain: "refine until tests pass" is `loopUntil` with a coder persona + a `step` that edits
 * and an `until` that reads the test-finding; the combinator owns only the round/stop wiring.
 */
export interface LoopUntilSpec<Task, State, D> {
  /** Build the next step child's task from the root task + the state accumulated so far. */
  step(rootTask: Task, state: LoopUntilState<State>, ctx: ShapeContext<D>): unknown
  /** Fold one settled step into the accumulated state (the loop's running deliverable candidate). */
  fold(prior: LoopUntilState<State>, settled: Settled<Outcome<D>>): LoopUntilState<State>
  /**
   * The satisfiability gate: given the accumulated state + the round's trace findings, has the
   * goal been reached? Returns the terminal deliverable when satisfied, or `null` to keep going.
   * Reads `findings` (trace-derived), NOT a raw verdict score — the deployable-stop discipline.
   */
  until(state: LoopUntilState<State>, findings: ReadonlyArray<AnalystFinding>): Outcome<D> | null
  /** Per-round step label (defaults to `step:<round>` in the impl). */
  label?(round: number): string
}

/** The accumulated state `loopUntil` threads across rounds — the running candidate + the round
 *  index, so `step`/`fold`/`until` are pure functions of it (replay-safe, no wall-clock). */
export interface LoopUntilState<State> {
  readonly round: number
  readonly value: State
}

/** `loopUntil(spec)` — build the iterative-deepening combinator. `seed` is the initial state. */
export type LoopUntil = <Task, State, D>(
  seed: State,
  spec: LoopUntilSpec<Task, State, D>,
) => CombinatorShape<Task, D>

/**
 * `panel(judges)` — M judges over ONE artifact, merged WRITE-ONLY (selector≠judge taken to its
 * limit). The combinator spawns the M judge children over the same input artifact, drains their
 * settlements, and MERGES their findings into a panel verdict via `merge` — a pure WRITE-ONLY
 * fold (a judge's output is never fed back to steer another judge, and the merge never re-ranks
 * the children behind the driver). The merged verdict gates the deliverable.
 *
 * No domain: a "code review panel" and an "essay rubric panel" are the same `panel` shape under
 * different personas; the rubric lives in each judge persona's profile, not the combinator.
 */
export interface PanelSpec<Artifact, D> {
  /** The M judge child specs: each is a persona-derived child (a narrower judge profile). The
   *  combinator spawns one child per entry over the SAME `artifact` and never lets one judge's
   *  output reach another's task (write-only). */
  readonly judges: ReadonlyArray<PanelJudge>
  /** Build one judge child's task from the shared artifact under review + the judge descriptor. */
  judgeTask(artifact: Artifact, judge: PanelJudge, ctx: ShapeContext<D>): unknown
  /**
   * Write-only merge: fold the M settled judge verdicts into the panel's terminal `Outcome<D>`.
   * Pure over the drained settlements — it MUST NOT spawn, re-judge, or feed one verdict into
   * another. A panel that reached no quorum is a concrete blocker (fail loud, never a vacuous done).
   */
  merge(verdicts: ReadonlyArray<PanelVerdict>, artifact: Artifact): Outcome<D>
}

/** One judge in a panel — a labeled persona-derived judge child. Content (the rubric) lives in
 *  the judge's profile; this carries only the label + the optional weight the merge may read. */
export interface PanelJudge {
  readonly label: string
  /** Optional merge weight (a write-only hint the `merge` fold may use; default-equal in the impl). */
  readonly weight?: number
}

/** One judge child's settled verdict, surfaced to the write-only `merge`. `down` judges carry no
 *  verdict (excluded from the merge `n`, like an infra-errored cell). */
export interface PanelVerdict {
  readonly judge: PanelJudge
  readonly verdict?: DefaultVerdict
  /** The judge child's raw output — what it was asked to assess, for a merge that quotes it. */
  readonly output?: unknown
  /** True when the judge child went `down` (no usable verdict — kept out of the merge denominator). */
  readonly down: boolean
}

/** `panel(spec)` — build the M-judge write-only-merge combinator. */
export type Panel = <Task, Artifact, D>(spec: PanelSpec<Artifact, D>) => CombinatorShape<Task, D>

/**
 * `verify({ implement, verifier })` — the 2-node sequential gate: an IMPLEMENT child produces a
 * candidate, then a SEPARATE VERIFIER child's verdict GATES shippability. A `valid` verifier
 * verdict ships the implement deliverable; any other outcome (implement down, verifier down,
 * invalid verdict) becomes a concrete blocker carrying the failure verbatim — never a coerced
 * "done". The verifier is a distinct keystone agent (selector≠judge: the implement child does
 * not grade itself).
 *
 * No domain: "write code then run the test gate" and "draft then fact-check" are the same `verify`
 * shape under different personas; the gate rubric is the verifier persona's, not the combinator's.
 */
export interface VerifySpec<Task, Candidate, D> {
  /** Build the implement child's task from the root task. */
  implement(rootTask: Task, ctx: ShapeContext<D>): unknown
  /** Build the verifier child's task from the implement child's settled candidate. */
  verifier(candidate: Settled<Outcome<Candidate>>, ctx: ShapeContext<D>): unknown
  /** Project the gated (verifier-`valid`) candidate into the terminal deliverable. */
  collect(candidate: Settled<Outcome<Candidate>>, verdict: DefaultVerdict): Outcome<D>
  /** Implement / verifier child labels (default `implement` / `verify` in the impl). */
  readonly implementLabel?: string
  readonly verifierLabel?: string
}

/** `verify(spec)` — build the 2-node implement→verifier-gate combinator. */
export type Verify = <Task, Candidate, D>(
  spec: VerifySpec<Task, Candidate, D>,
) => CombinatorShape<Task, D>

/**
 * `widen({ gate })` (G5) — the STREAMING spawn-on-completion driver. Unlike the static-fanout
 * combinators above, the widener REACTS to each `scope.next()`: as each child settles it consults
 * the `WidenGate` and, when a lineage is `promising`, widens by AT MOST ONE child toward it under
 * the remaining conserved pool. Defaults to FLAT (the gate never widens) so a gate run stays
 * non-widening and the R2 selector≠judge collision is dormant. `promising` is derived from the
 * round's analyst FINDINGS (via `ScopeAnalyst`, §2), NOT a child's raw `verdict` — the firewall.
 *
 * This is the progressive-widening (MCTS-PW) combinator: the one shape whose breadth is decided
 * at runtime from the diagnosis, not fixed at spawn. It is the mechanism the diverse-strategy-vs-
 * blind GATE is run with — kept FLAT by default until that gate returns positive (don't build
 * mechanism ahead of the gate).
 */
export interface WidenSpec<Seed, D> {
  /** The initial children to spawn before any widening — the seed lineages the gate widens from.
   *  One child task per seed; bounded by the conserved pool's fail-closed admission. */
  readonly seeds: ReadonlyArray<Seed>
  seedTask(seed: Seed, index: number, ctx: ShapeContext<D>): unknown
  /**
   * The progressive-widening gate. Consulted on EVERY settled child with the round's
   * trace-derived `findings`; returns a widen decision (spawn one more toward a lineage) or a
   * stop. DEFAULTS to flat via `flatWidenGate` — never widens, so the firewall stays dormant.
   */
  readonly gate: ScopeWidenGate<D>
  /** Build the widened child's task from the lineage the gate chose to extend. */
  widenTask(toward: WidenLineage<D>, ctx: ShapeContext<D>): unknown
  /** Synthesize the terminal deliverable from every settled lineage (selector≠judge: the
   *  single-sourced selector over the gathered children, never a re-judge). */
  synthesize(gathered: ReadonlyArray<Settled<Outcome<D>>>, ctx: ShapeContext<D>): Outcome<D>
}

/**
 * The runtime widening gate (the reactive analogue of the keystone's `WidenGate`, lifted to read
 * trace FINDINGS instead of a raw verdict). `decide` is consulted per settled child; it MUST
 * derive `promising` from `findings`, never from `settled.verdict`, unless `judgeExempt` is
 * explicitly argued (the documented off-by-default escape hatch). Flat default never widens.
 */
export interface ScopeWidenGate<D> {
  decide(
    settled: Settled<Outcome<D>>,
    findings: ReadonlyArray<AnalystFinding>,
    budget: Scope<Outcome<D>>['budget'],
  ): WidenDecision<D>
  /** When true, `decide` may read `settled.verdict` directly — collides with the steer firewall,
   *  so it must be argued per cell, never defaulted on (mirrors the keystone `WidenGate`). */
  readonly judgeExempt?: boolean
}

/** A widening decision: extend one lineage by one child, or stop widening. `flatWidenGate`
 *  always returns `{ kind: 'stop' }`. */
export type WidenDecision<D> =
  | { kind: 'widen'; toward: WidenLineage<D> }
  | { kind: 'stop'; rationale?: string }

/** A lineage the gate may widen toward — the settled child that looked promising + the findings
 *  that justified it (the trace-derived provenance the firewall requires). */
export interface WidenLineage<D> {
  readonly settled: Extract<Settled<Outcome<D>>, { kind: 'done' }>
  readonly findings: ReadonlyArray<AnalystFinding>
}

/** `widen(spec)` — build the streaming progressive-widening combinator. */
export type Widen = <Task, Seed, D>(spec: WidenSpec<Seed, D>) => CombinatorShape<Task, D>

/** The flat default `ScopeWidenGate` factory contract — never widens, keeping the R2 firewall
 *  conflict dormant. Exported so a gate run can pass it explicitly and a test can assert the
 *  default is flat. */
export type FlatWidenGate = <D>() => ScopeWidenGate<D>

// ════════════════════════════════════════════════════════════════════════════════════
// 2. ANALYST-ON-SCOPE (G1, a PORT of dynamic.ts's analyze→findings→steer wire)
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * The reactive analyst seam — the PORT of the round-synchronous driver's `analyze` hook
 * (dynamic.ts) onto the reactive `Scope`. The old driver wired the analyst at round
 * boundaries (`plan` ran the analyst over `history` BEFORE the planner); the reactive `Scope` has
 * no rounds, so this carries the wire across: a combinator's `act` asks the `ScopeAnalyst` to turn
 * the settled children SO FAR into `AnalystFinding[]`, and steers from THOSE findings.
 *
 * The firewall is preserved (selector≠judge): `analyze` runs the trace-derived analyst and the
 * impl asserts `assertTraceDerivedFindings` semantics — a finding citing judge/verdict/score
 * `metric` evidence aborts the round. The steer decision reads `findings`, NEVER the children's
 * raw `verdict`. Fail loud — a throwing or non-array analyst aborts (no silent empty findings).
 */
export interface ScopeAnalyst<D> {
  /**
   * Turn the children settled so far into trace-derived findings. `settledSoFar` is the cursor-
   * ordered settlement list a combinator has drained (the reactive analogue of the old driver's
   * `history`). The impl runs the analyst, then enforces the trace-derived firewall before
   * returning — a judge-derived finding is rejected, not filtered.
   */
  analyze(input: ScopeAnalyzeInput<D>): Promise<ReadonlyArray<AnalystFinding>>
}

/** Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far. */
export interface ScopeAnalyzeInput<D> {
  /** Opaque root-task framing (whatever the combinator was invoked with). */
  readonly task: unknown
  /** The children this combinator has drained off `scope.next()`, in cursor order. */
  readonly settledSoFar: ReadonlyArray<Settled<Outcome<D>>>
  /** This combinator's scope id (the trace-correlation root for the analyst). */
  readonly nodeId: NodeId
}

/**
 * How a combinator's `act` consumes findings to steer — the SINGLE firewalled steer surface a
 * reactive combinator reads. `loopUntil.until`, `widen` gate, and any future steer all funnel
 * through a `SteerContext` so the firewall is enforced in one place: `findings` is trace-derived
 * (the analyst already asserted it), and a combinator MUST NOT reach back to `settled.verdict`
 * for the steer decision. `lastValidScore` is provided for OBSERVABILITY only (rendering/traces),
 * explicitly NOT for steering — reading it to steer is the coupling the architecture forbids.
 */
export interface SteerContext<D> {
  readonly findings: ReadonlyArray<AnalystFinding>
  readonly settledSoFar: ReadonlyArray<Settled<Outcome<D>>>
  /** Observability-only: the best valid score seen so far. Rendering/trace use ONLY — steering
   *  off this re-introduces selector=judge. Marked so a reviewer catches a misuse. */
  readonly lastValidScore?: number
}

/**
 * The firewall assertion contract, re-stated for the reactive seam (PORT of
 * `assertTraceDerivedFindings`). A PROVENANCE check, not a content check: span/event/artifact/
 * finding refs and empty-evidence findings pass; only a `metric` ref whose uri is a
 * judge/verdict/score scheme is rejected. Fail loud — a tainted finding aborts. The impl lives in
 * `analyst.ts`; this type pins its signature so callers depend on the contract, not the impl.
 */
export type AssertTraceDerivedFindings = (findings: ReadonlyArray<AnalystFinding>) => void

// ════════════════════════════════════════════════════════════════════════════════════
// 3. CROSS-RUN CORPUS (G2) — durable accreted-fact store, DISTINCT from the per-run journal
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * One accreted fact in the cross-run corpus — the learning-flywheel's durable unit. DISTINCT from
 * a `SpawnEvent` (a per-run decision record): a `CorpusRecord` is a fact a run LEARNED that a
 * FUTURE run should read back (the world-model for story 5). It is content the next persona reads,
 * not a replay input. Tagged + scored so `query`/`renderCorpusToInstructions` can project the
 * relevant, high-confidence subset.
 */
export interface CorpusRecord {
  readonly schemaVersion: '1.0.0'
  /** Stable id over identity-defining fields (claim + tags) so a re-learned fact dedups. */
  readonly id: string
  /** The run that produced this fact (the journal `runId`/`root`) — provenance back to the trace. */
  readonly runId: NodeId
  readonly producedAt: string
  /** Coarse classification the query/render filters on (free-form, mirrors `AnalystFinding.area`). */
  readonly area: string
  /** The accreted fact — the instruction-shaped statement the next run reads back. */
  readonly claim: string
  /** Optional supporting detail the renderer may include under the claim. */
  readonly rationale?: string
  /** Free-form tags for `query` filtering (domain, persona, surface). */
  readonly tags: ReadonlyArray<string>
  /** 0..1 — the producing run's confidence in this fact (the render threshold reads it). */
  readonly confidence: number
  /** Optional provenance back into the run that learned it (a finding id / outRef / span). */
  readonly evidence?: ReadonlyArray<{ readonly kind: string; readonly uri: string }>
}

/** A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain. */
export interface CorpusFilter {
  readonly area?: string
  /** Match records carrying ALL of these tags. */
  readonly tags?: ReadonlyArray<string>
  /** Minimum confidence a record must clear to be returned (the render gate). */
  readonly minConfidence?: number
  /** Only records from this run (rare — usually a cross-run read). */
  readonly runId?: NodeId
  /** Cap the result count (most-confident first in the impl). */
  readonly limit?: number
}

/**
 * The durable cross-run corpus — the learning-flywheel store. DISTINCT from `SpawnJournal`
 * (per-run decisions, replay) and `ResultBlobStore` (per-run payloads): `Corpus` holds accreted
 * FACTS across runs that the next run reads back. `InMemoryCorpus` + `FileCorpus` (JSONL) impls
 * live in `corpus.ts` and MAY share a storage spine with the JSONL journal, but the INTERFACE is
 * separate so a consumer never confuses a replay record with a learned fact.
 *
 * Fail-loud, typed-outcome boundary: `append` is idempotent on an identical record (same `id` +
 * `claim`); a conflicting re-append under the same `id` is a typed error, never a silent overwrite.
 */
export interface Corpus {
  /** Append one accreted fact. Idempotent on an identical record; returns a typed outcome —
   *  inspect `succeeded` before treating it as durable (no silent write-through on conflict). */
  append(record: CorpusRecord): Promise<{ succeeded: true } | { succeeded: false; error: string }>
  /** Query accreted facts by filter — most-confident first. Returns the matching records (an
   *  empty array when none match is a valid result, NOT an error). */
  query(filter: CorpusFilter): Promise<ReadonlyArray<CorpusRecord>>
}

/**
 * Project accreted corpus facts into an `AgentProfile`'s instruction seams — the learning-flywheel
 * READ side. Reads the corpus through `filter`, renders the matching facts into instruction lines,
 * and returns a NEW profile with them merged into `prompt.instructions` (the append-line seam) so
 * the next run's persona reads the accreted world-model. Pure projection over the queried records;
 * never mutates the input profile (returns a fresh one). The impl lives in `corpus.ts`.
 *
 * `resources.instructions` is `string | AgentProfileResourceRef`; `prompt.instructions` is
 * `string[]`. The render targets `prompt.instructions` (additive lines) by default; a caller that
 * wants the single-blob `resources.instructions` form passes `target: 'resources'`.
 */
export interface RenderCorpusToInstructionsOptions {
  readonly corpus: Corpus
  readonly filter: CorpusFilter
  /** The profile to project the facts into. The result is a fresh profile — the input is unchanged. */
  readonly profile: AgentProfile
  /** Where the rendered facts land: appended to `prompt.instructions[]` (default) or folded into
   *  the single-blob `resources.instructions` string. */
  readonly target?: 'prompt' | 'resources'
  /** Optional cap on rendered lines (most-confident first), independent of the query `limit`. */
  readonly maxLines?: number
}

/** `renderCorpusToInstructions(opts)` — the flywheel read-back projection. Async (queries the
 *  durable corpus); returns a fresh `AgentProfile` with the accreted facts merged in. */
export type RenderCorpusToInstructions = (
  opts: RenderCorpusToInstructionsOptions,
) => Promise<AgentProfile>

// ════════════════════════════════════════════════════════════════════════════════════
// 4. TRAJECTORY TRACE + COST LEDGER — the whole tree + equal-k-ON-COST
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the
 * spend ROLLED UP over its subtree. Reconstructed from the `SpawnJournal` (structure + per-node
 * `Spend`) + the `ResultBlobStore` (the `out` artifact, rehydrated by `outRef`). The realized tree
 * shape: `parent`/`children` are the actual spawn edges the run took, not a planned topology.
 */
export interface TrajectoryNode {
  readonly id: NodeId
  readonly parent?: NodeId
  readonly children: ReadonlyArray<NodeId>
  readonly label: string
  readonly runtime: string
  /** Terminal status the journal recorded for this node. */
  readonly status: 'done' | 'failed' | 'cancelled' | 'pending'
  /** This node's OWN conserved spend (from its `settled` event). */
  readonly ownSpend: Spend
  /** This node's spend PLUS every descendant's — the rolled-up subtree cost. The cost a parent
   *  "really" consumed inclusive of its children's fanout (the equal-k-on-cost basis). */
  readonly rolledUpSpend: Spend
  /** The node's verdict, when its settlement carried one (observability — NOT a steer input). */
  readonly verdict?: DefaultVerdict
  /** The rehydrated output artifact, when `withOutputs` was requested + the blob resolved. */
  readonly output?: unknown
  readonly outRef?: string
}

/** The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The
 *  per-node + rolled-up `Spend` is the evidence both the trace viewer and `equalKOnCost` read. */
export interface TrajectoryReport {
  readonly root: NodeId
  /** Every node, in cursor/spawn order — the realized tree (`parent`/`children` are the real edges). */
  readonly nodes: ReadonlyArray<TrajectoryNode>
  /** The root's rolled-up spend — the whole run's conserved total (tokens + usd + iterations + ms). */
  readonly total: Spend
  /** Count of nodes by terminal status — a quick "how did the tree end" readout. */
  readonly statusCounts: Readonly<Record<TrajectoryNode['status'], number>>
}

/**
 * `trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with
 * per-node + rolled-up `Spend`. Reads the journal for structure + spend and (when `withOutputs`)
 * the blob store for each `done` node's artifact. Fail loud on a tree that was never journaled or
 * a `done` node whose blob the store cannot rehydrate (a silent gap would mis-cost the tree). The
 * impl lives in `trajectory.ts`.
 */
export interface TrajectoryReportOptions {
  /** Rehydrate each `done` node's `output` from the blob store. Off by default (cost-only report). */
  readonly withOutputs?: boolean
}

/** `trajectoryReport(...)` — the tree+cost reconstructor. Async (reads journal + optionally blobs). */
export type TrajectoryReportFn = (
  journal: SpawnJournal,
  blobs: ResultBlobStore,
  root: NodeId,
  options?: TrajectoryReportOptions,
) => Promise<TrajectoryReport>

/**
 * One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole
 * run). The arm's conserved COST is `report.total` (tokens + usd), which the sandbox executor
 * already reports INCLUSIVE of a leaf's internal sub-agent fanout — so comparing arms on this cost
 * (not raw `iterations`) closes the leaf-fanout confound: a treatment arm whose leaf fanned out
 * internally is charged for that fanout in `total.tokens`/`total.usd`, not hidden behind one
 * iteration count.
 */
export interface EqualKArm {
  readonly label: string
  readonly report: TrajectoryReport
}

/**
 * The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the
 * CONSERVED cost channels (tokens + usd), so a downstream metric comparison is "at equal k". Per-
 * arm cost is surfaced so a caller can see HOW close. `withinTolerance: false` means the arms are
 * NOT comparable at equal compute — a confound to report, not a result to publish.
 */
export interface EqualKVerdict {
  readonly withinTolerance: boolean
  /** Per-arm conserved cost (the basis: tokens total + usd). */
  readonly arms: ReadonlyArray<{
    readonly label: string
    readonly tokens: number
    readonly usd: number
    readonly iterations: number
  }>
  /** The realized spread on each channel (max − min across arms), for the report. */
  readonly spread: { readonly tokens: number; readonly usd: number }
  /** The fractional tolerance the check used (spread / median ≤ tolerance per channel). */
  readonly tolerance: number
}

/**
 * `equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST
 * (tokens + usd), NOT raw iteration count. The conserved-pool guarantees `Σk` equal by
 * construction WITHIN one supervised run; this checks it ACROSS arms (separate runs) where the
 * pool cannot, so a cross-arm gate comparison can prove equal compute before claiming a win. The
 * impl lives in `trajectory.ts`. Pure over the reports — no I/O.
 */
export interface EqualKOnCostOptions {
  /** Max fractional spread (spread/median) per channel for arms to count as equal-k. Default in
   *  the impl (e.g. 0.05). A tighter tolerance = a stricter equal-compute claim. */
  readonly tolerance?: number
}

/** `equalKOnCost(arms, opts)` — the cross-arm equal-compute check on conserved cost. */
export type EqualKOnCost = (
  arms: ReadonlyArray<EqualKArm>,
  options?: EqualKOnCostOptions,
) => EqualKVerdict

// ── Re-exports so a Core impl imports the wave surface from one place ──────────────────
export type {
  Agent,
  AgentProfile,
  AnalystFinding,
  Budget,
  DefaultVerdict,
  LoopShape,
  NodeId,
  Outcome,
  ResultBlobStore,
  Scope,
  Settled,
  ShapeContext,
  SpawnJournal,
  Spend,
}
