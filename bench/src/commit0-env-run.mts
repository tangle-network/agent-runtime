/**
 * The HARD test: sample-vs-refine on Commit0 (implement entire stubbed Python libraries
 * against their own test suites), through the PUBLISHED suite — runBenchmark over a
 * Commit0 Environment (local Docker workspace, file tools, pytest as the check).
 *
 *   COMMIT0_FIXTURES=1 N=3 BUDGET=3 INNER_TURNS=10 WORKER_MODEL=deepseek-v4-pro \
 *     tsx src/commit0-env-run.mts
 *
 * IDS=commit-0/wcwidth to pick repos; STRATEGIES=sample,refine,adaptiveRefine to choose arms.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { adaptiveRefine, printBenchmarkReport, refine, runBenchmark, sample, type Strategy } from '@tangle-network/agent-runtime/kernel'
import { type Commit0Row, createCommit0Environment, rowToTask } from './commit0-env'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 2)
  const budget = Number(process.env.BUDGET ?? 3)
  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-pro'
  const rows = (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'commit0.json'), 'utf8')) as Commit0Row[]).filter(
    (r) => !process.env.IDS || process.env.IDS.split(',').includes(r.instance_id),
  )
  const picked = rows.slice(0, n)
  const byName: Record<string, Strategy> = { sample, refine, adaptiveRefine }
  const strategies = (process.env.STRATEGIES ?? 'sample,refine').split(',').map((s) => {
    const st = byName[s.trim()]
    if (!st) throw new Error(`unknown strategy ${s}`)
    return st
  })

  console.error(`=== commit0 (HARD) · ${picked.map((r) => r.instance_id).join(', ')} · ${model} · budget=${budget} · [${strategies.map((s) => s.name).join(' vs ')}] ===\n`)
  const environment = createCommit0Environment(picked)
  const report = await runBenchmark({
    environment,
    tasks: picked.map(rowToTask),
    worker: {
      routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      routerKey: must('TANGLE_API_KEY'),
      model,
      innerTurns: Number(process.env.INNER_TURNS ?? 10),
      temperature: 0.4,
    },
    strategies,
    budget,
    concurrency: Number(process.env.CONCURRENCY ?? 1),
  })
  printBenchmarkReport(report)
}

main().catch((e) => {
  console.error(`commit0-env-run: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
