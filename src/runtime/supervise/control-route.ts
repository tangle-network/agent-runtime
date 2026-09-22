import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import {
  acknowledgeEffect,
  commandKey,
  conflictAck,
  sameCommand,
  unknownEffectAcknowledgement,
} from './control-command'
import { appendDurable, supervisorControlFiles, writeJsonAtomic } from './control-io'
import { legacyEffectReceiver } from './control-legacy'
import {
  acquireRouteOwnership,
  ensureControlDirectory,
  ensureRouteCapability,
} from './control-ownership'
import {
  readAcknowledgements,
  readCommands,
  readEffectRecords,
  readSnapshotFile,
} from './control-records'
import type {
  SupervisorControlAcknowledgement,
  SupervisorControlEffectRecord,
  SupervisorControlRoute,
  SupervisorControlRouteOptions,
  SupervisorControlSnapshot,
  SupervisorControlStatus,
} from './control-types'
import { assertPositiveDuration, assertStableText, isTerminalStatus } from './control-validation'

/**
 * Start reading durable commands and publishing runtime snapshots.
 *
 * @stable
 */
export function startSupervisorControlRoute(
  options: SupervisorControlRouteOptions,
): SupervisorControlRoute {
  assertStableText(options.runId, 'supervisor run id')
  const files = supervisorControlFiles(options.runDir)
  const now = options.now ?? Date.now
  const pollMs = options.pollMs ?? 25
  assertPositiveDuration(pollMs, 'supervisor control poll interval')
  ensureControlDirectory(files.directory)
  const initialTree = structuredClone(options.snapshot())
  if (initialTree.root !== options.runId) {
    throw new Error(
      `supervisor control tree root "${initialTree.root}" does not match run "${options.runId}"`,
    )
  }
  const capabilityToken = ensureRouteCapability(
    files.capability,
    options.runId,
    options.capabilityToken,
  )
  const priorSnapshot = readSnapshotFile(files.snapshot)
  if (priorSnapshot && priorSnapshot.runId !== options.runId) {
    throw new Error(
      `supervisor control run "${options.runId}" does not match existing snapshot "${priorSnapshot.runId}"`,
    )
  }
  let revision = priorSnapshot?.revision ?? 0
  const priorTerminalStatus =
    priorSnapshot && isTerminalStatus(priorSnapshot.status) ? priorSnapshot.status : undefined
  let status: SupervisorControlStatus = priorTerminalStatus ?? 'starting'
  let lastSnapshotDigest = ''
  let lastSnapshot: SupervisorControlSnapshot | undefined
  let closed = false
  const seen = new Map<string, SupervisorControlAcknowledgement>()
  const acknowledgedCommands = new Set<string>()
  const effectRecords = new Map<string, SupervisorControlEffectRecord>()
  for (const acknowledgement of readAcknowledgements(files.acknowledgements)) {
    acknowledgedCommands.add(commandKey(acknowledgement))
    if (acknowledgement.status !== 'conflict' && !seen.has(acknowledgement.operationId)) {
      seen.set(acknowledgement.operationId, acknowledgement)
    }
  }
  for (const record of readEffectRecords(files.effects)) {
    effectRecords.set(record.operationId, record)
  }

  const effectReceiver = options.effectReceiver ?? legacyEffectReceiver(options)

  const publishSnapshot = (): SupervisorControlSnapshot => {
    const tree = structuredClone(options.snapshot())
    if (tree.root !== options.runId) {
      throw new Error(
        `supervisor control tree root "${tree.root}" does not match run "${options.runId}"`,
      )
    }
    const digest = canonicalCandidateDigest({ status, tree })
    if (digest === lastSnapshotDigest && lastSnapshot) return lastSnapshot
    revision += 1
    lastSnapshotDigest = digest
    const snapshot: SupervisorControlSnapshot = {
      version: 1,
      runId: options.runId,
      revision,
      status,
      observedAt: new Date(now()).toISOString(),
      tree,
    }
    writeJsonAtomic(files.snapshot, snapshot)
    lastSnapshot = snapshot
    return snapshot
  }

  const processCommands = (): void => {
    // A recovered route has no live supervisor until the new owner explicitly
    // rebinds. Leaving commands unread preserves their original effect and
    // lets the live owner decide whether to apply them.
    if (status === 'unknown') return
    const snapshot = publishSnapshot()
    for (const command of readCommands(files.commands, capabilityToken)) {
      const prior = seen.get(command.operationId)
      if (prior) {
        if (!sameCommand(prior, command) && !acknowledgedCommands.has(commandKey(command))) {
          const acknowledgement = conflictAck(command, now)
          appendDurable(files.acknowledgements, acknowledgement)
          acknowledgedCommands.add(commandKey(acknowledgement))
        }
        continue
      }
      const priorEffect = effectRecords.get(command.operationId)
      if (priorEffect) {
        if (priorEffect.commandDigest !== command.commandDigest) {
          const acknowledgement = conflictAck(command, now)
          appendAcknowledgement(acknowledgement)
          continue
        }
        if (
          priorEffect.acknowledgement !== undefined &&
          !sameCommand(priorEffect.acknowledgement, command)
        ) {
          throw new Error(
            `supervisor control effect acknowledgement targets another command: ${command.operationId}`,
          )
        }
        const acknowledgement =
          priorEffect.acknowledgement ?? unknownEffectAcknowledgement(command, now)
        if (!priorEffect.acknowledgement) {
          persistEffectRecord({
            ...priorEffect,
            status: 'unknown',
            acknowledgement,
          })
        }
        appendAcknowledgement(acknowledgement)
        continue
      }

      const started: SupervisorControlEffectRecord = {
        version: 1,
        operationId: command.operationId,
        commandDigest: command.commandDigest,
        status: 'started',
      }
      persistEffectRecord(started)
      let acknowledgement: SupervisorControlAcknowledgement
      if (status !== 'running') {
        acknowledgement = {
          operationId: command.operationId,
          commandDigest: command.commandDigest,
          target: command.target,
          status: 'rejected',
          effect: 'not_live',
          acknowledgedAt: new Date(now()).toISOString(),
          snapshotRevision: snapshot.revision,
          message: `supervisor run is already ${status}`,
        }
      } else if (command.target.runId !== options.runId) {
        acknowledgement = {
          operationId: command.operationId,
          commandDigest: command.commandDigest,
          target: command.target,
          status: 'rejected',
          effect: 'not_live',
          acknowledgedAt: new Date(now()).toISOString(),
          snapshotRevision: snapshot.revision,
          message: `command targets another supervisor run: ${command.target.runId}`,
        }
      } else {
        acknowledgement = acknowledgeEffect(command, snapshot.revision, effectReceiver, now)
      }
      persistEffectRecord({
        ...started,
        status: 'completed',
        acknowledgement,
      })
      appendAcknowledgement(acknowledgement)
    }
  }

  const appendAcknowledgement = (acknowledgement: SupervisorControlAcknowledgement): void => {
    if (!acknowledgedCommands.has(commandKey(acknowledgement))) {
      appendDurable(files.acknowledgements, acknowledgement)
      acknowledgedCommands.add(commandKey(acknowledgement))
    }
    seen.set(acknowledgement.operationId, acknowledgement)
  }

  const persistEffectRecord = (record: SupervisorControlEffectRecord): void => {
    appendDurable(files.effects, record)
    effectRecords.set(record.operationId, record)
  }

  const ownership = acquireRouteOwnership(files.owner, options.runId, capabilityToken, now)
  const releaseOwnership = ownership.release
  const awaitingRebind = ownership.deadOwnerTakenOver || priorSnapshot?.status === 'unknown'
  status = priorTerminalStatus ?? (awaitingRebind ? 'unknown' : 'running')
  try {
    // Persist the takeover state before returning control to a caller. Otherwise a durable client
    // can observe the dead owner's last `running` snapshot and issue a command against an unbound
    // route before the explicit rebind decision is visible.
    publishSnapshot()
    processCommands()
  } catch (error) {
    releaseOwnership()
    throw error
  }
  const timer = setInterval(() => {
    if (closed) return
    try {
      processCommands()
    } catch {
      // The next tick retries. A command is never acknowledged unless applied.
    }
  }, pollMs)
  timer.unref?.()

  return {
    capabilityToken,
    refresh() {
      if (!closed) processCommands()
    },
    rebind() {
      if (closed) throw new Error('supervisor control route is closed')
      if (!awaitingRebind || isTerminalStatus(status)) return
      if (status !== 'unknown')
        throw new Error(`supervisor control route cannot rebind from ${status}`)
      status = 'running'
      try {
        processCommands()
      } catch (error) {
        status = 'unknown'
        try {
          publishSnapshot()
        } catch {
          // Preserve the effect-processing failure; ownership remains held until close.
        }
        throw error
      }
    },
    close(terminalStatus) {
      if (closed) return
      if (awaitingRebind && status === 'unknown') {
        closed = true
        clearInterval(timer)
        // A failed startup/rebind must not strand the operating-system lock. The
        // route remains terminally unusable, but a later owner must be able to
        // prove takeover rather than inheriting a live lock from this failed
        // attempt.
        releaseOwnership()
        throw new Error('supervisor control route requires explicit live rebind before close')
      }
      closed = true
      clearInterval(timer)
      status = priorTerminalStatus ?? terminalStatus
      try {
        processCommands()
      } finally {
        releaseOwnership()
      }
    },
  }
}
