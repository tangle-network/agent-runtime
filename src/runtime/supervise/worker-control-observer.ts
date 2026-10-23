import type { CoordinationTools } from '../../mcp/tools/coordination-contracts'
import {
  createCancelAcknowledger,
  createSteerAcknowledger,
  type RootSteer,
} from './driver-control-acknowledgers'
import type { Scope } from './types'

/** Observe durable worker controls while the native harness owns the manager's turn loop. */
export function observeWorkerControls(options: {
  dir?: string
  steerDir?: string
  coord: CoordinationTools
  scope: Scope<unknown>
  signal: AbortSignal
  controlScope: 'run' | 'subtree'
  /** Root's existing inbox only; omitted for every nested manager. */
  deliverRoot?: (message: RootSteer) => boolean
  /** Root delivery readiness; checked before a durable steer is claimed. */
  deliverRootReady?: () => boolean
  onError: (error: unknown) => void
}): { pass(): Promise<void>; close(): Promise<void> } {
  const { dir, coord, scope, signal, controlScope, onError } = options
  const steerDir = options.steerDir ?? dir
  const deps = { coord, scope, signal, now: Date.now, ownerId: scope.view.root, controlScope }
  const steers =
    steerDir === undefined
      ? undefined
      : createSteerAcknowledger({
          ...deps,
          dir: steerDir,
          deliverRoot: options.deliverRoot,
          deliverRootReady: options.deliverRootReady,
        })
  const cancellations = dir === undefined ? undefined : createCancelAcknowledger({ ...deps, dir })
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
      cancellations?.pass('turn')
      if (steers === undefined || steering) return
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
      await steers?.pass('final')
      cancellations?.pass('final')
    } finally {
      cancellations?.finish()
    }
    if (failure) throw failure.error
  }
  return {
    // A native turn boundary, before the loop chooses the next wake or pause. Reconciles what
    // live polls applied and admits a steer addressed to the root's own inbox — the one
    // destination still live between turns. A control first seen here is never APPLIED: the
    // live timer owns that while the run continues, and close expires it once the run ends, so
    // an already-finished worker is never retroactively terminated at a boundary.
    async pass() {
      if (!active) return
      try {
        cancellations?.pass('boundary')
        // Root-only admission is synchronous up to its durable claim and inbox delivery. It
        // may run while a worker steer waits for capture; that worker keeps its own inFlight
        // promise so close still joins it after the manager aborts the coordination lifetime.
        await steers?.pass('boundary')
      } catch (error) {
        fail(error)
      }
      if (failure) throw failure.error
    },
    close: () => (closing ??= finish()),
  }
}
