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
 * (the supervisor brain spawns + steers a graded worker, analyst up-leg on — via `superviseSurface`)
 * and `optimize:'gepa'` (GEPA-tune the driver's compose-prompt on a DISJOINT train slice, freeze, then
 * drive — via `optimizeDriverPrompt`; implies `driverSteer`). STILL DECLARED + FAIL LOUD: `halo`,
 * `persistentArtifact` (no silent no-op — each names its substrate primitive in the throw). EVERY arm now
 * reports the full column set — resolve, tokens in/out, LLM calls (completions), refine-shots, $, latency —
 * and per-tool call counts when the environment is wrapped in `countingSurface`. Validate on the cheap
 * contamination-proof task, THEN point `environment`/`tasks` at a real library or SWE-bench.
 */
import { pairedBootstrap } from '@tangle-network/agent-eval'
import {
  type AgenticSurface,
  type AgenticTask,
  failuresAnalyst,
  refine,
  runAgentic,
  type Strategy,
  sample,
  sampleThenRefine,
  superviseSurface,
} from '@tangle-network/agent-runtime/loops'
import { codingEnv, codingTasks } from '../self-improving-coder/self-improving-coder'
import { countingSurface } from './counting-surface'
import { optimizeDriverPrompt } from './gepa-driver-prompt'
import { ralph } from './ralph-strategy'

/** The baseline driver/steerer standing instruction — the compose-next-prompt the GEPA pass mutates
 *  (its `baselinePrompt`) and the prompt the supervisor runs with when `optimize` is off. Kept terse:
 *  GEPA earns the lift, this is only the floor. */
const baselineDriverPrompt = [
  'You coordinate workers solving ONE coding task. Each worker reads the tests, writes the solution, runs the',
  'tests itself, and fixes failures. Your job is to ADD attempts and TARGET the hard part — never to push a',
  'worker off a correct approach toward a worse one.',
  '',
  'Spawn a worker and let it solve the task thoroughly with run_tests. When it settles WITHOUT all tests',
  "passing, the analyst hands you the worker's STILL-FAILING tests by name. Spawn a FRESH worker (clean",
  'context) and put those specific failing tests in its brief. TRACK which tests keep failing across MULTIPLE',
  'workers — those are the genuinely hard cases; give the next worker concrete guidance about exactly those',
  '(what the test expects, the edge case it probes). A fresh worker with a targeted brief clears a stall a',
  'tired context cannot. Stop the instant a worker passes every test. Do not solve the task yourself.',
].join('\n')

export interface AblationKnobs {
  /** WIRED → strategy: single=`refine` (iterate one artifact), fanout=`sample` (N parallel, pick best),
   *  fanout-refine=`sampleThenRefine`. The coordination shape. */
  topology: 'single' | 'fanout' | 'fanout-refine' | 'ralph'
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
  ralph,
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
  resolve: number // mean resolved (0..1) on the held-out set — binary all-tests-pass
  scoreMean: number // mean pass-FRACTION [0,1] — the gradient when a task is not fully solved
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  shotsMean: number
  completionsMean: number
  /** Per-tool invocation counts across the arm (populated when the environment is wrapped in
   *  `countingSurface`); undefined when tool counting is not wired for that run. */
  toolCalls?: Record<string, number>
  /** Per-task resolved (0/1), task-aligned across arms — the paired vector for binary significance. */
  perTask: number[]
  /** Per-task pass-FRACTION [0,1], task-aligned — the paired vector for score significance (use this when
   *  the task is hard enough that binary resolve is mostly 0). */
  perTaskScore: number[]
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
  // Wrap the env ONCE so every arm's per-tool call counts are captured (reset per arm below). The GEPA
  // train pass deliberately uses the raw `opts.environment` so its disjoint-slice calls are NOT counted
  // into the held-out arm's tally.
  const counter = countingSurface(opts.environment)
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
    let scoreSum = 0
    let ti = 0
    let to = 0
    let usd = gepaUsd // seed with the TRAIN-side GEPA optimization cost so the arm's $ is honest
    let ms = 0
    let shots = 0
    let comps = 0
    const perTask: number[] = []
    const perTaskScore: number[] = []
    counter.resetToolCounts()
    for (const t of tasks) {
      try {
        if (driverSteer) {
          // The driver-steered path: the supervisor brain spawns + steers a graded worker on a conserved
          // pool, with the analyst up-leg on. `superviseSurface` reports the deployable outcome +
          // the FULL conserved spend (driver inference + all worker work: $, tokens, latency). `shots`
          // stays 0 — a multi-worker supervised run has no single refine-shot count (N/A, not a real zero).
          const sup = await superviseSurface({ name: 'driver', systemPrompt: driverPrompt }, t, {
            surface: counter,
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
              // iterations) so the spawn-targeted-worker loop runs, not stall after one. The autopsy
              // measures the real cost; this is intentionally not equal-k.
              maxIterations: arm.knobs.budget * ((opts.worker.innerTurns ?? 6) + 2) + 16,
              maxTokens: (opts.worker.maxTokens ?? 4000) * Math.max(4, arm.knobs.budget * 3),
            },
            router: {
              routerBaseUrl: supervisorRouter.baseUrl,
              routerKey: supervisorRouter.apiKey,
              model: supervisorRouter.model,
            },
            analysts: failuresAnalyst(),
          })
          if (sup.resolved) resolved++
          scoreSum += sup.score
          perTask.push(sup.resolved ? 1 : 0)
          perTaskScore.push(sup.score)
          usd += sup.usd
          ti += sup.tokensIn
          to += sup.tokensOut
          ms += sup.ms
          comps += sup.completions
        } else {
          const r = await runAgentic({
            surface: counter,
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
          scoreSum += r.score
          perTask.push(r.resolved ? 1 : 0)
          perTaskScore.push(r.score)
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
        perTaskScore.push(0)
      }
    }
    const n = tasks.length
    const res: ArmResult = {
      name: arm.name,
      knobs: arm.knobs,
      n,
      resolve: resolved / n,
      scoreMean: scoreSum / n,
      tokensIn: ti,
      tokensOut: to,
      costUsd: usd,
      latencyMs: ms,
      shotsMean: shots / n,
      completionsMean: comps / n,
      toolCalls: { ...counter.toolCounts },
      perTask,
      perTaskScore,
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
  console.log(
    `\n═══ ABLATION AUTOPSY (n=${base?.n} held-out, one-knob-delta vs baseline) — ALL metrics ═══`,
  )
  console.log(
    pad('arm', 15) +
      pad('topology', 13) +
      pad('resolve', 11) +
      pad('score', 7) +
      pad('tok_in', 9) +
      pad('tok_out', 9) +
      pad('calls', 7) +
      pad('shots', 7) +
      pad('$tot', 9) +
      pad('$/task', 8) +
      pad('lat/task', 9) +
      'Δresolve [95% CI]',
  )
  for (const r of results) {
    const k = Math.round(r.resolve * r.n)
    // Significance: paired bootstrap of this arm's per-task resolve vs baseline's (task-aligned).
    let lift = '— (baseline)'
    if (base && r !== base) {
      const b = pairedBootstrap(base.perTask, r.perTask, { confidence: 0.95, statistic: 'mean' })
      const sig = b.low > 0 || b.high < 0 ? '✓SIG' : '·ns'
      lift = `${b.mean >= 0 ? '+' : ''}${(100 * b.mean).toFixed(0)}pp [${(100 * b.low).toFixed(0)},${(100 * b.high).toFixed(0)}] ${sig}`
    }
    console.log(
      pad(r.name, 15) +
        pad(r.knobs.topology, 13) +
        pad(`${(100 * r.resolve).toFixed(0)}% ${k}/${r.n}`, 11) +
        pad(r.scoreMean.toFixed(2), 7) +
        pad(String(Math.round(r.tokensIn)), 9) +
        pad(String(Math.round(r.tokensOut)), 9) +
        pad(r.completionsMean.toFixed(1), 7) +
        pad(r.shotsMean.toFixed(1), 7) +
        pad(`$${r.costUsd.toFixed(3)}`, 9) +
        pad(`$${(r.costUsd / Math.max(1, r.n)).toFixed(3)}`, 8) +
        pad(`${(r.latencyMs / 1000 / Math.max(1, r.n)).toFixed(0)}s`, 9) +
        lift,
    )
    if (r.toolCalls && Object.keys(r.toolCalls).length > 0)
      console.log(
        `${pad('', 15)}tools: ${Object.entries(r.toolCalls)
          .map(([t, c]) => `${t}=${c}`)
          .join('  ')}`,
      )
  }
  console.log(
    '\n>>> All captured columns shown. ✓SIG = paired-bootstrap CI excludes 0 (real lift). tok_in/out + calls = per-arm totals across the held-out set; shots = mean refine-shots (N/A for a multi-worker driver). Read cost-aware: +resolve at +$$ may still lose.',
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
