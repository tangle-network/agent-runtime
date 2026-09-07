import { mkdirSync, watch } from 'node:fs'
import {
  type RunCancellation,
  readRunCancellation,
  readRunCancelRequest,
  workerCancellationsDir,
  writeRunCancellation,
} from './run-layout'

/** Apply a durable request through the run's existing abort controller. */
export function applyRunCancellation(
  dir: string,
  abortRun: (reason: string) => void,
  now: () => string,
): RunCancellation | undefined {
  const request = readRunCancelRequest(dir)
  if (request === undefined) return undefined
  const prior = readRunCancellation(dir, request.operationId)
  if (prior !== undefined) return prior
  const record: RunCancellation = {
    operationId: request.operationId,
    effect: 'cancel_requested',
    requestedAt: request.at,
    observedAt: now(),
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    detail: 'root abort issued to the whole run; termination not yet proven',
  }
  writeRunCancellation(dir, record)
  abortRun(request.reason ?? 'run cancel requested')
  return record
}

/** External drivers may remain silent indefinitely, so turn boundaries cannot observe control. */
export function watchRunCancellation(dir: string, abortRun: (reason: string) => void) {
  mkdirSync(workerCancellationsDir(dir), { recursive: true })
  let active = true
  let failure: unknown
  const check = (): void => {
    if (failure !== undefined) throw failure
    if (active) applyRunCancellation(dir, abortRun, () => new Date().toISOString())
  }
  const fail = (error: unknown): void => {
    if (!active) return
    failure = error
    abortRun(`durable run cancellation observer failed: ${String(error)}`)
  }
  const watcher = watch(workerCancellationsDir(dir), (_event, filename) => {
    if (!active || (filename !== null && filename !== 'run.request.json')) return
    try {
      check()
    } catch (error) {
      fail(error)
    }
  })
  watcher.on('error', fail)
  return {
    check,
    close(): void {
      active = false
      watcher.close()
    },
  }
}
