export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw abortReason(signal)
}

/** Resolve an operation unless the turn's cancellation channel fires first. */
export function awaitAbortable<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  const pending = Promise.resolve(operation)
  if (signal.aborted) {
    void pending.catch(() => {})
    return Promise.reject(abortReason(signal))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(abortReason(signal))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

/** Let a pull-based consumer interrupt an iterator whose next() ignores abort. */
export function abortableAsyncIterable<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]()
      let closed = false
      const close = () => {
        if (closed) return Promise.resolve({ done: true, value: undefined as T })
        closed = true
        let closing: PromiseLike<IteratorResult<T>> | IteratorResult<T> | undefined
        try {
          closing = iterator.return?.()
        } catch (error) {
          if (!signal.aborted) return Promise.reject(error)
        }
        if (signal.aborted) {
          if (closing !== undefined) void Promise.resolve(closing).catch(() => {})
          return Promise.resolve({ done: true, value: undefined as T })
        }
        return Promise.resolve(closing ?? { done: true, value: undefined as T })
      }
      return {
        next: () => {
          let pending: PromiseLike<IteratorResult<T>> | IteratorResult<T>
          try {
            pending = iterator.next()
          } catch (error) {
            return Promise.reject(error)
          }
          return awaitAbortable(pending, signal).catch((error: unknown) => {
            if (signal.aborted) void close()
            throw error
          })
        },
        return: close,
      }
    },
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(signal.reason === undefined ? 'aborted' : String(signal.reason))
}

export function deriveTurnSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('agent turn timeoutMs must be a finite non-negative number')
  }
  const controller = new AbortController()
  const timer =
    timeoutMs > 0
      ? setTimeout(
          () => controller.abort(new Error(`agent turn timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      : undefined
  if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
    ;(timer as { unref: () => void }).unref()
  }
  const onCallerAbort = () =>
    controller.abort(callerSignal?.reason ?? new Error('agent turn aborted'))
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort()
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}
