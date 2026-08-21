import {
  collectAgentFinalMessageText,
  collectAgentResponseText,
  type SandboxEvent,
} from '@tangle-network/sandbox'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { createSandboxToolPartState, mapSandboxToolEvent } from './sandbox-events'

/** One tool call retained in a Sandbox executor artifact. */
export interface SandboxExecutorToolCall {
  id?: string
  name: string
  arguments: unknown
}

/** Parsed output of one Sandbox executor turn. */
export interface SandboxLeafOut {
  events: SandboxEvent[]
  content: string
  toolCalls?: SandboxExecutorToolCall[]
  outcome?: AgentRunOutcome
}

/** Project the complete Sandbox event stream into the standard executor result shape. */
export function sandboxLeafOutputFromEvents(events: SandboxEvent[]): SandboxLeafOut {
  const content = collectAgentFinalMessageText(events) ?? collectAgentResponseText(events) ?? ''
  const toolCalls = sandboxToolCalls(events)
  return {
    events,
    content,
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
  }
}

function sandboxToolCalls(events: readonly SandboxEvent[]): SandboxExecutorToolCall[] {
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
