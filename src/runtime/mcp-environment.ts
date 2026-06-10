/**
 * createMcpEnvironment — wrap any MCP server as an `Environment` (the product-adoption
 * primitive: a product's agent tools are usually already an MCP surface, so the domain
 * only writes the lifecycle hooks — open a scoped artifact, score it with a deployable
 * check, close it — and the tool plumbing is derived from the server).
 *
 * What the helper owns (the generic 80%, hardened on the EnterpriseOps gym):
 *   - JSON-RPC `tools/list` → `AgenticTool[]`, with schemas coerced to the
 *     OpenAI-tool-valid shape (top-level oneOf/anyOf/allOf/enum/not are rejected by
 *     tool-calling providers; nested combinators are fine).
 *   - JSON-RPC `tools/call` → the tool's text content (errors surfaced as `ERROR: …`
 *     strings — a bad call is the agent's outcome, not an infra fault).
 *   - SSE response parsing (streamable-HTTP MCP servers answer with `data:` lines).
 *   - Bounded retry with backoff on thrown fetches (transient network ≠ task failure).
 *
 * What the domain supplies: `open` (create/seed the per-task artifact and return its
 * MCP endpoint — url + headers carry the per-artifact scoping, e.g. a database id
 * header), `score` (the deployable check), and optional `close`/`selectTools`.
 */

import type { Environment } from './run-benchmark'
import type { AgenticTask, AgenticTool, ArtifactHandle, SurfaceScore } from './strategy'

/** Where a handle's MCP server lives; headers carry per-artifact scoping. */
export interface McpEndpoint {
  url: string
  headers?: Record<string, string>
}

export interface McpEnvironmentOptions {
  name: string
  /** Create/seed the per-task artifact; return its handle + the MCP endpoint scoped to it. */
  open(task: AgenticTask): Promise<{ handle: ArtifactHandle; endpoint: McpEndpoint }>
  /** The deployable check over the artifact's current state. */
  score(task: AgenticTask, handle: ArtifactHandle): Promise<SurfaceScore>
  /** Teardown (delete the seeded artifact). Optional — omit for stateless servers. */
  close?(handle: ArtifactHandle): Promise<void>
  /** Restrict/order the server's tools per task (e.g. the task's selected_tools). Default: all. */
  selectTools?(task: AgenticTask, all: AgenticTool[]): AgenticTool[]
  /** Cap on a tool result's text fed back to the worker. Default 1500 chars. */
  maxResultChars?: number
}

/** POST JSON-RPC and parse a JSON body OR the last `data:` line of an SSE stream.
 *  Retries thrown fetches (transient network) with linear backoff; HTTP status and
 *  JSON-RPC errors are returned to the caller, not retried. */
async function rpc(
  endpoint: McpEndpoint,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const r = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(endpoint.headers ?? {}) },
        body: JSON.stringify(body),
      })
      const text = await r.text()
      const dataLines = text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
      const payload = dataLines.length ? dataLines[dataLines.length - 1] : text
      try {
        return { status: r.status, json: JSON.parse(payload ?? 'null') }
      } catch {
        return { status: r.status, json: text }
      }
    } catch (err) {
      lastErr = err
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
    }
  }
  throw new Error(
    `mcp rpc ${endpoint.url} failed after 4 attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  )
}

/** Coerce an MCP inputSchema to an OpenAI-tool-valid top-level object schema. */
function sanitizeSchema(s: unknown): Record<string, unknown> {
  const o = s && typeof s === 'object' ? (s as Record<string, unknown>) : {}
  const banned = o.oneOf || o.anyOf || o.allOf || o.not || o.enum
  if (o.type === 'object' && !banned && o.properties && typeof o.properties === 'object') {
    return {
      type: 'object',
      properties: o.properties as Record<string, unknown>,
      ...(Array.isArray(o.required) ? { required: o.required as string[] } : {}),
    }
  }
  return { type: 'object', properties: {} }
}

export function createMcpEnvironment(opts: McpEnvironmentOptions): Environment {
  const endpoints = new Map<string, McpEndpoint>()
  const maxChars = opts.maxResultChars ?? 1500

  return {
    name: opts.name,

    async open(task) {
      const { handle, endpoint } = await opts.open(task)
      endpoints.set(handle.id, endpoint)
      return handle
    },

    async tools(task, handle) {
      const endpoint = endpoints.get(handle.id)
      if (!endpoint) throw new Error(`${opts.name}: tools() before open() for ${handle.id}`)
      const { json } = await rpc(endpoint, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      })
      const all = (
        (
          json as {
            result?: {
              tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>
            }
          }
        ).result?.tools ?? []
      ).map(
        (t): AgenticTool => ({
          type: 'function',
          function: {
            name: t.name,
            description: (t.description ?? '').slice(0, 1000),
            parameters: sanitizeSchema(t.inputSchema),
          },
        }),
      )
      return opts.selectTools ? opts.selectTools(task, all) : all
    },

    async call(handle, name, args) {
      const endpoint = endpoints.get(handle.id)
      if (!endpoint) return 'ERROR: workspace closed'
      const { json } = await rpc(endpoint, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name, arguments: args },
      })
      const result =
        (json as {
          result?: { content?: Array<{ text?: string }>; isError?: boolean }
          error?: unknown
        }) ?? {}
      if (result.error) return `ERROR: ${JSON.stringify(result.error).slice(0, 300)}`
      const text =
        result.result?.content?.map((c) => c.text ?? '').join('\n') ??
        JSON.stringify(result.result ?? json)
      return text.slice(0, maxChars)
    },

    score: (task, handle) => opts.score(task, handle),

    async close(handle) {
      endpoints.delete(handle.id)
      await opts.close?.(handle)
    },
  }
}
