import type { SharedBoxHandle, SharedBoxProcess } from './shared-box-worker'
import { sleep } from './util'

/**
 * Attempts for one Sandbox API call that failed on the way to the box.
 *
 * Every call re-verifies the API key with the platform, and a burst of workers makes that check
 * time out: 8 of 64 workers failed with `502 platform_unavailable` (reason `platform_timeout`) in
 * one burst, and 3 more lost their transcript enumeration the same way. The check
 * refuses the request before it reaches the box, so repeating it is safe; five attempts over about
 * fifteen seconds rode out every such failure measured.
 */
const TRANSIENT_ATTEMPTS = 5

export const TRANSIENT_BASE_DELAY_MS = 1_000

/** A failure that a repeated request can change: the platform, the gateway or the network. */
export function isTransientSandboxFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const record = error as { status?: unknown; code?: unknown; name?: unknown; message?: unknown }
  if (
    typeof record.status === 'number' &&
    [408, 425, 429, 500, 502, 503, 504].includes(record.status)
  ) {
    return true
  }
  const text = `${String(record.code ?? '')} ${String(record.name ?? '')} ${String(record.message ?? '')}`
  return /platform_unavailable|platform_timeout|platform_unreachable|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|UND_ERR|bad gateway|gateway timeout/iu.test(
    text,
  )
}

export async function transientRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { signal?: AbortSignal; delayMs?: number } = {},
): Promise<T> {
  const delayMs = options.delayMs ?? TRANSIENT_BASE_DELAY_MS
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (attempt >= TRANSIENT_ATTEMPTS || !isTransientSandboxFailure(error)) throw error
      options.signal?.throwIfAborted()
      await sleep(delayMs * 2 ** (attempt - 1), options.signal)
    }
  }
}

/**
 * The Sandbox calls one worker makes, each repeated on a transient failure.
 *
 * A launch is repeated only after the pool confirms the box did not start it: a failed request
 * may have reached the box before its answer was lost, so the repeat first looks for a process
 * in the worker's own directory that this worker did not start yet, and adopts it. A process log
 * that breaks mid-stream is read again from the start, because the box replays a process's
 * buffered output, and the part already delivered is skipped.
 */
export function resilientBox(box: SharedBoxHandle, delayMs: number) {
  const retry = <T>(operation: () => Promise<T>) => transientRetry(operation, { delayMs })
  return {
    id: box.id,
    exec: (command: string, options?: { timeoutMs?: number }) =>
      retry(() => box.exec(command, options)),
    fs: {
      read: (path: string) => retry(() => box.fs.read(path)),
      write: (path: string, content: string) => retry(() => box.fs.write(path, content)),
    },
    async spawnInDirectory(
      executable: string,
      args: readonly string[],
      options: { cwd: string; env?: Record<string, string>; timeoutMs?: number },
      known: ReadonlySet<number>,
    ): Promise<SharedBoxProcess> {
      return await transientRetry(
        async (attempt) => {
          if (attempt > 1) {
            const listed = await box.process.list()
            const launched = listed.find(
              (entry) =>
                entry.cwd === options.cwd && entry.command === executable && !known.has(entry.pid),
            )
            const adopted = launched === undefined ? null : await box.process.get(launched.pid)
            if (adopted !== null) return adopted
          }
          return await box.process.spawnExact(executable, args, options)
        },
        { delayMs },
      )
    },
    async wait(process: SharedBoxProcess): Promise<number> {
      return await retry(async () => {
        try {
          return await process.wait()
        } catch (error) {
          if (!isTransientSandboxFailure(error)) throw error
          const again = await box.process.get(process.pid)
          if (again === null) throw error
          return await again.wait()
        }
      })
    },
    async *output(process: SharedBoxProcess, stream: 'stdout' | 'stderr'): AsyncGenerator<string> {
      let delivered = 0
      let source: SharedBoxProcess = process
      for (let attempt = 1; ; attempt += 1) {
        let seen = 0
        try {
          for await (const chunk of source[stream]()) {
            const fresh =
              seen + chunk.length <= delivered ? '' : chunk.slice(Math.max(0, delivered - seen))
            seen += chunk.length
            if (fresh.length > 0) {
              delivered += fresh.length
              yield fresh
            }
          }
          return
        } catch (error) {
          if (attempt >= TRANSIENT_ATTEMPTS || !isTransientSandboxFailure(error)) throw error
          await sleep(delayMs * 2 ** (attempt - 1))
          source = (await retry(() => box.process.get(process.pid))) ?? source
        }
      }
    },
    delete: () => retry(() => box.delete()),
  }
}
