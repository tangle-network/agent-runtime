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
 * opaque id. Components are URL-encoded so delimiters inside caller ids
 * cannot collapse distinct tuples. The final id is limited to the
 * orchestrator replay route's 256-byte maximum. Execution ids are not a
 * secrecy boundary.
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
  if (input.projectId.trim().length === 0) {
    throw new TypeError('projectId must be a non-empty string')
  }
  if (input.sessionId.trim().length === 0) {
    throw new TypeError('sessionId must be a non-empty string')
  }
  if (!Number.isSafeInteger(input.turnIndex) || input.turnIndex < 0) {
    throw new RangeError('turnIndex must be a non-negative safe integer')
  }

  const executionId = [
    encodeURIComponent(input.projectId),
    encodeURIComponent(input.sessionId),
    String(input.turnIndex),
  ].join(':')
  if (executionId.length > 256) {
    throw new RangeError('derived execution id must not exceed 256 bytes')
  }
  return executionId
}
