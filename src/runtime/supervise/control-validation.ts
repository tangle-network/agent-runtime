import type { SupervisorControlStatus } from './control-types'

export function isTerminalStatus(status: SupervisorControlStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function assertStableText(value: string, label: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be non-empty and have no outer whitespace`)
  }
}

export function isStableText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

export function assertPositiveDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }
}

export function abortError(reason: unknown): Error {
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : reason === undefined
        ? 'operation aborted'
        : String(reason),
  )
  error.name = 'AbortError'
  return error
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal.reason))
  return new Promise((resolveDelay, rejectDelay) => {
    const finish = () => {
      signal?.removeEventListener('abort', onAbort)
      resolveDelay()
    }
    const timer = setTimeout(finish, Math.max(1, ms))
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      rejectDelay(abortError(signal?.reason))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
