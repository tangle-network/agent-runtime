import {
  collectAgentFinalMessageText,
  collectAgentResponseText,
  type SandboxEvent,
} from '@tangle-network/sandbox'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import {
  createSandboxToolPartState,
  mapSandboxToolEvent,
  type SandboxServedBackend,
  sandboxEventServedBackend,
} from './sandbox-events'
import type { ExecutorToolCall } from './supervise/types'

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
export function lastServedBackend(
  events: readonly SandboxEvent[],
): SandboxServedBackend | undefined {
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
