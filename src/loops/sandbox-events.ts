/**
 * Sandbox-event → runtime-event mapping.
 *
 * The sandbox SDK emits a polymorphic `SandboxEvent = { type, data, id? }`
 * whose `type` vocabulary is backend-determined (opencode, etc.) rather than
 * enumerated by the SDK. Two consumers project it:
 *   - the loop kernel's cost ledger (`extractLlmCallEvent`) — sums usage off
 *     every cost-bearing event, regardless of stream shape;
 *   - the `AgentRuntime.act` streaming contract (`mapSandboxEvent`) — projects
 *     incremental events to the `RuntimeStreamEvent` chat-UX vocabulary.
 *
 * Both live here so the empirically-observed `type` vocabulary has one home.
 */

import type { SandboxEvent } from '@tangle-network/sandbox'
import type { RuntimeStreamEvent } from '../types'

/**
 * Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when
 * the event carries usage/cost data. Returns `undefined` for non-cost events
 * so the kernel can iterate the full stream without branching.
 *
 * Canonical cost-carrying types observed in the wild:
 *   - `llm_call` — `data: { model, tokensIn, tokensOut, costUsd, ... }`
 *   - `message.completed` / `result` — `data: { usage: { inputTokens,
 *      outputTokens, totalCostUsd? } }`
 *   - `cost.usage` / `usage` — same shape under a dedicated type
 *
 * Numeric coercion is strict: `Number.isFinite` gates every accumulator write
 * so a sentinel `NaN` from a misbehaving backend cannot poison the ledger.
 */
export function extractLlmCallEvent(
  event: SandboxEvent,
  agentRunName: string,
): (RuntimeStreamEvent & { type: 'llm_call' }) | undefined {
  if (!event || typeof event !== 'object') return undefined
  const type = String(event.type ?? '')
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  if (type === 'llm_call' || type === 'cost.usage' || type === 'usage') {
    return buildLlmCall(data, agentRunName)
  }
  if (type === 'message.completed' || type === 'result' || type === 'final') {
    const usage = data.usage as Record<string, unknown> | undefined
    if (!usage || typeof usage !== 'object') return undefined
    return buildLlmCall({ ...usage, model: data.model ?? usage.model }, agentRunName)
  }
  return undefined
}

function buildLlmCall(
  data: Record<string, unknown>,
  agentRunName: string,
): (RuntimeStreamEvent & { type: 'llm_call' }) | undefined {
  const tokensIn = pickFiniteNumber(data, ['tokensIn', 'inputTokens', 'prompt_tokens'])
  const tokensOut = pickFiniteNumber(data, ['tokensOut', 'outputTokens', 'completion_tokens'])
  const costUsd = pickFiniteNumber(data, ['costUsd', 'totalCostUsd', 'cost_usd', 'cost'])
  if (tokensIn === undefined && tokensOut === undefined && costUsd === undefined) {
    return undefined
  }
  const model = typeof data.model === 'string' && data.model.length > 0 ? data.model : agentRunName
  const event: RuntimeStreamEvent & { type: 'llm_call' } = {
    type: 'llm_call',
    model,
  }
  if (tokensIn !== undefined) event.tokensIn = tokensIn
  if (tokensOut !== undefined) event.tokensOut = tokensOut
  if (costUsd !== undefined) event.costUsd = costUsd
  return event
}

function pickFiniteNumber(data: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * Project one `SandboxEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary,
 * for runtimes that bridge a sandbox `streamPrompt` into the
 * `AgentRuntime.act` streaming contract. Returns `undefined` for events that
 * have no faithful projection — the raw stream is preserved separately for the
 * `OutputAdapter`, so an unmapped event never loses data.
 *
 * Mapped (the task-optional incremental variants — no synthesized task
 * lifecycle, no guessed tool-part shapes):
 *   - `message.part.updated` text part → `text_delta`
 *   - `message.part.updated` reasoning/thinking part → `reasoning_delta`
 *   - cost-bearing events → `llm_call` (shared with the ledger extractor)
 *
 * The opencode backend emits incremental text as
 * `{ type: 'message.part.updated', data: { part: { type, text }, delta } }`;
 * `delta` is the increment, `part.text` the running accumulation.
 */
export function mapSandboxEvent(
  event: SandboxEvent,
  opts: { agentRunName?: string } = {},
): RuntimeStreamEvent | undefined {
  if (!event || typeof event !== 'object') return undefined
  const type = String(event.type ?? '')
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  if (type === 'message.part.updated') {
    const part =
      data.part && typeof data.part === 'object' ? (data.part as Record<string, unknown>) : {}
    const partType = String(part.type ?? '')
    const delta = typeof data.delta === 'string' ? data.delta : undefined
    const text = delta ?? (typeof part.text === 'string' ? part.text : undefined)
    if (text === undefined) return undefined
    if (partType === 'text') return { type: 'text_delta', text }
    if (partType === 'reasoning' || partType === 'thinking')
      return { type: 'reasoning_delta', text }
    return undefined
  }

  return extractLlmCallEvent(event, opts.agentRunName ?? 'agent')
}
