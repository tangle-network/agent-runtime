import type { CoordinationTools } from '../../mcp/tools/coordination'
import type { Scope } from './types'
import { createWorkerControlDriver, type WorkerControlDriver } from './worker-control-driver'
import type { WorkerControlPersistence } from './worker-control-layout'
import type { WorkerSteerRequest } from './worker-steer-store'

/** The exact manager surface that can operate one registered worker scope. */
export interface WorkerControlTarget {
  readonly scope: Scope<unknown>
  readonly coord: Pick<CoordinationTools, 'settled' | 'abortWorkerById'>
  readonly deliverSteer: (request: WorkerSteerRequest) => Promise<unknown>
}

/** One run-wide registry for exact worker ownership and delivery. */
export interface WorkerControlAuthority {
  register(target: WorkerControlTarget): void
  resolve(workerId: string): WorkerControlTarget | undefined
}

/** The durable control state shared by every nested driver in one run. */
export interface WorkerControlContext {
  readonly dir: string
  readonly persistence?: WorkerControlPersistence
  readonly authority: WorkerControlAuthority
  readonly driver: WorkerControlDriver
  readonly ownerScope: Scope<unknown>
}

export interface WorkerControlContextOptions {
  readonly dir: string
  readonly ownerScope: Scope<unknown>
  readonly now: () => number
  readonly persistence?: WorkerControlPersistence
}

const workerControlContexts = new WeakMap<Scope<unknown>, WorkerControlContext>()

export function createWorkerControlAuthority(): WorkerControlAuthority {
  const targets = new Map<Scope<unknown>, WorkerControlTarget>()
  return {
    register(target): void {
      targets.set(target.scope, target)
    },
    resolve(workerId): WorkerControlTarget | undefined {
      let resolved: WorkerControlTarget | undefined
      for (const target of targets.values()) {
        const live = target.scope.view.nodes.some((node) => node.id === workerId)
        const settled = target.coord.settled().some((worker) => worker.id === workerId)
        if (!live && !settled) continue
        if (resolved !== undefined && resolved !== target) {
          throw new Error(`worker control id '${workerId}' is registered by multiple managers`)
        }
        resolved = target
      }
      return resolved
    },
  }
}

export function createWorkerControlContext(
  options: WorkerControlContextOptions,
): WorkerControlContext {
  const authority = createWorkerControlAuthority()
  const driver = createWorkerControlDriver({
    dir: options.dir,
    authority,
    now: options.now,
    ...(options.persistence === undefined ? {} : { persistence: options.persistence }),
  })
  const context = Object.freeze({
    dir: options.dir,
    ownerScope: options.ownerScope,
    authority,
    driver,
    ...(options.persistence === undefined ? {} : { persistence: options.persistence }),
  })
  bindWorkerControlContext(options.ownerScope, context)
  return context
}

export function bindWorkerControlContext(
  scope: Scope<unknown>,
  context: WorkerControlContext,
): void {
  const existing = workerControlContexts.get(scope)
  if (existing !== undefined && existing !== context) {
    throw new Error('scope already belongs to another worker control context')
  }
  workerControlContexts.set(scope, context)
}

export function workerControlContextForScope(
  scope: Scope<unknown>,
): WorkerControlContext | undefined {
  return workerControlContexts.get(scope)
}
