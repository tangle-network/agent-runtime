/**
 * Derive a stable execution id from the run identity.
 * The same `(projectId, sessionId, turnIndex)` tuple yields the same id.
 *
 * Use the result as both `PromptOptions.executionId` and
 * `PromptOptions.turnId` on the first dispatch.
 * The execution id addresses the server-side execution for reconnect and
 * replay; the turn id makes a repeated dispatch idempotent.
 * An execution id alone does not make a repeated POST idempotent.
 *
 * Format is readable, not hashed: operators grepping orchestrator logs
 * for `gtm-agent:thread-abc:3` find the run without translating an
 * opaque id. Substrate executionIds are not a secrecy boundary.
 *
 * Wire integration:
 *   - Initial dispatch: pass the result as `executionId` and `turnId`.
 *   - Stream replay: pass it as `executionId` with `lastEventId`.
 */
export function deriveExecutionId(input: {
  projectId: string
  sessionId: string
  turnIndex: number
}): string {
  return `${input.projectId}:${input.sessionId}:${input.turnIndex}`
}
