import type { CoordinationTools } from '../../mcp/tools/coordination'
import { createCancelAcknowledger, createSteerAcknowledger } from './coordination-driver'
import type { Scope } from './types'

/** Observe durable worker controls while the native harness owns the manager's turn loop. */
export function observeWorkerControls(options: {
  dir: string
  coord: CoordinationTools
  scope: Scope<unknown>
  signal: AbortSignal
  controlScope: 'run' | 'subtree'
  deliverRoot?: (message: { steer: string; interrupt: boolean }) => boolean
  onError: (error: unknown) => void
}): { close(): Promise<void> } {
  const { dir, coord, scope, signal, controlScope, onError } = options
  const deps = { dir, coord, scope, signal, now: Date.now, ownerId: scope.view.root, controlScope }
  const steers = createSteerAcknowledger({
    ...deps,
    ...(controlScope === 'run'
      ? { root: { deliver: options.deliverRoot, timing: 'during the harness invocation' as const } }
      : {}),
  })
  const cancellations = createCancelAcknowledger(deps)
  let active = true
  let timer: ReturnType<typeof setInterval> | undefined
  let steering = false
  let inFlight = Promise.resolve()
  let failure: { error: unknown } | undefined
  let closing: Promise<void> | undefined

  const stop = (): void => {
    active = false
    clearInterval(timer)
    signal.removeEventListener('abort', stop)
  }
  const fail = (error: unknown): void => {
    failure = { error }
    stop()
    onError(error)
  }
  const poll = (): void => {
    if (!active) return
    try {
      // Cancellation stays available while an earlier steer awaits durable event capture.
      cancellations.pass('turn')
      if (steering) return
      steering = true
      inFlight = steers
        .pass('turn')
        .catch(fail)
        .finally(() => {
          steering = false
        })
    } catch (error) {
      fail(error)
    }
  }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  else {
    timer = setInterval(poll, 100)
    timer.unref()
    poll()
  }

  const finish = async (): Promise<void> => {
    stop()
    await inFlight
    try {
      await steers.pass('final')
      cancellations.pass('final')
    } finally {
      cancellations.finish()
    }
    if (failure) throw failure.error
  }
  return {
    close: () => (closing ??= finish()),
  }
}
