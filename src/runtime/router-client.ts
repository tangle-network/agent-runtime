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
import { ValidationError } from '../errors'
import { runBrainLoop, type ToolLoopChat } from './tool-loop'

export interface RouterConfig {
  routerBaseUrl: string
  routerKey: string
  model: string
  /**
   * Optional completion transport. When set, `routerChatWithUsage` / `routerChatWithTools` call it
   * with the OpenAI-shape request body and use the parsed `/chat/completions` JSON it returns,
   * INSTEAD of `fetch(routerBaseUrl + '/chat/completions')`. When absent the fetch path runs
   * unchanged — the live router stays the default. The injection seam an offline benchmark uses to
   * drive the worker with no network: a deterministic in-process responder satisfies it, no server.
   */
  complete?: (body: Record<string, unknown>) => Promise<unknown>
  /**
   * Ceiling for one completion, forwarded as `max_tokens`. Defaults to 8192.
   *
   * A REASONING model spends this budget on hidden thinking BEFORE it emits a visible token, so
   * the default can truncate one mid-thought and return no content at all — observed live with a
   * model that spent 8,188 of the 8,192 on reasoning and answered with nothing. Raise it for a
   * thinking model; the ceiling belongs to the router and model a caller chose, which is why it
   * lives here rather than on one call site.
   */
  maxTokens?: number
  /**
   * Take the tool-calling completion over SSE instead of one buffered POST. Off by default —
   * `routerChatWithTools` never streams, and every existing caller keeps the buffered transport
   * byte for byte.
   *
   * Why it exists: a buffered POST holds one connection idle for the WHOLE completion, and a
   * supervisor turn is the longest completion in the system. An intermediary gateway with an
   * idle-read timeout kills that connection mid-completion (the 524/503 family). A streamed
   * response puts bytes on the wire from the first generated token on, so the connection is only
   * idle through prefill. It does NOT shorten prefill, so a gateway whose deadline is
   * time-to-FIRST-byte is unaffected; only an idle-timeout gateway is.
   *
   * Mutually exclusive with `complete`: the injected transport returns one parsed JSON body and has
   * no stream to read, so setting both throws rather than silently taking the buffered path.
   *
   * WHICH PATHS CAN OPT IN. This flag is read in exactly one place (the private `chatWithTools` transport switch), so
   * every entry point that takes a caller-supplied `RouterConfig` honors it: `routerBrain`,
   * `routerToolLoop`, and `supervisorAgent` (which spreads `deps.router` into the brain's config —
   * the supervisor turn this exists for). Two production call sites build a `RouterConfig` literal
   * from their own options and therefore CANNOT express it today: the bench strategy's
   * `routerToolLoop` config in `strategy.ts` and the local sandbox client's `routerBrain` config in
   * `local-sandbox-client.ts`. Neither drives a supervisor-length turn; setting `stream` on a
   * config handed to either has no path to reach them, and they stay buffered.
   */
  stream?: boolean
}

export interface RouterChatResult {
  /** The final answer, with any inline `<think>...</think>` block stripped into `reasoning`. */
  content: string
  /**
   * Thinking-model reasoning, when the provider surfaced it — either as a separate
   * `reasoning`/`reasoning_content` message field (OpenRouter style) or inlined into
   * `content` as a `<think>` block (Groq style). Undefined for non-thinking models.
   * Downstream parsers that match single-token answers must read `content`, which is
   * clean either way; before this split, Groq-style inlining made the same model look
   * broken on one provider and fine on another.
   */
  reasoning?: string
  /** REAL usage, or undefined when the provider reported none. */
  usage?: { input: number; output: number }
  /** Derived from usage via `estimateCost` when the model is priced; else undefined. */
  costUsd?: number
}

/** One OpenAI-compatible chat completion through the Tangle router, returning text + REAL token usage (`undefined` when the provider omits it — never a fabricated 0). */
export async function routerChatWithUsage(
  cfg: RouterConfig,
  messages: Array<{ role: string; content: string }>,
  opts?: {
    temperature?: number
    signal?: AbortSignal
    maxTokens?: number
    /**
     * Reasoning control for thinking models, forwarded as `reasoning_effort`.
     * 'none' is the load-bearing value: binary/single-token decisions (routing,
     * gating) on a thinking model otherwise burn the whole token budget inside
     * the think block — on slow backends (CPU-local) that turns into a client
     * timeout, not just waste. Providers that ignore the field are handled by
     * the reasoning/content split in `parseChatResult`.
     */
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  },
): Promise<RouterChatResult> {
  const url = `${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` }
  let temperature = opts?.temperature ?? 0.2
  // max_tokens default is generous: THINKING models (kimi-k2.6) spend the budget on
  // reasoning_content first — a small router default yields EMPTY content.
  const body = (): Record<string, unknown> => ({
    model: cfg.model,
    messages,
    temperature,
    max_tokens: opts?.maxTokens ?? 8192,
    ...(opts?.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
  })
  // Injected transport short-circuits the network: the offline benchmark seam. It owns its own
  // determinism, so the fetch-specific transient-retry/temperature-handling below does not apply.
  if (cfg.complete) return parseChatResult(await cfg.complete(body()), cfg.model)
  // Retry TRANSIENT upstream failures (429/5xx) with backoff so a single capacity
  // hiccup doesn't kill a whole multi-model benchmark run; and auto-handle the
  // "only temperature 1 is allowed" 400 some thinking models (e.g. kimi-k2.6) return.
  let lastErr = ''
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body()),
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
    choices?: Array<{
      message?: { content?: string; reasoning?: string; reasoning_content?: string }
    }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const u = data.usage
  const usage =
    u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
      ? { input: u.prompt_tokens, output: u.completion_tokens }
      : undefined
  const costUsd =
    usage && isModelPriced(model) ? estimateCost(usage.input, usage.output, model) : undefined
  const msg = data.choices?.[0]?.message
  const { content, reasoning } = splitReasoning(
    msg?.content ?? '',
    msg?.reasoning ?? msg?.reasoning_content,
  )
  return {
    content,
    ...(reasoning ? { reasoning } : {}),
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}

/**
 * Normalize the two ways providers surface thinking-model reasoning into one shape:
 * a separate field (OpenRouter: `reasoning`, DeepSeek/Kimi: `reasoning_content`) or a
 * `<think>...</think>` block inlined at the head of `content` (Groq, some local runtimes).
 * An UNCLOSED `<think>` (the model hit max_tokens mid-thought) yields empty content and
 * everything as reasoning — which is honest: no final answer was emitted.
 */
function splitReasoning(
  rawContent: string,
  fieldReasoning: string | undefined,
): { content: string; reasoning?: string } {
  const open = rawContent.indexOf('<think>')
  if (open !== -1) {
    const close = rawContent.indexOf('</think>', open)
    const inline = close !== -1 ? rawContent.slice(open + 7, close) : rawContent.slice(open + 7)
    const rest =
      close !== -1
        ? rawContent.slice(0, open) + rawContent.slice(close + 8)
        : rawContent.slice(0, open)
    const reasoning = [fieldReasoning, inline.trim()].filter(Boolean).join('\n')
    return { content: rest.trim(), ...(reasoning ? { reasoning } : {}) }
  }
  return { content: rawContent, ...(fieldReasoning ? { reasoning: fieldReasoning } : {}) }
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
  /**
   * Thinking-model reasoning, normalized the way `RouterChatResult.reasoning` is (a separate
   * `reasoning_content`/`reasoning` field, or an inline `<think>` block split out of `content`).
   * Populated by the STREAMED path only — `routerChatWithTools` discards reasoning today and its
   * behavior is preserved unchanged, so a buffered turn still leaves this undefined.
   */
  reasoning?: string
  /**
   * The provider's `finish_reason` for the turn (`'stop'`, `'tool_calls'`, `'length'`, …).
   * Populated by the STREAMED path only. `'length'` is the truncation signal the buffered path
   * cannot surface: it says the turn hit `max_tokens`, not that the model chose to stop.
   */
  finishReason?: string
  /**
   * The turn happened and its token usage is UNKNOWN — not zero, not free. Set by the STREAMED
   * transport when the stream ran to completion without a single usage-bearing chunk, which means
   * the `stream_options.include_usage` contract was not honored upstream.
   *
   * It exists so a bare `usage: undefined` cannot read as a free turn: a metering caller branches
   * on this marker and records an UNKNOWN turn (see the coordination driver's `meteredBrain`),
   * rather than skipping the turn and letting a conserved budget pool believe it cost nothing.
   */
  usageUnknown?: true
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
  const body = toolCompletionBody(cfg, messages, tools, opts)
  // Injected transport short-circuits the network — the offline benchmark seam (see RouterConfig.complete).
  const raw = cfg.complete
    ? await cfg.complete(structuredClone(body))
    : await (async () => {
        const res = await fetch(`${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
          body: JSON.stringify(body),
          ...(opts?.signal ? { signal: opts.signal } : {}),
        })
        if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
        return res.json()
      })()
  const data = raw as {
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
  const { usage, costUsd } = meterTurn(data.usage, cfg.model)
  return {
    content: msg?.content ?? null,
    toolCalls,
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}

/** The OpenAI-shape request body both tool-calling transports send. One builder so the streamed
 *  turn cannot drift from the buffered one on model, temperature, tool_choice, or the ceiling. */
function toolCompletionBody(
  cfg: RouterConfig,
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: ReadonlyArray<ToolSpec>,
  opts?: { temperature?: number; toolChoice?: 'auto' | 'required' | 'none'; maxTokens?: number },
): Record<string, unknown> {
  return {
    model: cfg.model,
    messages,
    tools,
    tool_choice: opts?.toolChoice ?? 'auto',
    temperature: opts?.temperature ?? 0.3,
    ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  }
}

/**
 * REAL usage → the metered pair, or `undefined` when the provider reported none. Never a
 * fabricated 0: a phantom 0 reads as a free call to the conserved budget pool, which would then
 * over-spend. Shared by the buffered and streamed transports so both meter identically.
 */
function meterTurn(
  raw: RawUsage | undefined,
  model: string,
): { usage?: { input: number; output: number }; costUsd?: number; cache?: PromptCacheUsage } {
  const usage =
    raw && typeof raw.prompt_tokens === 'number' && typeof raw.completion_tokens === 'number'
      ? { input: raw.prompt_tokens, output: raw.completion_tokens }
      : undefined
  if (!usage) return {}
  const localEstimate = isModelPriced(model)
    ? estimateCost(usage.input, usage.output, model)
    : undefined
  const cache = readPromptCache(raw?.prompt_cache)
  // A cached prefix token is billed at a discount the local price table does not know about, so
  // subtract the provider's OWN reported saving rather than re-deriving a discount here. Without
  // this a long supervisor run — which re-sends a growing transcript every turn — is reported at
  // full price for tokens the provider served from cache.
  const costUsd =
    localEstimate !== undefined && cache?.readSavingsUsd !== undefined
      ? Math.max(0, localEstimate - cache.readSavingsUsd)
      : localEstimate
  return {
    usage,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(cache ? { cache } : {}),
  }
}

/** What the router reports about prefix caching for one completion. Absent when the provider
 *  said nothing — an unreported cache is not a miss, and a miss is not a zero saving. */
export interface PromptCacheUsage {
  /** Prompt tokens served from a cached prefix. */
  readonly readTokens: number
  /** Prompt tokens written INTO the cache by this call. */
  readonly writeTokens: number
  /** Dollars the provider says the cache read saved on this call. */
  readonly readSavingsUsd?: number
  /** The provider's own word for what happened: `hit`, `miss`, `read`, … Kept verbatim rather
   *  than normalized, so a new status is visible instead of silently bucketed. */
  readonly status?: string
}

interface RawUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache?: unknown
}

function readPromptCache(raw: unknown): PromptCacheUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const readTokens = num(o.read_tokens)
  const writeTokens = num(o.write_tokens)
  if (readTokens === undefined && writeTokens === undefined) return undefined
  const savings = num(o.read_savings_usd)
  return {
    readTokens: readTokens ?? 0,
    writeTokens: writeTokens ?? 0,
    ...(savings !== undefined ? { readSavingsUsd: savings } : {}),
    ...(typeof o.status === 'string' ? { status: o.status } : {}),
  }
}

// ── Streamed tool-calling transport ──────────────────────────────────────────

/** One OpenAI chat-completion chunk. Every field here is exercised by the pinned SSE fixture the
 *  streamed-transport tests read (`tests/kernel/fixtures/router-chat-completion-stream.sse`):
 *  `delta.reasoning_content` token-by-token, one `delta.tool_calls` entry carrying
 *  `index`/`id`/`function`, then a terminal chunk with `finish_reason` + `usage`. */
interface ChatCompletionChunk {
  choices?: Array<{
    index?: number
    finish_reason?: string | null
    delta?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string; type?: string }
}

/** A tool call being assembled across chunks: providers may fragment `arguments` arbitrarily. */
interface StreamingToolCall {
  id?: string
  name?: string
  arguments: string
}

/**
 * The SAME completion as `routerChatWithTools`, taken over SSE (`stream: true`) and reassembled
 * into the identical `RouterChatToolsResult`. Opt in with `RouterConfig.stream` — the buffered
 * function is untouched and stays the default for every existing caller.
 *
 * What it buys: a buffered POST holds one connection idle for the whole completion, and that idle
 * window is what an intermediary gateway kills (524/503). Streaming puts bytes on the wire from the
 * first generated token, so the connection is only idle through prefill.
 *
 * Usage accounting is preserved exactly: `stream_options.include_usage` asks the provider for a
 * terminal usage chunk, and those tokens run through the same `meterTurn` the buffered path uses.
 *
 * When NO chunk reported usage, `usage`/`costUsd` stay undefined (never a fabricated 0) AND
 * `usageUnknown: true` is set. A stream that finishes with no usage chunk means the
 * `include_usage` request was not honored upstream, and returning a quiet `undefined` for it is
 * indistinguishable from a free turn — the marker is what lets a metering caller record an UNKNOWN
 * turn instead. Streaming raises the odds of this (one dropped terminal frame is enough), which is
 * why the streamed transport says so explicitly and the buffered one has no equivalent claim to make.
 */
export async function streamRouterChatWithTools(
  cfg: RouterConfig,
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: ReadonlyArray<ToolSpec>,
  opts?: {
    temperature?: number
    signal?: AbortSignal
    toolChoice?: 'auto' | 'required' | 'none'
    maxTokens?: number
  },
): Promise<RouterChatToolsResult> {
  if (cfg.complete) {
    throw new ValidationError(
      'streamRouterChatWithTools: RouterConfig.complete is a BUFFERED transport (it returns one ' +
        'parsed completion body) and cannot serve a stream. Drop `stream` to use the injected ' +
        'transport, or drop `complete` to stream from the router.',
    )
  }
  const body = {
    ...toolCompletionBody(cfg, messages, tools, opts),
    stream: true,
    // Without this an OpenAI-compatible upstream omits usage from a streamed response entirely,
    // and the turn would meter nothing. An upstream that accepts but ignores it is caught after the
    // fact by `usageUnknown`, not assumed away.
    stream_options: { include_usage: true },
  }
  const res = await fetch(`${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.routerKey}`,
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })
  // Identical failure surface to the buffered path: fail loud on any non-2xx, same message shape.
  if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
  if (!res.body) {
    throw new ValidationError(
      `router ${res.status}: streamed completion returned no response body to read`,
    )
  }

  let content = ''
  let sawContent = false
  let fieldReasoning = ''
  let finishReason: string | undefined
  let rawUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined
  const calls = new Map<number, StreamingToolCall>()
  let lastCallIndex = -1

  for await (const chunk of readChatCompletionChunks(res.body)) {
    if (chunk.error) {
      throw new ValidationError(
        `router stream error: ${chunk.error.message ?? chunk.error.type ?? 'unknown'}`,
      )
    }
    // With `include_usage` the terminal chunk may carry usage and an EMPTY choices array.
    if (chunk.usage) rawUsage = chunk.usage
    const choice = chunk.choices?.[0]
    if (!choice) continue
    if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
    const delta = choice.delta
    if (!delta) continue
    // An EMPTY content delta still counts as content having been emitted. The buffered path maps
    // `content: ""` to `''` and only an ABSENT field to `null` (`msg?.content ?? null`); treating an
    // empty delta as "no content" would return `null` where the buffered path returns `''`, so the
    // two transports would disagree on a tool-calls-only turn.
    if (typeof delta.content === 'string') {
      content += delta.content
      sawContent = true
    }
    const reasoningDelta = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoningDelta === 'string') fieldReasoning += reasoningDelta
    for (const tc of delta.tool_calls ?? []) {
      // `index` is the provider's slot for the call. Absent (some proxies drop it), a fragment
      // belongs to the call it is continuing — a NEW `id` opens the next slot, no id continues the
      // current one. Guessing a slot would silently merge two calls' arguments into one.
      const index =
        typeof tc.index === 'number'
          ? tc.index
          : tc.id && !idAlreadyOpen(calls, tc.id)
            ? lastCallIndex + 1
            : Math.max(lastCallIndex, 0)
      lastCallIndex = Math.max(lastCallIndex, index)
      const acc = calls.get(index) ?? { arguments: '' }
      if (tc.id) acc.id = tc.id
      if (tc.function?.name) acc.name = tc.function.name
      if (tc.function?.arguments) acc.arguments += tc.function.arguments
      calls.set(index, acc)
    }
  }

  // A model that inlines its thinking as `<think>` in `content` is normalized the same way the
  // chat path normalizes it, so a downstream parser reading `content` gets the clean answer.
  const split = splitReasoning(content, fieldReasoning.length > 0 ? fieldReasoning : undefined)
  const toolCalls: RouterToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, call]) => ({
      id: call.id ?? `call_${index}`,
      name: call.name ?? '',
      arguments: call.arguments || '{}',
    }))
  const { usage, costUsd } = meterTurn(rawUsage, cfg.model)
  return {
    // `null` only when NO content field was ever sent — the buffered path's `msg?.content ?? null`.
    content: sawContent ? split.content : null,
    toolCalls,
    ...(split.reasoning ? { reasoning: split.reasoning } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    // The turn ran; its tokens are unknown. Marked rather than left as a bare `undefined`, which a
    // metering caller cannot tell apart from a turn that genuinely cost nothing.
    ...(usage ? {} : { usageUnknown: true as const }),
  }
}

function idAlreadyOpen(calls: Map<number, StreamingToolCall>, id: string): boolean {
  for (const call of calls.values()) if (call.id === id) return true
  return false
}

/**
 * Decode an SSE body into chat-completion chunks. Frames are blank-line separated; `data:` lines
 * concatenate; `:` comments are keepalives; `[DONE]` ends the stream. The unterminated tail is
 * parsed too — an upstream that dies mid-response routinely sends a last frame with no trailing
 * blank line, and dropping it would turn a real upstream error into a silent empty turn.
 *
 * All three SSE line terminators (CRLF, LF, lone CR) are normalized, and the boundary scan runs
 * over the ACCUMULATED buffer — never over a single read in isolation, because a read may split a
 * CRLF. See `normalizeSseLineEndings`; the split is exercised byte-by-byte by the tests.
 *
 * The generator OWNS the body for its lifetime and releases it on every exit. Stopping early —
 * at `[DONE]`, or because the consumer threw — leaves the HTTP response only partly read, so the
 * body is CANCELLED rather than merely unlocked: releasing the lock alone leaves the connection
 * held open until the socket times out, which under a connection pool starves later turns.
 */
async function* readChatCompletionChunks(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ChatCompletionChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  // Set only when a read reported EOF: the body is then already exhausted and cancelling it is
  // both unnecessary and a no-op. Any other exit leaves bytes on the wire.
  let drained = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buf = normalizeSseLineEndings(
        done ? buf : buf + decoder.decode(value, { stream: true }),
        // While the stream is live a trailing `\r` is ambiguous; at EOF it is a terminator.
        !done,
      )
      let sep = buf.indexOf('\n\n')
      while (sep !== -1) {
        const frame = parseChunkFrame(buf.slice(0, sep))
        buf = buf.slice(sep + 2)
        if (frame === 'done') return
        if (frame) yield frame
        sep = buf.indexOf('\n\n')
      }
      if (done) break
    }
    drained = true
    const tail = parseChunkFrame(buf)
    if (tail && tail !== 'done') yield tail
  } finally {
    if (!drained) {
      // `cancel()` REJECTS when the body is already errored (a dead socket). That is cleanup on a
      // path that already carries either a complete result or an error of its own, and letting the
      // rejection escape `finally` would REPLACE that error with a less specific one. The
      // connection is released either way, which is the whole reason cancel is called.
      await reader.cancel().catch(() => undefined)
    }
    reader.releaseLock()
  }
}

/**
 * Normalize an SSE body's line terminators to `\n`. The SSE grammar accepts CRLF, LF, AND a lone
 * CR, so a `\r`-separated body is legal — and left unnormalized it decodes to zero frames, which
 * this transport would report as a turn with no content, no tool calls, and `usageUnknown: true`
 * and no error at all. Losing a whole turn in silence is the one outcome it may not produce.
 *
 * `holdTrailingCr` keeps an ambiguous FINAL `\r` out of the conversion while more bytes may still
 * arrive: rewriting it to `\n` before the next byte is seen turns a read-split CRLF into a FALSE
 * frame boundary, splitting one frame into two unparseable halves. At EOF nothing can follow it,
 * so it is converted. Re-running this over the accumulated buffer is idempotent.
 */
function normalizeSseLineEndings(buf: string, holdTrailingCr: boolean): string {
  if (holdTrailingCr && buf.endsWith('\r')) {
    return `${buf.slice(0, -1).replace(/\r\n?/g, '\n')}\r`
  }
  return buf.replace(/\r\n?/g, '\n')
}

/** One SSE frame → a chunk, `'done'`, or undefined for a comment/keepalive/unparseable payload. */
function parseChunkFrame(frame: string): ChatCompletionChunk | 'done' | undefined {
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart())
  }
  if (dataLines.length === 0) return undefined
  const data = dataLines.join('\n')
  if (data === '[DONE]') return 'done'
  try {
    return JSON.parse(data) as ChatCompletionChunk
  } catch {
    return undefined
  }
}

/** Pick the tool-calling transport the config asked for. `routerChatWithTools` itself never
 *  streams; this is the one place `RouterConfig.stream` is honored, so every router-client entry
 *  point (`routerBrain`, `routerToolLoop`) obeys the same switch. */
function chatWithTools(
  cfg: RouterConfig,
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: ReadonlyArray<ToolSpec>,
  opts?: {
    temperature?: number
    signal?: AbortSignal
    toolChoice?: 'auto' | 'required' | 'none'
    maxTokens?: number
  },
): Promise<RouterChatToolsResult> {
  return cfg.stream === true
    ? streamRouterChatWithTools(cfg, messages, tools, opts)
    : routerChatWithTools(cfg, messages, tools, opts)
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
  // The router adapter over the canonical `runBrainLoop`: bind the inference to the router
  // (`routerChatWithTools`), seed the conversation, and let the one shared skeleton drive.
  const initialMessages = opts?.initialMessages ?? [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
  return runBrainLoop({
    chat: (messages, toolSpecs) =>
      chatWithTools(cfg, messages, toolSpecs, {
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

/**
 * The router as a supervisor BRAIN: the canonical `ToolLoopChat` seam backed by the router's
 * tool-calling. The driver's spawn/observe/steer/await/stop turns become real router tool-calls.
 * The turnkey production brain — tests script a mock `ToolLoopChat`; production passes
 * `routerBrain(cfg)`. No message translation: the loop already speaks the router's OpenAI shape.
 *
 * Transport follows `cfg.stream`: buffered by default, SSE when the caller opts in. A supervisor
 * turn is the longest completion in the system, so it is the call site streaming exists for.
 */
export function routerBrain(cfg: RouterConfig, opts: { temperature?: number } = {}): ToolLoopChat {
  const temperature = opts.temperature ?? 0.4
  return (messages, tools) =>
    chatWithTools(cfg, messages, tools, {
      temperature,
      toolChoice: 'auto',
      // The config's ceiling reaches the completion, so a caller driving a reasoning model can
      // raise it. Without this a router-brained supervisor is stuck on the 8192 default.
      ...(cfg.maxTokens !== undefined ? { maxTokens: cfg.maxTokens } : {}),
    })
}
