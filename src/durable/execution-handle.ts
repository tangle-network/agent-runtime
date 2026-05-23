/**
 * Derive a stable executionId from the run identity. The same
 * `(projectId, sessionId, turnIndex)` tuple yields the same id — so a
 * client retry of the same turn lands on the same substrate execution
 * and the orchestrator's buffer replays instead of starting a second
 * prompt.
 *
 * Format is readable, not hashed: operators grepping orchestrator logs
 * for `gtm-agent:thread-abc:3` find the run without translating an
 * opaque id. Substrate executionIds are not a secrecy boundary.
 *
 * Wire integration:
 *   - `@tangle-network/sandbox@0.1.x` PromptOptions does not yet expose
 *     `executionId`. The SDK auto-reconnects in-call by extracting it
 *     from the response `execution.started` event; products do nothing.
 *   - For cross-process reconnect today, bypass the SDK and POST to the
 *     orchestrator's `/agents/run/stream` directly with this id in the
 *     `X-Execution-ID` header (see tax-agent's `sessions.ts`).
 */
export function deriveExecutionId(input: {
  projectId: string
  sessionId: string
  turnIndex: number
}): string {
  return `${input.projectId}:${input.sessionId}:${input.turnIndex}`
}
