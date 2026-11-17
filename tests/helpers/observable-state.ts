import { watch } from 'node:fs'

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
