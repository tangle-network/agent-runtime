/**
 * Research leaderboard — model × web-search-provider × multi-shot, on the research
 * benches (finsearchcomp / frames / hotpotqa / simpleqa). This is the OFF-SANDBOX
 * RAG baseline: per shot, (1) provider-pinned web search via the router's proven
 * `/v1/search?provider=<id>` + `web_fetch` of the top-K result pages, (2) answer with
 * the evidence in context (no tools → `content` always present, so every arm differs
 * ONLY by the search provider — a clean controlled A/B). `SEARCH=default` skips search
 * (parametric control). Pure router HTTP (bearer `TANGLE_API_KEY`) — never touches the
 * sandbox, so it never contends with sandbox-bound gates.
 *
 * The retrieve→answer body is the shared `runResearchShot` (research-shot.ts) — the SAME
 * body the kernel-driven variant uses (research-loop.mts), so this flat best-of-k pool and
 * the real-kernel multi-round loop score identical shots. Reuses `runPool` (bounded
 * concurrency), `appendRunRecord` (the durable corpus), and the bench's own `adapter.judge`;
 * nothing is reinvented. The AGENTIC HARNESS regime (opencode/pi multi-turn in a box) runs
 * through `runExperiment` / `rsi.ts` with `sandboxAgentRun`; this file is the flat,
 * non-agentic search-RAG baseline.
 *
 * Each shot's answer is graded by the bench judge; writes one corpus RunRecord/task
 * tagged `search:<provider>` + `model` so the leaderboard slices by arm. Fault-isolated
 * (a flaky call → a NO-ANSWER attempt, never a throw).
 *
 *   dotenvx run -f ~/company/devops/secrets/.env.keys -f ~/company/devops/secrets/agent-state.env -- \
 *     env BENCH=simpleqa SIMPLEQA_FIXTURES=1 MODEL=gpt-4o-mini SEARCH=you N=10 K=1 \
 *     CONCURRENCY=3 JUDGE_MODEL=gpt-4o-mini CORPUS=/tmp/research-you.jsonl tsx src/research-gate.mts
 *   tsx src/corpus-report.mts <armA.jsonl> <armB.jsonl>   # paired-bootstrap across arms
 */

import { ADAPTERS } from './adapters'
import { type AttemptRecord, appendRunRecord, type RunRecord } from './corpus'
import { runResearchShot, type ShotCfg } from './research-shot'
import { runPool } from './run-pool'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

async function main(): Promise<void> {
  const benchName = process.env.BENCH ?? 'finsearchcomp'
  const makeAdapter = ADAPTERS[benchName]
  if (!makeAdapter) throw new Error(`unknown BENCH=${benchName} (have: ${Object.keys(ADAPTERS).join(', ')})`)

  const n = Number(process.env.N ?? 6)
  const k = Number(process.env.K ?? 3)
  const model = process.env.MODEL ?? process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const search = process.env.SEARCH ?? 'default'
  const cfg: ShotCfg = {
    model,
    search,
    maxResults: Number(process.env.SEARCH_MAX_RESULTS ?? 5),
    fetchTopK: Number(process.env.FETCH_TOP_K ?? 3),
    temperature: Number(process.env.TEMPERATURE ?? 0.7),
    routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey: must('TANGLE_API_KEY'), // worker (router) + bench judge both need it
    timeoutMs: process.env.SHOT_TIMEOUT_MS ? Number(process.env.SHOT_TIMEOUT_MS) : 600_000,
  }
  const concurrency = Number(process.env.CONCURRENCY ?? 3)
  const corpusPath = process.env.CORPUS ?? `/tmp/research-${benchName}-${model.replace(/[^a-z0-9]/gi, '_')}-${search}.jsonl`
  if (!Number.isInteger(n) || n < 1) throw new Error(`N must be a positive integer, got ${process.env.N}`)
  if (!Number.isInteger(k) || k < 1) throw new Error(`K must be a positive integer, got ${process.env.K}`)

  const adapter = makeAdapter()
  console.log(`=== research gate (router-RAG) · bench=${benchName} · model=${model} · search=${search} · N=${n} K=${k} conc=${concurrency} ===`)
  await adapter.preflight()
  const tasks = await adapter.loadTasks({ limit: n })
  console.log(`loaded ${tasks.length} task(s)`)

  // Phase 1 — rollouts, concurrent (the shared runPool), off-sandbox. Fault-isolated.
  const units = tasks.flatMap((task) => Array.from({ length: k }, (_, attempt) => ({ task, attempt })))
  console.log(`\n▶ phase 1: ${units.length} rollouts (conc=${concurrency}) · search=${search}`)
  const shots = await runPool(units, concurrency, async (u) => {
    const s = await runResearchShot(u.task.prompt, u.task.id, u.attempt, cfg)
    console.log(`  rollout ${u.task.id}#${u.attempt}: ${s.ok ? `answer ${s.answer.length}B · ${s.searches} search(es)` : `NO ANSWER (${s.detail})`} (${(s.wallMs / 1000) | 0}s)`)
    return s
  })
  const shotOf = (id: string, i: number) => shots.find((o) => o.value?.taskId === id && o.value?.attempt === i)?.value

  // Phase 2 — judge via the bench's OWN judge; write one RunRecord/task (the shared corpus).
  console.log(`\n▶ phase 2: judging via ${adapter.name} judge → ${corpusPath}`)
  let scoredTasks = 0
  for (const task of tasks) {
    const attempts: AttemptRecord[] = []
    for (let i = 0; i < k; i += 1) {
      const s = shotOf(task.id, i)
      let sc: { score: number; resolved: boolean } | undefined
      if (s?.ok) {
        try {
          const v = await adapter.judge(task, s.answer)
          sc = { score: v.score, resolved: v.resolved }
          console.log(`  judge ${task.id}#${i}: score=${(v.score * 100).toFixed(1)}% resolved=${v.resolved}`)
        } catch (err) {
          console.log(`  judge ${task.id}#${i}: ERROR ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`)
        }
      } else {
        console.log(`  judge ${task.id}#${i}: skipped (no answer)`)
      }
      attempts.push({
        round: i,
        prompt: `research:${search}`,
        output: s?.answer ?? '',
        ...(sc ? { valid: sc.resolved, score: sc.score } : {}),
        wallMs: s?.wallMs ?? 0,
        eventCount: s?.searches ?? 0,
        eventTypes: { 'web_search.requests': s?.searches ?? 0 },
        traceTail: (s?.answer ?? '').slice(-600),
      })
    }
    if (attempts.some((a) => a.score !== undefined)) scoredTasks += 1
    const record: RunRecord = {
      ts: new Date().toISOString(),
      benchmark: adapter.name,
      instanceId: task.id,
      condition: `search:${search}`,
      model,
      blindResolved: attempts[0]?.valid === true,
      resolved: attempts.some((a) => a.valid === true),
      attempts,
      infraError: false,
    }
    await appendRunRecord(corpusPath, record)
  }

  console.log(
    `\n=== wrote ${tasks.length} task(s) (${scoredTasks} with ≥1 scored attempt) → ${corpusPath} ===\n` +
      `  arm = model:${model} × search:${search} · compare arms: tsx src/corpus-report.mts <armA.jsonl> <armB.jsonl>`,
  )
}

main().catch((err) => {
  console.error(`research-gate: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
