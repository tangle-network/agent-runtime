/**
 * One abort race, and one abort cascade, for the supervision tree.
 *
 * Every layer that can be cancelled needs the same three things: the reason a signal
 * carries, an `AbortError` built from it, and a settle-once race between the work and
 * the signal. Written per layer, each drifts — a listener stops being removed on one
 * path, a late resolution overwrites a cancellation that already won, or a cascade
 * forwards no reason and renames every downstream death to the layer's own fallback.
 *
 * The fallback message is the only thing a layer supplies, so the error still names
 * which layer cancelled.
 */

/**
 * The reason a signal carries, or `fallback` when it states none.
 *
 * A cascade that drops the upstream reason turns every downstream death into its own generic
 * message: the worker's `down` record then says nothing about WHY, which makes a whole class of
 * child mortality undiagnosable from the journal alone.
 */
export function abortReason(signal: AbortSignal, fallback: string): unknown {
  const reason = signal.reason
  if (typeof reason === 'string' && reason.length > 0) return reason
  // `abort()` with no argument sets a DOMException whose message is the platform placeholder
  // ("This operation was aborted"), which carries no more information than the generic death it
  // would replace — treat it as reasonless and use the fallback.
  if (reason instanceof Error && reason.name !== 'AbortError' && reason.message.length > 0) {
    return reason.message
  }
  return fallback
}

/** An `AbortError` carrying the signal's own string reason, or `fallback` when it states none. */
export function abortError(signal: AbortSignal, fallback: string): Error {
  const reason = abortReason(signal, fallback)
  const error = new Error(typeof reason === 'string' && reason.length > 0 ? reason : fallback)
  error.name = 'AbortError'
  return error
}

/** A downstream abort linked to one or more upstream signals. */
export interface LinkedAbort {
  /** Fires when any source fires, or when {@link LinkedAbort.abort} is called. */
  readonly signal: AbortSignal
  /** Abort this link on its own (teardown, cancellation), carrying `reason`. */
  abort(reason?: unknown): void
  /** Stop listening to the sources. Idempotent; required where a source outlives the link. */
  release(): void
}

/**
 * Cascade N abort signals into one downstream abort that fires when ANY of them does, carrying
 * that signal's own reason ({@link abortReason}). Node-portable: `AbortSignal.any` needs >=20.3
 * and the package floor is >=20, and it would drop the reason anyway.
 *
 * The one cascade every executor uses, so a reason forwarded here reaches every layer below.
 */
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

/**
 * Settle `act()` against `signal`. The first outcome wins and the listener is always
 * removed, so neither a late resolution nor a late abort can settle the promise twice.
 * The losing promise stays observed, so a late rejection cannot surface as an unhandled
 * process error.
 *
 * The abort rejection is deferred one microtask so a result the action had ALREADY
 * produced still wins. It does not hand the race to a listener the action registers
 * from inside `act()`: this function subscribes before it calls `act()`, so its own
 * abort handler runs first and settles the promise. A caller that must let the action
 * observe the abort itself has to hold a live promise and await that instead.
 *
 * A synchronous throw from `act()` propagates as the rejection, not as an abort.
 */
export async function runAbortable<T>(
  act: () => Promise<T>,
  signal: AbortSignal,
  fallback: string,
): Promise<T> {
  if (signal.aborted) throw abortError(signal, fallback)
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      queueMicrotask(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(abortError(signal, fallback))
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
