import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createWorkerCancellationStore,
  type WorkerCancellation,
  type WorkerCancelRequest,
} from './worker-cancellation-store'
import type { WorkerControlAuthority } from './worker-control-context'
import type { WorkerControlPersistence } from './worker-control-layout'
import {
  createWorkerSteerStore,
  type WorkerSteerAcknowledgement,
  type WorkerSteerEffect,
  type WorkerSteerRequest,
} from './worker-steer-store'

const SPAWN_JOURNAL_FILE = 'spawn-journal.jsonl'

/** Runtime-side durable control dependencies. */
export interface WorkerControlDriverOptions {
  readonly dir: string
  readonly authority: WorkerControlAuthority
  readonly now: () => number
  readonly ownerId?: string
  readonly persistence?: WorkerControlPersistence
}

/** The one turn-loop adapter for durable steer and cancellation operations. */
export interface WorkerControlDriver {
  readonly pass: () => Promise<void>
}

/**
 * Build the durable control consumer for one Runtime process.
 *
 * An operation has one exclusive claim file. The process writes an `unknown` attempt record before
 * calling delivery or abort. A different process that sees the claim or attempt never repeats the
 * external action. The owner token adds a process nonce to the caller's logical owner label.
 */
export function createWorkerControlDriver(
  options: WorkerControlDriverOptions,
): WorkerControlDriver {
  const logicalOwnerId = options.ownerId ?? 'runtime'
  if (!logicalOwnerId || logicalOwnerId.trim() !== logicalOwnerId) {
    throw new Error('worker control ownerId is empty or unsafe')
  }
  const ownerId = `${logicalOwnerId}:${randomUUID()}`
  const steer = createWorkerSteerStore(options.dir, { persistence: options.persistence })
  const cancellation = createWorkerCancellationStore(options.dir, {
    persistence: options.persistence,
  })
  const attemptedSteers = new Set<string>()
  const attemptedCancellations = new Set<string>()
  const iso = () => new Date(options.now()).toISOString()

  const applySteer = async (request: WorkerSteerRequest): Promise<void> => {
    const operationId = request.operationId ?? request.id
    const existing = steer.readAcknowledgement(operationId)
    if (existing !== undefined) {
      steer.assertAcknowledgementMatchesRequest(existing, request)
      return
    }
    if (attemptedSteers.has(operationId)) return
    const target = options.authority.resolve(request.worker)
    if (target === undefined) return
    // A request may be durable before its worker is spawned. Do not consume its operation claim
    // while the exact id is absent; the next pass must still be able to deliver that steer.
    const node = target.scope.view.nodes.find((candidate) => candidate.id === request.worker)
    const settled = target.coord.settled().find((worker) => worker.id === request.worker)
    if (node === undefined && settled === undefined) return
    if (!steer.claim(request, ownerId)) return

    // Set this before the first write. If the write fails, this process and every future process
    // must leave the exclusive claim untouched rather than guessing whether delivery happened.
    attemptedSteers.add(operationId)
    const attempt: WorkerSteerAcknowledgement = {
      operationId,
      worker: request.worker,
      source: request.source,
      message: request.message,
      requestId: request.id,
      requestedAt: request.at,
      observedAt: iso(),
      effect: 'unknown',
      ownerId,
      detail: 'delivery attempt committed; final effect is not yet proven',
    }
    steer.writeAcknowledgement(attempt)

    let effect: WorkerSteerEffect
    let detail: string | undefined
    if (node === undefined || isTerminal(node.status)) {
      effect = 'already-settled'
      detail = `worker '${request.worker}' had already settled before this operation was applied`
    } else {
      try {
        const result = await target.deliverSteer(request)
        if (isRecord(result) && result.delivered === true) {
          effect = 'delivered'
        } else if (isRecord(result) && isWorkerSteerEffect(result.reason)) {
          effect = result.reason
          detail = `Runtime could not deliver the steer to exact worker '${request.worker}'`
        } else {
          effect = 'runtime-error'
          detail = 'canonical steer_agent returned an invalid delivery result'
        }
      } catch (error) {
        effect = 'runtime-error'
        detail = error instanceof Error ? error.message : String(error)
      }
    }
    steer.writeAcknowledgement({
      ...attempt,
      observedAt: iso(),
      effect,
      ...(detail === undefined ? {} : { detail }),
    })
  }

  const applyCancellation = (request: WorkerCancelRequest): void => {
    const existing = cancellation.readAcknowledgement(request.operationId)
    if (existing !== undefined) {
      cancellation.assertAcknowledgementMatchesRequest(existing, request)
      if (existing.effect === 'cancel_requested') reconcileCancellation(existing)
      return
    }
    if (attemptedCancellations.has(request.operationId)) return
    const target = options.authority.resolve(request.worker)
    if (target === undefined) return
    // A request may be durable before its worker is spawned. Do not consume its operation claim
    // while the exact id is absent; the next pass must still be able to cancel that worker.
    const node = target.scope.view.nodes.find((candidate) => candidate.id === request.worker)
    const settled = target.coord.settled().find((worker) => worker.id === request.worker)
    if (node === undefined && settled === undefined) return
    if (!cancellation.claim(request, ownerId)) return

    // This is the durable fence immediately before the external abort. A write failure stops the
    // operation before abort, and the claim prevents a later process from retrying it.
    attemptedCancellations.add(request.operationId)
    const attempt: WorkerCancellation = {
      operationId: request.operationId,
      worker: request.worker,
      workerId: request.worker,
      source: request.source,
      effect: 'unknown',
      requestedAt: request.at,
      observedAt: iso(),
      ownerId,
      ...(request.reason === undefined ? {} : { reason: request.reason }),
      detail: 'abort attempt committed; termination is not yet proven',
      terminated: [],
    }
    cancellation.writeAcknowledgement(attempt)

    if (node === undefined) {
      reconcileCancellation(attempt)
      return
    }
    if (isTerminal(node.status)) {
      cancellation.writeAcknowledgement({
        ...attempt,
        effect: 'not_live',
        observedAt: iso(),
        detail: `worker '${request.worker}' had already settled before this operation was applied`,
      })
      return
    }

    // `abortWorkerById` resolves only the exact id. It does not fall back to a label or profile.
    const aborted = target.coord.abortWorkerById(
      request.worker,
      request.reason ?? 'cancel requested',
    )
    if (aborted === undefined) {
      const afterAbort = target.scope.view.nodes.find(
        (candidate) => candidate.id === request.worker,
      )
      if (afterAbort !== undefined && isTerminal(afterAbort.status)) {
        cancellation.writeAcknowledgement({
          ...attempt,
          effect: 'not_live',
          observedAt: iso(),
          detail: `worker '${request.worker}' settled before Runtime could issue its abort`,
        })
      } else {
        reconcileCancellation(attempt)
      }
      return
    }
    if (aborted.id !== request.worker) {
      throw new Error(
        `worker control abort returned '${aborted.id}' for exact worker '${request.worker}'`,
      )
    }
    // The state transition occurs only after the abort call returns. If this write fails, the
    // durable `unknown` attempt and exclusive claim prevent a retry that could abort twice.
    cancellation.writeAcknowledgement({
      ...attempt,
      effect: 'cancel_requested',
      observedAt: iso(),
      detail: `abort issued to exact worker '${request.worker}'; termination not yet proven`,
    })
  }

  function reconcileCancellation(record: WorkerCancellation): void {
    const workerId = record.workerId ?? record.worker
    const target = options.authority.resolve(workerId)
    if (target === undefined) return
    const settled = target.coord.settled().find((worker) => worker.id === workerId)
    if (settled === undefined) return
    if (settled.status === 'down') {
      cancellation.writeAcknowledgement({
        ...record,
        workerId,
        effect: 'cancelled',
        observedAt: iso(),
        terminated: [workerId, ...terminatedDescendants(options.dir, workerId, record.requestedAt)],
        detail: `worker '${workerId}' reached a terminal down state on the settle path`,
      })
      return
    }
    if (settled.status === 'done') {
      cancellation.writeAcknowledgement({
        ...record,
        workerId,
        effect: 'not_live',
        observedAt: iso(),
        terminated: [],
        detail: `worker '${workerId}' settled done despite the abort request; nothing was terminated`,
      })
    }
  }

  return {
    async pass(): Promise<void> {
      for (const request of cancellation.requests()) applyCancellation(request)
      for (const request of steer.requests()) await applySteer(request)
      for (const record of cancellationAcknowledgements(cancellation.requests())) {
        if (record.effect === 'cancel_requested') reconcileCancellation(record)
      }
    },
  }

  function cancellationAcknowledgements(
    requests: ReadonlyArray<WorkerCancelRequest>,
  ): WorkerCancellation[] {
    const records: WorkerCancellation[] = []
    for (const request of requests) {
      const record = cancellation.readAcknowledgement(request.operationId)
      if (record !== undefined) records.push(record)
    }
    return records
  }
}

function isTerminal(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWorkerSteerEffect(
  value: unknown,
): value is Exclude<WorkerSteerEffect, 'unknown' | 'delivered'> {
  return (
    value === 'unknown-worker' ||
    value === 'already-settled' ||
    value === 'runtime-has-no-inbox' ||
    value === 'scope-stopped' ||
    value === 'runtime-error'
  )
}

/** Read terminal descendant evidence from the same durable spawn journal as the run. */
function terminatedDescendants(dir: string, nodeId: string, sinceIso: string): string[] {
  let raw: string
  try {
    raw = readFileSync(join(dir, SPAWN_JOURNAL_FILE), 'utf8')
  } catch {
    return []
  }
  const prefix = `${nodeId}:`
  const ids = new Set<string>()
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: { kind?: unknown; event?: Record<string, unknown> }
    try {
      parsed = JSON.parse(trimmed) as { kind?: unknown; event?: Record<string, unknown> }
    } catch {
      continue
    }
    if (parsed.kind !== 'event' || parsed.event === undefined) continue
    const event = parsed.event
    const died = (event.kind === 'settled' && event.status === 'down') || event.kind === 'cancelled'
    if (!died) continue
    if (typeof event.id !== 'string' || !event.id.startsWith(prefix)) continue
    if (typeof event.at !== 'string' || event.at < sinceIso) continue
    ids.add(event.id)
  }
  return [...ids].sort()
}
