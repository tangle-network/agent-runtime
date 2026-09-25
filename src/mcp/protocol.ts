/**
 * Shared wire contracts for the in-process stdio MCP servers.
 *
 * Keeping these types in one module prevents the delegation and generic tool
 * servers from accepting subtly different JSON-RPC messages.
 *
 * @experimental
 */

/**
 * MCP tool annotations (protocol 2025-03-26 and later). Hints a client reads
 * before calling, for example to run a read-only tool without confirmation.
 * They describe the tool; they do not enforce anything. @experimental
 */
export interface McpToolAnnotations {
  title?: string
  /** The tool does not modify its environment. */
  readOnlyHint?: boolean
  /** The tool may perform destructive updates. Meaningful only when not read-only. */
  destructiveHint?: boolean
  /** Repeating a call with the same arguments has no additional effect. */
  idempotentHint?: boolean
  /** The tool may reach entities outside its own data, such as the web. */
  openWorldHint?: boolean
}

/** A callable MCP tool exposed by either stdio server. @experimental */
export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Published in `tools/list` when present. */
  annotations?: McpToolAnnotations
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
