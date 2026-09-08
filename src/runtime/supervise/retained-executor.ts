import type { AgentProfile } from '@tangle-network/agent-interface'
import type { RetainedRunAdmission, RetainedRunAdmissionHook } from '../retained-run-types'
import type {
  AgentSpec,
  ExecutorContext,
  ExecutorFactory,
  ExecutorResult,
  ProfileMaterializationReceipt,
  SpawnEvent,
} from './types'

/** Scope owns the durable writer; provider executors only publish sanitized admissions. */
export const retainedExecutorSeamKey = 'runtime.retainedExecutor'

export interface RetainedExecutorContext {
  /** Stable across recovery; distinct for deliberate later invocations of one owner. */
  readonly executionId?: string
  readonly admissions: readonly RetainedRunAdmission[]
  readonly onReady?: () => void | Promise<void>
  readonly onAdmission: RetainedRunAdmissionHook
  readonly onResult: (result: ExecutorResult<unknown>) => Promise<void>
}

export function retainedExecutorContext(ctx: ExecutorContext): RetainedExecutorContext | undefined {
  return ctx.seams[retainedExecutorSeamKey] as RetainedExecutorContext | undefined
}

/** Local observation stopped; the retained provider execution has no accepted terminal result. */
export class RetainedExecutionPendingError extends Error {
  constructor(cause: unknown) {
    super('retained provider execution requires reconciliation before replacement', { cause })
    this.name = 'RetainedExecutionPendingError'
  }
}

/** @internal Validated original invocation selected for live adoption by the supervisor. */
export interface RetainedChildRecovery {
  readonly spawned: Extract<SpawnEvent, { kind: 'spawned' }>
  readonly spec: AgentSpec
  readonly task: unknown
  readonly admissions: readonly RetainedRunAdmission[]
  readonly factory: ExecutorFactory<unknown>
  readonly priorMaterialization?: ProfileMaterializationReceipt
}

export interface RetainedExecutorPreparation {
  readonly spawned: Extract<SpawnEvent, { kind: 'spawned' }>
  readonly profile: AgentProfile
  readonly task: unknown
}

type PrepareRetainedExecutor = (input: RetainedExecutorPreparation) =>
  | {
      spec: AgentSpec
      factory: ExecutorFactory<unknown>
    }
  | undefined

const retainedPreparations = new WeakMap<ExecutorFactory<unknown>, PrepareRetainedExecutor>()

/** Reconstruct an admitted manager through its original composition boundary. @internal */
export function registerRetainedExecutorPreparation(
  factory: ExecutorFactory<unknown>,
  prepare: PrepareRetainedExecutor,
): ExecutorFactory<unknown> {
  retainedPreparations.set(factory, prepare)
  return factory
}

export function prepareRetainedExecutor(
  factory: ExecutorFactory<unknown>,
  input: RetainedExecutorPreparation,
) {
  return retainedPreparations.get(factory)?.(input)
}
