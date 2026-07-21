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
  // sandbox 0.4.0 terminal event: `data = { tokenUsage: { inputTokens, outputTokens,
  // reasoningTokens, cacheReadInputTokens }, totalCostUsd }`. Usage lives under
  // `tokenUsage` (not `usage`) and the cost is top-level — neither matched the
  // branches above, so an in-process loopDispatch run reported {0,0} and the
  // backend-integrity guard misread a real run as a stub. Reasoning tokens are
  // billed output (reasoning models), so they fold into the output count.
  if (type === 'done') {
    const usage = data.tokenUsage as Record<string, unknown> | undefined
    if (!usage || typeof usage !== 'object') return undefined
    const out = pickFiniteNumber(usage, ['outputTokens', 'completion_tokens', 'tokensOut'])
    const reasoning = pickFiniteNumber(usage, ['reasoningTokens'])
    const mergedOut =
      out !== undefined || reasoning !== undefined ? (out ?? 0) + (reasoning ?? 0) : undefined
    return buildLlmCall(
      {
        inputTokens: usage.inputTokens,
        outputTokens: mergedOut,
        totalCostUsd: data.totalCostUsd,
        model: data.model ?? usage.model,
      },
      agentRunName,
    )
  }
  return undefined
}

/**
 * Sum the token usage + USD cost of a sandbox turn's events — the one honest way to meter an
 * `openSandboxRun` cell. Folds `extractLlmCallEvent` over the stream (which reads usage off EVERY backend
 * event shape), so a `runProfileMatrix` dispatch can report it to `ctx.cost`:
 *
 *     receipt: (turn) => {
 *       const u = sumSandboxUsage(turn.events)
 *       return { model, inputTokens: u.input, outputTokens: u.output,
 *         ...(u.costUsd > 0 ? { actualCostUsd: u.costUsd } : {}) }
 *     }
 *
 * Without this a cell reads `{tokens:0, cost:0}` and the backend-integrity guard correctly aborts the
 * matrix as a stub. `agentRunName` is the fallback model label for cost-only events (default `'agent'`).
 */
export function sumSandboxUsage(
  events: readonly SandboxEvent[],
  agentRunName = 'agent',
): { input: number; output: number; costUsd: number } {
  let input = 0
  let output = 0
  let costUsd = 0
  for (const ev of events) {
    const call = extractLlmCallEvent(ev, agentRunName)
    if (!call) continue
    input += call.tokensIn ?? 0
    output += call.tokensOut ?? 0
    costUsd += call.costUsd ?? 0
  }
  return { input, output, costUsd }
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
 * Cross-event state for {@link mapSandboxToolEvent}. Sandbox backends emit a
 * tool invocation as MANY `message.part.updated` frames on the same call id
 * (pending → running → completed), so faithful projection needs per-call
 * status memory: one `tool_call` on first sighting, at most one `tool_result`
 * on the terminal transition, nothing on intermediate re-frames. Create one
 * state per turn via {@link createSandboxToolPartState}.
 *
 * @experimental
 */
export interface SandboxToolPartState {
  /** Last seen status per tool call id. A terminal status is sticky — later
   *  frames on a settled call project to nothing. */
  statusByCall: Map<string, string>
  /** Sequence for synthesized call ids when an event carries none. */
  seq: number
}

/**
 * Fresh per-turn {@link SandboxToolPartState} for {@link mapSandboxToolEvent} — an
 * empty call-status map so each turn projects tool frames independently.
 *
 * @experimental
 */
export function createSandboxToolPartState(): SandboxToolPartState {
  return { statusByCall: new Map(), seq: 0 }
}

/** Terminal tool statuses that are failures (everything here settles the call). */
const TERMINAL_TOOL_FAILURE =
  /^(error|errored|failed|failure|cancelled|canceled|timeout|timed_out)$/i

/**
 * Project one `SandboxEvent` onto the `tool_call` / `tool_result` variants of
 * `RuntimeStreamEvent` — the tool-part projection `mapSandboxEvent`
 * deliberately does NOT perform. Opt-in and additive: `mapSandboxEvent`'s
 * default vocabulary (text/reasoning deltas + `llm_call`) is unchanged;
 * consumers that need the tool surface (chat UIs rendering tool activity)
 * compose this projector alongside it — `streamAgentTurn` does exactly that
 * under its `preserveToolParts` option.
 *
 * Handled shapes (observed on the opencode / claude-code sandbox backends):
 *   - `message.part.updated` with `part.type === 'tool'` — stateful: a
 *     `tool_call` on the call id's first frame (args from `state.input` or
 *     `state.metadata.input`), a `tool_result` when the status transitions to
 *     `completed` (result from `state.output` / `metadata.output`) or to a
 *     terminal failure (result is `{ error, status, output? }` — the error
 *     surfaced in-band, never dropped).
 *   - bare `tool*` event types (`tool.call`, `tool_result`, …) — stateless:
 *     `*result*` types project to `tool_result`, the rest to `tool_call`.
 *
 * Returns `[]` for every non-tool event.
 *
 * @experimental
 */
export function mapSandboxToolEvent(
  event: SandboxEvent,
  state: SandboxToolPartState,
): (RuntimeStreamEvent & { type: 'tool_call' | 'tool_result' })[] {
  if (!event || typeof event !== 'object') return []
  const type = String(event.type ?? '')
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  if (type === 'message.part.updated') {
    const part =
      data.part && typeof data.part === 'object' ? (data.part as Record<string, unknown>) : {}
    if (String(part.type ?? '') !== 'tool') return []
    return projectToolPart(part, state, typeof event.id === 'string' ? event.id : undefined)
  }

  if (type.includes('tool')) {
    const callId =
      pickString(data, ['toolCallId', 'tool_use_id', 'id']) ??
      (typeof event.id === 'string' ? event.id : undefined) ??
      `sandbox-tool-${++state.seq}`
    const toolName = pickString(data, ['name', 'toolName', 'tool']) ?? 'sandbox_tool'
    if (type.includes('result')) {
      return [
        {
          type: 'tool_result',
          toolName,
          toolCallId: callId,
          result: data.output ?? data.result ?? data.content ?? data,
        },
      ]
    }
    return [
      { type: 'tool_call', toolName, toolCallId: callId, args: data.input ?? data.args ?? {} },
    ]
  }

  return []
}

function projectToolPart(
  part: Record<string, unknown>,
  state: SandboxToolPartState,
  eventId: string | undefined,
): (RuntimeStreamEvent & { type: 'tool_call' | 'tool_result' })[] {
  const callId =
    pickString(part, ['callID', 'callId', 'toolCallId', 'id']) ??
    eventId ??
    `sandbox-tool-${++state.seq}`
  const toolName = pickString(part, ['tool', 'toolName', 'name']) ?? 'sandbox_tool'
  const toolState =
    part.state && typeof part.state === 'object' ? (part.state as Record<string, unknown>) : {}
  const metadata =
    toolState.metadata && typeof toolState.metadata === 'object'
      ? (toolState.metadata as Record<string, unknown>)
      : {}
  const status = pickString(toolState, ['status']) ?? 'updated'

  const previous = state.statusByCall.get(callId)
  const settled =
    previous === 'completed' || (previous !== undefined && TERMINAL_TOOL_FAILURE.test(previous))
  if (settled) return []

  const out: (RuntimeStreamEvent & { type: 'tool_call' | 'tool_result' })[] = []
  if (previous === undefined) {
    out.push({
      type: 'tool_call',
      toolName,
      toolCallId: callId,
      args: toolState.input ?? metadata.input ?? {},
    })
  }
  state.statusByCall.set(callId, status)

  if (status === 'completed') {
    out.push({
      type: 'tool_result',
      toolName,
      toolCallId: callId,
      result: toolState.output ?? metadata.output ?? '',
    })
  } else if (TERMINAL_TOOL_FAILURE.test(status)) {
    const message =
      pickString(toolState, ['error', 'message']) ??
      pickString(metadata, ['error', 'message']) ??
      `sandbox tool ended with status ${status}`
    const output = toolState.output ?? metadata.output
    out.push({
      type: 'tool_result',
      toolName,
      toolCallId: callId,
      result: { error: message, status, ...(output !== undefined ? { output } : {}) },
    })
  }
  return out
}

function pickString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.length > 0) return value
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
 * Tool parts are deliberately NOT mapped here (unchanged default) — compose
 * {@link mapSandboxToolEvent} alongside when a consumer needs them.
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
