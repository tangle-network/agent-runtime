/**
 * `createStdioToolServer` — the generic newline-delimited JSON-RPC 2.0 MCP
 * server core: `initialize` / `notifications/initialized` / `tools/list` /
 * `ping` / `tools/call` over a stdio-shaped transport. It answers the
 * client's protocol version when listed in `SUPPORTED_PROTOCOL_VERSIONS`,
 * else 2024-11-05, and publishes tool annotations when a tool declares them.
 *
 * Extracted from `createMcpServer` (server.ts) so every in-repo MCP server —
 * the delegation server, the memory server — serves the ONE wire protocol the
 * same-host client (`connectStdioMcp`, runtime/stdio-mcp-client.ts) speaks.
 * A second hand-rolled serve loop could drift from what the client expects;
 * this core makes that impossible by construction.
 *
 * @experimental
 */

import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { ValidationError } from '../errors'
import type { JsonRpcMessage, JsonRpcResponse, McpToolDescriptor, McpTransport } from './protocol'

export type {
  JsonRpcMessage,
  JsonRpcResponse,
  McpToolAnnotations,
  McpToolDescriptor,
  McpTransport,
} from './protocol'

export const PROTOCOL_VERSION = '2024-11-05'

/**
 * Protocol versions this server speaks, newest first. `initialize` answers with
 * the client's requested version when it is listed here, and otherwise with
 * `PROTOCOL_VERSION` (2024-11-05), which every client that speaks 2024-11-05 accepts.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  PROTOCOL_VERSION,
]

/** @experimental */
export interface StdioToolServerOptions {
  /** Server display name surfaced via `initialize`. */
  serverName: string
  /** Server version surfaced via `initialize`. */
  serverVersion: string
  /** The tools to serve. Duplicate names throw — a silent shadow would hide a tool. */
  tools: readonly McpToolDescriptor[]
}

/** @experimental */
export interface StdioToolServer {
  /** Tools currently registered, keyed by name. */
  readonly tools: ReadonlyMap<string, McpToolDescriptor>
  /** Handle a single parsed JSON-RPC message. Returns the response object (or `null` for notifications). */
  handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null>
  /** Drive the server on a stdio-shaped transport until `stop()` is called. */
  serve(transport?: McpTransport): Promise<void>
  /** Stop a `serve` call. Subsequent requests are rejected. */
  stop(): void
}

/** Build the generic stdio JSON-RPC tool server. */
export function createStdioToolServer(options: StdioToolServerOptions): StdioToolServer {
  const tools = new Map<string, McpToolDescriptor>()
  for (const tool of options.tools) {
    if (tools.has(tool.name)) {
      throw new ValidationError(`createStdioToolServer: duplicate tool name "${tool.name}"`)
    }
    tools.set(tool.name, tool)
  }

  let stopped = false
  let activeReadline: ReadlineInterface | undefined

  async function handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    if (stopped) {
      return rpcError(message.id ?? null, -32099, 'server stopped')
    }
    if (message.method === 'initialize') {
      const requested = (message.params as { protocolVersion?: unknown } | undefined)
        ?.protocolVersion
      return rpcResult(message.id ?? null, {
        protocolVersion:
          typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: options.serverName, version: options.serverVersion },
      })
    }
    if (message.method === 'notifications/initialized') {
      // MCP clients send this after the handshake; it has no id and expects
      // no response.
      return null
    }
    if (message.method === 'ping') {
      return rpcResult(message.id ?? null, {})
    }
    if (message.method === 'tools/list') {
      return rpcResult(message.id ?? null, {
        tools: [...tools.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        })),
      })
    }
    if (message.method === 'tools/call') {
      const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown }
      const name = typeof params.name === 'string' ? params.name : ''
      const tool = tools.get(name)
      if (!tool) {
        return rpcError(message.id ?? null, -32601, `unknown tool: ${name}`)
      }
      try {
        const output = await tool.handler(params.arguments ?? {})
        return rpcResult(message.id ?? null, toolCallResult(output))
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        const code = err instanceof TypeError || err instanceof RangeError ? -32602 : -32000
        return rpcError(message.id ?? null, code, reason)
      }
    }
    if (message.id === undefined || message.id === null) return null
    return rpcError(message.id, -32601, `unknown method: ${message.method}`)
  }

  async function serve(transport?: McpTransport): Promise<void> {
    const input = transport?.input ?? process.stdin
    const output = transport?.output ?? process.stdout
    const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
    activeReadline = rl
    return new Promise<void>((resolve, reject) => {
      rl.on('line', (line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        let parsed: JsonRpcMessage | undefined
        try {
          parsed = JSON.parse(trimmed) as JsonRpcMessage
        } catch (err) {
          writeResponse(output, rpcError(null, -32700, `parse error: ${(err as Error).message}`))
          return
        }
        if (parsed?.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
          writeResponse(output, rpcError(parsed?.id ?? null, -32600, 'invalid request'))
          return
        }
        void handle(parsed).then((response) => {
          if (response) writeResponse(output, response)
        })
      })
      rl.on('close', () => resolve())
      rl.on('error', (err) => reject(err))
      if (stopped) {
        rl.close()
        resolve()
      }
    })
  }

  function stop(): void {
    stopped = true
    activeReadline?.close()
    activeReadline = undefined
  }

  return { tools, handle, serve, stop }
}

function toolCallResult(output: unknown): {
  content: [{ type: 'text'; text: string }]
  structuredContent?: Record<string, unknown>
  isError: false
} {
  let json: string | undefined
  try {
    json = JSON.stringify(output)
  } catch (err) {
    const reason = err instanceof Error ? `: ${err.message}` : ''
    throw new TypeError(`MCP tool result must be JSON-serializable${reason}`, { cause: err })
  }
  if (json === undefined) {
    throw new TypeError('MCP tool result must be JSON-serializable')
  }

  const serialized = JSON.parse(json) as unknown
  // Preserve string content verbatim. MCP clients pass this text directly to the calling agent.
  const result: {
    content: [{ type: 'text'; text: string }]
    structuredContent?: Record<string, unknown>
    isError: false
  } = {
    content: [{ type: 'text', text: typeof serialized === 'string' ? serialized : json }],
    isError: false,
  }
  if (serialized !== null && typeof serialized === 'object' && !Array.isArray(serialized)) {
    result.structuredContent = serialized as Record<string, unknown>
  }
  return result
}

function rpcResult(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  }
}

function writeResponse(output: NodeJS.WritableStream, response: JsonRpcResponse): void {
  output.write(`${JSON.stringify(response)}\n`)
}
