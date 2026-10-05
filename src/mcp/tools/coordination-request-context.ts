/** The tool-call timeout Runtime asks harnesses to give its coordination server. The Tangle
 *  profile materializer writes it as `MCP_TOOL_TIMEOUT` (Claude Code) and `tool_timeout_sec`
 *  (Codex) when an attachment declares `metadata.toolTimeoutMs`, so a fenced coordination call
 *  that holds its response for its whole fence is never cut off at the 60 s harness default. */
export const COORDINATION_CLIENT_TOOL_TIMEOUT_MS = 300_000
