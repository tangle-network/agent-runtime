import type {
  AgentInteractiveSession,
  AgentInteractiveSessionRef,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  RetainedInteractiveAdmission,
  RetainedInteractiveEnvironmentAdmission,
  RetainedInteractiveIntentAdmission,
} from './retained-run-types'

/** Environment and exact AgentProfile used to start one native coding-agent process. @stable */
export type RetainedInteractiveEnvironmentInput = Omit<
  CreateAgentEnvironmentInput,
  'idempotencyKey' | 'profile' | 'signal'
> & {
  readonly idempotencyKey: string
  readonly profile: AgentProfile
}

/** Material used to create and start one native coding-agent TUI. @stable */
export interface RetainedInteractiveStartMaterial {
  readonly environment: RetainedInteractiveEnvironmentInput
  readonly interactiveIdempotencyKey: string
  readonly initialPrompt?: string
  readonly cwd?: string
  readonly cols?: number
  readonly rows?: number
}

/** Start one retry-safe native coding-agent TUI in a new environment. @stable */
export interface StartRetainedInteractiveRunOptions extends RetainedInteractiveStartMaterial {
  readonly provider: AgentEnvironmentProvider
  /** A previously persisted intent used to replay the exact create operation. */
  readonly intent?: RetainedInteractiveIntentAdmission
  readonly onAdmission: RetainedInteractiveAdmissionHook
  readonly signal?: AbortSignal
}

/** Persist each exact interactive record before the runtime proceeds. @stable */
export type RetainedInteractiveAdmissionHook = (
  admission: RetainedInteractiveAdmission,
) => Promise<void>

/** Reconstruct one exact provider-owned native coding-agent process. @stable */
export interface ReconnectRetainedInteractiveRunOptions {
  readonly provider: AgentEnvironmentProvider
  readonly ref: AgentInteractiveSessionRef
  readonly signal?: AbortSignal
}

/** Recover a start after a pre-create crash or a lost provider response. @stable */
export interface RecoverRetainedInteractiveRunOptions {
  readonly provider: AgentEnvironmentProvider
  readonly admission: RetainedInteractiveIntentAdmission | RetainedInteractiveEnvironmentAdmission
  /** Required when recovering from an intent before an environment existed. */
  readonly replay?: RetainedInteractiveStartMaterial
  readonly onAdmission: RetainedInteractiveAdmissionHook
  readonly signal?: AbortSignal
}

/** Exact interactive process controls plus measured environment capabilities. @stable */
export interface RetainedInteractiveRunHandle extends AgentInteractiveSession {
  readonly capabilities: AgentEnvironmentCapabilities
  sendPrompt(prompt: string, options?: { signal?: AbortSignal }): Promise<void>
}
