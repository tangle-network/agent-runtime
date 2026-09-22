import { RuntimeRunStateError } from '../../errors'
import type {
  RootControlSnapshot,
  RootControlStatus,
  RootHandle,
  RootSignal,
  Scope,
  SteerableRootHandle,
  TreeView,
} from './types'

export interface RunBinding {
  readonly scope: Scope<unknown>
  readonly status: RootControlStatus
  readonly cascadeAbort: (reason?: string) => void
  readonly signal: (msg: RootSignal) => void
  readonly deliver: (msg: unknown) => boolean
}

export interface RootLease {
  bind(binding: RunBinding): void
  retainTerminal(snapshot: RootControlSnapshot): void
  release(): void
}

export interface RootControl {
  acquire(): RootLease
}

const rootControls = new WeakMap<RootHandle<unknown>, RootControl>()

export function rootControlFor(handle: RootHandle<unknown>): RootControl | undefined {
  return rootControls.get(handle)
}

/**
 * Mint a root handle plus its private control channel.
 * Unbound handles fail loudly instead of silently dropping actions.
 */
export function createRootHandle<Out>(): SteerableRootHandle<Out> {
  let binding: RunBinding | undefined
  let terminalSnapshot: RootControlSnapshot | undefined
  let activeLease: symbol | undefined
  const handle: SteerableRootHandle<Out> = {
    view(): TreeView {
      if (binding) return binding.scope.view
      throw new RuntimeRunStateError(
        'RootHandle.view: handle is not bound to a live run (attach it before run, read after run starts)',
      )
    },
    controlSnapshot(): RootControlSnapshot {
      if (binding) return { status: binding.status, tree: structuredClone(binding.scope.view) }
      if (terminalSnapshot) return structuredClone(terminalSnapshot)
      throw new RuntimeRunStateError(
        'RootHandle.controlSnapshot: handle has no live or retained run snapshot',
      )
    },
    deliver(msg: unknown): boolean {
      if (!binding) {
        throw new RuntimeRunStateError('RootHandle.deliver: handle is not bound to a live run')
      }
      return binding.deliver(msg)
    },
    steer(nodeId: string, msg: unknown): boolean {
      if (!binding) {
        throw new RuntimeRunStateError('RootHandle.steer: handle is not bound to a live run')
      }
      return binding.scope.send(nodeId, msg)
    },
    cancelWorker(nodeId: string, reason?: string): boolean {
      if (!binding) {
        throw new RuntimeRunStateError('RootHandle.cancelWorker: handle is not bound to a live run')
      }
      return binding.scope.cancel(nodeId, reason)
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
      terminalSnapshot = undefined
      const token = Symbol('root-handle-lease')
      activeLease = token
      let released = false
      return {
        bind(next): void {
          if (released || activeLease !== token) {
            throw new RuntimeRunStateError('RootHandle: live-run lease is no longer active')
          }
          if (binding !== undefined) {
            throw new RuntimeRunStateError('RootHandle: live-run lease is already bound')
          }
          binding = next
        },
        retainTerminal(snapshot): void {
          if (released || activeLease !== token) {
            throw new RuntimeRunStateError('RootHandle: live-run lease is no longer active')
          }
          terminalSnapshot = structuredClone(snapshot)
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

export function pushRootSignal(cascadeAbort: (reason?: string) => void): (msg: RootSignal) => void {
  return (msg): void => {
    if (msg.kind === 'cancel') {
      cascadeAbort(msg.reason ?? 'root signal: cancel')
      return
    }
    throw new RuntimeRunStateError(`RootHandle.signal: ${msg.kind} is not implemented`)
  }
}
