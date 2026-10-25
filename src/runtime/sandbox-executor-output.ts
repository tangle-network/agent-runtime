/** Streamed and terminal Sandbox executor output, using one tool-part projector. */

import {
  collectAgentFinalMessageText,
  collectAgentResponseText,
  type SandboxEvent,
} from '@tangle-network/sandbox'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import type { RuntimeStreamEvent } from '../types'
import {
  extractLlmCallEvent,
  isSandboxTerminalEvent,
  type SandboxServedBackend,
  sandboxEventServedBackend,
} from './sandbox-events'
import {
  CANONICAL_STREAM_EVENT_TYPES,
  canonicalStreamEventFromSandboxEvent,
} from './sandbox-transport-events'
import type { ExecutorProgressEvent, ExecutorToolCall } from './supervise/types'

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

/** Statuses that settle one tool call as a failure. A failed tool call stays a tool result:
 *  the run's terminal state comes from the public Sandbox outcome tracker, never from here. */
const TERMINAL_FAILURE = /^(error|errored|failed|failure|cancelled|canceled|timeout|timed_out)$/i

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
 *   - codex `raw` events whose inner `item.started` / `item.updated` /
 *     `item.completed` carries a command, MCP, collaboration, web search or
 *     file change item — stateful on the item id, like a tool part. Other raw
 *     events, including opencode's raw `tool_use` echoes, project nothing.
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
  // Codex reports a tool only as an `item.*` event inside a `raw` event, never as a tool part.
  // 83 of 83 archived codex turns held 3,320 tool items and projected none.
  if (type === 'raw') return projectCodexItem(data, state)
  // `tool-heartbeat` and `tool-slow` report that a call is STILL RUNNING. They carry the call's
  // `partId`, not a call id, so projecting them as calls recorded a new `tool_call` every 5 s of
  // every long call: 432 of a root's 448 recorded `await_event` calls were
  // heartbeats of 16 real ones.
  if (CANONICAL_STREAM_EVENT_TYPES.has(type)) return []

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
    previous === 'completed' || (previous !== undefined && TERMINAL_FAILURE.test(previous))
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
  } else if (TERMINAL_FAILURE.test(status)) {
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

/** Codex item types that are tool calls. Reasoning, messages and todo lists are not. */
const CODEX_TOOL_ITEMS: ReadonlySet<string> = new Set([
  'command_execution',
  'mcp_tool_call',
  'collab_tool_call',
  'web_search',
  'file_change',
])

/** Item fields that describe the call's progress or outcome rather than what it was asked to do. */
const CODEX_ITEM_OUTCOME_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'status',
  'result',
  'error',
  'aggregated_output',
  'exit_code',
])

/**
 * Project a codex `item.started` / `item.updated` / `item.completed` tool item through the same
 * per-call state as a tool part, keyed on the item id: one `tool_call` on its first frame and one
 * `tool_result` when it completes. Tool names follow Eval's codex intake: `server/tool` for MCP.
 */
function projectCodexItem(
  data: Record<string, unknown>,
  state: SandboxToolPartState,
): (RuntimeStreamEvent & { type: 'tool_call' | 'tool_result' })[] {
  if (data.backend !== 'codex' || !data.event || typeof data.event !== 'object') return []
  const inner = data.event as Record<string, unknown>
  const phase = inner.type
  if (phase !== 'item.started' && phase !== 'item.updated' && phase !== 'item.completed') return []
  if (!inner.item || typeof inner.item !== 'object') return []
  const item = inner.item as Record<string, unknown>
  const itemType = pickString(item, ['type'])
  if (itemType === undefined || !CODEX_TOOL_ITEMS.has(itemType)) return []
  const error =
    item.error && typeof item.error === 'object'
      ? (pickString(item.error as Record<string, unknown>, ['message']) ?? `${itemType} failed`)
      : undefined
  const failed =
    item.status === 'failed' ||
    error !== undefined ||
    (itemType === 'command_execution' && typeof item.exit_code === 'number' && item.exit_code !== 0)
  const status = phase !== 'item.completed' ? 'running' : failed ? 'failed' : 'completed'
  const input = Object.fromEntries(
    Object.entries(item).filter(([key]) => !CODEX_ITEM_OUTCOME_FIELDS.has(key)),
  )
  const output = item.result ?? item.aggregated_output ?? item.changes
  return projectToolPart(
    {
      ...(typeof item.id === 'string' ? { callID: item.id } : {}),
      tool: codexToolName(itemType, item),
      state: {
        status,
        input,
        ...(output === undefined || output === null ? {} : { output }),
        ...(status === 'failed' ? { error: error ?? `${itemType} failed` } : {}),
      },
    },
    state,
    undefined,
  )
}

function codexToolName(itemType: string, item: Record<string, unknown>): string {
  if (itemType === 'mcp_tool_call') {
    const name = [pickString(item, ['server']), pickString(item, ['tool'])]
      .filter((part) => part !== undefined)
      .join('/')
    return name === '' ? 'mcp' : name
  }
  if (itemType === 'collab_tool_call') return pickString(item, ['tool']) ?? 'subagent'
  if (itemType === 'web_search' || itemType === 'file_change') return itemType
  return pickString(item, ['name']) ?? itemType
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

/**
 * Project one `SandboxEvent` onto Runtime's executor progress vocabulary: incremental text and
 * reasoning, tool calls and results, and an interaction request. It composes the existing
 * projections ({@link mapSandboxEvent}, {@link mapSandboxToolEvent}, and the canonical Agent
 * Interface decode) so every sandbox-shaped executor publishes live output through one reader.
 * Usage-bearing events project to nothing here — accounting stays on the `tokens`/`cost`
 * channels.
 *
 * Pass one {@link SandboxToolPartState} per turn so a multi-frame tool call yields one call and
 * at most one result.
 *
 * @experimental
 */
export function sandboxProgressEvents(
  event: SandboxEvent,
  state: SandboxToolPartState,
): ExecutorProgressEvent[] {
  const canonical = canonicalStreamEventFromSandboxEvent(event)
  if (canonical?.type === 'interaction') {
    return [{ kind: 'interaction', request: canonical.request }]
  }
  if (canonical?.type === 'child-task') {
    return [{ kind: 'child_task', event: canonical }]
  }
  const tools = mapSandboxToolEvent(event, state).map((projected) =>
    projected.type === 'tool_call'
      ? ({
          kind: 'tool_call',
          toolName: projected.toolName,
          ...(projected.toolCallId === undefined ? {} : { toolCallId: projected.toolCallId }),
          ...(projected.args === undefined ? {} : { args: projected.args }),
        } as const)
      : ({
          kind: 'tool_result',
          toolName: projected.toolName,
          ...(projected.toolCallId === undefined ? {} : { toolCallId: projected.toolCallId }),
          ...(projected.result === undefined ? {} : { result: projected.result }),
        } as const),
  )
  if (tools.length > 0) return tools
  const mapped = mapSandboxEvent(event)
  if (mapped?.type === 'text_delta') return [{ kind: 'text_delta', text: mapped.text }]
  if (mapped?.type === 'reasoning_delta') return [{ kind: 'reasoning_delta', text: mapped.text }]
  return []
}

/**
 * What a settled turn produced, as an explicit marker.
 *
 * `text` carries the byte length of the answer, `empty` says a text-bearing terminal event was
 * observed and carried nothing, and `absent` says no text-bearing event was observed at all.
 * The three are distinct on purpose: an empty settle blob used to be indistinguishable from lost
 * output, so a reader could not tell a box that produced nothing from one whose answer never
 * arrived.
 */
export type SandboxOutputMarker =
  | { readonly kind: 'text'; readonly bytes: number }
  | { readonly kind: 'empty' }
  | { readonly kind: 'absent' }

/** Parsed output of one Sandbox executor turn. */
export interface SandboxLeafOut {
  events: SandboxEvent[]
  /** The observed answer. `undefined` when no text-bearing event was observed — never `''`. */
  content: string | undefined
  /** Explicit account of what the turn produced. */
  output: SandboxOutputMarker
  /**
   * Provider and model the platform reported serving this turn, when it reported one. Absent means
   * the platform said nothing; it is never filled from the request, because a request is not a
   * receipt.
   */
  servedBackend?: SandboxServedBackend
  toolCalls?: ExecutorToolCall[]
  outcome?: AgentRunOutcome
}

/** Project the complete Sandbox event stream into the standard executor result shape. */
export function sandboxLeafOutputFromEvents(events: SandboxEvent[]): SandboxLeafOut {
  const content = collectAgentFinalMessageText(events) ?? collectAgentResponseText(events)
  const toolCalls = sandboxToolCalls(events)
  const servedBackend = lastServedBackend(events)
  return {
    events,
    content,
    output: sandboxOutputMarker(content, events.some(carriesText)),
    ...(servedBackend === undefined ? {} : { servedBackend }),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
  }
}

/**
 * Classify observed text into the explicit output marker. `sawTextEvent` says whether the stream
 * carried a text-bearing event at all, which is what separates a box that answered nothing from a
 * box whose answer was never observed.
 */
export function sandboxOutputMarker(
  content: string | undefined,
  sawTextEvent = content !== undefined,
): SandboxOutputMarker {
  if (content !== undefined && content.length > 0) {
    return { kind: 'text', bytes: Buffer.byteLength(content, 'utf8') }
  }
  return sawTextEvent ? { kind: 'empty' } : { kind: 'absent' }
}

/** True when the event carries a text field a turn's answer could come from, empty or not. */
function carriesText(event: SandboxEvent): boolean {
  if (!event || typeof event !== 'object') return false
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {}
  if (typeof data.finalText === 'string' || typeof data.text === 'string') return true
  if (typeof data.delta === 'string') return true
  const part =
    data.part && typeof data.part === 'object' ? (data.part as Record<string, unknown>) : undefined
  return part !== undefined && part.type === 'text' && typeof part.text === 'string'
}

/** The last served identity the platform reported across a turn's events, or `undefined`. */
function lastServedBackend(events: readonly SandboxEvent[]): SandboxServedBackend | undefined {
  let served: SandboxServedBackend | undefined
  for (const event of events) {
    const next = sandboxEventServedBackend(event)
    if (next !== undefined) served = next
  }
  return served
}

function sandboxToolCalls(events: readonly SandboxEvent[]): ExecutorToolCall[] {
  const state = createSandboxToolPartState()
  return events.flatMap((event) =>
    mapSandboxToolEvent(event, state).flatMap((projected) =>
      projected.type === 'tool_call'
        ? [
            {
              ...(projected.toolCallId === undefined ? {} : { id: projected.toolCallId }),
              name: projected.toolName,
              arguments: projected.args ?? {},
            },
          ]
        : [],
    ),
  )
}

/** Read the final text off a terminal sandbox event, when present. */
export function terminalTextFromSandboxEvent(event: SandboxEvent): string | undefined {
  if (!event || typeof event !== 'object') return undefined
  const type = String(event.type ?? '')
  if (!isSandboxTerminalEvent(type)) return undefined
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  for (const key of ['finalText', 'text', 'response', 'content']) {
    const value = data[key]
    if (typeof value === 'string') return value
  }
  return undefined
}
