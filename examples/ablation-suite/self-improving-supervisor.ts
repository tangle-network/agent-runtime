/**
 * self-improving-supervisor — the one-call DX recipe for the driver-steered supervisor over a graded
 * task. It composes three already-built seams instead of hand-wiring a loop:
 *
 *   surfaceWorkerSeam   → WHERE the worker runs + the completion oracle that makes "settled ⟺ delivered"
 *   supervise()         → the LLM driver brain that spawns + steers the worker on a conserved budget
 *   analysts/onSettle   → the self-improving UP-leg: when a worker settles, an analyst reads its output
 *                          and re-enters a short `finding` the driver composes its next steer from
 *
 * `analyze` is the one knob that flips the up-leg on: off → the driver sees raw settled outputs; on →
 * the driver also receives a one-line analyst read of each settled worker (the steer firewall stays in
 * the analyst registry — the analyst summarizes, it never decides the verdict).
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

/** The minimal one-lens registry used only when `analyze` is on: a single `progress` lens that reads
 *  the worker's settled output and hands the driver a short summary (the up-leg). It declares its kind
 *  so `analyzeOnSettle:['progress']` resolves, and its `run` returns the `{ summary }` read. The shape
 *  is validated structurally against `supervise`'s `analysts` option at the call site. */
function progressAnalyst() {
  return {
    kinds: [
      {
        id: 'progress',
        description: "Summarize the worker's settled output for the driver's next steer.",
        area: 'progress',
      },
    ],
    run: async (_kindId: string, trace: unknown) => {
      // `trace` is the worker's settled blob — a SurfaceWorkerOut object. `String(obj)` yields the
      // useless literal '[object Object]', so read the real fields into the driver's next-steer context.
      const w = (trace ?? {}) as Partial<SurfaceWorkerOut>
      const summary =
        typeof w === 'object' && w !== null && 'resolved' in w
          ? `worker ${w.resolved ? 'RESOLVED' : 'did NOT resolve'} — score ${(100 * (w.score ?? 0)).toFixed(0)}%, ${w.shots ?? '?'} shot(s)${w.summary ? `: ${w.summary}` : ''}`
          : `worker produced: ${JSON.stringify(trace).slice(0, 400)}`
      return { summary }
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
      ? { analysts: progressAnalyst(), analyzeOnSettle: ['progress'] as const }
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
