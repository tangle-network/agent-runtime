/**
 * Runtime-owned worker seam for a provider's native interactive coding-agent process.
 *
 * This adapter composes the retained-interactive lifecycle. It does not create a second stream,
 * replay buffer, session id, or cancellation protocol. The provider owns process state; Scope owns
 * the supervised worker, journal, budget, and local control inbox.
 */

import { randomUUID } from 'node:crypto'
import {
  type AgentInteractiveSessionPromptCommand,
  type AgentInteractiveSessionRef,
  type AgentInteractiveSessionStatus,
  type AgentInteractiveSessionStopAcknowledgement,
  type AgentInteractiveSessionStopCommand,
  type AgentProfile,
  agentInteractiveSessionPromptRequestDigest,
  agentInteractiveSessionStopRequestDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { contentAddress } from '../../durable/spawn-journal'
import type { MakeWorkerAgent, WorkerSpawnContext } from '../../mcp/tools/coordination'
import { destroyInteractiveEnvironment } from '../retained-interactive-lifecycle'
import type { RetainedInteractiveRunHandle } from '../retained-interactive-types'
import { claimRetainedInteractiveControl, startRetainedInteractiveRun } from '../retained-run'
import { retainedCreateMaterial } from '../retained-run-intent'
import type { RetainedInteractiveAdmission } from '../retained-run-types'
import { abortError, linkAbort } from './abortable'
import { executableAgentProfileSnapshot } from './executable-spec'
import { createInbox } from './inbox'
import {
  type InteractiveAdmissionWriter,
  interactiveAdmissionSeamKey,
} from './interactive-admission'
import {
  attestRuntimeOwnedPendingExecutor,
  finalizeRuntimeOwnedPendingExecutor,
  newExecutionAttemptId,
} from './materialization'
import { concreteProfileModel } from './model-policy'
import { detachedSnapshot } from './snapshot'
import { taskToPrompt } from './task-prompt'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorCancellation,
  ExecutorContext,
  ExecutorResult,
  Runtime,
  Spend,
  UsageEvent,
  WorkerInteractiveSession,
} from './types'

/** Environment fields supplied to every interactive worker after Runtime adds the exact profile. */
export type InteractiveWorkerEnvironment = Omit<
  CreateAgentEnvironmentInput,
  'profile' | 'idempotencyKey' | 'signal'
>

/** Native interactive worker output. Provider usage is intentionally not fabricated. */
export interface InteractiveWorkerResult {
  readonly provider: string
  readonly environmentId: string
  readonly sessionId: string
  readonly executionId: string
  readonly state: 'exited' | 'unknown'
  readonly ref: AgentInteractiveSessionRef
  readonly reason?: string
  readonly exitCode?: number
  readonly exitSignal?: string
}

/** Configuration shared by every worker produced by `workerFromInteractiveProvider`. */
export interface InteractiveWorkerOptions {
  /** Provider create fields. Runtime supplies `profile`, the two idempotency keys, and `signal`. */
  readonly environment?: InteractiveWorkerEnvironment
  /** Stable environment identity override. Defaults to a digest of the exact worker assignment. */
  readonly environmentIdempotencyKey?: (input: InteractiveWorkerKeyInput) => string
  /** Stable interactive-session identity override. Defaults to a digest of assignment and task. */
  readonly interactiveIdempotencyKey?: (input: InteractiveWorkerKeyInput) => string
  /** Provider holder id used only while the worker sends a steer or stop command. */
  readonly holderId?: string | ((input: InteractiveWorkerKeyInput) => string)
  /** Initial prompt override. The exact worker task is the default prompt. */
  readonly initialPrompt?: string | ((task: unknown, input: InteractiveWorkerKeyInput) => string)
  readonly cwd?: string
  readonly cols?: number
  readonly rows?: number
  /** Runtime tag written into tree snapshots. Defaults to the provider name. */
  readonly runtime?: Runtime
  /** Poll delay used while waiting for the provider's native process to exit. */
  readonly pollIntervalMs?: number
  /** Destroy the provider environment after the process is terminal. Defaults to true. */
  readonly destroyEnvironmentOnTeardown?: boolean
}

const INTERACTIVE_TEARDOWN_TIMEOUT_MS = 30_000

/** Stable input available to key and holder functions. */
export interface InteractiveWorkerKeyInput {
  readonly provider: string
  readonly profile: AgentProfile
  readonly context?: WorkerSpawnContext
  readonly task?: unknown
  readonly nodeId?: string
}

/**
 * Build a `MakeWorkerAgent` that starts one exact provider-owned native TUI per worker.
 *
 * A Scope supplies the durable admission hook and kernel-minted node attempt. The returned worker
 * exposes `interactiveReady`, so Scope writes the exact provider reference before the worker can be
 * attached by a different process. `attachWorker` then reconnects that same reference through the
 * provider's public `get`/interactive contract.
 */
export function workerFromInteractiveProvider(
  provider: AgentEnvironmentProvider,
  options: InteractiveWorkerOptions = {},
): MakeWorkerAgent {
  if (!provider.name.trim())
    throw new Error('workerFromInteractiveProvider: provider.name required')
  if (!provider.get) {
    throw new Error(
      `workerFromInteractiveProvider(${provider.name}): provider.get is required for reconnect`,
    )
  }
  const capturedEnvironment = options.environment
    ? (structuredClone(options.environment) as InteractiveWorkerEnvironment)
    : undefined
  const unscopedNamespace = randomUUID()
  let unscopedOrdinal = 0
  const runtime = options.runtime ?? (provider.name as Runtime)

  return (rawProfile, spawnContext) => {
    const profile = executableAgentProfileSnapshot(
      rawProfile,
      `workerFromInteractiveProvider(${provider.name})`,
    )
    const input: InteractiveWorkerKeyInput = {
      provider: provider.name,
      profile,
      ...(spawnContext === undefined ? {} : { context: spawnContext }),
    }
    const assignmentId =
      spawnContext?.assignmentId ?? `unscoped:${unscopedNamespace}:${unscopedOrdinal++}`
    const baseInput = { ...input, nodeId: spawnContext?.parentNodeId }
    const environmentKey = stableKey(
      options.environmentIdempotencyKey?.({ ...baseInput }) ??
        derivedKey('supervised-interactive-environment', {
          provider: provider.name,
          assignmentId,
          parentNodeId: spawnContext?.parentNodeId,
          profile,
        }),
      'environment idempotency key',
    )
    const name = profile.name ?? 'interactive-worker'

    const executorFactory = (
      spec: AgentSpec,
      ctx: ExecutorContext,
    ): Executor<InteractiveWorkerResult> =>
      interactiveExecutor({
        provider,
        profile: spec.profile,
        context: spawnContext,
        environment: capturedEnvironment,
        environmentKey,
        interactiveKey: (task: unknown) =>
          stableKey(
            options.interactiveIdempotencyKey?.({
              ...baseInput,
              task,
            }) ??
              derivedKey('supervised-interactive-session', {
                provider: provider.name,
                assignmentId,
                parentNodeId: spawnContext?.parentNodeId,
                profile: spec.profile,
                task,
              }),
            'interactive idempotency key',
          ),
        holderId: (task: unknown) => {
          const selected =
            typeof options.holderId === 'function'
              ? options.holderId({ ...baseInput, task })
              : options.holderId
          return stableKey(
            selected ??
              `runtime-interactive-worker:${canonicalCandidateDigest({
                provider: provider.name,
                assignmentId,
              })}`,
            'interactive holder id',
          )
        },
        initialPrompt: options.initialPrompt,
        cwd: options.cwd,
        cols: options.cols,
        rows: options.rows,
        runtime,
        pollIntervalMs: options.pollIntervalMs,
        destroyEnvironmentOnTeardown: options.destroyEnvironmentOnTeardown,
        executionAttemptId: ctx.node?.attemptId,
        nodeId: ctx.node?.nodeId,
        admission: admissionWriter(ctx, provider.name, ctx.node?.nodeId),
      })

    const spec: AgentSpec = {
      profile,
      harness: null,
      executorFactory,
      ...(spawnContext?.execution ? { execution: spawnContext.execution } : {}),
    }
    return {
      name,
      act: async () => {
        throw new Error(
          'workerFromInteractiveProvider: interactive workers execute through executorSpec',
        )
      },
      executorSpec: spec,
    } as Agent<unknown, InteractiveWorkerResult> & { executorSpec: AgentSpec }
  }
}

interface InteractiveExecutorInput {
  readonly provider: AgentEnvironmentProvider
  readonly profile: AgentProfile
  readonly context?: WorkerSpawnContext
  readonly environment?: InteractiveWorkerEnvironment
  readonly environmentKey: string
  readonly interactiveKey: (task: unknown) => string
  readonly holderId: (task: unknown) => string
  readonly initialPrompt?: InteractiveWorkerOptions['initialPrompt']
  readonly cwd?: string
  readonly cols?: number
  readonly rows?: number
  readonly runtime: Runtime
  readonly pollIntervalMs?: number
  readonly destroyEnvironmentOnTeardown?: boolean
  readonly executionAttemptId?: string
  readonly nodeId?: string
  readonly admission: InteractiveAdmissionWriter
}

function interactiveExecutor(input: InteractiveExecutorInput): Executor<InteractiveWorkerResult> {
  const attemptId =
    input.executionAttemptId ?? newExecutionAttemptId(input.nodeId ?? input.environmentKey)
  const localController = new AbortController()
  const inbox = createInbox()
  let handle: RetainedInteractiveRunHandle | undefined
  let createdEnvironment: AgentEnvironment | undefined
  let environmentId: string | undefined
  let artifact: ExecutorResult<InteractiveWorkerResult> | undefined
  let activeLink: ReturnType<typeof linkAbort> | undefined
  let startPromise: Promise<RetainedInteractiveRunHandle> | undefined
  let executeStarted = false
  let readyResolve!: (session: WorkerInteractiveSession) => void
  const ready = new Promise<WorkerInteractiveSession>((resolve) => {
    readyResolve = resolve
  })
  const stopOperations = new Map<string, Promise<ExecutorCancellation>>()
  const memoryAdmissions = new Map<string, RetainedInteractiveAdmission>()
  let teardownComplete = false
  let teardownPromise: Promise<{ destroyed: boolean }> | undefined
  let flushChain: Promise<void> = Promise.resolve()
  let controlError: unknown

  const executor: Executor<InteractiveWorkerResult> = {
    runtime: input.runtime,
    teardownTimeoutMs: INTERACTIVE_TEARDOWN_TIMEOUT_MS,
    execute(task, signal): AsyncIterable<UsageEvent> {
      if (executeStarted || teardownComplete || teardownPromise !== undefined) {
        throw new Error('workerFromInteractiveProvider: execute() may only be called once')
      }
      executeStarted = true
      startPromise = startInteractive(task, signal)
      return runInteractive(signal)
    },
    deliver(message: unknown): boolean {
      if (teardownComplete || teardownPromise !== undefined) return false
      const accepted = inbox.deliver(message)
      if (accepted) void flushInbox()
      return accepted
    },
    interactive(): WorkerInteractiveSession {
      return handle
        ? { status: 'available', handle }
        : { status: 'unavailable', reason: 'interactive-session-not-started' }
    },
    interactiveReady(): Promise<WorkerInteractiveSession> {
      return ready
    },
    async cancel(request): Promise<ExecutorCancellation> {
      const existing = stopOperations.get(request.operationId)
      if (existing) return existing
      const operation = stopInteractive(request.operationId, request.reason, request.signal)
      const tracked = operation.then((result) => {
        if (result.status === 'unknown' && stopOperations.get(request.operationId) === tracked) {
          stopOperations.delete(request.operationId)
        }
        return result
      })
      stopOperations.set(request.operationId, tracked)
      return tracked
    },
    teardown(grace): Promise<{ destroyed: boolean }> {
      void grace
      if (teardownComplete) return Promise.resolve({ destroyed: true })
      if (teardownPromise !== undefined) return teardownPromise
      const pending = teardownInteractive()
      teardownPromise = pending.then(
        (result) => {
          teardownComplete = true
          return result
        },
        (error) => {
          teardownPromise = undefined
          throw error
        },
      )
      return teardownPromise
    },
    resultArtifact(): ExecutorResult<InteractiveWorkerResult> {
      if (!artifact) {
        throw new Error(
          'workerFromInteractiveProvider: resultArtifact() read before execution settled',
        )
      }
      return artifact
    },
  }

  const declaredEnvironment = input.environment
    ? retainedCreateMaterial({
        ...input.environment,
        profile: input.profile,
        idempotencyKey: input.environmentKey,
      })
    : null
  const profileModel = concreteProfileModel(input.profile)
  const plannedDeclaration = {
    effectiveProfile: input.profile,
    backend: input.provider.name,
    model: profileModel
      ? { status: 'known' as const, id: profileModel }
      : { status: 'unknown' as const, reason: 'provider selected the model' },
    execution: { kind: 'interactive-session', id: input.nodeId ?? input.environmentKey },
    materializer: 'retained-interactive-provider',
    plan: {
      kind: 'retained-interactive-provider',
      provider: input.provider.name,
      environment: declaredEnvironment,
      environmentIdempotencyKey: input.environmentKey,
      destroyEnvironmentOnTeardown: input.destroyEnvironmentOnTeardown !== false,
    },
  }
  attestRuntimeOwnedPendingExecutor(executor, input.runtime, plannedDeclaration, {
    attemptId,
    binding: {
      provider: input.provider.name,
      environmentIdempotencyKey: input.environmentKey,
      nodeId: input.nodeId ?? null,
    },
    descriptor: {
      kind: 'interactive-session',
      provider: input.provider.name,
      transport: 'agent-environment',
    },
  })

  async function startInteractive(
    task: unknown,
    signal: AbortSignal,
  ): Promise<RetainedInteractiveRunHandle> {
    try {
      activeLink = linkAbort(signal, localController.signal)
      const initialPrompt =
        typeof input.initialPrompt === 'function'
          ? input.initialPrompt(task, {
              provider: input.provider.name,
              profile: input.profile,
              ...(input.context === undefined ? {} : { context: input.context }),
              task,
              ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
            })
          : (input.initialPrompt ?? taskToPrompt(task))
      if (typeof initialPrompt !== 'string') {
        throw new Error('workerFromInteractiveProvider: initialPrompt must return a string')
      }
      const interactiveIdempotencyKey = input.interactiveKey(task)
      const started = await startRetainedInteractiveRun({
        provider: {
          ...input.provider,
          async create(environmentInput): Promise<AgentEnvironment> {
            const environment = await input.provider.create!(environmentInput)
            createdEnvironment = environment
            return environment
          },
        },
        environment: {
          ...(input.environment ?? {}),
          profile: input.profile,
          idempotencyKey: input.environmentKey,
        },
        interactiveIdempotencyKey,
        ...(initialPrompt.length === 0 ? {} : { initialPrompt }),
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.cols === undefined ? {} : { cols: input.cols }),
        ...(input.rows === undefined ? {} : { rows: input.rows }),
        onAdmission: async (admission) => {
          environmentId =
            admission.phase === 'interactive_environment' ? admission.environmentId : environmentId
          const existing = memoryAdmissions.get(admission.phase)
          if (existing !== undefined) {
            if (canonicalCandidateDigest(existing) !== canonicalCandidateDigest(admission)) {
              throw new Error(
                `interactive admission phase '${admission.phase}' changed across retry`,
              )
            }
          } else {
            memoryAdmissions.set(
              admission.phase,
              detachedSnapshot(admission, 'interactive admission'),
            )
          }
          await input.admission(admission)
        },
        signal: activeLink.signal,
      })
      finalizeRuntimeOwnedPendingExecutor(
        executor,
        {
          ...plannedDeclaration,
          execution: { kind: 'interactive-session', id: started.ref.run.executionId },
          plan: {
            ...plannedDeclaration.plan,
            environmentId: started.ref.run.environmentId,
            interactiveIdempotencyKey,
          },
        },
        {
          attemptId,
          binding: {
            provider: input.provider.name,
            ref: started.ref,
            environmentId: started.ref.run.environmentId,
          },
          descriptor: {
            kind: 'interactive-session',
            provider: input.provider.name,
            transport: 'agent-environment',
          },
        },
      )
      handle = started
      readyResolve({ status: 'available', handle: started })
      void flushInbox()
      return started
    } catch (error) {
      readyResolve({ status: 'unavailable', reason: unavailableReason(error) })
      activeLink?.release()
      throw error
    }
  }

  async function* runInteractive(signal: AbortSignal): AsyncIterable<UsageEvent> {
    const startedAt = Date.now()
    try {
      const current = await startPromise
      if (current === undefined) {
        throw new Error('workerFromInteractiveProvider: interactive start did not begin')
      }
      yield { kind: 'iteration' }
      // Native TUI sessions do not expose a complete turn receipt. These zero counters are an
      // observed floor and the explicit false markers keep the run's accounting honest.
      yield { kind: 'tokens', input: 0, output: 0, tokensKnown: false }
      yield { kind: 'cost', usd: 0, usdKnown: false, provenance: 'uncaptured' }
      let status: AgentInteractiveSessionStatus | undefined
      for (;;) {
        if (signal.aborted || localController.signal.aborted) {
          throw abortError(
            signal.aborted ? signal : localController.signal,
            'interactive execution aborted',
          )
        }
        status = await current.status({ signal: activeLink?.signal })
        await flushChain
        if (controlError !== undefined) throw controlErrorValue(controlError)
        if (status.state !== 'running') break
        await sleep(input.pollIntervalMs ?? 100, activeLink?.signal)
      }
      const finished = status
      const output: InteractiveWorkerResult = {
        provider: input.provider.name,
        environmentId: current.ref.run.environmentId,
        sessionId: current.ref.run.sessionId,
        executionId: current.ref.run.executionId,
        state: finished?.state === 'exited' ? 'exited' : 'unknown',
        ref: current.ref,
        ...(finished?.state === 'exited' && finished.reason ? { reason: finished.reason } : {}),
        ...(finished?.state === 'exited' && finished.exitCode !== undefined
          ? { exitCode: finished.exitCode }
          : {}),
        ...(finished?.state === 'exited' && finished.exitSignal !== undefined
          ? { exitSignal: finished.exitSignal }
          : {}),
      }
      const spent: Spend = {
        iterations: 1,
        tokens: { input: 0, output: 0 },
        tokensKnown: false,
        usd: 0,
        usdKnown: false,
        ms: Date.now() - startedAt,
      }
      artifact = {
        outRef: contentAddress(output),
        out: output,
        spent,
      }
    } finally {
      activeLink?.release()
    }
  }

  async function flushInbox(): Promise<void> {
    flushChain = flushChain.then(async () => {
      try {
        if (!handle) return
        const messages = inbox.drain()
        if (messages.length === 0) return
        const prompt = inbox.fold(messages)
        const operationId = `interactive-prompt-${canonicalCandidateDigest({
          ref: handle.ref,
          prompt,
        }).slice('sha256:'.length)}`
        const control = await claimRetainedInteractiveControl({
          handle,
          holderId: input.holderId(undefined),
        })
        const material = {
          operationId,
          ref: handle.ref,
          control,
          prompt,
        }
        const command: AgentInteractiveSessionPromptCommand = {
          ...material,
          requestDigest: agentInteractiveSessionPromptRequestDigest(material),
        }
        await handle.sendPrompt(command)
      } catch (error) {
        controlError ??= error
      }
    })
    await flushChain
  }

  async function stopInteractive(
    operationId: string,
    reason?: string,
    signal?: AbortSignal,
  ): Promise<ExecutorCancellation> {
    const observedAt = new Date().toISOString()
    if (!handle) {
      localController.abort(reason ?? 'interactive cancellation requested')
      return {
        status: 'unknown',
        effect: 'cancel_requested',
        observedAt,
        detail: 'interactive process has not published a provider reference',
      }
    }
    try {
      const control = await claimRetainedInteractiveControl({
        handle,
        holderId: input.holderId(undefined),
        signal,
      })
      const material = { operationId, ref: handle.ref, control }
      const command: AgentInteractiveSessionStopCommand = {
        ...material,
        requestDigest: agentInteractiveSessionStopRequestDigest(material),
      }
      const acknowledgement = await handle.stop(
        command,
        signal === undefined ? undefined : { signal },
      )
      localController.abort(reason ?? 'interactive cancellation requested')
      return cancellationFromAcknowledgement(acknowledgement, observedAt)
    } catch (error) {
      localController.abort(reason ?? 'interactive cancellation requested')
      return {
        status: 'unknown',
        effect: 'cancel_requested',
        observedAt,
        detail: error instanceof Error ? error.message : String(error),
        evidence: { operationId },
      }
    }
  }

  async function teardownInteractive(): Promise<{ destroyed: boolean }> {
    localController.abort('interactive worker teardown')
    activeLink?.release()
    await startPromise?.catch(() => undefined)
    if (handle) {
      const status = await safeStatus(handle)
      if (status?.state === 'running') {
        const operationId = `interactive-teardown-${canonicalCandidateDigest(handle.ref).slice(
          'sha256:'.length,
        )}`
        const cancellation = await stopInteractive(operationId, 'interactive worker teardown')
        if (cancellation.status === 'rejected' || cancellation.status === 'unknown') {
          throw new Error(cancellation.detail ?? 'interactive teardown was not acknowledged')
        }
      }
    }
    await destroyEnvironment()
    return { destroyed: true }
  }

  async function destroyEnvironment(): Promise<void> {
    if (input.destroyEnvironmentOnTeardown === false) return
    if (createdEnvironment !== undefined) {
      await destroyInteractiveEnvironment(createdEnvironment)
      return
    }
    if (!input.provider.get) return
    // The exact provider reference is durable and remains available even when the admission
    // callback was interrupted after the environment was created. Use it as the cleanup identity
    // so an aborted provider signal cannot turn a real environment into an unconfirmed leak.
    const cleanupEnvironmentId = environmentId ?? handle?.ref.run.environmentId
    if (!cleanupEnvironmentId) return
    const environment = await input.provider.get(cleanupEnvironmentId)
    if (environment !== undefined && environment !== null) {
      await destroyInteractiveEnvironment(environment)
    }
  }

  return executor
}

function admissionWriter(
  ctx: ExecutorContext,
  provider: string,
  workerId: string | undefined,
): InteractiveAdmissionWriter {
  const candidate = ctx.seams[interactiveAdmissionSeamKey]
  if (typeof candidate === 'function') {
    return async (admission) => {
      await (candidate as (value: RetainedInteractiveAdmission) => Promise<void>)(admission)
    }
  }
  // In-memory runs still need a real hook because retained-start refuses an omitted hook. The
  // durable Scope path always supplies the Runtime-owned writer above; this fallback is explicit
  // and process-local, never mistaken for restart evidence.
  const records = new Map<string, RetainedInteractiveAdmission>()
  return async (admission) => {
    const prior = records.get(admission.phase)
    if (prior && canonicalCandidateDigest(prior) !== canonicalCandidateDigest(admission)) {
      throw new Error(
        `worker ${workerId ?? '(unscoped)'} provider ${provider} admission changed in memory`,
      )
    }
    records.set(admission.phase, detachedSnapshot(admission, 'interactive admission'))
  }
}

function derivedKey(kind: string, value: unknown): string {
  return `${kind}-${canonicalCandidateDigest(value).slice('sha256:'.length)}`
}

function stableKey(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  const key = value.trim()
  if (key.length > 256) throw new Error(`${label} must not exceed 256 bytes`)
  return key
}

function unavailableReason(
  error: unknown,
): 'provider-has-no-interactive-contract' | 'interactive-binding-stale' {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('interactive') || message.includes('Interactive')
    ? 'provider-has-no-interactive-contract'
    : 'interactive-binding-stale'
}

function cancellationFromAcknowledgement(
  acknowledgement: AgentInteractiveSessionStopAcknowledgement,
  observedAt: string,
): ExecutorCancellation {
  const status =
    acknowledgement.status === 'accepted' || acknowledgement.status === 'replayed'
      ? 'accepted'
      : acknowledgement.status === 'conflict'
        ? 'rejected'
        : 'unknown'
  const effect =
    acknowledgement.effect === 'stopped'
      ? 'cancelled'
      : acknowledgement.effect === 'not_live'
        ? 'not_live'
        : acknowledgement.effect === 'stop_requested'
          ? 'cancel_requested'
          : 'unknown'
  return {
    status,
    effect,
    observedAt,
    ...(acknowledgement.message === undefined ? {} : { detail: acknowledgement.message }),
    evidence: {
      operationId: acknowledgement.operationId,
      requestDigest: acknowledgement.requestDigest,
      providerStatus: acknowledgement.status,
      providerEffect: acknowledgement.effect,
    },
  }
}

function controlErrorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

async function safeStatus(
  handle: RetainedInteractiveRunHandle,
): Promise<AgentInteractiveSessionStatus | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), 100)
    timer.unref?.()
  })
  try {
    // A provider environment created with the worker's abort signal may reject or hang all
    // subsequent calls after the scope begins teardown. Keep status best-effort and let the fresh
    // environment lookup below prove release without spending the teardown acknowledgement window
    // on a stale connection.
    return await Promise.race([handle.status(), timeout])
  } catch {
    return undefined
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    let settled = false
    const onAbort = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(
      () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        resolve()
      },
      Math.max(0, ms),
    )
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
