import type {
  SupervisorControlEffectReceiver,
  SupervisorControlRouteOptions,
} from './control-types'

export function legacyEffectReceiver(
  options: SupervisorControlRouteOptions,
): SupervisorControlEffectReceiver {
  if (!options.steer || !options.cancelWorker || !options.cancelSupervisor) {
    throw new Error('supervisor control route requires an effect receiver')
  }
  const steer = options.steer
  const cancelWorker = options.cancelWorker
  const cancelSupervisor = options.cancelSupervisor
  return (request) => {
    if (request.kind === 'steer') {
      if (request.target.kind !== 'worker') {
        return { status: 'rejected', effect: 'not_live', message: 'steer target must be a worker' }
      }
      const accepted = steer(request.target.workerId, request.message)
      return accepted
        ? { status: 'accepted', effect: 'delivered' }
        : {
            status: 'rejected',
            effect: 'not_live',
            message: 'worker is not live or does not accept steering',
          }
    }
    if (request.target.kind === 'worker') {
      const accepted = cancelWorker(request.target.workerId, request.reason)
      return accepted
        ? { status: 'accepted', effect: 'cancel_requested' }
        : { status: 'rejected', effect: 'not_live', message: 'control target is not live' }
    }
    const accepted = cancelSupervisor(request.reason)
    return accepted
      ? { status: 'accepted', effect: 'cancel_requested' }
      : { status: 'rejected', effect: 'not_live', message: 'control target is not live' }
  }
}
