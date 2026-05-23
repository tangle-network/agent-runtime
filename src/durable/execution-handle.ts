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
 *   - Sandbox PromptOptions accepts `executionId` and `lastEventId`.
 *     Products pass this id to make cross-process reconnect land on the
 *     same substrate execution instead of spawning a duplicate run.
 */
export function deriveExecutionId(input: {
  projectId: string
  sessionId: string
  turnIndex: number
}): string {
  return `${input.projectId}:${input.sessionId}:${input.turnIndex}`
}
