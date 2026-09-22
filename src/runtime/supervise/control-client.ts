import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import {
  acknowledgeEffect,
  cancelCommand,
  conflictAck,
  copyAcknowledgement,
  freezeAcknowledgement,
  sameCommand,
  steerCommand,
  unauthorizedAcknowledgement,
} from './control-command'
import { capabilityDigest, sameSecret } from './control-crypto'
import { appendDurable, supervisorControlFiles } from './control-io'
import { readRouteCapability } from './control-ownership'
import { acknowledgementFor, readSnapshotFile } from './control-records'
import type {
  SupervisorControlAcknowledgement,
  SupervisorControlClient,
  SupervisorControlClientOptions,
  SupervisorControlCommand,
  SupervisorControlSnapshot,
  SupervisorWatchOptions,
} from './control-types'
import {
  abortError,
  assertPositiveDuration,
  assertStableText,
  delay,
  isTerminalStatus,
} from './control-validation'
import type { ControllableRootHandle } from './types'

/** Build a control client over a root handle bound to one live run. @stable */
export function createInProcessSupervisorControlClient(
  handle: ControllableRootHandle<unknown>,
  options: { runId?: string; now?: () => number; pollMs?: number } = {},
): SupervisorControlClient {
  const now = options.now ?? Date.now
  const pollMs = options.pollMs ?? 25
  assertPositiveDuration(pollMs, 'supervisor control poll interval')
  const initialSnapshot = handle.controlSnapshot?.() ?? {
    status: 'running' as const,
    tree: handle.view(),
  }
  const initial = initialSnapshot.tree
  const runId = options.runId ?? initial.root
  assertStableText(runId, 'supervisor run id')
  if (runId !== initial.root) {
    throw new Error(`supervisor control run "${runId}" does not match root "${initial.root}"`)
  }
  const acknowledgements = new Map<string, SupervisorControlAcknowledgement>()
  let revision = 0
  let lastTreeDigest = ''

  const readSnapshot = (): SupervisorControlSnapshot => {
    const current = handle.controlSnapshot?.() ?? {
      status: 'running' as const,
      tree: handle.view(),
    }
    const tree = structuredClone(current.tree)
    const digest = canonicalCandidateDigest({ status: current.status, tree })
    if (digest !== lastTreeDigest) {
      revision += 1
      lastTreeDigest = digest
    }
    return {
      version: 1,
      runId,
      revision,
      status: current.status,
      observedAt: new Date(now()).toISOString(),
      tree,
    }
  }

  return {
    runId,
    async snapshot() {
      return readSnapshot()
    },
    watch(watchOptions = {}) {
      return watchSnapshots(readSnapshot, watchOptions, watchOptions.pollMs ?? pollMs)
    },
    async steer(input) {
      if (input.signal?.aborted) throw abortError(input.signal.reason)
      const command = steerCommand(runId, input, now)
      const prior = acknowledgements.get(command.operationId)
      if (prior) {
        return sameCommand(prior, command) ? copyAcknowledgement(prior) : conflictAck(command, now)
      }
      const snapshot = readSnapshot()
      const acknowledgement = acknowledgeEffect(
        command,
        snapshot.revision,
        (request) => {
          if (snapshot.status !== 'running') {
            return {
              status: 'rejected',
              effect: 'not_live',
              message: `supervisor run is already ${snapshot.status}`,
            }
          }
          const accepted = handle.steer(input.workerId, request.message)
          return accepted
            ? { status: 'accepted', effect: 'delivered' }
            : {
                status: 'rejected',
                effect: 'not_live',
                message: 'worker is not live or does not accept steering',
              }
        },
        now,
      )
      acknowledgements.set(command.operationId, freezeAcknowledgement(acknowledgement))
      return copyAcknowledgement(acknowledgement)
    },
    async cancel(input) {
      if (input.signal?.aborted) throw abortError(input.signal.reason)
      const command = cancelCommand(runId, input, now)
      const prior = acknowledgements.get(command.operationId)
      if (prior) {
        return sameCommand(prior, command) ? copyAcknowledgement(prior) : conflictAck(command, now)
      }
      const snapshot = readSnapshot()
      const acknowledgement = acknowledgeEffect(
        command,
        snapshot.revision,
        (request) => {
          if (snapshot.status !== 'running') {
            return {
              status: 'rejected',
              effect: 'not_live',
              message: `supervisor run is already ${snapshot.status}`,
            }
          }
          if (request.target.kind === 'worker') {
            const accepted = handle.cancelWorker(request.target.workerId, request.reason)
            return accepted
              ? { status: 'accepted', effect: 'cancel_requested' }
              : { status: 'rejected', effect: 'not_live', message: 'control target is not live' }
          }
          handle.abort(request.reason)
          return { status: 'accepted', effect: 'cancel_requested' }
        },
        now,
      )
      acknowledgements.set(command.operationId, freezeAcknowledgement(acknowledgement))
      return copyAcknowledgement(acknowledgement)
    },
  }
}

/** Build a client that can be recreated in another process from the run directory. @stable */
export function createFileSupervisorControlClient(
  runDir: string,
  options: SupervisorControlClientOptions = {},
): SupervisorControlClient {
  const files = supervisorControlFiles(runDir)
  const now = options.now ?? Date.now
  const initial = readSnapshotFile(files.snapshot)
  const runId = options.runId ?? initial?.runId
  if (!runId) {
    throw new Error('supervisor control client requires runId before the first snapshot exists')
  }
  assertStableText(runId, 'supervisor run id')
  if (initial && initial.runId !== runId) {
    throw new Error(`supervisor control run "${runId}" does not match snapshot "${initial.runId}"`)
  }
  const pollMs = options.pollMs ?? 25
  const timeoutMs = options.timeoutMs ?? 5_000
  const capabilityToken = options.capabilityToken
  if (capabilityToken !== undefined) {
    assertStableText(capabilityToken, 'supervisor capability token')
    const capability = readRouteCapability(files.capability)
    if (capability && capability.runId !== runId) {
      throw new Error(
        `supervisor control capability run "${capability.runId}" does not match "${runId}"`,
      )
    }
    if (capability && !sameSecret(capability.capabilityDigest, capabilityDigest(capabilityToken))) {
      throw new Error(`supervisor control capability does not match run "${runId}"`)
    }
  }
  assertPositiveDuration(pollMs, 'supervisor control poll interval')
  assertPositiveDuration(timeoutMs, 'supervisor control timeout')

  const submit = async (
    command: SupervisorControlCommand,
    signal: AbortSignal | undefined,
    commandTimeout: number | undefined,
  ): Promise<SupervisorControlAcknowledgement> => {
    if (commandTimeout !== undefined) {
      assertPositiveDuration(commandTimeout, 'supervisor command timeout')
    }
    if (signal?.aborted) throw abortError(signal.reason)
    if (capabilityToken === undefined) {
      return unauthorizedAcknowledgement(command, now)
    }
    const existing = acknowledgementFor(files.acknowledgements, command)
    if (existing) return existing
    appendDurable(files.commands, command, capabilityToken)
    const duration = commandTimeout ?? timeoutMs
    const deadline = now() + duration
    const wallDeadline = Date.now() + duration
    for (;;) {
      const acknowledgement = acknowledgementFor(files.acknowledgements, command)
      if (acknowledgement) return acknowledgement
      if (signal?.aborted) throw abortError(signal.reason)
      if (now() >= deadline || Date.now() >= wallDeadline) {
        return {
          operationId: command.operationId,
          commandDigest: command.commandDigest,
          target: command.target,
          status: 'unknown',
          effect: 'unknown',
          acknowledgedAt: new Date(now()).toISOString(),
          message: 'supervisor did not acknowledge the command before the deadline',
        }
      }
      await delay(pollMs, signal)
    }
  }

  return {
    runId,
    async snapshot() {
      return readSnapshotFile(files.snapshot)
    },
    watch(watchOptions = {}) {
      return watchSnapshots(
        () => readSnapshotFile(files.snapshot),
        watchOptions,
        watchOptions.pollMs ?? pollMs,
      )
    },
    steer(input) {
      return submit(steerCommand(runId, input, now), input.signal, input.timeoutMs)
    },
    cancel(input) {
      return submit(cancelCommand(runId, input, now), input.signal, input.timeoutMs)
    },
  }
}

export async function* watchSnapshots(
  read: () => SupervisorControlSnapshot | null,
  options: SupervisorWatchOptions,
  pollMs: number,
): AsyncGenerator<SupervisorControlSnapshot> {
  let revision = options.afterRevision ?? -1
  if (!Number.isSafeInteger(revision) || revision < -1) {
    throw new Error('supervisor watch revision must be a non-negative safe integer')
  }
  assertPositiveDuration(pollMs, 'supervisor watch poll interval')
  for (;;) {
    if (options.signal?.aborted) throw abortError(options.signal.reason)
    const snapshot = read()
    if (snapshot && snapshot.revision > revision) {
      revision = snapshot.revision
      yield snapshot
      if (isTerminalStatus(snapshot.status)) return
      continue
    }
    await delay(pollMs, options.signal)
  }
}
