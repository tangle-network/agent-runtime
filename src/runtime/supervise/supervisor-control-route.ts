import { type SupervisorControlRoute, startSupervisorControlRoute } from './control'
import type { Scope } from './types'

export interface SupervisorScopeControlRouteOptions {
  readonly runDir: string
  readonly runId: string
  readonly capabilityToken: string
  readonly scope: Scope<unknown>
  readonly abort: (reason?: string) => boolean
  readonly now: () => number
}

export function startSupervisorControlRouteForScope(
  options: SupervisorScopeControlRouteOptions,
): SupervisorControlRoute {
  return startSupervisorControlRoute({
    runDir: options.runDir,
    runId: options.runId,
    capabilityToken: options.capabilityToken,
    snapshot: () => options.scope.view,
    effectReceiver: (request) => {
      if (request.kind === 'steer') {
        if (request.target.kind !== 'worker') {
          return {
            status: 'rejected',
            effect: 'not_live',
            message: 'steer target must be a worker',
          }
        }
        const accepted = options.scope.send(request.target.workerId, request.message)
        return accepted
          ? { status: 'accepted', effect: 'delivered' }
          : {
              status: 'rejected',
              effect: 'not_live',
              message: 'worker is not live or does not accept steering',
            }
      }
      if (request.target.kind === 'worker') {
        const accepted = options.scope.cancel(request.target.workerId, request.reason)
        return accepted
          ? { status: 'accepted', effect: 'cancel_requested' }
          : {
              status: 'rejected',
              effect: 'not_live',
              message: 'control target is not live',
            }
      }
      const accepted = options.abort(request.reason)
      return accepted
        ? { status: 'accepted', effect: 'cancel_requested' }
        : { status: 'rejected', effect: 'not_live', message: 'control target is not live' }
    },
    now: options.now,
  })
}
