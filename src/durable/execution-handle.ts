/**
 * `AgentExecutionHandle` — the typed pointer to a substrate-owned, long-
 * running agent execution.
 *
 * Execution state lives in the substrate. `@tangle-network/sandbox`'s
 * `box.streamPrompt({ executionId, lastEventId })` (and the orchestrator
 * behind it) already buffers the event stream by `executionId`, replays
 * strictly after `lastEventId` on reconnect, and never spawns a duplicate
 * execution for the same id. agent-runtime owns this typed pointer so
 * callers (chat handlers, replay glue, telemetry) can talk about a run's
 * continuity without depending on the SDK shape directly.
 *
 * Usage:
 *
 *   const handle: AgentExecutionHandle = {
 *     executionId: deriveExecutionId({ projectId, sessionId, turnIndex }),
 *     sessionId,
 *   }
 *   for await (const event of box.streamPrompt(prompt, {
 *     executionId: handle.executionId,
 *     lastEventId: handle.lastEventId,
 *   })) { ... }
 *
 * On reconnect the product persists the last event id it acknowledged and
 * re-passes both — the orchestrator replays from `lastEventId + 1` without
 * re-running the agent.
 */

export interface AgentExecutionHandle {
  /** Stable substrate execution id. The same id on retry → orchestrator
   *  replays the buffered stream rather than spawning a second run. */
  executionId: string
  /** Substrate session id, when the execution is part of a multi-turn
   *  session. Optional — not every substrate is session-scoped. */
  sessionId?: string
  /** Last event id the caller acknowledged. The substrate replays strictly
   *  after this id on reconnect. Omit on first attempt. */
  lastEventId?: string
}

/**
 * Structural contract for a substrate-backed reconnectable stream — what
 * `box.streamPrompt` already implements. Provided as a typed shape so
 * substrate-neutral helpers (e.g. a chat-turn producer) can be written
 * without depending on the sandbox SDK directly:
 *
 *   const sandboxStream: ReconnectableAgentStream<MyEvent> = {
 *     open: (handle) => box.streamPrompt(prompt, {
 *       executionId: handle.executionId,
 *       lastEventId: handle.lastEventId,
 *       ...sandboxOptions,
 *     }),
 *   }
 */
export interface ReconnectableAgentStream<TEvent> {
  /** Open or resume the stream. The implementation forwards
   *  `handle.executionId` + `handle.lastEventId` to the substrate; on
   *  reconnect the substrate replays from `lastEventId` without
   *  re-running the agent. */
  open(handle: AgentExecutionHandle): AsyncIterable<TEvent>
}

/**
 * Derive a stable executionId from the run identity. The same
 * `(projectId, sessionId, turnIndex)` tuple yields the same id — so a
 * client retry of the same turn lands on the same substrate execution
 * and the orchestrator's buffer replays instead of starting a second
 * prompt.
 *
 * Format is readable, not hashed: operators grepping orchestrator logs
 * for `gtm-agent:thread-abc:3` find the run without translating an opaque
 * id. Substrate executionIds are not a secrecy boundary.
 */
export function deriveExecutionId(input: {
  projectId: string
  sessionId: string
  turnIndex: number
}): string {
  return `${input.projectId}:${input.sessionId}:${input.turnIndex}`
}
