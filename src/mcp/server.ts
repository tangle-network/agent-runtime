/**
 * @experimental
 *
 * Stdio JSON-RPC MCP server exposing the 5 delegation tools to sandbox
 * coding-harness agents (claude-code, codex, opencode, ...).
 *
 * The server is transport-bound but topology-free: tool execution is
 * delegated to handler functions composed from a queue, a feedback
 * store, and per-profile run delegates. Consumers wire those at
 * construction time. The `agent-runtime-mcp` bin spins up a default
 * configuration for the common case (real sandbox client + coder).
 *
 * Wire protocol: line-delimited JSON-RPC 2.0 over stdio. Each line is
 * one request; each response is one line. `tools/list` and `tools/call`
 * mirror the MCP 2024-11-05 spec; we do not pull in
 * `@modelcontextprotocol/sdk` to keep the dependency footprint zero.
 */

import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { Readable, Writable } from 'node:stream'
import type { CoderDelegate, ResearcherDelegate } from './delegates'
import { type FeedbackStore, InMemoryFeedbackStore } from './feedback-store'
import { DelegationTaskQueue } from './task-queue'
import {
  createDelegateCodeHandler,
  DELEGATE_CODE_DESCRIPTION,
  DELEGATE_CODE_INPUT_SCHEMA,
  DELEGATE_CODE_TOOL_NAME,
} from './tools/delegate-code'
import {
  createDelegateFeedbackHandler,
  DELEGATE_FEEDBACK_DESCRIPTION,
  DELEGATE_FEEDBACK_INPUT_SCHEMA,
  DELEGATE_FEEDBACK_TOOL_NAME,
} from './tools/delegate-feedback'
import {
  createDelegateResearchHandler,
  DELEGATE_RESEARCH_DESCRIPTION,
  DELEGATE_RESEARCH_INPUT_SCHEMA,
  DELEGATE_RESEARCH_TOOL_NAME,
} from './tools/delegate-research'
import {
  createDelegationHistoryHandler,
  DELEGATION_HISTORY_DESCRIPTION,
  DELEGATION_HISTORY_INPUT_SCHEMA,
  DELEGATION_HISTORY_TOOL_NAME,
} from './tools/delegation-history'
import {
  createDelegationStatusHandler,
  DELEGATION_STATUS_DESCRIPTION,
  DELEGATION_STATUS_INPUT_SCHEMA,
  DELEGATION_STATUS_TOOL_NAME,
} from './tools/delegation-status'

/** @experimental */
export interface McpServerOptions {
  /** Required to enable delegate_code. */
  coderDelegate?: CoderDelegate
  /**
   * Required to enable delegate_research. The substrate cannot ship a
   * default — wire one that closes over your `runLoop` + a
   * researcher profile (typically `@tangle-network/agent-knowledge`'s
   * `researcherProfile` / `multiHarnessResearcherFanout`).
   */
  researcherDelegate?: ResearcherDelegate
  /** Override the default in-memory feedback store. */
  feedbackStore?: FeedbackStore
  /** Override the default in-memory task queue. */
  queue?: DelegationTaskQueue
  /** Server display name surfaced via `initialize`. Default `'agent-runtime-mcp'`. */
  serverName?: string
  /** Server version surfaced via `initialize`. Default = the package version baked at build time. */
  serverVersion?: string
}

/** @experimental */
export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (raw: unknown) => Promise<unknown>
}

/** @experimental */
export interface McpServer {
  /** Tools currently registered (depend on which delegates were wired). */
  readonly tools: ReadonlyMap<string, McpToolDescriptor>
  /** The underlying queue — exposed so tests can introspect it. */
  readonly queue: DelegationTaskQueue
  /** The feedback store — exposed for the same reason. */
  readonly feedbackStore: FeedbackStore
  /** Handle a single parsed JSON-RPC message. Returns the response object (or `null` for notifications). */
  handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null>
  /** Drive the server on a stdio-shaped transport until `stop()` is called. */
  serve(transport?: McpTransport): Promise<void>
  /** Stop a `serve` call. Subsequent requests are rejected. */
  stop(): void
}

/** @experimental */
export interface McpTransport {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
}

/** @experimental */
export interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: unknown
}

/** @experimental */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const PROTOCOL_VERSION = '2024-11-05'
const DEFAULT_SERVER_NAME = 'agent-runtime-mcp'
const DEFAULT_SERVER_VERSION = '0.20.0'

/** @experimental */
export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const queue = options.queue ?? new DelegationTaskQueue()
  const feedbackStore = options.feedbackStore ?? new InMemoryFeedbackStore()
  const serverName = options.serverName ?? DEFAULT_SERVER_NAME
  const serverVersion = options.serverVersion ?? DEFAULT_SERVER_VERSION

  const tools = new Map<string, McpToolDescriptor>()

  if (options.coderDelegate) {
    tools.set(DELEGATE_CODE_TOOL_NAME, {
      name: DELEGATE_CODE_TOOL_NAME,
      description: DELEGATE_CODE_DESCRIPTION,
      inputSchema: DELEGATE_CODE_INPUT_SCHEMA as unknown as Record<string, unknown>,
      handler: createDelegateCodeHandler({ queue, delegate: options.coderDelegate }),
    })
  }
  if (options.researcherDelegate) {
    tools.set(DELEGATE_RESEARCH_TOOL_NAME, {
      name: DELEGATE_RESEARCH_TOOL_NAME,
      description: DELEGATE_RESEARCH_DESCRIPTION,
      inputSchema: DELEGATE_RESEARCH_INPUT_SCHEMA as unknown as Record<string, unknown>,
      handler: createDelegateResearchHandler({ queue, delegate: options.researcherDelegate }),
    })
  }
  tools.set(DELEGATE_FEEDBACK_TOOL_NAME, {
    name: DELEGATE_FEEDBACK_TOOL_NAME,
    description: DELEGATE_FEEDBACK_DESCRIPTION,
    inputSchema: DELEGATE_FEEDBACK_INPUT_SCHEMA as unknown as Record<string, unknown>,
    handler: createDelegateFeedbackHandler({ queue, store: feedbackStore }),
  })
  tools.set(DELEGATION_STATUS_TOOL_NAME, {
    name: DELEGATION_STATUS_TOOL_NAME,
    description: DELEGATION_STATUS_DESCRIPTION,
    inputSchema: DELEGATION_STATUS_INPUT_SCHEMA as unknown as Record<string, unknown>,
    handler: createDelegationStatusHandler({ queue }),
  })
  tools.set(DELEGATION_HISTORY_TOOL_NAME, {
    name: DELEGATION_HISTORY_TOOL_NAME,
    description: DELEGATION_HISTORY_DESCRIPTION,
    inputSchema: DELEGATION_HISTORY_INPUT_SCHEMA as unknown as Record<string, unknown>,
    handler: createDelegationHistoryHandler({ queue }),
  })

  let stopped = false
  let activeReadline: ReadlineInterface | undefined

  async function handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    if (stopped) {
      return rpcError(message.id ?? null, -32099, 'server stopped')
    }
    if (message.method === 'initialize') {
      return rpcResult(message.id ?? null, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: serverName, version: serverVersion },
      })
    }
    if (message.method === 'notifications/initialized') {
      // MCP clients send this after the handshake; it has no id and expects
      // no response.
      return null
    }
    if (message.method === 'tools/list') {
      return rpcResult(message.id ?? null, {
        tools: [...tools.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
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
        return rpcResult(message.id ?? null, {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
          isError: false,
        })
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
        if (!parsed || parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
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

  return {
    tools,
    queue,
    feedbackStore,
    handle,
    serve,
    stop,
  }
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

/**
 * In-process pair of `Readable` + `Writable` streams suitable for driving
 * `server.serve(...)` from a test. Returns the agent-side stream (the
 * client writes to it) and the server-side stream (the test reads from it).
 *
 * @experimental
 */
export function createInProcessTransport(): {
  transport: McpTransport
  clientWrite(line: string): void
  clientClose(): void
  readServer(): Promise<JsonRpcResponse[]>
} {
  const responses: JsonRpcResponse[] = []
  const input = new Readable({ read() {} })
  const output = new Writable({
    write(chunk, _enc, cb) {
      const text = chunk.toString('utf8')
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          responses.push(JSON.parse(trimmed) as JsonRpcResponse)
        } catch {
          // Non-JSON output should never appear; drop it silently in the
          // test transport rather than crashing.
        }
      }
      cb()
    },
  })
  return {
    transport: { input, output },
    clientWrite(line: string) {
      input.push(`${line}\n`)
    },
    clientClose() {
      input.push(null)
    },
    async readServer() {
      // Yield to the event loop a few times so async handlers drain.
      for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r))
      return [...responses]
    },
  }
}
