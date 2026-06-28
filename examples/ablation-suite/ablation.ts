/**
 * ablation — the cost-aware knob-board + one-knob-delta runner for agent self-improvement techniques.
 *
 * THE VISION: a single configurable agent where every technique is a knob (topology, trace-analysis,
 * steering, GEPA/skill optimization, persistent artifacts), swept across arms at EQUAL COMPUTE, with a
 * full autopsy — resolve rate AND token/$/latency cost per arm — so we see what really helps vs what
 * just burns tokens. One-knob-delta design (baseline + each single knob flipped) keeps it O(N), not 2^N.
 *
 * STATUS — honest: the framework + the cost autopsy are real; knobs are wired incrementally. WIRED:
 * `topology` (single/fanout/fanout-refine = refine/sample/sampleThenRefine) + `budget`. The rest are
 * DECLARED knobs that FAIL LOUD if set (no silent no-op — you must not think GEPA ran when it didn't);
 * each is a tracked next-increment over a real substrate primitive (named in the throw). Validate the
 * framework on the cheap contamination-proof task, THEN point `environment`/`tasks` at SWE-bench.
 */
import {
  type AgenticSurface,
  type AgenticTask,
  refine,
  runAgentic,
  sample,
  sampleThenRefine,
  type Strategy,
} from '@tangle-network/agent-runtime/loops'
import { codingEnv, codingTasks } from '../self-improving-coder/self-improving-coder'

export interface AblationKnobs {
  /** WIRED → strategy: single=`refine` (iterate one artifact), fanout=`sample` (N parallel, pick best),
   *  fanout-refine=`sampleThenRefine`. The coordination shape. */
  topology: 'single' | 'fanout' | 'fanout-refine'
  /** WIRED → equal-compute unit (refine: max shots; fanout: rollout width). */
  budget: number
  // ── DECLARED knobs — fail loud until wired (each over a named substrate primitive) ──
  optimize?: 'off' | 'gepa' | 'skillOpt' // gepaProposer / skillOptProposer on TRAIN, frozen, then run
  traceAnalysis?: 'off' | 'settle' | 'live' // analyzeOnSettle / watchTrace (agent-eval analysts)
  halo?: boolean
  steering?: boolean // trace finding → steer_worker (event-bus)
  persistentArtifact?: boolean // multi-round persistent artifact (openSandboxRun resume)
}

const topologyStrategy: Record<AblationKnobs['topology'], Strategy> = {
  single: refine,
  fanout: sample,
  'fanout-refine': sampleThenRefine,
}

/** Fail loud on a set-but-unwired knob — the house rule (no silent no-op). Names the primitive to wire. */
const unwiredKnobs: Array<{ k: keyof AblationKnobs; isSet: (v: unknown) => boolean; prim: string }> = [
  { k: 'optimize', isSet: (v) => !!v && v !== 'off', prim: 'gepaProposer/skillOptProposer + improve() on TRAIN, frozen' },
  { k: 'traceAnalysis', isSet: (v) => !!v && v !== 'off', prim: 'analyzeOnSettle / watchTrace (agent-eval analysts)' },
  { k: 'halo', isSet: (v) => v === true, prim: 'HALO analyst option' },
  { k: 'steering', isSet: (v) => v === true, prim: 'event-bus finding → steer_worker' },
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
}

export async function runAblation(opts: {
  environment: AgenticSurface
  tasks: (offset: number, n: number) => Promise<AgenticTask[]>
  holdoutOffset: number
  holdoutN: number
  base: AblationKnobs
  /** Each delta = a ONE-KNOB change vs base (the one-knob-delta design). */
  deltas: Array<{ name: string; knob: Partial<AblationKnobs> }>
  worker: { routerBaseUrl: string; routerKey: string; model: string; maxTokens?: number; innerTurns?: number }
  onArm?: (r: ArmResult) => void
}): Promise<ArmResult[]> {
  // ONE held-out set, shared across all arms — the fair-comparison invariant.
  const tasks = await opts.tasks(opts.holdoutOffset, opts.holdoutN)
  const arms = [
    { name: 'baseline', knobs: opts.base },
    ...opts.deltas.map((d) => ({ name: d.name, knobs: { ...opts.base, ...d.knob } as AblationKnobs })),
  ]
  const results: ArmResult[] = []
  for (const arm of arms) {
    for (const u of unwiredKnobs) {
      if (u.isSet(arm.knobs[u.k]))
        throw new Error(
          `ablation: knob '${u.k}'=${JSON.stringify(arm.knobs[u.k])} (arm "${arm.name}") is DECLARED but not yet wired — wire it over ${u.prim} before claiming it ran. (No silent no-op.)`,
        )
    }
    let resolved = 0
    let ti = 0
    let to = 0
    let usd = 0
    let ms = 0
    let shots = 0
    let comps = 0
    for (const t of tasks) {
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
      ti += r.tokens.input
      to += r.tokens.output
      usd += r.usd
      ms += r.ms
      shots += r.shots
      comps += r.completions
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
    pad('arm', 16) + pad('topology', 14) + pad('resolve', 9) + pad('tok(in/out)', 16) + pad('$', 9) + pad('lat(s)', 9) + pad('shots', 7) + pad('Δresolve', 10) + 'Δ$',
  )
  for (const r of results) {
    const dR = base ? r.resolve - base.resolve : 0
    const dC = base ? r.costUsd - base.costUsd : 0
    console.log(
      pad(r.name, 16) +
        pad(r.knobs.topology, 14) +
        pad(`${(100 * r.resolve).toFixed(0)}%`, 9) +
        pad(`${r.tokensIn}/${r.tokensOut}`, 16) +
        pad(`$${r.costUsd.toFixed(4)}`, 9) +
        pad((r.latencyMs / 1000).toFixed(0), 9) +
        pad(r.shotsMean.toFixed(1), 7) +
        pad(`${dR >= 0 ? '+' : ''}${(100 * dR).toFixed(0)}pp`, 10) +
        `${dC >= 0 ? '+' : ''}$${dC.toFixed(4)}`,
    )
  }
  console.log(
    '\n>>> Read it cost-aware: a +resolve that costs +$$ may be worse than baseline. The whole point is to see what HELPS vs what just BURNS.',
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
  console.log(`═══ ABLATION (cheap contamination-proof task) — worker=${worker.model} ═══`)
  const results = await runAblation({
    environment: codingEnv,
    tasks: codingTasks,
    holdoutOffset: 100, // a fixed disjoint held-out slice
    holdoutN: Number(process.env.HOLDOUT_N ?? 6),
    base: { topology: 'single', budget: Number(process.env.BUDGET ?? 2) },
    // one-knob-delta: flip ONLY topology (the wired knob) vs baseline.
    deltas: [
      { name: 'fanout', knob: { topology: 'fanout' } },
      { name: 'fanout-refine', knob: { topology: 'fanout-refine' } },
    ],
    worker,
    onArm: (r) => console.log(`  ${r.name}: ${(100 * r.resolve).toFixed(0)}% resolve, $${r.costUsd.toFixed(4)}, ${(r.latencyMs / 1000).toFixed(0)}s`),
  })
  printAutopsy(results)
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
