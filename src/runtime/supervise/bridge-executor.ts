/** Bridge executor lifecycle, steering, materialization, and measured usage. */

import { randomUUID } from 'node:crypto'
import {
  type AgentProfile,
  type AgentProfileMcpServer,
  agentProfileSchema,
} from '@tangle-network/agent-interface'
import { BackendTransportError, ValidationError } from '../../errors'
import {
  addHarnessUsage,
  type CodexRolloutStoreReader,
  type CodexRolloutStoreRef,
  type CodexStoreDelta,
  createCodexRolloutStoreReader,
  harnessUsageIsEmpty,
} from '../codex-rollout-store'
import { agentHarness } from '../harness-role'
import {
  mergeObservedModelIdentity,
  observedModelHasSnapshot,
  observedModelMatchesDeclared,
} from '../model-identity'
import { addTokenUsage, promptCacheTokenClasses, zeroTokenUsage } from '../util'
import { linkAbort, runAbortable } from './abortable'
import {
  type BridgeHarnessStore,
  type BridgeSeam,
  bridgeRuntimeAttachmentsKey,
  bridgeSeamKey,
  bridgeStopSignalKey,
  maxBridgeTimeoutMs,
  type ResolvedBridgeModelCredential,
  type ResolvedBridgeSeam,
  resolveBridgeModelCredential,
  validateBridgeModelCredential,
} from './bridge-config'
import {
  type BridgeInferenceUsage,
  type BridgeProfileMaterializationReceipt,
  stripMaterializationObservation,
} from './bridge-protocol'
import {
  type ActiveBridgeRun,
  assertBridgeExecutionCapabilities,
  BRIDGE_CANCEL_LONG_POLL_MS,
  type BridgeRunStateRead,
  bridgeRunStateGet,
  cancelBridgeRunToTerminal,
  requestBridgeRunCancellation,
  streamDurableBridgeRun,
} from './bridge-transport'
import { priceUnreceiptedWork } from './cost-estimate'
import { contentRef } from './executor-outcome'
import { readOptionalAbortSignal, readOptionalMcpAttachments, readSeam } from './executor-seams'
import { createInbox, type Inbox } from './inbox'
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
import {
  type ActivityLog,
  createActivityLog,
  describeToolArgs,
  type ExecutorProgress,
} from './progress'
import { taskToPrompt } from './task-prompt'
import { createPushTraceSource, type ToolStepInput, type TraceSource } from './trace-source'
import type {
  Executor,
  ExecutorCancellation,
  ExecutorFactory,
  ExecutorResult,
  ExecutorToolCall,
  Runtime,
  Spend,
  TokenUsageProvenance,
  UsageEvent,
  WorkerInteractiveSession,
} from './types'
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
  // environment at spawn. Empty when the run records no spans, adding no header at all.
  const traceHeaders = workerTraceHeaders(ctx)

  const controller = linkAbort(ctx.signal)

  // The down-leg receive end: the driver's steer/answer/resume land here via `Scope.send`.
  const inbox = createInbox()
  let artifact: ExecutorResult<unknown> | undefined
  // One spawn owns one resumable session and, at most, one live durable run per
  // turn. Keep the server-owned run identities until the bridge proves each job
  // terminal; closing a response body is deliberately not terminal evidence.
  const activeRuns = new Map<string, ActiveBridgeRun>()
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
      return streamBridgeSession({
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

interface StreamBridgeArgs {
  task: unknown
  signal: AbortSignal
  /** Completion request from a Runtime-owned driver. It stops future turns after the current one. */
  stopSignal?: AbortSignal
  /** Runtime-owned MCP servers mounted for the run, outside the bound AgentProfile. */
  runtimeAttachments?: Readonly<Record<string, AgentProfileMcpServer>>
  profile: AgentProfile
  seam: ResolvedBridgeSeam
  sessionId: string
  maxTurns: number
  maxReconnects: number
  /** Trace request headers ({@link workerTraceHeaders}); empty when the run records no spans. */
  traceHeaders: Readonly<Record<string, string>>
  inbox: Inbox
  controller: AbortController
  activeRuns: Map<string, ActiveBridgeRun>
  /** The live read-model `progress()` answers from; the turn loop is its only writer. */
  observation: BridgeObservation
  record: (step: ToolStepInput) => void
  onProviderAttemptStart: () => void
  onProviderDispatchNotStarted: () => void
  onProviderModel: (model: string) => void
  onProviderIdentityConflict: () => void
  onArtifact: (a: ExecutorResult<unknown>) => void
  onProfileMaterialization: (receipt: BridgeProfileMaterializationReceipt) => void
}

/** Everything `bridgeExecutor.progress()` answers from. Every field is written by the turn loop as
 *  the stream is consumed, so the read itself touches no I/O and cannot block the run. */
interface BridgeObservation {
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

/**
 * One resumable cli-bridge session, run as a streamed turn loop. Turn 0 sends the
 * task; each subsequent turn fires ONLY when the inbox has a steer/answer to fold —
 * re-calling the SAME `session_id` so cli-bridge resumes the harness conversation.
 * Mirrors `routerToolsInlineExecutor`'s drain→turn→settle loop, but each turn is a
 * full streamed harness session call rather than a single chat round.
 */
async function* streamBridgeSession(args: StreamBridgeArgs): AsyncIterable<UsageEvent> {
  const { seam, inbox, observation } = args
  const started = Date.now()
  const external = linkAbort(args.signal, args.controller.signal).signal
  const tokens = zeroTokenUsage()
  let tokensKnown = true
  // Why the token channel is a floor rather than a total, when it is. Named on the artifact under
  // the same key `sumSandboxUsage` uses, so one reader answers "what could not be read" on both
  // the sandbox stream and the bridge stream.
  let tokensUnknownReason: string | undefined
  let usd = 0
  let usdKnown = true
  // The part of `usd` this runtime priced from the catalog. `usd - estimatedUsdCharged` is what a
  // provider is known to have billed.
  let estimatedUsdCharged = 0
  let estimatedUsd = 0
  let sawEstimatedUsd = false
  let turns = 0
  let transportAttempts = 0
  let lastText = ''
  let observedModel: string | undefined
  let observedSystemFingerprint: string | undefined
  const toolCalls: ExecutorToolCall[] = []
  // Keyed by the `PromptCacheUsage` vocabulary, not the SSE parse shape. Every consumer of an
  // artifact's `promptCache` reads `readTokens` / `writeTokens` — `profile-chat-client.ts`,
  // `improvement/agentic-generator.ts`, and `readPromptCache` — so a private dialect here reaches
  // them as no cache report at all, and the cost receipt then charges a re-read prefix in full.
  const promptCache: { freshInput?: number; readTokens?: number; writeTokens?: number } = {}

  // The harness's own store, when the caller named one. Opened BEFORE turn 0 and baselined on the
  // first read, so rows this run did not write are consumed and credited to nothing.
  const harnessStore = openBridgeHarnessStore(seam.harnessStore)
  // Which evidence the counted tokens came from. `undefined` until the first count lands, so a
  // settlement with no tokens at all states no provenance rather than claiming a stream receipt.
  let tokensProvenance: TokenUsageProvenance | undefined
  const creditProvenance = (source: TokenUsageProvenance): void => {
    tokensProvenance =
      tokensProvenance === undefined || tokensProvenance === source ? source : 'mixed'
  }
  if (harnessStore) await readHarnessStoreDelta(harnessStore, observation)

  // Turn 0 is the task; later turns carry the folded steer/answer as the next prompt
  // on the SAME session. `nextPrompt` is undefined once there's nothing pending.
  let nextPrompt: string | undefined = taskToPrompt(args.task)
  for (let t = 0; args.maxTurns === 0 || t < args.maxTurns; ) {
    if (args.stopSignal?.aborted) {
      observation.note = 'settled after completion request'
      break
    }
    // Drain queued down-messages; on turns > 0 they ARE the prompt (resume content).
    const pending = inbox.drain()
    if (pending.length) {
      const folded = inbox.fold(pending)
      nextPrompt = t === 0 && nextPrompt ? `${nextPrompt}\n\n${folded}` : folded
      for (const m of pending) {
        observation.activity.push({
          at: Date.now(),
          kind: 'note',
          // A peer message must not read as a supervisor steer in `observe_agent`'s activity.
          label: m.kind === 'mail' ? 'peer-mail' : m.interrupt ? 'steer' : 'follow-up',
          detail: m.text.length > 80 ? `${m.text.slice(0, 77)}...` : m.text,
        })
      }
    }
    if (nextPrompt === undefined) break
    observation.note = `turn ${t}`

    // Each turn sends ONLY the new task/steer. The full canonical profile carries the standing
    // prompt, and cli-bridge materializes it once; duplicating it as a system message changes the
    // instructions and makes profile-vs-message precedence backend-dependent.
    const messages: Array<{ role: string; content: string }> = []
    messages.push({ role: 'user', content: nextPrompt })
    nextPrompt = undefined

    // Per-turn signal: external teardown/abort OR a forceful interrupt steer.
    const interruptSig = inbox.freshInterrupt()
    const turnController = new AbortController()
    const abortTurn = () => turnController.abort()
    if (external.aborted) turnController.abort()
    else external.addEventListener('abort', abortTurn)
    interruptSig.addEventListener('abort', abortTurn, { once: true })
    let timedOut = false
    const timer =
      seam.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true
            abortTurn()
          }, seam.timeoutMs)
        : undefined
    const cleanup = () => {
      external.removeEventListener('abort', abortTurn)
      if (timer) clearTimeout(timer)
    }

    // Prove this bridge can accept the turn before allocating a remote run id. A refusal still
    // becomes an attempt with explicit no-dispatch evidence. Keeping the active-run map empty is
    // what prevents teardown from cancelling work the bridge never accepted.
    let initialModelCredential: ResolvedBridgeModelCredential | undefined
    const preflightSignal =
      args.stopSignal === undefined
        ? turnController.signal
        : AbortSignal.any([turnController.signal, args.stopSignal])
    try {
      await assertBridgeExecutionCapabilities(
        seam,
        preflightSignal,
        args.runtimeAttachments !== undefined,
      )
      if (preflightSignal.aborted) {
        throw new DOMException('bridgeExecutor: aborted before bridge dispatch', 'AbortError')
      }
      initialModelCredential = await runAbortable(
        () => resolveBridgeModelCredential(seam.modelCredential, 'bridgeExecutor'),
        preflightSignal,
        'bridgeExecutor: credential preflight aborted',
      )
      if (preflightSignal.aborted) {
        throw new DOMException('bridgeExecutor: aborted before bridge dispatch', 'AbortError')
      }
    } catch (error) {
      if (args.stopSignal?.aborted) {
        cleanup()
        observation.note = 'settled after completion request'
        break
      }
      const interruptedBeforeDispatch =
        interruptSig.aborted && !args.signal.aborted && !args.controller.signal.aborted
      try {
        args.onProviderAttemptStart()
        args.onProviderDispatchNotStarted()
      } finally {
        cleanup()
      }
      if (interruptedBeforeDispatch) {
        observation.note = `turn ${turns + 1} interrupted before dispatch, resuming`
        continue
      }
      throw error
    }
    if (args.stopSignal?.aborted) {
      observation.note = 'settled after completion request'
      cleanup()
      break
    }
    args.onProviderAttemptStart()

    const activeRun: ActiveBridgeRun = {
      id: `bridge-run-${randomUUID()}`,
      transportAttempts: 0,
      lastEventId: 0,
      terminal: false,
    }
    args.activeRuns.set(activeRun.id, activeRun)
    const requestBody = {
      model: seam.model,
      stream: true,
      run_id: activeRun.id,
      session_id: args.sessionId,
      ...(seam.cwd ? { cwd: seam.cwd } : {}),
      ...(seam.maxTokens !== undefined ? { max_tokens: seam.maxTokens } : {}),
      execution: {
        kind: 'host' as const,
        ...(seam.timeoutMs !== undefined ? { timeoutMs: seam.timeoutMs } : {}),
      },
      agent_profile: args.profile,
      ...(args.runtimeAttachments === undefined
        ? {}
        : { runtime_attachments: { mcp: args.runtimeAttachments } }),
      messages,
    }

    let turnText = ''
    let sawTurnTokenUsage = false
    let turnTokensKnown = true
    let sawTurnCostStatus = false
    let turnUsdKnown = true
    let turnKnownCostSubtotal = 0
    let turnCostProvenance: 'provider-receipt' | 'billing-receipt' | undefined
    let turnEstimatedCostSubtotal = 0
    // This turn's own token totals, kept apart from the run-wide `tokens` so an unreceipted turn
    // is priced on what IT presented rather than on the running sum of every turn before it.
    let turnInputTokens = 0
    let turnOutputTokens = 0
    let interrupted = false
    let profileMaterializationPublished = false
    const publishProfileMaterialization = (): void => {
      // A receipt is terminal evidence only after the durable bridge run reached [DONE].
      // A provider error may follow that acknowledgement, so publish it before rethrowing.
      if (
        !profileMaterializationPublished &&
        activeRun.terminal &&
        activeRun.profileMaterialization !== undefined
      ) {
        args.onProfileMaterialization(activeRun.profileMaterialization)
        profileMaterializationPublished = true
      }
    }
    try {
      for await (const chunk of streamDurableBridgeRun({
        seam,
        initialModelCredential,
        profile: args.profile,
        sessionId: args.sessionId,
        body: requestBody,
        signal: turnController.signal,
        run: activeRun,
        maxReconnects: args.maxReconnects,
        traceHeaders: args.traceHeaders,
      })) {
        if (chunk.model !== undefined) {
          try {
            if (!observedModelMatchesDeclared(chunk.model, seam.providerModel)) {
              args.onProviderIdentityConflict()
              throw new ValidationError(
                `bridgeExecutor: bridge reported model ${JSON.stringify(chunk.model)} but the profile requires ${JSON.stringify(seam.providerModel)}`,
              )
            }
            const isWireModel = chunk.model === seam.model
            // The exact request id is transport metadata, even when it carries a snapshot.
            // Never let it seed served identity or block a later provider snapshot.
            if (!isWireModel && observedModelHasSnapshot(chunk.model)) {
              // Record each validated served snapshot before merging. A later conflicting
              // snapshot must remain visible in evidence so the attempt stays fail-closed.
              args.onProviderModel(chunk.model)
            }
            if (!isWireModel) {
              observedModel = mergeBridgeObservedModel(observedModel, chunk.model)
            }
          } catch (error) {
            args.onProviderIdentityConflict()
            throw error
          }
        }
        if (chunk.systemFingerprint !== undefined) {
          if (
            observedSystemFingerprint !== undefined &&
            observedSystemFingerprint !== chunk.systemFingerprint
          ) {
            args.onProviderIdentityConflict()
            throw new ValidationError(
              `bridgeExecutor: bridge changed system fingerprint from ${JSON.stringify(observedSystemFingerprint)} to ${JSON.stringify(chunk.systemFingerprint)}`,
            )
          }
          observedSystemFingerprint = chunk.systemFingerprint
        }
        if (chunk.content) {
          turnText += chunk.content
          yield { kind: 'progress', progress: { kind: 'text_delta', text: chunk.content } }
        }
        for (const step of chunk.toolCalls ?? []) {
          toolCalls.push({
            ...(step.callId === undefined ? {} : { id: step.callId }),
            name: step.toolName,
            arguments: step.args,
          })
          observation.activity.push({
            at: Date.now(),
            kind: 'tool',
            label: step.toolName,
            // No `status`: the bridge reported the DECISION to call this tool, and nothing on
            // this wire ever reports the call finishing. An 'ok' here would be invented.
            ...(describeToolArgs(step.args) ? { detail: describeToolArgs(step.args) } : {}),
          })
          args.record(step)
          // Published after the local mirrors are updated, so a consumer that reads `progress()`
          // when this event arrives sees the same call in the activity window.
          yield {
            kind: 'progress',
            progress: {
              kind: 'tool_call',
              toolName: step.toolName,
              ...(step.callId === undefined ? {} : { toolCallId: step.callId }),
              args: step.args,
            },
          }
        }
        if (chunk.usage) {
          sawTurnTokenUsage = true
          creditProvenance('stream-receipt')
          if (!chunk.usage.known) turnTokensKnown = false
          turnInputTokens += chunk.usage.input
          turnOutputTokens += chunk.usage.output
          const usageEvent: Extract<UsageEvent, { kind: 'tokens' }> = {
            kind: 'tokens',
            input: chunk.usage.input,
            output: chunk.usage.output,
            ...(chunk.usage.known ? {} : { tokensKnown: false }),
            ...(chunk.usage.promptCache?.freshInput !== undefined
              ? { freshInput: chunk.usage.promptCache.freshInput }
              : {}),
            ...(chunk.usage.promptCache?.readInput !== undefined
              ? { cacheRead: chunk.usage.promptCache.readInput }
              : {}),
            ...(chunk.usage.promptCache?.writeInput !== undefined
              ? { cacheWrite: chunk.usage.promptCache.writeInput }
              : {}),
          }
          addTokenUsage(tokens, usageEvent)
          yield usageEvent
          if (chunk.usage.promptCache) {
            if (chunk.usage.promptCache.freshInput !== undefined) {
              promptCache.freshInput =
                (promptCache.freshInput ?? 0) + chunk.usage.promptCache.freshInput
            }
            if (chunk.usage.promptCache.readInput !== undefined) {
              promptCache.readTokens =
                (promptCache.readTokens ?? 0) + chunk.usage.promptCache.readInput
            }
            if (chunk.usage.promptCache.writeInput !== undefined) {
              promptCache.writeTokens =
                (promptCache.writeTokens ?? 0) + chunk.usage.promptCache.writeInput
            }
          }
        }
        if (chunk.costProvenance !== undefined) turnCostProvenance = chunk.costProvenance
        if (chunk.costKnown !== undefined) {
          sawTurnCostStatus = true
          if (!chunk.costKnown) turnUsdKnown = false
          // A trusted total is the complete charge for the turn. It supersedes earlier
          // incremental chunks that correctly reported that their subtotal was incomplete.
          if (chunk.costKnown && chunk.costScope === 'total') turnUsdKnown = true
        }
        if (typeof chunk.cost === 'number') {
          const increment =
            chunk.costScope === 'total' ? chunk.cost - turnKnownCostSubtotal : chunk.cost
          if (increment < 0) {
            throw new ValidationError('bridgeExecutor: total billed cost decreased within a turn')
          }
          turnKnownCostSubtotal += increment
          if (increment > 0) {
            usd += increment
            yield {
              kind: 'cost',
              usdKnown: true,
              usd: increment,
              provenance: turnCostProvenance ?? 'provider-receipt',
            }
          }
        }
        if (typeof chunk.estimatedCost === 'number') {
          const increment =
            chunk.costScope === 'total'
              ? chunk.estimatedCost - turnEstimatedCostSubtotal
              : chunk.estimatedCost
          if (increment < 0) {
            throw new ValidationError(
              'bridgeExecutor: total estimated cost decreased within a turn',
            )
          }
          turnEstimatedCostSubtotal += increment
          estimatedUsd += increment
          sawEstimatedUsd = true
        }
      }
      publishProfileMaterialization()
    } catch (error) {
      publishProfileMaterialization()
      if (isTrustedPreProviderRejection(error)) {
        args.onProviderDispatchNotStarted()
      }
      // A forceful steer first detaches this HTTP reader, then explicitly cancels
      // the durable run and waits for terminal proof. Starting the resume turn
      // before that acknowledgement would race two harness processes against one
      // resumable session.
      const interruptAbort =
        interruptSig.aborted && !args.signal.aborted && !args.controller.signal.aborted
      if (interruptAbort) {
        const terminal = await cancelBridgeRunToTerminal(seam, activeRun, 'infinity', external)
        if (!terminal) {
          throw new ValidationError(
            `bridgeExecutor: interrupted run ${activeRun.id} did not reach terminal state`,
          )
        }
        interrupted = true
      } else {
        // A per-turn timeout is owned here, not by the HTTP socket. Request
        // explicit cancellation before surfacing it; external scope teardown
        // performs the same operation under its own grace budget.
        if (timedOut && !activeRun.terminal) {
          await requestBridgeRunCancellation(seam, activeRun, 0)
        }
        throw error
      }
    } finally {
      transportAttempts += activeRun.transportAttempts
      cleanup()
    }
    // Some transports can finish a buffered body normally after their signal fires. The forceful
    // steer still wins and must become a new turn rather than letting this response settle.
    if (interruptSig.aborted && !args.signal.aborted && !args.controller.signal.aborted) {
      interrupted = true
    }
    turns += 1
    t += 1
    observation.turns = turns
    observation.activity.push({ at: Date.now(), kind: 'turn', label: `turn ${turns}` })
    // A turn whose stream carried no usage frame is not a free turn: cli-bridge's own
    // scoped-loopback accounting FOR THIS TURN rides the turn's materialization receipt. It is
    // read here, after the stream, so the canonical usage frames always win and a turn that
    // reported both is charged once — the same precedence `SandboxUsageLedger` holds for sandbox
    // streams (`sandbox-events.ts`).
    if (!sawTurnTokenUsage) {
      const receipt = readBridgeReceiptTokens(
        activeRun.profileMaterialization?.inference?.observation?.usage,
      )
      if ('event' in receipt) {
        sawTurnTokenUsage = true
        creditProvenance('stream-receipt')
        turnInputTokens += receipt.event.input
        turnOutputTokens += receipt.event.output
        addTokenUsage(tokens, receipt.event)
        yield receipt.event
        if (receipt.event.freshInput !== undefined) {
          promptCache.freshInput = (promptCache.freshInput ?? 0) + receipt.event.freshInput
        }
        if (receipt.event.cacheRead !== undefined) {
          promptCache.readTokens = (promptCache.readTokens ?? 0) + receipt.event.cacheRead
        }
        if (receipt.event.cacheWrite !== undefined) {
          promptCache.writeTokens = (promptCache.writeTokens ?? 0) + receipt.event.cacheWrite
        }
      } else {
        // The FIRST reason is kept: it names the receipt this session could not read, and a later
        // turn failing the same way does not make the answer any more unknown.
        tokensUnknownReason ??= receipt.reason
      }
    }
    // The harness's own store closes what the transport did not carry. It is read on EVERY turn,
    // not only an unmetered one, because the two sources cover different work: a stream receipt
    // reports the seat's turn, and a harness-native child spends in its own rollout with its own
    // counter that the parent's receipt never includes. So a turn with a receipt still credits the
    // native children, and a turn without one credits both — never the same tokens twice.
    if (harnessStore) {
      const delta = await readHarnessStoreDelta(harnessStore, observation)
      if (delta) {
        const charged = sawTurnTokenUsage ? delta.native : addHarnessUsage(delta.seat, delta.native)
        if (!harnessUsageIsEmpty(charged)) {
          const event: Extract<UsageEvent, { kind: 'tokens' }> = {
            kind: 'tokens',
            input: charged.input,
            output: charged.output,
            ...promptCacheTokenClasses(charged.input, {
              ...(charged.cachedInput === undefined ? {} : { readTokens: charged.cachedInput }),
              ...(charged.cacheWriteInput === undefined
                ? {}
                : { writeTokens: charged.cacheWriteInput }),
            }),
            provenance: 'harness-store',
          }
          sawTurnTokenUsage = true
          creditProvenance('harness-store')
          turnInputTokens += event.input
          turnOutputTokens += event.output
          addTokenUsage(tokens, event)
          if (event.freshInput !== undefined) {
            promptCache.freshInput = (promptCache.freshInput ?? 0) + event.freshInput
          }
          if (event.cacheRead !== undefined) {
            promptCache.readTokens = (promptCache.readTokens ?? 0) + event.cacheRead
          }
          if (event.cacheWrite !== undefined) {
            promptCache.writeTokens = (promptCache.writeTokens ?? 0) + event.cacheWrite
          }
          yield event
        }
        // A fork this reader cannot attribute is named, never charged and never silently zero.
        if (delta.unresolved.length > 0) {
          turnTokensKnown = false
          tokensUnknownReason ??= `harness-store: ${delta.unresolved.length} forked rollout(s) could not be attributed to a turn; ${delta.unresolved[0]?.reason ?? 'no reason recorded'}`
        }
      }
    }
    if (!sawTurnTokenUsage || !turnTokensKnown) tokensKnown = false
    if (!sawTurnCostStatus || !turnUsdKnown) usdKnown = false
    if (!sawTurnCostStatus || !turnUsdKnown) {
      // Missing billing proof is not a free turn. Price what the turn presented, so the dollar
      // channel carries a number instead of a zero that reads as a measured free turn. The event
      // is always `usdKnown: false`, and the priced part rides `usdEstimated`.
      //
      // Only a turn that billed NOTHING is priced. A turn holding a partial receipt already put
      // real dollars on the channel, and a whole-turn catalog price on top would charge the same
      // tokens twice.
      const priced =
        turnKnownCostSubtotal === 0
          ? priceUnreceiptedWork({
              inputTokens: turnInputTokens,
              outputTokens: turnOutputTokens,
              model: observedModel ?? seam.providerModel,
            })
          : {
              kind: 'cost' as const,
              usd: 0,
              usdKnown: false as const,
              provenance: 'uncaptured' as const,
            }
      if (priced.usdKnown === false && priced.usdEstimated !== undefined) {
        estimatedUsdCharged += priced.usdEstimated
      }
      usd += priced.usd
      yield priced
    }
    yield { kind: 'iteration' }
    if (!interrupted && turnText) lastText = turnText

    if (interrupted) {
      observation.note = `turn ${turns} interrupted, resuming`
      continue
    }

    if (args.stopSignal?.aborted) {
      observation.note = 'settled after completion request'
      break
    }

    // Before settling, drain once more — the worker can't finish while a steer it
    // never read is pending (the sandbox/router settle contract). A pending steer
    // becomes the next resume turn; otherwise the session is truly done.
    // AUTHORITY messages only: a sibling that kept sending mail could otherwise hold a finished
    // worker open indefinitely, which is denial of settlement, not a delivery guarantee.
    if (inbox.pendingAuthority() === 0) break
  }

  observation.note = 'settled'
  const spent: Spend = {
    iterations: turns,
    tokens,
    ...(tokensKnown ? {} : { tokensKnown: false }),
    usd,
    ...(usdKnown ? {} : { usdKnown: false }),
    ...(estimatedUsdCharged > 0 ? { usdEstimated: estimatedUsdCharged } : {}),
    ms: Date.now() - started,
    // Only a provenance OTHER than the live stream is stated, so a bridge run that read no harness
    // store settles byte-identically to every run before this channel existed.
    ...(tokensProvenance === undefined || tokensProvenance === 'stream-receipt'
      ? {}
      : { tokensProvenance }),
  }
  const out = {
    content: lastText,
    ...(observedModel !== undefined ? { model: observedModel } : {}),
    ...(observedSystemFingerprint ? { system_fingerprint: observedSystemFingerprint } : {}),
    toolCalls,
    transportAttempts,
    ...(Object.keys(promptCache).length > 0 ? { promptCache } : {}),
    ...(sawEstimatedUsd ? { estimatedCostUsd: estimatedUsd } : {}),
    ...(tokensKnown || tokensUnknownReason === undefined ? {} : { tokensUnknownReason }),
  } as unknown
  args.onArtifact({
    outRef: contentRef('bridge', {
      model: observedModel ?? null,
      session: args.sessionId,
      content: lastText,
    }),
    out,
    spent,
  })
}

/**
 * The tokens one cli-bridge turn's own materialization receipt states, or the reason it states
 * none.
 *
 * cli-bridge runs every harness against a scoped-loopback endpoint that it owns, counts the model
 * traffic that passes through it, and publishes that count for the turn as
 * `inference.observation.usage`. The count is harness-agnostic BY CONSTRUCTION: the proxy reads
 * provider requests, not a CLI's own event vocabulary. A harness that emits no OpenAI-shaped
 * `usage` frame therefore still has a readable receipt, which is why this runtime holds NO
 * per-harness bridge decoder — the bridge normalizes usage at the source and the runtime keeps one
 * reader. (`harness-usage.ts` holds the decoder registry for the OTHER transport, the sandbox
 * stream, where the runtime does read a harness's own event.)
 *
 * A receipt states a turn's tokens only when it names BOTH totals. Anything less leaves the turn
 * unknown with the reason named, never a zero that would read as a measured free turn.
 *
 * The counters beside the two totals CLASSIFY the prompt total; none of them adds to it. The
 * receipt carries no reasoning counter at all, so the codex hazard of adding a reasoning count to
 * an output total that already contains it cannot arise on this path.
 */
/**
 * Open the harness store named on the seam, or nothing when the caller named none.
 *
 * A harness with no reader is REFUSED loudly rather than read with codex's decoder. Silently
 * ignoring it would hand back the same `{0, 0}` the store was configured to fix, with no signal
 * that the configuration did nothing.
 */
function openBridgeHarnessStore(
  store: BridgeHarnessStore | undefined,
): CodexRolloutStoreReader | undefined {
  if (store === undefined) return undefined
  if (store.harness !== 'codex') {
    throw new ValidationError(
      `bridgeExecutor: harnessStore.harness ${JSON.stringify(store.harness)} has no store reader; only "codex" is readable today`,
    )
  }
  const ref: CodexRolloutStoreRef = {
    root: store.root,
    ...(store.workspaceRoot === undefined ? {} : { workspaceRoot: store.workspaceRoot }),
  }
  return createCodexRolloutStoreReader(ref)
}

/**
 * Read one turn's worth of the harness store.
 *
 * A read that fails is noted on the live activity log and returns nothing: the store is additional
 * evidence, and a filesystem error on it must never end a turn whose work already happened.
 */
async function readHarnessStoreDelta(
  reader: CodexRolloutStoreReader,
  observation: BridgeObservation,
): Promise<CodexStoreDelta | undefined> {
  try {
    return await reader.read()
  } catch (err) {
    observation.activity.push({
      at: Date.now(),
      kind: 'note',
      label: 'harness-store-unreadable',
      detail: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

function readBridgeReceiptTokens(
  usage: BridgeInferenceUsage | undefined,
): { event: Extract<UsageEvent, { kind: 'tokens' }> } | { reason: string } {
  if (usage === undefined) {
    return { reason: 'usage-unreadable: the turn receipt carried no bridge inference observation' }
  }
  const input = usage.inputTokens
  const output = usage.outputTokens
  if (input === undefined || output === undefined) {
    const missing = [
      ...(input === undefined ? ['prompt'] : []),
      ...(output === undefined ? ['completion'] : []),
    ].join(' and ')
    return { reason: `usage-unreadable: the turn receipt named no ${missing} total` }
  }
  const fresh = usage.freshInputTokens
  // One reader of the cache-class convention, shared with every other usage path.
  const classes = promptCacheTokenClasses(input, {
    ...(usage.cacheReadInputTokens === undefined ? {} : { readTokens: usage.cacheReadInputTokens }),
    ...(usage.cacheWriteInputTokens === undefined
      ? {}
      : { writeTokens: usage.cacheWriteInputTokens }),
  })
  // The receipt may state its own fresh count. It is carried when the cache counters did not
  // already imply the partition — one class named out of three classifies PART of the prompt
  // total, so the split stays incomplete. A fresh count that CONTRADICTS the implied partition
  // keeps both measured counters and declares the remainder unclassified rather than picking a
  // winner between two numbers the same receipt reported.
  const declaredFresh =
    classes.freshInput === undefined && fresh !== undefined && fresh <= input
      ? { freshInput: fresh, cacheBreakdownKnown: false as const }
      : {}
  const contradiction =
    classes.freshInput !== undefined && fresh !== undefined && fresh !== classes.freshInput
      ? { cacheBreakdownKnown: false as const }
      : {}
  return {
    event: {
      kind: 'tokens',
      input,
      output,
      ...classes,
      ...declaredFresh,
      ...contradiction,
    },
  }
}

/** Only Router's exact one-sided fact proves that provider dispatch did not start. */
function isTrustedPreProviderRejection(error: unknown): error is BackendTransportError {
  return error instanceof BackendTransportError && error.providerDispatch === 'not_started'
}

function mergeBridgeObservedModel(current: string | undefined, next: string): string {
  if (current === undefined || current === next) return next
  const merged = mergeObservedModelIdentity(current, next)
  if (merged === undefined) {
    throw new ValidationError(
      `bridgeExecutor: bridge changed response model from ${JSON.stringify(current)} to ${JSON.stringify(next)}`,
    )
  }
  return merged
}
