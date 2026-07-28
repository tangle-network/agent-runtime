/**
 * One research rollout as a reusable primitive: 2-step RAG — (1) provider-pinned web
 * search via the router's proven `/v1/search?provider=<id>` + `web_fetch` of the top-K
 * result pages, (2) answer with that evidence via `routerChatWithUsage` (no tools on the
 * answer call → `content` always present, so a search arm differs from the parametric
 * control ONLY by the evidence). Pure router HTTP (bearer `TANGLE_API_KEY`).
 *
 * Shared by the off-sandbox RAG leaderboard (`research-gate.mts`) and the router-backed
 * loop executor (`router-executor.ts`), so both score the identical retrieve→answer body
 * — the only difference is who drives the rounds (a flat best-of-k pool vs the real
 * `runLoop` kernel with analyst steering).
 */
import { routerChatWithUsage } from '@tangle-network/agent-runtime/kernel'

export interface ShotCfg {
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

export interface Shot {
  taskId: string
  attempt: number
  answer: string
  ok: boolean
  detail?: string
  wallMs: number
  /** count of search hits retrieved (0 ⇒ no search happened / it failed). */
  searches: number
}

/** Fetch a URL's extracted page text via the router web_fetch MCP tool. Returns '' on any failure. */
export async function fetchPage(url: string, cfg: ShotCfg): Promise<string> {
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
 * One research rollout, 2-step RAG against `prompt` (the task question, possibly with a
 * steer appended): (1) provider-pinned web search + web_fetch of the top-K pages, (2)
 * answer with that evidence. The search query is the clean question (first non-empty
 * line) — appended worker-contract / steer boilerplate pollutes the query and returns 0
 * hits — while the ANSWER sees the full `prompt` so a steer round can act on it. The
 * COMMIT prompt stops the model deferring ("may I search?"), which otherwise scores 0.
 * Fault-isolated: a flaky call → a NO-ANSWER `Shot`, never a throw.
 */
export async function runResearchShot(prompt: string, taskId: string, attempt: number, cfg: ShotCfg): Promise<Shot> {
  const startedAt = Date.now()
  const useSearch = cfg.search !== 'default' && cfg.search !== 'off' && cfg.search !== 'none'
  let searches = 0
  try {
    // 1) Provider-pinned web search (proven /v1/search). The control arm skips this.
    let context = ''
    if (useSearch) {
      const query = (prompt.split('\n').find((l) => l.trim().length > 0) ?? prompt).slice(0, 300)
      const sres = await fetch(`${cfg.routerBaseUrl}/search?provider=${encodeURIComponent(cfg.search)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
        body: JSON.stringify({ query, count: cfg.maxResults }),
        ...(cfg.timeoutMs ? { signal: AbortSignal.timeout(cfg.timeoutMs) } : {}),
      })
      if (!sres.ok) {
        // Surface, never silently degrade to parametric — a failed search must be visible.
        console.warn(`  [search FAIL ${taskId}#${attempt}] HTTP ${sres.status}: ${(await sres.text()).slice(0, 140)}`)
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

    // 2) Answer — no tools (content always present), COMMIT (no deferral), via the shared router primitive.
    const commit =
      'You have no further tools and cannot ask questions or request more research. ' +
      'Output a SINGLE, FINAL answer to the question, leading with the value in the exact units and precision requested ' +
      '(e.g. "Answer: -47.9 billion USD"). ' +
      (useSearch
        ? 'Use the WEB SEARCH RESULTS below (snippets + fetched page content) as your primary evidence; cite the source. '
        : 'Answer from your own knowledge. ') +
      'If you are not fully certain, still COMMIT to your single best estimate — never refuse, defer, or reply with a question.'
    const userContent = useSearch && context ? `${prompt}\n\n=== WEB SEARCH RESULTS (provider: ${cfg.search}) ===\n${context}` : prompt
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
    return { taskId, attempt, answer, ok, searches, wallMs: Date.now() - startedAt, ...(ok ? {} : { detail: `empty answer (searches=${searches})` }) }
  } catch (err) {
    return {
      taskId,
      attempt,
      answer: '',
      ok: false,
      searches,
      wallMs: Date.now() - startedAt,
      detail: `rollout error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
    }
  }
}
