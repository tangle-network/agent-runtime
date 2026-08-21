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
 *   - `box`      — `mapSandboxEvent` + `extractLlmCallEvent` (sandbox-events.ts)
 *                  project the sandbox event stream; its requested profile is
 *                  explicitly recorded as unverified because the box already exists.
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

import { scoreKnowledgeReadiness } from '@tangle-network/agent-eval'
import {
  type AgentProfile,
  canonicalCandidateDigest,
  renderInputPartsAsText,
} from '@tangle-network/agent-interface'
import type { AgentTurnInput } from '@tangle-network/agent-interface/environment-provider'
import type { PromptOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { type AgentRunOutcome, createAgentRunOutcomeTracker } from '@tangle-network/sandbox/runtime'
import { normalizeBackendStreamEvent } from '../backends'
import { BackendTransportError, ValidationError } from '../errors'
import { newRuntimeSession, nowIso } from '../sessions'
import type {
  AgentBackendInput,
  AgentExecutionBackend,
  AgentTaskSpec,
  AgentTaskStatus,
  BackendErrorDetail,
  RuntimeSession,
  RuntimeStreamEvent,
} from '../types'
import { awaitAbortable } from './retained-run-binding'
import {
  canonicalStreamEventFromSandboxEvent,
  createSandboxToolPartState,
  mapSandboxEvent,
  mapSandboxToolEvent,
} from './sandbox-events'
import { projectSandboxOutcome, readSandboxOutcome } from './sandbox-outcome'
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
  ExecutorProgressEvent,
  ExecutorResult,
  NodeExecutionIdentity,
  ProfileMaterializationReceipt,
  UsageEvent,
} from './supervise/types'
import {
  promptFromAgentTurnInput,
  promptOptionsFromAgentTurnInput,
  providerMessageText,
} from './turn-input'

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

/** Lower-level observation adapters. They normalize an already-created execution surface but do
 * not bind an AgentProfile to it, so they are deliberately absent from the public kernel export. */
type ObservedAgentTurnBackend =
  | {
      /** A live sandbox box: the turn is one `box.streamPrompt(prompt)` call. */
      kind: 'box'
      box: SandboxInstance
      /**
       * Per-turn `PromptOptions` forwarded verbatim to `streamPrompt`
       * (`sessionId`, `turnId`, `model`, `backend` profile, `timeoutMs`, …).
       * The turn's derived abort signal (caller `signal` + `timeoutMs`
       * deadline) is always installed as `signal` — pass cancellation through
       * `StreamAgentTurnOptions`, not here.
       */
      options?: Omit<PromptOptions, 'signal'>
      /** Model label stamped on cost-only `llm_call` events. Default `'agent'`. */
      agentRunName?: string
    }
  | {
      /**
       * A caller-supplied in-process `AgentExecutionBackend`: the turn is one
       * `backend.stream()` call.
       */
      kind: 'chat'
      backend: AgentExecutionBackend
    }

export type { AgentTurnInput } from '@tangle-network/agent-interface/environment-provider'

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

function turnBackendInput(task: AgentTaskSpec, input: AgentTurnInput): AgentBackendInput {
  return {
    task,
    ...(input.prompt === undefined ? {} : { message: input.prompt }),
    ...(input.parts === undefined ? {} : { parts: structuredClone(input.parts) }),
    ...(input.interactions === undefined ? {} : { interactions: input.interactions }),
    ...(input.providerOptions === undefined
      ? {}
      : { providerOptions: structuredClone(input.providerOptions) }),
  }
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

/** Mutable per-turn accumulator threaded through the backend adapters. */
interface TurnAccumulator {
  /** Concatenated incremental text (`text_delta` events). */
  deltaText: string
  /** Final text read off a terminal `result`/`done`/`final` event, when the
   *  backend emitted one. Preferred over `deltaText` for box streams, whose
   *  `message.part.updated` fallback carries running accumulations. */
  terminalText?: string
  input: number
  output: number
  costUsd: number
  estimatedCostUsd: number
  sawEstimatedCost: boolean
  promptCache: Record<string, number | string>
  reasoningTokens?: number
  tokensKnown: boolean
  usdKnown: boolean
  sawLlmCall: boolean
  sawTokenUsage: boolean
  sawCostUsage: boolean
  model?: string
  stopReason?: string
  transportAttempts?: number
  result?: ExecutorResult<unknown>
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

function assertTurnTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs === undefined) return
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new ValidationError('streamAgentTurn: timeoutMs must be an integer from 1 to 2147483647')
  }
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
    yield {
      type: 'backend_error',
      task,
      ...(session ? { session } : {}),
      backend: label,
      message,
      recoverable: !callerAborted,
      error,
      timestamp: nowIso(),
    }
    yield buildFinalEvent(
      task,
      session,
      acc,
      { status, reason: message, error },
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

/** Start the backend's session when it owns one (`chat` kind); mint a local
 *  correlation session otherwise. Box/executor turns carry no server session
 *  here — resume lives in `openSandboxRun`/`SandboxLineage`, not this primitive. */
async function startTurnSession(
  backend: AgentTurnBackend | ObservedAgentTurnBackend,
  task: AgentTaskSpec,
  input: AgentTurnInput,
  signal: AbortSignal,
  label: string,
): Promise<RuntimeSession> {
  if (backend.kind === 'chat' && backend.backend.start) {
    return backend.backend.start(turnBackendInput(task, input), {
      task,
      knowledge: emptyReadiness(task),
      signal,
    })
  }
  return newRuntimeSession(label)
}

/** Box-drive configuration derived from the backend kind + turn options. */
interface BoxTurnConfig {
  /** Caller `PromptOptions` forwarded to `streamPrompt`; the turn's derived
   *  signal is installed over any caller value. */
  options?: Omit<PromptOptions, 'signal'>
  /** Project tool parts to `tool_call`/`tool_result` (see `mapSandboxToolEvent`). */
  preserveToolParts: boolean
  /** Awaited raw-event tap, before projection. */
  onRawEvent?: (event: SandboxEvent) => void | Promise<void>
}

/**
 * One turn over a box: `box.streamPrompt` projected through the existing
 * `mapSandboxEvent` (text/reasoning deltas +
 * cost-bearing `llm_call`s), plus the opt-in `mapSandboxToolEvent` tool-part
 * projection. Usage accumulates off the mapped `llm_call` events — the same
 * fold `sumSandboxUsage` applies. Final text prefers the terminal
 * `result`/`done`/`final` payload over concatenated deltas, because the
 * sandbox `message.part.updated` fallback may carry running accumulations.
 */
async function* driveBoxTurn(
  box: SandboxInstance,
  input: AgentTurnInput,
  signal: AbortSignal,
  agentRunName: string,
  acc: TurnAccumulator,
  cfg: BoxTurnConfig,
): AsyncGenerator<RuntimeStreamEvent> {
  const callOptions: PromptOptions = { ...(cfg.options ?? {}), signal }
  const stream = box.streamPrompt(promptFromAgentTurnInput(input), {
    ...callOptions,
    ...promptOptionsFromAgentTurnInput(input),
    signal,
  })
  const toolParts = cfg.preserveToolParts ? createSandboxToolPartState() : undefined
  const outcomeTracker = createAgentRunOutcomeTracker()
  for await (const event of abortableValues(stream, signal)) {
    outcomeTracker.observe(event)
    if (cfg.onRawEvent) {
      await awaitAbortable(
        Promise.resolve().then(() => cfg.onRawEvent!(event)),
        signal,
      )
    }
    const terminalText = terminalTextFromSandboxEvent(event)
    if (terminalText !== undefined) acc.terminalText = terminalText
    const canonical = canonicalStreamEventFromSandboxEvent(event)
    if (canonical) {
      yield canonical
      continue
    }

    if (toolParts) {
      for (const toolEvent of mapSandboxToolEvent(event, toolParts)) {
        yield toolEvent
      }
    }
    const mapped = mapSandboxEvent(event, { agentRunName })
    if (mapped) {
      // `mapSandboxEvent` stamps `agentRunName` as the model label when the
      // event carried none — a run label, not a reported model. Exclude it from
      // the terminal usage so `usage.model` is never a fabricated value.
      foldEvent(mapped, acc, agentRunName)
      yield mapped
    }

    // Unknown provider events stay available through onRawEvent. Do not copy
    // arbitrary provider payloads into the public stream.
  }
  acc.sandboxOutcome = outcomeTracker.finish()
  const projection = projectSandboxOutcome(acc.sandboxOutcome)
  if (projection.status === 'failed') {
    throw new Error(projection.reason)
  }
}

/** One turn over an in-process backend: its own `stream()` surface, projected
 *  through the same `normalizeBackendStreamEvent` the task lifecycle applies. */
async function* driveChatTurn(
  backend: AgentExecutionBackend,
  task: AgentTaskSpec,
  session: RuntimeSession,
  input: AgentTurnInput,
  signal: AbortSignal,
  acc: TurnAccumulator,
): AsyncGenerator<RuntimeStreamEvent> {
  const backendInput = turnBackendInput(task, input)
  const context = { task, knowledge: emptyReadiness(task), session, signal }
  for await (const raw of abortableValues(backend.stream(backendInput, context), signal)) {
    const event = normalizeBackendStreamEvent(raw, task, session)
    foldEvent(event, acc)
    yield event
  }
}

async function* driveExecutorTurn(
  executor: Executor<unknown>,
  task: AgentTaskSpec,
  session: RuntimeSession,
  input: AgentTurnInput,
  signal: AbortSignal,
  acc: TurnAccumulator,
  declaredModel: string | undefined,
): AsyncGenerator<RuntimeStreamEvent> {
  const taskValue = executorTaskValue(input)
  const run = executor.execute(taskValue, signal)
  let result: ExecutorResult<unknown>
  if (isAsyncIterable(run)) {
    for await (const usage of abortableValues(run, signal)) {
      if (usage.kind === 'progress') {
        const projected = executorProgressStreamEvent(usage.progress, task, session)
        foldEvent(projected, acc)
        yield projected
        throwIfAborted(signal)
        continue
      }
      foldUsageEvent(usage, acc)
      throwIfAborted(signal)
    }
    result = executor.resultArtifact()
  } else {
    result = await awaitAbortable(run, signal)
  }
  acc.result = result
  acc.sandboxOutcome = readSandboxOutcome(result.out)
  acc.terminalText = executorResultText(result.out)
  acc.input = result.spent.tokens.input
  acc.output = result.spent.tokens.output
  acc.costUsd = result.spent.usd
  const estimatedCostUsd = executorResultEstimatedCost(result.out)
  if (estimatedCostUsd !== undefined) {
    acc.estimatedCostUsd = estimatedCostUsd
    acc.sawEstimatedCost = true
  }
  Object.assign(acc.promptCache, executorResultPromptCache(result.out))
  acc.reasoningTokens = executorResultReasoningTokens(result.out)
  acc.tokensKnown = result.spent.tokensKnown !== false
  acc.usdKnown = result.spent.usdKnown !== false
  acc.sawLlmCall = true

  // Usage model identity is observational: the executor must report what answered. The profile's
  // declared model remains available in materialization evidence, but it is not fabricated into
  // `usage.model` when the provider/transport omitted an actual response model.
  const model = executorResultModel(result.out)
  if (model) acc.model = model
  acc.stopReason = executorResultStopReason(result.out)
  acc.transportAttempts = executorResultTransportAttempts(result.out)
  const latencyMs = result.spent.ms
  yield {
    type: 'llm_call',
    task,
    session,
    model: model ?? declaredModel ?? executor.runtime,
    ...(acc.tokensKnown ? { tokensIn: acc.input, tokensOut: acc.output } : {}),
    ...(acc.usdKnown ? { costUsd: acc.costUsd } : {}),
    ...(acc.tokensKnown ? {} : { tokensKnown: false }),
    ...(acc.usdKnown ? {} : { usdKnown: false }),
    ...(acc.sawEstimatedCost ? { estimatedCostUsd: acc.estimatedCostUsd } : {}),
    ...(Object.keys(acc.promptCache).length > 0 ? { promptCache: acc.promptCache } : {}),
    latencyMs,
    timestamp: nowIso(),
  }
  for (const call of executorResultToolCalls(result.out)) {
    yield {
      type: 'tool_call',
      task,
      session,
      toolName: call.name,
      ...(call.id ? { toolCallId: call.id } : {}),
      args: call.arguments,
      timestamp: nowIso(),
    }
  }
  yield {
    type: 'artifact',
    task,
    session,
    artifactId: result.outRef,
    name: 'agent-turn-result',
    metadata: {
      spend: result.spent,
      ...(result.verdict ? { verdict: result.verdict } : {}),
    },
    timestamp: nowIso(),
  }
  if (acc.sandboxOutcome && projectSandboxOutcome(acc.sandboxOutcome).status === 'failed') {
    throw new Error(projectSandboxOutcome(acc.sandboxOutcome).reason)
  }
}

function executorTaskValue(input: AgentTurnInput): unknown {
  const messages = input.providerOptions?.messages
  if (Array.isArray(messages)) {
    return { messages: structuredClone(messages) }
  }
  return {
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    ...(input.parts === undefined ? {} : { parts: structuredClone(input.parts) }),
    ...(input.interactions === undefined ? {} : { interactions: input.interactions }),
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<UsageEvent> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value
}

/**
 * Pull one provider iterator under Runtime's deadline.
 *
 * Providers still receive the signal for native cancellation, but correctness
 * does not depend on them observing it. A losing iterator is asked to close;
 * its late rejection is observed and cannot delay the terminal Runtime event.
 */
async function* abortableValues<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]()
  let completed = false
  try {
    for (;;) {
      const next = await awaitAbortable(
        Promise.resolve().then(() => iterator.next()),
        signal,
      )
      if (next.done) {
        completed = true
        return
      }
      yield next.value
    }
  } finally {
    if (!completed) {
      try {
        void Promise.resolve(iterator.return?.()).catch(() => undefined)
      } catch {
        // The Runtime deadline already owns the observable terminal result.
      }
    }
  }
}

function executorResultText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const content = (value as Record<string, unknown>).content
  return typeof content === 'string' ? content : ''
}

function executorResultModel(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const model = (value as Record<string, unknown>).model
  return typeof model === 'string' && model.length > 0 ? model : undefined
}

function executorResultStopReason(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const reason = (value as Record<string, unknown>).finishReason
  return typeof reason === 'string' && reason.length > 0 ? reason : undefined
}

function executorResultTransportAttempts(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const attempts = (value as Record<string, unknown>).transportAttempts
  return typeof attempts === 'number' && Number.isSafeInteger(attempts) && attempts > 0
    ? attempts
    : undefined
}

function executorResultEstimatedCost(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  return finiteNumber((value as Record<string, unknown>).estimatedCostUsd)
}

function executorResultPromptCache(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== 'object') return {}
  const raw = (value as Record<string, unknown>).promptCache
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const cache: Record<string, number | string> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if ((typeof entry === 'number' && Number.isFinite(entry)) || typeof entry === 'string') {
      cache[key] = entry
    }
  }
  return cache
}

function executorResultReasoningTokens(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const count = (value as Record<string, unknown>).reasoningTokens
  return Number.isSafeInteger(count) && (count as number) >= 0 ? (count as number) : undefined
}

/**
 * Read the terminal tool calls an executor artifact published. Every Runtime-owned executor
 * reports `ExecutorToolCall[]`, so an artifact carrying any other shape is a defect in that
 * executor rather than a turn without tool calls: refuse it instead of dropping the calls.
 */
function executorResultToolCalls(
  value: unknown,
): Array<{ id?: string; name: string; arguments: string }> {
  if (!value || typeof value !== 'object') return []
  const raw = (value as Record<string, unknown>).toolCalls
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    throw new ValidationError(
      `streamAgentTurn: executor artifact toolCalls must be an ExecutorToolCall array, received ${typeof raw}`,
    )
  }
  return raw.map((entry) => {
    const call = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined
    if (!call || typeof call.name !== 'string' || call.name.length === 0) {
      throw new ValidationError(
        'streamAgentTurn: executor artifact toolCalls entries require a non-empty name',
      )
    }
    return {
      ...(typeof call.id === 'string' ? { id: call.id } : {}),
      name: call.name,
      arguments:
        typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
    }
  })
}

/** Project one executor progress event onto the public turn vocabulary. */
function executorProgressStreamEvent(
  progress: ExecutorProgressEvent,
  task: AgentTaskSpec,
  session: RuntimeSession,
): RuntimeStreamEvent {
  const timestamp = nowIso()
  if (progress.kind === 'text_delta') {
    return { type: 'text_delta', task, session, text: progress.text, timestamp }
  }
  if (progress.kind === 'reasoning_delta') {
    return { type: 'reasoning_delta', task, session, text: progress.text, timestamp }
  }
  if (progress.kind === 'tool_call') {
    return {
      type: 'tool_call',
      task,
      session,
      toolName: progress.toolName,
      ...(progress.toolCallId === undefined ? {} : { toolCallId: progress.toolCallId }),
      ...(progress.args === undefined ? {} : { args: progress.args }),
      timestamp,
    }
  }
  if (progress.kind === 'tool_result') {
    return {
      type: 'tool_result',
      task,
      session,
      toolName: progress.toolName,
      ...(progress.toolCallId === undefined ? {} : { toolCallId: progress.toolCallId }),
      ...(progress.result === undefined ? {} : { result: progress.result }),
      timestamp,
    }
  }
  if (progress.kind === 'child_task') {
    return { ...progress.event, task, session, timestamp }
  }
  return { type: 'interaction', request: progress.request, task, session, timestamp }
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

/** Fold one normalized executor usage event into the turn accumulator. */
function foldUsageEvent(event: UsageEvent, acc: TurnAccumulator): void {
  if (event.kind === 'tokens') {
    const known = event.tokensKnown !== false
    acc.tokensKnown = acc.sawTokenUsage ? acc.tokensKnown && known : known
    acc.sawTokenUsage = true
    acc.input += event.input
    acc.output += event.output
  } else if (event.kind === 'cost') {
    const known = event.usdKnown
    acc.usdKnown = acc.sawCostUsage ? acc.usdKnown && known : known
    acc.sawCostUsage = true
    acc.costUsd += event.usd
    if (event.usdKnown === false && event.usdEstimated !== undefined) {
      acc.estimatedCostUsd += event.usdEstimated
      acc.sawEstimatedCost = true
    }
  }
  if (event.kind === 'tokens' || event.kind === 'cost') acc.sawLlmCall = true
}

/** Fold one normalized event into the turn accumulator (text + usage).
 *  `fallbackModelLabel` — a mapper-stamped run label to exclude from
 *  `usage.model` (it is not a backend-reported model). */
function foldEvent(
  event: RuntimeStreamEvent,
  acc: TurnAccumulator,
  fallbackModelLabel?: string,
): void {
  if (event.type === 'text_delta') {
    acc.deltaText += event.text
    return
  }
  if (event.type === 'llm_call') {
    const tokensReported =
      event.tokensKnown !== false && event.tokensIn !== undefined && event.tokensOut !== undefined
    const usdReported = event.usdKnown !== false && event.costUsd !== undefined
    if (!acc.sawLlmCall) {
      acc.tokensKnown = tokensReported
      acc.usdKnown = usdReported
      acc.sawLlmCall = true
    } else {
      acc.tokensKnown &&= tokensReported
      acc.usdKnown &&= usdReported
    }
    acc.input += event.tokensIn ?? 0
    acc.output += event.tokensOut ?? 0
    acc.costUsd += event.costUsd ?? 0
    if (event.estimatedCostUsd !== undefined) {
      acc.estimatedCostUsd += event.estimatedCostUsd
      acc.sawEstimatedCost = true
    }
    if (event.promptCache) Object.assign(acc.promptCache, event.promptCache)
    if (event.model && event.model !== fallbackModelLabel) acc.model = event.model
  }
}

/** Read the final text off a terminal sandbox event, when present. */
function terminalTextFromSandboxEvent(event: SandboxEvent): string | undefined {
  if (!event || typeof event !== 'object') return undefined
  const type = String(event.type ?? '')
  if (type !== 'result' && type !== 'done' && type !== 'final') return undefined
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  for (const key of ['finalText', 'text', 'response', 'content']) {
    const value = data[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function buildFinalEvent(
  task: AgentTaskSpec,
  session: RuntimeSession | undefined,
  acc: TurnAccumulator,
  outcome: { status: AgentTaskStatus; reason: string; error?: BackendErrorDetail },
  provenance: Record<string, unknown>,
): RuntimeStreamEvent {
  const finalText = acc.terminalText ?? acc.deltaText
  return {
    type: 'final',
    task,
    ...(session ? { session } : {}),
    status: outcome.status,
    reason: outcome.status === 'completed' ? (acc.stopReason ?? outcome.reason) : outcome.reason,
    ...(finalText ? { text: finalText } : {}),
    metadata: {
      tokenUsage: { input: acc.input, output: acc.output },
      ...(acc.tokensKnown ? {} : { tokensKnown: false }),
      ...(acc.usdKnown ? { costUsd: acc.costUsd } : { usdKnown: false }),
      ...(acc.sawEstimatedCost ? { estimatedCostUsd: acc.estimatedCostUsd } : {}),
      ...(Object.keys(acc.promptCache).length > 0 ? { promptCache: acc.promptCache } : {}),
      ...(acc.reasoningTokens !== undefined ? { reasoningTokens: acc.reasoningTokens } : {}),
      ...(acc.model ? { model: acc.model } : {}),
      ...(acc.stopReason ? { stopReason: acc.stopReason } : {}),
      ...(acc.transportAttempts !== undefined ? { transportAttempts: acc.transportAttempts } : {}),
      ...(acc.sandboxOutcome
        ? {
            sandboxOutcome: acc.sandboxOutcome,
            verdict: projectSandboxOutcome(acc.sandboxOutcome).verdict,
          }
        : {}),
      ...(acc.result
        ? {
            result: {
              outRef: acc.result.outRef,
              output: acc.result.out,
              ...(acc.sandboxOutcome
                ? { verdict: projectSandboxOutcome(acc.sandboxOutcome).verdict }
                : acc.result.verdict
                  ? { verdict: acc.result.verdict }
                  : {}),
              spent: acc.result.spent,
            },
          }
        : acc.sandboxOutcome
          ? { result: { verdict: projectSandboxOutcome(acc.sandboxOutcome).verdict } }
          : {}),
      ...provenance,
    },
    ...(outcome.error ? { error: outcome.error } : {}),
    timestamp: nowIso(),
  }
}

function materializedModel(
  receipt: ProfileMaterializationReceipt | undefined,
  profile: AgentProfile,
): string | undefined {
  if (receipt?.status === 'known' && receipt.model.status === 'known') return receipt.model.id
  const fallback = profile.model?.default
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : undefined
}

/** Minimal ready-by-construction readiness report for a requirement-free turn. */
function emptyReadiness(task: AgentTaskSpec) {
  return scoreKnowledgeReadiness({ taskId: task.id, requirements: [] })
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))
}

/**
 * Derive the turn's effective abort signal: fires when EITHER the caller's
 * signal aborts OR the `timeoutMs` deadline elapses. `dispose()` clears the
 * timer so a finished turn never leaks a pending timeout. `timeoutMs <= 0`
 * disables the deadline. Node-portable (no `AbortSignal.any`, which needs
 * >=20.3 — the package floor is >=20).
 */
function deriveTurnSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer =
    timeoutMs > 0
      ? setTimeout(
          () => controller.abort(new Error(`agent turn timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      : undefined
  if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
    ;(timer as { unref: () => void }).unref()
  }
  const onCallerAbort = () =>
    controller.abort(callerSignal?.reason ?? new Error('agent turn aborted'))
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort()
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}
