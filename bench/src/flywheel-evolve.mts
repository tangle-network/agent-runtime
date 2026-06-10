/**
 * THE EVOLUTION RUN — the multi-generation closed loop on EOPS:
 *
 *   gen0      baselines compete on the train stream
 *   gen 1..G  the system authors POP candidate strategies per generation from the
 *             latest tournament's losses; candidates play the incumbent at equal budget
 *   gate      ONE promotion decision on a fresh disjoint holdout slice (seeded
 *             paired bootstrap, evidence floor) — final champion vs gen0 champion
 *
 * Champion selection inside the search is cost-aware by default (ties on score go to
 * the cheapest strategy — the run that motivated this: an authored strategy tied refine
 * at half sample's cost and a scalar champion rule hid it). Every authored artifact's
 * gzip bits are recorded (description-length-vs-holdout-gap analyzable per run).
 *
 *   docker run -d --rm --name eops -p 8006:8005 shivakrishnareddyma225/enterpriseops-gym-mcp-itsm:latest
 *   EOPS_GYM_DBS_DIR=… N=12 HOLDOUT=8 GENS=2 POP=2 BUDGET=3 tsx src/flywheel-evolve.mts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createChatClient } from '@tangle-network/agent-eval'
import {
  type AgenticTask,
  printBenchmarkReport,
  runStrategyEvolution,
} from '@tangle-network/agent-runtime/loops'
import { createEopsSurface, eopsTaskFromRow } from './agentic-eops'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

async function loadSlice(offset: number, n: number): Promise<AgenticTask[]> {
  const split = process.env.EOPS_SPLIT ?? 'itsm'
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent('ServiceNow-AI/EnterpriseOps-Gym')}&config=oracle&split=${split}&offset=${offset}&length=${n}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`EOPS HF rows HTTP ${res.status}`)
  const body = (await res.json()) as { rows?: Array<{ row: Parameters<typeof eopsTaskFromRow>[0] }> }
  const tasks = (body.rows ?? []).slice(0, n).map(({ row }) => eopsTaskFromRow(row))
  if (tasks.length < n) throw new Error(`EOPS slice [${offset}, ${offset + n}) returned only ${tasks.length} tasks`)
  return tasks
}

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 12)
  const holdoutN = Number(process.env.HOLDOUT ?? 8)
  const budget = Number(process.env.BUDGET ?? 3)
  const generations = Number(process.env.GENS ?? 2)
  const populationSize = Number(process.env.POP ?? 2)
  const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-pro'
  const authorModel = process.env.AUTHOR_MODEL ?? 'deepseek-v4-pro'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const surface = createEopsSurface(must('EOPS_GYM_DBS_DIR'))
  const champion = (process.env.CHAMPION ?? 'costAware') as 'costAware' | 'score'

  console.error(
    `=== EVOLUTION RUN · train n=${n} + holdout ${holdoutN} (offset ${process.env.HOLDOUT_OFFSET ?? 0}) · gens=${generations} pop=${populationSize} · worker=${workerModel} author=${authorModel} · budget=${budget} · champion=${champion} ===\n`,
  )
  const report = await runStrategyEvolution({
    environment: surface,
    tasks: loadSlice,
    trainN: n,
    holdoutN,
    holdoutOffset: Number(process.env.HOLDOUT_OFFSET ?? 0),
    worker: {
      routerBaseUrl,
      routerKey,
      model: workerModel,
      innerTurns: Number(process.env.INNER_TURNS ?? 4),
      temperature: 0.7,
    },
    author: {
      chat: createChatClient({ transport: 'router', apiKey: routerKey, baseUrl: routerBaseUrl, defaultModel: authorModel }),
      model: authorModel,
      fallbackModel: process.env.AUTHOR_FALLBACK_MODEL ?? 'deepseek-v4-flash',
      temperature: 0.6,
      maxTokens: 8192,
    },
    budget,
    concurrency: Number(process.env.CONCURRENCY ?? 2),
    generations,
    populationSize,
    champion,
    outDir: join(import.meta.dirname, 'authored'),
    onTask: (phase, row, done, total) => {
      const cells = row.cells
        ? Object.entries(row.cells).map(([s, c]) => `${s}=${(c.score * 100).toFixed(0)}%`).join(' ')
        : `SKIP ${row.error?.slice(0, 60)}`
      console.error(`  [${phase} ${done}/${total}] ${row.taskId.slice(-12)}: ${cells}`)
    },
  })

  console.error(`\n${'='.repeat(74)}\nEVOLUTION VERDICT\n${'='.repeat(74)}`)
  for (const t of report.trajectory) {
    console.error(`  gen ${t.generation}: champion ${t.champion} @ ${(t.score * 100).toFixed(1)}% ($${t.usd.toFixed(4)}/task)`)
  }
  for (const g of report.generations) {
    for (const c of g.candidates) {
      console.error(
        c.error
          ? `  gen ${g.generation} author FAILED: ${c.error.slice(0, 100)}`
          : `  gen ${g.generation} authored ${c.name} (${c.codeChars} chars, ${c.gzipBits} gzip-bits) → ${c.file}`,
      )
    }
  }
  printBenchmarkReport(report.holdout)
  const v = report.verdict
  console.error(`  paired lift (final − gen0 champion): ${(v.lift.mean * 100).toFixed(1)}pp  CI [${(v.lift.low * 100).toFixed(1)}, ${(v.lift.high * 100).toFixed(1)}]  (n=${v.n})`)
  console.error(
    v.promoted
      ? '  PROMOTED — evolution generalized to held-out tasks.'
      : v.reason === 'identical-champion'
        ? '  HOLD: no authored strategy displaced the gen0 champion.'
        : v.reason === 'few-tasks'
          ? `  NOT PROMOTED: only ${v.n} paired holdout tasks — below the evidence floor.`
          : '  NOT PROMOTED: holdout lift CI includes 0 (the gate did its job).',
  )
  const outPath = process.env.OUT ?? '/tmp/flywheel-evolve-result.json'
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.error(`  full artifact → ${outPath}`)
}

main().catch((e) => {
  console.error(`flywheel-evolve: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
