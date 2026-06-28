/**
 * ablation — the cost-aware knob-board + one-knob-delta runner for agent self-improvement techniques.
 *
 * THE VISION: a single configurable agent where every technique is a knob (topology, trace-analysis,
 * steering, GEPA/skill optimization, persistent artifacts), swept across arms at EQUAL COMPUTE, with a
 * full autopsy — resolve rate AND token/$/latency cost per arm — so we see what really helps vs what
 * just burns tokens. One-knob-delta design (baseline + each single knob flipped) keeps it O(N), not 2^N.
 *
 * STATUS — honest: the framework + the cost autopsy are real; knobs are wired incrementally. WIRED:
 * `topology` (single/fanout/fanout-refine = refine/sample/sampleThenRefine) + `budget`; `driverSteer`
 * (the supervisor brain spawns + steers a graded worker, analyst up-leg on — via `selfImprovingSupervisor`)
 * and `optimize:'gepa'` (GEPA-tune the driver's compose-prompt on a DISJOINT train slice, freeze, then
 * drive — via `optimizeDriverPrompt`; implies `driverSteer`). STILL DECLARED + FAIL LOUD: `halo`,
 * `persistentArtifact` (no silent no-op — each names its substrate primitive in the throw). Note: the
 * driverSteer/optimize arms report real resolve + $ but NOT a per-token/latency breakdown (uncaptured,
 * not a real zero). Validate on the cheap contamination-proof task, THEN point `environment`/`tasks` at SWE-bench.
 */
import { pairedBootstrap } from '@tangle-network/agent-eval'
import {
  type AgenticSurface,
  type AgenticTask,
  refine,
  runAgentic,
  type Strategy,
  sample,
  sampleThenRefine,
} from '@tangle-network/agent-runtime/loops'
import { codingEnv, codingTasks } from '../self-improving-coder/self-improving-coder'
import { optimizeDriverPrompt } from './gepa-driver-prompt'
import { selfImprovingSupervisor } from './self-improving-supervisor'

/** The baseline driver/steerer standing instruction — the compose-next-prompt the GEPA pass mutates
 *  (its `baselinePrompt`) and the prompt the supervisor runs with when `optimize` is off. Kept terse:
 *  GEPA earns the lift, this is only the floor. */
const baselineDriverPrompt = [
  'You coordinate workers fixing ONE real bug. Your leverage over a single agent is making each attempt',
  'DIFFERENT and TARGETED, so the search covers ground that repeating one approach never will.',
  '',
  'Spawn ONE worker at a time, each with a SPECIFIC strategy in its brief, then await its settle and read',
  'the analyst finding. If it did NOT resolve, spawn the next worker with a DISTINCT strategy you have not',
  'tried — vary the HYPOTHESIS about where the bug is and how to fix it:',
  '- attempt 1: fix the most direct location the issue implies.',
  '- attempt 2: the root cause is likely UPSTREAM (a helper, base class, shared util) — look broader than',
  '  the obvious file.',
  '- attempt 3: the code is almost right but mishandles an EDGE CASE (empty/None/nested/boundary) — find',
  '  and fix that specific case.',
  '- later attempts: target a different module entirely, or combine what prior briefs implied.',
  '',
  'Every brief must be concrete and DISTINCT from prior ones — never "try again". Stop the instant a worker',
  'delivers (analyst reports resolved). Do not solve the bug yourself; propose diverse, targeted attempts.',
].join('\n')

export interface AblationKnobs {
  /** WIRED → strategy: single=`refine` (iterate one artifact), fanout=`sample` (N parallel, pick best),
   *  fanout-refine=`sampleThenRefine`. The coordination shape. */
  topology: 'single' | 'fanout' | 'fanout-refine'
  /** WIRED → equal-compute unit (refine: max shots; fanout: rollout width). */
  budget: number
  // ── DECLARED knobs — fail loud until wired (each over a named substrate primitive) ──
  /** The DRIVER-steers-WORKER loop: supervise() drives the worker, analyzeOnSettle fires the analyst on
   *  each settled round → a `finding` the driver pulls and composes the next prompt from. (NOT the
   *  refine analyst-steerer — that's the degenerate inline version; this is a driver brain in the loop.) */
  driverSteer?: boolean // supervise(driverProfile,{backend,analyzeOnSettle}) + steer_agent
  /** GEPA-optimize the DRIVER's compose-next-prompt system prompt on TRAIN (executable-graded via the
   *  surface score), frozen, then run — selfImprove() with an executable JudgeConfig (NOT improve(): the
   *  steerer prompt is not a profile field). */
  optimize?: 'off' | 'gepa'
  halo?: boolean // HALO analyst option
  persistentArtifact?: boolean // multi-round persistent artifact (openSandboxRun resume)
}

const topologyStrategy: Record<AblationKnobs['topology'], Strategy> = {
  single: refine,
  fanout: sample,
  'fanout-refine': sampleThenRefine,
}

/** Fail loud on a set-but-unwired knob — the house rule (no silent no-op). Names the primitive to wire. */
const unwiredKnobs: Array<{
  k: keyof AblationKnobs
  isSet: (v: unknown) => boolean
  prim: string
}> = [
  { k: 'halo', isSet: (v) => v === true, prim: 'HALO analyst option' },
  { k: 'persistentArtifact', isSet: (v) => v === true, prim: 'openSandboxRun resume' },
]

export interface ArmResult {
  name: string
  knobs: AblationKnobs
  n: number
  resolve: number // mean resolved (0..1) on the held-out set
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  shotsMean: number
  completionsMean: number
  /** Per-task resolved (0/1), task-aligned across arms — the paired vector for significance. */
  perTask: number[]
}

export async function runAblation(opts: {
  environment: AgenticSurface
  tasks: (offset: number, n: number) => Promise<AgenticTask[]>
  holdoutOffset: number
  holdoutN: number
  base: AblationKnobs
  /** Each delta = a ONE-KNOB change vs base (the one-knob-delta design). */
  deltas: Array<{ name: string; knob: Partial<AblationKnobs> }>
  worker: {
    routerBaseUrl: string
    routerKey: string
    model: string
    maxTokens?: number
    innerTurns?: number
  }
  /** The DRIVER brain's own router substrate (used by the `driverSteer`/`optimize` arms). Defaults to
   *  the worker's router + model. The supervisor's inference is separate compute from the worker's, so
   *  it carries its own model knob. */
  supervisor?: {
    routerBaseUrl?: string
    routerKey?: string
    model?: string
    /** Reflection model for the GEPA optimize pass (defaults to the supervisor/worker model). */
    reflectionModel?: string
  }
  onArm?: (r: ArmResult) => void
}): Promise<ArmResult[]> {
  // ONE held-out set, shared across all arms — the fair-comparison invariant.
  const tasks = await opts.tasks(opts.holdoutOffset, opts.holdoutN)
  const arms = [
    { name: 'baseline', knobs: opts.base },
    ...opts.deltas.map((d) => ({
      name: d.name,
      knobs: { ...opts.base, ...d.knob } as AblationKnobs,
    })),
  ]
  // The driver brain's router substrate (the `driverSteer`/`optimize` arms) — defaults to the worker's
  // router + model. The supervisor's inference is separate compute from the worker's.
  const supervisorRouter = {
    baseUrl: opts.supervisor?.routerBaseUrl ?? opts.worker.routerBaseUrl,
    apiKey: opts.supervisor?.routerKey ?? opts.worker.routerKey,
    model: opts.supervisor?.model ?? opts.worker.model,
  }
  const results: ArmResult[] = []
  for (const arm of arms) {
    for (const u of unwiredKnobs) {
      if (u.isSet(arm.knobs[u.k]))
        throw new Error(
          `ablation: knob '${u.k}'=${JSON.stringify(arm.knobs[u.k])} (arm "${arm.name}") is DECLARED but not yet wired — wire it over ${u.prim} before claiming it ran. (No silent no-op.)`,
        )
    }
    // `optimize` implies `driverSteer`: a tuned compose-prompt only has effect through the driver loop.
    const driverSteer = arm.knobs.driverSteer === true || arm.knobs.optimize === 'gepa'

    // The `optimize:'gepa'` knob: BEFORE the held-out arm runs, GEPA-tune the driver's compose-prompt on
    // a DISJOINT train slice (offset past the held-out window so train ∩ holdout = ∅), freeze the winner,
    // and use it for this arm's driverSteer runs. Off → the baseline standing prompt drives the loop.
    let driverPrompt = baselineDriverPrompt
    let gepaUsd = 0
    if (arm.knobs.optimize === 'gepa') {
      const opt = await optimizeDriverPrompt({
        surface: opts.environment,
        tasks: opts.tasks,
        trainOffset: opts.holdoutOffset + opts.holdoutN,
        trainN: opts.holdoutN,
        baselinePrompt: baselineDriverPrompt,
        // Match the DEPLOYMENT regime: the same per-worker refine budget AND the same supervisor brain
        // the held-out arm runs with — else the prompt is tuned against a different model/compute.
        worker: { ...opts.worker, budget: arm.knobs.budget },
        supervisorRouter,
        ...(opts.supervisor?.reflectionModel !== undefined
          ? { reflectionModel: opts.supervisor.reflectionModel }
          : {}),
      })
      driverPrompt = opt.systemPrompt
      gepaUsd = opt.usd // the TRAIN-side GEPA cost, counted into this arm's $ (the fair-cost invariant)
      console.log(
        `ablation: arm "${arm.name}" GEPA driver-prompt ${opt.shipped ? 'SHIPPED' : 'kept-baseline'} (train lift ${(100 * opt.lift).toFixed(0)}pp)`,
      )
    }

    let resolved = 0
    let ti = 0
    let to = 0
    let usd = gepaUsd // seed with the TRAIN-side GEPA optimization cost so the arm's $ is honest
    let ms = 0
    let shots = 0
    let comps = 0
    const perTask: number[] = []
    for (const t of tasks) {
      try {
        if (driverSteer) {
          // The driver-steered path: the supervisor brain spawns + steers a graded worker on a conserved
          // pool, with the analyst up-leg on. `selfImprovingSupervisor` reports the deployable outcome +
          // the FULL conserved spend (driver inference + all worker work: $, tokens, latency). `shots`
          // stays 0 — a multi-worker supervised run has no single refine-shot count (N/A, not a real zero).
          const sup = await selfImprovingSupervisor({
            surface: opts.environment,
            task: t,
            driverPrompt,
            worker: {
              routerBaseUrl: opts.worker.routerBaseUrl,
              routerKey: opts.worker.routerKey,
              model: opts.worker.model,
              ...(opts.worker.maxTokens !== undefined ? { maxTokens: opts.worker.maxTokens } : {}),
              ...(opts.worker.innerTurns !== undefined
                ? { innerTurns: opts.worker.innerTurns }
                : {}),
              budget: arm.knobs.budget,
            },
            budget: {
              // Pool for the driver's turns PLUS several worker spawns (each reserves ~innerTurns+2
              // iterations) so the analyst up-leg can drive a spawn-refine loop, not stall after one
              // worker. The autopsy measures the real cost; this is intentionally not equal-k.
              maxIterations: arm.knobs.budget * ((opts.worker.innerTurns ?? 6) + 2) + 16,
              maxTokens: (opts.worker.maxTokens ?? 4000) * Math.max(4, arm.knobs.budget * 3),
            },
            analyze: true,
            router: supervisorRouter,
          })
          if (sup.resolved) resolved++
          perTask.push(sup.resolved ? 1 : 0)
          usd += sup.usd
          ti += sup.tokensIn
          to += sup.tokensOut
          ms += sup.ms
        } else {
          const r = await runAgentic({
            surface: opts.environment,
            task: t,
            strategy: topologyStrategy[arm.knobs.topology],
            budget: arm.knobs.budget,
            routerBaseUrl: opts.worker.routerBaseUrl,
            routerKey: opts.worker.routerKey,
            model: opts.worker.model,
            ...(opts.worker.maxTokens !== undefined ? { maxTokens: opts.worker.maxTokens } : {}),
            ...(opts.worker.innerTurns !== undefined ? { innerTurns: opts.worker.innerTurns } : {}),
          })
          if (r.resolved) resolved++
          perTask.push(r.resolved ? 1 : 0)
          ti += r.tokens.input
          to += r.tokens.output
          usd += r.usd
          ms += r.ms
          shots += r.shots
          comps += r.completions
        }
      } catch (e) {
        // One task throw (network/quota/etc.) must not lose the whole arm's accumulated data:
        // count it as unresolved and keep going so the arm returns partial results. Warn loud.
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(
          `ablation: arm "${arm.name}" task "${t.id}" failed (counted unresolved): ${msg}`,
        )
        perTask.push(0)
      }
    }
    const n = tasks.length
    const res: ArmResult = {
      name: arm.name,
      knobs: arm.knobs,
      n,
      resolve: resolved / n,
      tokensIn: ti,
      tokensOut: to,
      costUsd: usd,
      latencyMs: ms,
      shotsMean: shots / n,
      completionsMean: comps / n,
      perTask,
    }
    results.push(res)
    opts.onArm?.(res)
  }
  return results
}

/** The cost-aware autopsy: per-arm resolve + tokens + $ + latency, and Δ vs baseline (lift AND cost). */
export function printAutopsy(results: ArmResult[]): void {
  const base = results[0]
  const pad = (s: string, n: number) => s.padEnd(n)
  console.log(`\n═══ ABLATION AUTOPSY (n=${base?.n} held-out, one-knob-delta vs baseline) ═══`)
  console.log(
    pad('arm', 16) +
      pad('topology', 14) +
      pad('resolve', 9) +
      pad('$', 9) +
      pad('lat(s)', 8) +
      pad('shots', 7) +
      pad('Δresolve [95% CI]', 24) +
      'Δ$',
  )
  for (const r of results) {
    const dC = base ? r.costUsd - base.costUsd : 0
    // Significance: paired bootstrap of this arm's per-task resolve vs baseline's (task-aligned).
    let lift = '+0pp'
    if (base && r !== base) {
      const b = pairedBootstrap(base.perTask, r.perTask, { confidence: 0.95, statistic: 'mean' })
      const sig = b.low > 0 || b.high < 0 ? '✓' : '·' // CI excludes 0 ⇒ real
      lift = `${b.mean >= 0 ? '+' : ''}${(100 * b.mean).toFixed(0)}pp [${(100 * b.low).toFixed(0)},${(100 * b.high).toFixed(0)}] ${sig}`
    }
    console.log(
      pad(r.name, 16) +
        pad(r.knobs.topology, 14) +
        pad(`${(100 * r.resolve).toFixed(0)}%`, 9) +
        pad(`$${r.costUsd.toFixed(4)}`, 9) +
        pad((r.latencyMs / 1000).toFixed(0), 8) +
        pad(r.shotsMean.toFixed(1), 7) +
        pad(lift, 24) +
        `${dC >= 0 ? '+' : ''}$${dC.toFixed(4)}`,
    )
  }
  console.log(
    '\n>>> Read it cost-aware: ✓ = CI excludes 0 (real lift). A +resolve that costs +$$ or is not ✓ may be worse than baseline. The point is to see what HELPS vs what just BURNS.',
  )
}

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('TANGLE_API_KEY required')
  const worker = {
    routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey,
    model: process.env.WORKER_MODEL ?? 'deepseek-v4-flash',
    maxTokens: 4000,
    innerTurns: Number(process.env.INNER_TURNS ?? 6),
  }
  const supervisor = {
    model: process.env.SUPERVISOR_MODEL ?? worker.model,
    reflectionModel: process.env.REFLECTION_MODEL ?? 'gemini-2.5-pro',
  }
  console.log(
    `═══ ABLATION (cheap contamination-proof task) — worker=${worker.model} driver=${supervisor.model} ═══`,
  )
  const results = await runAblation({
    environment: codingEnv,
    tasks: codingTasks,
    holdoutOffset: 100, // a fixed disjoint held-out slice
    holdoutN: Number(process.env.HOLDOUT_N ?? 6),
    base: { topology: 'single', budget: Number(process.env.BUDGET ?? 2) },
    // one-knob-delta: flip ONLY one knob vs baseline. topology is the cheap free arm; driverSteer adds
    // the driver brain; optimize tunes that brain's compose-prompt on a disjoint train slice first.
    deltas: [
      { name: 'fanout', knob: { topology: 'fanout' } },
      { name: 'fanout-refine', knob: { topology: 'fanout-refine' } },
      { name: 'driver-steer', knob: { driverSteer: true } },
      { name: 'driver-gepa', knob: { optimize: 'gepa' } },
    ],
    worker,
    supervisor,
    onArm: (r) =>
      console.log(
        `  ${r.name}: ${(100 * r.resolve).toFixed(0)}% resolve, $${r.costUsd.toFixed(4)}, ${(r.latencyMs / 1000).toFixed(0)}s`,
      ),
  })
  printAutopsy(results)
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
    process.exit(1)
  })
