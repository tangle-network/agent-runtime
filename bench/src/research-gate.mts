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
 * Reuses the kernel primitives (no reinvention): `routerChatWithUsage` (answer +
 * real token usage), `runPool` (bounded concurrency), `appendRunRecord` (the durable
 * corpus), and the bench's own `adapter.judge`. The AGENTIC HARNESS regime
 * (opencode/pi multi-turn in a box) is NOT here — it runs through `runExperiment` /
 * `rsi.ts` with `sandboxAgentRun` (backendType opencode|pi|…); this file is only the
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
import type { BenchTask } from './benchmarks/types'
import { type AttemptRecord, appendRunRecord, type RunRecord } from './corpus'
import { routerChatWithUsage } from './router-client'
import { runPool } from './run-pool'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

interface ShotCfg {
  model: string
  /** search provider id: 'default'/'off'/'none' = no search (parametric control); else a router provider. */
  search: string
  maxResults: number
  /** how many top search URLs to web_fetch full page content for (0 = snippets only). */
  fetchTopK: number
  temperature: number
  routerBaseUrl: string
  routerKey: string
  timeoutMs: number
}

interface Shot {
  task: BenchTask
  attempt: number
  answer: string
  ok: boolean
  detail?: string
  wallMs: number
  /** count of search hits retrieved (0 ⇒ no search happened / it failed). */
  searches: number
}

/** Fetch a URL's extracted page text via the router web_fetch MCP tool. Returns '' on any failure. */
async function fetchPage(url: string, cfg: ShotCfg): Promise<string> {
  try {
    const res = await fetch(`${cfg.routerBaseUrl}/search/mcp?provider=${encodeURIComponent(cfg.search)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'web_fetch', arguments: { url } } }),
      ...(cfg.timeoutMs ? { signal: AbortSignal.timeout(Math.min(cfg.timeoutMs, 60_000)) } : {}),
    })
    if (!res.ok) return ''
    const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } }
    const text = body.result?.content?.[0]?.text ?? ''
    // The tool returns a JSON string {url,title,content}; pull `content` if parseable, else the raw text.
    try {
      const parsed = JSON.parse(text) as { content?: string }
      return (parsed.content ?? text).slice(0, 2500)
    } catch {
      return text.slice(0, 2500)
    }
  } catch {
    return ''
  }
}

/**
 * One research rollout, 2-step RAG: (1) provider-pinned web search + web_fetch of the
 * top-K pages, (2) answer with that evidence via `routerChatWithUsage`. No tools on the
 * answer call, so `content` is always present and arms differ ONLY by the provider's
 * evidence — no tool-loop `content:null` tail biasing the search arm. The COMMIT prompt
 * stops the model deferring ("may I search?"), which otherwise scores 0. Fault-isolated.
 */
async function runResearchShot(task: BenchTask, attempt: number, cfg: ShotCfg): Promise<Shot> {
  const startedAt = Date.now()
  const useSearch = cfg.search !== 'default' && cfg.search !== 'off' && cfg.search !== 'none'
  let searches = 0
  try {
    // 1) Provider-pinned web search (proven /v1/search). The control arm skips this.
    let context = ''
    if (useSearch) {
      // Query = the clean question (first non-empty line), NOT the whole prompt: the appended
      // worker-contract boilerplate pollutes the query and returns 0 hits.
      const query = (task.prompt.split('\n').find((l) => l.trim().length > 0) ?? task.prompt).slice(0, 300)
      const sres = await fetch(`${cfg.routerBaseUrl}/search?provider=${encodeURIComponent(cfg.search)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
        body: JSON.stringify({ query, count: cfg.maxResults }),
        ...(cfg.timeoutMs ? { signal: AbortSignal.timeout(cfg.timeoutMs) } : {}),
      })
      if (!sres.ok) {
        // Surface, never silently degrade to parametric — a failed search must be visible.
        console.warn(`  [search FAIL ${task.id}#${attempt}] HTTP ${sres.status}: ${(await sres.text()).slice(0, 140)}`)
      } else {
        const sb = (await sres.json()) as { data?: Array<{ title?: string; url?: string; snippet?: string }> }
        const hits = sb.data ?? []
        searches = hits.length
        // Fetch the full page text of the top-K results (snippets rarely carry exact figures).
        const fetched = await Promise.all(hits.slice(0, cfg.fetchTopK).map((h) => (h.url ? fetchPage(h.url, cfg) : Promise.resolve(''))))
        context = hits
          .map((h, i) => `[${i + 1}] ${h.title ?? ''}\n${h.snippet ?? ''}\n${h.url ?? ''}${fetched[i] ? `\nPAGE CONTENT:\n${fetched[i]}` : ''}`)
          .join('\n\n')
      }
    }

    // 2) Answer — no tools (content always present), COMMIT (no deferral), via the shared
    //    router primitive (real usage + transient-retry handling, not a hand-rolled fetch).
    const commit =
      'You have no further tools and cannot ask questions or request more research. ' +
      'Output a SINGLE, FINAL answer to the question, leading with the value in the exact units and precision requested ' +
      '(e.g. "Answer: -47.9 billion USD"). ' +
      (useSearch
        ? 'Use the WEB SEARCH RESULTS below (snippets + fetched page content) as your primary evidence; cite the source. '
        : 'Answer from your own knowledge. ') +
      'If you are not fully certain, still COMMIT to your single best estimate — never refuse, defer, or reply with a question.'
    const userContent =
      useSearch && context ? `${task.prompt}\n\n=== WEB SEARCH RESULTS (provider: ${cfg.search}) ===\n${context}` : task.prompt
    const { content } = await routerChatWithUsage(
      { routerBaseUrl: cfg.routerBaseUrl, routerKey: cfg.routerKey, model: cfg.model },
      [
        { role: 'system', content: commit },
        { role: 'user', content: userContent },
      ],
      { temperature: cfg.temperature, ...(cfg.timeoutMs ? { signal: AbortSignal.timeout(cfg.timeoutMs) } : {}) },
    )
    const answer = content.trim()
    const ok = answer.length > 0
    return { task, attempt, answer, ok, searches, wallMs: Date.now() - startedAt, ...(ok ? {} : { detail: `empty answer (searches=${searches})` }) }
  } catch (err) {
    return { task, attempt, answer: '', ok: false, searches, wallMs: Date.now() - startedAt, detail: `rollout error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}` }
  }
}

async function main(): Promise<void> {
  const benchName = process.env.BENCH ?? 'finsearchcomp'
  const makeAdapter = ADAPTERS[benchName]
  if (!makeAdapter) throw new Error(`unknown BENCH=${benchName} (have: ${Object.keys(ADAPTERS).join(', ')})`)

  const n = Number(process.env.N ?? 6)
  const k = Number(process.env.K ?? 3)
  const model = process.env.MODEL ?? process.env.WORKER_MODEL ?? 'gpt-4o-mini'
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
    const s = await runResearchShot(u.task, u.attempt, cfg)
    console.log(`  rollout ${u.task.id}#${u.attempt}: ${s.ok ? `answer ${s.answer.length}B · ${s.searches} search(es)` : `NO ANSWER (${s.detail})`} (${(s.wallMs / 1000) | 0}s)`)
    return s
  })
  const shotOf = (id: string, i: number) => shots.find((o) => o.value?.task.id === id && o.value?.attempt === i)?.value

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
          const v = await adapter.judge(s.task, s.answer)
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
