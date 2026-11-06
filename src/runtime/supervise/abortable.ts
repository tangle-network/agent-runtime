/** Provenance of an explicit cancellation, preserved through every abort link. */
export class RunCancellationReason extends Error {
  constructor(
    readonly source: string,
    reason: string,
    readonly operationId?: string,
    /** Who stopped the run, from the durable cancel request; absent for an in-process abort. */
    readonly operator?: string,
  ) {
    super(reason)
    this.name = 'RunCancellationReason'
  }

  override toString(): string {
    return this.message
  }
}

/** The signal's explicit reason, or the caller's fallback when none was supplied. */
export function abortReason(signal: AbortSignal, fallback: string): unknown {
  const reason = signal.reason
  if (reason instanceof RunCancellationReason) return reason
  if (typeof reason === 'string' && reason.length > 0) return reason
  // A default AbortError carries no caller reason.
  if (reason instanceof Error && reason.name !== 'AbortError' && reason.message.length > 0) {
    return reason.message
  }
  return fallback
}

/** An `AbortError` carrying the signal's own string reason, or `fallback` when it states none. */
export function signalAbortError(signal: AbortSignal, fallback: string): Error {
  const reason = abortReason(signal, fallback)
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string' && reason.length > 0
        ? reason
        : fallback,
  )
  error.name = 'AbortError'
  return error
}

/** A parent abort stops the call at once. The timeout still bounds a parent that stays open. */
export function deadlineSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return parent === undefined ? timeout : AbortSignal.any([parent, timeout])
}

interface LinkedAbort {
  readonly signal: AbortSignal
  abort(reason?: unknown): void
  /** Stop listening to the sources. Idempotent; required where a source outlives the link. */
  release(): void
}

/** Cascade source aborts and preserve their reason; release removes the source listeners. */
export function linkAbort(...sources: ReadonlyArray<AbortSignal>): LinkedAbort {
  const controller = new AbortController()
  const listeners: Array<{ source: AbortSignal; onAbort: () => void }> = []
  const release = (): void => {
    for (const { source, onAbort } of listeners) source.removeEventListener('abort', onAbort)
    listeners.length = 0
  }
  const abort = (reason?: unknown): void => {
    release()
    controller.abort(reason)
  }
  const alreadyAborted = sources.find((source) => source.aborted)
  if (alreadyAborted !== undefined) {
    controller.abort(abortReason(alreadyAborted, 'aborted by parent scope'))
    return { signal: controller.signal, abort, release }
  }
  for (const source of sources) {
    const onAbort = (): void => abort(abortReason(source, 'aborted by parent scope'))
    listeners.push({ source, onAbort })
    source.addEventListener('abort', onAbort, { once: true })
  }
  return { signal: controller.signal, abort, release }
}

/** Settle work against cancellation once, observing the losing promise.
 * Defer abort one microtask so already-completed work wins. An action's own abort listener
 * cannot win this race: this function subscribes before invoking it.
 */
export async function runAbortable<T>(
  act: () => Promise<T>,
  signal: AbortSignal,
  /** The abort's message when the signal states none, or the abort error itself. */
  fallback: string | (() => unknown),
): Promise<T> {
  const aborted = () =>
    typeof fallback === 'string' ? signalAbortError(signal, fallback) : fallback()
  if (signal.aborted) throw aborted()
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      queueMicrotask(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(aborted())
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    let work: Promise<T>
    try {
      work = Promise.resolve(act())
    } catch (error) {
      cleanup()
      reject(error)
      return
    }
    work.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}
