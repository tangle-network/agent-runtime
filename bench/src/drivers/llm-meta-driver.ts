/**
 * @experimental
 *
 * LLM meta-driver — the TREATMENT variant of the recursive execution atom's two driver-act
 * bodies (the coded progressive-widening control is in `./progressive-widening.ts`; both
 * share the flat-by-default `WidenGate`). Operator's call: build it now, on top of the
 * budget-reservation invariant that keeps an equal-k result valid.
 *
 * The policy: `act` asks the Router (an LLM) for an initial spawn plan — which child agents
 * to spawn and their per-child budgets ("driver A for n shots, B for k shots" =
 * heterogeneous per-child `maxIterations`) — then reacts to each `scope.next()` completion.
 * On a promising settlement it asks the Router again for a widen plan: spawn one more child
 * toward a lineage, under the conserved pool. Children resolve their `LeafExecutor` through
 * the open registry off their `AgentSpec` (`harness: null` → a direct Router call, no box;
 * a `BackendType` → sandboxed; or a BYO `executor`) — the meta-driver never switches on the
 * runtime itself.
 *
 * The same two firewall invariants the control upholds (critique R2):
 *  - `WidenGate` DEFAULTS TO FLAT (`defaultWidenGate`), so a gate run never asks for a
 *    widen and the selector≠judge conflict stays dormant.
 *  - The LLM is shown ONLY trace-derived findings (the `analyze` hook → `AnalystFinding[]`)
 *    when deciding to widen — NEVER the raw `verdict.score`. Letting the meta-controller
 *    read the judge verdict for a spawn decision requires the gate's explicit
 *    `judgeExempt: true` (off by default), the documented hatch that re-couples steering to
 *    the judge.
 *
 * Selection stays single-sourced (`settledToIteration` + `defaultSelectWinner`).
 *
 * The Router is an external boundary: `routerChatWithUsage` (reused from `../router-client`,
 * not re-copied) reports REAL token usage and throws on a non-OK response. The driver
 * inspects the parse outcome before acting on a plan — a malformed plan fails loud, never a
 * silent empty fan-out.
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import { defaultSelectWinner } from '../../../src/loops/run-loop.ts'
import { settledToIteration } from '../../../src/loops/supervise/scope.ts'
import type {
  Agent,
  AgentSpec,
  Budget,
  Scope,
  Settled,
  WidenGate,
} from '../../../src/loops/supervise/types.ts'
import { routerChatWithUsage, type RouterConfig } from '../router-client.ts'
import { defaultWidenGate } from './progressive-widening.ts'

/** A child the meta-driver can spawn, keyed by a stable name the Router references in its
 *  plan. The `agent` carries its `AgentSpec` as `executorSpec` — the field `scope.spawn`
 *  reads to resolve the runtime (`harness: null` → router/inline; `BackendType` → sandbox;
 *  BYO `executor`). */
export interface MetaChild<Out> {
  readonly key: string
  readonly agent: Agent<unknown, Out>
  readonly task: unknown
  /** One-line capability summary the Router sees when choosing this child. */
  readonly description: string
}

/** One spawn the Router asked for: a child key from the catalog + its per-child budget. */
export interface SpawnPlanEntry {
  readonly childKey: string
  readonly shots: number
  readonly maxTokens: number
  readonly maxUsd?: number
}

/** The Router's decision, parsed and validated. `done: true` means "no more spawns,
 *  synthesize the winner from what settled". */
export interface SpawnPlan {
  readonly spawns: ReadonlyArray<SpawnPlanEntry>
  readonly done: boolean
}

export type AnalyzeSettled<Out> = (
  settled: Extract<Settled<Out>, { kind: 'done' }>,
) => Promise<ReadonlyArray<AnalystFinding>>

export interface LlmMetaDriverOptions<Out> {
  readonly name?: string
  /** Router seam (base url + key + model). Reused for every meta-decision call. */
  readonly router: RouterConfig
  /** The catalog of spawnable children the Router plans over, keyed by `key`. */
  readonly catalog: ReadonlyArray<MetaChild<Out>>
  /** One-line statement of the goal the Router optimizes the spawn plan toward. */
  readonly objective: string
  /** Trace-analyst wire feeding the widen decision — the ONLY child signal the Router
   *  sees post-settlement. Omit to run flat (no findings → never widens under the default
   *  gate). */
  readonly analyze?: AnalyzeSettled<Out>
  /** The widening governor. Defaults to `defaultWidenGate` (flat — never widens). */
  readonly gate?: WidenGate<Out>
  /** Deadline budget for one child the Router omits a deadline for. */
  readonly perChildDeadlineMs?: number
}

/**
 * Build the LLM meta-driver `Agent`. Its `act` body: ask the Router for an initial spawn
 * plan → spawn the planned children at their heterogeneous per-child budgets → react to
 * each `next()` → on a promising (trace-derived) settlement, ask the Router for a widen
 * plan and spawn one more under budget → synthesize with the single-sourced selector.
 */
export function createLlmMetaDriver<Out>(opts: LlmMetaDriverOptions<Out>): Agent<unknown, Out> {
  const gate = opts.gate ?? defaultWidenGate<Out>()
  const analyze = opts.analyze
  const byKey = new Map(opts.catalog.map((c) => [c.key, c]))

  return {
    name: opts.name ?? 'llm-meta-driver',
    async act(task: unknown, scope: Scope<Out>): Promise<Out> {
      // Ask the Router for the initial spawn plan. The prompt shows the catalog + budget
      // readout; the LLM decides which children and their per-child shots/tokens.
      const initial = await requestPlan(opts, scope, task, undefined, [])
      spawnPlanned(initial, byKey, opts, scope)

      const done: Array<Extract<Settled<Out>, { kind: 'done' }>> = []
      for (let settled = await scope.next(); settled !== null; settled = await scope.next()) {
        if (settled.kind === 'down') continue // infra/bad child: excluded from merge n + equal-k
        done.push(settled)

        // Flat gate (the default) short-circuits before any Router call — a gate run never
        // pays for a widen decision and the firewall conflict stays dormant.
        if (!gate.shouldWiden(settled, scope.budget)) continue
        const findings = analyze ? await analyze(settled) : []
        if (!widenIsWarranted(findings, gate, settled)) continue

        // Ask the Router for a widen plan, showing it ONLY the trace-derived findings (never
        // the verdict). It returns the next children to spawn, or `done` to stop widening.
        const widen = await requestPlan(opts, scope, task, settled, findings)
        if (widen.done) continue
        spawnPlanned(widen, byKey, opts, scope)
      }

      const iterations = done.map((s) => settledToIteration(s))
      const winner = defaultSelectWinner(iterations)
      if (!winner) {
        throw new Error(
          'llm-meta-driver: no done child to select a winner from (all children were down)',
        )
      }
      return winner.output as Out
    },
  }
}

/** Spawn every entry the Router planned, mapping each to its catalog child and per-child
 *  budget. A plan entry referencing an unknown child key fails loud (a hallucinated plan is
 *  a diagnostic, not a silently-dropped spawn). A spawn that fails pool admission is dropped
 *  — fail closed, never overcommit the conserved pool. */
function spawnPlanned<Out>(
  plan: SpawnPlan,
  byKey: Map<string, MetaChild<Out>>,
  opts: LlmMetaDriverOptions<Out>,
  scope: Scope<Out>,
): void {
  for (const entry of plan.spawns) {
    const child = byKey.get(entry.childKey)
    if (!child) {
      throw new Error(
        `llm-meta-driver: Router planned a spawn for unknown child key "${entry.childKey}" (catalog: ${[...byKey.keys()].join(', ')})`,
      )
    }
    assertSpawnable(child)
    const budget = entryBudget(entry, opts)
    scope.spawn(child.agent, child.task, { budget, label: child.key })
  }
}

/** Project a Router plan entry into the conserved `Budget` (heterogeneous per child — this
 *  is the "driver A n shots, B k shots" dial). */
function entryBudget<Out>(entry: SpawnPlanEntry, opts: LlmMetaDriverOptions<Out>): Budget {
  return {
    maxIterations: entry.shots,
    maxTokens: entry.maxTokens,
    ...(entry.maxUsd !== undefined ? { maxUsd: entry.maxUsd } : {}),
    ...(opts.perChildDeadlineMs !== undefined ? { deadlineMs: opts.perChildDeadlineMs } : {}),
  }
}

/**
 * Ask the Router for a spawn plan. The external-boundary call returns real usage and throws
 * on a non-OK response; the JSON parse is inspected before the plan is acted on — a
 * malformed plan throws (fail loud), never degrades to a silent empty fan-out. When
 * `settled`/`findings` are present this is a widen decision and the prompt carries ONLY the
 * trace-derived findings (selector ≠ judge).
 */
async function requestPlan<Out>(
  opts: LlmMetaDriverOptions<Out>,
  scope: Scope<Out>,
  task: unknown,
  settled: Extract<Settled<Out>, { kind: 'done' }> | undefined,
  findings: ReadonlyArray<AnalystFinding>,
): Promise<SpawnPlan> {
  const prompt = settled
    ? widenPrompt(opts, scope, settled, findings)
    : initialPrompt(opts, scope, task)
  const res = await routerChatWithUsage(opts.router, [
    { role: 'system', content: metaSystemPrompt },
    { role: 'user', content: prompt },
  ])
  const parsed = parsePlan(res.content)
  if (!parsed.ok) {
    throw new Error(`llm-meta-driver: Router returned an unparseable spawn plan — ${parsed.error}`)
  }
  return parsed.plan
}

const metaSystemPrompt = [
  'You are a spawn meta-driver over a budget-conserving execution scope.',
  'You decide which child agents to spawn and their per-child budgets (shots, tokens).',
  'Spawning is asynchronous: a child runs, settles, and you may then widen toward a',
  'promising lineage under the remaining conserved budget. Do NOT fan out eagerly.',
  'Reply with ONLY a JSON object: {"spawns":[{"childKey":string,"shots":number,"maxTokens":number,"maxUsd"?:number}],"done":boolean}.',
  'When you have enough settled children to synthesize a winner, reply {"spawns":[],"done":true}.',
].join(' ')

function initialPrompt<Out>(
  opts: LlmMetaDriverOptions<Out>,
  scope: Scope<Out>,
  task: unknown,
): string {
  return [
    `Objective: ${opts.objective}`,
    `Task: ${stringifyForPrompt(task)}`,
    `Conserved budget: ${budgetLine(scope)}`,
    'Catalog of spawnable children:',
    catalogLines(opts.catalog),
    'Choose the initial spawn plan: which children, with which per-child shots/tokens.',
  ].join('\n')
}

/** The widen prompt shows ONLY trace-derived findings about the settled child — never its
 *  verdict score. This is the firewall: the meta-controller steers from the diagnosis, not
 *  the judge. */
function widenPrompt<Out>(
  opts: LlmMetaDriverOptions<Out>,
  scope: Scope<Out>,
  settled: Extract<Settled<Out>, { kind: 'done' }>,
  findings: ReadonlyArray<AnalystFinding>,
): string {
  return [
    `Objective: ${opts.objective}`,
    `A child "${settled.handle.label}" just settled. Trace-analyst findings (steer from these, NOT any score):`,
    renderFindings(findings),
    `Remaining conserved budget: ${budgetLine(scope)}`,
    'Catalog of spawnable children:',
    catalogLines(opts.catalog),
    'Widen toward the promising lineage with at most one more spawn, or reply done if there is nothing worth widening.',
  ].join('\n')
}

function catalogLines<Out>(catalog: ReadonlyArray<MetaChild<Out>>): string {
  return catalog.map((c) => `  - ${c.key}: ${c.description}`).join('\n')
}

function budgetLine<Out>(scope: Scope<Out>): string {
  const b = scope.budget
  return `tokensLeft=${b.tokensLeft} usdLeft=${b.usdLeft} reservedTokens=${b.reservedTokens}`
}

function renderFindings(findings: ReadonlyArray<AnalystFinding>): string {
  if (findings.length === 0) return '  (no findings)'
  return findings
    .map(
      (f) =>
        `  - [${f.severity}/${f.area}] ${f.claim}${f.recommended_action ? ` → ${f.recommended_action}` : ''}`,
    )
    .join('\n')
}

/**
 * Widen warranted? The trace-derived gate: a `high`/`critical` finding with a
 * `recommended_action` is a correctable middle band worth one more shot. Empty findings are
 * NOT warranted (flat). The ONLY verdict-reading path is the gate's explicit
 * `judgeExempt: true` hatch (off by default), which re-couples steering to the judge.
 */
function widenIsWarranted<Out>(
  findings: ReadonlyArray<AnalystFinding>,
  gate: WidenGate<Out>,
  settled: Extract<Settled<Out>, { kind: 'done' }>,
): boolean {
  if (gate.judgeExempt === true) {
    const score = (settled.verdict as { score?: unknown } | undefined)?.score
    return typeof score === 'number' && score > 0
  }
  return findings.some(
    (f) =>
      (f.severity === 'high' || f.severity === 'critical') &&
      typeof f.recommended_action === 'string' &&
      f.recommended_action.length > 0,
  )
}

/** Parse + validate the Router's JSON plan. A non-object, a missing/!array `spawns`, a
 *  non-boolean `done`, or a malformed entry is a typed parse failure the caller fails loud
 *  on — never a silent empty plan. */
function parsePlan(content: string): { ok: true; plan: SpawnPlan } | { ok: false; error: string } {
  const json = extractJsonObject(content)
  if (json === undefined) return { ok: false, error: 'no JSON object in response' }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return { ok: false, error: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'plan is not an object' }
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.spawns)) return { ok: false, error: '`spawns` is not an array' }
  if (typeof obj.done !== 'boolean') return { ok: false, error: '`done` is not a boolean' }
  const spawns: SpawnPlanEntry[] = []
  for (const e of obj.spawns) {
    if (typeof e !== 'object' || e === null) return { ok: false, error: 'a spawn entry is not an object' }
    const entry = e as Record<string, unknown>
    if (typeof entry.childKey !== 'string') return { ok: false, error: 'a spawn entry has no string `childKey`' }
    if (typeof entry.shots !== 'number' || entry.shots <= 0) {
      return { ok: false, error: `spawn "${entry.childKey}" has a non-positive \`shots\`` }
    }
    if (typeof entry.maxTokens !== 'number' || entry.maxTokens <= 0) {
      return { ok: false, error: `spawn "${entry.childKey}" has a non-positive \`maxTokens\`` }
    }
    spawns.push({
      childKey: entry.childKey,
      shots: entry.shots,
      maxTokens: entry.maxTokens,
      ...(typeof entry.maxUsd === 'number' ? { maxUsd: entry.maxUsd } : {}),
    })
  }
  return { ok: true, plan: { spawns, done: obj.done } }
}

/** Slice the first balanced `{...}` object out of a model response (tolerates prose around
 *  the JSON). Returns undefined when no balanced object is present. */
function extractJsonObject(content: string): string | undefined {
  const start = content.indexOf('{')
  if (start === -1) return undefined
  let depth = 0
  for (let i = start; i < content.length; i++) {
    const ch = content[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return content.slice(start, i + 1)
    }
  }
  return undefined
}

function stringifyForPrompt(task: unknown): string {
  if (typeof task === 'string') return task
  try {
    return JSON.stringify(task)
  } catch {
    return String(task)
  }
}

/** A `MetaChild`'s agent must carry its `executorSpec` (AgentSpec) — the field
 *  `scope.spawn` resolves the runtime from. Fail loud if absent (only the agent author
 *  knows its profile/harness). */
function assertSpawnable<Out>(child: MetaChild<Out>): void {
  const carried = (child.agent as { executorSpec?: unknown }).executorSpec
  if (!isAgentSpec(carried)) {
    throw new Error(
      `llm-meta-driver: child "${child.key}" agent carries no executorSpec (AgentSpec); cannot resolve its LeafExecutor`,
    )
  }
}

function isAgentSpec(value: unknown): value is AgentSpec {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return 'profile' in v && 'harness' in v
}
