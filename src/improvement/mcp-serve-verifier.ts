/**
 * `mcpServeVerifier` — the intrinsic verifier for a built MCP server: the
 * boot-and-probe checker named in docs/artifact-lifecycle-frontier.md. A
 * generated MCP server is only a candidate if it actually *serves* — so this
 * boots it over stdio (the default local MCP transport) and runs the real
 * handshake: `initialize` → `notifications/initialized` → `tools/list`, and
 * asserts the server answers with at least `minTools` tools.
 *
 * Outcomes follow the `Verifier` contract: a server that fails to start, exits
 * early, errors the handshake, times out, or exposes no tools is a FAILED
 * candidate (`{ok:false}`, fed back into the next generation shot); a missing
 * start binary or spawn fault THROWS (a setup bug, never a silent fallback).
 *
 * Protocol matches the runtime's own stdio MCP server (src/mcp/server.ts):
 * newline-delimited JSON-RPC 2.0, protocol version 2024-11-05.
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Verifier, VerifyResult } from './agentic-generator'

const PROTOCOL_VERSION = '2024-11-05'

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

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

/** Build a `Verifier` that boots a generated MCP server over stdio and checks it exposes tools. */
export function mcpServeVerifier(spec: McpServeSpec): Verifier {
  const timeoutMs = spec.timeoutMs ?? 30_000
  const minTools = spec.minTools ?? 1

  return (worktreePath: string): Promise<VerifyResult> =>
    new Promise<VerifyResult>((resolve, reject) => {
      const child = spawn(spec.command, spec.args ?? [], {
        cwd: worktreePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...spec.env },
      })

      const stderr: string[] = []
      let settled = false
      let nextId = 1
      const initId = nextId++
      let listId = -1

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        rl.close()
        child.kill('SIGKILL')
        fn()
      }
      const withStderr = (msg: string) =>
        stderr.length > 0 ? `${msg}\nstderr:\n${stderr.join('').slice(-2000)}` : msg
      const pass = () => settle(() => resolve({ ok: true }))
      const failCandidate = (msg: string) =>
        settle(() => resolve({ ok: false, feedback: withStderr(msg) }))
      const setupFault = (err: Error) => settle(() => reject(err))
      const failStdin = (err: Error) =>
        failCandidate(`writing to MCP server stdin failed: ${err.message}`)

      const send = (msg: Record<string, unknown>): boolean => {
        try {
          child.stdin.write(`${JSON.stringify(msg)}\n`)
          return true
        } catch (err) {
          // EPIPE: the server died mid-handshake — a failed candidate, not a fault.
          failStdin(err as Error)
          return false
        }
      }

      child.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code
        setupFault(
          code === 'ENOENT'
            ? new Error(
                `mcpServeVerifier: '${spec.command}' not found in PATH (setup bug, not a failed candidate)`,
              )
            : new Error(`mcpServeVerifier: '${spec.command}' failed to spawn: ${err.message}`),
        )
      })
      child.on('exit', (code, signal) => {
        // An exit before the handshake completes is a failed candidate (the
        // server crashed on boot); after we settle, our own SIGKILL fires here.
        failCandidate(`MCP server exited (code ${code}, signal ${signal}) before serving`)
      })
      // Pipe failures normally arrive asynchronously, outside send()'s try/catch.
      child.stdin.on('error', failStdin)
      child.stderr.on('data', (d) => stderr.push(String(d)))

      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        let msg: JsonRpcResponse | undefined
        try {
          msg = JSON.parse(line) as JsonRpcResponse
        } catch {
          return // servers log to stdout too; skip non-JSON lines
        }
        if (!msg || typeof msg !== 'object') return

        if (msg.id === initId) {
          if (msg.error) return failCandidate(`initialize errored: ${JSON.stringify(msg.error)}`)
          if (!send({ jsonrpc: '2.0', method: 'notifications/initialized' })) return
          listId = nextId++
          send({ jsonrpc: '2.0', id: listId, method: 'tools/list' })
          return
        }
        if (msg.id === listId) {
          if (msg.error) return failCandidate(`tools/list errored: ${JSON.stringify(msg.error)}`)
          const tools = (msg.result as { tools?: unknown[] } | undefined)?.tools
          if (!Array.isArray(tools)) return failCandidate('tools/list result has no tools array')
          if (tools.length < minTools) {
            return failCandidate(`tools/list returned ${tools.length} tool(s), need >= ${minTools}`)
          }
          return pass()
        }
      })

      const timer = setTimeout(
        () => failCandidate(`MCP server did not complete the handshake within ${timeoutMs}ms`),
        timeoutMs,
      )

      send({
        jsonrpc: '2.0',
        id: initId,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'agent-runtime-mcp-verify', version: '0' },
        },
      })
    })
}
