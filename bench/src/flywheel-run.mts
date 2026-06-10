/**
 * THE CLEAN RUN — the closed self-improvement cycle, end to end, no human in the loop:
 *
 *   gen0   strategies compete on a train stream → the losses table
 *   author the system reads ITS OWN losses → authors a new strategy (code, not prompt)
 *   gen1   the authored strategy enters the tournament on the same stream
 *   gate   FROZEN HOLDOUT (disjoint tasks): gen1's champion vs gen0's champion —
 *          did the self-improvement GENERALIZE?
 *
 * One artifact out: gen0 best → gen1 best on held-out tasks, with the cost vector and
 * the authored module preserved. This is Gate B's minimal honest form (the optimizer
 * measurably improving the system across generations, confirmed out-of-sample) and the
 * product story in one number.
 *
 * Workers/author are CHEAP ROUTER MODELS by policy (no CC models):
 *   WORKER_MODEL=deepseek-v4-pro AUTHOR_MODEL=moonshotai/kimi-k2.6
 *
 *   docker run -d --rm --name eops -p 8006:8005 shivakrishnareddyma225/enterpriseops-gym-mcp-itsm:latest
 *   EOPS_GYM_DBS_DIR=… N=12 HOLDOUT=8 BUDGET=3 tsx src/flywheel-run.mts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type AgenticTask,
  authorStrategy,
  type BenchmarkReport,
  printBenchmarkReport,
  promotionGate,
  refine,
  runBenchmark,
  sample,
  sampleThenRefine,
  type Strategy,
} from '@tangle-network/agent-runtime/loops'
import { createChatClient } from '@tangle-network/agent-eval'
import { createEopsSurface, eopsTaskFromRow } from './agentic-eops'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

async function loadTasks(n: number, offset = 0): Promise<AgenticTask[]> {
  const split = process.env.EOPS_SPLIT ?? 'itsm'
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent('ServiceNow-AI/EnterpriseOps-Gym')}&config=oracle&split=${split}&offset=${offset}&length=${n}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`EOPS HF rows HTTP ${res.status}`)
  const body = (await res.json()) as { rows?: Array<{ row: Parameters<typeof eopsTaskFromRow>[0] }> }
  return (body.rows ?? []).slice(0, n).map(({ row }) => eopsTaskFromRow(row))
}

const champion = (r: BenchmarkReport): { name: string; score: number } => {
  let best = { name: 'none', score: -1 }
  for (const [name, v] of Object.entries(r.perStrategy)) if (v.score > best.score) best = { name, score: v.score }
  return best
}

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 12)
  const holdoutN = Number(process.env.HOLDOUT ?? 8)
  const budget = Number(process.env.BUDGET ?? 3)
  const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-pro'
  const authorModel = process.env.AUTHOR_MODEL ?? 'deepseek-v4-pro'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const surface = createEopsSurface(must('EOPS_GYM_DBS_DIR'))
  const worker = { routerBaseUrl, routerKey, model: workerModel, innerTurns: Number(process.env.INNER_TURNS ?? 4), temperature: 0.7 }
  const concurrency = Number(process.env.CONCURRENCY ?? 3)

  console.error(`=== FLYWHEEL RUN · train n=${n} + holdout ${holdoutN} · worker=${workerModel} · author=${authorModel} · budget=${budget} ===\n`)
  const train = await loadTasks(n)
  const baselines: Strategy[] = [sample, refine, sampleThenRefine]

  const onTask = (phase: string) => (row: { taskId: string; error?: string; cells?: Record<string, { score: number }> }, done: number, total: number) => {
    const cells = row.cells ? Object.entries(row.cells).map(([s, c]) => `${s}=${(c.score * 100).toFixed(0)}%`).join(' ') : `SKIP ${row.error?.slice(0, 60)}`
    console.error(`  [${phase} ${done}/${total}] ${row.taskId.slice(-12)}: ${cells}`)
  }
  console.error(`▶ gen0 — ${baselines.map((s) => s.name).join(' vs ')} on the train stream…`)
  const gen0 = await runBenchmark({ environment: surface, tasks: train, worker, strategies: baselines, budget, concurrency, onTask: onTask('gen0') })
  printBenchmarkReport(gen0)
  const champ0 = champion(gen0)
  console.error(`  gen0 champion: ${champ0.name} @ ${(champ0.score * 100).toFixed(1)}%\n`)

  console.error('▶ author — the system reads its own losses and writes a new strategy…')
  const chat = createChatClient({ transport: 'router', apiKey: routerKey, baseUrl: routerBaseUrl, defaultModel: authorModel })
  const losses = JSON.stringify(gen0.perTask, null, 1).slice(0, 7000)
  const { strategy: authored, file } = await authorStrategy({
    chat,
    model: authorModel,
    // The fallback is a FASTER model on purpose: the primary's failure modes are an
    // empty reply (no maxTokens) or an edge 524 on a long generation — flash clears both.
    fallbackModel: process.env.AUTHOR_FALLBACK_MODEL ?? 'deepseek-v4-flash',
    environmentName: surface.name,
    lossesJson: losses,
    budget,
    outDir: join(import.meta.dirname, 'authored'),
    temperature: 0.6,
    maxTokens: 8192,
  })
  console.error(`  authored "${authored.name}" → ${file}\n`)

  console.error(`▶ gen1 — the authored strategy enters the tournament…`)
  const gen1 = await runBenchmark({ environment: surface, tasks: train, worker, strategies: [...baselines, authored], budget, concurrency, onTask: onTask('gen1') })
  printBenchmarkReport(gen1)
  const champ1 = champion(gen1)
  console.error(`  gen1 champion: ${champ1.name} @ ${(champ1.score * 100).toFixed(1)}%\n`)

  // ROTATING holdout: a fresh disjoint slice (offset varies by run via OFFSET) — a reused
  // frozen slice is an unforced overfitting channel when tasks stream from HF ~free.
  console.error(`▶ FROZEN HOLDOUT (${holdoutN} disjoint tasks) — gen1 champion vs gen0 champion…`)
  const holdout = await loadTasks(holdoutN, n + Number(process.env.HOLDOUT_OFFSET ?? 0))
  const byName = new Map<string, Strategy>([...baselines, authored].map((s) => [s.name, s]))
  const champs = [...new Set([champ0.name, champ1.name])]
    .map((name) => byName.get(name))
    .filter((s): s is Strategy => !!s)
  const gate = await runBenchmark({ environment: surface, tasks: holdout, worker, strategies: champs, budget, concurrency, onTask: onTask('holdout') })
  // Promotion is the package gate: a SEEDED paired bootstrap on the per-task holdout
  // deltas with a minimum-evidence floor — deterministic verdict, CI must clear zero.
  const verdict = promotionGate({
    report: gate,
    incumbent: champ0.name,
    candidate: champ1.name,
    minPairedTasks: Number(process.env.MIN_PAIRED ?? 6),
  })
  const h0 = gate.perStrategy[champ0.name]?.score ?? 0
  const h1 = gate.perStrategy[champ1.name]?.score ?? 0
  console.error(`\n${'='.repeat(74)}`)
  console.error('FLYWHEEL VERDICT')
  console.error('='.repeat(74))
  console.error(`  gen0 champion ${champ0.name}: holdout ${(h0 * 100).toFixed(1)}%`)
  console.error(`  gen1 champion ${champ1.name}: holdout ${(h1 * 100).toFixed(1)}%`)
  console.error(`  paired lift (gen1 − gen0): ${(verdict.lift.mean * 100).toFixed(1)}pp  CI [${(verdict.lift.low * 100).toFixed(1)}, ${(verdict.lift.high * 100).toFixed(1)}]  (n=${verdict.n})`)
  console.error(
    verdict.promoted
      ? `  PROMOTED — SELF-IMPROVEMENT GENERALIZED: lift CI excludes 0 on held-out tasks, zero human edits.`
      : verdict.reason === 'identical-champion'
        ? '  HOLD: the authored strategy did not displace the champion.'
        : verdict.reason === 'few-tasks'
          ? `  NOT PROMOTED: only ${verdict.n} paired holdout tasks — below the evidence floor.`
          : `  NOT PROMOTED: the new champion's holdout lift CI includes 0 — no significant generalization (the gate did its job).`,
  )
  const outPath = process.env.OUT ?? '/tmp/flywheel-run-result.json'
  writeFileSync(outPath, JSON.stringify({ workerModel, authorModel, budget, n, holdoutN, gen0, authoredFile: file, gen1, holdoutGate: gate, champ0, champ1, verdict }, null, 2))
  console.error(`  full artifact → ${outPath}`)
}

main().catch((e) => {
  console.error(`flywheel-run: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
