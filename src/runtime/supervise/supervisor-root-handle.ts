import { RuntimeRunStateError, ValidationError } from '../../errors'
import { RunCancellationReason } from './abortable'
import type { RootHandle, RootSignal, Scope, SteerableRootHandle, TreeView } from './types'

/** The live binding the supervisor populates while a run is in flight. `view` reads the
 *  live scope; `cascadeAbort`/`signal` reach the one cascade controller. */
interface RunBinding {
  readonly scope: Scope<unknown>
  readonly cascadeAbort: (reason?: string) => void
  readonly signal: (msg: RootSignal) => void
  readonly deliver: (msg: unknown) => boolean
}

/** The supervisor-private control behind a `RootHandle`. `createRootHandle` mints it and
 *  registers it in `rootControls`; `attach` looks it up and `bind`s it to the live run. */
interface RootLease {
  bind(binding: RunBinding): void
  release(): void
}

export interface RootControl {
  acquire(): RootLease
}

/** Module-private channel from a minted `RootHandle` to its `RootControl`, so `attach`
 *  can prove a handle is ours and reach its binding without leaking the control onto the
 *  frozen `RootHandle` shape. */
export const rootControls = new WeakMap<RootHandle<unknown>, RootControl>()

/**
 * Mint a `RootHandle` plus its supervisor-private control. The handle is the substrate a
 * chat/pi-viz client attaches to (Q2): `view()` reads the live tree, `signal()` delivers
 * an out-of-band message, `abort()` cascades. Before `run` binds it (and after `run`
 * unbinds it) the handle is fail-loud: a client that talks to a handle that is not
 * driving a live run gets a typed error, never a silent no-op.
 */
export function createRootHandle<Out>(): SteerableRootHandle<Out> {
  let binding: RunBinding | undefined
  let activeLease: symbol | undefined
  const handle: SteerableRootHandle<Out> = {
    view(): TreeView {
      if (!binding) {
        throw new RuntimeRunStateError(
          'RootHandle.view: handle is not bound to a live run (attach it before run, read after run starts)',
        )
      }
      return binding.scope.view
    },
    deliver(msg: unknown): boolean {
      if (!binding) {
        throw new RuntimeRunStateError('RootHandle.deliver: handle is not bound to a live run')
      }
      return binding.deliver(msg)
    },
    signal(msg: RootSignal): void {
      if (!binding) {
        throw new RuntimeRunStateError('RootHandle.signal: handle is not bound to a live run')
      }
      binding.signal(msg)
    },
    abort(reason?: string): void {
      if (!binding) {
        throw new RuntimeRunStateError('RootHandle.abort: handle is not bound to a live run')
      }
      binding.cascadeAbort(reason ?? 'root handle aborted')
    },
  }
  rootControls.set(handle as RootHandle<unknown>, {
    acquire(): RootLease {
      if (activeLease !== undefined) {
        throw new RuntimeRunStateError(
          'RootHandle: handle already controls a live run; use one handle per concurrent run',
        )
      }
      const token = Symbol('root-handle-lease')
      activeLease = token
      let released = false
      return {
        bind(next: RunBinding): void {
          if (released || activeLease !== token) {
            throw new RuntimeRunStateError('RootHandle: live-run lease is no longer active')
          }
          if (binding !== undefined) {
            throw new RuntimeRunStateError('RootHandle: live-run lease is already bound')
          }
          binding = next
        },
        release(): void {
          if (released) return
          released = true
          if (activeLease !== token) return
          binding = undefined
          activeLease = undefined
        },
      }
    },
  })
  return handle
}

/** Reject unsupported signals from JavaScript or older declarations before changing the run. */
export function pushRootSignal(
  cascadeAbort: (reason?: unknown) => void,
): (msg: RootSignal) => void {
  return (msg: RootSignal): void => {
    if (msg.kind !== 'cancel') {
      throw new ValidationError('RootHandle.signal only supports cancellation')
    }
    cascadeAbort(new RunCancellationReason('root-signal', msg.reason ?? 'root signal: cancel'))
  }
}
