/**
 * `mcpServeVerifier` — the intrinsic verifier for a built MCP server: the
 * boot-and-probe checker named in docs/artifact-lifecycle-frontier.md. A
 * generated MCP server is only a candidate if it actually *serves* — so this
 * boots it over stdio (the default local MCP transport) and runs the real
 * handshake: `initialize` → `notifications/initialized` → `tools/list`, and
 * asserts the server answers with at least `minTools` tools.
 *
 * The spawn + handshake is the SHARED same-host stdio connection
 * (`connectStdioMcp`) — the same code path that later serves the built server
 * LIVE to a scored run (`materializeLocalMcp`), so "verified it serves" and
 * "served while scored" can never drift apart.
 *
 * Outcomes follow the `Verifier` contract: a server that fails to start, exits
 * early, errors the handshake, times out, or exposes no tools is a FAILED
 * candidate (`{ok:false}`, fed back into the next generation shot); a missing
 * start binary or spawn fault THROWS (a setup bug, never a silent fallback).
 */

import {
  connectStdioMcp,
  McpSpawnFault,
  type StdioMcpConnection,
} from '../runtime/stdio-mcp-client'
import type { Verifier, VerifyResult } from './agentic-generator'

export interface McpServeSpec {
  /** Command that starts the built MCP server in the worktree (stdio transport). */
  command: string
  args?: string[]
  /** Extra env for the server process (merged over `process.env`). */
  env?: Record<string, string>
  /** Handshake timeout (ms). Default 30s. */
  timeoutMs?: number
  /** Minimum tools the server must expose to pass. Default 1. */
  minTools?: number
}

/** Build a `Verifier` that boots a generated MCP server over stdio and checks it exposes tools. */
export function mcpServeVerifier(spec: McpServeSpec): Verifier {
  const minTools = spec.minTools ?? 1

  return async (worktreePath: string): Promise<VerifyResult> => {
    let conn: StdioMcpConnection
    try {
      conn = await connectStdioMcp({
        command: spec.command,
        ...(spec.args ? { args: spec.args } : {}),
        cwd: worktreePath,
        ...(spec.env ? { env: spec.env } : {}),
        ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
      })
    } catch (err) {
      if (err instanceof McpSpawnFault) {
        throw new Error(`mcpServeVerifier: ${err.message}`)
      }
      // Crash-on-boot / handshake error / timeout: a failed candidate, with the
      // connection's stderr-tailed message as the feedback for the next shot.
      return { ok: false, feedback: err instanceof Error ? err.message : String(err) }
    }
    try {
      if (conn.tools.length < minTools) {
        return {
          ok: false,
          feedback: `tools/list returned ${conn.tools.length} tool(s), need >= ${minTools}`,
        }
      }
      return { ok: true }
    } finally {
      await conn.close()
    }
  }
}
