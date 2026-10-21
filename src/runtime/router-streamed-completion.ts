/** Stateful assembly of one streamed Router completion. */

import { ValidationError } from '../errors'
import {
  fetchRouterResponse,
  routerRequestHeaders,
  throwRouterFailureWithAttempts,
} from './router-http-transport'
import type { RouterConfig } from './router-request-body'
import {
  type RawUsage,
  reportedModel,
  splitReasoning,
  toolCallProviderFields,
} from './router-response'
import { resolveRouterRetryPolicy } from './router-retry-policy'
import { readChatCompletionChunksWithAttempts } from './router-sse-chunks'

/** A tool call being assembled across chunks: providers may fragment `arguments` arbitrarily. */
interface StreamingToolCall {
  id?: string
  name?: string
  arguments: string
  providerFields?: Record<string, unknown>
}

/** One streamed completion, reassembled but not yet metered. */
export interface StreamedCompletion {
  /** Visible answer with any inline `<think>` block split into `reasoning`. */
  content: string
  /** Whether any `delta.content` string arrived, including an empty one. */
  sawContent: boolean
  /** Whether any chunk carried a choice. */
  sawChoice: boolean
  reasoning?: string
  finishReason?: string
  rawUsage?: RawUsage
  model?: string
  calls: Map<number, StreamingToolCall>
  transportAttempts: number
}

/**
 * POST `body` with `stream: true` and fold the SSE chunks into one completion. Both streamed
 * transports share this reader so content, reasoning, model identity, finish reason, usage, and
 * tool-call assembly cannot drift between them.
 *
 * The caller signal stays attached through the body read: the retry layer's request deadline
 * covers only response headers, and cancelling the caller must still stop a completion that is
 * mid-stream rather than leave it reading until the provider finishes.
 */
export async function streamChatCompletion(
  context: string,
  cfg: RouterConfig,
  requestBody: Record<string, unknown>,
  opts:
    | {
        signal?: AbortSignal
        callId?: string
        correlationId?: string
        propagatedHeaders?: Readonly<Record<string, string>>
      }
    | undefined,
): Promise<StreamedCompletion> {
  const retry = resolveRouterRetryPolicy(cfg.retry, 'RouterConfig.retry')
  if (cfg.complete) {
    throw new ValidationError(
      `${context}: RouterConfig.complete is a BUFFERED transport (it returns one ` +
        'parsed completion body) and cannot serve a stream. Drop `stream` to use the injected ' +
        'transport, or drop `complete` to stream from the router.',
    )
  }
  const body = {
    ...requestBody,
    stream: true,
    // Without this an OpenAI-compatible upstream omits usage from a streamed response entirely,
    // and the turn would meter nothing. An upstream that accepts but ignores it is caught after the
    // fact by the caller's unknown-usage handling, not assumed away.
    stream_options: { include_usage: true },
  }
  const { response: res, attempts: transportAttempts } = await fetchRouterResponse(
    `${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        ...routerRequestHeaders(cfg, opts),
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    },
    opts?.signal,
    retry,
  )
  if (!res.body) {
    throwRouterFailureWithAttempts(
      new ValidationError(
        `router ${res.status}: streamed completion returned no response body to read`,
      ),
      transportAttempts,
    )
  }

  let content = ''
  let sawContent = false
  let sawChoice = false
  let fieldReasoning = ''
  let finishReason: string | undefined
  let rawUsage: RawUsage | undefined
  let observedModel: string | undefined
  const calls = new Map<number, StreamingToolCall>()
  let lastCallIndex = -1

  for await (const chunk of readChatCompletionChunksWithAttempts(
    res.body,
    transportAttempts,
    opts?.signal,
  )) {
    if (chunk.error) {
      throwRouterFailureWithAttempts(
        new ValidationError(
          `router stream error: ${chunk.error.message ?? chunk.error.type ?? 'unknown'}`,
        ),
        transportAttempts,
      )
    }
    const chunkModel = reportedModel(chunk.model)
    if (chunkModel !== undefined) {
      if (observedModel !== undefined && observedModel !== chunkModel) {
        throwRouterFailureWithAttempts(
          new ValidationError(
            `router stream changed reported model from ${JSON.stringify(observedModel)} to ${JSON.stringify(chunkModel)}`,
          ),
          transportAttempts,
        )
      }
      observedModel = chunkModel
    }
    // With `include_usage` the terminal chunk may carry usage and an EMPTY choices array.
    if (chunk.usage) rawUsage = chunk.usage
    const choice = chunk.choices?.[0]
    if (!choice) continue
    sawChoice = true
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
      const providerFields = toolCallProviderFields(tc)
      // Extension values are opaque, complete top-level fields, not argument fragments.
      // A later occurrence replaces that field; no provider-specific deep merge is inferred.
      if (providerFields) acc.providerFields = { ...acc.providerFields, ...providerFields }
      calls.set(index, acc)
    }
  }

  // A model that inlines its thinking as `<think>` in `content` is normalized the same way the
  // buffered chat path normalizes it, so a downstream parser reading `content` gets the clean answer.
  const split = splitReasoning(content, fieldReasoning.length > 0 ? fieldReasoning : undefined)
  return {
    content: split.content,
    sawContent,
    sawChoice,
    ...(split.reasoning ? { reasoning: split.reasoning } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
    ...(rawUsage ? { rawUsage } : {}),
    ...(observedModel !== undefined ? { model: observedModel } : {}),
    calls,
    transportAttempts,
  }
}

function idAlreadyOpen(calls: Map<number, StreamingToolCall>, id: string): boolean {
  for (const call of calls.values()) if (call.id === id) return true
  return false
}
