import { mkdirSync, watch } from 'node:fs'
import {
  type RunCancellation,
  type RunCancelRequest,
  readRunCancellation,
  readRunCancelRequest,
  workerCancellationsDir,
  writeRunCancellation,
} from './run-layout'

/** Apply a durable request through the run's existing abort controller. */
export function applyRunCancellation(
  dir: string,
  abortRun: (reason: string, request?: RunCancelRequest) => void,
  now: () => string,
  path: 'observer' | 'turn-boundary' | 'fallback' = 'turn-boundary',
): RunCancellation | undefined {
  const request = readRunCancelRequest(dir)
  if (request === undefined) return undefined
  const prior = readRunCancellation(dir, request.operationId)
  if (prior !== undefined) return prior
  abortRun(request.reason ?? 'run cancel requested', request)
  const observedAt = now()
  const appliedAfterMs = Math.max(0, Date.parse(observedAt) - Date.parse(request.at))
  const record: RunCancellation = {
    operationId: request.operationId,
    effect: 'cancel_requested',
    path,
    appliedAfterMs,
    ...(request.deadlineMs === undefined
      ? {}
      : { deadlineExceeded: appliedAfterMs > request.deadlineMs }),
    requestedAt: request.at,
    observedAt,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(request.operator === undefined ? {} : { operator: request.operator }),
    detail: 'root abort issued to the whole run; termination not yet proven',
  }
  writeRunCancellation(dir, record)
  return record
}

/** External drivers may remain silent indefinitely, so turn boundaries cannot observe control. */
export function watchRunCancellation(
  dir: string,
  abortRun: (reason: string, request?: RunCancelRequest) => void,
  createWatch: typeof watch = watch,
) {
  mkdirSync(workerCancellationsDir(dir), { recursive: true })
  let active = true
  let failure: unknown
  const check = (path: 'observer' | 'fallback' = 'observer'): void => {
    if (failure !== undefined) throw failure
    if (active) applyRunCancellation(dir, abortRun, () => new Date().toISOString(), path)
  }
  const fail = (error: unknown): void => {
    if (!active) return
    failure = error
    abortRun(`durable run cancellation observer failed: ${String(error)}`)
  }
  // The watcher is an optimization over the poll loop below (instant pickup instead of ≤100 ms).
  // Creating it can fail for reasons that say NOTHING about this run: the host's inotify budget is
  // exhausted (EMFILE — a shared box with many agents held ~110 of the 128 default user instances
  // when this was measured), or the kernel caps watches (ENOSPC). Degrading to poll-only keeps
  // every durable behavior; failing the run would make a neighboring process's resource use kill
  // runs that never touched the limit. Any other creation error still fails loudly.
  let watcher: ReturnType<typeof watch> | undefined
  try {
    watcher = createWatch(workerCancellationsDir(dir), (_event, filename) => {
      if (!active || (filename !== null && filename !== 'run.request.json')) return
      try {
        check()
      } catch (error) {
        fail(error)
      }
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EMFILE' && code !== 'ENOSPC') throw error
  }
  watcher?.on('error', fail)
  // Filesystem notifications are advisory. Scan the same durable inbox when one is dropped —
  // and carry the whole observer alone whenever the watcher above could not be created.
  const fallback = setInterval(() => {
    try {
      check('fallback')
    } catch (error) {
      fail(error)
    }
  }, 100)
  fallback.unref()
  return {
    check,
    close(): void {
      active = false
      watcher?.close()
      clearInterval(fallback)
    },
  }
}
