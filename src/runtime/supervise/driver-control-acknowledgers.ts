import { readFileSync } from 'node:fs'
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
  writeWorkerCancellation,
  writeWorkerSteerAcknowledgement,
} from './run-layout'
import type { Scope } from './types'

/** The journal file `createFileRunContext` writes inside the run directory. The acknowledger
 *  reads it as EVIDENCE for the terminated-descendants set — the nested trees of a cancelled
 *  lead journal their terminal records there before the lead settles into this scope. */
const SPAWN_JOURNAL_FILE = 'spawn-journal.jsonl'

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
  /** This manager's own node id (`scope.view.root`) — the parent every owned node id hangs off. */
  readonly ownerId: string
  /** `'run'` also owns label/profile-name references (the tree root's role); `'subtree'` owns
   *  exact direct-child node ids only. See `DriverAgentOptions.controlScope`. */
  readonly controlScope: 'run' | 'subtree'
  /** Abort the WHOLE run through the one cascade controller it already has. Present only on the
   *  `'run'`-scoped manager, and only when the caller wired a root control; without it a
   *  run-scoped cancel request is not this manager's to apply. */
  readonly abortRun?: (reason: string, request?: RunCancelRequest) => void
}

/** An operator steer handed to the run root's inbox. The root answers `receipt` once: when a model
 *  turn consumes the steer, or when the root stops without reading it. */
export interface RootSteer {
  readonly steer: string
  readonly interrupt: boolean
  readonly messageId: string
  readonly receipt: (receipt: InboxReceipt) => void
}

interface SteerAcknowledgerDeps {
  /** Present only on the run root; nested managers must not claim their parent's child steer. */
  readonly deliverRoot?: (message: RootSteer) => boolean
  /** Root delivery is not claimable until the current harness invocation exposes its inbox. */
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
  /** Stops admission between requests when an external manager's lifetime ends. */
  readonly signal?: AbortSignal
}

/**
 * Apply externally admitted steers once through the owning manager's control path.
 *
 * The `unknown` acknowledgement lands before authorization or delivery. A crash after that write
 * can lose this steer, but a restarted manager never delivers it again. This is the same
 * at-most-once crash boundary as coordination instruction receipts: no duplicate instruction is
 * safer than replaying a mutation whose first delivery may already have succeeded.
 */
export function createSteerAcknowledger(deps: SteerAcknowledgerDeps): {
  /** `'turn'` = a live control pass (claims and delivers every owned request); `'boundary'` = a
   *  native turn-end drain, which admits only a steer addressed to the root's own inbox — the
   *  destination still live between turns — and never awaits a worker delivery; `'final'` = the
   *  close pass, which expires everything still pending as `not_live`. */
  pass(phase: 'turn' | 'boundary' | 'final'): Promise<void>
} {
  const iso = () => new Date(deps.now()).toISOString()
  // Root steers this process queued and the root has not yet answered, by operation id.
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

  return {
    async pass(phase): Promise<void> {
      for (const request of readWorkerSteerRequests(deps.dir)) {
        if (phase === 'turn' && deps.signal?.aborted) return
        const rootRequest = request.worker === deps.ownerId && deps.deliverRoot !== undefined
        // A boundary pass leaves worker-addressed steers to the live timer (run continues) or to
        // close's `not_live` expiry (run ended): delivering one here could reach a worker whose
        // execution already finished but whose settlement has not been delivered yet.
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
          // A queued root steer stays `unknown` until the root answers its receipt.
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
    },
  }
}

/**
 * The OPERATOR-facing sentence for a steer outcome, written into the durable acknowledgement file.
 *
 * Deliberately separate from `downMessageRefusalReasons`, which is the MANAGER-facing sentence: one
 * says what happened for someone reading the run afterwards, the other tells a model what to do
 * next, and merging them would make one audience read the other's copy. They must nonetheless cover
 * the SAME outcomes, so `tests/kernel/refusal-reasons.test.ts` holds both maps total over
 * `DownMessageDeliveryOutcome` — a new code cannot land in only one.
 */
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

/**
 * The worker-cancel ACKNOWLEDGER — the runtime-side half of `run-layout`'s `cancelWorker`
 * contract. Router managers check between turns; native managers observe throughout their invocation.
 * Every manager with a `controlDir` mounts one;
 * OWNERSHIP keeps them from colliding: a request naming a node id is owned by the manager whose
 * own id is that node's parent, and a label/profile-name reference is owned by the `'run'`-scoped
 * (root) manager only — so exactly one acknowledger can ever apply one operation.
 *
 * Two-phase, honestly reported: `cancel_requested` is written the moment a live worker's abort is
 * issued (through the per-child abort chain the scope already owns, so siblings are untouched);
 * `cancelled` is written only when that worker's settlement is DELIVERED on the settle path with
 * a terminal `down`, and then the record names every subtree node id proven terminated. A worker
 * that already settled — or that settles `done` despite the abort — records `not_live`; a
 * reference matching nothing this manager owns stays pending (`cancelWorker` reports it
 * `unknown`). No path reports success for a missing worker.
 *
 * Expiry is run end, not a clock: `finish()` (after the final post-drain pass) writes `not_live`
 * for every owned request never applied and `unknown` for an issued abort whose settle the run
 * ended too soon to observe. A pending request can therefore never outlive its run and abort a
 * future spawn that happens to reuse a label.
 *
 * Idempotency is a lookup, in-process and across processes: an operation with a durable
 * acknowledgement is returned as-is and never re-applied.
 */
export function createCancelAcknowledger(deps: CancelAcknowledgerDeps): {
  /** `'turn'` = a live manager control pass (the only phase that APPLIES a request); `'boundary'`
   *  = a native turn-end drain, which only reconciles records already written — a request first
   *  seen at a boundary is never applied there, so a worker that already finished keeps its
   *  result and the request expires `not_live` at close; `'final'` = the post-drain pass, which
   *  also only reconciles. */
  pass(phase: 'turn' | 'boundary' | 'final'): void
  finish(): void
} {
  const tracked = new Map<string, WorkerCancellation>()
  // The run-scoped operation this manager has already applied, so its abort is issued once.
  let runTracked: RunCancellation | undefined
  // The abort-issue instant per operation (the `observedAt` written on its `cancel_requested`
  // record) — the terminated-set window survives the record moving to `cancelled`.
  const abortIssuedAt = new Map<string, string>()
  const iso = () => new Date(deps.now()).toISOString()

  const write = (record: WorkerCancellation): void => {
    writeWorkerCancellation(deps.dir, record)
    tracked.set(record.operationId, record)
  }

  /** Whether this acknowledger owns `ref`. A node id deeper in this subtree belongs to the nested
   *  manager that parents it; anything that is not a node id under this manager is a
   *  label/profile-name reference, owned by the `'run'`-scoped manager alone. */
  const owned = (ref: string): boolean => {
    if (isDirectChildNodeId(deps, ref)) return true
    if (deps.controlScope !== 'run') return false
    return !ref.startsWith(`${deps.ownerId}:`) && ref !== deps.ownerId
  }

  // Terminal knowledge of one node, visible only once its settlement was DELIVERED (the ledger
  // row, or the view status `finalizeSettlement` stamps on the pull). 'down' = it died.
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
    // Not live. A reference that matches a node whose settlement was already delivered is
    // answered `not_live`; a reference matching nothing stays pending — never a success either
    // way, and a worker that appears later can still be cancelled by a later pass.
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

  /** The proven-terminated set for one record: the worker plus every subtree id with a terminal
   *  journal record at/after the abort was issued. Union with what the record already names, so
   *  the set only ever grows (a late teardown journal adds; nothing removes). */
  const provenTerminated = (record: WorkerCancellation, workerId: string): string[] => {
    const since = abortIssuedAt.get(record.operationId) ?? record.observedAt
    const ids = new Set<string>([
      ...record.terminated,
      workerId,
      ...terminatedDescendants(deps.dir, workerId, since),
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
    // The worker finished `done` despite the abort request — its result stands, so this
    // operation terminated nothing and must not read as a successful cancellation.
    write({
      ...record,
      effect: 'not_live',
      observedAt: iso(),
      terminated: [],
      detail: `worker '${workerId}' settled done despite the abort request; nothing was terminated`,
    })
  }

  /** Re-scan a `cancelled` record while the manager still turns: a descendant whose teardown
   *  journals after the lead's settle joins the set on a later pass instead of being lost. Only
   *  a grown set is re-written; the window needs the in-process abort instant, so a record a
   *  PRIOR process closed stays as that process proved it. */
  const regrow = (record: WorkerCancellation): void => {
    const workerId = record.workerId
    if (workerId === undefined || !abortIssuedAt.has(record.operationId)) return
    const terminated = provenTerminated(record, workerId)
    if (terminated.length > record.terminated.length) {
      write({ ...record, observedAt: iso(), terminated })
    }
  }

  /**
   * The RUN-scoped request: seen once, `cancel_requested` written the moment the run's cascading
   * abort is issued through the one controller the run already has. The `supervise()` settle path
   * records what the run then actually did — this manager cannot observe its own tree's terminal
   * state from inside `act`.
   *
   * Applied only at a TURN boundary, never on the final post-drain pass: by then the driver has
   * finished and drained, so a root abort could only void work that is already delivered. A
   * request that arrives that late expires in `finish()` instead — it terminated nothing.
   */
  const passRun = (): void => {
    if (deps.controlScope !== 'run' || deps.abortRun === undefined) return
    if (runTracked !== undefined) return
    runTracked = applyRunCancellation(deps.dir, deps.abortRun, iso)
  }

  const pass = (phase: 'turn' | 'boundary' | 'final'): void => {
    if (phase === 'turn') passRun()
    for (const request of readWorkerCancelRequests(deps.dir)) {
      if (!owned(request.worker)) continue
      let record = tracked.get(request.operationId)
      if (record === undefined) {
        // Cross-process idempotency: an acknowledgement a prior process wrote wins over
        // re-applying the operation.
        record = readWorkerCancellation(deps.dir, request.operationId)
        if (record !== undefined) tracked.set(request.operationId, record)
      }
      if (record === undefined) {
        if (phase === 'turn') apply(request)
        continue
      }
      if (record.effect === 'cancel_requested') reconcile(record)
      else if (record.effect === 'cancelled') regrow(record)
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
        // The request landed after the last turn boundary. The run is over, so it terminated
        // nothing — recording it here keeps a reader from seeing an operation that never resolves.
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
          // Never applied and the run is over: the request expires as `not_live` so it cannot
          // linger and abort a future spawn that matches by label — and never reads as success.
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
          // The abort went out but act is returning before the settle path could prove the
          // termination. `unknown` is the honest terminal: not in progress, never a success.
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

/**
 * Subtree node ids with a terminal `down`/`cancelled` journal record at or after `sinceIso` —
 * the abort-issue instant (the acknowledger's own `observedAt` on the `cancel_requested` record,
 * runtime clock), never the client's `requestedAt` — read from the durable spawn journal beside
 * the run layout. The set is proven at acknowledgement time and is approximate about post-abort
 * causation: a descendant that died of its OWN cause after the abort was issued is
 * indistinguishable from the cascade and may be included; one whose teardown journals late joins
 * on a later acknowledger pass; a teardown journal still absent when the run ends is absent from
 * the set. Ids are hierarchical (`parent:sN`), so `${nodeId}:` prefixes exactly the subtree.
 * Tolerant of a missing or partially-written journal: evidence that cannot be read names fewer
 * nodes, never wrong ones.
 */
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
    try {
      for (const event of spawnJournalRecordEvents(JSON.parse(trimmed))) {
        if (event === undefined) continue
        const died =
          (event.kind === 'settled' && event.status === 'down') || event.kind === 'cancelled'
        if (!died) continue
        if (typeof event.id !== 'string' || !event.id.startsWith(prefix)) continue
        if (typeof event.at !== 'string' || event.at < sinceIso) continue
        ids.add(event.id)
      }
    } catch {}
  }
  return [...ids].sort()
}

/** A direct child has exactly one generated spawn segment below its owner. */
function isDirectChildNodeId(owner: { readonly ownerId: string }, ref: string): boolean {
  return ref.startsWith(`${owner.ownerId}:s`) && /^s\d+$/.test(ref.slice(owner.ownerId.length + 1))
}
