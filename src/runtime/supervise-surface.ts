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
 * (authored content, swap `analysts`); the across-run kind wraps this call in `improve()`/`selfImprove`.
 */
import type { AgentProfile } from '@tangle-network/sandbox'
import type { AnalystRegistry, MakeWorkerAgent } from '../mcp/tools/coordination'
import type { RouterConfig } from './router-client'
import {
  type AgenticSurface,
  type AgenticTask,
  refine,
  runAgentic,
  type Strategy,
} from './strategy'
import type { DeliverableSpec } from './supervise/completion-gate'
import { supervise } from './supervise/supervise'
import type { SupervisorProfile } from './supervise/supervisor-agent'
import type { Agent, AgentSpec, Budget, Executor, ExecutorResult, Spend } from './supervise/types'

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

/** The default self-improvement LENS — authored content, not a code path. On each settled worker it hands
 *  the driver the still-FAILING tests (not just a score), so the next spawn targets the persistently-hard
 *  cases. Swap `analysts` to change what the driver improves from — that's the one knob. */
export function failuresAnalyst(): AnalystRegistry {
  return {
    kinds: [
      {
        id: 'failures',
        description: "Surface the worker's still-failing tests so the driver targets them next.",
        area: 'progress',
      },
    ],
    run: async (_kindId: string, trace: unknown) => {
      const w = (trace ?? {}) as Partial<SurfaceWorkerOut>
      if (!(typeof w === 'object' && w !== null && 'resolved' in w))
        return { summary: `worker produced: ${JSON.stringify(trace).slice(0, 300)}` }
      if (w.resolved) return { summary: 'worker RESOLVED — every check passed; stop.' }
      const failing = (w.failing ?? []) as readonly string[]
      const head = `worker did NOT resolve — score ${(100 * (w.score ?? 0)).toFixed(0)}%, ${w.shots ?? '?'} shot(s)`
      return {
        summary: failing.length
          ? `${head}. STILL FAILING (${failing.length}): ${failing.slice(0, 12).join(', ')}. Spawn the next worker to fix exactly these; if a test keeps failing across workers, give it concrete guidance about that case.`
          : `${head}. (no failing-test list available this round)`,
      }
    },
  }
}

/** How a worker runs the surface task (its router substrate + per-attempt bounds). */
export interface SurfaceWorkerConfig {
  readonly routerBaseUrl: string
  readonly routerKey: string
  readonly model: string
  readonly maxTokens?: number
  readonly innerTurns?: number
  /** Refine-shot budget for ONE worker attempt (max steered shots). Default 1. */
  readonly budget?: number
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
        budget: worker.budget ?? 1,
        routerBaseUrl: worker.routerBaseUrl,
        routerKey: worker.routerKey,
        model: worker.model,
        ...(worker.maxTokens !== undefined ? { maxTokens: worker.maxTokens } : {}),
        ...(worker.innerTurns !== undefined ? { innerTurns: worker.innerTurns } : {}),
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
  /** The conserved compute pool for the whole supervised run. Default: sized off the worker's inner-loop
   *  bounds for a handful of worker spawns — raise it to let the driver try more. */
  readonly budget?: Budget
  /** The driver brain's router substrate (its own inference). Default: the worker's router + model — the
   *  driver and workers share one router unless you separate them (e.g. a stronger driver model). */
  readonly router?: RouterConfig
  /** The self-improvement lens fed to the driver on each settled worker. Default `failuresAnalyst()`
   *  (target the still-failing tests). Pass a custom registry to change it, or `null` to turn the
   *  within-run self-improvement OFF (the driver sees raw settled outputs). */
  readonly analysts?: AnalystRegistry | null
  /** The strategy each worker runs over the surface. Default `refine` (iterate-with-feedback). */
  readonly strategy?: Strategy
  /** Max workers live at once. Default 1 (serial — required when workers share a persistent artifact, so
   *  they continue each other instead of racing the file). */
  readonly maxLiveWorkers?: number
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
  profile: SupervisorProfile,
  task: AgenticTask,
  opts: SuperviseSurfaceOptions,
): Promise<SuperviseSurfaceResult> {
  const strategy = opts.strategy ?? refine
  const innerTurns = opts.worker.innerTurns ?? 6
  // Default the driver to the worker's router (one router unless separated) and the pool to a handful of
  // worker spawns sized off the worker bounds — so the minimal call is
  // `superviseSurface(profile, task, { surface, worker })`.
  const router = opts.router ?? {
    routerBaseUrl: opts.worker.routerBaseUrl,
    routerKey: opts.worker.routerKey,
    model: opts.worker.model,
  }
  const budget = opts.budget ?? {
    maxIterations: (innerTurns + 2) * 5 + 16,
    maxTokens: (opts.worker.maxTokens ?? 4000) * 8,
  }

  // Every spawned worker is a BYO executor that runs the surface task; the deliverable is the completion
  // oracle (delivered ⟺ the surface check passed).
  const makeWorkerAgent: MakeWorkerAgent = (rawProfile) => {
    const p = (rawProfile ?? {}) as { name?: unknown }
    const name = typeof p.name === 'string' && p.name.length > 0 ? p.name : 'surface-worker'
    const spec: AgentSpec = {
      profile: rawProfile as AgentProfile,
      harness: null,
      executor: surfaceWorkerExecutor(
        opts.surface,
        task,
        opts.worker,
        strategy,
      ) as Executor<unknown>,
    }
    return { name, act: async () => '', executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
  const deliverable: DeliverableSpec<unknown> = {
    describe: `resolve the surface task ${task.id} (every required check passes)`,
    check: (out) => (out as SurfaceWorkerOut | undefined)?.resolved === true,
  }

  // `null` analysts → self-improvement off; otherwise default to the failures lens and fire every kind it
  // declares on each settled worker.
  const analysts = opts.analysts === null ? undefined : (opts.analysts ?? failuresAnalyst())

  const result = await supervise(profile, task, {
    makeWorkerAgent,
    deliverable,
    budget,
    maxLiveWorkers: opts.maxLiveWorkers ?? 1,
    // A SMALL per-worker reservation so MULTIPLE workers fit the pool (the default reserves the whole pool
    // per worker → only one ever spawns, defeating the spawn-a-targeted-worker steering).
    perWorker: { maxIterations: innerTurns + 2, maxTokens: opts.worker.maxTokens ?? 4000 },
    router,
    ...(analysts ? { analysts, analyzeOnSettle: analysts.kinds.map((k) => k.id) } : {}),
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
