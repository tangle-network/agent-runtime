/**
 * One abort race for the supervision tree.
 *
 * Every layer that can be cancelled needs the same two things: an `AbortError` that
 * carries the signal's own reason, and a settle-once race between the work and the
 * signal. Written per layer, the race drifts — the listener stops being removed on
 * one path, or a late resolution overwrites a cancellation that already won.
 *
 * The fallback message is the only thing a layer supplies, so the error still names
 * which layer cancelled.
 */

/** An `AbortError` carrying the signal's own string reason, or `fallback` when it states none. */
export function abortError(signal: AbortSignal, fallback: string): Error {
  const reason = signal.reason
  const error = new Error(typeof reason === 'string' && reason.length > 0 ? reason : fallback)
  error.name = 'AbortError'
  return error
}

/**
 * Settle `act()` against `signal`. The first outcome wins and the listener is always
 * removed, so neither a late resolution nor a late abort can settle the promise twice.
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
