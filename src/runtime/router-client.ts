/**
 * The one router chat client: direct OpenAI-compatible completions through the
 * Tangle router — the cheapest dial, no sandbox. Three layers: `routerChatWithUsage`
 * (chat-only), `routerChatWithTools` (one completion with function tools), and
 * `routerToolLoop` (the off-box agentic loop over tool-calling). Shared by the
 * built-in executors and the bench/lab harnesses.
 *
 * Reports REAL token usage so the backend-integrity guard sees a real backend.
 * Returns `undefined` usage when the provider omitted it — never a fabricated 0
 * (a phantom 0 reads as a free call downstream, which the gate would act on).
 */

import { estimateCost, isModelPriced } from '@tangle-network/agent-eval'
import { runToolLoop } from './tool-loop'

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
  opts?: { temperature?: number; signal?: AbortSignal; maxTokens?: number },
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
      // max_tokens default is generous: THINKING models (kimi-k2.6) spend the budget on
      // reasoning_content first — a small router default yields EMPTY content.
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature,
        max_tokens: opts?.maxTokens ?? 8192,
      }),
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
    if (![408, 425, 429, 500, 502, 503, 504, 520, 522, 524].includes(status))
      throw new Error(lastErr)
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
  const costUsd =
    usage && isModelPriced(model) ? estimateCost(usage.input, usage.output, model) : undefined
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
  tools: ReadonlyArray<{
    type: 'function'
    function: { name: string; description?: string; parameters: unknown }
  }>,
  opts?: {
    temperature?: number
    signal?: AbortSignal
    toolChoice?: 'auto' | 'required' | 'none'
    maxTokens?: number
  },
): Promise<RouterChatToolsResult> {
  const res = await fetch(`${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      tools,
      tool_choice: opts?.toolChoice ?? 'auto',
      temperature: opts?.temperature ?? 0.3,
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })
  if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
      }
    }>
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
  const costUsd =
    usage && isModelPriced(cfg.model)
      ? estimateCost(usage.input, usage.output, cfg.model)
      : undefined
  return {
    content: msg?.content ?? null,
    toolCalls,
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}

export interface ToolSpec {
  type: 'function'
  function: { name: string; description?: string; parameters: unknown }
}

export interface RouterToolLoopResult {
  /** The model's final assistant text (the turn where it stopped calling tools, or the budget turn). */
  final: string
  /** Inference turns spent (≤ maxTurns) — the equal-budget unit vs random@k. */
  turns: number
  toolCalls: number
  /** The behavior trace: each tool call + its result, in order. What a trace-analyst
   *  steerer reads (behavior, never the verdict) to diagnose + redirect the next shot. */
  toolTrace: Array<{ name: string; args: string; result: string }>
  usage: { input: number; output: number }
  /** The full conversation after the loop (seed + every assistant/tool turn). Lets a caller
   *  CARRY the messages into the next shot (depth continuation) and read the trajectory. */
  messages: Array<Record<string, unknown>>
}

/**
 * The tool-using router backend: a real agentic loop OVER the Tangle router (which
 * supports tool-calling), off-box — no sandbox. Each turn is one router completion
 * with `tools`; if the model emits tool_calls, `execute` runs them on the host and
 * their results are folded back as `tool` messages; the loop repeats until the
 * model answers without a tool call or the turn budget is hit. One turn = one
 * inference call, so `maxTurns` is the equal-compute unit against random@k.
 *
 * This is the depth substrate for agentic gates (the worker ACTS, observes the real
 * result, and continues) that the chat-only `routerChatWithUsage` cannot express.
 */
export async function routerToolLoop(
  cfg: RouterConfig,
  system: string,
  user: string,
  tools: ReadonlyArray<ToolSpec>,
  execute: (name: string, args: Record<string, unknown>) => Promise<string>,
  opts?: {
    maxTurns?: number
    temperature?: number
    signal?: AbortSignal
    maxTokens?: number
    /** Seed the loop with an existing conversation (depth continuation) instead of
     *  `[system, user]`. When set, `system`/`user` are ignored. The array is copied. */
    initialMessages?: ReadonlyArray<Record<string, unknown>>
  },
): Promise<RouterToolLoopResult> {
  // The router adapter over the canonical `runToolLoop`: bind the inference to the router
  // (`routerChatWithTools`), seed the conversation, and let the one shared skeleton drive.
  const initialMessages = opts?.initialMessages ?? [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
  return runToolLoop({
    chat: (messages, toolSpecs) =>
      routerChatWithTools(cfg, messages, toolSpecs, {
        ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts?.maxTokens ? { maxTokens: opts.maxTokens } : {}),
        ...(opts?.signal ? { signal: opts.signal } : {}),
      }),
    tools,
    execute,
    initialMessages,
    maxTurns: opts?.maxTurns ?? 4,
  })
}
