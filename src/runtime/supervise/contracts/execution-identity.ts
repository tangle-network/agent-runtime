import type { AgentProfile, Sha256Digest } from '@tangle-network/agent-interface'
import type { Runtime } from './executor-port'
import type { NodeId } from './node-lifecycle'

/** Caller-owned identity beyond the exact profile/task bytes Scope can compute itself. */
export interface AgentExecutionRef {
  readonly candidateDigest?: Sha256Digest
  readonly correlation?: Readonly<Record<string, string>>
}

/** Durable identity of one realized node. Missing digests mean the input was not canonical JSON. */
export interface NodeExecutionIdentity extends AgentExecutionRef {
  readonly profileDigest?: Sha256Digest
  readonly taskDigest?: Sha256Digest
}

/** A named model carried into an execution, or an explicit reason the exact model is unknowable. */
export type MaterializedModelIdentity =
  | { readonly status: 'known'; readonly id: string }
  | { readonly status: 'unknown'; readonly reason: string }

/** External execution identity that operators can use to join this node to its backend. */
export interface MaterializedExecutionIdentity {
  /** Backend-native identity kind, for example `request`, `session`, `run`, `process`, or `tree`. */
  readonly kind: string
  readonly id: string
}

/**
 * Data-only declaration from trusted executor code about the exact sealed plan `execute` uses.
 * Scope snapshots this value and computes the durable receipt; callers never provide digests.
 */
export interface ExecutorMaterialization {
  /** Complete profile the provider actually receives after Runtime consumes its own declarations. */
  readonly effectiveProfile: AgentProfile
  /** Canonical profile admitted by Runtime when it differs from the provider-visible profile.
   *  Its digest must equal the kernel-owned authored profile digest for the node. */
  readonly authoredProfile?: AgentProfile
  /** Concrete backend or harness selected for this run. */
  readonly backend: string
  /** Exact selected model, or an explicit unknown reason. */
  readonly model: MaterializedModelIdentity
  /** Backend-native session/run/request/process identity. */
  readonly execution: MaterializedExecutionIdentity
  /** Named implementation that turns the effective profile into executable backend inputs. */
  readonly materializer: string
  /** Finite JSON describing the exact materialization plan. Persisted by digest only. */
  readonly plan: unknown
  /** Trusted runtime-only attachments, such as the coordination MCP. Persisted by digest only. */
  readonly platformAttachments?: unknown
}

/** Volatile execution routing that is true for one attempt but is not profile identity. The full
 * binding is hashed and discarded; only the safe structural descriptor is journaled. */
export interface ExecutorExecutionBinding {
  readonly attemptId: string
  readonly binding: unknown
  readonly descriptor: Readonly<Record<string, string | number | boolean | null>>
}

/** Why exact materialization evidence is unavailable for a node.
 *
 * `executor-receipt-pending` is an IN-FLIGHT value only. It states that a pending executor has
 * declared its plan and has not yet sent the terminal acknowledgement, so the answer can still
 * arrive. A terminal record must never carry it: the attempt is over and no receipt is coming.
 * A terminal attempt that ended before its acknowledgement records
 * `executor-failed-before-receipt` instead, which names the outcome rather than a wait that
 * already finished. */
export type UnknownMaterializationReason =
  | 'executor-did-not-report'
  | 'executor-failed-before-receipt'
  | 'executor-receipt-pending'
  | 'invalid-executor-report'
  | 'root-agent-did-not-report'

/** What the kernel can prove about one node's actual execution plan. */
export type ProfileMaterializationReceipt =
  | {
      readonly status: 'known'
      readonly authoredProfileDigest: Sha256Digest
      readonly effectiveProfileDigest: Sha256Digest
      readonly materializationPlanDigest: Sha256Digest
      readonly platformAttachmentsDigest?: Sha256Digest
      readonly runtime: Runtime
      readonly backend: string
      readonly model: MaterializedModelIdentity
      readonly execution: MaterializedExecutionIdentity
      readonly materializer: string
    }
  | {
      readonly status: 'unknown'
      readonly authoredProfileDigest?: Sha256Digest
      readonly runtime: Runtime
      readonly reason: UnknownMaterializationReason
    }

/** One attempt's immutable link from a stable materialization plan to its actual transport. */
export type ExecutionBindingReceipt =
  | {
      readonly status: 'known'
      readonly attemptId: string
      readonly materializationReceiptDigest: Sha256Digest
      readonly bindingDigest: Sha256Digest
      readonly descriptor: Readonly<Record<string, string | number | boolean | null>>
    }
  | {
      readonly status: 'unknown'
      readonly attemptId: string
      readonly materializationReceiptDigest: Sha256Digest
      readonly reason: UnknownMaterializationReason
      /** The execution Runtime planned and started for this attempt, such as the bridge session
       *  it minted, when the attempt ended before the executor acknowledged it. It names where
       *  the attempt ran; the plan it ran under stays unknown. */
      readonly execution?: MaterializedExecutionIdentity
    }

/** Trusted root composition evidence. Generic `Agent.act` roots omit this and remain unknown. */
export type RootMaterialization =
  | {
      readonly runtime: Runtime
      readonly declaration: ExecutorMaterialization
      readonly binding: Omit<ExecutorExecutionBinding, 'attemptId'>
    }
  | {
      /** The runtime-owned external adapter will publish the exact declaration after its dynamic
       * platform attachment (for example a coordination URL) exists and before paid work starts. */
      readonly runtime: Runtime
      readonly declaration: 'deferred'
      /** Exact admitted profile used to validate the stable effective identity at publication. */
      readonly authoredProfile: AgentProfile
    }

/** Kernel-owned context for the concrete supervised node a factory is constructing. */
export interface ExecutorNodeContext {
  readonly rootId: NodeId
  readonly parentId: NodeId
  readonly nodeId: NodeId
  /** Recursion depth supplied by Runtime scopes (root = 0). Standalone callers may omit it. */
  readonly depth?: number
  /** Kernel-minted identity for this concrete execution attempt. */
  readonly attemptId: string
  readonly identity?: NodeExecutionIdentity
}
