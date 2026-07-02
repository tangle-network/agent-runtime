/**
 *
 * The generic combinator library — the content-free act-bodies the wave's §1 contract froze.
 *
 * Each export is a `CombinatorShape<Task, D>` (an alias of `LoopShape<Task, D>`): a factory
 * `(ShapeContext) => Agent<Task, Outcome<D>>` whose `act` runs ONE composition shape over the
 * keystone `Scope` — spawn children through `ctx.spawnChild` + `scope.spawn`, drain settlements
 * via `scope.next()`, select across `done` children with the SINGLE-SOURCED `settledToIteration`
 * + `defaultSelectWinner` (selector≠judge — never a re-rank behind the driver), and synthesize a
 * terminal `Outcome<D>`.
 *
 * The shapes carry NO domain: a "research sweep over angles" is `fanout(angles, { synthesize })`
 * under a research persona; a "code build test" is `pipeline([plan, implement, integrate])` under
 * a coder persona. The SHAPE is here; the model/prompt/role/goal live on the `Persona` + task,
 * threaded to each child verbatim by the spec-objects the builders take. No model name, prompt,
 * role, or domain noun appears below.
 *
 * Two fail-loud invariants every combinator honors: a child the conserved pool cannot admit is a
 * CONCRETE blocker (never an eager over-fan, never a silent drop), and a `blocked` outcome always
 * names at least one blocker (a shape that cannot finish MUST say why — `blocked([])` throws).
 *
 * @experimental
 */

import { ValidationError } from '../../errors'
import { defaultSelectWinner } from '../run-loop'
import { settledToIteration } from '../supervise/scope'
import type { Agent, Scope, Settled } from '../supervise/types'
import type { Iteration } from '../types'
import type { Outcome, ShapeContext } from './types'
import type {
  CombinatorShape,
  FanoutOptions,
  FanoutWinnerSelector,
  LoopUntilSpec,
  LoopUntilState,
  PanelJudge,
  PanelSpec,
  PanelVerdict,
  PipelineStage,
  ScopeWidenGate,
  VerifySpec,
  WidenDecision,
  WidenSpec,
  WinnerStrategy,
} from './wave-types'

// ── selectValidWinner — the one shared valid-only fanout selector ─────────────────

/**
 * The single content-free valid-only winner selector. Among the gated-VALID children only
 * (`verdict.valid === true`), pick by `strategy` — best score / smallest delivered artifact /
 * earliest — ties broken by earliest index; returns `undefined` when NONE is valid (an ungated
 * output can never win — the deliverable gate is the point). `sizeOf` (for `'smallest-artifact'`)
 * reads the child's settled deliverable — the raw value a leaf settles, or the unwrapped `Outcome<D>`
 * a delegate path produces; a domain passes e.g. patch diff-lines. This is the de-duplicated home of
 * the selection logic previously copied per role.
 */
export function selectValidWinner<D>(opts?: {
  strategy?: WinnerStrategy
  sizeOf?: (deliverable: D) => number
}): FanoutWinnerSelector<D> {
  const strategy = opts?.strategy ?? 'highest-score'
  const sizeOfIter = (iter: Iteration<unknown, Outcome<D>>): number => {
    const out = iter.output
    if (out === undefined || opts?.sizeOf === undefined) return Number.POSITIVE_INFINITY
    // The worktree-CLI leaf settles the RAW deliverable as iter.output (settledToIteration sets
    // `output = settled.out`); the MCP delegate path wraps it in an Outcome<D>. Accept both: unwrap
    // a `done` Outcome, else the settled value IS the deliverable. A raw artifact carries no `kind`
    // discriminant, so the branch is unambiguous.
    const deliverable = out.kind === 'done' ? out.deliverable : (out as unknown as D)
    return opts.sizeOf(deliverable)
  }
  return (iterations) => {
    const valid = iterations.filter(
      (iter) => iter.output !== undefined && !iter.error && iter.verdict?.valid === true,
    )
    if (valid.length === 0) return undefined
    switch (strategy) {
      case 'first-valid':
        return [...valid].sort((a, b) => a.index - b.index)[0]
      case 'smallest-artifact':
        return [...valid].sort((a, b) => sizeOfIter(a) - sizeOfIter(b) || a.index - b.index)[0]
      default:
        return [...valid].sort(
          (a, b) => (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0) || a.index - b.index,
        )[0]
    }
  }
}

// ── pipeline — sequential composition, first blocked stage short-circuits ─────────

/**
 * `pipeline(stages)` — run the stages in order, feeding each stage's `done` deliverable into the
 * next stage's task. The first stage that ends `blocked` (a child that went down, a child the
 * pool would not admit, or a stage whose `collect` chose to block) short-circuits — its blockers
 * ARE the pipeline's blockers, never coerced past a failed stage. The terminal stage's `done`
 * deliverable is the pipeline's deliverable.
 */
export function pipeline<Task, D>(
  stages: ReadonlyArray<PipelineStage<Task, unknown, unknown>>,
): CombinatorShape<Task, D> {
  if (stages.length === 0) {
    throw new ValidationError('pipeline: at least one stage is required')
  }
  return (ctx: ShapeContext<D>): Agent<Task, Outcome<D>> => ({
    name: `${ctx.persona.name}/pipeline`,
    async act(task, scope): Promise<Outcome<D>> {
      let carry: unknown = task
      for (const stage of stages) {
        const child = ctx.spawnChild(stage.label, ctx.persona.root)
        const res = scope.spawn(child, stage.feed(carry, ctx, task), {
          budget: ctx.budget.perChild,
          label: stage.label,
        })
        if (!res.ok) {
          return blocked([`${stage.label}: not admitted (${res.reason})`])
        }
        const settled = await drainOne(scope, stage.label)
        const out = stage.collect(settled as Settled<Outcome<unknown>>)
        if (out.kind === 'blocked') return out
        carry = out.deliverable
      }
      return { kind: 'done', deliverable: carry as D }
    },
  })
}

// ── fanout — N children in one round, optional single synthesis child ─────────────

/**
 * `fanout(items, opts)` — spawn one child per item in a single round (bounded by the conserved
 * pool's fail-closed admission), drain via `scope.next()`, then either synthesize over the
 * gathered settlements (one SEPARATE synthesis child) or return the best-valid child via the
 * single-sourced selector. A round that admitted zero children, or whose synthesis child could
 * not be admitted, is a concrete blocker.
 */
export function fanout<Task, Item, D>(
  items: ReadonlyArray<Item>,
  opts: FanoutOptions<Item, D>,
): CombinatorShape<Task, D> {
  if (opts.synthesize && opts.selectWinner) {
    throw new ValidationError('fanout: pass at most one of `synthesize` or `selectWinner`')
  }
  return (ctx: ShapeContext<D>): Agent<Task, Outcome<D>> => ({
    name: `${ctx.persona.name}/fanout`,
    async act(_task, scope): Promise<Outcome<D>> {
      const rejected: string[] = []
      let opened = 0
      for (const [i, item] of items.entries()) {
        const label = opts.label ? opts.label(item, i) : `item:${i}`
        const spec = opts.itemSpec ? opts.itemSpec(item, i, ctx) : ctx.persona.root
        const child = ctx.spawnChild(label, spec)
        const res = scope.spawn(child, opts.itemTask(item, i, ctx), {
          budget: ctx.budget.perChild,
          label,
        })
        if (res.ok) opened += 1
        else rejected.push(`${label}: not admitted (${res.reason})`)
      }
      if (opened === 0) {
        return blocked(
          rejected.length > 0
            ? rejected
            : ['fanout: budget admitted no item (fanout fully rejected)'],
        )
      }

      const drained = await drain<D>(scope)
      if (drained.done.length === 0) {
        return blocked(
          orderedBlockers(
            drained.blockers,
            rejected,
            'fanout: every item settled without a usable result',
          ),
        )
      }

      if (!opts.synthesize) {
        const select = opts.selectWinner ?? defaultSelectWinner
        const winner = select(drained.iterations)
        if (!winner || winner.output === undefined) {
          return blocked(
            orderedBlockers(drained.blockers, rejected, 'fanout: no item survived selection'),
          )
        }
        return { kind: 'done', deliverable: winner.output as D }
      }

      const synthLabel = 'synthesize'
      const synthChild = ctx.spawnChild(synthLabel, ctx.persona.root)
      const synthRes = scope.spawn(synthChild, opts.synthesize.synthesisTask(drained.done, ctx), {
        budget: ctx.budget.perChild,
        label: synthLabel,
      })
      if (!synthRes.ok) {
        return blocked([...drained.blockers, `${synthLabel}: not admitted (${synthRes.reason})`])
      }
      const synthSettled = await drainOne(scope, synthLabel)
      const out = opts.synthesize.collect(synthSettled)
      if (out.kind === 'blocked') return out
      return out
    },
  })
}

// ── loopUntil — budget-bounded iterative deepening, deployable non-oracle stop ────

/**
 * `loopUntil(seed, spec)` — one `step` child per round; `fold` accumulates each settlement into
 * the running state; `until` (reading the round's trace findings, NOT a fresh raw verdict) is
 * the deployable stop. The conserved pool IS the loop bound: once `spawn` fails closed the loop
 * stops. A loop that exhausted the pool without `until` ever satisfying is a concrete blocker.
 *
 * When `ctx.analyst` is set, each round runs it over the children settled so far and steers
 * `until` on the resulting trace-derived findings (the analyst spawns into THIS scope, so its
 * compute is conserved-pooled — equal-k holds by construction). Absent an analyst the findings
 * argument is the empty array — never a fabricated finding (fail-loud honesty over a silent default).
 */
export function loopUntil<Task, State, D>(
  seed: State,
  spec: LoopUntilSpec<Task, State, D>,
): CombinatorShape<Task, D> {
  return (ctx: ShapeContext<D>): Agent<Task, Outcome<D>> => ({
    name: `${ctx.persona.name}/loopUntil`,
    async act(task, scope): Promise<Outcome<D>> {
      let state: LoopUntilState<State> = { round: 0, value: seed }
      const blockers: string[] = []
      const settledSoFar: Settled<Outcome<D>>[] = []
      for (;;) {
        const label = spec.label ? spec.label(state.round) : `step:${state.round}`
        const child = ctx.spawnChild(label, ctx.persona.root)
        const res = scope.spawn(child, spec.step(task, state, ctx), {
          budget: ctx.budget.perChild,
          label,
        })
        if (!res.ok) {
          if (state.round === 0) return blocked([`${label}: not admitted (${res.reason})`])
          break
        }
        const settled = await drainOne(scope, label)
        if (settled.kind === 'down') blockers.push(blockerFromDown(settled))
        settledSoFar.push(settled)
        state = spec.fold(state, settled)
        // Wired analyst ⇒ steer `until` on trace-derived findings; absent ⇒ the dormant empty
        // default (the analyst spawns into THIS scope, so its compute is conserved-pooled).
        const findings = ctx.analyst
          ? await ctx.analyst.analyze({ task, settledSoFar, nodeId: scope.view.root })
          : []
        const reached = spec.until(state, findings)
        if (reached) return reached
        state = { round: state.round + 1, value: state.value }
      }
      return blocked(
        blockers.length > 0
          ? blockers
          : ['loopUntil: budget exhausted before the satisfiability gate was reached'],
      )
    },
  })
}

// ── panel — M judges over ONE artifact, write-only merge (selector≠judge limit) ───

/**
 * `panel(spec)` — spawn the M judge children over the SAME artifact, drain their settlements,
 * and fold them into a panel verdict via the pure WRITE-ONLY `merge` (a judge's output never
 * reaches another judge's task; the merge never spawns or re-ranks). A `down` judge carries no
 * verdict and is excluded from the merge denominator. A panel that admitted no judge is a
 * concrete blocker before `merge` is consulted.
 */
export function panel<Task, Artifact, D>(spec: PanelSpec<Artifact, D>): CombinatorShape<Task, D> {
  if (spec.judges.length === 0) {
    throw new ValidationError('panel: at least one judge is required')
  }
  return (ctx: ShapeContext<D>): Agent<Task, Outcome<D>> => ({
    name: `${ctx.persona.name}/panel`,
    async act(task, scope): Promise<Outcome<D>> {
      const artifact = task as unknown as Artifact
      const byLabel = new Map<string, PanelJudge>()
      const rejected: string[] = []
      let opened = 0
      for (const judge of spec.judges) {
        const child = ctx.spawnChild(judge.label, ctx.persona.root)
        const res = scope.spawn(child, spec.judgeTask(artifact, judge, ctx), {
          budget: ctx.budget.perChild,
          label: judge.label,
        })
        if (res.ok) {
          byLabel.set(judge.label, judge)
          opened += 1
        } else {
          rejected.push(`${judge.label}: not admitted (${res.reason})`)
        }
      }
      if (opened === 0) {
        return blocked(rejected.length > 0 ? rejected : ['panel: budget admitted no judge'])
      }

      const verdicts: PanelVerdict[] = []
      for (let s = await scope.next(); s !== null; s = await scope.next()) {
        const judge = byLabel.get(s.handle.label)
        if (!judge) {
          throw new ValidationError(
            `panel: settled child "${s.handle.label}" has no judge descriptor`,
          )
        }
        if (s.kind === 'down') {
          verdicts.push({ judge, down: true })
          continue
        }
        verdicts.push({
          judge,
          down: false,
          ...(s.verdict ? { verdict: s.verdict } : {}),
          output: s.out,
        })
      }
      return spec.merge(verdicts, artifact)
    },
  })
}

// ── verify — 2-node implement→verifier gate (selector≠judge) ──────────────────────

/**
 * `verify(spec)` — an IMPLEMENT child produces a candidate, then a SEPARATE VERIFIER child grades
 * it; only a `valid` verifier verdict ships. Any other outcome (implement down, verifier down,
 * verifier verdict absent or not `valid`) is a concrete blocker carrying the failure verbatim —
 * never a coerced "done". The implement child does not grade itself.
 */
export function verify<Task, Candidate, D>(
  spec: VerifySpec<Task, Candidate, D>,
): CombinatorShape<Task, D> {
  return (ctx: ShapeContext<D>): Agent<Task, Outcome<D>> => ({
    name: `${ctx.persona.name}/verify`,
    async act(task, scope): Promise<Outcome<D>> {
      const implementLabel = spec.implementLabel ?? 'implement'
      const implChild = ctx.spawnChild(implementLabel, ctx.persona.root)
      const implRes = scope.spawn(implChild, spec.implement(task, ctx), {
        budget: ctx.budget.perChild,
        label: implementLabel,
      })
      if (!implRes.ok) return blocked([`${implementLabel}: not admitted (${implRes.reason})`])
      const candidate = await drainOne(scope, implementLabel)
      if (candidate.kind === 'down') return blocked([blockerFromDown(candidate)])

      const verifierLabel = spec.verifierLabel ?? 'verify'
      const verifierChild = ctx.spawnChild(verifierLabel, ctx.persona.root)
      const verifierRes = scope.spawn(
        verifierChild,
        spec.verifier(candidate as Settled<Outcome<Candidate>>, ctx),
        { budget: ctx.budget.perChild, label: verifierLabel },
      )
      if (!verifierRes.ok)
        return blocked([`${verifierLabel}: not admitted (${verifierRes.reason})`])
      const gate = await drainOne(scope, verifierLabel)
      if (gate.kind === 'down') return blocked([blockerFromDown(gate)])
      if (!gate.verdict || gate.verdict.valid !== true) {
        return blocked([`${verifierLabel}: gate rejected the candidate (${verdictDetail(gate)})`])
      }
      return spec.collect(candidate as Settled<Outcome<Candidate>>, gate.verdict)
    },
  })
}

// ── widen — streaming progressive widening (G5), FLAT by default ──────────────────

/**
 * `widen(spec)` — the streaming spawn-on-completion driver. Spawns the seed lineages, then REACTS
 * to each `scope.next()`: on every settled child it consults `spec.gate.decide` and, when the gate
 * returns `widen`, spawns AT MOST ONE more child toward the chosen lineage under the remaining
 * conserved pool. `promising` is derived from the round's trace findings (the analyst seam),
 * never a child's raw `verdict` — and the default gate (`flatWidenGate`) never widens, so the R2
 * firewall stays dormant. Terminal selection is `spec.synthesize` over every settled lineage.
 *
 * When `ctx.analyst` is set, `decide` is consulted with that round's trace-derived findings;
 * absent an analyst the findings argument is the empty array a flat gate ignores. The analyst
 * spawns into THIS scope (conserved-pooled, so equal-k holds). Streaming caveat: a wired analyst
 * drains its own child off the SHARED cursor by id-match, so on a NON-flat gate (which spawns
 * widen children that are live concurrently) the analyst can consume a sibling's settlement before
 * the widen loop sees it. The shipped default (`flatWidenGate`) never widens, so no widen child is
 * ever live when the analyst runs and the wire is exact; a non-flat gate must drive the analyst on
 * a scope whose siblings are quiesced, or read findings without the shared-cursor drain.
 */
export function widen<Task, Seed, D>(spec: WidenSpec<Seed, D>): CombinatorShape<Task, D> {
  return (ctx: ShapeContext<D>): Agent<Task, Outcome<D>> => ({
    name: `${ctx.persona.name}/widen`,
    async act(_task, scope): Promise<Outcome<D>> {
      let opened = 0
      for (const [i, seed] of spec.seeds.entries()) {
        const label = `seed:${i}`
        const child = ctx.spawnChild(label, ctx.persona.root)
        const res = scope.spawn(child, spec.seedTask(seed, i, ctx), {
          budget: ctx.budget.perChild,
          label,
        })
        if (res.ok) opened += 1
      }
      if (opened === 0) {
        return blocked(['widen: budget admitted no seed lineage'])
      }

      const gathered: Settled<Outcome<D>>[] = []
      let widenIndex = 0
      for (let s = await scope.next(); s !== null; s = await scope.next()) {
        gathered.push(s)
        // Wired analyst ⇒ steer the gate on trace-derived findings; absent ⇒ the dormant empty
        // default the flat gate ignores. The analyst spawns into THIS scope (conserved-pooled).
        const findings = ctx.analyst
          ? await ctx.analyst.analyze({
              task: _task,
              settledSoFar: gathered,
              nodeId: scope.view.root,
            })
          : []
        const decision: WidenDecision<D> = spec.gate.decide(s, findings, scope.budget)
        if (decision.kind !== 'widen') continue
        const label = `widen:${widenIndex}`
        widenIndex += 1
        const child = ctx.spawnChild(label, ctx.persona.root)
        // Fail-closed admission bounds the widening — a rejected widen is simply not opened
        // (the gate may widen again off a later settlement); the budget is the breadth bound.
        scope.spawn(child, spec.widenTask(decision.toward, ctx), {
          budget: ctx.budget.perChild,
          label,
        })
      }

      const done = gathered.filter(isDone)
      if (done.length === 0) {
        return blocked(
          orderedBlockers(
            gathered.filter(isDown).map(blockerFromDown),
            [],
            'widen: every lineage settled without a usable result',
          ),
        )
      }
      return spec.synthesize(done, ctx)
    },
  })
}

/**
 * The flat default `ScopeWidenGate` — never widens, keeping the R2 selector≠judge collision
 * dormant. A gate run passes this explicitly; a test asserts the default is flat.
 */
export function flatWidenGate<D>(): ScopeWidenGate<D> {
  return {
    decide(): WidenDecision<D> {
      return { kind: 'stop' }
    },
  }
}

// ── Shared drain / select / blocker microstructure ────────────────────────────────

/** Drain every remaining settlement: project `done` children into kernel `Iteration`s for the
 *  single-sourced selector + keep the `done` settlements (for a synthesis child), and collect
 *  `down` children as concrete blockers (their reason surfaced verbatim). */
async function drain<D>(scope: Scope<Outcome<D>>): Promise<{
  iterations: Iteration<unknown, Outcome<D>>[]
  done: Settled<Outcome<D>>[]
  blockers: string[]
}> {
  const iterations: Iteration<unknown, Outcome<D>>[] = []
  const done: Settled<Outcome<D>>[] = []
  const blockers: string[] = []
  for (let s = await scope.next(); s !== null; s = await scope.next()) {
    if (s.kind === 'down') {
      blockers.push(blockerFromDown(s))
      continue
    }
    iterations.push(settledToIteration(s))
    done.push(s)
  }
  return { iterations, done, blockers }
}

/**
 * Drain exactly one settlement off a scope whose prior children are fully drained, so `next()`
 * yields precisely the child just spawned. Fail loud if it yields nothing — a spawned child that
 * never settles is a keystone invariant violation, not a result the combinator may swallow.
 */
async function drainOne<D>(scope: Scope<Outcome<D>>, label: string): Promise<Settled<Outcome<D>>> {
  const s = await scope.next()
  if (s === null) {
    throw new ValidationError(`combinator: child "${label}" was spawned but never settled`)
  }
  return s
}

function isDone<D>(s: Settled<Outcome<D>>): s is Extract<Settled<Outcome<D>>, { kind: 'done' }> {
  return s.kind === 'done'
}

function isDown<D>(s: Settled<Outcome<D>>): s is Extract<Settled<Outcome<D>>, { kind: 'down' }> {
  return s.kind === 'down'
}

function blockerFromDown<D>(s: Extract<Settled<Outcome<D>>, { kind: 'down' }>): string {
  return `${s.handle.label}: ${s.infra ? 'infra' : 'failed'} — ${s.reason}`
}

function verdictDetail<D>(s: Extract<Settled<Outcome<D>>, { kind: 'done' }>): string {
  if (!s.verdict) return 'no verdict'
  return s.verdict.notes ?? `score ${s.verdict.score}`
}

/** Compose the round's drained blockers + rejected-admission reasons, falling back to a named
 *  default ONLY when neither produced a reason — a `blocked` outcome must never be vacuous. */
function orderedBlockers(drained: string[], rejected: string[], fallback: string): string[] {
  const all = [...drained, ...rejected]
  return all.length > 0 ? all : [fallback]
}

/** Build a `blocked` outcome, failing loud on the empty-blocker contract violation (a shape that
 *  cannot finish MUST name at least one concrete blocker — never a vacuous block). */
function blocked<D>(blockers: string[]): Extract<Outcome<D>, { kind: 'blocked' }> {
  if (blockers.length === 0) {
    throw new ValidationError('combinator: a blocked outcome must name at least one blocker')
  }
  return { kind: 'blocked', blockers }
}
