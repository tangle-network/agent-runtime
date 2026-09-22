import { randomUUID } from 'node:crypto'
import {
  createFileSupervisorControlClient,
  type SupervisorControlAcknowledgement,
  supervisorSteerCommandDigest,
} from '../runtime/supervise/control'

export interface PendingSupervisorSteer {
  readonly operationId: string
  readonly commandDigest: string
  readonly runId: string
  readonly workerId: string
  readonly message: string
}

export function startSupervisorSteer(options: {
  readonly stateDir: string
  readonly runId: string
  readonly workerId: string
  readonly message: string
  readonly capabilityToken?: string
  readonly pending?: PendingSupervisorSteer
}): {
  readonly pending: PendingSupervisorSteer
  readonly acknowledgement: Promise<SupervisorControlAcknowledgement>
} {
  const client = createFileSupervisorControlClient(options.stateDir, {
    runId: options.runId,
    ...(options.capabilityToken === undefined ? {} : { capabilityToken: options.capabilityToken }),
  })
  const pending =
    options.pending?.runId === options.runId &&
    options.pending.workerId === options.workerId &&
    options.pending.message === options.message
      ? options.pending
      : undefined
  const operationId = pending?.operationId ?? randomUUID()
  const commandDigest = supervisorSteerCommandDigest(options.runId, {
    operationId,
    workerId: options.workerId,
    message: options.message,
    source: 'agent-runtime-top',
  })
  const request: PendingSupervisorSteer = {
    operationId,
    commandDigest,
    runId: options.runId,
    workerId: options.workerId,
    message: options.message,
  }
  return {
    pending: request,
    acknowledgement: client.steer({
      operationId,
      workerId: options.workerId,
      message: options.message,
      source: 'agent-runtime-top',
    }),
  }
}

export function startSupervisorCancel(options: {
  readonly stateDir: string
  readonly runId: string
  readonly operationId?: string
  readonly capabilityToken?: string
}): Promise<SupervisorControlAcknowledgement> {
  const client = createFileSupervisorControlClient(options.stateDir, {
    runId: options.runId,
    ...(options.capabilityToken === undefined ? {} : { capabilityToken: options.capabilityToken }),
  })
  return client.cancel({
    operationId: options.operationId ?? randomUUID(),
    reason: 'operator requested cancel from TUI',
    source: 'agent-runtime-top',
  })
}
