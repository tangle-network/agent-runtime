import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { isRuntimeTimestamp } from '../timestamps'
import { conflictAck, deserializeCommand, isTarget } from './control-command'
import { readFileIfPresent } from './control-io'
import type {
  SupervisorControlAcknowledgement,
  SupervisorControlCommand,
  SupervisorControlEffectRecord,
  SupervisorControlSnapshot,
} from './control-types'
import { isRecord, isStableText } from './control-validation'
import type { TreeView } from './types'

export function readSnapshotFile(file: string): SupervisorControlSnapshot | null {
  const raw = readFileIfPresent(file)
  if (raw === undefined) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(`supervisor control snapshot is not valid JSON: ${file}`, { cause: error })
  }
  if (!isSnapshot(parsed)) throw new Error(`supervisor control snapshot is invalid: ${file}`)
  return parsed
}

export function readCommands(file: string, capabilityToken: string): SupervisorControlCommand[] {
  return readNdjson(file)
    .map((value) => deserializeCommand(value, capabilityToken))
    .filter((command): command is SupervisorControlCommand => command !== undefined)
}

export function readAcknowledgements(file: string): SupervisorControlAcknowledgement[] {
  const acknowledgements = readNdjson(file).map((value) => {
    if (!isAcknowledgement(value)) {
      throw new Error(`supervisor control acknowledgement log is corrupt: ${file}`)
    }
    return value
  })
  const seen = new Map<string, string>()
  const seenOperationIdentity = new Map<string, string>()
  for (const acknowledgement of acknowledgements) {
    if (acknowledgement.status !== 'conflict') {
      const operationIdentity = `${acknowledgement.commandDigest}\u0000${canonicalCandidateDigest(acknowledgement.target)}`
      const priorIdentity = seenOperationIdentity.get(acknowledgement.operationId)
      if (priorIdentity !== undefined && priorIdentity !== operationIdentity) {
        throw new Error(
          `supervisor control acknowledgement log has conflicting operation identities: ${file}`,
        )
      }
      seenOperationIdentity.set(acknowledgement.operationId, operationIdentity)
    }
    const key = `${acknowledgement.operationId}\u0000${acknowledgement.commandDigest}\u0000${canonicalCandidateDigest(acknowledgement.target)}`
    const digest = canonicalCandidateDigest(acknowledgement)
    const prior = seen.get(key)
    if (prior !== undefined && prior !== digest) {
      throw new Error(`supervisor control acknowledgement log has conflicting records: ${file}`)
    }
    seen.set(key, digest)
  }
  return acknowledgements
}

export function readEffectRecords(file: string): SupervisorControlEffectRecord[] {
  const records = readNdjson(file).map((value) => {
    if (!isEffectRecord(value)) {
      throw new Error(`supervisor control effect log is corrupt: ${file}`)
    }
    return value
  })
  const priorByOperation = new Map<string, SupervisorControlEffectRecord>()
  for (const record of records) {
    const prior = priorByOperation.get(record.operationId)
    if (prior !== undefined) {
      if (prior.commandDigest !== record.commandDigest) {
        throw new Error(`supervisor control effect log has conflicting records: ${file}`)
      }
      const isRecoveryCompletion =
        (prior.status === 'completed' || prior.status === 'unknown') &&
        prior.acknowledgement === undefined &&
        record.status === 'unknown' &&
        record.acknowledgement !== undefined
      const isInitialCompletion =
        prior.status === 'started' && (record.status === 'completed' || record.status === 'unknown')
      if (!isInitialCompletion && !isRecoveryCompletion) {
        throw new Error(`supervisor control effect log has invalid ordering: ${file}`)
      }
    }
    priorByOperation.set(record.operationId, record)
  }
  return records
}

export function acknowledgementFor(
  file: string,
  command: SupervisorControlCommand,
): SupervisorControlAcknowledgement | undefined {
  const all = readAcknowledgements(file).filter(
    (acknowledgement) => acknowledgement.operationId === command.operationId,
  )
  return (
    all.find(
      (acknowledgement) =>
        acknowledgement.commandDigest === command.commandDigest &&
        canonicalCandidateDigest(acknowledgement.target) ===
          canonicalCandidateDigest(command.target),
    ) ?? (all.length > 0 ? conflictAck(command, Date.now) : undefined)
  )
}

function readNdjson(file: string): unknown[] {
  const raw = readFileIfPresent(file)
  if (raw === undefined) return []
  const values: unknown[] = []
  const lines = raw.split('\n')
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    try {
      values.push(JSON.parse(line))
    } catch (error) {
      const isUnterminatedFinalRecord = index === lines.length - 1 && !raw.endsWith('\n')
      if (isUnterminatedFinalRecord) continue
      throw new Error(`supervisor control log is corrupt: ${file}`, { cause: error })
    }
  }
  return values
}

function isSnapshot(value: unknown): value is SupervisorControlSnapshot {
  if (!isRecord(value) || value.version !== 1 || !isTreeView(value.tree)) return false
  return (
    isStableText(value.runId) &&
    value.tree.root === value.runId &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    ['starting', 'running', 'completed', 'failed', 'cancelled', 'unknown'].includes(
      String(value.status),
    ) &&
    isRuntimeTimestamp(value.observedAt)
  )
}

function isAcknowledgement(value: unknown): value is SupervisorControlAcknowledgement {
  if (!isRecord(value) || !isTarget(value.target)) return false
  return (
    isStableText(value.operationId) &&
    isStableText(value.commandDigest) &&
    ['accepted', 'rejected', 'conflict', 'unknown'].includes(String(value.status)) &&
    ['delivered', 'cancel_requested', 'cancelled', 'not_live', 'unknown'].includes(
      String(value.effect),
    ) &&
    isRuntimeTimestamp(value.acknowledgedAt) &&
    (value.snapshotRevision === undefined ||
      (Number.isSafeInteger(value.snapshotRevision) && Number(value.snapshotRevision) >= 0)) &&
    (value.message === undefined || typeof value.message === 'string')
  )
}

function isEffectRecord(value: unknown): value is SupervisorControlEffectRecord {
  if (!isRecord(value)) return false
  if (
    value.version !== 1 ||
    !isStableText(value.operationId) ||
    !isStableText(value.commandDigest) ||
    !['started', 'completed', 'unknown'].includes(String(value.status))
  ) {
    return false
  }
  if (value.status === 'started' && value.acknowledgement !== undefined) return false
  return (
    value.acknowledgement === undefined ||
    (isAcknowledgement(value.acknowledgement) &&
      value.acknowledgement.operationId === value.operationId &&
      value.acknowledgement.commandDigest === value.commandDigest)
  )
}

function isTreeView(value: unknown): value is TreeView {
  return (
    isRecord(value) &&
    isStableText(value.root) &&
    Array.isArray(value.nodes) &&
    Number.isSafeInteger(value.inFlight) &&
    Number(value.inFlight) >= 0 &&
    Number.isSafeInteger(value.waiting) &&
    Number(value.waiting) >= 0
  )
}
