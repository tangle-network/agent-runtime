/**
 * Same-host stdio MCP: the ONE persistent newline-delimited JSON-RPC 2.0
 * connection to a spawned MCP server child process. This is the handshake
 * `mcpServeVerifier` boots for its probe (`initialize` →
 * `notifications/initialized` → `tools/list`), extracted so a LIVE consumer —
 * the local sandbox client, the SWE eval runner's `materializeMcp` path — can
 * keep the server running and route `tools/call` to it during a driven run.
 * A locally-BUILT MCP server (its cwd is a host worktree) is unreachable from
 * a remote box; spawning it here, next to the worker, is what makes a built
 * tool scoreable at all.
 *
 * Two layers:
 *   - `connectStdioMcp`     — spawn ONE server at its cwd, run the real MCP
 *     handshake, return a live connection: the listed tools, `callTool`, `close`.
 *   - `materializeLocalMcp` — spawn EVERY enabled stdio server in
 *     `profile.mcp`, namespace each server's tools as `<server>__<tool>` so
 *     they can share a worker's tool list with a domain surface's tools, and
 *     expose one route/close facade over the set. Fail-CLOSED: a declared
 *     server that cannot boot throws — silently scoring the profile as if it
 *     had no MCP surface would fake the with/without ablation.
 *
 * Failure taxonomy (mirrors `commandVerifier`/`mcpServeVerifier`): a missing
 * start binary or spawn fault is a SETUP bug (`McpSpawnFault` — candidate
 * graders must rethrow it, never score it); a server that crashes, errors the
 * handshake, or times out is an ordinary `Error` carrying the stderr tail; a
 * JSON-RPC error on `tools/call` is the AGENT's outcome — returned as an
 * `ERROR: …` string, never thrown (the `createMcpEnvironment` convention).
 *
 * Protocol matches the runtime's own stdio MCP server (src/mcp/server.ts):
 * newline-delimited JSON-RPC 2.0, protocol version 2024-11-05.
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import { type KeyProvider, resolveSecretEnv, secretEnvOfMcpServer } from './key-provider'
import { sanitizeMcpToolSchema } from './mcp-environment'
import type { AgenticTool } from './strategy'

const PROTOCOL_VERSION = '2024-11-05'

export interface StdioMcpServerSpec {
  /** Command that starts the MCP server (stdio transport). */
  command: string
  args?: string[]
  /** Working directory the server starts in (a built candidate's worktree, typically). */
  cwd?: string
  /** Extra env for the server process (merged over `process.env`). */
  env?: Record<string, string>
  /** Handshake AND per-request timeout (ms). Default 30s. */
  timeoutMs?: number
}

/** A missing start binary / spawn fault: a SETUP bug, never a failed candidate.
 *  Graders (the serve verifier) must rethrow this instead of scoring it. */
export class McpSpawnFault extends Error {}

export interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface StdioMcpConnection {
  /** The tools the server exposed at connect time (`tools/list`). */
  readonly tools: readonly McpToolDescriptor[]
  /** `tools/call` → the result's text content. A JSON-RPC error / `isError`
   *  result becomes an `ERROR: …` string (the agent's outcome); a dead
   *  transport or timeout throws (an infra fault). */
  callTool(name: string, args: Record<string, unknown>): Promise<string>
  /** Kill the server child. Idempotent. */
  close(): Promise<void>
}

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

/** Spawn a stdio MCP server, complete the handshake, and return the LIVE connection. */
export async function connectStdioMcp(spec: StdioMcpServerSpec): Promise<StdioMcpConnection> {
  const timeoutMs = spec.timeoutMs ?? 30_000
  const child = spawn(spec.command, spec.args ?? [], {
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...spec.env },
  })

  const stderr: string[] = []
  child.stderr.on('data', (d) => stderr.push(String(d)))
  const stderrTail = () => (stderr.length > 0 ? `\nstderr:\n${stderr.join('').slice(-2000)}` : '')
  // A write to a dying stdin surfaces as an async 'error' on the stream; the
  // child's own 'error'/'close' events already carry the failure, so this
  // listener only prevents an unhandled-'error' crash.
  child.stdin.on('error', () => {})

  let nextId = 1
  let spawnFault: McpSpawnFault | undefined
  let closed = false
  const pending = new Map<
    number,
    { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()

  const failAllPending = (err: Error) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    pending.clear()
  }

  child.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code
    spawnFault =
      code === 'ENOENT'
        ? new McpSpawnFault(
            `'${spec.command}' not found in PATH (setup bug, not a failed candidate)`,
          )
        : new McpSpawnFault(`'${spec.command}' failed to spawn: ${err.message}`)
    failAllPending(spawnFault)
  })
  // 'close' (not 'exit'): it fires after stdio flushes, so the stderr tail in
  // the failure message is complete. After our own SIGKILL in close(), pending
  // is already empty and this is a no-op.
  child.on('close', (code, signal) => {
    failAllPending(
      spawnFault ??
        new Error(
          `MCP server exited (code ${code}, signal ${signal}) before serving${stderrTail()}`,
        ),
    )
  })

  const rl = createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    let msg: JsonRpcResponse | undefined
    try {
      msg = JSON.parse(line) as JsonRpcResponse
    } catch {
      return // servers log to stdout too; skip non-JSON lines
    }
    if (!msg || typeof msg !== 'object' || typeof msg.id !== 'number') return
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    clearTimeout(p.timer)
    p.resolve(msg)
  })

  const send = (msg: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(msg)}\n`)
  }

  const request = (
    method: string,
    params?: Record<string, unknown>,
    // The handshake-phase timeout keeps the verifier's long-standing feedback
    // wording; live tools/call timeouts name the method instead.
    timeoutMessage = `MCP server did not answer '${method}' within ${timeoutMs}ms`,
  ): Promise<JsonRpcResponse> =>
    new Promise<JsonRpcResponse>((resolve, reject) => {
      if (spawnFault) return reject(spawnFault)
      if (closed) return reject(new Error('MCP connection closed'))
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${timeoutMessage}${stderrTail()}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
      } catch (err) {
        pending.delete(id)
        clearTimeout(timer)
        reject(
          new Error(
            `writing to MCP server stdin failed: ${err instanceof Error ? err.message : String(err)}${stderrTail()}`,
          ),
        )
      }
    })

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    rl.close()
    failAllPending(new Error('MCP connection closed'))
    child.kill('SIGKILL')
  }

  const handshakeTimeout = `MCP server did not complete the handshake within ${timeoutMs}ms`
  try {
    const init = await request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'agent-runtime-local-mcp', version: '0' },
      },
      handshakeTimeout,
    )
    if (init.error)
      throw new Error(`initialize errored: ${JSON.stringify(init.error)}${stderrTail()}`)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const list = await request('tools/list', undefined, handshakeTimeout)
    if (list.error)
      throw new Error(`tools/list errored: ${JSON.stringify(list.error)}${stderrTail()}`)
    const tools = (list.result as { tools?: McpToolDescriptor[] } | undefined)?.tools
    if (!Array.isArray(tools))
      throw new Error(`tools/list result has no tools array${stderrTail()}`)

    const callTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const res = await request('tools/call', { name, arguments: args })
      if (res.error) return `ERROR: ${JSON.stringify(res.error).slice(0, 300)}`
      const result = res.result as
        | { content?: Array<{ text?: string }>; isError?: boolean }
        | undefined
      const text =
        result?.content?.map((c) => c.text ?? '').join('\n') ?? JSON.stringify(result ?? null)
      return result?.isError ? `ERROR: ${text}` : text
    }

    return { tools, callTool, close }
  } catch (err) {
    await close()
    throw err
  }
}

export interface MaterializeLocalMcpOptions {
  /** Handshake / per-request timeout per server (ms). Default 30s. */
  timeoutMs?: number
  /** Cap on a tool result's text fed back to the worker. Default 2000 chars. */
  maxResultChars?: number
  /** Resolves a server's DECLARED secrets (`metadata.secretEnv`: env var name →
   *  provider key name) at spawn time. The resolved values reach ONLY the child
   *  process env — never the profile, the logs, or an error message. Fail-closed:
   *  a server declaring secrets without a provider (or with a missing key)
   *  throws instead of booting keyless. */
  keys?: KeyProvider
}

/** The live same-host materialization of a profile's `mcp` surface. */
export interface LocalMcpMaterialization {
  /** Worker-facing tool specs: namespaced `<server>__<tool>`, provider-safe schemas. */
  tools: AgenticTool[]
  /** Whether `name` is one of this materialization's namespaced tools. */
  owns(name: string): boolean
  /** Route a namespaced call to its server's live stdio child. */
  call(name: string, args: Record<string, unknown>): Promise<string>
  /** Kill every spawned server. Idempotent. */
  close(): Promise<void>
}

/**
 * Spawn every enabled stdio server in `profile.mcp` as a same-host child and
 * expose their tools under `<server>__<tool>` names. A profile with no MCP
 * surface materializes zero tools (a valid, cheap no-op).
 */
export async function materializeLocalMcp(
  profile: AgentProfile,
  opts: MaterializeLocalMcpOptions = {},
): Promise<LocalMcpMaterialization> {
  const maxResultChars = opts.maxResultChars ?? 2000
  const connections: StdioMcpConnection[] = []
  const routes = new Map<string, { conn: StdioMcpConnection; tool: string }>()
  const tools: AgenticTool[] = []

  const close = async (): Promise<void> => {
    await Promise.all(connections.map((c) => c.close()))
  }

  try {
    for (const [key, server] of Object.entries(profile.mcp ?? {})) {
      if (server.enabled === false) continue
      const transport = server.transport ?? 'stdio'
      if (transport !== 'stdio') {
        throw new ValidationError(
          `materializeLocalMcp: profile.mcp['${key}'] has transport '${transport}' — the same-host client only spawns stdio servers; a remote (http/sse) server needs an http MCP client (not yet built here) or the sandbox backend. Failing loud: scoring this profile without its declared server would fake the with/without ablation`,
        )
      }
      if (!server.command || server.command.trim().length === 0) {
        throw new ValidationError(
          `materializeLocalMcp: profile.mcp['${key}'] declares a stdio server with no command`,
        )
      }
      // Provision declared secrets NOW, into the spawn env only. The resolved
      // values live in this local and the child env — nowhere else.
      const secretRefs = secretEnvOfMcpServer(server)
      const provisioned = secretRefs
        ? await resolveSecretEnv(
            secretRefs,
            opts.keys,
            `materializeLocalMcp: profile.mcp['${key}']`,
          )
        : undefined
      const env = server.env || provisioned ? { ...server.env, ...provisioned } : undefined
      const conn = await connectStdioMcp({
        command: server.command,
        ...(server.args ? { args: server.args } : {}),
        ...(server.cwd ? { cwd: server.cwd } : {}),
        ...(env ? { env } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      })
      connections.push(conn)
      const prefix = key.replace(/[^a-zA-Z0-9_-]/g, '_')
      for (const t of conn.tools) {
        const name = `${prefix}__${t.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        if (routes.has(name)) {
          throw new ValidationError(
            `materializeLocalMcp: namespaced tool '${name}' collides across servers — rename the profile.mcp keys`,
          )
        }
        routes.set(name, { conn, tool: t.name })
        tools.push({
          type: 'function',
          function: {
            name,
            description: (t.description ?? '').slice(0, 1000),
            parameters: sanitizeMcpToolSchema(t.inputSchema),
          },
        })
      }
    }
  } catch (err) {
    // Fail CLOSED: never hand back a partial materialization of a profile
    // whose declared server could not boot — that would fake the ablation.
    await close()
    throw err
  }

  return {
    tools,
    owns: (name) => routes.has(name),
    call: async (name, args) => {
      const route = routes.get(name)
      if (!route) throw new Error(`materializeLocalMcp: unknown tool '${name}'`)
      const out = await route.conn.callTool(route.tool, args)
      return out.length > maxResultChars ? out.slice(0, maxResultChars) : out
    },
    close,
  }
}
