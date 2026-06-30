/**
 * surface-worker — the GRADED-worker seam for the self-improving supervisor.
 *
 * `supervise()` spawns workers by resolving a profile through `makeWorkerAgent` to an `Agent` whose
 * `executorSpec` carries a leaf `Executor`. This seam makes that worker actually WORK the
 * `AgenticSurface` task: each spawned worker runs ONE `runAgentic({ surface, task, strategy: refine })`
 * — the canonical depth tool loop over the surface — and settles with the surface's score as its
 * verdict. So the driver can spawn/steer workers and read a real, surface-checked result, not a
 * self-report.
 *
 * The paired `deliverable` is the completion oracle: settled ⟺ resolved. A worker that ran but
 * didn't drive the artifact to its final checked state settles `valid:false`, so a keep-best driver
 * never counts it as done (the Foreman 0/18 lesson — "done" means the check passed).
 *
 * The driver's brief is THREADED into each attempt (appended to the surface task's standing prompt), so
 * the supervisor's steering reaches the worker: a re-spawn after a failure can take a different, targeted
 * angle rather than an identical refine retry. The driver's intelligence is therefore BOTH allocation
 * (how many workers, when to stop) AND per-worker instruction authoring (the proposer profile).
 */

import type {
  Agent,
  AgentProfile,
  AgentSpec,
  Executor,
  ExecutorResult,
  Spend,
} from '@tangle-network/agent-runtime/loops'
import {
  type AgenticSurface,
  type AgenticTask,
  type DeliverableSpec,
  type MakeWorkerAgent,
  refine,
  runAgentic,
} from '@tangle-network/agent-runtime/loops'

/** What the worker executor settles with — the surface verdict the driver + deliverable read.
 *  `resolved` is the surface check's pass/fail (settled ⟺ resolved); `score` is the partial-credit
 *  fraction; the rest is a short human summary for traces/reports. */
export interface SurfaceWorkerOut {
  readonly resolved: boolean
  readonly score: number
  readonly shots: number
  readonly summary: string
  /** The tests this worker left FAILING (from its last run_tests), so the analyst can hand the driver a
   *  targeted read — "still failing: X, Y" — not just a score. Empty when resolved or no run_tests tool. */
  readonly failing?: readonly string[]
}

/** Wrap a surface so the worker's LAST `run_tests` output is remembered — the source of the failing-test
 *  list the analyst surfaces to the driver. Transparent passthrough for every other call; local to the
 *  seam (not a global wrapper), so it adds no surface-zoo concept. */
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

export interface SurfaceWorkerOptions {
  readonly surface: AgenticSurface
  readonly task: AgenticTask
  readonly worker: {
    readonly routerBaseUrl: string
    readonly routerKey: string
    readonly model: string
    readonly maxTokens?: number
    readonly innerTurns?: number
    /** refine shot budget for ONE worker attempt (max steered shots). Defaults to 1. */
    readonly budget?: number
  }
}

/** One spawned worker = one `runAgentic` refine attempt over the surface task. The result is cached on
 *  first `execute` and read back by `resultArtifact()` (the replay source the scope journals). */
function surfaceWorkerExecutor(opts: SurfaceWorkerOptions): Executor<SurfaceWorkerOut> {
  const { surface, task, worker } = opts
  let artifact: ExecutorResult<SurfaceWorkerOut> | undefined
  return {
    runtime: 'surface-worker',
    // Thread the driver's brief (the spawn instruction) into THIS attempt: the supervisor's steering
    // reaches the worker as targeted guidance appended to the surface task's standing prompt — so a
    // re-spawn after a failure can actually be DIFFERENT (a new angle / a fix for what went wrong),
    // not an identical refine retry. `runAgentic` stamps real tokens/usd/ms; we forward those as Spend.
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
        strategy: refine,
        budget: worker.budget ?? 1,
        routerBaseUrl: worker.routerBaseUrl,
        routerKey: worker.routerKey,
        model: worker.model,
        ...(worker.maxTokens !== undefined ? { maxTokens: worker.maxTokens } : {}),
        ...(worker.innerTurns !== undefined ? { innerTurns: worker.innerTurns } : {}),
      })
      const failing = r.resolved ? [] : cap.failing()
      const out: SurfaceWorkerOut = {
        resolved: r.resolved,
        score: r.score,
        shots: r.shots,
        summary: `refine ${r.shots} shot(s) → ${(100 * r.score).toFixed(0)}% (${
          r.resolved ? 'resolved' : 'unresolved'
        })`,
        failing,
      }
      const spent: Spend = {
        iterations: r.completions,
        tokens: r.tokens,
        usd: r.usd,
        ms: r.ms,
      }
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

/**
 * Build the graded-worker seam: a `makeWorkerAgent` `supervise()` spawns through, and the matching
 * `deliverable` (settled ⟺ resolved). Hand both to `supervise(profile, intent, { makeWorkerAgent,
 * deliverable, budget })` — every spawned worker then works the surface task and settles with the
 * surface-checked verdict.
 */
export function surfaceWorkerSeam(opts: SurfaceWorkerOptions): {
  makeWorkerAgent: MakeWorkerAgent
  deliverable: DeliverableSpec<unknown>
} {
  const makeWorkerAgent: MakeWorkerAgent = (rawProfile) => {
    const p = (rawProfile ?? {}) as { name?: unknown }
    const name = typeof p.name === 'string' && p.name.length > 0 ? p.name : 'surface-worker'
    // harness:null is unused — the BYO `executor` overrides harness resolution entirely (the scope
    // resolves a BYO `spec.executor` first). `act` is never called for a spawned child.
    const spec: AgentSpec = {
      profile: rawProfile as AgentProfile,
      harness: null,
      executor: surfaceWorkerExecutor(opts) as Executor<unknown>,
    }
    return { name, act: async () => '', executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }

  // The completion oracle: DELIVERED ⟺ the worker resolved the surface check. The driver's keep-best
  // / stop decision rides on this `valid`, never on a worker self-report.
  const deliverable: DeliverableSpec<unknown> = {
    describe: `resolve the surface task ${opts.task.id} (every required check passes)`,
    check: (out) => (out as SurfaceWorkerOut | undefined)?.resolved === true,
  }

  return { makeWorkerAgent, deliverable }
}
