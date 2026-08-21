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
import { OUTPUT_VALUE, type TraceAnalysisStore } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { AnalystRegistry, MakeWorkerAgent } from '../mcp/tools/coordination'
import type { RouterTransportConfig } from './router-client'
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
import { isTraceAnalysisStore } from './supervise/trace-evidence'
import { createPushTraceSource, type TraceSource } from './supervise/trace-source'
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

/** Instrument every real surface call with the shared push trace source. The last test report remains
 *  available on `SurfaceWorkerOut` for compatibility, but analysts read only the persisted spans. */
export function traceSurfaceCalls(base: AgenticSurface): {
  surface: AgenticSurface
  failing: () => string[]
  traceSource: TraceSource
} {
  let lastReport = ''
  const trace = createPushTraceSource()
  const surface: AgenticSurface = {
    name: base.name,
    open: (t) => base.open(t),
    tools: (t, h) => base.tools(t, h),
    async call(h, name, args) {
      const startedAt = Date.now()
      const recordedArgs = structuredClone(args)
      try {
        const out = await base.call(h, name, args)
        trace.record({
          toolName: name,
          args: recordedArgs,
          result: out,
          status: out.startsWith('ERROR:') ? 'error' : 'ok',
          startedAt,
          endedAt: Date.now(),
        })
        if (name === 'run_tests') lastReport = out
        return out
      } catch (error) {
        trace.record({
          toolName: name,
          args: recordedArgs,
          result: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
          status: 'error',
          startedAt,
          endedAt: Date.now(),
        })
        throw error
      }
    },
    score: (t, h) => base.score(t, h),
    close: (h) => base.close(h),
  }
  return { surface, failing: () => failingTestNames(lastReport), traceSource: trace.source }
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
    run: async (_kindId: string, trace: TraceAnalysisStore) => {
      if (!isTraceAnalysisStore(trace)) return missingRunTestsEvidence()
      const report = await latestRunTestsReport(trace)
      if (report === undefined) return missingRunTestsEvidence()
      const failing = failingTestNames(report)
      return {
        summary: failing.length
          ? `Latest structured run_tests evidence reports STILL FAILING (${failing.length}): ${failing.join(', ')}. Spawn the next worker to fix exactly these; if a test keeps failing across workers, give it concrete guidance about that case.`
          : allTestsPassed(report)
            ? 'Latest structured run_tests evidence reports every test passed; stop.'
            : `Latest structured run_tests evidence contains no parseable failing-test names. Refusing to infer them from worker prose. run_tests output: ${report.slice(0, 300)}`,
      }
    },
  }
}

async function latestRunTestsReport(store: TraceAnalysisStore): Promise<string | undefined> {
  const overview = await store.getOverview({ tool_names: ['run_tests'] })
  const candidates: Array<{ output: string; endedAt: string; ordinal: number }> = []
  let ordinal = 0
  for (const traceId of overview.sample_trace_ids) {
    const view = await store.viewTrace({ trace_id: traceId, per_attribute_byte_cap: 16_384 })
    let spans = view.spans
    if (spans === undefined) {
      const matches = await store.searchTrace({
        trace_id: traceId,
        regex_pattern: 'run_tests',
        max_matches: 100,
      })
      const spanIds = [
        ...new Set(
          matches.hits.filter((hit) => hit.span_name === 'run_tests').map((hit) => hit.span_id),
        ),
      ]
      spans = spanIds.length
        ? (
            await store.viewSpans({
              trace_id: traceId,
              span_ids: spanIds,
              per_attribute_byte_cap: 16_384,
            })
          ).spans
        : []
    }
    for (const span of spans) {
      if (span.tool_name !== 'run_tests') continue
      const output = span.attributes[OUTPUT_VALUE]
      if (typeof output !== 'string') continue
      candidates.push({ output, endedAt: span.end_time, ordinal: ordinal++ })
    }
  }
  candidates.sort(
    (left, right) =>
      Date.parse(left.endedAt) - Date.parse(right.endedAt) || left.ordinal - right.ordinal,
  )
  return candidates.at(-1)?.output
}

function failingTestNames(report: string): string[] {
  const body = /FAILING:\s*([^\n]+)/iu.exec(report)?.[1]
  if (body === undefined) return []
  return body
    .replace(/\.\s+COLLECTION-BLOCKED:.*$/iu, '')
    .replace(/\s*\(\+\d+\s+more\)\s*$/iu, '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

function allTestsPassed(report: string): boolean {
  const fraction = /(\d+)\s*\/\s*(\d+)\s+tests?\s+passed/iu.exec(report)
  return fraction !== null && Number(fraction[1]) === Number(fraction[2])
}

function missingRunTestsEvidence(): { summary: string } {
  return {
    summary:
      'Missing structured run_tests span evidence. Refusing to infer failing-test names from worker prose.',
  }
}

/** How a worker runs the surface task (its router substrate + per-attempt bounds). */
export interface SurfaceWorkerConfig {
  readonly routerBaseUrl: string
  readonly routerKey: string
  /** Exact worker behavior, tools, and model. */
  readonly profile: AgentProfile
  readonly analystProfile?: AgentProfile
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
  const traced = traceSurfaceCalls(surface)
  return {
    runtime: 'surface-worker',
    async execute(brief: unknown): Promise<ExecutorResult<SurfaceWorkerOut>> {
      const guidance = typeof brief === 'string' ? brief.trim() : brief ? JSON.stringify(brief) : ''
      const attemptTask: AgenticTask = guidance
        ? {
            ...task,
            userPrompt: `${task.userPrompt}\n\n— Supervisor guidance for THIS attempt (incorporate it; do not just repeat a prior approach) —\n${guidance}`,
          }
        : task
      const r = await runAgentic({
        surface: traced.surface,
        task: attemptTask,
        strategy,
        budget: worker.budget ?? 1,
        routerBaseUrl: worker.routerBaseUrl,
        routerKey: worker.routerKey,
        workerProfile: worker.profile,
        ...(worker.analystProfile ? { analystProfile: worker.analystProfile } : {}),
        ...(worker.innerTurns !== undefined ? { innerTurns: worker.innerTurns } : {}),
      })
      const out: SurfaceWorkerOut = {
        resolved: r.resolved,
        score: r.score,
        shots: r.shots,
        summary: `${strategy.name} ${r.shots} shot(s) → ${(100 * r.score).toFixed(0)}% (${r.resolved ? 'resolved' : 'unresolved'})`,
        failing: r.resolved ? [] : traced.failing(),
      }
      const spent: Spend = {
        iterations: r.completions,
        tokens: r.tokens,
        ...(r.tokensKnown ? {} : { tokensKnown: false }),
        usd: r.usd,
        ...(r.usdKnown ? {} : { usdKnown: false }),
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
    traceSource: () => traced.traceSource,
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
  /** The driver brain's Router endpoint/auth. Model and behavior remain owned by `profile`. */
  readonly router?: RouterTransportConfig
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
  const router: RouterTransportConfig = opts.router ?? {
    routerBaseUrl: opts.worker.routerBaseUrl,
    routerKey: opts.worker.routerKey,
  }
  const budget = opts.budget ?? {
    maxIterations: (innerTurns + 2) * 5 + 16,
    maxTokens: 1_000_000_000,
  }
  // A worker's share of the conserved pool. It is deliberately not read from the profile: the
  // profile's ceilings bound ONE completion, while this bounds everything a worker may spend.
  const workerMaxTokens = Math.max(1, Math.floor(budget.maxTokens / 8))

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
    perWorker: { maxIterations: innerTurns + 2, maxTokens: workerMaxTokens },
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
