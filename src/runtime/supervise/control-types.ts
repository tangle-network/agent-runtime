import type { TreeView } from './types'

/** Terminal and live states observable through supervisor control. @stable */
export type SupervisorControlStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown'

/** Runtime-owned supervisor snapshot. @stable */
export interface SupervisorControlSnapshot {
  readonly version: 1
  readonly runId: string
  readonly revision: number
  readonly status: SupervisorControlStatus
  readonly observedAt: string
  readonly tree: TreeView
}

/** Stable target of one control operation. @stable */
export type SupervisorControlTarget =
  | { readonly kind: 'supervisor'; readonly runId: string }
  | { readonly kind: 'worker'; readonly runId: string; readonly workerId: string }

/** Acknowledged control effect. @stable */
export type SupervisorControlEffect =
  | 'delivered'
  | 'cancel_requested'
  | 'cancelled'
  | 'not_live'
  | 'unknown'

/** Durable result of one steer or cancel operation. @stable */
export interface SupervisorControlAcknowledgement {
  readonly operationId: string
  readonly commandDigest: string
  readonly target: SupervisorControlTarget
  readonly status: 'accepted' | 'rejected' | 'conflict' | 'unknown'
  readonly effect: SupervisorControlEffect
  readonly acknowledgedAt: string
  readonly snapshotRevision?: number
  readonly message?: string
}

/** Stable identity and payload passed to the live effect boundary. @stable */
export interface SupervisorControlEffectRequest {
  readonly operationId: string
  readonly commandDigest: string
  readonly source: string
  readonly target: SupervisorControlTarget
  readonly kind: 'steer' | 'cancel'
  readonly message?: unknown
  readonly reason?: string
}

/** Result returned by the live effect boundary. @stable */
export interface SupervisorControlEffectResult {
  readonly status: 'accepted' | 'rejected' | 'unknown'
  readonly effect: SupervisorControlEffect
  readonly message?: string
}

/** Idempotent boundary for applying one supervisor control effect. @stable */
export type SupervisorControlEffectReceiver = (
  request: SupervisorControlEffectRequest,
) => SupervisorControlEffectResult

/** Input for a typed worker steer. @stable */
export interface SupervisorSteerInput {
  readonly operationId: string
  readonly workerId: string
  readonly message: unknown
  readonly source?: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** Input for a typed worker or root cancellation. @stable */
export interface SupervisorCancelInput {
  readonly operationId: string
  readonly workerId?: string
  readonly reason?: string
  readonly source?: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** Options for watching snapshot revisions. @stable */
export interface SupervisorWatchOptions {
  readonly afterRevision?: number
  readonly pollMs?: number
  readonly signal?: AbortSignal
}

/** One watch/steer/cancel contract for in-process and reconnectable clients. @stable */
export interface SupervisorControlClient {
  readonly runId: string
  snapshot(): Promise<SupervisorControlSnapshot | null>
  watch(options?: SupervisorWatchOptions): AsyncIterable<SupervisorControlSnapshot>
  steer(input: SupervisorSteerInput): Promise<SupervisorControlAcknowledgement>
  cancel(input: SupervisorCancelInput): Promise<SupervisorControlAcknowledgement>
}

/** Options for a reconnectable control client. The capability is supplied out of band. @stable */
export interface SupervisorControlClientOptions {
  readonly runId?: string
  readonly pollMs?: number
  readonly timeoutMs?: number
  readonly now?: () => number
  /** Per-run secret capability returned by the owning route. */
  readonly capabilityToken?: string
}

export type SupervisorControlCommand =
  | {
      readonly kind: 'steer'
      readonly operationId: string
      readonly commandDigest: string
      readonly issuedAt: string
      readonly source: string
      readonly target: Extract<SupervisorControlTarget, { kind: 'worker' }>
      readonly message: unknown
    }
  | {
      readonly kind: 'cancel'
      readonly operationId: string
      readonly commandDigest: string
      readonly issuedAt: string
      readonly source: string
      readonly target: SupervisorControlTarget
      readonly reason?: string
    }

export interface SupervisorControlCommandWire {
  readonly version: 1
  readonly kind: 'steer' | 'cancel'
  readonly operationId: string
  readonly commandDigest: string
  readonly issuedAt: string
  readonly source: string
  readonly target: SupervisorControlTarget
  readonly payload: string
  readonly authorization: string
}

export interface SupervisorControlEffectRecord {
  readonly version: 1
  readonly operationId: string
  readonly commandDigest: string
  readonly status: 'started' | 'completed' | 'unknown'
  readonly acknowledgement?: SupervisorControlAcknowledgement
}

/** Files used by the reconnectable route. @stable */
export interface SupervisorControlFiles {
  readonly directory: string
  readonly owner: string
  readonly capability: string
  readonly commands: string
  readonly acknowledgements: string
  readonly effects: string
  readonly snapshot: string
}

/** Live callbacks consumed by the durable command reader. @stable */
export interface SupervisorControlRouteOptions {
  readonly runDir: string
  readonly runId: string
  /**
   * Secret returned by the first route owner and supplied again after a process restart.
   * Runtime persists only its digest; the application is responsible for protected storage.
   */
  readonly capabilityToken?: string
  readonly snapshot: () => TreeView
  readonly effectReceiver?: SupervisorControlEffectReceiver
  readonly steer?: (workerId: string, message: unknown) => boolean
  readonly cancelWorker?: (workerId: string, reason?: string) => boolean
  readonly cancelSupervisor?: (reason?: string) => boolean
  readonly pollMs?: number
  readonly now?: () => number
}

/** Running durable route owned by one supervisor process. @stable */
export interface SupervisorControlRoute {
  /** Per-run capability that must be delivered out of band to command clients. */
  readonly capabilityToken: string
  refresh(): void
  /** Rebind a route taken over from a dead supervisor after live ownership is proven. */
  rebind(): void
  close(status: Exclude<SupervisorControlStatus, 'starting' | 'running' | 'unknown'>): void
}
