/** Bridge executor lifecycle, steering, materialization, and measured usage. */

import { randomUUID } from 'node:crypto'
import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import { agentHarness } from '../harness-role'
import { linkAbort } from './abortable'
import {
  type BridgeSeam,
  bridgeRuntimeAttachmentsKey,
  bridgeSeamKey,
  bridgeStopSignalKey,
  maxBridgeTimeoutMs,
  type ResolvedBridgeSeam,
  validateBridgeModelCredential,
} from './bridge-config'
import {
  type BridgeProfileMaterializationReceipt,
  stripMaterializationObservation,
} from './bridge-protocol'
import { streamBridgeSession } from './bridge-session-stream'
import { bridgeTranscript } from './bridge-transcript'
import {
  type ActiveBridgeRun,
  BRIDGE_CANCEL_LONG_POLL_MS,
  type BridgeRunStateRead,
  bridgeRunStateGet,
  cancelBridgeRunToTerminal,
} from './bridge-transport'
import { readOptionalAbortSignal, readOptionalMcpAttachments, readSeam } from './executor-seams'
import { createInbox, failPendingAfter } from './inbox'
import {
  attestRuntimeOwnedPendingExecutor,
  finalizeRuntimeOwnedPendingExecutor,
  newExecutionAttemptId,
  recordRuntimeOwnedProviderAttemptStart,
  recordRuntimeOwnedProviderDispatchNotStarted,
  recordRuntimeOwnedProviderIdentityConflict,
  recordRuntimeOwnedProviderModel,
} from './materialization'
import {
  assertExecutableAgentProfile,
  enforceTokenLimits,
  profileBridgeWireModel,
  profileModelExecutionSettings,
} from './model-policy'
import { type ActivityLog, createActivityLog, type ExecutorProgress } from './progress'
import { createPushTraceSource, type ToolStepInput, type TraceSource } from './trace-source'
import type {
  Executor,
  ExecutorCancellation,
  ExecutorFactory,
  ExecutorResult,
  Runtime,
  UsageEvent,
  WorkerInteractiveSession,
} from './types'
import { workerLineage } from './worker-lineage'
import { workerTraceHeaders } from './worker-trace'

/** Resolve the exact bridge wire id from the profile and nowhere else. */
export function bridgeProfileModel(profile: AgentProfile, context: string): string {
  assertExecutableAgentProfile(profile, context)
  if (!agentHarness(profile.harness)) {
    throw new ValidationError(`${context}: AgentProfile.harness must select a coding-agent harness`)
  }
  const model = profileBridgeWireModel(profile)
  if (!model) {
    throw new ValidationError(`${context}: AgentProfile did not resolve a bridge wire model`)
  }
  return model
}

export const bridgeExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const base = readSeam<BridgeSeam>(ctx, bridgeSeamKey, 'bridge')
  const stopSignal = readOptionalAbortSignal(ctx, bridgeStopSignalKey, 'bridge')
  const runtimeAttachments = readOptionalMcpAttachments(ctx, bridgeRuntimeAttachmentsKey, 'bridge')
  const modelCredential = validateBridgeModelCredential(
    base.modelCredential,
    base.bridgeUrl,
    'bridgeExecutor',
  )
  const effectiveProfile = agentProfileSchema.parse(spec.profile)
  const model = bridgeProfileModel(effectiveProfile, 'bridgeExecutor')
  const harness = agentHarness(effectiveProfile.harness)
  const providerModel =
    harness !== undefined && model.startsWith(`${harness}/`)
      ? model.slice(harness.length + 1)
      : model
  const profileExecution = profileModelExecutionSettings(effectiveProfile, 'bridgeExecutor')
  // cli-bridge lowers ONE completion cap into the run's model catalog, so only the total ceiling
  // is enforceable here; a visible-only or reasoning-only ceiling is refused before the request.
  const bridgeTokenLimits = enforceTokenLimits(
    profileExecution.tokenLimits,
    'bridge',
    'bridgeExecutor',
  )
  const seam: ResolvedBridgeSeam = {
    ...base,
    ...(modelCredential === undefined ? {} : { modelCredential }),
    model,
    providerModel,
    ...(bridgeTokenLimits.applied.maxTokens !== undefined
      ? { maxTokens: bridgeTokenLimits.applied.maxTokens }
      : {}),
  }
  if (!seam.bridgeUrl || !seam.bridgeBearer) {
    throw new ValidationError('bridgeExecutor: bridgeUrl + bridgeBearer are required')
  }
  if (seam.outputFormat !== undefined && seam.outputFormat !== 'json')
    throw new ValidationError('bridgeExecutor: outputFormat must be json when supplied')
  if (
    seam.timeoutMs !== undefined &&
    (!Number.isSafeInteger(seam.timeoutMs) ||
      seam.timeoutMs < 1 ||
      seam.timeoutMs > maxBridgeTimeoutMs)
  ) {
    throw new ValidationError(
      `bridgeExecutor: timeoutMs must be an integer from 1 to ${maxBridgeTimeoutMs}`,
    )
  }
  if (
    seam.modelSilenceMs !== undefined &&
    (!Number.isSafeInteger(seam.modelSilenceMs) ||
      seam.modelSilenceMs < 1 ||
      seam.modelSilenceMs > maxBridgeTimeoutMs)
  ) {
    throw new ValidationError(
      `bridgeExecutor: modelSilenceMs must be an integer from 1 to ${maxBridgeTimeoutMs}`,
    )
  }
  if (
    seam.maxReconnects !== undefined &&
    (!Number.isSafeInteger(seam.maxReconnects) || seam.maxReconnects < 0)
  ) {
    throw new ValidationError('bridgeExecutor: maxReconnects must be a nonnegative safe integer')
  }
  const maxTurns = profileExecution.maxTurns ?? 0
  const maxReconnects = seam.maxReconnects ?? 3
  // A stable per-spawn session id (caller can pin one) — cli-bridge keys harness
  // resume off this exactly as a box id keys a sandbox session.
  const sessionId = seam.sessionId ?? `bridge-${spec.profile.name ?? 'worker'}-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(sessionId)
  // The bridge's trace channel is the request, not an env field: the `traceparent` (+ legacy
  // pair) headers ride every turn POST, and the bridge stamps them into the harness child's
  // environment at spawn. Empty when the run records no spans, adding no header at all. Session
  // lineage (`x-tangle-*`, see `worker-lineage.ts`) rides the same headers when this process
  // carries a `TANGLE_RUN_ID`; one spawn is one run across all of its turns.
  const traceHeaders = {
    ...workerLineage({
      harness: harness ?? null,
      nodeId: ctx.node?.nodeId,
      label: spec.profile.name,
      local: false,
    }).headers,
    ...workerTraceHeaders(ctx),
  }

  const controller = linkAbort(ctx.signal)

  // The down-leg receive end: the driver's steer/answer/resume land here via `Scope.send`.
  const inbox = createInbox()
  let artifact: ExecutorResult<unknown> | undefined
  // One spawn owns one resumable session and, at most, one live durable run per
  // turn. Keep the server-owned run identities until the bridge proves each job
  // terminal; closing a response body is deliberately not terminal evidence.
  const activeRuns = new Map<string, ActiveBridgeRun>()
  const transcript = bridgeTranscript(seam, sessionId, effectiveProfile, activeRuns, ctx.node)
  // The live read-model behind `progress()`, filled as the SSE stream is consumed.
  const observation: BridgeObservation = {
    turns: 0,
    note: 'starting',
    activity: createActivityLog(seam.activityWindow ?? 12),
    derived: [],
    refreshedAt: 0,
    refreshing: false,
    closed: false,
  }
  // One push source per SPAWN, not per turn: a steered worker's turn 4 tool calls belong to the
  // same trace as its turn 0 calls, and `collect()` must still answer after the stream drains.
  const trace = createPushTraceSource({ runId: sessionId })

  // Interface's AgentExecutionPreparationReceipt cannot be reused here yet: it is a pre-compute
  // contract requiring an execution-bound workspace lease, source/prepared workspace digests,
  // profile-activation evidence, and full per-axis ownership. cli-bridge currently has only its
  // terminal applied WorkspacePlan acknowledgement. Keep that acknowledgement explicitly terminal,
  // bind it into Runtime's existing declaration, and never present this planned declaration as
  // evidence that the remote process actually used it.
  const plannedDeclaration = {
    effectiveProfile,
    backend: 'bridge',
    model: { status: 'known' as const, id: seam.model },
    execution: { kind: 'session', id: sessionId },
    materializer: 'cli-bridge-agent-profile',
    plan: {
      kind: 'cli-bridge-session',
      cwd: seam.cwd ?? null,
      maxTurns,
      maxReconnects,
      timeoutMs: seam.timeoutMs ?? null,
      streaming: true,
      tokenLimits: bridgeTokenLimits,
      terminalAcknowledgement: null,
    },
  }
  const plannedBinding = {
    attemptId,
    binding: {
      bridgeUrl: seam.bridgeUrl,
      cwd: seam.cwd ?? null,
      effectiveProfile,
      model: seam.model,
      sessionId,
    },
    descriptor: { kind: 'bridge-session', transport: 'http', backend: 'bridge' },
  }
  let acknowledged: BridgeProfileMaterializationReceipt | undefined
  let executor!: Executor<unknown>
  executor = {
    runtime: 'cli' as Runtime,
    ...transcript.ports,
    deliver: (m) => inbox.deliver(m),
    /**
     * The LIVE read of this worker, answered entirely from local mirrors so it is synchronous
     * and cannot block or fail the run. The bridge's own run state is refreshed OUT OF BAND —
     * a read schedules a fetch whose answer lands for the NEXT read — because the executor
     * cannot know from its own stream whether a silent run is thinking, detached mid-reconnect,
     * or already cancelled server-side, and that is exactly the distinction a supervisor's
     * respawn decision turns on.
     */
    progress: (): ExecutorProgress | undefined => {
      try {
        scheduleBridgeRunStateRefresh(seam, activeRuns, observation)
        return {
          turns: observation.turns,
          pendingMessages: inbox.pending(),
          recentActivity: observation.activity.read(),
          ...(observation.derived.length > 0 ? { derived: [...observation.derived] } : {}),
          note: bridgeProgressNote(observation, liveBridgeRunId(activeRuns)),
        }
      } catch {
        return undefined
      }
    },
    traceSource: (): TraceSource => trace.source,
    // CLI Bridge starts headless subprocesses and keeps only a LOGICAL resume id. Its server
    // publishes no PTY or terminal-session contract, so there is nothing to attach a human
    // terminal to; saying so beats letting the worker look merely headless.
    interactive: (): WorkerInteractiveSession =>
      Object.freeze({
        status: 'unavailable' as const,
        reason: 'provider-has-no-interactive-contract',
      }),
    execute(task, signal): AsyncIterable<UsageEvent> {
      const session = streamBridgeSession({
        task,
        signal,
        ...(stopSignal === undefined ? {} : { stopSignal }),
        ...(runtimeAttachments === undefined ? {} : { runtimeAttachments }),
        profile: effectiveProfile,
        seam,
        sessionId,
        maxTurns,
        maxReconnects,
        traceHeaders,
        inbox,
        controller,
        activeRuns,
        observation,
        record: (step: ToolStepInput) => {
          trace.record(step)
        },
        onProviderAttemptStart: () => recordRuntimeOwnedProviderAttemptStart(executor),
        onProviderDispatchNotStarted: () => recordRuntimeOwnedProviderDispatchNotStarted(executor),
        onProviderModel: (model) => recordRuntimeOwnedProviderModel(executor, model),
        onProviderIdentityConflict: () => recordRuntimeOwnedProviderIdentityConflict(executor),
        onArtifact: (a) => {
          artifact = a
        },
        onProfileMaterialization: (receipt) => {
          if (acknowledged !== undefined) {
            if (
              JSON.stringify(stripMaterializationObservation(acknowledged)) !==
              JSON.stringify(stripMaterializationObservation(receipt))
            ) {
              throw new ValidationError(
                'bridgeExecutor: profile materialization changed across session turns',
              )
            }
            return
          }
          acknowledged = receipt
          finalizeRuntimeOwnedPendingExecutor(
            executor,
            {
              ...plannedDeclaration,
              plan: { ...plannedDeclaration.plan, terminalAcknowledgement: receipt },
            },
            plannedBinding,
          )
        },
      })
      return transcript.settle(failPendingAfter(inbox, session))
    },
    async cancel(request): Promise<ExecutorCancellation> {
      // The bridge OWNS a cancel operation and reports terminal state, so this arm can answer with
      // provider evidence instead of a local abort.
      const live = [...activeRuns.values()].filter((run) => !run.terminal)
      const observedAt = () => new Date().toISOString()
      if (live.length === 0) {
        return {
          status: 'already-terminal',
          effect: 'not_live',
          observedAt: observedAt(),
          detail: 'every bridge run for this session was already terminal',
          evidence: { runs: [...activeRuns.keys()] },
        }
      }
      controller.abort('executor cancelled')
      const grace = request.signal === undefined ? 'infinity' : BRIDGE_CANCEL_LONG_POLL_MS
      const terminal = await Promise.all(
        live.map((run) => cancelBridgeRunToTerminal(seam, run, grace, request.signal)),
      )
      const evidence = {
        operationId: request.operationId,
        runs: live.map((run, index) => ({ id: run.id, terminal: terminal[index] === true })),
      }
      if (terminal.every(Boolean)) {
        return {
          status: 'accepted',
          effect: 'cancelled',
          observedAt: observedAt(),
          detail: 'the bridge reported every run terminal after the cancel operation',
          evidence,
        }
      }
      return {
        status: 'unknown',
        effect: 'cancel_requested',
        observedAt: observedAt(),
        detail:
          'the bridge accepted the cancel operation but a run had not reached terminal state within the deadline',
        evidence,
      }
    },
    async teardown(grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      const remaining = [...activeRuns.values()].filter((run) => !run.terminal)
      if (remaining.length === 0) return { destroyed: true }
      const terminal = await Promise.all(
        remaining.map((run) => cancelBridgeRunToTerminal(seam, run, grace)),
      )
      return { destroyed: terminal.every(Boolean) }
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError('bridgeExecutor: resultArtifact() read before stream drained')
      }
      return { ...artifact, spent: artifact.spent }
    },
  }
  return attestRuntimeOwnedPendingExecutor(executor, 'cli', plannedDeclaration, plannedBinding)
}

/** Everything `bridgeExecutor.progress()` answers from. Every field is written by the turn loop as
 *  the stream is consumed, so the read itself touches no I/O and cannot block the run. */
export interface BridgeObservation {
  turns: number
  note: string
  readonly activity: ActivityLog
  /** Append-only record of what this executor changed about the caller's declaration. */
  readonly derived: string[]
  /** Newest bridge-side run snapshot; written by the out-of-band refresh, never awaited. */
  runState?: BridgeRunStateRead
  /** When the last refresh was STARTED — the rate limit, so a hot observe loop can't hammer. */
  refreshedAt: number
  refreshing: boolean
  /** Set once the bridge reports the run terminal, or the stream ends. Stops all further reads. */
  closed: boolean
}

/** Minimum spacing between out-of-band run-state reads. A driver polling `observe_agent` in a
 *  tight loop must not turn an observability read into load on the bridge. */
const BRIDGE_RUN_STATE_REFRESH_MS = 1_000

/** One human-readable line: the local turn phase, plus the bridge's own run state when a snapshot
 *  has been read for a run that is still live. The snapshot's AGE is stated because a driver
 *  reading "running" must be able to tell a fresh read from a 40-second-old one; and once this
 *  executor holds terminal proof the line is DROPPED rather than left repeating a last-known
 *  "running" that stopped being true the moment the run ended. */
function bridgeProgressNote(observation: BridgeObservation, liveRunId: string | undefined): string {
  const run = observation.runState
  if (!run || run.runId !== liveRunId) return observation.note
  const age = Math.max(0, Date.now() - run.at)
  return `${observation.note} · bridge run ${run.state} (status ${run.status}, seq ${run.lastSeq}, read ${age}ms ago)`
}

/** The run this executor still believes live, if any — the one worth reporting on and the only one
 *  worth asking the bridge about. */
function liveBridgeRunId(activeRuns: Map<string, ActiveBridgeRun>): string | undefined {
  for (const run of activeRuns.values()) {
    if (!run.terminal) return run.id
  }
  return undefined
}

/**
 * Start a NON-BLOCKING read of the bridge's run state; the answer lands on `observation` for a
 * later `progress()` call. Nothing here is awaited by the caller and no failure escapes: a bridge
 * that is down, slow, or has forgotten the run leaves the previous snapshot in place, and
 * `progress()` still returns the local mirror.
 */
function scheduleBridgeRunStateRefresh(
  seam: BridgeSeam,
  activeRuns: Map<string, ActiveBridgeRun>,
  observation: BridgeObservation,
): void {
  // A terminal answer is the end of the question. Local run state is NOT proof: `run.terminal`
  // stays false forever when a session dies without it (a failed teardown), so keying only on that
  // polls a dead worker for the life of the process.
  if (observation.closed) return
  if (observation.refreshing) return
  const now = Date.now()
  if (now - observation.refreshedAt < BRIDGE_RUN_STATE_REFRESH_MS) return
  // Only a run this executor still believes live is worth asking about; a terminal one is already
  // known, and there is nothing to steer.
  const runId = liveBridgeRunId(activeRuns)
  if (runId === undefined) return
  observation.refreshedAt = now
  observation.refreshing = true
  void (async () => {
    try {
      const snapshot = await bridgeRunStateGet(seam, runId)
      if (snapshot) {
        observation.runState = snapshot
        // Never write `run.terminal` from an observability read: `teardown` treats that field as
        // terminal proof and would skip the cancel.
        if (snapshot.terminal) observation.closed = true
      }
    } catch {
      // Keep the previous snapshot. An unreadable run state is not evidence about the run.
    } finally {
      observation.refreshing = false
    }
  })()
}
