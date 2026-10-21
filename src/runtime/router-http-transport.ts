/** Router HTTP attempts, response evidence, retries, and request cancellation. */

import {
  generateIdempotencyKey,
  type RetryConfig,
  SDKError,
  withRetry,
} from '@tangle-network/agent-core'
import { ValidationError } from '../errors'
import type { RouterConfig, RouterRouting } from './router-request-body'
import type { resolveRouterRetryPolicy } from './router-retry-policy'
import { armDeadlineTimer } from './supervise/deadline'

/**
 * Connection details for Runtime's Router-backed executors.
 *
 * This is deliberately transport-only: model, prompt, tools, generation settings, and retry
 * policy belong to the exact executable `AgentProfile` consumed by `streamAgentTurn`.
 */
export interface RouterTransportConfig {
  routerBaseUrl: string
  routerKey: string
  /** Provider routing for every request this transport sends. */
  routing?: RouterRouting
  /** Injectable OpenAI-compatible transport. Optional usage.resources carries measured turn totals. */
  complete?: (
    body: Record<string, unknown>,
    request?: {
      readonly headers: Readonly<Record<string, string>>
      readonly signal?: AbortSignal
    },
  ) => Promise<unknown>
}

/** Exact buffered HTTP evidence. Authentication and cookie headers are excluded. */
export interface RouterResponseReceipt {
  readonly endpoint: string
  readonly callId: string
  readonly attempt: number
  readonly startedAt: string
  readonly endedAt: string
  readonly status: number | null
  readonly error?: { readonly name: string; readonly message: string }
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | null
}

export function routerRequestHeaders(
  cfg: Pick<RouterConfig, 'routerKey'>,
  opts:
    | {
        callId?: string
        correlationId?: string
        propagatedHeaders?: Readonly<Record<string, string>>
      }
    | undefined,
): Record<string, string> {
  // Every POST is retryable. Mint the logical-call identity once while the request headers are
  // assembled, outside `withRetry`, so an accepted response whose connection dies cannot make a
  // retry look like a new billable completion. A trusted caller identity remains authoritative.
  const suppliedCallId: unknown = opts?.callId
  if (
    suppliedCallId !== undefined &&
    (typeof suppliedCallId !== 'string' || suppliedCallId.trim().length === 0)
  ) {
    throw new ValidationError('router request: callId must be a non-empty, non-whitespace string')
  }
  const callId = typeof suppliedCallId === 'string' ? suppliedCallId : generateIdempotencyKey()
  return {
    ...(opts?.propagatedHeaders ?? {}),
    'content-type': 'application/json',
    authorization: `Bearer ${cfg.routerKey}`,
    'idempotency-key': callId,
    ...(opts?.correlationId ? { 'x-correlation-id': opts.correlationId } : {}),
  }
}

export async function fetchRouterResponse(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  callerSignal: AbortSignal | undefined,
  retry: ReturnType<typeof resolveRouterRetryPolicy>,
  onResponse?: (receipt: RouterResponseReceipt) => void | Promise<void>,
): Promise<{ response: Response; attempts: number }> {
  let attempt = 0
  const result = await retryRouterOperation(retry, callerSignal, async (signal) => {
    attempt += 1
    const startedAt = new Date().toISOString()
    let candidate: Response
    try {
      candidate = await fetch(url, { ...init, signal })
    } catch (error) {
      await observeRouterResponse(
        onResponse,
        {
          endpoint: url,
          callId: new Headers(init.headers).get('idempotency-key') ?? '',
          attempt,
          startedAt,
          endedAt: new Date().toISOString(),
          status: null,
          headers: {},
          body: null,
          error: {
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
          },
        },
        signal,
      )
      throw error
    }
    if (onResponse) {
      const headers = Object.fromEntries(
        [...candidate.headers].filter(
          ([name]) =>
            !['authorization', 'proxy-authorization', 'set-cookie', 'cookie'].includes(
              name.toLowerCase(),
            ),
        ),
      )
      let body: string | null = null
      let bodyError: unknown
      try {
        body = await candidate.clone().text()
      } catch (error) {
        bodyError = error
      }
      await observeRouterResponse(
        onResponse,
        {
          endpoint: url,
          callId: new Headers(init.headers).get('idempotency-key') ?? '',
          attempt,
          startedAt,
          endedAt: new Date().toISOString(),
          status: candidate.status,
          headers,
          body,
          ...(bodyError === undefined
            ? {}
            : {
                error: {
                  name: bodyError instanceof Error ? bodyError.name : 'Error',
                  message: bodyError instanceof Error ? bodyError.message : String(bodyError),
                },
              }),
        },
        signal,
      )
      if (bodyError !== undefined) throw bodyError
    }
    if (candidate.ok) return candidate
    const text = await candidate.text().catch(() => '<failed to read response body>')
    throw new SDKError(`router ${candidate.status}: ${text.slice(0, 200)}`, {
      code: 'UNKNOWN',
      status: candidate.status,
      retryable: retry.retryStatuses.includes(candidate.status),
      context: { body: text.slice(0, 200) },
    })
  })
  return { response: result.value, attempts: result.attempts }
}

/** Evidence failure cannot authorize a second inference, even after the request deadline. */
async function observeRouterResponse(
  observer: ((receipt: RouterResponseReceipt) => void | Promise<void>) | undefined,
  receipt: RouterResponseReceipt,
  signal: AbortSignal,
): Promise<void> {
  if (!observer) return
  let onAbort: (() => void) | undefined
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('Response observation aborted'))
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
    await Promise.race([Promise.resolve().then(() => observer(receipt)), aborted])
  } catch (error) {
    throw new SDKError('Router response observation failed', {
      code: 'UNKNOWN',
      retryable: false,
      cause: error instanceof Error ? error : new Error(String(error)),
      context: { phase: 'response_observation' },
    })
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export async function retryRouterOperation<T>(
  retry: ReturnType<typeof resolveRouterRetryPolicy>,
  callerSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<{ value: T; attempts: number }> {
  let attempts = 0
  try {
    const value = await withRetry(
      async (attempt) => {
        attempts = attempt + 1
        const attemptSignal = withRouterRequestTimeout(callerSignal, retry.requestTimeoutMs)
        try {
          return await operation(attemptSignal.signal)
        } catch (error) {
          if (error instanceof SDKError && error.context?.phase === 'response_observation')
            throw error
          if (callerSignal?.aborted) throw callerSignal.reason ?? error
          if (attemptSignal.signal.aborted) {
            throw new SDKError(`router request timeout after ${retry.requestTimeoutMs}ms`, {
              code: 'TIMEOUT',
              cause: error instanceof Error ? error : new Error(String(error)),
            })
          }
          if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new SDKError(`router network failure: ${error.message}`, {
              code: 'NETWORK',
              cause: error,
            })
          }
          throw error
        } finally {
          attemptSignal.dispose()
        }
      },
      agentCoreRetryConfig(retry, callerSignal),
    )
    return { value, attempts }
  } catch (error) {
    throwRouterFailureWithAttempts(error, attempts)
  }
}

const routerFailureAttempts = new WeakMap<object, number>()

/** Internal evidence carried alongside a failed Router call without replacing the original error.
 * Runtime uses it when an intentional interrupt resumes the worker instead of surfacing the error. */
export function routerTransportAttemptsFromError(error: unknown): number | undefined {
  const identity = routerErrorIdentity(error)
  return identity === undefined ? undefined : routerFailureAttempts.get(identity)
}

export function throwRouterFailureWithAttempts(error: unknown, attempts: number): never {
  const identity = routerErrorIdentity(error)
  if (identity !== undefined) routerFailureAttempts.set(identity, attempts)
  throw error
}

function routerErrorIdentity(error: unknown): object | undefined {
  return (typeof error === 'object' && error !== null) || typeof error === 'function'
    ? (error as object)
    : undefined
}

export async function routerResponseJson(response: Response, attempts: number): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throwRouterFailureWithAttempts(error, attempts)
  }
}

function agentCoreRetryConfig(
  retry: ReturnType<typeof resolveRouterRetryPolicy>,
  callerSignal: AbortSignal | undefined,
): RetryConfig {
  return {
    maxAttempts: retry.maxAttempts,
    initialDelayMs: retry.initialBackoffMs,
    maxDelayMs: retry.maxBackoffMs,
    multiplier: 2,
    jitter: retry.jitter,
    ...(callerSignal ? { signal: callerSignal } : {}),
    shouldRetry: (error) => {
      if (callerSignal?.aborted) return false
      if (error.status !== undefined) return retry.retryStatuses.includes(error.status)
      return error.code === 'NETWORK' || error.code === 'TIMEOUT'
    },
  }
}

function withRouterRequestTimeout(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  if (timeoutMs === 0) {
    return { signal: callerSignal ?? new AbortController().signal, dispose: () => undefined }
  }
  const controller = new AbortController()
  const clearTimeout = armDeadlineTimer(
    timeoutMs,
    () => controller.abort(new Error(`router request timeout after ${timeoutMs}ms`)),
    true,
  )
  const onCallerAbort = () => controller.abort(callerSignal?.reason ?? new Error('aborted'))
  if (callerSignal?.aborted) onCallerAbort()
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout()
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}
