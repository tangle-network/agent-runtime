/**
 * Router-based gate runner for aec-bench — the fix for the null-score sandbox path.
 *
 * aec-bench is closed-form reasoning + a deterministic local verify.py judge, so a
 * sandbox is unnecessary: solve each task with one direct router chat call, then
 * judge the raw response locally (verify.py extracts the last fenced ```json block
 * itself). The prior sandbox path emitted the JSON in-stream but never fed it to
 * the judge, so every verdict.score came out null — the bug this runner fixes by
 * passing the model's full response straight to adapter.judge().
 *
 * Two paired arms over the SAME task set (loadTasks once):
 *   random@K  — K identical-base-prompt shots/task (the compute control)
 *   diverse@K — K shots, the i-th prefixed with composeStrategies(base, K)[i]
 *
 * Each attempt carries a REAL numeric verdict.score (from verify.py) + the output,
 * written as a corpus RunRecord (condition random@K / diverse@K) the existing
 * corpus-replay --selector + corpus-report consume unchanged. Fail loud on a router
 * error — never a fabricated score.
 */

import { resolveAdapter } from './adapters'
import type { BenchmarkAdapter, BenchTask } from './benchmarks/types'
import { type AttemptRecord, appendRunRecord, type RunRecord } from './corpus'
import { composeStrategies } from './directives'
import { type RouterConfig, routerChatWithUsage } from './router-client'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

interface ArmSpec {
  /** Corpus condition label the selector/report filter on (e.g. random@4). */
  condition: string
  /** Per-attempt prompt builder: the i-th of K shots for a task. */
  promptFor(task: BenchTask, i: number, k: number): string
}

interface AttemptOutcome {
  prompt: string
  output: string
  score: number
  resolved: boolean
  costUsd?: number
  tokensIn?: number
  tokensOut?: number
  wallMs: number
  /** the router/judge call failed after retries — EXCLUDED from stats, never scored 0. */
  infraError?: boolean
}

/** Bounded-concurrency pool: run `fn` over `items`, at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const idx = next
      next += 1
      if (idx >= items.length) return
      results[idx] = await fn(items[idx] as T, idx)
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker())
  await Promise.all(workers)
  return results
}

async function runAttempt(
  cfg: RouterConfig,
  adapter: BenchmarkAdapter,
  task: BenchTask,
  prompt: string,
): Promise<AttemptOutcome> {
  const startedAt = Date.now()
  // Retry transient router/judge failures (rate limits, stream drops, 5xx) with
  // backoff; a genuine empty completion still scores a real 0 (verify.py fail-closes).
  // Only after retries are exhausted do we record an EXCLUDED infraError — never a
  // fabricated score, and never a throw that aborts the whole multi-model run.
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await routerChatWithUsage(cfg, [{ role: 'user', content: prompt }])
      const content = typeof res.content === 'string' ? res.content : ''
      const verdict = await adapter.judge(task, content)
      return {
        prompt,
        output: content,
        score: verdict.score,
        resolved: verdict.resolved,
        wallMs: Date.now() - startedAt,
        ...(res.costUsd !== undefined ? { costUsd: res.costUsd } : {}),
        ...(res.usage ? { tokensIn: res.usage.input, tokensOut: res.usage.output } : {}),
      }
    } catch (err) {
      lastErr = err
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
  }
  console.warn(`[aec-gate] ${task.id}: infra error after 3 tries — excluded: ${(lastErr instanceof Error ? lastErr.message : String(lastErr)).slice(0, 160)}`)
  return { prompt, output: '', score: 0, resolved: false, wallMs: Date.now() - startedAt, infraError: true }
}

function toAttemptRecord(o: AttemptOutcome, round: number): AttemptRecord {
  return {
    round,
    prompt: o.prompt,
    output: o.output,
    // infra-errored attempts carry NO score/valid → corpus-replay skips them.
    ...(o.infraError ? {} : { valid: o.resolved, score: o.score }),
    wallMs: o.wallMs,
    eventCount: 1,
    eventTypes: o.infraError ? { 'router.error': 1 } : { 'router.chat': 1 },
    traceTail: o.output.slice(-600),
    ...(o.costUsd !== undefined ? { costUsd: o.costUsd } : {}),
    ...(o.tokensIn !== undefined ? { tokensIn: o.tokensIn } : {}),
    ...(o.tokensOut !== undefined ? { tokensOut: o.tokensOut } : {}),
  }
}

interface ArmResult {
  /** mean graded score across SCORED (non-infra) attempts */
  meanScore: number
  /** fraction of scored attempts at full credit (score >= 1) */
  fullCreditRate: number
  attemptCount: number
  /** attempts excluded as infra errors (router/judge failed after retries) */
  infraCount: number
}

async function runArm(
  arm: ArmSpec,
  cfg: RouterConfig,
  adapter: BenchmarkAdapter,
  tasks: BenchTask[],
  k: number,
  concurrency: number,
  corpusPath: string,
): Promise<ArmResult> {
  // Flatten (task, shot) into one unit of work so the pool bounds TOTAL in-flight
  // router calls across all tasks, not per-task.
  const units = tasks.flatMap((task) => Array.from({ length: k }, (_, i) => ({ task, i })))
  const outcomes = await pool(units, concurrency, (u) => runAttempt(cfg, adapter, u.task, arm.promptFor(u.task, u.i, k)))

  const scored = outcomes.filter((o) => !o.infraError)
  let scoreSum = 0
  let fullCredit = 0
  for (const o of scored) {
    scoreSum += o.score
    if (o.score >= 1) fullCredit += 1
  }

  // Group K outcomes back per task → one RunRecord/task (the controller-run shape).
  for (let t = 0; t < tasks.length; t += 1) {
    const task = tasks[t] as BenchTask
    const taskOutcomes = outcomes.slice(t * k, t * k + k)
    const attempts = taskOutcomes.map((o, i) => toAttemptRecord(o, i))
    const record: RunRecord = {
      ts: new Date().toISOString(),
      benchmark: adapter.name,
      instanceId: task.id,
      condition: arm.condition,
      model: cfg.model,
      blindResolved: attempts[0]?.valid === true,
      // k-attempt outcome = any usable attempt resolved (the oracle@k ceiling for
      // this run; the deployable selector is scored separately by corpus-replay).
      resolved: taskOutcomes.some((o) => o.resolved),
      attempts,
      // a task whose every attempt infra-errored is itself infra-errored.
      infraError: taskOutcomes.length > 0 && taskOutcomes.every((o) => o.infraError),
    }
    await appendRunRecord(corpusPath, record)
  }

  return {
    meanScore: scored.length > 0 ? scoreSum / scored.length : 0,
    fullCreditRate: scored.length > 0 ? fullCredit / scored.length : 0,
    infraCount: outcomes.length - scored.length,
    attemptCount: outcomes.length,
  }
}

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 5)
  const k = Number(process.env.K ?? 4)
  const model = process.env.WORKER_MODEL ?? 'gpt-5'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const concurrency = Number(process.env.CONCURRENCY ?? 6)
  const randomCorpus = process.env.RANDOM_CORPUS ?? '/tmp/aec-r.jsonl'
  const diverseCorpus = process.env.DIVERSE_CORPUS ?? '/tmp/aec-d.jsonl'

  if (!Number.isFinite(n) || n < 1) throw new Error(`N must be a positive integer, got ${process.env.N}`)
  if (!Number.isFinite(k) || k < 1) throw new Error(`K must be a positive integer, got ${process.env.K}`)

  const cfg: RouterConfig = { routerBaseUrl, routerKey, model }
  const bench = process.env.BENCH ?? 'aec-bench'
  const adapter = resolveAdapter(bench)

  console.log(`=== ${bench} router gate · N=${n} K=${k} model=${model} conc=${concurrency} ===`)
  await adapter.preflight()
  const tasks = await adapter.loadTasks({ limit: n })
  console.log(`loaded ${tasks.length} task(s): ${tasks.map((t) => t.id).join(', ')}`)

  // random arm: the task prompt verbatim, K times (the compute control).
  const randomArm: ArmSpec = {
    condition: `random@${k}`,
    promptFor: (task) => task.prompt,
  }
  // diverse arm: the i-th shot prefixed with the i-th distinct strategy lens.
  const diverseArm: ArmSpec = {
    condition: `diverse@${k}`,
    promptFor: (task, i, kk) => composeStrategies(task.prompt, kk)[i] as string,
  }

  console.log(`\n▶ random@${k} (control — identical base prompt) → ${randomCorpus}`)
  const r = await runArm(randomArm, cfg, adapter, tasks, k, concurrency, randomCorpus)
  console.log(`  random@${k}:  mean score ${(r.meanScore * 100).toFixed(1)}%  full-credit ${(r.fullCreditRate * 100).toFixed(1)}%  (n=${r.attemptCount} attempts${r.infraCount ? `, ${r.infraCount} infra-excluded` : ''})`)

  console.log(`\n▶ diverse@${k} (K distinct strategy lenses) → ${diverseCorpus}`)
  const d = await runArm(diverseArm, cfg, adapter, tasks, k, concurrency, diverseCorpus)
  console.log(`  diverse@${k}: mean score ${(d.meanScore * 100).toFixed(1)}%  full-credit ${(d.fullCreditRate * 100).toFixed(1)}%  (n=${d.attemptCount} attempts${d.infraCount ? `, ${d.infraCount} infra-excluded` : ''})`)

  console.log(
    `\n=== next: read the gate ===\n` +
      `  npx tsx src/corpus-replay.mts ${randomCorpus} --selector\n` +
      `  npx tsx src/corpus-replay.mts ${diverseCorpus} --selector --condition=diverse\n` +
      `  npx tsx src/corpus-report.mts ${randomCorpus} ${diverseCorpus}`,
  )
}

main().catch((err) => {
  console.error(`aec-gate: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
