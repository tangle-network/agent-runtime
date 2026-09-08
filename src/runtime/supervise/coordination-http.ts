import type { IncomingMessage, ServerResponse } from 'node:http'
import { ConfigError } from '../../errors'
import type { JsonRpcMessage, JsonRpcResponse } from '../../mcp/protocol'

export interface CoordinationHttpAudit {
  readonly runId: string
  readonly actorId: string
  readonly outcome: 'rejected' | 'accepted' | 'completed' | 'completed-after-deadline'
  readonly status: number
  readonly action?: string
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
  const requestTimeoutMs = positive('requestTimeoutMs', options.requestTimeoutMs, 30_000)
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
  authorize(req: IncomingMessage): number | undefined
  handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null>
  toolNames: ReadonlySet<string>
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
  ) => {
    await input.options.onAudit?.({
      ...input.identity,
      outcome,
      status,
      ...(action ? { action } : {}),
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
    const reject = (status: number) => {
      respond(status)
      void audit('rejected', status, action).catch(() => undefined)
      req.resume()
    }
    req.on('error', () => reject(400))
    req.on('aborted', () => {
      finished = true
      if (!executing) release()
    })
    res.on('close', () => {
      finished = true
      if (!executing) release()
    })
    if (req.method !== 'POST') {
      reject(405)
      return
    }
    const authorization = input.authorize(req)
    if (authorization !== undefined) {
      reject(authorization)
      return
    }
    const origin = req.headers.origin
    if (origin !== undefined && !limits.origins.has(origin)) {
      reject(403)
      return
    }
    if (
      req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
    ) {
      reject(415)
      return
    }
    const length = req.headers['content-length']
    if (
      length !== undefined &&
      (!/^\d+$/.test(length) || Number(length) > limits.maxRequestBytes)
    ) {
      reject(413)
      return
    }
    const now = Date.now()
    if (now - windowStart >= 60_000) {
      windowStart = now
      requests = 0
      controlRequests = 0
    }
    controlAdmission =
      active >= limits.maxConcurrentRequests || requests >= limits.requestsPerMinute
    if (controlAdmission) {
      // Keep a small independently bounded path for owner observation and cancellation.
      if (controlActive >= 2 || controlRequests >= 60) {
        reject(429)
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
      reject(executing ? 504 : 408)
    }, limits.requestTimeoutMs)
    timer.unref()
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      if (finished) return
      size += chunk.length
      if (size > limits.maxRequestBytes) {
        reject(413)
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
          reject(400)
          return
        }
        message = value as JsonRpcMessage
      } catch {
        reject(400)
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
          reject(429)
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
          respond(500)
        } finally {
          executing = false
          release()
        }
      })()
    })
  }
}
