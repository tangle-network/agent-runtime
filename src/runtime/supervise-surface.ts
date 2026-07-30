/**
 * superviseSurface — drive a team of agents to solve a graded `AgenticSurface` task. ONE capability that
 * replaces the worker-seam + "self-improving supervisor" wrapper pair: the driver (`profile`) spawns
 * workers that each run `runAgentic` over the surface (`refine` by default), settle on the surface's OWN
 * check (settled ⟺ resolved — a worker that ran but didn't pass settles invalid, so a keep-best driver
 * never counts it done), and feed the driver a self-improvement lens (the still-FAILING tests, by default)
 * so the next spawn targets the persistently-hard cases. Returns the deployable outcome + the full
 * conserved spend.
 *
 * WHY this lives here and not as a `supervise()` backend: `runAgentic` depends on the supervise core
 * (`strategy.ts` → `supervise/`), so a surface-solving worker cannot be a supervise built-in without an
 * import cycle. It is therefore a COMPOSITION of `supervise()` + `runAgentic` at the layer above both —
 * the right home for "supervise over a graded surface". The within-run self-improvement is the analyst
 * (authored content, swap `analysts`); the across-run kind wraps this call in `improve()`.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgenticSurface, type AgenticTask, runAgentic, type Strategy } from './strategy'
import { type SuperviseOptions, supervise } from './supervise/supervise'
import type { Executor, ExecutorFactory, ExecutorResult, Spend } from './supervise/types'

/** What a surface worker settles with — the surface verdict the driver + deliverable read. `resolved` is
 *  the surface check's pass/fail (settled ⟺ resolved); `score` is the partial-credit fraction; `failing`
 *  carries the tests this worker left red (so the analyst can target them). */
export interface SurfaceWorkerOut {
  readonly resolved: boolean
  readonly score: number
  readonly shots: number
  readonly summary: string
  readonly failing?: readonly string[]
}

/** Remember the worker's LAST `run_tests` output so the analyst can name the still-failing tests — a
 *  transparent passthrough for every other surface call. Local to this module (no surface-zoo concept). */
function captureFailures(base: AgenticSurface): {
  surface: AgenticSurface
  failing: () => string[]
} {
  let lastReport = ''
  const surface: AgenticSurface = {
    name: base.name,
    open: (t) => base.open(t),
    tools: (t, h) => base.tools(t, h),
    async call(h, name, args) {
      const out = await base.call(h, name, args)
      if (name === 'run_tests') lastReport = out
      return out
    },
    score: (t, h) => base.score(t, h),
    close: (h) => base.close(h),
  }
  const failing = () => {
    const body = /FAILING:\s*(.+)/i.exec(lastReport)?.[1]
    return body
      ? body
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  }
  return { surface, failing }
}

/** How a worker runs the surface task (its router substrate + per-attempt bounds). */
export interface SurfaceWorkerConfig {
  readonly routerBaseUrl: string
  readonly routerKey: string
  readonly model: string
  readonly maxTokens: number
  readonly innerTurns: number
  /** Refine-shot budget for one attempt. */
  readonly budget: number
}

/** One spawned worker = one `runAgentic` attempt over the surface task. The driver's brief is threaded
 *  into the attempt (so a re-spawn can take a targeted angle, not an identical retry); `runAgentic` stamps
 *  real tokens/usd/ms, forwarded as `Spend`; the still-failing tests are captured for the analyst. */
function surfaceWorkerExecutor(
  surface: AgenticSurface,
  task: AgenticTask,
  worker: SurfaceWorkerConfig,
  strategy: Strategy,
): Executor<SurfaceWorkerOut> {
  let artifact: ExecutorResult<SurfaceWorkerOut> | undefined
  return {
    runtime: 'surface-worker',
    async execute(brief: unknown): Promise<ExecutorResult<SurfaceWorkerOut>> {
      const guidance = typeof brief === 'string' ? brief.trim() : brief ? JSON.stringify(brief) : ''
      const attemptTask: AgenticTask = guidance
        ? {
            ...task,
            systemPrompt: `${task.systemPrompt ?? ''}\n\n— Supervisor guidance for THIS attempt (incorporate it; do not just repeat a prior approach) —\n${guidance}`,
          }
        : task
      const cap = captureFailures(surface)
      const r = await runAgentic({
        surface: cap.surface,
        task: attemptTask,
        strategy,
        budget: worker.budget,
        routerBaseUrl: worker.routerBaseUrl,
        routerKey: worker.routerKey,
        model: worker.model,
        maxTokens: worker.maxTokens,
        innerTurns: worker.innerTurns,
      })
      const out: SurfaceWorkerOut = {
        resolved: r.resolved,
        score: r.score,
        shots: r.shots,
        summary: `${strategy.name} ${r.shots} shot(s) → ${(100 * r.score).toFixed(0)}% (${r.resolved ? 'resolved' : 'unresolved'})`,
        failing: r.resolved ? [] : cap.failing(),
      }
      const spent: Spend = { iterations: r.completions, tokens: r.tokens, usd: r.usd, ms: r.ms }
      artifact = {
        outRef: `surface-worker:${task.id}:${r.shots}:${r.resolved ? 'ok' : 'no'}`,
        out,
        verdict: { valid: r.resolved, score: r.score },
        spent,
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact() {
      if (!artifact) throw new Error('surfaceWorkerExecutor: resultArtifact before execute')
      return artifact
    },
  }
}

export interface SuperviseSurfaceOptions {
  /** The graded surface workers solve (open/tools/call/score/close). */
  readonly surface: AgenticSurface
  /** Where/how each worker runs the surface task. */
  readonly worker: SurfaceWorkerConfig
  /** Backend for the root profile; descendants execute one checked surface attempt. */
  readonly rootBackend: ExecutorFactory<unknown>
  readonly strategy: Strategy
  /** Complete supervision policy; this adapter supplies only backend resolution and deliverable. */
  readonly supervision: Omit<SuperviseOptions, 'resolveExecutor'>
}

/** The deployable outcome of a supervised surface run. */
export interface SuperviseSurfaceResult {
  readonly resolved: boolean
  readonly score: number
  readonly usd: number
  readonly tokensIn: number
  readonly tokensOut: number
  readonly ms: number
  /** Total conserved-pool iterations = the driver + worker LLM rounds the run actually spent. */
  readonly completions: number
}

/** Drive a team of agents (spawned + steered by `profile`) to solve a graded `AgenticSurface` task, and
 *  report the deployable outcome + the full conserved spend. This is `supervise()` configured for surfaces
 *  — there is no other entrypoint to learn. */
export async function superviseSurface(
  profile: AgentProfile,
  task: AgenticTask,
  opts: SuperviseSurfaceOptions,
): Promise<SuperviseSurfaceResult> {
  const result = await supervise(profile, task, {
    ...opts.supervision,
    resolveExecutor: (_profile, execution) =>
      execution.depth === 0
        ? opts.rootBackend
        : () => surfaceWorkerExecutor(opts.surface, task, opts.worker, opts.strategy),
  })

  const out = result.kind === 'winner' ? (result.out as SurfaceWorkerOut | undefined) : undefined
  const sp = result.spentTotal
  return {
    resolved: out?.resolved ?? false,
    score: out?.score ?? 0,
    usd: sp.usd,
    tokensIn: sp.tokens.input,
    tokensOut: sp.tokens.output,
    ms: sp.ms,
    completions: sp.iterations,
  }
}
