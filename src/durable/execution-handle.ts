/**
 * `AgentExecutionHandle` — the typed pointer to a substrate-owned, long-
 * running agent execution. Products persist this id so a client retry of
 * the same turn can land on the same substrate execution.
 *
 * State of the world (2026-05-22):
 *
 *   - **In-call reconnect** — automatic. `@tangle-network/sandbox`'s
 *     `box.streamPrompt` extracts `executionId` from the response's
 *     `execution.started` event and replays via the runtime endpoint if
 *     the stream drops mid-call. Callers do not pass anything; the SDK
 *     dedupes replayed events transparently.
 *
 *   - **Cross-process reconnect** — partially supported. The orchestrator
 *     route `/agents/run/stream` reads `X-Execution-ID` header + `Last-
 *     Event-ID` and replays from its event buffer (10k events, 2-min
 *     post-completion retention). A product that wants this today must
 *     bypass the SDK and POST directly with those headers (see
 *     tax-agent's `sessions.ts`). The public `PromptOptions` does not
 *     yet expose them; once it does, products plumb the handle through.
 *
 * Until the SDK surface lands, this handle is most useful for product-
 * side persistence (D1 row, session metadata) and tracing — derive the
 * id at turn start, store it, and the wire integration is ready when
 * the SDK is.
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
