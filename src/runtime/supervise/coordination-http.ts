import type { IncomingMessage, ServerResponse } from 'node:http'
import { ConfigError } from '../../errors'
import type { JsonRpcMessage, JsonRpcResponse } from '../../mcp/protocol'

/** Why the coordination boundary refused a request. The refusal's JSON-RPC error body names it, so
 *  an agent reads more than a bare status, and its audit event records it. */
export type CoordinationRejectReason =
  | 'method-not-allowed'
  | 'unknown-path'
  | 'wrong-host'
  | 'origin-refused'
  | 'listener-closed'
  | 'scope-stopped'
  | 'credential-refused'
  | 'unsupported-content-type'
  | 'body-too-large'
  | 'malformed-request'
  | 'request-limit'
  | 'body-timeout'
  | 'action-timeout'

export interface CoordinationHttpAudit {
  readonly runId: string
  readonly actorId: string
  readonly outcome: 'rejected' | 'accepted' | 'completed' | 'completed-after-deadline'
  readonly status: number
  readonly action?: string
  /** Why a `rejected` request was refused. */
  readonly reason?: CoordinationRejectReason
}

/** A refusal before any action runs: its HTTP status and the reason the client is told. */
export interface CoordinationRejection {
  readonly status: number
  readonly reason: CoordinationRejectReason
}

/** The JSON-RPC error a refusal carries. MCP clients put a non-2xx body into the error the agent
 *  sees, so without it the agent reads only `Error POSTing to endpoint:` and a status at best. The
 *  messages are fixed text: never a credential, a request body or an arbitrary error string. */
function rejectionBody(
  reason: CoordinationRejectReason | 'handler-failed',
  limits: ReturnType<typeof coordinationHttpLimits>,
) {
  const messages: Record<CoordinationRejectReason | 'handler-failed', string> = {
    'method-not-allowed': 'coordination accepts only POST',
    'unknown-path': 'no coordination endpoint at this path',
    'wrong-host': 'this coordination endpoint does not serve the requested host',
    'origin-refused': 'coordination refuses requests from this browser origin',
    'listener-closed': 'this coordination endpoint is closed: the manager it served has ended',
    'scope-stopped': 'the manager this coordination endpoint serves has been stopped',
    'credential-refused': 'the coordination credential is missing, invalid, expired or revoked',
    'unsupported-content-type': 'coordination requests must be application/json',
    'body-too-large': `coordination request bodies are limited to ${limits.maxRequestBytes} bytes`,
    'malformed-request': 'the request is not one JSON-RPC 2.0 message',
    'request-limit': `coordination admits ${limits.maxConcurrentRequests} concurrent requests and ${limits.requestsPerMinute} a minute; retry shortly`,
    'body-timeout': `the request body did not arrive within ${limits.requestTimeoutMs} ms`,
    'action-timeout': `the action did not finish within ${limits.requestTimeoutMs} ms and may still complete; read its outcome before repeating it`,
    'handler-failed': 'the coordination handler failed',
  }
  return {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32000, message: messages[reason], data: { reason } },
  }
}

/** Transport limits apply before parsing or executing a coordination action. */
export interface CoordinationHttpOptions {
  readonly maxRequestBytes?: number
  readonly requestTimeoutMs?: number
  readonly maxConcurrentRequests?: number
  readonly requestsPerMinute?: number
  /** Browser origins are refused unless explicitly listed. */
  readonly allowedOrigins?: ReadonlyArray<string>
  /** Audit fields exclude credentials, request bodies, and arbitrary error strings. */
  readonly onAudit?: (event: CoordinationHttpAudit) => Promise<void> | void
}

export function coordinationHttpLimits(options: CoordinationHttpOptions) {
  const positive = (name: string, value: number | undefined, fallback: number) => {
    const resolved = value ?? fallback
    if (!Number.isSafeInteger(resolved) || resolved <= 0) {
      throw new ConfigError(`coordination ${name} must be a positive safe integer`)
    }
    return resolved
  }
  const origins = new Set(options.allowedOrigins ?? [])
  for (const origin of origins) {
    const parsed = new URL(origin)
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new ConfigError('coordination allowedOrigins must contain canonical HTTP origins')
    }
  }
  // Twice the response fence (coordinationResponseFenceMs), so a held answer leaves well before
  // the server's own timeout.
  const requestTimeoutMs = positive('requestTimeoutMs', options.requestTimeoutMs, 90_000)
  if (requestTimeoutMs > 2_147_483_647)
    throw new ConfigError('coordination requestTimeoutMs exceeds the timer limit')
  return {
    maxRequestBytes: positive('maxRequestBytes', options.maxRequestBytes, 1024 * 1024),
    requestTimeoutMs,
    maxConcurrentRequests: positive('maxConcurrentRequests', options.maxConcurrentRequests, 32),
    requestsPerMinute: positive('requestsPerMinute', options.requestsPerMinute, 600),
    origins,
  }
}

/** One bounded HTTP adapter around the existing JSON-RPC handler; it owns no run commands. */
export function coordinationHttpHandler(input: {
  options: CoordinationHttpOptions
  identity: { runId: string; actorId: string }
  authorize(req: IncomingMessage): CoordinationRejection | undefined
  handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null>
  toolNames: ReadonlySet<string>
  /** Actions still executing after their request already answered, such as a fenced tool that
   *  returned pending. Like a timed-out action, each stays charged against concurrency until it
   *  settles, so answering early cannot lift the bound on concurrent work. */
  backgroundActions(): number
}) {
  const limits = coordinationHttpLimits(input.options)
  let active = 0
  let controlActive = 0
  let controlRequests = 0
  let windowStart = Date.now()
  let requests = 0
  const audit = async (
    outcome: CoordinationHttpAudit['outcome'],
    status: number,
    action?: string,
    reason?: CoordinationRejectReason,
  ) => {
    await input.options.onAudit?.({
      ...input.identity,
      outcome,
      status,
      ...(action ? { action } : {}),
      ...(reason ? { reason } : {}),
    })
  }
  return (req: IncomingMessage, res: ServerResponse) => {
    let finished = false
    let executing = false
    let timedOut = false
    let admitted = false
    let controlAdmission = false
    let action: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const release = () => {
      if (admitted) {
        admitted = false
        if (controlAdmission) controlActive--
        else active--
      }
      if (timer) clearTimeout(timer)
    }
    const respond = (status: number, value?: unknown) => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...(status === 405 ? { allow: 'POST' } : {}),
      })
      res.end(value === undefined ? undefined : JSON.stringify(value))
      if (!executing) release()
    }
    const reject = ({ status, reason }: CoordinationRejection) => {
      respond(status, rejectionBody(reason, limits))
      void audit('rejected', status, action, reason).catch(() => undefined)
      req.resume()
    }
    req.on('error', () => reject({ status: 400, reason: 'malformed-request' }))
    req.on('aborted', () => {
      finished = true
      if (!executing) release()
    })
    res.on('close', () => {
      finished = true
      if (!executing) release()
    })
    if (req.method !== 'POST') {
      reject({ status: 405, reason: 'method-not-allowed' })
      return
    }
    const authorization = input.authorize(req)
    if (authorization !== undefined) {
      reject(authorization)
      return
    }
    const origin = req.headers.origin
    if (origin !== undefined && !limits.origins.has(origin)) {
      reject({ status: 403, reason: 'origin-refused' })
      return
    }
    if (
      req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
    ) {
      reject({ status: 415, reason: 'unsupported-content-type' })
      return
    }
    const length = req.headers['content-length']
    if (
      length !== undefined &&
      (!/^\d+$/.test(length) || Number(length) > limits.maxRequestBytes)
    ) {
      reject({ status: 413, reason: 'body-too-large' })
      return
    }
    const now = Date.now()
    if (now - windowStart >= 60_000) {
      windowStart = now
      requests = 0
      controlRequests = 0
    }
    controlAdmission =
      active + input.backgroundActions() >= limits.maxConcurrentRequests ||
      requests >= limits.requestsPerMinute
    if (controlAdmission) {
      // Keep a small independently bounded path for owner observation and cancellation.
      if (controlActive >= 2 || controlRequests >= 60) {
        reject({ status: 429, reason: 'request-limit' })
        return
      }
      controlActive++
    } else {
      requests++
      active++
    }
    admitted = true
    timer = setTimeout(() => {
      timedOut = true
      reject(
        executing
          ? { status: 504, reason: 'action-timeout' }
          : { status: 408, reason: 'body-timeout' },
      )
    }, limits.requestTimeoutMs)
    timer.unref()
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      if (finished) return
      size += chunk.length
      if (size > limits.maxRequestBytes) {
        reject({ status: 413, reason: 'body-too-large' })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (finished) return
      let message: JsonRpcMessage
      try {
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
        )
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          !('jsonrpc' in value) ||
          value.jsonrpc !== '2.0' ||
          !('method' in value) ||
          typeof value.method !== 'string' ||
          ('id' in value &&
            value.id !== null &&
            typeof value.id !== 'string' &&
            (typeof value.id !== 'number' || !Number.isFinite(value.id)))
        ) {
          reject({ status: 400, reason: 'malformed-request' })
          return
        }
        message = value as JsonRpcMessage
      } catch {
        reject({ status: 400, reason: 'malformed-request' })
        return
      }
      const authorization = input.authorize(req)
      if (authorization !== undefined) {
        reject(authorization)
        return
      }
      if (
        message.method === 'tools/call' &&
        message.params &&
        typeof message.params === 'object' &&
        'name' in message.params &&
        typeof message.params.name === 'string' &&
        input.toolNames.has(message.params.name)
      ) {
        action = message.params.name
      }
      if (controlAdmission) {
        const control =
          message.method === 'initialize' ||
          message.method === 'tools/list' ||
          action === 'stop' ||
          action === 'observe_agent' ||
          action === 'read_journal'
        if (!control) {
          reject({ status: 429, reason: 'request-limit' })
          return
        }
        controlRequests++
      }
      executing = true
      void (async () => {
        try {
          await audit('accepted', 200, action)
          if (finished) return
          const authorization = input.authorize(req)
          if (authorization !== undefined) {
            reject(authorization)
            return
          }
          const response = await input.handle(message)
          if (!finished) respond(response === null ? 202 : 200, response ?? undefined)
          await audit(
            timedOut ? 'completed-after-deadline' : 'completed',
            timedOut ? 504 : response === null ? 202 : 200,
            action,
          )
        } catch {
          respond(500, rejectionBody('handler-failed', limits))
        } finally {
          executing = false
          release()
        }
      })()
    })
  }
}
