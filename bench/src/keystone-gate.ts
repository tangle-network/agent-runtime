/**
 * The keystone gate — run the open binding question THROUGH the recursive runtime.
 *
 * The bench unifier (`run-benchmarks.ts`) drives the old `runLoop`. This module drives the
 * KEYSTONE instead: a `Persona` + the generic `fanout` combinator over the budget-conserving
 * `Supervisor`, so the diverse-strategy-vs-blind gate is measured through the same recursive
 * atom every personified loop uses — not a bespoke experiment harness.
 *
 * The one specificity is the developer's `AgentProfile` + the strategy list. Everything else is
 * free below it: orchestration, the conserved-budget equal-k guarantee, the trajectory ledger.
 *
 * The gate's two non-negotiables, enforced structurally here:
 *  - DEPLOYABLE selector. Each fanout child SOLVES via the router, then is graded by the
 *    benchmark's OWN deterministic `adapter.judge` (a runnable checker — NOT an LLM judge, NOT
 *    the answer oracle). That `BenchScore` becomes the child's `DefaultVerdict`, and `fanout`'s
 *    single-sourced `defaultSelectWinner` picks the best-scoring candidate. Selection therefore
 *    reads only the deployable verifier — selector ≠ oracle by construction.
 *  - EQUAL k. Both arms open the SAME number of children (k = strategies.length; blind = k
 *    identical copies), and the conserved pool reserves identical per-child budgets, so
 *    Σk(diverse) ≡ Σk(blind). `equalKOnCost` then proves the REALIZED token/usd spread is within
 *    tolerance (diverse prompts are longer, so the realized spend is checked, not assumed).
 *
 * `widen`/analyst stay out: this is the plumbing that makes the gate RUNNABLE through the
 * runtime, not new mechanism. Per the repo discipline, no adaptive widening is wired until the
 * gate returns positive.
 */

import type { SandboxEvent } from '@tangle-network/sandbox'
import type {
  AgentProfile,
  AgentSpec,
  Budget,
  CombinatorShape,
  DefaultVerdict,
  EqualKArm,
  EqualKVerdict,
  ExecutorContext,
  ExecutorRegistry,
  LeafExecutor,
  LeafExecutorFactory,
  LeafResult,
  Outcome,
  Persona,
  Runtime,
  Spend,
  SupervisedResult,
  TrajectoryReport,
} from '@tangle-network/agent-runtime/loops'
import {
  definePersona,
  equalKOnCost,
  fanout,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  runPersonified,
  trajectoryReport,
} from '@tangle-network/agent-runtime/loops'
import type { BenchmarkAdapter, BenchTask } from './benchmarks/types'
import { routerChatWithUsage } from './router-client'

/** A fanout child's task: the prompt to solve with + the instance to grade against. The instance
 *  travels with the prompt so the solve-and-grade leaf can run `adapter.judge` without a closure
 *  over the per-task state (the registry closes only over the adapter + router config). */
export interface SolveTask {
  readonly prompt: string
  readonly instance: BenchTask
}

/** What `benchSolverRegistry` needs to build a solve-and-grade leaf. The router config is the
 *  cheapest leaf (one chat completion, no box); the adapter supplies the deployable judge. */
export interface BenchSolverOptions {
  readonly adapter: BenchmarkAdapter
  readonly routerBaseUrl: string
  readonly routerKey: string
  readonly model: string
  /** Sampling temperature. >0 is required for the blind arm to be more than k identical samples
   *  (k copies at temperature 0 collapse to one answer — no compute control). Default 0.7. */
  readonly temperature?: number
}

const fnv = (prefix: string, value: unknown): string => {
  const str = (() => {
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      return String(value)
    }
  })()
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${prefix}:${(h >>> 0).toString(16).padStart(8, '0')}`
}

/** Extract the judged artifact from the model reply using the adapter's OWN deliverable parser
 *  (e.g. the last fenced ```json block for a transcript bench), so the keystone leaf honors
 *  `benchmark = adapter owns its deliverable`. Falls back to the trimmed reply when the adapter
 *  defines no output parser (the research/QA case). */
function extractArtifact(adapter: BenchmarkAdapter, content: string): string {
  if (!adapter.output) return content.trim()
  const events = [{ type: 'agent', data: { finalText: content } }] as unknown as SandboxEvent[]
  return adapter.output.parse(events)
}

/**
 * A single solve-and-grade leaf executor. Solves the task with ONE router completion, extracts
 * the deliverable via the adapter, then grades it with the benchmark's deterministic judge and
 * surfaces that `BenchScore` as the child's `DefaultVerdict`. The verdict is what `fanout`'s
 * deployable selector ranks on. Reports REAL token usage; a missing-usage provider records zero
 * tokens but still one iteration (never a fabricated priced cost). Fail-loud: a router non-2xx or
 * a judge throw rejects the leaf (the scope types it into a `down` settlement — never a silent 0).
 */
function benchSolveLeaf(opts: BenchSolverOptions, spec: AgentSpec, ctx: ExecutorContext): LeafExecutor<unknown> {
  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  let artifact: LeafResult<unknown> | undefined

  return {
    runtime: 'bench-router' as Runtime,
    async execute(task, signal): Promise<LeafResult<unknown>> {
      const t = task as SolveTask
      const system = spec.profile.prompt?.systemPrompt
      const messages = [
        ...(typeof system === 'string' && system.length > 0
          ? [{ role: 'system', content: system }]
          : []),
        { role: 'user', content: t.prompt },
      ]
      const started = Date.now()
      const linked = linkSignals(signal, controller.signal)
      const chat = await routerChatWithUsage(
        { routerBaseUrl: opts.routerBaseUrl, routerKey: opts.routerKey, model: opts.model },
        messages,
        { temperature: opts.temperature ?? 0.7, ...(linked ? { signal: linked } : {}) },
      )
      const candidate = extractArtifact(opts.adapter, chat.content)
      const score = await opts.adapter.judge(t.instance, candidate)
      const verdict: DefaultVerdict = {
        valid: score.resolved,
        score: score.score,
        ...(score.detail ? { notes: score.detail } : {}),
      }
      const spent: Spend = {
        iterations: 1,
        tokens: chat.usage ? { input: chat.usage.input, output: chat.usage.output } : { input: 0, output: 0 },
        usd: chat.costUsd ?? 0,
        ms: Date.now() - started,
      }
      artifact = { outRef: fnv('bench', { id: t.instance.id, candidate }), out: candidate, verdict, spent }
      return artifact
    },
    teardown(): Promise<{ destroyed: boolean }> {
      controller.abort()
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact() {
      if (!artifact) throw new Error('benchSolveLeaf: resultArtifact() read before execute()')
      return artifact
    },
  }
}

/**
 * A persona-supplied `ExecutorRegistry` whose `resolve` returns a FRESH solve-and-grade leaf per
 * spawn — the documented "persona supplies a fully-built registry" path. A fresh instance per
 * child is required because `fanout` spawns the children concurrently against ONE persona root
 * spec; a shared BYO executor instance would race on its single result slot. `register` throws:
 * this registry serves exactly one runtime (the bench solve leaf), by intent.
 */
export function benchSolverRegistry(opts: BenchSolverOptions): ExecutorRegistry {
  return {
    register(): void {
      throw new Error('benchSolverRegistry: register is unsupported (single bench-router runtime)')
    },
    resolve<Out>(spec: AgentSpec) {
      const factory: LeafExecutorFactory<Out> = (s, ctx) =>
        benchSolveLeaf(opts, s, ctx) as LeafExecutor<Out>
      void spec
      return { succeeded: true as const, value: factory }
    },
  }
}

/** Build the solver `Persona` from the developer's `AgentProfile` + a solve-and-grade registry.
 *  The deliverable type is the candidate text (`string`); `harness: null` is nominal — the
 *  supplied registry overrides resolution, so the root never falls through to the router/sandbox
 *  built-ins. */
export function defineSolverPersona(
  profile: AgentProfile,
  registry: ExecutorRegistry,
  name = 'gate-solver',
): Persona<string> {
  const root: AgentSpec = { profile, harness: null }
  return definePersona<string>({
    name,
    root,
    directive: 'Produce the single best deliverable that the benchmark judge will accept.',
    context: { role: 'benchmark solver' },
    executors: { registry },
  })
}

/** The blind/diverse `fanout` over k children. Each item is a strategy directive appended to the
 *  task prompt; the blind arm passes k empty strategies (k identical prompts = the compute
 *  control). No `synthesize` → the deployable `defaultSelectWinner` returns the best-graded child. */
function solveFanout(strategies: ReadonlyArray<string>, instance: BenchTask): CombinatorShape<unknown, string> {
  return fanout<unknown, string, string>(strategies, {
    itemTask: (strategy): SolveTask => ({
      prompt: strategy.length > 0 ? `${instance.prompt}\n\n${strategy}` : instance.prompt,
      instance,
    }),
    label: (_s, i) => `solve:${i}`,
  })
}

export interface RunKeystoneGateOptions {
  readonly adapter: BenchmarkAdapter
  /** The ONE specificity: who the solver is (prompt / model / tools). */
  readonly profile: AgentProfile
  /**
   * The diverse arm's strategy directives. `k = strategies.length` fixes BOTH arms' child count
   * (the blind arm runs k identical copies), so the two arms are equal-k by construction. Must be
   * length >= 2 (a single child is not a fanout).
   */
  readonly strategies: ReadonlyArray<string>
  readonly routerBaseUrl: string
  readonly routerKey: string
  readonly model: string
  readonly temperature?: number
  /** How many benchmark instances to run (the paired n). */
  readonly n?: number
  readonly ids?: string[]
  readonly split?: string
  /** Per-child token ceiling the conserved pool reserves. Default 60_000. */
  readonly perChildTokens?: number
  /** Per-child wall-clock deadline (ms) forwarded to the root budget. */
  readonly deadlineMs?: number
  /**
   * Override the solve-and-grade registry (test seam — inject a deterministic stub so the gate
   * plumbing runs offline). When omitted, `benchSolverRegistry` is built from the router config.
   */
  readonly solverRegistry?: ExecutorRegistry
}

/** One arm's aggregate over the n instances. `errored` = runs that ended `no-winner` for an
 *  infra reason (budget/abort) — excluded from the resolve denominator, like an infra-errored
 *  cell. A genuine all-children-down counts as not-resolved (a real failure, kept in n). */
export interface KeystoneArmResult {
  readonly label: string
  readonly n: number
  readonly resolved: number
  readonly errored: number
  /** resolved / (n - errored). */
  readonly resolveRate: number
  readonly totalSpend: Spend
  /** First failure reason seen (blocked blockers / no-winner reason), when `errored > 0` —
   *  so a high error count is diagnosable, not a mute 0%. */
  readonly sampleBlocker?: string
}

export interface KeystoneGateReport {
  readonly benchmark: string
  readonly k: number
  readonly n: number
  /** Per-instance paired booleans — the input a paired-bootstrap / BH test consumes downstream. */
  readonly perTask: ReadonlyArray<{ readonly id: string; readonly blind: boolean; readonly diverse: boolean }>
  readonly arms: ReadonlyArray<KeystoneArmResult>
  /** diverse.resolveRate − blind.resolveRate, in percentage points (the gate's headline delta). */
  readonly deltaPp: number
  /** Whether the two arms spent within tolerance on conserved cost — the equal-k proof. A `false`
   *  here means the delta is NOT at equal compute (a confound to report, never a win to publish). */
  readonly equalK: EqualKVerdict
}

const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })

function addSpend(a: Spend, b: Spend): Spend {
  return {
    iterations: a.iterations + b.iterations,
    tokens: { input: a.tokens.input + b.tokens.input, output: a.tokens.output + b.tokens.output },
    usd: a.usd + b.usd,
    ms: a.ms + b.ms,
  }
}

/**
 * Did the SELECTED candidate resolve? Reads the trajectory's `done` leaf nodes, replays the same
 * best-valid-score, ties→earliest rule `defaultSelectWinner` used inside the fanout, and returns
 * that node's `verdict.valid`. Reading the run's OWN evidence (the journaled per-child verdict)
 * avoids a second judge pass over the deliverable — the deployable selector's chosen verdict IS
 * the arm's outcome on this task.
 */
function selectedResolved(report: TrajectoryReport): boolean {
  let best: { score: number; valid: boolean } | undefined
  for (const node of report.nodes) {
    if (node.status !== 'done' || !node.verdict) continue
    const v = node.verdict
    if (typeof v.score !== 'number') continue
    if (best === undefined || (v.valid && !best.valid) || (v.valid === best.valid && v.score > best.score)) {
      best = { score: v.score, valid: v.valid === true }
    }
  }
  return best?.valid === true
}

/**
 * Run the diverse-vs-blind gate through the keystone over the adapter's tasks. For each instance,
 * each arm runs a `fanout` of k children to a typed `SupervisedResult`; the winning child's
 * deployable verdict decides resolution, the conserved pool guarantees equal k, and the trajectory
 * ledger backs both the resolve metric and the cross-arm equal-k proof.
 */
export async function runKeystoneGate(opts: RunKeystoneGateOptions): Promise<KeystoneGateReport> {
  if (opts.strategies.length < 2) {
    throw new Error('runKeystoneGate: need >= 2 strategies (k = strategies.length fixes both arms’ child count)')
  }
  const k = opts.strategies.length
  await opts.adapter.preflight()
  const tasks = await opts.adapter.loadTasks({
    ...(opts.n !== undefined ? { limit: opts.n } : {}),
    ...(opts.ids ? { ids: opts.ids } : {}),
    ...(opts.split ? { split: opts.split } : {}),
  })
  if (tasks.length === 0) throw new Error('runKeystoneGate: adapter.loadTasks returned no tasks')

  const registry = opts.solverRegistry ?? benchSolverRegistry(opts)
  const perChildTokens = opts.perChildTokens ?? 60_000
  const perChild: Budget = {
    maxIterations: 1,
    maxTokens: perChildTokens,
    ...(opts.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}),
  }
  // The root pool must admit exactly k children (no synthesis/analyst on this flat surface).
  const budget: Budget = {
    maxIterations: k,
    maxTokens: k * perChildTokens,
    ...(opts.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}),
  }

  const armDefs: ReadonlyArray<{ label: string; strategies: ReadonlyArray<string> }> = [
    { label: 'blind', strategies: Array.from({ length: k }, () => '') },
    { label: 'diverse', strategies: opts.strategies },
  ]

  const perTask: Array<{ id: string; blind: boolean; diverse: boolean }> = []
  const acc = new Map<string, { resolved: number; errored: number; spend: Spend; sampleBlocker?: string }>(
    armDefs.map((a) => [a.label, { resolved: 0, errored: 0, spend: zeroSpend() }]),
  )

  for (const task of tasks) {
    const row: { id: string; blind: boolean; diverse: boolean } = { id: task.id, blind: false, diverse: false }
    for (const armDef of armDefs) {
      const journal = new InMemorySpawnJournal()
      const blobs = new InMemoryResultBlobStore()
      const persona = defineSolverPersona(opts.profile, registry, `${armDef.label}-solver`)
      const runId = `gate:${armDef.label}:${task.id}`
      const result: SupervisedResult<Outcome<string>> = await runPersonified<unknown, string>({
        persona,
        shape: solveFanout(armDef.strategies, task),
        task: undefined,
        budget,
        shapeBudget: { fanout: k, perChild },
        runId,
        journal,
        blobs,
      })
      const report = await trajectoryReport(journal, blobs, runId, { withOutputs: true })
      const entry = acc.get(armDef.label)!
      entry.spend = addSpend(entry.spend, report.total)
      // A run produces a GRADEABLE deliverable only when the shape returned `done`. A
      // `winner` carrying a `blocked` Outcome (every child went down) or a `no-winner`
      // means the arm produced NO candidate to grade on this task — that is an ERROR
      // (excluded from the resolve denominator + surfaced), never a silent "not resolved",
      // so a 0% that is really "everything failed" can't masquerade as a clean result.
      const gradeable = result.kind === 'winner' && result.out.kind === 'done'
      if (gradeable) {
        const resolved = selectedResolved(report)
        if (resolved) entry.resolved += 1
        if (armDef.label === 'blind') row.blind = resolved
        else row.diverse = resolved
      } else {
        entry.errored += 1
        if (entry.sampleBlocker === undefined) {
          entry.sampleBlocker =
            result.kind === 'winner' && result.out.kind === 'blocked'
              ? result.out.blockers.slice(0, 2).join(' | ')
              : `no-winner: ${(result as { reason?: string }).reason ?? 'unknown'}`
        }
      }
    }
    perTask.push(row)
  }

  const arms: KeystoneArmResult[] = armDefs.map((a) => {
    const e = acc.get(a.label)!
    const denom = Math.max(1, tasks.length - e.errored)
    return {
      label: a.label,
      n: tasks.length,
      resolved: e.resolved,
      errored: e.errored,
      resolveRate: e.resolved / denom,
      totalSpend: e.spend,
      ...(e.sampleBlocker !== undefined ? { sampleBlocker: e.sampleBlocker } : {}),
    }
  })

  const equalKArms: EqualKArm[] = armDefs.map((a) => ({
    label: a.label,
    report: {
      root: a.label,
      nodes: [],
      total: acc.get(a.label)!.spend,
      statusCounts: { done: 0, failed: 0, cancelled: 0, pending: 0 },
    },
  }))
  const equalK = equalKOnCost(equalKArms)

  const blind = arms.find((a) => a.label === 'blind')!
  const diverse = arms.find((a) => a.label === 'diverse')!
  return {
    benchmark: opts.adapter.name,
    k,
    n: tasks.length,
    perTask,
    arms,
    deltaPp: (diverse.resolveRate - blind.resolveRate) * 100,
    equalK,
  }
}

/** Link two abort signals into one that fires when either does; `undefined` when neither is set. */
function linkSignals(a: AbortSignal, b: AbortSignal): AbortSignal | undefined {
  if (a.aborted || b.aborted) {
    const c = new AbortController()
    c.abort()
    return c.signal
  }
  const c = new AbortController()
  const onAbort = () => c.abort()
  a.addEventListener('abort', onAbort, { once: true })
  b.addEventListener('abort', onAbort, { once: true })
  return c.signal
}
