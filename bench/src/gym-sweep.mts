/**
 * The score-vs-n curve — the measurement this whole line of work was missing.
 *
 * Run MAX_N agentic rollouts per task over N itsm tasks, then plot best-of-m (m = 1..MAX_N) under
 * the deployable SQL verifier: does selecting the best of m independent rollouts climb as m grows?
 * This is the canonical repeated-sampling / inference-time-scaling curve (the "score up with n"
 * result), measured through REAL agentic rollouts (gym-agent.ts) and a REAL verifier — not a
 * one-shot completion, not an LLM judge.
 *
 *   export TANGLE_API_KEY=… EOPS_GYM_DBS_DIR=<unzipped gym_dbs.zip>
 *   # gym itsm container on :8006
 *   TASKS=5 MAX_N=8 WORKER_MODEL=gpt-4.1 tsx src/gym-sweep.mts
 *
 * best-of-m is the EXACT expectation over m-subsets of the MAX_N samples (no re-running per m):
 *   score:    E[max over an m-subset]  = Σ_i s_(i) · C(i-1, m-1) / C(n, m)   (s sorted ascending)
 *   resolved: pass@m                   = 1 − C(n−c, m) / C(n, m)             (c = #resolved)
 * So one batch of MAX_N rollouts/task yields the whole curve.
 */

import { runGymAgentShot, type GymServer, type GymTask, type GymVerifier } from './gym-agent'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} is required`)
  return v
}

const DATASET = 'ServiceNow-AI/EnterpriseOps-Gym'

interface HfRow {
  task_id: string
  system_prompt: string
  user_prompt: string
  selected_tools: string[]
  gym_servers_config: string | GymServer[]
  verifiers: string | GymVerifier[]
}

async function loadItsmTasks(n: number): Promise<GymTask[]> {
  const url =
    `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}` +
    `&config=oracle&split=itsm&offset=0&length=${n}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HF rows ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as { rows?: Array<{ row: HfRow }> }
  const arr = <T,>(v: string | T[]): T[] => (typeof v === 'string' ? (JSON.parse(v) as T[]) : v)
  return (body.rows ?? []).slice(0, n).map(({ row }) => ({
    id: row.task_id,
    systemPrompt: row.system_prompt,
    userPrompt: row.user_prompt,
    selectedTools: row.selected_tools,
    servers: arr<GymServer>(row.gym_servers_config),
    verifiers: arr<GymVerifier>(row.verifiers),
  }))
}

/** Bounded-concurrency map. */
async function pool<T, R>(items: T[], width: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker))
  return out
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1)
  return r
}

/** E[max over an m-subset] of the per-task sample scores (exact, scores sorted ascending). `m` is
 *  clamped to the sample count, so a task with fewer than m samples contributes its all-sample max. */
function bestOfMScore(scores: number[], m: number): number {
  const n = scores.length
  const k = Math.min(m, n)
  const s = [...scores].sort((a, b) => a - b)
  const denom = choose(n, k)
  let e = 0
  for (let i = 0; i < n; i += 1) e += s[i]! * (choose(i, k - 1) / denom)
  return e
}

/** pass@m = 1 − C(n−c, m)/C(n, m), c = #resolved among the n samples (m clamped to n). */
function passAtM(resolvedFlags: boolean[], m: number): number {
  const n = resolvedFlags.length
  const k = Math.min(m, n)
  const c = resolvedFlags.filter(Boolean).length
  if (c === 0) return 0
  return 1 - choose(n - c, k) / choose(n, k)
}

async function main(): Promise<void> {
  const nTasks = Number(process.env.TASKS ?? 5)
  const maxN = Number(process.env.MAX_N ?? 8)
  const model = process.env.WORKER_MODEL ?? 'gpt-4.1'
  const opts = {
    routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey: must('TANGLE_API_KEY'),
    model,
    gymDbsDir: must('EOPS_GYM_DBS_DIR'),
    maxTurns: Number(process.env.MAX_TURNS ?? 14),
    temperature: Number(process.env.TEMPERATURE ?? 0.7),
  }
  const tasks = await loadItsmTasks(nTasks)
  console.log(`score-vs-n: ${tasks.length} itsm tasks × ${maxN} rollouts each, ${model}, maxTurns=${opts.maxTurns}\n`)

  // scores[t][r] for task t, rollout r. A rollout that throws (transport failure) is recorded as a
  // null and dropped from that task's sample (logged), so one bad rollout never kills the sweep.
  const perTaskRaw = await pool(tasks, 2, async (task, t) => {
    const rollouts = await pool(
      Array.from({ length: maxN }, (_v, r) => r),
      4,
      async () => {
        try {
          return await runGymAgentShot(task, opts)
        } catch (e) {
          console.log(`  ! task ${t} rollout failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`)
          return null
        }
      },
    )
    const ok = rollouts.filter((x): x is NonNullable<typeof x> => x !== null && !x.unscoreable)
    if (ok.length === 0) {
      console.log(`  - task ${t} ${task.id.slice(0, 28)}: SKIPPED (unscoreable — all verifiers malformed or rollouts failed)`)
      return null
    }
    const scores = ok.map((x) => x.score)
    const resolved = ok.map((x) => x.resolved)
    const meanTurns = ok.reduce((a, x) => a + x.turns, 0) / ok.length
    const toolErr = ok.reduce((a, x) => a + x.toolErrors, 0)
    console.log(
      `  task ${t} ${task.id.slice(0, 28)}: scores [${scores.map((s) => s.toFixed(2)).join(' ')}]` +
        ` resolved ${resolved.filter(Boolean).length}/${ok.length} (turns~${meanTurns.toFixed(1)}, toolErr ${toolErr})`,
    )
    return { scores, resolved }
  })
  const perTask = perTaskRaw.filter((x): x is { scores: number[]; resolved: boolean[] } => x !== null)
  if (perTask.length === 0) throw new Error('every task was unscoreable — no curve to plot')

  console.log('\nm   best-of-m score   pass@m (all-verifiers)')
  for (let m = 1; m <= maxN; m += 1) {
    const score = perTask.reduce((a, p) => a + bestOfMScore(p.scores, m), 0) / perTask.length
    const pass = perTask.reduce((a, p) => a + passAtM(p.resolved, m), 0) / perTask.length
    console.log(`${String(m).padStart(2)}  ${(score * 100).toFixed(1).padStart(13)}%  ${(pass * 100).toFixed(1).padStart(18)}%`)
  }
  const s1 = perTask.reduce((a, p) => a + bestOfMScore(p.scores, 1), 0) / perTask.length
  const sN = perTask.reduce((a, p) => a + bestOfMScore(p.scores, maxN), 0) / perTask.length
  console.log(`\nCLIMB: best-of-1 ${(s1 * 100).toFixed(1)}% -> best-of-${maxN} ${(sN * 100).toFixed(1)}% (graded score, ${(((sN - s1) * 100)).toFixed(1)}pp)`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
