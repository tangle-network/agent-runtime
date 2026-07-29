import {
  type AgentExecutionPreparationReceipt,
  type AgentProfile,
  type AgentProfileActivationEvidence,
  type AgentWorkspaceExecutionBoundLeaseRecord,
  agentProfileSchema,
  agentWorkspaceLeaseRecordSchema,
  type HarnessType,
  type Sha256Digest,
  validateAgentExecutionPreparationReceipt,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import { inheritRuntimeOwnedExecutorAttestation } from './materialization'
import { detachedSnapshot } from './snapshot'
import type { TraceSource } from './trace-source'
import type {
  ExecutionPreparationEvidence,
  Executor,
  ExecutorFactory,
  ExecutorNodeContext,
  ExecutorResult,
  Runtime,
  Spend,
  UsageEvent,
} from './types'

/** Immutable request Runtime gives a private preparation provider after spawn admission. */
export interface RuntimeExecutorPreparationRequest {
  readonly role: 'supervisor' | 'worker'
  readonly requestDigest: Sha256Digest
  /** Product-authorized profile used for durable execution identity. */
  readonly authoredProfile: AgentProfile
  /** Trusted requested profile after platform attachments; the provider returns the exact effective profile. */
  readonly executionProfile: AgentProfile
  readonly task: unknown
  readonly node: ExecutorNodeContext
  readonly signal: AbortSignal
}

/**
 * Public proof plus the private workspace release closure returned by a preparation provider.
 * Runtime constructs the configured executor itself, after it validates this proof, so a
 * preparation provider cannot silently replace the backend selected by the caller.
 */
export interface RuntimePreparedExecutorResult {
  readonly receipt: AgentExecutionPreparationReceipt
  readonly effectiveProfile: AgentProfile
  readonly executionPlanDigest: Sha256Digest
  readonly profileActivation: Pick<AgentProfileActivationEvidence, 'digest'>
  readonly workspaceLease: AgentWorkspaceExecutionBoundLeaseRecord
  /** Release/destroy the private workspace after executor teardown is confirmed. */
  readonly release: () => Promise<void>
}

export type PrepareRuntimeExecutor = (
  request: RuntimeExecutorPreparationRequest,
) => Promise<RuntimePreparedExecutorResult>

export interface CreatePreparedExecutorFactoryOptions<Out> {
  readonly runtime: Runtime
  /** Exact configured backend factory. Runtime calls it only after preparation validates. */
  readonly executorFactory: ExecutorFactory<Out>
  readonly prepare: PrepareRuntimeExecutor
  readonly role?: 'supervisor' | 'worker'
  /** Stable product-authorized profile when `spec.profile` includes trusted runtime attachments. */
  readonly authoredProfile?: AgentProfile
  /** Declare a pre-preparation inbox only when every prepared inner executor supports delivery. */
  readonly acceptsMessages?: boolean
  /** Optional expected receipt identities; omit only when the provider legitimately selects them. */
  readonly backend?: string
  readonly harness?: HarnessType
  readonly harnessVersion?: string
  readonly now?: () => number
}

interface RuntimeOwnedPreparation {
  readonly role: 'supervisor' | 'worker'
  readonly prepare: (
    task: unknown,
    requestDigest: Sha256Digest,
  ) => Promise<ExecutionPreparationEvidence>
}

const runtimeOwnedPreparations = new WeakMap<object, RuntimeOwnedPreparation>()

/** Read the private preparation operation only from a wrapper minted in this module. */
export function runtimeOwnedExecutorPreparation<Out>(
  executor: Executor<Out>,
): RuntimeOwnedPreparation | undefined {
  return runtimeOwnedPreparations.get(executor as object)
}

/**
 * Turn an asynchronous private preparation provider into Runtime's synchronous ExecutorFactory.
 * Scope constructs this inert wrapper only after budget admission, then invokes its private
 * preparation operation, commits the resulting public evidence, and only then calls `execute`.
 */
export function createPreparedExecutorFactory<Out>(
  options: CreatePreparedExecutorFactoryOptions<Out>,
): ExecutorFactory<Out> {
  if (typeof options.runtime !== 'string' || options.runtime.trim().length === 0) {
    throw new ValidationError('createPreparedExecutorFactory: runtime must be a non-empty string')
  }
  if (typeof options.prepare !== 'function') {
    throw new ValidationError('createPreparedExecutorFactory: prepare must be a function')
  }
  if (typeof options.executorFactory !== 'function') {
    throw new ValidationError('createPreparedExecutorFactory: executorFactory must be a function')
  }
  const now = options.now ?? Date.now
  const role = options.role ?? 'worker'
  const fixedAuthoredProfile =
    options.authoredProfile === undefined
      ? undefined
      : detachedSnapshot(
          agentProfileSchema.parse(options.authoredProfile),
          'prepared executor authored profile',
        )

  return (spec, context) => {
    const node = context.node
    if (node === undefined) {
      throw new ValidationError(
        'createPreparedExecutorFactory: prepared executors require a supervised node context',
      )
    }
    const executionProfile = detachedSnapshot(
      agentProfileSchema.parse(spec.profile),
      'prepared executor execution profile',
    )
    const authoredProfile = fixedAuthoredProfile ?? executionProfile
    let inner: Executor<Out> | undefined
    let release: (() => Promise<void>) | undefined
    let preparationPromise: Promise<ExecutionPreparationEvidence> | undefined
    let innerDestroyed = false
    let releaseCompleted = false
    let releaseInFlight: Promise<void> | undefined
    const pendingMessages: unknown[] = []

    const releaseOnce = async (): Promise<void> => {
      if (releaseCompleted || release === undefined) return
      releaseInFlight ??= (async () => {
        try {
          await release?.()
          releaseCompleted = true
        } catch (cause) {
          throw new ValidationError(
            'createPreparedExecutorFactory: private workspace release failed',
            { cause },
          )
        } finally {
          if (!releaseCompleted) releaseInFlight = undefined
        }
      })()
      await releaseInFlight
    }

    const requireInner = (operation: string): Executor<Out> => {
      if (inner === undefined) {
        throw new ValidationError(
          `createPreparedExecutorFactory: ${operation} called before preparation completed`,
        )
      }
      return inner
    }

    const prepare = (
      task: unknown,
      requestDigest: Sha256Digest,
    ): Promise<ExecutionPreparationEvidence> => {
      preparationPromise ??= (async () => {
        let result: RuntimePreparedExecutorResult | undefined
        try {
          const requestData = detachedSnapshot(
            { role, requestDigest, authoredProfile, executionProfile, task, node },
            'prepared executor request',
          )
          result = await options.prepare(Object.freeze({ ...requestData, signal: context.signal }))
          if (typeof result !== 'object' || result === null || Array.isArray(result)) {
            throw new ValidationError(
              'createPreparedExecutorFactory: preparation provider returned no result object',
            )
          }
          if (typeof result.release !== 'function') {
            throw new ValidationError(
              'createPreparedExecutorFactory: preparation result needs a release function',
            )
          }
          release = result.release
          const effectiveProfile = agentProfileSchema.parse(result.effectiveProfile)
          const parsedLease = agentWorkspaceLeaseRecordSchema.parse(result.workspaceLease)
          if (parsedLease.phase !== 'execution-bound') {
            throw new ValidationError(
              'createPreparedExecutorFactory: workspace lease must be execution-bound',
            )
          }
          const validation = validateAgentExecutionPreparationReceipt({
            receipt: result.receipt,
            requestDigest,
            authoredProfile,
            effectiveProfile,
            executionPlanDigest: result.executionPlanDigest,
            profileActivation: result.profileActivation,
            workspaceLease: parsedLease,
            nowMs: now(),
            ...(options.backend === undefined ? {} : { backend: options.backend }),
            ...(options.harness === undefined ? {} : { harness: options.harness }),
            ...(options.harnessVersion === undefined
              ? {}
              : { harnessVersion: options.harnessVersion }),
          })
          if (!validation.ok) {
            throw new ValidationError(
              `createPreparedExecutorFactory: invalid execution preparation: ${validation.issues
                .map((issue) => `${issue.code}: ${issue.message}`)
                .join('; ')}`,
            )
          }
          const built = options.executorFactory({ ...spec, profile: effectiveProfile }, context)
          if (typeof built !== 'object' || built === null) {
            throw new ValidationError(
              'createPreparedExecutorFactory: executorFactory returned no executor object',
            )
          }
          if (
            typeof built.execute !== 'function' ||
            typeof built.teardown !== 'function' ||
            typeof built.resultArtifact !== 'function'
          ) {
            throw new ValidationError(
              'createPreparedExecutorFactory: executorFactory returned an incomplete executor',
            )
          }
          // Transfer cleanup ownership before validating the built executor. Any later refusal
          // reaches wrapper.teardown, which closes the executor before releasing its workspace.
          inner = built
          if (built.runtime !== options.runtime) {
            throw new ValidationError(
              `createPreparedExecutorFactory: prepared runtime ${JSON.stringify(built.runtime)} does not match ${JSON.stringify(options.runtime)}`,
            )
          }
          if (options.acceptsMessages && typeof built.deliver !== 'function') {
            throw new ValidationError(
              'createPreparedExecutorFactory: acceptsMessages requires a prepared executor inbox',
            )
          }
          inheritRuntimeOwnedExecutorAttestation(built, wrapper)
          for (const message of pendingMessages.splice(0)) {
            if (built.deliver?.(message) === false) {
              throw new ValidationError(
                'createPreparedExecutorFactory: prepared executor refused a queued message',
              )
            }
          }
          return detachedSnapshot(
            {
              attemptId: node.attemptId,
              role,
              receipt: validation.receipt,
              workspaceLease: parsedLease,
            },
            'prepared executor evidence',
          )
        } catch (error) {
          if (release === undefined && typeof result?.release === 'function')
            release = result.release
          if (inner === undefined) {
            try {
              await releaseOnce()
            } catch (cleanupError) {
              throw new ValidationError(
                'createPreparedExecutorFactory: private execution preparation and cleanup failed',
                { cause: new AggregateError([error, cleanupError]) },
              )
            }
          }
          throw new ValidationError(
            'createPreparedExecutorFactory: private execution preparation failed',
            { cause: error },
          )
        }
      })()
      return preparationPromise
    }

    const wrapper: Executor<Out> = {
      runtime: options.runtime,
      get budgetExempt(): boolean | undefined {
        return inner?.budgetExempt
      },
      ...(options.acceptsMessages
        ? {
            deliver(message: unknown): boolean {
              if (inner !== undefined) return inner.deliver?.(message) !== false
              pendingMessages.push(detachedSnapshot(message, 'prepared executor queued message'))
              return true
            },
          }
        : {}),
      progress() {
        return inner?.progress?.()
      },
      traceSource(): TraceSource | undefined {
        return inner?.traceSource?.()
      },
      execute(
        task: unknown,
        signal: AbortSignal,
      ): Promise<ExecutorResult<Out>> | AsyncIterable<UsageEvent> {
        return requireInner('execute').execute(task, signal)
      },
      async teardown(grace): Promise<{ destroyed: boolean }> {
        if (!innerDestroyed) {
          try {
            if (inner !== undefined) innerDestroyed = (await inner.teardown(grace)).destroyed
            else innerDestroyed = true
          } catch (cause) {
            throw new ValidationError('createPreparedExecutorFactory: prepared teardown failed', {
              cause,
            })
          }
        }
        // A workspace remains private executor state until Runtime knows the executor is gone.
        // Keeping it is safer than deleting files underneath a process that may still be alive.
        if (!innerDestroyed) return { destroyed: false }
        await releaseOnce()
        return { destroyed: true }
      },
      resultArtifact(): ExecutorResult<Out> {
        return requireInner('resultArtifact').resultArtifact()
      },
      accounting(): { readonly reported: Spend; readonly reservation: Spend } | undefined {
        return inner?.accounting?.()
      },
      metered(): Spend | undefined {
        return inner?.metered?.()
      },
    }

    runtimeOwnedPreparations.set(wrapper as object, Object.freeze({ role, prepare }))
    return wrapper
  }
}
