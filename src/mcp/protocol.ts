/**
 * Shared wire contracts for the in-process stdio MCP servers.
 *
 * Keeping these types in one module prevents the delegation and generic tool
 * servers from accepting subtly different JSON-RPC messages.
 *
 * @experimental
 */

/** A callable MCP tool exposed by either stdio server. @experimental */
export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (raw: unknown) => Promise<unknown>
}

/** Stdio-shaped transport used by the shared JSON-RPC server implementation. @experimental */
export interface McpTransport {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
}

/** One JSON-RPC 2.0 request or notification. @experimental */
export interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: unknown
}

/** One JSON-RPC 2.0 response. @experimental */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}
