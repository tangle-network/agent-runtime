/**
 * @experimental
 *
 * OpenAI Chat Completions `tools[]` projection of the queue-bound agent-runtime
 * MCP delegation tools.
 *
 * Use when configuring `createOpenAICompatibleBackend({ tools: ... })` so the
 * model can call `delegate_feedback`, `delegation_status`, and
 * `delegation_history` through the OpenAI-compat transport (tcloud, OpenRouter,
 * OpenAI direct, cli-bridge). The runtime surfaces tool calls as `tool_call`
 * stream events — execution is the caller's responsibility (typically the
 * parent sandbox runtime's MCP mount).
 *
 * Sandbox-SDK callers do NOT need this helper: the sandbox runtime mounts
 * MCP servers natively and the in-sandbox harness discovers tools via the
 * runtime, not via an OpenAI tools array.
 *
 * Tool name + description + JSON-schema are pulled from the canonical
 * `DELEGATE_*` constants exported by `./tools/*` so the projection cannot
 * drift from the server's own validators.
 */

import type { OpenAIChatTool } from '../types'
import {
  DELEGATE_FEEDBACK_DESCRIPTION,
  DELEGATE_FEEDBACK_INPUT_SCHEMA,
  DELEGATE_FEEDBACK_TOOL_NAME,
} from './tools/delegate-feedback'
import {
  DELEGATION_HISTORY_DESCRIPTION,
  DELEGATION_HISTORY_INPUT_SCHEMA,
  DELEGATION_HISTORY_TOOL_NAME,
} from './tools/delegation-history'
import {
  DELEGATION_STATUS_DESCRIPTION,
  DELEGATION_STATUS_INPUT_SCHEMA,
  DELEGATION_STATUS_TOOL_NAME,
} from './tools/delegation-status'

function buildTool(
  name: string,
  description: string,
  parameters: Readonly<Record<string, unknown>>,
): OpenAIChatTool {
  // `parameters` arrives as a deeply-readonly `as const` literal. The
  // OpenAI-compat backend JSON-serializes the body so a shallow copy
  // into a plain object is sufficient — and shields callers that mutate
  // the returned descriptor from corrupting the source constant.
  return {
    type: 'function',
    function: { name, description, parameters: { ...parameters } },
  }
}

/**
 * @experimental
 *
 * Returns the queue-bound delegation tools projected into OpenAI Chat
 * Completions `tools[]` shape. The order is stable: `delegate_feedback`,
 * `delegation_status`, `delegation_history`.
 */
export function mcpToolsForRuntimeMcp(): OpenAIChatTool[] {
  return [
    buildTool(
      DELEGATE_FEEDBACK_TOOL_NAME,
      DELEGATE_FEEDBACK_DESCRIPTION,
      DELEGATE_FEEDBACK_INPUT_SCHEMA as Readonly<Record<string, unknown>>,
    ),
    buildTool(
      DELEGATION_STATUS_TOOL_NAME,
      DELEGATION_STATUS_DESCRIPTION,
      DELEGATION_STATUS_INPUT_SCHEMA as Readonly<Record<string, unknown>>,
    ),
    buildTool(
      DELEGATION_HISTORY_TOOL_NAME,
      DELEGATION_HISTORY_DESCRIPTION,
      DELEGATION_HISTORY_INPUT_SCHEMA as Readonly<Record<string, unknown>>,
    ),
  ]
}

/**
 * @experimental
 *
 * Subset filter — return only the projected tools whose `function.name`
 * appears in `names`. Useful for curated mounts (e.g. only the queue-bound
 * delegation tools, omitting `delegate_feedback`). Unknown names are
 * silently ignored; pass an empty array to get an empty result.
 */
export function mcpToolsForRuntimeMcpSubset(names: ReadonlyArray<string>): OpenAIChatTool[] {
  const allowed = new Set(names)
  return mcpToolsForRuntimeMcp().filter((tool) => allowed.has(tool.function.name))
}
