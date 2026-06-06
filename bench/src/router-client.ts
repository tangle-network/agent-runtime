/**
 * One router chat-with-usage primitive (was copy-pasted across the CAD/browser
 * workers and the spawn research worker). A direct OpenAI-compatible completion
 * through the Tangle router — the cheapest dial, no sandbox, no tools.
 *
 * Reports REAL token usage so the backend-integrity guard sees a real backend.
 * Returns `undefined` usage when the provider omitted it — never a fabricated 0
 * (a phantom 0 reads as a free call downstream, which the gate would act on).
 */

import { estimateCost, isModelPriced } from '@tangle-network/agent-eval'

export interface RouterConfig {
  routerBaseUrl: string
  routerKey: string
  model: string
}

export interface RouterChatResult {
  content: string
  /** REAL usage, or undefined when the provider reported none. */
  usage?: { input: number; output: number }
  /** Derived from usage via `estimateCost` when the model is priced; else undefined. */
  costUsd?: number
}

export async function routerChatWithUsage(
  cfg: RouterConfig,
  messages: Array<{ role: string; content: string }>,
  opts?: { temperature?: number; signal?: AbortSignal },
): Promise<RouterChatResult> {
  const url = `${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` }
  let temperature = opts?.temperature ?? 0.2
  // Retry TRANSIENT upstream failures (429/5xx) with backoff so a single capacity
  // hiccup doesn't kill a whole multi-model benchmark run; and auto-handle the
  // "only temperature 1 is allowed" 400 some thinking models (e.g. kimi-k2.6) return.
  let lastErr = ''
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model, messages, temperature }),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    })
    if (res.ok) return parseChatResult(await res.json(), cfg.model)
    const status = res.status
    const text = (await res.text()).slice(0, 200)
    lastErr = `router ${status}: ${text}`
    if (status === 400 && /temperature/i.test(text) && temperature !== 1) {
      temperature = 1 // model requires temperature 1 — retry once with it
      continue
    }
    // Non-retryable (auth/quota/malformed) fails loud immediately; retryable
    // statuses back off and continue until the loop's attempt bound, then the
    // post-loop throw is the honest "exhausted retries" terminal. 408/425 + the
    // Cloudflare-origin family (520/522/524) are transient under heavy parallel
    // load — a fleet of concurrent gate runs hits 524 ("origin timeout") and must
    // retry, not crash the whole run.
    if (![408, 425, 429, 500, 502, 503, 504, 520, 522, 524].includes(status)) throw new Error(lastErr)
    if (attempt < 4) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt))
  }
  throw new Error(`${lastErr} (exhausted retries)`)
}

function parseChatResult(json: unknown, model: string): RouterChatResult {
  const data = json as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const u = data.usage
  const usage =
    u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
      ? { input: u.prompt_tokens, output: u.completion_tokens }
      : undefined
  const costUsd = usage && isModelPriced(model) ? estimateCost(usage.input, usage.output, model) : undefined
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}

/** A tool-call the model emitted (provider-neutral; mirrors the runtime's ToolCallRequest). */
export interface RouterToolCall {
  id: string
  name: string
  /** Raw JSON arguments string as emitted by the model. */
  arguments: string
}

export interface RouterChatToolsResult {
  content: string | null
  toolCalls: RouterToolCall[]
  usage?: { input: number; output: number }
  costUsd?: number
}

/**
 * A router completion WITH tool-calling — the operator driver's LLM seam. Passes OpenAI-shape
 * `messages` (system/user/assistant-with-tool_calls/tool roles) + function `tools`, and returns the
 * assistant text plus the tool calls the model wants run. Same fail-loud + real-usage discipline as
 * `routerChatWithUsage`. `tool_choice: 'auto'` lets the model decide; the driver loops on the result.
 */
export async function routerChatWithTools(
  cfg: RouterConfig,
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: ReadonlyArray<{ type: 'function'; function: { name: string; description?: string; parameters: unknown } }>,
  opts?: { temperature?: number; signal?: AbortSignal; toolChoice?: 'auto' | 'required' | 'none' },
): Promise<RouterChatToolsResult> {
  const res = await fetch(`${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
    body: JSON.stringify({ model: cfg.model, messages, tools, tool_choice: opts?.toolChoice ?? 'auto', temperature: opts?.temperature ?? 0.3 }),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })
  if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const msg = data.choices?.[0]?.message
  const toolCalls: RouterToolCall[] = (msg?.tool_calls ?? []).map((tc, i) => ({
    id: tc.id ?? `call_${i}`,
    name: tc.function?.name ?? '',
    arguments: tc.function?.arguments ?? '{}',
  }))
  const u = data.usage
  const usage =
    u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
      ? { input: u.prompt_tokens, output: u.completion_tokens }
      : undefined
  const costUsd = usage && isModelPriced(cfg.model) ? estimateCost(usage.input, usage.output, cfg.model) : undefined
  return {
    content: msg?.content ?? null,
    toolCalls,
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}
