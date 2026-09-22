import type { PromptOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import type {
  AgentExecutionBackend,
  AgentTaskStatus,
  BackendErrorDetail,
  RuntimeStreamEvent,
} from '../types'
import type { ExecutorFactory } from './supervise/types'

/**
 * The execution backend for one turn.
 *
 * @experimental
 */
export type AgentTurnBackend =
  | {
      /** A live sandbox box: the turn is one `box.streamPrompt(prompt)` call. */
      kind: 'box'
      box: SandboxInstance
      /** Per-turn options forwarded to `streamPrompt`; the turn owns `signal`. */
      options?: Omit<PromptOptions, 'signal'>
      /** Model label stamped on cost-only `llm_call` events. */
      agentRunName?: string
    }
  | {
      /** A one-shot executor adapted to the box stream surface. */
      kind: 'executor'
      factory: ExecutorFactory<unknown>
      /** Model label stamped on cost-only `llm_call` events. */
      agentRunName?: string
    }
  | {
      /** An in-process backend whose `stream()` events are already normalized. */
      kind: 'chat'
      backend: AgentExecutionBackend
    }

/** @experimental */
export interface StreamAgentTurnOptions {
  /** Caller-initiated cancellation. */
  signal?: AbortSignal
  /** Wall-clock deadline for the whole turn in milliseconds. */
  timeoutMs?: number
  /** Project sandbox tool parts to `tool_call` and `tool_result` events. */
  preserveToolParts?: boolean
  /** Preserve schema-valid canonical interface events. */
  preserveCanonicalEvents?: boolean
  /** Observe each raw sandbox event before projection. */
  onRawEvent?: (event: SandboxEvent) => void | Promise<void>
}

/** Metered usage of one turn. @experimental */
export interface AgentTurnUsage {
  input: number
  output: number
  costUsd?: number
  model?: string
}

/** A drained turn and its terminal summary. @experimental */
export interface CollectedAgentTurn {
  finalText: string
  usage: AgentTurnUsage
  events: RuntimeStreamEvent[]
  status: AgentTaskStatus
  error?: BackendErrorDetail
}
