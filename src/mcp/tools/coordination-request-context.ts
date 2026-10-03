import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * The header a harness sends to a remote MCP server whose tool-call timeout it
 * raised, carrying the applied timeout in milliseconds. The Tangle profile
 * materializer writes it beside `MCP_TOOL_TIMEOUT` (Claude Code) and
 * `tool_timeout_sec` (Codex) when an attachment declares
 * `metadata.toolTimeoutMs`. Without it the server must assume the harness
 * default, 60 s for Claude Code 2.1.287 and Codex (measured 2026-10-03).
 */
export const MCP_TOOL_TIMEOUT_HEADER = 'x-mcp-tool-timeout-ms'

/** The tool-call timeout Runtime asks harnesses to give its coordination server. */
export const COORDINATION_CLIENT_TOOL_TIMEOUT_MS = 300_000

/**
 * The longest `await_event` holds for a caller that declared a raised timeout.
 * A held response through the Sandbox edge was measured to 200 s on 2026-10-03.
 */
export const MAX_DECLARED_AWAIT_FENCE_MS = 180_000

const MIN_DECLARED_TOOL_TIMEOUT_MS = 1_000
const MAX_DECLARED_TOOL_TIMEOUT_MS = 3_600_000

const requestContext = new AsyncLocalStorage<{ readonly awaitFenceMs: number }>()

/**
 * The tool-call timeout a request declared through {@link MCP_TOOL_TIMEOUT_HEADER},
 * or `undefined` when it is absent or malformed. A malformed value is treated as
 * absent: the caller then gets the default fence, which every harness tolerates.
 */
export function declaredToolTimeoutMs(header: string | string[] | undefined): number | undefined {
  if (typeof header !== 'string' || !/^[0-9]{1,8}$/.test(header)) return undefined
  const value = Number(header)
  return value >= MIN_DECLARED_TOOL_TIMEOUT_MS && value <= MAX_DECLARED_TOOL_TIMEOUT_MS
    ? value
    : undefined
}

/**
 * How long `await_event` may hold for a caller that declared `declaredMs`: 60% of
 * it, so the answer leaves well before the client gives up, and at most
 * {@link MAX_DECLARED_AWAIT_FENCE_MS}.
 */
export function declaredAwaitFenceMs(declaredMs: number): number {
  return Math.min(MAX_DECLARED_AWAIT_FENCE_MS, Math.floor(declaredMs * 0.6))
}

/** Run one coordination request with the fence its caller declared, if any. */
export function withCoordinationAwaitFence<T>(awaitFenceMs: number | undefined, run: () => T): T {
  return awaitFenceMs === undefined ? run() : requestContext.run({ awaitFenceMs }, run)
}

/** The fence the current coordination request declared, or `undefined`. */
export function coordinationRequestAwaitFenceMs(): number | undefined {
  return requestContext.getStore()?.awaitFenceMs
}
