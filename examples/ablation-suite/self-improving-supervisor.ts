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
import { surfaceWorkerSeam } from './surface-worker'

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
    run: async (_kindId: string, trace: unknown) => ({
      summary: `worker produced: ${String(trace).slice(0, 400)}`,
    }),
  }
}

/** Run the driver-steered supervisor over one graded task and report the deployable outcome:
 *  `resolved` (a winner delivered), `score` ([0,1] from the completion verdict), and `usd` (the real
 *  conserved spend — paid even on a no-winner). */
export async function selfImprovingSupervisor(
  opts: SelfImprovingSupervisorOptions,
): Promise<{ resolved: boolean; score: number; usd: number }> {
  const seam = surfaceWorkerSeam({
    surface: opts.surface,
    task: opts.task,
    worker: opts.worker,
  })

  const profile: SupervisorProfile = { name: 'driver', systemPrompt: opts.driverPrompt }

  const result = await supervise(profile, opts.task, {
    makeWorkerAgent: seam.makeWorkerAgent,
    deliverable: seam.deliverable,
    budget: opts.budget,
    router: {
      routerBaseUrl: opts.router.baseUrl,
      routerKey: opts.router.apiKey,
      model: opts.router.model,
    },
    ...(opts.analyze
      ? { analysts: progressAnalyst(), analyzeOnSettle: ['progress'] as const }
      : {}),
  })

  const resolved = result.kind === 'winner'
  const score = result.kind === 'winner' ? (result.verdict?.score ?? 0) : 0
  return { resolved, score, usd: result.spentTotal.usd }
}
