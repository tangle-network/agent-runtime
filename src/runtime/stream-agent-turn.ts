/**
 * `streamAgentTurn` — the ONE run-a-turn event-stream contract over every
 * execution substrate: a sandbox box (`SandboxInstance.streamPrompt`), a
 * one-shot Runtime-owned `Executor` (cli-bridge / router / sandbox, via
 * `ExecutorFactory`), and an in-process `AgentExecutionBackend`.
 *
 * One function, one vocabulary: every backend kind yields the existing
 * `RuntimeStreamEvent` union incrementally and ALWAYS terminates with a
 * `final` event whose `text` is the turn's final text and whose
 * `metadata.tokenUsage` / `metadata.costUsd` / `metadata.model` carry the
 * turn's metered usage. `collectAgentTurn` drains a stream into that terminal
 * summary plus the full event list.
 *
 * This is a UNIFICATION seam, not a new stream parser — each kind is a thin
 * adapter over code that already exists and is already hardened:
 *   - `box`      — `mapSandboxEvent` projects the sandbox event stream and one
 *                  `SandboxUsageLedger` (sandbox-events.ts) meters it, so a harness
 *                  that reports usage only in its own event is counted once per turn;
 *                  its requested profile is explicitly recorded as unverified because
 *                  the box already exists.
 *   - `executor` — Runtime materializes the exact `AgentProfile`, records its
 *                  identity receipts, drives the executor once, and tears it
 *                  down after capturing the terminal artifact.
 *   - `chat`     — the backend's own `stream()` surface, normalized by
 *                  `normalizeBackendStreamEvent`; its requested profile is likewise
 *                  unverified because an arbitrary backend cannot attest its setup.
 *
 * Distinct from `openSandboxRun` (box-only, session resume over one persistent
 * artifact, raw `SandboxEvent` deliverables) and from `runAgentTaskStream`
 * (full task lifecycle: knowledge preflight, session store, resume). This is
 * the minimal turn primitive underneath both worlds: prompt in, one normalized
 * event stream out, terminal result+usage guaranteed on every non-thrown path.
 *
 * Stream envelope: `backend_start` → incremental events → (`backend_error` on
 * failure) → `final`. A caller-initiated abort terminates with
 * `final.status: 'aborted'`; an expired `timeoutMs` deadline with
 * `final.status: 'failed'` — so cancellation stays distinguishable from a
 * blown deadline.
 *
 * Mid-stream lifecycle work needs NO extra API: the generator is pull-based,
 * so the producer is suspended between yields and resumes only when the caller
 * pulls again. A consumer can therefore run arbitrary async work between
 * events — sync state on each `tool_result`, decide a no-op retry after
 * draining, run a pre-`done` flush when it receives `final` and BEFORE it
 * forwards its own terminal event downstream. The interleaving is guaranteed
 * (and locked by test): nothing is produced past the event the caller is
 * holding.
 *
 * @stable
 */

import {
  type AgentProfile,
  canonicalCandidateDigest,
  renderInputPartsAsText,
} from '@tangle-network/agent-interface'
import type { AgentTurnInput } from '@tangle-network/agent-interface/environment-provider'
import type { SandboxEvent } from '@tangle-network/sandbox'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { BackendTransportError, ValidationError } from '../errors'
import { nowIso } from '../sessions'
import type {
  AgentTaskSpec,
  AgentTaskStatus,
  BackendErrorDetail,
  RuntimeSession,
  RuntimeStreamEvent,
} from '../types'
import {
  abortableValues,
  assertTurnTimeout,
  buildFinalEvent,
  deriveTurnSignal,
  driveBoxTurn,
  driveChatTurn,
  driveExecutorTurn,
  finiteNumber,
  type ObservedAgentTurnBackend,
  startTurnSession,
  type TurnAccumulator,
  throwIfAborted,
} from './agent-turn-backend-events'
import { runtimeFailureCause } from './failure-cause'
import { awaitAbortable } from './retained-run-binding'
import { projectSandboxOutcome } from './sandbox-outcome'
import { executableAgentProfileSnapshot } from './supervise/executable-spec'
import {
  authoredProfileDigest,
  knownExecutionBindingReceipt,
  knownMaterializationReceipt,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedPendingExecutorMaterialization,
  unknownExecutionBindingReceipt,
  unknownMaterializationReceipt,
} from './supervise/materialization'
import {
  concreteModelId,
  profileBridgeWireModel,
  profileProviderModel,
} from './supervise/model-policy'
import type {
  ExecutionBindingReceipt,
  Executor,
  ExecutorFactory,
  NodeExecutionIdentity,
  ProfileMaterializationReceipt,
} from './supervise/types'
import { providerMessageText } from './turn-input'

export type { AgentTurnInput } from '@tangle-network/agent-interface/environment-provider'

/**
 * The execution substrate one turn runs on — a closed discriminated union over
 * the three stream surfaces the runtime already owns.
 *
 * @stable
 */
export type AgentTurnBackend = {
  /** A Runtime-owned executor factory materialized from this exact canonical profile. */
  kind: 'executor'
  factory: ExecutorFactory<unknown>
  /** Exact canonical identity materialized by the executor. */
  profile: AgentProfile
  /** Model label stamped on cost-only `llm_call` events. Default `'agent'`. */
  agentRunName?: string
}

/** @stable */
export interface StreamAgentTurnOptions {
  /** Caller-initiated cancellation. Terminates the stream with `final.status: 'aborted'`. */
  signal?: AbortSignal
  /**
   * Wall-clock deadline for the whole turn in ms. An expired deadline aborts
   * the backend and terminates the stream with `final.status: 'failed'`
   * (a blown deadline is a turn failure, not a caller cancellation).
   */
  timeoutMs?: number
  /** Stable logical paid-call id, forwarded as the provider idempotency key and retained in evidence. */
  callId?: string
  /** Caller trace tag retained in evidence and forwarded when the transport supports it. */
  correlationId?: string
  /**
   * Opt-in tool-part projection for box and executor backends: sandbox tool
   * parts additionally surface in-stream as
   * `tool_call` / `tool_result` events (`mapSandboxToolEvent`), so a consumer
   * rendering tool activity needs no bespoke sandbox-event parser. Default
   * off — the stream vocabulary existing consumers see is unchanged. No-op
   * for the `chat` kind (its backend emits `RuntimeStreamEvent`s directly,
   * tool events included when the backend produces them).
   */
  preserveToolParts?: boolean
  /**
   * Raw-event tap for box-kind backends: called (and awaited) with every
   * unmapped `SandboxEvent` BEFORE it is projected, so a consumer can read
   * parts the chat-UX projection drops (part ids, step markers, custom
   * backend events) without forking the mapper. Purely observational — it
   * cannot alter the mapped stream. Never called for the `chat` kind, which
   * has no sandbox events.
   */
  onRawEvent?: (event: SandboxEvent) => void | Promise<void>
}

function turnIntent(input: AgentTurnInput): string {
  if (input.prompt !== undefined) return input.prompt
  if (input.parts !== undefined) return renderInputPartsAsText(input.parts)
  return providerMessageText(input.providerOptions) ?? 'structured agent turn'
}

function executorEvidence(
  executor: Executor<unknown>,
  profile: AgentProfile,
  attemptId: string,
): {
  materialization: ProfileMaterializationReceipt
  executionBinding: ExecutionBindingReceipt
} {
  const profileDigest = authoredProfileDigest(profile)
  const declaration = runtimeOwnedExecutorMaterialization(executor)
  if (!profileDigest || !declaration) {
    const materialization = unknownMaterializationReceipt({
      ...(profileDigest ? { authoredProfileDigest: profileDigest } : {}),
      runtime: executor.runtime,
      reason: declaration ? 'invalid-executor-report' : 'executor-did-not-report',
    })
    return {
      materialization,
      executionBinding: unknownExecutionBindingReceipt(
        materialization,
        attemptId,
        declaration ? 'invalid-executor-report' : 'executor-did-not-report',
      ),
    }
  }
  try {
    const materialization = knownMaterializationReceipt({
      authoredProfileDigest: profileDigest,
      runtime: executor.runtime,
      declaration,
    })
    const binding = runtimeOwnedExecutorExecutionBinding(executor)
    if (!binding || binding.attemptId !== attemptId) throw new Error('executor attempt id mismatch')
    return {
      materialization,
      executionBinding: knownExecutionBindingReceipt(materialization, binding),
    }
  } catch {
    const materialization = unknownMaterializationReceipt({
      authoredProfileDigest: profileDigest,
      runtime: executor.runtime,
      reason: 'invalid-executor-report',
    })
    return {
      materialization,
      executionBinding: unknownExecutionBindingReceipt(
        materialization,
        attemptId,
        'invalid-executor-report',
      ),
    }
  }
}

/** Exact turns require the model-bearing profile to be the sole behavioral authority. Runtime
 * checks the trusted declaration before execution so a seam fallback cannot hide behind the same
 * profile digest. */
function assertExactExecutorDeclaration(executor: Executor<unknown>, profile: AgentProfile): void {
  const profileModel = profileProviderModel(profile)
  if (!profileModel) {
    throw new ValidationError(
      'streamAgentTurn: exact AgentProfile.model.default must name the concrete model',
    )
  }
  const declaration =
    runtimeOwnedExecutorMaterialization(executor) ??
    runtimeOwnedPendingExecutorMaterialization(executor)?.declaration
  if (!declaration) return
  if (declaration.model.status !== 'known') {
    throw new ValidationError(
      'streamAgentTurn: exact executor did not materialize a known model identity',
    )
  }
  if (declaration.backend === 'router' || declaration.backend === 'router-tools') {
    const plan = declaration.plan as {
      configuredModel?: unknown
      configuredReasoningEffort?: unknown
      reasoningEffort?: unknown
    }
    if (declaration.model.id !== profileModel) {
      throw new ValidationError(
        'streamAgentTurn: Router executor model differs from AgentProfile.model.default',
      )
    }
    if (
      plan.configuredModel !== null &&
      plan.configuredModel !== undefined &&
      concreteModelId(String(plan.configuredModel)) !== profileModel
    ) {
      throw new ValidationError(
        'streamAgentTurn: configured Router model conflicts with AgentProfile.model.default',
      )
    }
    const expectedEffort = profile.model?.reasoningEffort ?? null
    if (
      plan.configuredReasoningEffort !== null &&
      plan.configuredReasoningEffort !== undefined &&
      plan.configuredReasoningEffort !== expectedEffort
    ) {
      throw new ValidationError(
        'streamAgentTurn: configured Router reasoning conflicts with AgentProfile.model.reasoningEffort',
      )
    }
    if ((plan.reasoningEffort ?? null) !== expectedEffort) {
      throw new ValidationError(
        'streamAgentTurn: Router reasoning effort must come from AgentProfile.model.reasoningEffort',
      )
    }
  }
  if (declaration.backend === 'bridge' || declaration.backend === 'bridge-worktree') {
    const expectedWireModel = profileBridgeWireModel(profile)
    if (!expectedWireModel || declaration.model.id !== expectedWireModel) {
      throw new ValidationError(
        'streamAgentTurn: bridge executor model differs from the AgentProfile harness/provider/model wire id',
      )
    }
    const plan = declaration.plan as { configuredModel?: unknown }
    if (
      plan.configuredModel !== null &&
      plan.configuredModel !== undefined &&
      concreteModelId(String(plan.configuredModel)) !== expectedWireModel
    ) {
      throw new ValidationError(
        'streamAgentTurn: configured bridge model conflicts with the AgentProfile harness/provider/model wire id',
      )
    }
  }
}

function turnProvenance(
  startedAt: number,
  timeoutMs: number | undefined,
  profileDigest: string | undefined,
  taskDigest: string,
  materialization: ProfileMaterializationReceipt | undefined,
  executionBinding: ExecutionBindingReceipt | undefined,
  correlation: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const endedAt = Date.now()
  return {
    ...(profileDigest
      ? {
          identity: {
            profileDigest,
            taskDigest,
            ...(Object.keys(correlation).length > 0 ? { correlation } : {}),
          },
        }
      : { taskDigest }),
    ...(materialization ? { materialization } : {}),
    ...(executionBinding ? { executionBindings: [executionBinding] } : {}),
    budget: { timeoutMs: timeoutMs ?? null },
    timing: {
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
    },
  }
}

/**
 * Metered usage of one turn, summed over every cost-bearing event the backend
 * emitted. `input`/`output` are token counts and are accompanied by
 * `tokensKnown: false` when the backend did not report them. `costUsd`/`model`
 * are present only when the backend actually reported them.
 *
 * @stable
 */
export interface AgentTurnUsage {
  input: number
  output: number
  /** Present when a real turn ran but the provider did not report token usage. */
  tokensKnown?: false
  costUsd?: number
  /** Present when Runtime could not prove the full dollar amount. */
  usdKnown?: false
  /** Separately-labelled local/catalog estimate; never billed spend. */
  estimatedCostUsd?: number
  /** Provider-reported prompt-cache fields; absent fields remain unknown. */
  promptCache?: Readonly<Record<string, number | string>>
  /** Provider-reported reasoning-token subset of output, when available. */
  reasoningTokens?: number
  model?: string
}

/**
 * A drained turn: the terminal summary plus every event the stream yielded.
 * `status`/`error` mirror the terminal `final` event so a failed or aborted
 * turn stays inspectable without re-scanning `events`.
 *
 * @stable
 */
export interface CollectedAgentTurn {
  finalText: string
  /** Exact terminal artifact output from a Runtime-owned executor. */
  output?: unknown
  usage: AgentTurnUsage
  /** Exact underlying transport calls when the Runtime-owned executor reports them. */
  transportAttempts?: number
  toolCalls: Array<{ id?: string; name: string; arguments: string }>
  events: RuntimeStreamEvent[]
  status: AgentTaskStatus
  error?: BackendErrorDetail
  /** Public Sandbox outcome, when the turn ran through a Sandbox stream or executor. */
  sandboxOutcome?: AgentRunOutcome
}

/**
 * Run ONE agent turn on any backend kind and stream its events. Yields the
 * `RuntimeStreamEvent` vocabulary incrementally and always ends with a `final`
 * event carrying the turn's text and usage (`metadata.tokenUsage`,
 * `metadata.costUsd?`, `metadata.model?`) — on success, failure, abort, and
 * timeout alike. The generator never throws; failures surface in-band as
 * `backend_error` + `final` with a typed `error` detail.
 *
 * @stable
 */
export async function* streamAgentTurn(
  backend: AgentTurnBackend,
  input: AgentTurnInput,
  opts: StreamAgentTurnOptions = {},
): AsyncGenerator<RuntimeStreamEvent> {
  assertTurnTimeout(opts.timeoutMs)
  if ((backend as { kind?: unknown }).kind !== 'executor') {
    throw new ValidationError(
      "streamAgentTurn: exact execution accepts only kind 'executor'; use Runtime-owned creation",
    )
  }
  yield* streamAgentTurnInternal(backend, input, opts)
}

/** @internal Normalize a pre-created box/chat stream without asserting an AgentProfile identity. */
export async function* streamObservedAgentTurn(
  backend: ObservedAgentTurnBackend,
  input: AgentTurnInput,
  opts: StreamAgentTurnOptions = {},
): AsyncGenerator<RuntimeStreamEvent> {
  assertTurnTimeout(opts.timeoutMs)
  yield* streamAgentTurnInternal(backend, input, opts)
}

function assertTurnIdentity(value: string | undefined, field: string): void {
  if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
    throw new ValidationError(`streamAgentTurn: ${field} must be a non-empty string`)
  }
}

async function* streamAgentTurnInternal(
  backend: AgentTurnBackend | ObservedAgentTurnBackend,
  input: AgentTurnInput,
  opts: StreamAgentTurnOptions,
): AsyncGenerator<RuntimeStreamEvent> {
  const label = backend.kind === 'chat' ? backend.backend.kind : backend.kind
  const profile =
    backend.kind === 'executor'
      ? executableAgentProfileSnapshot(backend.profile, 'streamAgentTurn')
      : undefined
  const profileDigest = profile ? authoredProfileDigest(profile) : undefined
  assertTurnIdentity(opts.callId, 'callId')
  assertTurnIdentity(opts.correlationId, 'correlationId')
  const correlation = {
    ...(opts.callId ? { callId: opts.callId } : {}),
    ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
  }
  const taskInput = input
  const taskDigest = canonicalCandidateDigest(taskInput)
  const task: AgentTaskSpec = {
    id: `turn-${crypto.randomUUID()}`,
    intent: turnIntent(input),
    ...(profileDigest
      ? {
          metadata: {
            identity: {
              profileDigest,
              taskDigest,
              ...(Object.keys(correlation).length > 0 ? { correlation } : {}),
            } satisfies NodeExecutionIdentity,
          },
        }
      : {}),
  }
  const acc: TurnAccumulator = {
    deltaText: '',
    input: 0,
    output: 0,
    costUsd: 0,
    estimatedCostUsd: 0,
    sawEstimatedCost: false,
    promptCache: {},
    tokensKnown: false,
    usdKnown: false,
    sawLlmCall: false,
    sawTokenUsage: false,
    sawCostUsage: false,
  }
  const deadline = deriveTurnSignal(opts.signal, opts.timeoutMs ?? 0)
  const startedAt = Date.now()

  let session: RuntimeSession | undefined
  let executor: Executor<unknown> | undefined
  let materialization: ProfileMaterializationReceipt | undefined
  let executionBinding: ExecutionBindingReceipt | undefined
  try {
    const nodeId = task.id
    const attemptId = `${nodeId}:attempt:${crypto.randomUUID()}`
    if (backend.kind === 'executor') {
      executor = backend.factory(
        { profile: profile!, harness: null },
        {
          signal: deadline.signal,
          seams: {},
          node: {
            rootId: nodeId,
            parentId: nodeId,
            nodeId,
            attemptId,
            identity: {
              profileDigest: profileDigest!,
              taskDigest,
              ...(Object.keys(correlation).length > 0 ? { correlation } : {}),
            },
          },
        },
      )
      assertExactExecutorDeclaration(executor, profile!)
      const pending = runtimeOwnedPendingExecutorMaterialization(executor)
      if (pending !== undefined) {
        if (pending.runtime !== executor.runtime || pending.binding.attemptId !== attemptId) {
          throw new ValidationError(
            'streamAgentTurn: pending executor did not bind the kernel-minted attempt',
          )
        }
        if (authoredProfileDigest(pending.declaration.effectiveProfile) !== profileDigest) {
          throw new ValidationError(
            'streamAgentTurn: pending executor changed the authored AgentProfile before execution',
          )
        }
        materialization = unknownMaterializationReceipt({
          authoredProfileDigest: profileDigest!,
          runtime: executor.runtime,
          reason: 'executor-receipt-pending',
        })
        executionBinding = unknownExecutionBindingReceipt(
          materialization,
          attemptId,
          'executor-receipt-pending',
        )
      } else {
        ;({ materialization, executionBinding } = executorEvidence(executor, profile!, attemptId))
        assertExactExecutorEvidence(materialization, executionBinding)
      }
    } else {
      materialization = unknownMaterializationReceipt({
        runtime: backend.kind === 'box' ? 'sandbox' : label,
        reason: 'executor-did-not-report',
      })
      executionBinding = unknownExecutionBindingReceipt(
        materialization,
        attemptId,
        'executor-did-not-report',
      )
    }
    const startedSession = await awaitAbortable(
      Promise.resolve().then(() => startTurnSession(backend, task, input, deadline.signal, label)),
      deadline.signal,
    )
    session = startedSession
    yield {
      type: 'backend_start',
      task,
      session: startedSession,
      backend: executor?.runtime ?? label,
      metadata: {
        ...(profileDigest
          ? {
              identity: {
                profileDigest,
                taskDigest,
                ...(Object.keys(correlation).length > 0 ? { correlation } : {}),
              },
            }
          : { taskDigest }),
        ...(materialization ? { materialization } : {}),
        ...(executionBinding ? { executionBindings: [executionBinding] } : {}),
        budget: { timeoutMs: opts.timeoutMs ?? null },
        timing: { startedAt: new Date(startedAt).toISOString() },
      },
      timestamp: nowIso(),
    }

    const inner =
      backend.kind === 'chat'
        ? driveChatTurn(backend.backend, task, startedSession, input, deadline.signal, acc)
        : backend.kind === 'executor'
          ? driveExecutorTurn(
              executor!,
              task,
              startedSession,
              input,
              deadline.signal,
              acc,
              materializedModel(materialization, profile!),
            )
          : driveBoxTurn(
              backend.box,
              input,
              deadline.signal,
              backend.agentRunName ?? 'agent',
              acc,
              {
                ...(backend.options ? { options: backend.options } : {}),
                preserveToolParts: opts.preserveToolParts === true,
                ...(opts.onRawEvent ? { onRawEvent: opts.onRawEvent } : {}),
                ...(profile?.harness ? { harness: profile.harness } : {}),
              },
            )
    // One dedupe for every backend kind: a repeated provider `sourceEventId` is the same child
    // update, so the turn publishes it once whether it arrives live, on reconnect, or on replay.
    const seenChildTaskUpdates = new Set<string>()
    for await (const event of abortableValues(inner, deadline.signal)) {
      if (childTaskAlreadySeen(event, seenChildTaskUpdates)) {
        throwIfAborted(deadline.signal)
        continue
      }
      yield event
      throwIfAborted(deadline.signal)
    }
    // Some providers close their iterator instead of throwing after an abort
    // or deadline. Never turn that silent close into a successful completion.
    throwIfAborted(deadline.signal)

    if (backend.kind === 'executor') {
      ;({ materialization, executionBinding } = executorEvidence(executor!, profile!, attemptId))
      assertExactExecutorEvidence(materialization, executionBinding)
    }

    const terminalOutcome = acc.sandboxOutcome
      ? projectSandboxOutcome(acc.sandboxOutcome)
      : { status: 'completed' as const, reason: 'turn completed' }
    yield buildFinalEvent(
      task,
      session,
      acc,
      terminalOutcome,
      turnProvenance(
        startedAt,
        opts.timeoutMs,
        profileDigest,
        taskDigest,
        materialization,
        executionBinding,
        correlation,
      ),
    )
  } catch (err) {
    // The turn is over, so a pending receipt cannot still resolve. `backend_start` already
    // carried the pending value, where it was true; the final event must name the terminal
    // outcome instead of a wait that has ended.
    if (
      materialization?.status === 'unknown' &&
      materialization.reason === 'executor-receipt-pending' &&
      executionBinding?.status === 'unknown'
    ) {
      const terminal = unknownMaterializationReceipt({
        ...(materialization.authoredProfileDigest === undefined
          ? {}
          : { authoredProfileDigest: materialization.authoredProfileDigest }),
        runtime: materialization.runtime,
        reason: 'executor-failed-before-receipt',
      })
      executionBinding = unknownExecutionBindingReceipt(
        terminal,
        executionBinding.attemptId,
        'executor-failed-before-receipt',
      )
      materialization = terminal
    }
    const callerAborted = opts.signal?.aborted === true
    const sandboxProjection = acc.sandboxOutcome
      ? projectSandboxOutcome(acc.sandboxOutcome)
      : undefined
    const status: AgentTaskStatus = callerAborted
      ? 'aborted'
      : (sandboxProjection?.status ?? 'failed')
    const message = sandboxProjection?.reason ?? (err instanceof Error ? err.message : String(err))
    const error: BackendErrorDetail =
      sandboxProjection?.error ??
      (err instanceof BackendTransportError
        ? { kind: 'transport', message, status: err.status, body: err.body }
        : { kind: 'backend', message })
    // The turn's own deadline is not the caller's cancellation, and a failure the Sandbox reported
    // is classified from its outcome, the same source as `status`, `reason` and `error` above.
    const deadlineExpired = !callerAborted && deadline.signal.aborted
    const failure =
      callerAborted || deadlineExpired || sandboxProjection?.failure === undefined
        ? runtimeFailureCause(err, { signal: opts.signal, deadlineExpired })
        : sandboxProjection.failure
    yield {
      type: 'backend_error',
      task,
      ...(session ? { session } : {}),
      backend: label,
      message,
      recoverable: !callerAborted,
      error,
      failure,
      timestamp: nowIso(),
    }
    yield buildFinalEvent(
      task,
      session,
      acc,
      { status, reason: message, error, failure },
      turnProvenance(
        startedAt,
        opts.timeoutMs,
        profileDigest,
        taskDigest,
        materialization,
        executionBinding,
        correlation,
      ),
    )
  } finally {
    if (executor) {
      await awaitAbortable(
        Promise.resolve().then(() => executor!.teardown('brutalKill')),
        deadline.signal,
      ).catch(() => undefined)
    }
    deadline.dispose()
  }
}

function assertExactExecutorEvidence(
  materialization: ProfileMaterializationReceipt,
  executionBinding: ExecutionBindingReceipt,
): void {
  if (materialization.status !== 'known' || executionBinding.status !== 'known') {
    throw new ValidationError(
      'streamAgentTurn: exact profile execution requires terminally validated Runtime materialization and execution binding evidence',
    )
  }
  if (materialization.effectiveProfileDigest !== materialization.authoredProfileDigest) {
    throw new ValidationError(
      'streamAgentTurn: executor changed the authored AgentProfile; exact turn execution refuses profile overlays',
    )
  }
}

/**
 * Drain a `streamAgentTurn` stream (or any `RuntimeStreamEvent` stream that
 * honors its terminal contract) into the turn summary plus the full event
 * list. Fail-loud: throws when the stream ends without a terminal `final`
 * event — a stream that violates the contract must not read as an empty turn.
 *
 * @stable
 */
export async function collectAgentTurn(
  stream: AsyncIterable<RuntimeStreamEvent>,
): Promise<CollectedAgentTurn> {
  const events: RuntimeStreamEvent[] = []
  for await (const event of stream) events.push(event)
  const final = events.at(-1)
  if (final?.type !== 'final') {
    throw new Error(
      `collectAgentTurn: stream ended without a terminal 'final' event (last: ${final ? final.type : 'none'})`,
    )
  }
  const metadata = final.metadata ?? {}
  const resultMetadata =
    metadata.result && typeof metadata.result === 'object'
      ? (metadata.result as Record<string, unknown>)
      : undefined
  const sandboxOutcome =
    metadata.sandboxOutcome && typeof metadata.sandboxOutcome === 'object'
      ? (metadata.sandboxOutcome as AgentRunOutcome)
      : undefined
  const tokenUsage =
    metadata.tokenUsage && typeof metadata.tokenUsage === 'object'
      ? (metadata.tokenUsage as Record<string, unknown>)
      : {}
  const usage: AgentTurnUsage = {
    input: finiteNumber(tokenUsage.input) ?? 0,
    output: finiteNumber(tokenUsage.output) ?? 0,
    ...(metadata.tokensKnown === false ? { tokensKnown: false as const } : {}),
  }
  const costUsd = finiteNumber(metadata.costUsd)
  if (costUsd !== undefined) usage.costUsd = costUsd
  if (metadata.usdKnown === false) usage.usdKnown = false
  const estimatedCostUsd = finiteNumber(metadata.estimatedCostUsd)
  if (estimatedCostUsd !== undefined) usage.estimatedCostUsd = estimatedCostUsd
  if (metadata.promptCache && typeof metadata.promptCache === 'object') {
    usage.promptCache = metadata.promptCache as Record<string, number | string>
  }
  const reasoningTokens = finiteNumber(metadata.reasoningTokens)
  if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens
  if (typeof metadata.model === 'string' && metadata.model.length > 0) {
    usage.model = metadata.model
  }
  const transportAttempts = finiteNumber(metadata.transportAttempts)
  const toolCalls = events
    .filter((event) => event.type === 'tool_call')
    .map((event) => ({
      ...(event.toolCallId ? { id: event.toolCallId } : {}),
      name: event.toolName,
      arguments: typeof event.args === 'string' ? event.args : JSON.stringify(event.args ?? {}),
    }))
  return {
    finalText: final.text ?? '',
    ...(resultMetadata && 'output' in resultMetadata ? { output: resultMetadata.output } : {}),
    usage,
    ...(transportAttempts !== undefined ? { transportAttempts } : {}),
    toolCalls,
    events,
    status: final.status,
    ...(final.error ? { error: final.error } : {}),
    ...(sandboxOutcome ? { sandboxOutcome } : {}),
  }
}

/**
 * Drop a child-task update this turn already published. The provider's `sourceEventId` names one
 * exact update, so a reconnect or replay that repeats it must not add a second child.
 */
function childTaskAlreadySeen(event: RuntimeStreamEvent, seen: Set<string>): boolean {
  if (event.type !== 'child-task') return false
  if (seen.has(event.sourceEventId)) return true
  seen.add(event.sourceEventId)
  return false
}

function materializedModel(
  receipt: ProfileMaterializationReceipt | undefined,
  profile: AgentProfile,
): string | undefined {
  if (receipt?.status === 'known' && receipt.model.status === 'known') return receipt.model.id
  const fallback = profile.model?.default
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : undefined
}
