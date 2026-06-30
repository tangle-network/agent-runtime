/**
 * selfImprovingSupervisor — NOT a separate primitive: it is `supervise()` configured for a graded coding
 * surface. The ONE entrypoint is `supervise(profile, task, opts)`; this recipe just wires the pieces a
 * coding task needs and picks the analyst lens:
 *
 *   surfaceWorkerSeam   → WHERE the worker runs + the completion oracle ("settled ⟺ delivered")
 *   supervise()         → the LLM driver brain that spawns + steers workers on a conserved budget
 *   failuresAnalyst     → the SELF-IMPROVEMENT, as AUTHORED CONTENT (not a code path): on each settled
 *                          worker it hands the driver the still-failing tests, so the next spawn targets
 *                          the persistently-hard cases. "Self-improving" lives in this lens — swap the
 *                          analyst to change what the driver learns from.
 *
 * Two timescales, one entrypoint each. WITHIN a run, the driver self-improves its briefs from the analyst
 * (here). ACROSS runs, wrap this call in `improve()`/`selfImprove` to optimize the driver PROFILE on a
 * held-out set (gepa-driver-prompt.ts) — separate by design, because one task has no held-out set to
 * certify generalization. `analyze` flips the within-run up-leg on/off (off → the driver sees raw outputs).
 */
import {
  type AgenticSurface,
  type AgenticTask,
  type SupervisorProfile,
  supervise,
} from '@tangle-network/agent-runtime/loops'
import { type SurfaceWorkerOut, surfaceWorkerSeam } from './surface-worker'

export interface SelfImprovingSupervisorOptions {
  /** The agentic surface the worker acts on (grading + task generation live here). */
  readonly surface: AgenticSurface
  /** The single graded task the supervisor must resolve. */
  readonly task: AgenticTask
  /** The driver brain's standing instruction — the optimized prompt from the GEPA pass, or a baseline. */
  readonly driverPrompt: string
  /** WHERE the worker runs (router substrate + model + inner-loop bounds). Threaded to the seam. */
  readonly worker: {
    readonly routerBaseUrl: string
    readonly routerKey: string
    readonly model: string
    readonly maxTokens?: number
    readonly innerTurns?: number
    readonly budget?: number
  }
  /** The conserved compute pool for the whole supervised run. */
  readonly budget: { readonly maxIterations: number; readonly maxTokens: number }
  /** Flip the self-improving up-leg on: feed the driver a one-line analyst read of each settled worker. */
  readonly analyze?: boolean
  /** The supervisor brain's router substrate (the driver's own inference). */
  readonly router: { readonly baseUrl: string; readonly apiKey: string; readonly model: string }
}

/** The self-improvement LENS — authored content, not a primitive. This is the whole "self-improving" in
 *  `selfImprovingSupervisor`: `supervise()` already fires an analyst on each settled worker (`analyzeOnSettle`);
 *  this lens decides WHAT the driver learns from it. It hands the driver the worker's still-FAILING tests
 *  (not just a score), so the next spawn can target the persistently-hard cases — real-time, within-run
 *  self-improvement. Swap this function to change what the driver improves from; that's the one knob. */
export function failuresAnalyst() {
  return {
    kinds: [
      {
        id: 'failures',
        description: "Surface the worker's still-failing tests so the driver targets them next.",
        area: 'progress',
      },
    ],
    run: async (_kindId: string, trace: unknown) => {
      // `trace` is the worker's settled blob — a SurfaceWorkerOut. Read its real fields (String(obj) is
      // the useless '[object Object]') and lead with the failing-test list, the targetable signal.
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

/** Run the driver-steered supervisor over one graded task and report the deployable outcome:
 *  `resolved` (a winner delivered), `score` ([0,1] from the completion verdict), and `usd` (the real
 *  conserved spend — paid even on a no-winner). */
export async function selfImprovingSupervisor(opts: SelfImprovingSupervisorOptions): Promise<{
  resolved: boolean
  score: number
  usd: number
  tokensIn: number
  tokensOut: number
  ms: number
  /** Total conserved-pool iterations = the driver+worker LLM rounds this supervised run actually spent. */
  completions: number
}> {
  const seam = surfaceWorkerSeam({
    surface: opts.surface,
    task: opts.task,
    worker: opts.worker,
  })

  const profile: SupervisorProfile = { name: 'driver', systemPrompt: opts.driverPrompt }

  // Size the per-worker reservation so MULTIPLE workers fit the conserved pool. The default reserves
  // the WHOLE iteration pool per worker (supervise.defaultPerWorker forwards budget.maxIterations
  // unchanged), so only one worker ever spawns — which would defeat the spawn-a-refined-worker steering
  // the analyst up-leg exists to drive. A small per-worker iteration slice lets the driver re-spawn.
  const perWorkerIters = (opts.worker.innerTurns ?? 6) + 2

  const result = await supervise(profile, opts.task, {
    makeWorkerAgent: seam.makeWorkerAgent,
    deliverable: seam.deliverable,
    budget: opts.budget,
    // Serialize workers: with a persistent (shared) workspace, concurrent workers race on the same file
    // and corrupt it; serial is also exactly what build-on-progress needs (worker N+1 CONTINUES worker N).
    maxLiveWorkers: 1,
    perWorker: { maxIterations: perWorkerIters, maxTokens: opts.worker.maxTokens ?? 4000 },
    router: {
      routerBaseUrl: opts.router.baseUrl,
      routerKey: opts.router.apiKey,
      model: opts.router.model,
    },
    ...(opts.analyze
      ? { analysts: failuresAnalyst(), analyzeOnSettle: ['failures'] as const }
      : {}),
  })

  // The supervise winner carries the driver's finalize output (the best-delivered worker's blob), NOT a
  // verdict field — read the real surface-checked score/resolved off that SurfaceWorkerOut.
  const out = result.kind === 'winner' ? (result.out as SurfaceWorkerOut | undefined) : undefined
  const resolved = out?.resolved ?? false
  const score = out?.score ?? 0
  // Report the FULL conserved spend (driver inference + all worker work) so the cost-aware ablation has
  // real token + latency columns for this arm, not fake zeros.
  const sp = result.spentTotal
  return {
    resolved,
    score,
    usd: sp.usd,
    tokensIn: sp.tokens.input,
    tokensOut: sp.tokens.output,
    ms: sp.ms,
    completions: sp.iterations,
  }
}
