import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnJournalRecordEvents } from '../../durable/spawn-journal/record-events'
import type { SettledWorker } from '../../mcp/tools/coordination-contracts'
import type { DownMessageEvent } from '../../mcp/tools/coordination-messages'
import type { InboxReceipt } from './inbox'
import { isTerminalNodeStatus } from './node-status'
import type { RunCancelRequest } from './run-cancellation'
import {
  applyRunCancellation,
  type RunCancellation,
  readRunCancellation,
  readRunCancelRequest,
  writeRunCancellation,
} from './run-cancellation'
import {
  claimWorkerSteerDelivery,
  readWorkerCancellation,
  readWorkerCancelRequests,
  readWorkerSteerAcknowledgement,
  readWorkerSteerRequests,
  type WorkerCancellation,
  type WorkerCancelRequest,
  type WorkerSteerAcknowledgement,
  type WorkerSteerRequest,
  workerCancelRequestsFile,
  workerSteerRequestsDir,
  writeWorkerCancellation,
  writeWorkerSteerAcknowledgement,
} from './run-layout'
import type { Scope } from './types'

const SPAWN_JOURNAL_FILE = 'spawn-journal.jsonl'

interface Tail {
  file: string
  offset: number
  partial: string
  at: Map<string, string>
}

function appendedLines(tail: Tail): string[] | undefined {
  let size: number
  try {
    size = statSync(tail.file).size
  } catch {
    return undefined
  }
  if (size < tail.offset) {
    tail.offset = 0
    tail.partial = ''
    tail.at.clear()
  }
  if (size === tail.offset) return undefined
  const buf = Buffer.allocUnsafe(size - tail.offset)
  const fd = openSync(tail.file, 'r')
  try {
    const got = readSync(fd, buf, 0, buf.length, tail.offset)
    tail.offset += got
    const text = tail.partial + buf.subarray(0, got).toString('utf8')
    const parts = text.split('\n')
    tail.partial = text.endsWith('\n') ? '' : (parts.pop() ?? '')
    if (text.endsWith('\n')) parts.pop()
    return parts
  } finally {
    closeSync(fd)
  }
}

function indexDeaths(tail: Tail): boolean {
  const lines = appendedLines(tail)
  if (lines === undefined) return false
  let grew = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      for (const event of spawnJournalRecordEvents(JSON.parse(trimmed))) {
        if (event === undefined) continue
        const died =
          (event.kind === 'settled' && event.status === 'down') || event.kind === 'cancelled'
        if (!died || typeof event.id !== 'string' || typeof event.at !== 'string') continue
        const prev = tail.at.get(event.id)
        if (prev !== undefined && prev >= event.at) continue
        tail.at.set(event.id, event.at)
        grew = true
      }
    } catch {}
  }
  return grew
}

function descendantsSince(tail: Tail, nodeId: string, sinceIso: string): string[] {
  indexDeaths(tail)
  const prefix = `${nodeId}:`
  const ids = [...tail.at.keys()].filter(
    (id) => id.startsWith(prefix) && (tail.at.get(id) ?? '') >= sinceIso,
  )
  ids.sort()
  return ids
}

interface CancelAcknowledgerDeps {
  readonly dir: string
  readonly coord: {
    settled(): ReadonlyArray<SettledWorker>
    abortWorker(
      ref: string,
      reason?: string,
    ): { readonly id: string; readonly label: string } | undefined
  }
  readonly scope: Scope<unknown>
  readonly now: () => number
  readonly ownerId: string
  readonly controlScope: 'run' | 'subtree'
  readonly abortRun?: (reason: string, request?: RunCancelRequest) => void
}

export interface RootSteer {
  readonly steer: string
  readonly interrupt: boolean
  readonly messageId: string
  readonly receipt: (receipt: InboxReceipt) => void
}

interface SteerAcknowledgerDeps {
  readonly deliverRoot?: (message: RootSteer) => boolean
  readonly deliverRootReady?: () => boolean
  readonly dir: string
  readonly coord: {
    steerWorker(
      workerId: string,
      instruction: string,
      options?: { readonly interrupt?: boolean },
    ): Promise<DownMessageEvent>
  }
  readonly now: () => number
  readonly ownerId: string
  readonly signal?: AbortSignal
}

/** Unknown ack lands before delivery. A crash can lose the steer; a restart must not deliver it twice. */
export function createSteerAcknowledger(deps: SteerAcknowledgerDeps): {
  pass(phase: 'turn' | 'boundary' | 'final'): Promise<void>
} {
  const iso = () => new Date(deps.now()).toISOString()
  const awaiting = new Map<string, WorkerSteerRequest>()
  const answerRoot = (request: WorkerSteerRequest, receipt: InboxReceipt): void => {
    if (!awaiting.delete(request.operationId)) return
    writeWorkerSteerAcknowledgement(deps.dir, {
      ...base(request),
      ...(receipt.status === 'consumed'
        ? {
            effect: 'delivered',
            detail: `the root consumed the steer in ${receipt.attemptId}`,
          }
        : {
            effect: 'not_live',
            detail: `the root did not consume the steer: ${receipt.reason}`,
          }),
      observedAt: iso(),
    })
  }

  const base = (
    request: WorkerSteerRequest,
  ): Omit<WorkerSteerAcknowledgement, 'effect' | 'observedAt' | 'detail'> => ({
    schemaVersion: 1,
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    worker: request.worker,
    requestedAt: request.at,
  })
  let steerStamp = ''
  let steerIdle = false
  const steerChanged = (phase: 'turn' | 'boundary' | 'final'): boolean => {
    let stamp = 'missing'
    try {
      const st = statSync(workerSteerRequestsDir(deps.dir), { bigint: true })
      stamp = `${st.dev}:${st.ino}:${st.mtimeNs}:${st.size}`
    } catch {
      stamp = 'missing'
    }
    const changed = stamp !== steerStamp
    if (changed && phase !== 'boundary') steerStamp = stamp
    return changed
  }

  return {
    async pass(phase): Promise<void> {
      const changed = steerChanged(phase)
      if (phase !== 'final' && !changed && steerIdle) return
      let waiting = false
      for (const request of readWorkerSteerRequests(deps.dir)) {
        if (phase !== 'final' && deps.signal?.aborted) {
          steerIdle = false
          return
        }
        const rootRequest = request.worker === deps.ownerId && deps.deliverRoot !== undefined
        // A boundary pass must not deliver to a worker whose execution already finished.
        if (phase === 'boundary' && !rootRequest) continue
        if (!rootRequest && !isDirectChildNodeId(deps, request.worker)) continue
        const queued = awaiting.get(request.operationId)
        if (phase === 'final' && queued !== undefined) {
          answerRoot(queued, {
            status: 'failed',
            messageId: request.operationId,
            cause: 'closed',
            reason: 'the run ended before a root turn read it',
          })
          continue
        }
        if (readWorkerSteerAcknowledgement(deps.dir, request.operationId) !== undefined) continue
        if (phase === 'final') {
          writeWorkerSteerAcknowledgement(deps.dir, {
            ...base(request),
            effect: 'not_live',
            observedAt: iso(),
            detail: 'run ended before the steer was applied',
          })
          continue
        }
        if (rootRequest && deps.deliverRootReady !== undefined && !deps.deliverRootReady()) {
          waiting = true
          continue
        }
        const claimed = claimWorkerSteerDelivery(deps.dir, {
          ...base(request),
          effect: 'unknown',
          observedAt: iso(),
          detail: 'delivery admitted; outcome not yet known',
        })
        if (!claimed) continue
        try {
          let outcome: Pick<DownMessageEvent, 'delivered' | 'outcome'>
          if (rootRequest) {
            awaiting.set(request.operationId, request)
            const delivered = deps.deliverRoot!({
              steer: request.message,
              interrupt: request.interrupt,
              messageId: request.operationId,
              receipt: (receipt) => answerRoot(request, receipt),
            })
            if (!delivered) awaiting.delete(request.operationId)
            outcome = { delivered, outcome: delivered ? 'delivered' : 'runtime-has-no-inbox' }
          } else {
            outcome = await deps.coord.steerWorker(request.worker, request.message, {
              interrupt: request.interrupt,
            })
          }
          if (rootRequest && outcome.delivered) {
            if (awaiting.has(request.operationId)) {
              writeWorkerSteerAcknowledgement(deps.dir, {
                ...base(request),
                effect: 'unknown',
                observedAt: iso(),
                detail: 'queued in the root inbox; no root turn has consumed it yet',
              })
            }
            continue
          }
          const effect: WorkerSteerAcknowledgement['effect'] = outcome.delivered
            ? 'delivered'
            : outcome.outcome === 'runtime-has-no-inbox'
              ? 'unsupported'
              : outcome.outcome === 'unknown-worker' ||
                  outcome.outcome === 'already-settled' ||
                  outcome.outcome === 'scope-stopped'
                ? 'not_live'
                : 'unknown'
          writeWorkerSteerAcknowledgement(deps.dir, {
            ...base(request),
            effect,
            observedAt: iso(),
            detail: rootRequest
              ? 'the root exposes no accepting inbox at delivery time'
              : steerAcknowledgementDetail(outcome),
          })
        } catch (error) {
          void error
          awaiting.delete(request.operationId)
          writeWorkerSteerAcknowledgement(deps.dir, {
            ...base(request),
            effect: 'unknown',
            observedAt: iso(),
            detail: 'delivery outcome is unknown after a runtime error',
          })
        }
      }
      if (phase === 'turn') steerIdle = !waiting
    },
  }
}

function steerAcknowledgementDetail(outcome: Pick<DownMessageEvent, 'outcome'>): string {
  switch (outcome.outcome) {
    case 'delivered':
      return 'the owning manager delivered the steer to the exact live worker'
    case 'runtime-has-no-inbox':
      return 'the exact worker does not expose a steer inbox'
    case 'unknown-worker':
      return 'the owning manager does not know the exact worker'
    case 'already-settled':
      return 'the exact worker settled before delivery'
    case 'scope-stopped':
      return 'the owning manager stopped before delivery'
    case 'runtime-error':
      return 'delivery outcome is unknown after a runtime error'
  }
}

export function createCancelAcknowledger(deps: CancelAcknowledgerDeps): {
  pass(phase: 'turn' | 'boundary' | 'final'): void
  finish(): void
} {
  const tracked = new Map<string, WorkerCancellation>()
  let runTracked: RunCancellation | undefined
  const abortIssuedAt = new Map<string, string>()
  const iso = () => new Date(deps.now()).toISOString()
  const waiting = new Map<string, WorkerCancelRequest>()
  const reconciling = new Map<string, WorkerCancellation>()
  const regrowing = new Set<string>()
  let inboxBytes: number | null | undefined
  const deaths: Tail = {
    file: join(deps.dir, SPAWN_JOURNAL_FILE),
    offset: 0,
    partial: '',
    at: new Map(),
  }
  const watch = (record: WorkerCancellation): void => {
    if (record.effect === 'cancel_requested') reconciling.set(record.operationId, record)
    else reconciling.delete(record.operationId)
    if (record.effect === 'cancelled' && abortIssuedAt.has(record.operationId))
      regrowing.add(record.operationId)
    else regrowing.delete(record.operationId)
  }

  const write = (record: WorkerCancellation): void => {
    writeWorkerCancellation(deps.dir, record)
    tracked.set(record.operationId, record)
    watch(record)
  }

  const owned = (ref: string): boolean => {
    if (isDirectChildNodeId(deps, ref)) return true
    if (deps.controlScope !== 'run') return false
    return !ref.startsWith(`${deps.ownerId}:`) && ref !== deps.ownerId
  }

  const deliveredTerminal = (id: string): 'down' | 'done' | undefined => {
    const row = deps.coord.settled().find((w) => w.id === id)
    if (row !== undefined) return row.status
    const node = deps.scope.view.nodes.find((n) => n.id === id)
    if (node === undefined) return undefined
    if (node.status === 'done') return 'done'
    if (node.status === 'failed' || node.status === 'cancelled') return 'down'
    return undefined
  }

  const apply = (request: WorkerCancelRequest): void => {
    const aborted = deps.coord.abortWorker(request.worker, request.reason ?? 'cancel requested')
    const base = {
      operationId: request.operationId,
      worker: request.worker,
      requestedAt: request.at,
      observedAt: iso(),
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    }
    if (aborted !== undefined) {
      abortIssuedAt.set(request.operationId, base.observedAt)
      write({
        ...base,
        effect: 'cancel_requested',
        workerId: aborted.id,
        detail: `abort issued to live worker '${aborted.label}' (${aborted.id}); termination not yet proven`,
        terminated: [],
      })
      return
    }
    // Nothing matched stays pending, so a worker that appears later can still be cancelled.
    const settledNode = deps.scope.view.nodes.find(
      (n) =>
        (n.id === request.worker || n.label === request.worker) && isTerminalNodeStatus(n.status),
    )
    const goneId = settledNode?.id ?? deps.coord.settled().find((w) => w.id === request.worker)?.id
    if (goneId !== undefined) {
      write({
        ...base,
        effect: 'not_live',
        workerId: goneId,
        detail: `worker '${goneId}' had already settled before this operation was applied`,
        terminated: [],
      })
    }
  }

  /** Grows only: the worker, the record's ids, and subtree deaths at or after the abort. */
  const provenTerminated = (record: WorkerCancellation, workerId: string): string[] => {
    const since = abortIssuedAt.get(record.operationId) ?? record.observedAt
    const ids = new Set<string>([
      ...record.terminated,
      workerId,
      ...descendantsSince(deaths, workerId, since),
    ])
    return [...ids].sort()
  }

  const reconcile = (record: WorkerCancellation): void => {
    const workerId = record.workerId
    if (workerId === undefined) return
    const terminal = deliveredTerminal(workerId)
    if (terminal === undefined) return
    if (terminal === 'down') {
      write({
        ...record,
        effect: 'cancelled',
        observedAt: iso(),
        terminated: provenTerminated(record, workerId),
        detail: `worker '${workerId}' reached a terminal down state on the settle path`,
      })
      return
    }
    write({
      ...record,
      effect: 'not_live',
      observedAt: iso(),
      terminated: [],
      detail: `worker '${workerId}' settled done despite the abort request; nothing was terminated`,
    })
  }

  const regrow = (record: WorkerCancellation): void => {
    const workerId = record.workerId
    if (workerId === undefined || !abortIssuedAt.has(record.operationId)) return
    const terminated = provenTerminated(record, workerId)
    if (terminated.length > record.terminated.length) {
      write({ ...record, observedAt: iso(), terminated })
    }
  }

  const passRun = (): void => {
    if (deps.controlScope !== 'run' || deps.abortRun === undefined) return
    if (runTracked !== undefined) return
    runTracked = applyRunCancellation(deps.dir, deps.abortRun, iso)
  }

  const ingest = (): void => {
    const file = workerCancelRequestsFile(deps.dir)
    let size: number | null
    try {
      size = statSync(file).size
    } catch {
      size = null
    }
    if (size === inboxBytes) return
    inboxBytes = size
    for (const request of readWorkerCancelRequests(deps.dir)) {
      if (
        !owned(request.worker) ||
        tracked.has(request.operationId) ||
        waiting.has(request.operationId)
      )
        continue
      const record = readWorkerCancellation(deps.dir, request.operationId)
      if (record === undefined) waiting.set(request.operationId, request)
      else {
        tracked.set(record.operationId, record)
        watch(record)
      }
    }
  }

  const pass = (phase: 'turn' | 'boundary' | 'final'): void => {
    if (phase === 'turn') passRun()
    ingest()
    const pending = [...reconciling.values()]
    if (phase === 'turn') {
      for (const request of [...waiting.values()]) {
        waiting.delete(request.operationId)
        apply(request)
        if (!tracked.has(request.operationId)) waiting.set(request.operationId, request)
      }
    }
    const grew = indexDeaths(deaths)
    for (const record of pending) {
      const current = tracked.get(record.operationId)
      if (current?.effect === 'cancel_requested') reconcile(current)
    }
    if (!grew) return
    for (const id of [...regrowing]) {
      const record = tracked.get(id)
      if (record !== undefined) regrow(record)
    }
  }

  return {
    pass,
    finish(): void {
      const runRequest =
        deps.controlScope === 'run' && deps.abortRun !== undefined
          ? readRunCancelRequest(deps.dir)
          : undefined
      if (
        runRequest !== undefined &&
        readRunCancellation(deps.dir, runRequest.operationId) === undefined
      ) {
        writeRunCancellation(deps.dir, {
          operationId: runRequest.operationId,
          effect: 'not_live',
          requestedAt: runRequest.at,
          observedAt: iso(),
          ...(runRequest.reason === undefined ? {} : { reason: runRequest.reason }),
          ...(runRequest.operator === undefined ? {} : { operator: runRequest.operator }),
          detail: 'run ended before the request was applied',
        })
      }
      for (const request of readWorkerCancelRequests(deps.dir)) {
        if (!owned(request.worker)) continue
        const record =
          tracked.get(request.operationId) ?? readWorkerCancellation(deps.dir, request.operationId)
        if (record === undefined) {
          write({
            operationId: request.operationId,
            worker: request.worker,
            effect: 'not_live',
            requestedAt: request.at,
            observedAt: iso(),
            ...(request.reason === undefined ? {} : { reason: request.reason }),
            detail: 'run ended before the request was applied',
            terminated: [],
          })
          continue
        }
        if (record.effect === 'cancel_requested') {
          // Abort went out. The run ended before termination was proven, so this is not success.
          write({
            ...record,
            effect: 'unknown',
            observedAt: iso(),
            detail: 'abort issued; run ended before termination was observed',
          })
        }
      }
    },
  }
}

function isDirectChildNodeId(owner: { readonly ownerId: string }, ref: string): boolean {
  return ref.startsWith(`${owner.ownerId}:s`) && /^s\d+$/.test(ref.slice(owner.ownerId.length + 1))
}
