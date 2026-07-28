/**
 * A host-side web-search tool for the `router-tools` worker backend. This is the
 * capability axis the research benches were missing: finsearch's prompt demands
 * "live web/market sources", but the plain `router` chat backend has no tools, so
 * the worker can only recall/hallucinate. Wiring this tool into a `router-tools`
 * loop gives the off-box worker a real `web_search(query)` it can call, backed by
 * the Tangle router's search providers (you.com / exa). Off-box = unaffected by a
 * sandbox's egress allowlist.
 *
 * The tool result the model reads is a compact text block of the top hits
 * (title · date · snippet · url). Transport/HTTP failures fail loud (throw) so a
 * broken search backend infra-excludes the cell instead of silently degrading to
 * a recall-only answer; a valid-but-empty result returns an explicit "no results"
 * string the model can reason about.
 */
import type { ToolSpec } from '@tangle-network/agent-runtime/kernel'

export const webSearchTool: ToolSpec = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the live web for current facts, market data, filings, and news. Returns the top results as title, date, snippet, and URL. Call it as many times as needed, refining the query, before you answer.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Be specific — include entity, metric, period, and units.',
        },
      },
      required: ['query'],
    },
  },
}

interface SearchHit {
  title?: string
  url?: string
  snippet?: string
  publishedAt?: string
}

interface SearchResponse {
  data?: SearchHit[]
}

const formatHits = (hits: SearchHit[], maxHits: number): string => {
  if (hits.length === 0) return 'No results found for that query. Try a different query.'
  return hits
    .slice(0, maxHits)
    .map((h, i) => {
      const date = h.publishedAt ? ` (${h.publishedAt.slice(0, 10)})` : ''
      return `[${i + 1}] ${h.title ?? '(untitled)'}${date}\n${h.snippet ?? ''}\n${h.url ?? ''}`
    })
    .join('\n\n')
}

/**
 * Build the `executeToolCall` handler for a `router-tools` worker. `provider` is a
 * router search provider (`you` | `exa`). `maxHits` bounds the text folded back
 * into the model's context per call.
 */
export const makeSearchExecutor = (cfg: {
  routerBaseUrl: string
  routerKey: string
  provider: string
  maxHits?: number
}): ((name: string, args: Record<string, unknown>, task: unknown) => Promise<string>) => {
  const maxHits = cfg.maxHits ?? 6
  return async (name, args) => {
    if (name !== webSearchTool.function.name) {
      throw new Error(`search executor received unknown tool '${name}' (only '${webSearchTool.function.name}')`)
    }
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) return 'web_search requires a non-empty "query" string.'

    const res = await fetch(`${cfg.routerBaseUrl}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
      body: JSON.stringify({ provider: cfg.provider, query }),
    })
    if (!res.ok) {
      // Fail loud: a search-backend fault must infra-exclude the cell, not silently
      // become a recall-only (no-tool) answer that pollutes the capability test.
      throw new Error(`web_search ${cfg.provider} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const body = (await res.json()) as SearchResponse
    const hits = body.data ?? []
    // Tool use is a behavior worth seeing in the bench log — a research worker that
    // never searches is the failure mode this tool exists to fix.
    console.error(`  [web_search:${cfg.provider}] "${query.slice(0, 80)}" -> ${hits.length} hits`)
    return formatHits(hits, maxHits)
  }
}
