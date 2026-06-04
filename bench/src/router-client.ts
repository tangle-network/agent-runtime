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
  const res = await fetch(`${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: opts?.temperature ?? 0.2 }),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })
  if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const u = data.usage
  const usage =
    u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
      ? { input: u.prompt_tokens, output: u.completion_tokens }
      : undefined
  const costUsd = usage && isModelPriced(cfg.model) ? estimateCost(usage.input, usage.output, cfg.model) : undefined
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}
