import type { NodeExecutionIdentity } from '../../runtime'

/**
 * Why one parent→child delivery did not land, in the words the MANAGER needs.
 *
 * `DownMessageDeliveryOutcome` is the machine code; this is the sentence beside it. A code alone
 * left the manager to guess whether to retry, spawn, or give up — `already-settled` and
 * `scope-stopped` look alike and need opposite moves. Every refusal a coordination verb returns
 * carries a sentence like these, because the manager cannot see the state that produced it.
 */
export const downMessageRefusalReasons: Readonly<Record<DownMessageDeliveryOutcome, string>> =
  Object.freeze({
    delivered: 'the message reached the worker',
    'unknown-worker':
      'no worker of this manager has that id — check observe_agent for the live ids',
    'already-settled':
      'that worker already settled, so nothing can reach it — spawn a fresh worker for the follow-up work',
    'runtime-has-no-inbox':
      'that worker runs on an executor with no inbox, so it can never receive a message — re-spawn it on a steerable executor if it must be corrected mid-run',
    'scope-stopped': 'this manager’s scope has stopped, so no further message may be sent from it',
    'runtime-error':
      'the executor threw while accepting the message; the worker may or may not have received it',
  })

/** How a spawn CONTINUES a node's prior work: `'fresh'` starts a brand-new session (the default,
 *  and the only pre-continuity behavior); `'resume'` re-attaches to the node's most recent
 *  SETTLED worker — a NEW live worker is spawned whose spawn context carries the prior worker's
 *  identity ({@link WorkerResumeContext}), and the executor seam owns the actual session
 *  re-attachment. */
export type ContinuityMode = 'fresh' | 'resume'

/** The resume lineage a `'resume'` spawn hands the executor seam
 *  ({@link WorkerSpawnContext.resume}). The kernel owns identity, ordering, ledger truth, and
 *  spend continuity (the resumed worker reserves from the same conserved pool); the seam owns the
 *  re-attachment itself — e.g. mapping `ofWorker` to a backend session id. */
export interface WorkerResumeContext {
  /** The prior SETTLED worker whose session the new worker continues. */
  readonly ofWorker: string
  /** 1-based position of the NEW worker in the node's continuity chain: a node spawned once and
   *  resumed once hands the resumed worker `sequence: 2`. */
  readonly sequence: number
}

/** The exact result of one parent→child delivery attempt. */
export type DownMessageDeliveryOutcome =
  | 'delivered'
  | 'unknown-worker'
  | 'already-settled'
  | 'runtime-has-no-inbox'
  | 'scope-stopped'
  | 'runtime-error'

/** A durable marker written after authorization and immediately before Runtime calls `Scope.send`.
 * If a process dies with this marker but no matching outcome, delivery is unknown and is never
 * replayed automatically. */
export interface DownMessageDeliveryAttempt {
  readonly receiptId: string
  readonly kind: 'steer' | 'answer'
  readonly toWorker: string
  readonly instructionDigest: string
  readonly interrupt: boolean
  readonly questionId?: string
}

/** A parent→child delivery result (the down-leg): recorded for observability, never pulled back by
 * the parent. `receiptId` and `instructionDigest` link it to the pre-delivery authorization receipt
 * and attempt marker. */
export interface DownMessageEvent {
  readonly receiptId: string
  readonly toWorker: string
  readonly instruction: string
  readonly instructionDigest: string
  readonly delivered: boolean
  readonly outcome: DownMessageDeliveryOutcome
  readonly error?: string
}

/** Durable authorization receipt written before a continuation reaches a worker. */
export interface ContinuationInstruction {
  readonly receiptId: string
  readonly kind: 'steer' | 'answer'
  readonly toWorker: string
  readonly instruction: string
  readonly instructionDigest: string
  readonly workerIdentity?: NodeExecutionIdentity
  readonly interrupt: boolean
  readonly questionId?: string
}

/** Detached continuation bytes and exact worker identity presented to product authorization before
 * Runtime records or delivers a steer/answer. */
export interface DownMessageAuthorizationInput {
  readonly kind: 'steer' | 'answer'
  readonly workerId: string
  readonly workerIdentity: NodeExecutionIdentity
  readonly instruction: string
  readonly interrupt: boolean
  readonly questionId?: string
}

/** Product-authorized continuation bytes. Returning a narrowed instruction replaces the proposed
 * bytes; throwing refuses delivery. */
export interface AuthorizedDownMessage {
  readonly instruction: string
}

/** Product decision over an exact continuation before it is durably recorded or delivered. */
export type AuthorizeDownMessage = (input: DownMessageAuthorizationInput) => AuthorizedDownMessage
