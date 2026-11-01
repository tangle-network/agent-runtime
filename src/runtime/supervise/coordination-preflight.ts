import { ConfigError } from '../../errors'
import { PROTOCOL_VERSION } from '../../mcp/tool-server'
import { linkAbort, runAbortable } from './abortable'
import { causeChain } from './error-message'
import { TRANSPORT_ERROR_CODES } from './retained-executor'

const MAX_RESPONSE_BYTES = 1024 * 1024

class CoordinationPreflightError extends ConfigError {
  constructor(reason: string) {
    super(`coordination public endpoint preflight failed: ${reason}`)
  }
}

/**
 * The route timed out, lost its socket, or answered 408, 429 or 5xx: it cannot serve now, so a
 * manager waits for it as for any unavailable upstream. magnetar-rust-sandbox-20261101b's :s2:s2
 * and :s1:s1 settled down on `timed out` while drew-gtr-pro, which serves the route, ran at load 25.
 */
export class CoordinationUnreachableError extends Error {
  override name = 'CoordinationUnreachableError'
}
const unreachable = (reason: string) =>
  new CoordinationUnreachableError(`coordination public endpoint preflight failed: ${reason}`)

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Check the operator's route before it becomes a provider attachment. This does not prove cloud egress. */
export async function preflightPublicCoordination(input: {
  url: string
  headers: Readonly<Record<string, string>>
  signal: AbortSignal
  requestTimeoutMs: number
  toolNames: readonly string[]
}): Promise<void> {
  const deadline = new AbortController()
  const linked = linkAbort(input.signal, deadline.signal)
  // The listener's own bound on a request. On magnetar-rust-sandbox-20261101b the Lab's ingress held
  // coordination requests open 24.5 s and 39.7 s, which a 10 s cap here judged unreachable.
  const timer = setTimeout(() => deadline.abort(), input.requestTimeoutMs)
  timer.unref()
  const rpc = async (method: string, params?: unknown): Promise<Record<string, unknown>> => {
    const response = await fetch(input.url, {
      method: 'POST',
      headers: { ...input.headers, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method, method, ...(params ? { params } : {}) }),
      redirect: 'manual',
      signal: linked.signal,
    })
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => undefined)
      const { status } = response
      if (status === 408 || status === 429 || status >= 500) throw unreachable(`HTTP ${status}`)
      throw new CoordinationPreflightError(`HTTP ${status}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new CoordinationPreflightError('invalid MCP response')
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => undefined)
          throw new CoordinationPreflightError('response too large')
        }
        chunks.push(part.value)
      }
    } finally {
      reader.releaseLock()
    }
    let body: unknown
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
    } catch {
      throw new CoordinationPreflightError('invalid MCP response')
    }
    if (
      !record(body) ||
      body.jsonrpc !== '2.0' ||
      body.id !== method ||
      body.error ||
      !record(body.result)
    ) {
      throw new CoordinationPreflightError('invalid MCP response')
    }
    return body.result
  }
  try {
    await runAbortable(
      async () => {
        const initialized = await rpc('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'agent-runtime-coordination-preflight', version: '1' },
        })
        if (
          initialized.protocolVersion !== PROTOCOL_VERSION ||
          !record(initialized.serverInfo) ||
          initialized.serverInfo.name !== 'coordination' ||
          !record(initialized.capabilities) ||
          !record(initialized.capabilities.tools)
        )
          throw new CoordinationPreflightError('invalid MCP initialization')
        const listing = await rpc('tools/list')
        if (
          !Array.isArray(listing.tools) ||
          listing.tools.some((tool) => !record(tool) || typeof tool.name !== 'string')
        ) {
          throw new CoordinationPreflightError('invalid MCP tool list')
        }
        const names = listing.tools.map((tool) => tool.name).sort()
        if (JSON.stringify(names) !== JSON.stringify([...input.toolNames].sort())) {
          throw new CoordinationPreflightError('coordination tool grants differ')
        }
      },
      linked.signal,
      'coordination public endpoint preflight cancelled',
    )
  } catch (error) {
    // Neither a response body nor an upstream exception is safe to retain: both can echo credentials.
    if (input.signal.aborted) throw new CoordinationPreflightError('cancelled')
    if (deadline.signal.aborted) throw unreachable('timed out')
    if (error instanceof CoordinationPreflightError) throw error
    if (error instanceof CoordinationUnreachableError) throw error
    // undici names a lost socket by its code on the cause; a TLS or identity refusal stays refused.
    if (causeChain(error).some((cause) => TRANSPORT_ERROR_CODES.has(String(Object(cause).code))))
      throw unreachable('transport unavailable')
    throw new CoordinationPreflightError('transport unavailable')
  } finally {
    clearTimeout(timer)
    linked.release()
  }
}
