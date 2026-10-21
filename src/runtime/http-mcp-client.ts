/**
 * `connectHttpMcp` — the remote (streamable HTTP) MCP client, sibling of
 * `connectStdioMcp`. Same connection contract (`tools`, `callTool`, `close`),
 * same error semantics (a JSON-RPC error / `isError` result is the agent's
 * `ERROR: …` outcome; a transport fault or timeout throws), no child process —
 * which is the point: this is the MCP path for environments that cannot spawn
 * stdio servers (Workers, browser-context agents, locked-down sandboxes) and
 * for servers that only exist as endpoints (a remote Hindsight, a hosted MCP).
 *
 * Transport: MCP "streamable HTTP" (protocol 2025-03-26 / 2025-06-18). Every
 * request is a POST with `Accept: application/json, text/event-stream`; the
 * server may answer either shape, so both are parsed. A server-assigned
 * `Mcp-Session-Id` response header is captured and replayed on every later
 * request (and the DELETE on close) — stateful servers refuse without it,
 * stateless ones simply never send it.
 *
 * Auth headers can be protected values: they are sent to the server but never
 * allowed back out — error messages and tool results are redacted against the
 * exact protected values, mirroring `connectStdioMcp`'s protectedEnv handling.
 */

import { ValidationError } from '../errors'
import type { McpListedTool, StdioMcpConnection } from './stdio-mcp-client'

export const HTTP_MCP_PROTOCOL_VERSION = '2025-06-18'

export interface HttpMcpServerSpec {
  /** The MCP endpoint URL, e.g. `https://host/mcp`. */
  url: string
  /** Public request headers (e.g. `{'x-client': 'agent-runtime'}`). */
  headers?: Record<string, string>
  /** Sensitive request headers (e.g. `authorization`). Sent, never surfaced:
   *  errors and tool results are redacted against these exact values. */
  protectedHeaders?: Record<string, string>
  /** Per-request timeout (ms). Default 30s. */
  timeoutMs?: number
  /** Override fetch (tests + constrained runtimes). */
  fetchImpl?: typeof fetch
}

export type HttpMcpConnection = StdioMcpConnection

/** A remote MCP endpoint refused the connection before the handshake completed. */
export class McpConnectFault extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
  ) {
    super(message)
    this.name = 'McpConnectFault'
  }
}

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

const SSE_DATA_LINE = /^data:\s?(.*)$/s

function parseSseBody(body: string, wantId: number): JsonRpcResponse | undefined {
  // A streamable-HTTP response carries one JSON-RPC message per `data:` event.
  // The endpoint may interleave heartbeat comments; only the matching id counts.
  for (const chunk of body.split(/\r?\n\r?\n/)) {
    for (const line of chunk.split(/\r?\n/)) {
      const match = SSE_DATA_LINE.exec(line)
      if (!match) continue
      try {
        const parsed = JSON.parse(match[1] ?? '') as JsonRpcResponse
        if (parsed.id === wantId) return parsed
      } catch {
        // A non-JSON data line is not ours; keep scanning.
      }
    }
  }
  return undefined
}

function redactValuesFrom(text: string, values: ReadonlyArray<string>): string {
  let out = text
  for (const value of values) {
    if (value.length > 0) out = out.split(value).join('[redacted]')
  }
  return out
}

/** Connect to a remote MCP endpoint: initialize, list tools, return the live connection. */
export async function connectHttpMcp(spec: HttpMcpServerSpec): Promise<HttpMcpConnection> {
  let endpoint: URL
  try {
    endpoint = new URL(spec.url)
  } catch {
    throw new ValidationError(`connectHttpMcp: invalid MCP endpoint URL: ${spec.url}`)
  }
  if (
    endpoint.protocol !== 'https:' &&
    endpoint.hostname !== 'localhost' &&
    endpoint.hostname !== '127.0.0.1'
  ) {
    throw new ValidationError(
      `connectHttpMcp: refusing non-HTTPS MCP endpoint ${endpoint.origin} (localhost excepted) — a bearer or api key on plain HTTP would cross the network in the clear`,
    )
  }

  const fetchImpl = spec.fetchImpl ?? fetch
  const timeoutMs = spec.timeoutMs ?? 30_000
  const protectedValues = Object.values(spec.protectedHeaders ?? {})
  const redact = (text: string): string => redactValuesFrom(text, protectedValues)

  let sessionId: string | undefined
  let nextId = 1
  let closed = false

  const post = async (
    path: string,
    body: unknown,
    method: 'POST' | 'DELETE' = 'POST',
    signal?: AbortSignal,
  ): Promise<Response> =>
    fetchImpl(`${endpoint.origin}${endpoint.pathname}${endpoint.search}${path}`, {
      method,
      ...(signal ? { signal } : {}),
      headers: {
        accept: 'application/json, text/event-stream',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(sessionId !== undefined ? { 'mcp-session-id': sessionId } : {}),
        ...(body !== undefined ? { 'x-request-id': String(nextId) } : {}),
        ...(spec.headers ?? {}),
        ...(spec.protectedHeaders ?? {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

  const request = async (method: string, params: unknown): Promise<JsonRpcResponse> => {
    if (closed) throw new Error('HTTP MCP connection closed')
    const id = nextId++
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await post('', { jsonrpc: '2.0', id, method, params }, 'POST', controller.signal)
      const sessionHeader = res.headers.get('mcp-session-id')
      if (sessionHeader) sessionId = sessionHeader
      if (!res.ok) {
        const text = redact((await res.text()).slice(0, 500))
        throw new McpConnectFault(
          `HTTP MCP ${method} failed (${res.status} ${res.statusText}): ${text}`,
          res.status,
        )
      }
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream')) {
        const body = await res.text()
        const parsed = parseSseBody(body, id)
        if (!parsed) {
          throw new Error(
            `HTTP MCP ${method}: SSE response carried no JSON-RPC message for request ${id}`,
          )
        }
        return parsed
      }
      return JSON.parse(await res.text()) as JsonRpcResponse
    } catch (error) {
      if (error instanceof McpConnectFault) throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(redact(`HTTP MCP ${method} transport failed: ${reason}`))
    } finally {
      clearTimeout(timer)
    }
  }

  const handshakeLabel = `HTTP MCP endpoint ${endpoint.origin}${endpoint.pathname} did not complete the handshake within ${timeoutMs}ms`
  try {
    const init = await request('initialize', {
      protocolVersion: HTTP_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'agent-runtime-http-mcp', version: '0' },
    })
    if (init.error) {
      throw new McpConnectFault(
        redact(`initialize errored: ${JSON.stringify(init.error)}`),
        undefined,
      )
    }
    // notifications/initialized: a notification has no id and expects no response.
    await post('', { jsonrpc: '2.0', method: 'notifications/initialized' }, 'POST').catch(
      () => undefined,
    )
    const list = await request('tools/list', undefined)
    if (list.error) {
      throw new Error(redact(`tools/list errored: ${JSON.stringify(list.error)}`))
    }
    const rawTools = (list.result as { tools?: McpListedTool[] } | undefined)?.tools
    if (!Array.isArray(rawTools)) throw new Error('tools/list result has no tools array')
    const tools = JSON.parse(redact(JSON.stringify(rawTools))) as McpListedTool[]

    const callTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const res = await request('tools/call', { name, arguments: args })
      if (res.error) return `ERROR: ${redact(JSON.stringify(res.error)).slice(0, 300)}`
      const result = res.result as
        | { content?: Array<{ text?: string }>; isError?: boolean }
        | undefined
      const chunks = result?.content?.map((c) => c.text ?? '')
      const joined = chunks?.join('\n') ?? JSON.stringify(result ?? null)
      const collapsed = chunks?.join('')
      let text = joined
      if (collapsed !== undefined) {
        const collapsedRedacted = redact(collapsed)
        if (collapsedRedacted !== collapsed) text = collapsedRedacted
      }
      return redact(result?.isError ? `ERROR: ${text}` : text)
    }

    const close = async (): Promise<void> => {
      if (closed) return
      closed = true
      // Stateful servers release the session on DELETE; stateless ones 405 —
      // either way the connection is inert after this returns.
      await post('', undefined, 'DELETE').catch(() => undefined)
    }

    return { tools, callTool, close }
  } catch (error) {
    void handshakeLabel
    throw error instanceof Error ? error : new Error(String(error))
  }
}
