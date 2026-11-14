import { join } from 'node:path'
import type { ContextTransferRequest, Sha256Digest } from '@tangle-network/agent-interface'
import {
  AgentEnvironmentCapabilitiesSchema,
  AgentExactRunControlRefSchema,
  AgentFileOutputPolicySchema,
  AgentTurnInputSchema,
  ContextTransferRequestSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
  AgentSession,
  AgentSessionRef,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { withJsonlFileLock } from '../durable/jsonl-file'
import { FileObserverJournal } from '../durable/observer-journal'
import {
  RetainedInteractiveAdmissionError,
  RetainedRunAdmissionError,
  RetainedRunDispatchBindingError,
} from '../errors'
import type { RuntimeHookPhase, RuntimeHookTarget } from '../runtime-hooks'
import { assertRequestedInteractionCapabilities } from './interaction-capabilities'
import {
  assertRetainedContextTransferCapability,
  assertRetainedContextTransferEnvironment,
  assertRetainedContextTransferIdentity,
  retainedContextTransferReceipt,
} from './retained-context-transfer'
import {
  bindInteractiveDelegation,
  delegatedTerminal,
  refreshInteractiveDelegation,
  revokeInteractiveControl,
} from './retained-interactive-delegation'
import type { RetainedInteractiveRunHandle } from './retained-interactive-types'
import {
  assertStableText,
  exactControlRef,
  exactSession,
  freezeControlRef,
} from './retained-run-binding'
import { createRetainedRunHandle } from './retained-run-handle'
import {
  retainedCreateMaterial,
  retainedEnvironmentMetadata,
  retainedTurnForDispatch,
  retainedTurnMaterial,
} from './retained-run-intent'
import type {
  ReconnectRetainedRunOptions,
  RecoverRetainedRunIntentOptions,
  RecoverRetainedRunOptions,
  RecoverRetainedRunResult,
  RetainedInteractiveAdmission,
  RetainedRunAdmission,
  RetainedRunAdmissionHook,
  RetainedRunHandle,
  RetainedRunIntentAdmission,
  RetainedRunStartMaterial,
  StartRetainedRunInEnvironmentOptions,
  StartRetainedRunOptions,
} from './retained-run-types'
import { detachedSnapshot } from './supervise/snapshot'
import { freshTurnInput } from './turn-input'

/** Mint the same session and execution from `(idempotencyKey, turnId)` in every process. */
export function mintRetainedIdentity(
  idempotencyKey: string,
  turnId: string,
): { sessionId: string; executionId: string } {
  const base = `${encodeURIComponent(idempotencyKey)}:${encodeURIComponent(turnId)}`
  const digest = canonicalCandidateDigest({ kind: 'retained-identity.v1', base }).slice(
    'sha256:'.length,
  )
  return {
    sessionId: `retained-session-${digest}`,
    executionId: `retained-execution-${digest}`,
  }
}

/** Bound from a durable intent until `provider.create` resolves. */
const RETAINED_ENVIRONMENT_MATERIALIZATION_MS = 120_000

/** Create never reached an environment. The message names the stage; the driver stops. */
export class RetainedMaterializationTimeoutError extends Error {
  readonly stage = 'intent' as const
  constructor() {
    super('retained run reached stage intent and did not materialize an environment')
    this.name = 'RetainedMaterializationTimeoutError'
  }
}

function createRetainedEnvironment(
  options: StartRetainedRunOptions,
  parent: AbortSignal | undefined,
): Promise<AgentEnvironment> {
  const timeout = AbortSignal.timeout(
    options.materializationTimeoutMs ?? RETAINED_ENVIRONMENT_MATERIALIZATION_MS,
  )
  const signal = parent === undefined ? timeout : AbortSignal.any([parent, timeout])
  const create = options.provider.create({
    ...options.environment,
    signal,
    metadata: retainedEnvironmentMetadata(
      options.environment.metadata,
      options.environment.idempotencyKey,
    ),
  })
  const timedOut = () => timeout.aborted && parent?.aborted !== true
  return new Promise((resolve, reject) => {
    const fail = () => {
      reject(
        timedOut()
          ? new RetainedMaterializationTimeoutError()
          : parent?.reason instanceof Error
            ? parent.reason
            : new Error('retained run materialization aborted'),
      )
    }
    if (signal.aborted) {
      fail()
      return
    }
    signal.addEventListener('abort', fail, { once: true })
    create.then(
      (environment) => {
        signal.removeEventListener('abort', fail)
        resolve(environment)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', fail)
        reject(timedOut() ? new RetainedMaterializationTimeoutError() : error)
      },
    )
  })
}

/** Dispatch one replayable run. Intent is durable before create; the promise resolves after dispatch is durable. @stable */
export async function startRetainedRun(
  options: StartRetainedRunOptions,
): Promise<RetainedRunHandle> {
  assertStableText(options.environment.idempotencyKey, 'environment idempotency key')
  assertStableText(options.turn.turnId, 'turn idempotency key')
  if (typeof options.onAdmission !== 'function') {
    throw new Error('startRetainedRun requires an awaited onAdmission durability hook')
  }
  const onAdmission = journaledAdmissions(
    options.journalRoot,
    options.intent?.runId,
    options.onAdmission,
  )
  const contextTransfer = retainedContextTransfer(options.turn.contextTransfer)
  const transferReceipt = retainedContextTransferReceipt(
    options,
    options.provider.name,
    contextTransfer,
  )
  const { sessionId, executionId } =
    options.identity ??
    // Admission coordinates remain authoritative across generator changes.
    options.intent ??
    (transferReceipt === undefined
      ? undefined
      : { sessionId: transferReceipt.sessionId, executionId: transferReceipt.executionId }) ??
    mintRetainedIdentity(options.environment.idempotencyKey, options.turn.turnId)
  const identity = { sessionId, executionId }
  assertStableText(identity.sessionId, 'retained session id')
  assertStableText(identity.executionId, 'retained execution id')
  assertRetainedContextTransferIdentity(transferReceipt, identity)
  AgentTurnInputSchema.parse(
    freshTurnInput(options.turn, {
      turnId: options.turn.turnId,
      detach: true,
      ...identity,
      contextTransfer,
    }),
  )
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  const intent = retainedRunIntent(options, identity, contextTransfer)
  if (options.intent === undefined) {
    await admitDurably(onAdmission, intent)
  } else {
    assertExactRetainedRunIntent(options.intent, intent, () =>
      retainedRunIntent(options, identity, contextTransfer, {
        providerOptions: options.turn.providerOptions,
      }),
    )
  }
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  if (options.outputFile !== undefined) {
    AgentFileOutputPolicySchema.parse(options.outputFile)
    if (
      providerCapabilities.workspace.retainFileOutput !== true ||
      !options.environment.retain?.paths.includes(options.outputFile.path)
    )
      throw new Error(
        'retained file output requires declared provider support and retention of the output path',
      )
  }
  if (transferReceipt !== undefined) assertRetainedContextTransferCapability(providerCapabilities)
  assertRequestedInteractionCapabilities(
    options.provider.name,
    options.turn.interactions,
    providerCapabilities,
  )
  options.environment.signal?.throwIfAborted()
  options.turn.signal?.throwIfAborted()
  const attachmentSignal =
    options.environment.signal === undefined
      ? options.turn.signal
      : options.turn.signal === undefined
        ? options.environment.signal
        : AbortSignal.any([options.environment.signal, options.turn.signal])
  let environment: AgentEnvironment
  if (transferReceipt !== undefined && contextTransfer !== undefined) {
    const existing = await options.provider.get(transferReceipt.environmentId, {
      contextTransfer,
      ...(attachmentSignal === undefined ? {} : { signal: attachmentSignal }),
    })
    attachmentSignal?.throwIfAborted()
    if (!existing)
      throw new Error('accepted context transfer environment is unavailable; it cannot be replaced')
    assertRetainedContextTransferEnvironment(existing, contextTransfer, transferReceipt)
    environment = existing
  } else if (options.existingEnvironmentId !== undefined) {
    assertStableText(options.existingEnvironmentId, 'retained environment id')
    const existing = await options.provider.get(options.existingEnvironmentId)
    if (
      !existing ||
      existing.id !== options.existingEnvironmentId ||
      existing.provider !== options.provider.name
    ) {
      throw new Error('retained provider environment is unavailable or has another identity')
    }
    await assertRetainedEnvironmentOwnership(
      options.provider,
      existing,
      options.environment.idempotencyKey,
    )
    environment = existing
  } else {
    environment = await createRetainedEnvironment(options, attachmentSignal)
  }
  let capabilities: AgentEnvironmentCapabilities
  let teardownFailure =
    'retained run environment published invalid capabilities and could not be destroyed'
  try {
    capabilities = retainedCapabilitiesForEnvironment(
      options.provider.name,
      providerCapabilities,
      environment,
    )
    if (transferReceipt !== undefined) assertRetainedContextTransferCapability(capabilities)
    if (
      options.outputFile !== undefined &&
      (capabilities.workspace.retainFileOutput !== true || !environment.retainFileOutput)
    )
      throw new Error('this environment cannot publish the declared retained file output')
    assertRequestedInteractionCapabilities(
      options.provider.name,
      options.turn.interactions,
      capabilities,
    )
    if (!environment.dispatch || !environment.session) {
      teardownFailure =
        'retained run could not start and its unused environment could not be destroyed'
      throw new Error(
        `provider "${options.provider.name}" does not expose detached session control`,
      )
    }
  } catch (error) {
    if (transferReceipt !== undefined || options.existingEnvironmentId !== undefined) throw error
    try {
      await environment.destroy?.()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], teardownFailure)
    }
    throw error
  }

  return dispatchRetainedRun({
    provider: options.provider,
    environment,
    signal: attachmentSignal,
    environmentIdempotencyKey: options.environment.idempotencyKey,
    create: options.environment,
    turn: options.turn,
    contextTransfer,
    expectedRunId: transferReceipt?.runId,
    identity,
    onAdmission,
    capabilities,
    now: options.now,
    preserveEnvironment:
      options.preserveEnvironment === true ||
      transferReceipt !== undefined ||
      options.existingEnvironmentId !== undefined,
  })
}

/** Fresh session in an existing environment. A same-chat turn uses `continueNative`. @stable */
export async function startRetainedRunInEnvironment(
  options: StartRetainedRunInEnvironmentOptions,
): Promise<RetainedRunHandle> {
  if (options.turn.contextTransfer !== undefined) {
    throw new Error(
      'accepted context transfer requires startRetainedRun with its exact profile and receipt',
    )
  }
  assertStableText(options.environment.id, 'retained environment id')
  assertStableText(options.environment.idempotencyKey, 'environment idempotency key')
  assertStableText(options.turn.turnId, 'turn idempotency key')
  if (options.identity !== undefined) {
    assertStableText(options.identity.sessionId, 'retained session id')
    assertStableText(options.identity.executionId, 'retained execution id')
  }
  if (typeof options.onAdmission !== 'function') {
    throw new Error('startRetainedRunInEnvironment requires an awaited onAdmission durability hook')
  }
  const identity =
    options.identity ??
    mintRetainedIdentity(options.environment.idempotencyKey, options.turn.turnId)
  const contextTransfer = retainedContextTransfer(options.turn.contextTransfer)
  AgentTurnInputSchema.parse(
    freshTurnInput(options.turn, {
      turnId: options.turn.turnId,
      detach: true,
      ...identity,
      contextTransfer,
    }),
  )
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  const environment = await options.provider.get(options.environment.id)
  if (!environment) {
    throw new Error(
      `provider "${options.provider.name}" no longer holds environment "${options.environment.id}"`,
    )
  }
  if (environment.id !== options.environment.id || environment.provider !== options.provider.name) {
    throw new Error('provider reconstructed a different retained environment')
  }
  const capabilities = retainedCapabilitiesForEnvironment(
    options.provider.name,
    providerCapabilities,
    environment,
  )
  assertRequestedInteractionCapabilities(
    options.provider.name,
    options.turn.interactions,
    capabilities,
  )
  if (!environment.dispatch || !environment.session) {
    throw new Error(`provider "${options.provider.name}" does not expose detached session control`)
  }
  await assertRetainedEnvironmentOwnership(
    options.provider,
    environment,
    options.environment.idempotencyKey,
  )

  return dispatchRetainedRun({
    provider: options.provider,
    environment,
    environmentIdempotencyKey: options.environment.idempotencyKey,
    turn: options.turn,
    contextTransfer,
    identity,
    onAdmission: options.onAdmission,
    capabilities,
    now: options.now,
    preserveEnvironment: true,
  })
}

/** Bind an environment to the retained key on its own get/create record. Missing metadata is a refusal; do not list the account. */
async function assertRetainedEnvironmentOwnership(
  provider: AgentEnvironmentProvider,
  environment: AgentEnvironment,
  idempotencyKey: string,
): Promise<void> {
  if (environment.metadata === undefined) {
    throw new Error(
      `provider "${provider.name}" returned environment "${environment.id}" without metadata, so it cannot prove retained environment ownership`,
    )
  }
  if (environment.metadata.retainedIdempotencyKey !== idempotencyKey) {
    throw new Error(
      `provider "${provider.name}" could not bind environment "${environment.id}" to its retained idempotency key`,
    )
  }
}

interface DispatchRetainedRunOptions {
  readonly expectedRunId?: string
  readonly preserveEnvironment?: boolean
  readonly signal?: AbortSignal
  readonly provider: AgentEnvironmentProvider
  readonly environment: AgentEnvironment
  readonly environmentIdempotencyKey: string
  readonly create?: RetainedRunStartMaterial['environment']
  readonly turn: StartRetainedRunOptions['turn']
  readonly contextTransfer?: ContextTransferRequest
  readonly identity: { readonly sessionId: string; readonly executionId: string }
  readonly onAdmission: RetainedRunAdmissionHook
  readonly capabilities: AgentEnvironmentCapabilities
  readonly now?: () => number
}

async function dispatchRetainedRun(
  options: DispatchRetainedRunOptions,
): Promise<RetainedRunHandle> {
  const { environment, identity } = options
  assertRequestedInteractionCapabilities(
    options.provider.name,
    options.turn.interactions,
    options.capabilities,
  )
  // The environment admission fires only for a dispatch-capable environment.
  await admitDurably(options.onAdmission, {
    phase: 'environment',
    provider: options.provider.name,
    environmentId: environment.id,
    idempotencyKey: options.environmentIdempotencyKey,
    turnId: options.turn.turnId,
    sessionId: identity.sessionId,
    executionId: identity.executionId,
  })

  // Dispatch failure leaks a paid environment when THIS call provisioned it, and deletes another
  // caller's workspace when it did not. The provider's creation receipt is what separates the two:
  // only `created` is destroyed, and `replayed` or an absent receipt is kept, because an
  // environment whose creation cannot be proven may be held by someone else.
  const destroyIfCreated = async (cause: unknown): Promise<never> => {
    if (options.preserveEnvironment || environment.creation !== 'created') throw cause
    try {
      await environment.destroy?.()
    } catch (cleanupError) {
      throw new AggregateError(
        [cause, cleanupError],
        'retained run dispatch failed and the environment it created could not be destroyed',
      )
    }
    throw cause
  }

  options.signal?.throwIfAborted()
  options.turn.signal?.throwIfAborted()
  let reference: AgentSessionRef
  try {
    const turn = options.create
      ? retainedTurnForDispatch(options.turn, options.create)
      : options.turn
    reference = await environment.dispatch!(
      freshTurnInput(turn, {
        turnId: options.turn.turnId,
        detach: true,
        ...identity,
        ...(options.contextTransfer === undefined
          ? {}
          : { contextTransfer: options.contextTransfer }),
      }),
    )
  } catch (error) {
    await destroyIfCreated(error)
    throw error
  }
  // Every post-dispatch binding failure is triageable: the durable
  // environment admission names the requested coordinates, and the error
  // carries the provider's actual answer. The environment is kept.
  let exact: ReturnType<typeof exactSession>
  try {
    if (reference.provider !== undefined && reference.provider !== options.provider.name) {
      throw new Error('provider dispatch returned a session reference for another provider')
    }
    if (reference.id !== identity.sessionId) {
      throw new Error('provider dispatched into another session than the requested identity')
    }
    const controlRef = exactControlRef(reference.controlRef, {
      provider: options.provider.name,
      environmentId: environment.id,
      sessionId: identity.sessionId,
    })
    if (controlRef.executionId !== identity.executionId) {
      throw new Error('provider bound another execution than the requested identity')
    }
    if (options.expectedRunId !== undefined && controlRef.runId !== options.expectedRunId) {
      throw new Error('provider bound another run than the accepted context transfer receipt')
    }
    exact = exactSession(environment, controlRef)
  } catch (error) {
    const bindingError = new RetainedRunDispatchBindingError(
      {
        provider: options.provider.name,
        environmentId: environment.id,
        sessionId: identity.sessionId,
        executionId: identity.executionId,
      },
      {
        ...(reference.id === undefined ? {} : { id: reference.id }),
        ...(reference.provider === undefined ? {} : { provider: reference.provider }),
        ...(reference.controlRef === undefined ? {} : { controlRef: reference.controlRef }),
      },
      { cause: error },
    )
    await destroyIfCreated(bindingError)
    throw bindingError
  }
  await admitDurably(options.onAdmission, {
    phase: 'dispatched',
    controlRef: freezeControlRef(exact.controlRef),
    idempotencyKey: options.environmentIdempotencyKey,
    turnId: options.turn.turnId,
  })
  return createRetainedRunHandle(
    environment,
    exact.session,
    exact.controlRef,
    options.capabilities,
    options.now,
  )
}

/** Await the durability hook. A rejection keeps the environment and throws the admission error, not a provider error. */
export async function admitDurably<
  TAdmission extends RetainedRunAdmission | RetainedInteractiveAdmission,
>(onAdmission: (admission: TAdmission) => Promise<void>, admission: TAdmission): Promise<void> {
  const stableAdmission = detachedSnapshot(admission, 'retained run admission')
  try {
    await onAdmission(stableAdmission)
  } catch (error) {
    if (isInteractiveAdmission(stableAdmission)) {
      throw new RetainedInteractiveAdmissionError(stableAdmission, { cause: error })
    }
    throw new RetainedRunAdmissionError(stableAdmission, { cause: error })
  }
}

/** Mirror admissions into the observer journal. The caller's hook stays authoritative; an observer failure does not fail the run. */
export function journaledAdmissions<
  TAdmission extends RetainedRunAdmission | RetainedInteractiveAdmission,
>(
  journalRoot: string | undefined,
  replayRunId: string | undefined,
  onAdmission: (admission: TAdmission) => Promise<void>,
): (admission: TAdmission) => Promise<void> {
  if (journalRoot === undefined) return onAdmission
  let runId = replayRunId
  return async (admission) => {
    await onAdmission(admission)
    if ('runId' in admission) runId ??= admission.runId
    if (runId === undefined) return
    await appendRetainedObserverEvent(journalRoot, runId, admission.phase, 'agent.run', 'before', {
      status: 'running',
      admission: admission.phase,
    })
  }
}

/** Journal accepted turns and the end beside admissions. A turn records its operation id, never the prompt. */
export function journaledInteractiveHandle(
  handle: RetainedInteractiveRunHandle,
  journalRoot: string | undefined,
  runId: string,
): RetainedInteractiveRunHandle {
  if (journalRoot === undefined) return handle
  const settle = async (failed: boolean, detail: Record<string, unknown>) => {
    await appendRetainedObserverEvent(
      journalRoot,
      runId,
      'settled',
      'agent.run',
      failed ? 'error' : 'after',
      { status: failed ? 'failed' : 'done', ...detail },
    )
  }
  const journaled: RetainedInteractiveRunHandle = {
    ...handle,
    claimControl: async (request, options) => {
      const ack = await handle.claimControl(request, options)
      if ((ack.status === 'accepted' || ack.status === 'replayed') && ack.control)
        await refreshInteractiveDelegation(journaled, ack.control)
      return ack
    },
    attach: async (request, options) =>
      delegatedTerminal(journaled, await handle.attach(request, options)),
    sendPrompt: async (command, options) => {
      const ack = await handle.sendPrompt(command, options)
      if (ack.status === 'accepted' || ack.status === 'replayed') {
        await appendRetainedObserverEvent(
          journalRoot,
          runId,
          `turn:${command.operationId}`,
          'agent.turn',
          'event',
          { operationId: command.operationId },
        )
      }
      return ack
    },
    status: async (options) => {
      const status = await handle.status(options)
      if (status.state === 'exited') {
        await revokeInteractiveControl(journaled)
        await settle(status.reason === 'lost' || (status.exitCode ?? 0) !== 0, {
          reason: status.reason,
          ...(status.exitCode === undefined ? {} : { exitCode: status.exitCode }),
        })
      }
      return status
    },
    stop: async (command, options) => {
      const ack = await handle.stop(command, options)
      if (ack.status === 'accepted' || ack.status === 'replayed') {
        await revokeInteractiveControl(journaled, command.control)
        await settle(false, { reason: 'stopped' })
      }
      return ack
    },
  }
  bindInteractiveDelegation(journaled, journalRoot)
  return Object.freeze(journaled)
}

/** One observer record of a retained run, at `<journalRoot>/<runId>/observer.jsonl`. A viewer's
 *  record never fails the run it describes, so a write failure is dropped. */
async function appendRetainedObserverEvent(
  journalRoot: string,
  runId: string,
  name: string,
  target: RuntimeHookTarget,
  phase: RuntimeHookPhase,
  payload: Record<string, unknown>,
): Promise<void> {
  await withJsonlFileLock(join(journalRoot, runId, 'observer.jsonl'), async (path) => {
    const journal = new FileObserverJournal(path, runId)
    const id = `${runId}:${name}`
    if ((await journal.read()).some((record) => record.event?.id === id)) return
    await journal.appendEvent({
      id,
      pursuitId: runId,
      runId,
      target,
      phase,
      timestamp: Date.now(),
      payload,
    })
  }).catch(() => undefined)
}

function isInteractiveAdmission(
  admission: RetainedRunAdmission | RetainedInteractiveAdmission,
): admission is RetainedInteractiveAdmission {
  return (
    admission.phase === 'interactive_intent' ||
    admission.phase === 'interactive_environment' ||
    admission.phase === 'interactive_started'
  )
}

/** Replay a persisted intent, or reattach coordinates the provider can prove. `unverifiable` keeps the environment; different coordinates throw. @stable */
export function recoverRetainedRun(
  options: RecoverRetainedRunIntentOptions,
): Promise<RecoverRetainedRunResult>
export function recoverRetainedRun(
  options: RecoverRetainedRunOptions,
): Promise<RecoverRetainedRunResult>
export async function recoverRetainedRun(
  options: RecoverRetainedRunIntentOptions | RecoverRetainedRunOptions,
): Promise<RecoverRetainedRunResult> {
  if ('admission' in options) {
    if (options.admission.provider !== options.provider.name) {
      throw new Error('retained run intent belongs to another provider')
    }
    const handle = await startRetainedRun({
      provider: options.provider,
      ...options.replay,
      intent: options.admission,
      onAdmission: options.onAdmission,
      now: options.now,
    })
    return { outcome: 'recovered', via: 'resumed', handle }
  }
  assertStableText(options.environmentId, 'retained environment id')
  assertStableText(options.sessionId, 'retained session id')
  assertStableText(options.executionId, 'retained execution id')
  const contextTransfer = retainedContextTransfer(options.contextTransfer)
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  // A run that started from an ACCEPTED context transfer repeats the receipt-authorized
  // lookup here: without the request, an adapter requiring receipt authorization answers
  // not_found; without the receipt check, a run the receipt never bound can be accepted.
  const environment =
    contextTransfer === undefined || options.transferReceipt === undefined
      ? await options.provider.get(options.environmentId)
      : await options.provider.get(options.environmentId, {
          contextTransfer,
        })
  if (!environment) return { outcome: 'not_found' }
  if (contextTransfer !== undefined && options.transferReceipt !== undefined) {
    assertRetainedContextTransferEnvironment(environment, contextTransfer, options.transferReceipt)
  }
  const capabilities = retainedCapabilitiesForEnvironment(
    options.provider.name,
    providerCapabilities,
    environment,
  )
  if (!environment.session) return { outcome: 'unverifiable', environment }
  let session: AgentSession
  try {
    session = environment.session(options.sessionId)
  } catch {
    return { outcome: 'unverifiable', environment }
  }
  // A lazy accessor returns a session for any id and only echoes a reference
  // the caller supplied, so an absent or loose reference proves nothing about
  // the run either way: the answer is unverifiable, never destroy-safe.
  const parsed = AgentExactRunControlRefSchema.safeParse(session.controlRef)
  if (!parsed.success) return { outcome: 'unverifiable', environment }
  const controlRef = parsed.data
  if (
    controlRef.provider !== options.provider.name ||
    controlRef.environmentId !== options.environmentId ||
    controlRef.sessionId !== options.sessionId ||
    controlRef.executionId !== options.executionId
  ) {
    throw new Error('provider session is bound to other retained run coordinates')
  }
  const exact = exactSession(environment, controlRef)
  return {
    outcome: 'recovered',
    via: 'reattached',
    handle: createRetainedRunHandle(
      environment,
      exact.session,
      exact.controlRef,
      capabilities,
      options.now,
    ),
  }
}

/** Check public replay material before reconnecting an already-dispatched execution. */
export function assertRetainedRunReplayMaterial(
  provider: AgentEnvironmentProvider,
  replay: RetainedRunStartMaterial,
  admission: RetainedRunIntentAdmission,
): void {
  const identity = replay.identity ?? admission
  assertStableText(identity.sessionId, 'retained session id')
  assertStableText(identity.executionId, 'retained execution id')
  const options = { ...replay, provider }
  const contextTransfer = retainedContextTransfer(replay.turn.contextTransfer)
  assertExactRetainedRunIntent(
    admission,
    retainedRunIntent(options, identity, contextTransfer),
    () =>
      retainedRunIntent(options, identity, contextTransfer, {
        providerOptions: replay.turn.providerOptions,
      }),
  )
}

function retainedRunIntent(
  options: RetainedRunStartMaterial & { readonly provider: AgentEnvironmentProvider },
  identity: { readonly sessionId: string; readonly executionId: string },
  contextTransfer: ContextTransferRequest | undefined,
  turnFields?: Pick<AgentTurnInput, 'providerOptions'>,
): RetainedRunIntentAdmission {
  const receipt = retainedContextTransferReceipt(options, options.provider.name, contextTransfer)
  assertRetainedContextTransferIdentity(receipt, identity)
  // A named profile is only its name until the provider resolves it; an inline
  // profile has the one AgentProfile identity every other Runtime record uses.
  const { profile } = options.environment
  const requestedProfileDigest =
    typeof profile === 'string'
      ? canonicalCandidateDigest(profile)
      : canonicalAgentProfileDigest(profile)
  const material = {
    provider: options.provider.name,
    idempotencyKey: options.environment.idempotencyKey,
    turnId: options.turn.turnId,
    sessionId: identity.sessionId,
    executionId: identity.executionId,
    requestedProfileDigest,
    ...(options.outputFile === undefined
      ? {}
      : { outputFilePolicyDigest: canonicalCandidateDigest(options.outputFile) }),
  }
  const requestDigest = canonicalCandidateDigest({
    kind: turnFields === undefined ? 'retained-run-intent.v2' : 'retained-run-intent.v1',
    ...material,
    ...(options.outputFile === undefined ? {} : { outputFile: options.outputFile }),
    ...(options.existingEnvironmentId === undefined
      ? {}
      : { existingEnvironmentId: options.existingEnvironmentId }),
    ...(receipt === undefined
      ? {}
      : {
          contextTransferReceiptDigest: canonicalCandidateDigest({
            ...receipt,
            status: 'accepted',
          }),
        }),
    create: retainedCreateMaterial(options.environment),
    turn: retainedTurnMaterial(options.turn, contextTransfer, turnFields),
  })
  return {
    phase: 'intent',
    ...material,
    runId: `retained-intent-run:${requestDigest.slice('sha256:'.length)}`,
    requestDigest,
  }
}

function retainedContextTransfer(
  value: ContextTransferRequest | undefined,
): ContextTransferRequest | undefined {
  if (value === undefined) return undefined
  const parsed = ContextTransferRequestSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      'retained context transfer request is invalid or uses an incompatible wire contract; preserve the original record and explicitly reconstruct and review an Interface 5 transfer request before retrying',
      { cause: parsed.error },
    )
  }
  return detachedSnapshot(parsed.data, 'retained context transfer request')
}

function assertExactRetainedRunIntent(
  received: RetainedRunIntentAdmission,
  expected: RetainedRunIntentAdmission,
  legacyExpected?: () => RetainedRunIntentAdmission,
): void {
  const receivedDigest = canonicalCandidateDigest(parseRetainedRunIntent(received, expected))
  if (receivedDigest === canonicalCandidateDigest(expected)) return
  if (legacyExpected && receivedDigest === canonicalCandidateDigest(legacyExpected())) return
  throw new Error('retained run intent conflicts with replay material')
}

function parseRetainedRunIntent(
  value: unknown,
  expected: RetainedRunIntentAdmission,
): RetainedRunIntentAdmission {
  const stable = detachedSnapshot(value, 'retained run intent')
  if (stable === null || typeof stable !== 'object' || Array.isArray(stable)) {
    throw new Error('retained run intent is malformed')
  }
  const record = stable as Record<string, unknown>
  if (Object.keys(record).some((key) => !Object.hasOwn(expected, key))) {
    throw new Error('retained run intent contains unsupported material')
  }
  if (record.phase !== 'intent') {
    throw new Error('retained run intent has an invalid phase')
  }
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'phase' && (typeof value !== 'string' || value.length === 0)) {
      throw new Error(`retained run intent field "${key}" is invalid`)
    }
  }
  assertDigest(record.requestedProfileDigest, 'retained run intent profile digest')
  assertDigest(record.requestDigest, 'retained run intent request digest')
  if (record.outputFilePolicyDigest !== undefined)
    assertDigest(record.outputFilePolicyDigest, 'retained run intent file policy digest')
  return stable as RetainedRunIntentAdmission
}

function assertDigest(value: unknown, label: string): asserts value is Sha256Digest {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

/** Rebuild a retained-run client without retaining any object from the starter. @stable */
export async function reconnectRetainedRun(
  options: ReconnectRetainedRunOptions,
): Promise<RetainedRunHandle | null> {
  const controlRef = AgentExactRunControlRefSchema.parse(options.controlRef)
  if (controlRef.provider !== options.provider.name) {
    throw new Error(
      `run provider "${controlRef.provider}" does not match "${options.provider.name}"`,
    )
  }
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  const environment = await options.provider.get(controlRef.environmentId)
  if (!environment) return null
  const capabilities = retainedCapabilitiesForEnvironment(
    options.provider.name,
    providerCapabilities,
    environment,
  )
  const exact = exactSession(environment, controlRef)
  return createRetainedRunHandle(
    environment,
    exact.session,
    exact.controlRef,
    capabilities,
    options.now,
  )
}

async function assertRetainedCapabilities(
  provider: AgentEnvironmentProvider,
): Promise<AgentEnvironmentCapabilities> {
  const capabilities = AgentEnvironmentCapabilitiesSchema.parse(await provider.capabilities())
  assertRetainedCapabilityRequirements(provider.name, capabilities)
  return capabilities
}

/** A measured environment capability document wins; an absent one uses the provider document. */
function retainedCapabilitiesForEnvironment(
  providerName: string,
  providerCapabilities: AgentEnvironmentCapabilities,
  environment: AgentEnvironment,
): AgentEnvironmentCapabilities {
  if (environment.capabilities === undefined) return providerCapabilities
  const measured = AgentEnvironmentCapabilitiesSchema.parse(environment.capabilities)
  assertRetainedCapabilityRequirements(providerName, measured)
  return measured
}

function assertRetainedCapabilityRequirements(
  providerName: string,
  capabilities: AgentEnvironmentCapabilities,
): void {
  if (capabilities.retainedControl === undefined) {
    throw new Error(`provider "${providerName}" cannot control a retry-safe retained run`)
  }
}
