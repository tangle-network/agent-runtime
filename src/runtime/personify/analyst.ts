/**
 * @experimental
 *
 * Analyst-on-scope (G1) — the PORT of the round-synchronous driver's analyze→findings→steer
 * wire (`dynamic.ts`) onto the reactive `Scope`.
 *
 * The old dynamic driver wired the analyst at round boundaries: `plan` ran the analyst over
 * `history` BEFORE the planner and handed the findings forward via `PlannerContext.analyses`,
 * behind a provenance firewall (`assertTraceDerivedFindings`) that keeps the external write-only
 * judge out of the steer decision (selector ≠ judge). The reactive `Scope` has no rounds, so this
 * module carries the same wire across: a combinator's `act` asks a `ScopeAnalyst` to turn the
 * children it has drained off `scope.next()` SO FAR into `AnalystFinding[]`, and steers from THOSE
 * findings through a single `SteerContext`.
 *
 * The analyst itself is not a new type — it is "just an `Agent<unknown, AnalystFinding[]>`" the
 * combinator spawns over a child's trace (harness `null`/`cli`). `createScopeAnalyst` spawns that
 * agent through `Scope.spawn` (so its compute is metered by the conserved pool like any child),
 * drains its settlement, then enforces the firewall on the way out — a judge-derived finding
 * ABORTS, it is never filtered. Fail loud: a down analyst, a non-array result, or a tainted finding
 * throws; there is no silent empty-findings path that would let a combinator steer on nothing.
 */

import type { AnalystFinding, AnalystRunInputs } from '@tangle-network/agent-eval'
import type { AnalystRegistryLike } from '../../analyst-loop/types'
import { AnalystError, PlannerError } from '../../errors'
import type { Agent, Budget, DefaultVerdict, NodeId, Scope, Settled } from '../supervise/types'
import { stringifySafe } from '../util'
import type {
  AssertTraceDerivedFindings,
  Outcome,
  ScopeAnalyst,
  ScopeAnalyzeInput,
  SteerContext,
} from './wave-types'

// ── The steer firewall (selector ≠ judge) — the single canonical impl ───────

/**
 * The diagnosis a combinator steers from must be TRACE-derived, never JUDGE-derived. A finding
 * whose evidence is a judge/verdict score (an `EvidenceRef` of `kind:'metric'` with a
 * verdict/judge/score uri scheme) would smuggle the external write-only judge back into steering —
 * the one coupling the architecture forbids. This is a PROVENANCE check, not a content check:
 * span/event/artifact/finding refs and empty-evidence findings are allowed; only a judge-scheme
 * metric ref is rejected. Fail loud — a tainted finding aborts.
 */
const judgeEvidenceUri = /^(verdict|judge|score)\b/i

export const assertTraceDerivedFindings: AssertTraceDerivedFindings = (findings) => {
  for (const f of findings) {
    for (const ref of f.evidence_refs ?? []) {
      if (ref.kind === 'metric' && judgeEvidenceUri.test(ref.uri)) {
        throw new PlannerError(
          `steer-firewall: finding ${stringifySafe(f.finding_id)} cites judge-derived evidence ` +
            `(${stringifySafe(ref.uri)}); findings fed to a combinator's steer decision must be ` +
            'trace-derived, not judge-derived (selector ≠ judge)',
        )
      }
    }
  }
}

// ── The reactive analyst — an Agent the combinator spawns over the trace so far ───────

/**
 * The analyst run an `Agent<unknown, AnalystFinding[]>` performs over the children settled so far.
 * The combinator supplies the analyst's task projection (how to frame the drained settlements as
 * the analyst's input) — the analyst's `act` reads the trace and returns its raw findings; the
 * firewall is enforced afterwards by `createScopeAnalyst`, not by the analyst itself.
 */
export interface CreateScopeAnalystOptions<D> {
  /** The analyst agent the combinator spawns over the trace. `harness` is the persona's choice
   *  (`null` for an inline router analyst, a `BackendType` for a sandboxed one). Its `act` returns
   *  the RAW findings; this module asserts the firewall on them before returning. */
  readonly analyst: Agent<unknown, ReadonlyArray<AnalystFinding>>
  /** Build the analyst agent's task from the analyze input (the root-task framing + the children
   *  drained so far). Pure projection — the analyst interprets it, this never reads it. */
  buildTask(input: ScopeAnalyzeInput<D>): unknown
  /** The conserved budget reserved for one analyst spawn. The pool reserves against it and fails
   *  closed; an analyst that cannot be admitted is a fail-loud abort, never silent empty findings. */
  readonly budget: Budget
  /** Trace/journal label for the spawned analyst child. Default `'analyst'`. */
  readonly label?: string
}

/**
 * Build a `ScopeAnalyst` that spawns the analyst agent through `Scope.spawn` (so its compute is
 * metered by the conserved pool), drains its single settlement, and enforces the trace-derived
 * firewall before returning. The `scope` is the SAME scope the combinator is draining its children
 * from — the analyst is spawned as a sibling and its result is read off `scope.next()` in cursor
 * order, replay-safe like any other child.
 *
 * Fail loud (no silent empty findings):
 *  - the pool refuses the analyst spawn → `AnalystError` (the steer would otherwise run on nothing)
 *  - the analyst settles `down` → `AnalystError` (a broken capture path, not a verdict)
 *  - the analyst returns a non-array → `PlannerError`
 *  - any finding cites judge-derived metric evidence → `PlannerError` via the firewall
 */
export function createScopeAnalyst<D>(
  scope: Scope<Outcome<D>>,
  options: CreateScopeAnalystOptions<D>,
): ScopeAnalyst<D> {
  if (!options.analyst || typeof options.analyst.act !== 'function') {
    throw new AnalystError('createScopeAnalyst: analyst must be an Agent with an act() method')
  }
  const label = options.label ?? 'analyst'
  return {
    async analyze(input: ScopeAnalyzeInput<D>): Promise<ReadonlyArray<AnalystFinding>> {
      const task = options.buildTask(input)
      // The analyst is spawned into the combinator's own scope so its tokens are charged to the
      // conserved pool. The pool fails closed; an analyst it cannot admit is a hard abort, not an
      // excuse to steer on an empty diagnosis. The analyst's `Out` is `AnalystFinding[]`, not the
      // scope's `Outcome<D>` — a genuinely heterogeneous child; the cast through `unknown` mirrors
      // the keystone `spawnChild` seam, and the settlement is narrowed back by `readAnalystFindings`.
      const spawned = scope.spawn(options.analyst as unknown as Agent<unknown, Outcome<D>>, task, {
        budget: options.budget,
        label,
      })
      if (!spawned.ok) {
        throw new AnalystError(
          `createScopeAnalyst: analyst spawn refused by the conserved pool (${spawned.reason}); ` +
            `cannot steer node ${stringifySafe(input.nodeId)} on an unrun analyst`,
        )
      }
      const settled = await drainAnalystSettlement(scope, spawned.handle.id)
      const findings = readAnalystFindings(settled)
      assertTraceDerivedFindings(findings)
      return findings
    },
  }
}

/**
 * Drain `scope.next()` until the analyst child's own settlement is yielded, matching on its node
 * id so an unrelated sibling that settles first is skipped, not mistaken for the analyst. A
 * `ScopeAnalyst` is invoked AFTER a combinator has drained its workers, so in practice the analyst
 * is the only live child; the id match keeps it correct even when it is not. Fails loud if the
 * scope empties before the analyst settles (the steer would otherwise run on nothing).
 */
async function drainAnalystSettlement<D>(
  scope: Scope<Outcome<D>>,
  analystId: NodeId,
): Promise<Settled<Outcome<D>>> {
  for (;;) {
    const settled = await scope.next()
    if (settled === null) {
      throw new AnalystError(
        `createScopeAnalyst: scope drained before analyst ${stringifySafe(analystId)} settled`,
      )
    }
    if (settled.handle.id === analystId) return settled
  }
}

/**
 * Read the analyst child's settlement into its `AnalystFinding[]`. A `down` analyst is a broken
 * capture path (fail loud — not "no findings"); a `done` analyst whose `out` is not an array is a
 * malformed analyst (fail loud — the dynamic driver's `runAnalyze` contract, carried across).
 */
function readAnalystFindings<D>(settled: Settled<Outcome<D>>): ReadonlyArray<AnalystFinding> {
  if (settled.kind === 'down') {
    throw new AnalystError(
      `createScopeAnalyst: analyst ${stringifySafe(settled.handle.id)} settled down ` +
        `(${settled.infra ? 'infra' : 'result'}): ${stringifySafe(settled.reason)}`,
    )
  }
  const out = settled.out as unknown
  if (!Array.isArray(out)) {
    throw new PlannerError(
      `createScopeAnalyst: analyst ${stringifySafe(settled.handle.id)} must return ` +
        `AnalystFinding[], got ${stringifySafe(out)}`,
    )
  }
  return out as ReadonlyArray<AnalystFinding>
}

// ── The panel-of-analysts adapter — N analyst KINDS merged into one ScopeAnalyst ───────

/**
 * Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a
 * `runId` + `AnalystRunInputs` (a trace store / run record / artifact dir), NOT in-memory scope
 * settlements — so the CALLER owns the projection from the combinator's drained children to the
 * registry's inputs (e.g. the trace store the run already wrote). This adapter never invents that
 * bridge; it only runs the projected inputs and firewalls the merged findings.
 */
export interface RegistryAnalyzeProjection {
  readonly runId: string
  readonly inputs: AnalystRunInputs
  /** Optional `run` opts (e.g. `priorFindings`) forwarded verbatim to the registry. */
  readonly opts?: Parameters<AnalystRegistryLike['run']>[2]
}

/**
 * A `ScopeAnalyst` backed by an `AnalystRegistry` — the panel-of-analysts seam. The registry merges
 * N analyst KINDS into one `AnalystRunResult.findings`; `analyze` runs it over the caller-projected
 * `{ runId, inputs }` and pipes the merged findings through the SAME `assertTraceDerivedFindings`
 * firewall `createScopeAnalyst` uses (single-sourced selector≠judge). Distinct from `panel()`
 * (judges-vs-one-artifact) — this is analysts-over-a-trace, the diagnosis side of the wire.
 *
 * Fail loud: a registry that throws propagates; a judge-derived finding aborts via the firewall.
 * The projection is the caller's (`buildInputs`) — if the scope settlements do not cleanly map to
 * the registry's `AnalystRunInputs`, that is a caller-side contract gap, surfaced there, not papered
 * over with a fabricated input here.
 */
export function registryScopeAnalyst<D>(
  registry: AnalystRegistryLike,
  buildInputs: (input: ScopeAnalyzeInput<D>) => RegistryAnalyzeProjection,
): ScopeAnalyst<D> {
  return {
    async analyze(input: ScopeAnalyzeInput<D>): Promise<ReadonlyArray<AnalystFinding>> {
      const projection = buildInputs(input)
      const result = await registry.run(projection.runId, projection.inputs, projection.opts)
      const findings = result.findings
      assertTraceDerivedFindings(findings)
      return findings
    },
  }
}

// ── The single firewalled steer surface every combinator funnels through ──────────────

/**
 * Build the `SteerContext` a combinator reads to steer (its `loopUntil.until`, `widen` gate, any
 * future steer). One place enforces the firewall: `findings` is asserted trace-derived before it is
 * surfaced, and `lastValidScore` is provided for OBSERVABILITY only — a combinator that steers off
 * it re-introduces selector = judge, the coupling the architecture forbids.
 *
 * `findings` is re-asserted here even when it came from `createScopeAnalyst` (which already asserted
 * it): the assertion is cheap and idempotent, and a `SteerContext` may be built from findings that
 * arrived by another path (a caller-supplied diagnosis). Belt-and-suspenders on the one coupling
 * that must never leak.
 */
export function buildSteerContext<D>(
  findings: ReadonlyArray<AnalystFinding>,
  settledSoFar: ReadonlyArray<Settled<Outcome<D>>>,
): SteerContext<D> {
  assertTraceDerivedFindings(findings)
  const lastValidScore = observedBestScore(settledSoFar)
  return {
    findings,
    settledSoFar,
    ...(lastValidScore !== undefined ? { lastValidScore } : {}),
  }
}

/**
 * The best valid score among the drained children — OBSERVABILITY ONLY. Read for rendering/traces,
 * never to make a steer decision (that is the selector = judge coupling). Reads `verdict.score` off
 * `done` settlements whose verdict is `valid`; a `down` child carries no verdict and contributes
 * nothing.
 */
function observedBestScore<D>(
  settledSoFar: ReadonlyArray<Settled<Outcome<D>>>,
): number | undefined {
  let best: number | undefined
  for (const s of settledSoFar) {
    if (s.kind !== 'done') continue
    const v: DefaultVerdict | undefined = s.verdict
    if (!v || v.valid !== true || typeof v.score !== 'number') continue
    if (best === undefined || v.score > best) best = v.score
  }
  return best
}
