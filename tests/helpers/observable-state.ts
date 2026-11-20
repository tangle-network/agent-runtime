import { watch } from 'node:fs'

/**
 * The outer bound on a wait for an event or a state: it catches a hang and never paces a test.
 * Fixed budgets that stood in for events failed on loaded gate hosts while the events were still
 * on their way: 2 s before a Node subprocess was ready (10-27, load 40-80), 5 s guards before a
 * cold first test reached its first stage, and `expect.poll`'s 1 s default before a native
 * execution was observed (11-20, load 22-85). It is also the suite's `expect.poll` timeout
 * (vitest.config.ts), and it stays under the suite's test timeout so a hang is named here first.
 */
export const HANG_BOUND_MS = 30_000

/** The timeout for a test that waits under `HANG_BOUND_MS`: its setup and cleanup sit outside
 * the bound, so the bound's own diagnostic reports a hang before Vitest's generic timeout. */
export const HANG_TEST_TIMEOUT_MS = 3 * HANG_BOUND_MS

/** `promise`'s outcome, or a rejection naming `what` once `milliseconds` pass without one. */
export async function within<T>(
  promise: Promise<T>,
  milliseconds = HANG_BOUND_MS,
  what = 'process proof',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} exceeded ${milliseconds}ms`)),
          milliseconds,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Subscribe before reading, and recheck after every write that overlaps an async read.
 * The caller owns cancellation; elapsed host time is never evidence of readiness. */
export async function waitForState(
  directory: string,
  predicate: () => Promise<boolean>,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    let checking = false
    let changed = true
    let finished = false
    const finish = (error?: unknown) => {
      if (finished) return
      finished = true
      watcher.close()
      signal?.removeEventListener('abort', aborted)
      if (error !== undefined) reject(error)
      else resolve()
    }
    const aborted = () => finish(signal!.reason)
    const check = async () => {
      changed = true
      if (checking || finished) return
      checking = true
      try {
        while (changed && !finished) {
          changed = false
          if (await predicate()) finish()
        }
      } catch (error) {
        finish(error)
      } finally {
        checking = false
      }
    }
    const watcher = watch(directory, { recursive: true }, () => void check())
    watcher.once('error', finish)
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
    else void check()
  })
}
