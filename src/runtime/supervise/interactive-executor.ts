/**
 * The executor behind one interactive worker: starts the provider's retained interactive process,
 * polls it to exit, relays steers as prompts, and stops and releases it exactly once.
 */

import {
  type AgentInteractiveSessionPromptCommand,
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
} from '@tangle-network/agent-interface/environment-provider'
import { contentAddress } from '../../durable/content-address'
import type { WorkerSpawnContext } from '../../mcp/tools/coordination-contracts'
import { startRetainedInteractiveRun } from '../retained-interactive'
import { claimRetainedInteractiveControl } from '../retained-interactive-control'
import { destroyInteractiveEnvironment, environmentGone } from '../retained-interactive-lifecycle'
import type { RetainedInteractiveRunHandle } from '../retained-interactive-types'
import { retainedCreateMaterial } from '../retained-run-intent'
import type { RetainedInteractiveAdmission } from '../retained-run-types'
import { sleep } from '../util'
import { linkAbort, signalAbortError } from './abortable'
import { createInbox, failPendingAfter } from './inbox'
import type { InteractiveAdmissionWriter } from './interactive-admission'
import type {
  InteractiveWorkerEnvironment,
  InteractiveWorkerOptions,
  InteractiveWorkerResult,
} from './interactive-worker'
import {
  attestRuntimeOwnedPendingExecutor,
  finalizeRuntimeOwnedPendingExecutor,
  newExecutionAttemptId,
} from './materialization'
import { concreteProfileModel } from './model-policy'
import { detachedSnapshot } from './snapshot'
import { taskToPrompt } from './task-prompt'
import type {
  Executor,
  ExecutorCancellation,
  ExecutorResult,
  HeldEnvironment,
  Runtime,
  Spend,
  UsageEvent,
  WorkerInteractiveSession,
} from './types'

const INTERACTIVE_TEARDOWN_TIMEOUT_MS = 30_000

export interface InteractiveExecutorInput {
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

/** The one record an interactive executor reads and writes across start, poll, steer, stop and teardown. */
interface InteractiveRun {
  readonly input: InteractiveExecutorInput
  readonly attemptId: string
  readonly localController: AbortController
  readonly inbox: ReturnType<typeof createInbox>
  readonly planned: PlannedDeclaration
  readonly stopOperations: Map<string, Promise<ExecutorCancellation>>
  readonly memoryAdmissions: Map<string, RetainedInteractiveAdmission>
  readonly ready: Promise<WorkerInteractiveSession>
  readonly resolveReady: (session: WorkerInteractiveSession) => void
  executor: Executor<InteractiveWorkerResult>
  handle: RetainedInteractiveRunHandle | undefined
  createdEnvironment: AgentEnvironment | undefined
  environmentId: string | undefined
  artifact: ExecutorResult<InteractiveWorkerResult> | undefined
  activeLink: ReturnType<typeof linkAbort> | undefined
  startPromise: Promise<RetainedInteractiveRunHandle> | undefined
  executeStarted: boolean
  teardownComplete: boolean
  teardownPromise: Promise<{ destroyed: boolean }> | undefined
  flushChain: Promise<void>
  controlError: unknown
}

type PlannedDeclaration = ReturnType<typeof plannedDeclarationOf>

const descriptorOf = (input: InteractiveExecutorInput) =>
  ({
    kind: 'interactive-session',
    provider: input.provider.name,
    transport: 'agent-environment',
  }) as const

function plannedDeclarationOf(input: InteractiveExecutorInput) {
  const declaredEnvironment = input.environment
    ? retainedCreateMaterial({
        ...input.environment,
        profile: input.profile,
        idempotencyKey: input.environmentKey,
      })
    : null
  const profileModel = concreteProfileModel(input.profile)
  return {
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
}

export function interactiveExecutor(
  input: InteractiveExecutorInput,
): Executor<InteractiveWorkerResult> {
  const attemptId =
    input.executionAttemptId ?? newExecutionAttemptId(input.nodeId ?? input.environmentKey)
  let resolveReady!: (session: WorkerInteractiveSession) => void
  const ready = new Promise<WorkerInteractiveSession>((resolve) => {
    resolveReady = resolve
  })
  const run: InteractiveRun = {
    input,
    attemptId,
    localController: new AbortController(),
    inbox: createInbox(),
    planned: plannedDeclarationOf(input),
    stopOperations: new Map(),
    memoryAdmissions: new Map(),
    ready,
    resolveReady,
    executor: undefined as unknown as Executor<InteractiveWorkerResult>,
    handle: undefined,
    createdEnvironment: undefined,
    environmentId: undefined,
    artifact: undefined,
    activeLink: undefined,
    startPromise: undefined,
    executeStarted: false,
    teardownComplete: false,
    teardownPromise: undefined,
    flushChain: Promise.resolve(),
    controlError: undefined,
  }
  run.executor = interactiveSurface(run)
  attestRuntimeOwnedPendingExecutor(run.executor, input.runtime, run.planned, {
    attemptId,
    binding: {
      provider: input.provider.name,
      environmentIdempotencyKey: input.environmentKey,
      nodeId: input.nodeId ?? null,
    },
    descriptor: descriptorOf(input),
  })
  return run.executor
}

function interactiveSurface(run: InteractiveRun): Executor<InteractiveWorkerResult> {
  const { input } = run
  return {
    runtime: input.runtime,
    teardownTimeoutMs: INTERACTIVE_TEARDOWN_TIMEOUT_MS,
    execute(task, signal): AsyncIterable<UsageEvent> {
      if (run.executeStarted || run.teardownComplete || run.teardownPromise !== undefined) {
        throw new Error('workerFromInteractiveProvider: execute() may only be called once')
      }
      run.executeStarted = true
      run.startPromise = startInteractive(run, task, signal)
      return failPendingAfter(run.inbox, runInteractive(run, signal))
    },
    deliver(message: unknown): boolean {
      if (run.teardownComplete || run.teardownPromise !== undefined) return false
      const accepted = run.inbox.deliver(message)
      if (accepted) void flushInbox(run)
      return accepted
    },
    interactive(): WorkerInteractiveSession {
      return run.handle
        ? { status: 'available', handle: run.handle }
        : { status: 'unavailable', reason: 'interactive-session-not-started' }
    },
    interactiveReady(): Promise<WorkerInteractiveSession> {
      return run.ready
    },
    async cancel(request): Promise<ExecutorCancellation> {
      const existing = run.stopOperations.get(request.operationId)
      if (existing) return existing
      const operation = stopInteractive(run, request.operationId, request.reason, request.signal)
      const tracked = operation.then((result) => {
        if (
          result.status === 'unknown' &&
          run.stopOperations.get(request.operationId) === tracked
        ) {
          run.stopOperations.delete(request.operationId)
        }
        return result
      })
      run.stopOperations.set(request.operationId, tracked)
      return tracked
    },
    teardown(grace): Promise<{ destroyed: boolean }> {
      void grace
      if (run.teardownComplete) return Promise.resolve({ destroyed: true })
      if (run.teardownPromise !== undefined) return run.teardownPromise
      const pending = teardownInteractive(run)
      run.teardownPromise = pending.then(
        (result) => {
          run.teardownComplete = true
          return result
        },
        (error) => {
          run.teardownPromise = undefined
          throw error
        },
      )
      return run.teardownPromise
    },
    heldEnvironments(): ReadonlyArray<HeldEnvironment> {
      if (run.teardownComplete || input.destroyEnvironmentOnTeardown === false) return []
      const held =
        run.createdEnvironment?.id ?? run.environmentId ?? run.handle?.ref.run.environmentId
      return held === undefined ? [] : [{ provider: input.provider.name, environmentId: held }]
    },
    resultArtifact(): ExecutorResult<InteractiveWorkerResult> {
      if (!run.artifact) {
        throw new Error(
          'workerFromInteractiveProvider: resultArtifact() read before execution settled',
        )
      }
      return run.artifact
    },
  }
}

function initialPromptFor(input: InteractiveExecutorInput, task: unknown): string {
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
  return initialPrompt
}

/** Keep each admission phase's first snapshot in memory and refuse a retry that changes it. */
async function recordAdmission(
  run: InteractiveRun,
  admission: RetainedInteractiveAdmission,
): Promise<void> {
  run.environmentId =
    admission.phase === 'interactive_environment' ? admission.environmentId : run.environmentId
  const existing = run.memoryAdmissions.get(admission.phase)
  if (existing !== undefined) {
    if (canonicalCandidateDigest(existing) !== canonicalCandidateDigest(admission)) {
      throw new Error(`interactive admission phase '${admission.phase}' changed across retry`)
    }
  } else {
    run.memoryAdmissions.set(admission.phase, detachedSnapshot(admission, 'interactive admission'))
  }
  await run.input.admission(admission)
}

async function startInteractive(
  run: InteractiveRun,
  task: unknown,
  signal: AbortSignal,
): Promise<RetainedInteractiveRunHandle> {
  const { input } = run
  try {
    run.activeLink = linkAbort(signal, run.localController.signal)
    const initialPrompt = initialPromptFor(input, task)
    const interactiveIdempotencyKey = input.interactiveKey(task)
    const started = await startRetainedInteractiveRun({
      provider: {
        ...input.provider,
        async create(environmentInput): Promise<AgentEnvironment> {
          const environment = await input.provider.create!(environmentInput)
          run.createdEnvironment = environment
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
      onAdmission: (admission) => recordAdmission(run, admission),
      signal: run.activeLink.signal,
    })
    finalizeRuntimeOwnedPendingExecutor(
      run.executor,
      {
        ...run.planned,
        execution: { kind: 'interactive-session', id: started.ref.run.executionId },
        plan: {
          ...run.planned.plan,
          environmentId: started.ref.run.environmentId,
          interactiveIdempotencyKey,
        },
      },
      {
        attemptId: run.attemptId,
        binding: {
          provider: input.provider.name,
          ref: started.ref,
          environmentId: started.ref.run.environmentId,
        },
        descriptor: descriptorOf(input),
      },
    )
    run.handle = started
    run.resolveReady({ status: 'available', handle: started })
    void flushInbox(run)
    return started
  } catch (error) {
    run.resolveReady({ status: 'unavailable', reason: unavailableReason(error) })
    run.activeLink?.release()
    throw error
  }
}

async function* runInteractive(
  run: InteractiveRun,
  signal: AbortSignal,
): AsyncIterable<UsageEvent> {
  const { input, localController } = run
  const startedAt = Date.now()
  try {
    const current = await run.startPromise
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
        throw signalAbortError(
          signal.aborted ? signal : localController.signal,
          'interactive execution aborted',
        )
      }
      status = await current.status({ signal: run.activeLink?.signal })
      await run.flushChain
      if (run.controlError !== undefined) throw controlErrorValue(run.controlError)
      if (status.state !== 'running') break
      await sleep(input.pollIntervalMs ?? 100, run.activeLink?.signal)
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
    run.artifact = {
      outRef: contentAddress(output),
      out: output,
      spent,
    }
  } finally {
    run.activeLink?.release()
  }
}

async function flushInbox(run: InteractiveRun): Promise<void> {
  run.flushChain = run.flushChain.then(async () => {
    const handle = run.handle
    if (!handle) return
    const lease = run.inbox.take()
    try {
      const messages = lease.messages
      if (messages.length === 0) return
      const prompt = run.inbox.fold(messages)
      const operationId = `interactive-prompt-${canonicalCandidateDigest({
        ref: handle.ref,
        prompt,
      }).slice('sha256:'.length)}`
      const control = await claimRetainedInteractiveControl({
        handle,
        holderId: run.input.holderId(undefined),
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
      for (const message of messages) lease.commit(operationId, message.id)
    } catch (error) {
      lease.release()
      run.controlError ??= error
    }
  })
  await run.flushChain
}

async function stopInteractive(
  run: InteractiveRun,
  operationId: string,
  reason?: string,
  signal?: AbortSignal,
): Promise<ExecutorCancellation> {
  const observedAt = new Date().toISOString()
  const handle = run.handle
  if (!handle) {
    run.localController.abort(reason ?? 'interactive cancellation requested')
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
      holderId: run.input.holderId(undefined),
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
    run.localController.abort(reason ?? 'interactive cancellation requested')
    return cancellationFromAcknowledgement(acknowledgement, observedAt)
  } catch (error) {
    run.localController.abort(reason ?? 'interactive cancellation requested')
    return {
      status: 'unknown',
      effect: 'cancel_requested',
      observedAt,
      detail: error instanceof Error ? error.message : String(error),
      evidence: { operationId },
    }
  }
}

async function teardownInteractive(run: InteractiveRun): Promise<{ destroyed: boolean }> {
  run.localController.abort('interactive worker teardown')
  run.activeLink?.release()
  await run.startPromise?.catch(() => undefined)
  if (run.handle) {
    const status = await safeStatus(run.handle)
    if (status?.state === 'running') {
      const operationId = `interactive-teardown-${canonicalCandidateDigest(run.handle.ref).slice(
        'sha256:'.length,
      )}`
      const cancellation = await stopInteractive(run, operationId, 'interactive worker teardown')
      if (cancellation.status === 'rejected' || cancellation.status === 'unknown') {
        throw new Error(cancellation.detail ?? 'interactive teardown was not acknowledged')
      }
    }
  }
  await destroyEnvironment(run)
  return { destroyed: true }
}

async function destroyEnvironment(run: InteractiveRun): Promise<void> {
  const { input } = run
  if (input.destroyEnvironmentOnTeardown === false) return
  if (run.createdEnvironment !== undefined) {
    await destroyConfirmed(input.provider, run.createdEnvironment)
    return
  }
  if (!input.provider.get) return
  // The exact provider reference is durable and remains available even when the admission
  // callback was interrupted after the environment was created. Use it as the cleanup identity
  // so an aborted provider signal cannot turn a real environment into an unconfirmed leak.
  const cleanupEnvironmentId = run.environmentId ?? run.handle?.ref.run.environmentId
  if (!cleanupEnvironmentId) return
  const environment = await input.provider.get(cleanupEnvironmentId)
  if (environment !== undefined && environment !== null) {
    await destroyConfirmed(input.provider, environment)
  }
}

async function destroyConfirmed(
  provider: AgentEnvironmentProvider,
  environment: AgentEnvironment,
): Promise<void> {
  try {
    await destroyInteractiveEnvironment(environment)
  } catch (error) {
    // A delete whose answer was lost fails not-found on every later attempt; the provider's
    // lookup confirming the environment gone is the destroy's confirmation.
    if (!(await environmentGone(provider, environment.id))) throw error
  }
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
