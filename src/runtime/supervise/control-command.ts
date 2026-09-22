import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { isRuntimeTimestamp } from '../timestamps'
import {
  commandAuthorization,
  decryptCommandPayload,
  encryptCommandPayload,
  sameSecret,
} from './control-crypto'
import type {
  SupervisorCancelInput,
  SupervisorControlAcknowledgement,
  SupervisorControlCommand,
  SupervisorControlCommandWire,
  SupervisorControlEffectReceiver,
  SupervisorControlEffectRequest,
  SupervisorControlEffectResult,
  SupervisorControlTarget,
  SupervisorSteerInput,
} from './control-types'
import {
  assertPositiveDuration,
  assertStableText,
  isRecord,
  isStableText,
} from './control-validation'

export function steerCommand(
  runId: string,
  input: SupervisorSteerInput,
  now: () => number,
): SupervisorControlCommand {
  assertStableText(input.operationId, 'supervisor operation id')
  assertStableText(input.workerId, 'supervisor worker id')
  if (input.source !== undefined) assertStableText(input.source, 'supervisor command source')
  if (input.timeoutMs !== undefined) {
    assertPositiveDuration(input.timeoutMs, 'supervisor command timeout')
  }
  const material = steerCommandMaterial(runId, input)
  return {
    ...material,
    issuedAt: new Date(now()).toISOString(),
    commandDigest: commandDigest(material),
  }
}

/** Return the canonical digest that identifies a supervisor steer before delivery. @stable */
export function supervisorSteerCommandDigest(
  runId: string,
  input: Pick<SupervisorSteerInput, 'operationId' | 'workerId' | 'message' | 'source'>,
): string {
  return commandDigest(steerCommandMaterial(runId, input))
}

function steerCommandMaterial(
  runId: string,
  input: Pick<SupervisorSteerInput, 'operationId' | 'workerId' | 'message' | 'source'>,
) {
  assertStableText(runId, 'supervisor run id')
  assertStableText(input.operationId, 'supervisor operation id')
  assertStableText(input.workerId, 'supervisor worker id')
  if (input.source !== undefined) assertStableText(input.source, 'supervisor command source')
  return {
    kind: 'steer' as const,
    operationId: input.operationId,
    source: input.source ?? 'runtime-client',
    target: { kind: 'worker' as const, runId, workerId: input.workerId },
    message: input.message,
  }
}

export function cancelCommand(
  runId: string,
  input: SupervisorCancelInput,
  now: () => number,
): SupervisorControlCommand {
  assertStableText(input.operationId, 'supervisor operation id')
  if (input.workerId !== undefined) assertStableText(input.workerId, 'supervisor worker id')
  if (input.source !== undefined) assertStableText(input.source, 'supervisor command source')
  if (input.reason !== undefined) assertStableText(input.reason, 'supervisor cancellation reason')
  if (input.timeoutMs !== undefined) {
    assertPositiveDuration(input.timeoutMs, 'supervisor command timeout')
  }
  const material = {
    kind: 'cancel' as const,
    operationId: input.operationId,
    source: input.source ?? 'runtime-client',
    target:
      input.workerId === undefined
        ? ({ kind: 'supervisor', runId } as const)
        : ({ kind: 'worker', runId, workerId: input.workerId } as const),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  }
  return {
    ...material,
    issuedAt: new Date(now()).toISOString(),
    commandDigest: commandDigest(material),
  }
}

export function commandDigest(command: unknown): string {
  return canonicalCandidateDigest(command)
}

export function isSupervisorControlCommand(value: unknown): value is SupervisorControlCommand {
  return isCommand(value)
}

export function serializeCommand(
  command: SupervisorControlCommand,
  capabilityToken: string | undefined,
): SupervisorControlCommandWire {
  if (capabilityToken === undefined) {
    throw new Error('supervisor control command requires a capability token')
  }
  const payload =
    command.kind === 'steer' ? { message: command.message } : { reason: command.reason }
  return {
    version: 1,
    kind: command.kind,
    operationId: command.operationId,
    commandDigest: command.commandDigest,
    issuedAt: command.issuedAt,
    source: command.source,
    target: command.target,
    payload: encryptCommandPayload(payload, capabilityToken),
    authorization: commandAuthorization(capabilityToken, command.commandDigest),
  }
}

export function deserializeCommand(
  value: unknown,
  capabilityToken: string,
): SupervisorControlCommand | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined
  if (
    !hasOnlyKeys(value, [
      'version',
      'kind',
      'operationId',
      'commandDigest',
      'issuedAt',
      'source',
      'target',
      'payload',
      'authorization',
    ])
  ) {
    return undefined
  }
  if (
    (value.kind !== 'steer' && value.kind !== 'cancel') ||
    !isStableText(value.operationId) ||
    !isStableText(value.commandDigest) ||
    !isStableText(value.issuedAt) ||
    !isStableText(value.source) ||
    !isTarget(value.target) ||
    !isStableText(value.payload) ||
    !isStableText(value.authorization) ||
    !isRuntimeTimestamp(value.issuedAt)
  ) {
    return undefined
  }
  if (
    !sameSecret(value.authorization, commandAuthorization(capabilityToken, value.commandDigest))
  ) {
    return undefined
  }
  const payload = decryptCommandPayload(value.payload, capabilityToken)
  if (!isRecord(payload)) return undefined
  if (
    value.kind === 'steer'
      ? !hasOnlyKeys(payload, ['message']) || !Object.hasOwn(payload, 'message')
      : !hasOnlyKeys(payload, ['reason'])
  ) {
    return undefined
  }
  const command =
    value.kind === 'steer'
      ? {
          kind: 'steer' as const,
          operationId: value.operationId,
          commandDigest: value.commandDigest,
          issuedAt: value.issuedAt,
          source: value.source,
          target: value.target,
          message: payload.message,
        }
      : {
          kind: 'cancel' as const,
          operationId: value.operationId,
          commandDigest: value.commandDigest,
          issuedAt: value.issuedAt,
          source: value.source,
          target: value.target,
          ...(payload.reason === undefined ? {} : { reason: payload.reason }),
        }
  return isCommand(command) ? command : undefined
}

function effectRequest(command: SupervisorControlCommand): SupervisorControlEffectRequest {
  const target = Object.freeze({ ...command.target })
  return command.kind === 'steer'
    ? Object.freeze({
        operationId: command.operationId,
        commandDigest: command.commandDigest,
        source: command.source,
        target,
        kind: command.kind,
        message: command.message,
      })
    : Object.freeze({
        operationId: command.operationId,
        commandDigest: command.commandDigest,
        source: command.source,
        target,
        kind: command.kind,
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      })
}

export function acknowledgeEffect(
  command: SupervisorControlCommand,
  snapshotRevision: number,
  receiver: SupervisorControlEffectReceiver,
  now: () => number,
): SupervisorControlAcknowledgement {
  try {
    const result = receiver(effectRequest(command))
    if (!isEffectResult(result)) {
      return unknownEffectAcknowledgement(
        command,
        now,
        'effect receiver returned an invalid result',
      )
    }
    return {
      operationId: command.operationId,
      commandDigest: command.commandDigest,
      target: command.target,
      status: result.status,
      effect: result.effect,
      acknowledgedAt: new Date(now()).toISOString(),
      snapshotRevision,
      ...(result.message === undefined ? {} : { message: result.message }),
    }
  } catch (error) {
    return unknownEffectAcknowledgement(
      command,
      now,
      `effect outcome is unknown: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function unknownEffectAcknowledgement(
  command: SupervisorControlCommand,
  now: () => number,
  message = 'effect outcome is unknown; the command will not be retried automatically',
): SupervisorControlAcknowledgement {
  return {
    operationId: command.operationId,
    commandDigest: command.commandDigest,
    target: command.target,
    status: 'unknown',
    effect: 'unknown',
    acknowledgedAt: new Date(now()).toISOString(),
    message,
  }
}

function isEffectResult(value: unknown): value is SupervisorControlEffectResult {
  if (!isRecord(value)) return false
  return (
    ['accepted', 'rejected', 'unknown'].includes(String(value.status)) &&
    ['delivered', 'cancel_requested', 'cancelled', 'not_live', 'unknown'].includes(
      String(value.effect),
    ) &&
    (value.message === undefined || typeof value.message === 'string')
  )
}

export function freezeAcknowledgement(
  acknowledgement: SupervisorControlAcknowledgement,
): SupervisorControlAcknowledgement {
  return Object.freeze({
    ...acknowledgement,
    target: Object.freeze({ ...acknowledgement.target }),
  })
}

export function copyAcknowledgement(
  acknowledgement: SupervisorControlAcknowledgement,
): SupervisorControlAcknowledgement {
  return {
    ...acknowledgement,
    target: { ...acknowledgement.target },
  }
}

export function sameCommand(
  acknowledgement: SupervisorControlAcknowledgement,
  command: SupervisorControlCommand,
): boolean {
  return (
    acknowledgement.operationId === command.operationId &&
    acknowledgement.commandDigest === command.commandDigest &&
    canonicalCandidateDigest(acknowledgement.target) === canonicalCandidateDigest(command.target)
  )
}

export function commandKey(command: { operationId: string; commandDigest: string }): string {
  return `${command.operationId}\u0000${command.commandDigest}`
}

export function conflictAck(
  command: SupervisorControlCommand,
  now: () => number,
): SupervisorControlAcknowledgement {
  return {
    operationId: command.operationId,
    commandDigest: command.commandDigest,
    target: command.target,
    status: 'conflict',
    effect: 'unknown',
    acknowledgedAt: new Date(now()).toISOString(),
    message: 'operation id was already used for a different command',
  }
}

export function unauthorizedAcknowledgement(
  command: SupervisorControlCommand,
  now: () => number,
): SupervisorControlAcknowledgement {
  return {
    operationId: command.operationId,
    commandDigest: command.commandDigest,
    target: command.target,
    status: 'rejected',
    effect: 'not_live',
    acknowledgedAt: new Date(now()).toISOString(),
    message: 'supervisor control capability token is required for commands',
  }
}

export function isCommand(value: unknown): value is SupervisorControlCommand {
  if (!isRecord(value) || !isTarget(value.target)) return false
  const allowedKeys = value.kind === 'steer' ? ['message'] : ['reason']
  if (
    !hasOnlyKeys(value, [
      'kind',
      'operationId',
      'commandDigest',
      'issuedAt',
      'source',
      'target',
      ...allowedKeys,
    ])
  ) {
    return false
  }
  if (
    !(
      (value.kind === 'steer' || value.kind === 'cancel') &&
      isStableText(value.operationId) &&
      isStableText(value.commandDigest) &&
      isRuntimeTimestamp(value.issuedAt) &&
      isStableText(value.source) &&
      (value.kind !== 'steer' ||
        (value.target.kind === 'worker' && 'message' in value && value.message !== undefined)) &&
      (value.kind !== 'cancel' ||
        !('reason' in value) ||
        value.reason === undefined ||
        isStableText(value.reason))
    )
  ) {
    return false
  }
  const material =
    value.kind === 'steer'
      ? {
          kind: value.kind,
          operationId: value.operationId,
          source: value.source,
          target: value.target,
          message: value.message,
        }
      : {
          kind: value.kind,
          operationId: value.operationId,
          source: value.source,
          target: value.target,
          ...('reason' in value && value.reason !== undefined ? { reason: value.reason } : {}),
        }
  try {
    return value.commandDigest === commandDigest(material)
  } catch {
    return false
  }
}

export function isTarget(value: unknown): value is SupervisorControlTarget {
  if (!isRecord(value) || !isStableText(value.runId)) return false
  if (value.kind === 'supervisor') {
    return Object.keys(value).every((key) => key === 'kind' || key === 'runId')
  }
  return (
    value.kind === 'worker' &&
    isStableText(value.workerId) &&
    Object.keys(value).every((key) => key === 'kind' || key === 'runId' || key === 'workerId')
  )
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}
