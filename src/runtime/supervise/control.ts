/**
 * Compatibility facade for supervisor observation and control.
 *
 * Public contracts stay at this import path while implementation modules own
 * command encoding, durable storage, route ownership, and client behavior.
 */

export {
  createFileSupervisorControlClient,
  createInProcessSupervisorControlClient,
} from './control-client'
export { supervisorSteerCommandDigest } from './control-command'
export { supervisorControlFiles } from './control-io'
export { startSupervisorControlRoute } from './control-route'
export type {
  SupervisorCancelInput,
  SupervisorControlAcknowledgement,
  SupervisorControlClient,
  SupervisorControlClientOptions,
  SupervisorControlEffect,
  SupervisorControlEffectReceiver,
  SupervisorControlEffectRequest,
  SupervisorControlEffectResult,
  SupervisorControlFiles,
  SupervisorControlRoute,
  SupervisorControlRouteOptions,
  SupervisorControlSnapshot,
  SupervisorControlStatus,
  SupervisorControlTarget,
  SupervisorSteerInput,
  SupervisorWatchOptions,
} from './control-types'
