/** Shared task and stream-event types. */

/** @stable */
export interface AgentTaskSpec {
  id: string
  intent: string
  /** Domain is metadata, not an architectural boundary: tax, legal, gtm, creative, blueprint, redteam, etc. */
  domain?: string
  inputs?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

/** @stable */
export type AgentTaskStatus = 'completed' | 'blocked' | 'failed' | 'aborted'

/** @stable */
export interface AgentTurnError {
  kind: 'transport' | 'execution'
  message: string
  status?: number
  body?: string
}

/**
 *
 * OpenAI Chat Completions tool descriptor. The shape mirrors the
 * `/v1/chat/completions` `tools[]` parameter so callers can pass tool
 * definitions to an OpenAI Chat Completions compatible client without runtime
 * translation. The router proxies this shape verbatim to Anthropic
 * (translated server-side), DeepSeek, Groq, OpenAI, and Gemini — every model
 * that the eval surface targets.
 *
 * Callers that build their tool list from MCP servers should run a one-shot
 * MCP `tools/list` at config time and project the result into this shape. The
 * runtime intentionally does NOT depend on `@modelcontextprotocol/sdk` —
 * keeping the backend transport thin lets domain repos own MCP plumbing.
 *
 * @stable
 */
export interface OpenAIChatTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

/**
 *
 * `tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI
 * spec: `'auto'` (default — model decides), `'none'` (disable tool calling
 * for this turn), `'required'` (force a tool call), or a specific function
 * pin `{ type: 'function', function: { name } }`.
 *
 * @stable
 */
export type OpenAIChatToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } }

/**
 *
 * `response_format` parameter for OpenAI-compatible chat endpoints. Use
 * `json_object` when the caller needs syntactically valid JSON, or
 * `json_schema` when the upstream provider supports schema-constrained JSON.
 *
 * @stable
 */
export type OpenAIChatResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: Record<string, unknown> }

/** @stable */
export type RuntimeStreamEvent =
  | {
      type: 'turn_start'
      task: AgentTaskSpec
      provider: string
      sessionId: string
      timestamp: string
    }
  | {
      type: 'text_delta'
      task?: AgentTaskSpec
      text: string
      timestamp?: string
    }
  | {
      type: 'reasoning_delta'
      task?: AgentTaskSpec
      text: string
      timestamp?: string
    }
  | {
      type: 'tool_call'
      task?: AgentTaskSpec
      toolName: string
      toolCallId?: string
      args?: unknown
      timestamp?: string
    }
  | {
      type: 'tool_result'
      task?: AgentTaskSpec
      toolName: string
      toolCallId?: string
      result?: unknown
      timestamp?: string
    }
  | {
      type: 'llm_call'
      task?: AgentTaskSpec
      model: string
      tokensIn?: number
      tokensOut?: number
      costUsd?: number
      latencyMs?: number
      finishReason?: string
      timestamp?: string
    }
  | {
      type: 'artifact'
      task?: AgentTaskSpec
      artifactId: string
      name?: string
      mimeType?: string
      uri?: string
      content?: string
      metadata?: Record<string, unknown>
      timestamp?: string
    }
  | {
      type: 'proposal_created'
      task?: AgentTaskSpec
      proposalId: string
      title: string
      status?: 'pending' | 'approved' | 'rejected'
      // Proposal body — the assessable deliverable. Same role as `content` on
      // the `artifact` variant; produced-state grading correctness-checks it.
      // Optional: a title-only filing carries none.
      content?: string
      timestamp?: string
    }
  | {
      type: 'turn_error'
      task: AgentTaskSpec
      provider: string
      sessionId: string
      message: string
      recoverable: boolean
      error: AgentTurnError
      timestamp: string
    }
  | {
      type: 'final'
      task: AgentTaskSpec
      sessionId: string
      status: AgentTaskStatus
      reason: string
      text?: string
      metadata?: Record<string, unknown>
      /**
       * Present when the turn failed before producing a valid result.
       */
      error?: AgentTurnError
      timestamp: string
    }
