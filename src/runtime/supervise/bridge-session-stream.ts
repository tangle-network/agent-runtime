import { randomUUID } from 'node:crypto'
import type { AgentProfile, AgentProfileMcpServer } from '@tangle-network/agent-interface'
import { BackendTransportError, ValidationError } from '../../errors'
import {
  mergeObservedModelIdentity,
  observedModelHasSnapshot,
  observedModelMatchesDeclared,
} from '../model-identity'
import { linkAbort, runAbortable } from './abortable'
import {
  type ResolvedBridgeModelCredential,
  type ResolvedBridgeSeam,
  resolveBridgeModelCredential,
} from './bridge-config'
import type { BridgeObservation } from './bridge-executor'
import type { BridgeProfileMaterializationReceipt, BridgeStreamChunk } from './bridge-protocol'
import {
  BridgeSessionLedger,
  openBridgeHarnessStore,
  readHarnessStoreDelta,
} from './bridge-session-ledger'
import {
  type ActiveBridgeRun,
  assertBridgeExecutionCapabilities,
  cancelBridgeRunToTerminal,
  requestBridgeRunCancellation,
  streamDurableBridgeRun,
} from './bridge-transport'
import { BridgeTurnSignals } from './bridge-turn-signals'
import { HarnessTurnFailedError } from './driver-attempt-evidence'
import type { Inbox, InboxLease } from './inbox'
import { describeToolArgs } from './progress'
import { taskToPrompt } from './task-prompt'
import type { ToolStepInput } from './trace-source'
import type { ExecutorResult, UsageEvent } from './types'

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

/** One resumable cli-bridge session as a streamed turn loop: turn 0 sends the task, each later
 *  turn fires ONLY when the inbox has a steer/answer to fold, re-calling the SAME `session_id`.
 *  Mirrors `routerToolsInlineExecutor`'s take→turn→settle loop with a full harness call per turn. */
export async function* streamBridgeSession(args: StreamBridgeArgs): AsyncIterable<UsageEvent> {
  const { seam, inbox, observation } = args
  const started = Date.now()
  const external = linkAbort(args.signal, args.controller.signal).signal
  const ledger = new BridgeSessionLedger()
  // The harness's own store, when the caller named one. Opened BEFORE turn 0 and baselined on the
  // first read, so rows this run did not write are consumed and credited to nothing.
  const harnessStore = openBridgeHarnessStore(seam.harnessStore)
  if (harnessStore) await readHarnessStoreDelta(harnessStore, observation)

  // Turn 0 is the task; later turns carry the folded steer/answer on the SAME session.
  let nextPrompt: string | undefined = taskToPrompt(args.task)
  // The messages this turn's prompt carries. Committed once the bridge streams the run, so a turn
  // that fails or is interrupted before then hands them back to the next prompt.
  let lease: InboxLease | undefined
  for (let t = 0; args.maxTurns === 0 || t < args.maxTurns; ) {
    lease?.release()
    if (args.stopSignal?.aborted) {
      observation.note = 'settled after completion request'
      break
    }
    // Take queued down-messages; on turns > 0 they ARE the prompt (resume content).
    const turnLease = inbox.take()
    lease = turnLease
    const folded = foldTurnMessages(turnLease, inbox, observation)
    if (folded !== undefined) {
      nextPrompt = t === 0 && nextPrompt ? `${nextPrompt}\n\n${folded}` : folded
    }
    if (nextPrompt === undefined) break
    observation.note = `turn ${t}`

    // Each turn sends ONLY the new task/steer: the profile's standing prompt is materialized once,
    // and duplicating it as a system message makes precedence backend-dependent.
    const messages: Array<{ role: string; content: string }> = []
    messages.push({ role: 'user', content: nextPrompt })
    nextPrompt = undefined

    // Per-turn signal: external teardown/abort OR a forceful interrupt steer.
    const signals = new BridgeTurnSignals(external, inbox.freshInterrupt(), seam)
    const preflight = await preflightBridgeTurn(args, signals, ledger.turns)
    if (preflight.kind === 'stopped') break
    if (preflight.kind === 'interrupted') continue
    args.onProviderAttemptStart()

    const { activeRun, interrupted } = yield* streamBridgeTurn(args, {
      ledger,
      signals,
      turnLease,
      messages,
      initialModelCredential: preflight.credential,
      external,
    })
    ledger.turns += 1
    t += 1
    observation.turns = ledger.turns
    observation.activity.push({ at: Date.now(), kind: 'turn', label: `turn ${ledger.turns}` })
    yield* ledger.settleTurn(
      activeRun.profileMaterialization?.inference?.observation?.usage,
      harnessStore,
      observation,
      seam.providerModel,
    )
    yield { kind: 'iteration' }
    if (!interrupted) {
      if (ledger.turn.text) ledger.lastText = ledger.turn.text
      ledger.lastFinalOutput = ledger.turn.finalOutput
    }

    if (interrupted) {
      observation.note = `turn ${ledger.turns} interrupted, resuming`
      continue
    }

    if (args.stopSignal?.aborted) {
      observation.note = 'settled after completion request'
      break
    }

    // Before settling, take once more: a worker can't finish with an unread steer pending, which
    // becomes the next resume turn (else `failPendingAfter` reports it failed). AUTHORITY messages
    // only, or a sibling's mail could hold a finished worker open indefinitely.
    if (inbox.pendingAuthority() === 0) break
  }

  observation.note = 'settled'
  args.onArtifact(ledger.artifact(args.sessionId, started, seam.outputFormat))
}

/** The folded text of the messages this turn took, noted on the activity log; none when empty. */
function foldTurnMessages(
  turnLease: InboxLease,
  inbox: Inbox,
  observation: BridgeObservation,
): string | undefined {
  const pending = turnLease.messages
  if (!pending.length) return undefined
  const folded = inbox.fold(pending)
  for (const m of pending) {
    observation.activity.push({
      at: Date.now(),
      kind: 'note',
      // A peer message must not read as a supervisor steer in `observe_agent`'s activity.
      label: m.kind === 'mail' ? 'peer-mail' : m.interrupt ? 'steer' : 'follow-up',
      detail: m.text.length > 80 ? `${m.text.slice(0, 77)}...` : m.text,
    })
  }
  return folded
}

type BridgePreflight =
  | { readonly kind: 'ready'; readonly credential: ResolvedBridgeModelCredential | undefined }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'interrupted' }

/** Prove this bridge can accept the turn before allocating a remote run id. A refusal still becomes
 *  an attempt with no-dispatch evidence; the empty active-run map keeps teardown from cancelling
 *  work the bridge never accepted. */
async function preflightBridgeTurn(
  args: StreamBridgeArgs,
  signals: BridgeTurnSignals,
  turns: number,
): Promise<BridgePreflight> {
  const { seam, observation } = args
  let initialModelCredential: ResolvedBridgeModelCredential | undefined
  const preflightSignal =
    args.stopSignal === undefined
      ? signals.controller.signal
      : AbortSignal.any([signals.controller.signal, args.stopSignal])
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
      signals.cleanup()
      observation.note = 'settled after completion request'
      return { kind: 'stopped' }
    }
    const interruptedBeforeDispatch =
      signals.interrupt.aborted && !args.signal.aborted && !args.controller.signal.aborted
    try {
      args.onProviderAttemptStart()
      args.onProviderDispatchNotStarted()
    } finally {
      signals.cleanup()
    }
    if (interruptedBeforeDispatch) {
      observation.note = `turn ${turns + 1} interrupted before dispatch, resuming`
      return { kind: 'interrupted' }
    }
    throw error
  }
  if (args.stopSignal?.aborted) {
    observation.note = 'settled after completion request'
    signals.cleanup()
    return { kind: 'stopped' }
  }
  return { kind: 'ready', credential: initialModelCredential }
}

interface BridgeTurn {
  readonly ledger: BridgeSessionLedger
  readonly signals: BridgeTurnSignals
  readonly turnLease: InboxLease
  readonly messages: Array<{ role: string; content: string }>
  readonly initialModelCredential: ResolvedBridgeModelCredential | undefined
  readonly external: AbortSignal
}

/** Stream one durable bridge run for this turn, and say whether a forceful steer interrupted it. */
async function* streamBridgeTurn(
  args: StreamBridgeArgs,
  turn: BridgeTurn,
): AsyncGenerator<UsageEvent, { activeRun: ActiveBridgeRun; interrupted: boolean }> {
  const { seam } = args
  const { ledger, signals, turnLease } = turn
  const activeRun: ActiveBridgeRun = {
    id: `bridge-run-${randomUUID()}`,
    transportAttempts: 0,
    lastEventId: 0,
    terminal: false,
  }
  args.activeRuns.set(activeRun.id, activeRun)
  // A streamed frame is the bridge's word that the harness took this prompt into its session.
  const accept = (): void => {
    for (const message of turnLease.messages) turnLease.commit(activeRun.id, message.id)
  }
  const requestBody = {
    model: seam.model,
    stream: true,
    ...(seam.outputFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
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
    messages: turn.messages,
  }
  ledger.beginTurn()
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
      initialModelCredential: turn.initialModelCredential,
      profile: args.profile,
      sessionId: args.sessionId,
      body: requestBody,
      signal: signals.controller.signal,
      run: activeRun,
      maxReconnects: args.maxReconnects,
      traceHeaders: args.traceHeaders,
    })) {
      accept()
      signals.noteChunk(chunk)
      observeChunkIdentity(chunk, ledger, args)
      yield* chunkProgress(chunk, ledger, args)
      if (chunk.usage) yield* ledger.creditStreamUsage(chunk.usage)
      yield* ledger.creditStreamCost(chunk)
    }
    accept()
    publishProfileMaterialization()
  } catch (error) {
    publishProfileMaterialization()
    if (isTrustedPreProviderRejection(error)) {
      args.onProviderDispatchNotStarted()
    }
    await settleFailedTurn(error, args, signals, activeRun, turn.external)
    interrupted = true
  } finally {
    ledger.transportAttempts += activeRun.transportAttempts
    signals.cleanup()
  }
  // Some transports can finish a buffered body normally after their signal fires. The forceful
  // steer still wins and must become a new turn rather than letting this response settle.
  if (signals.interrupt.aborted && !args.signal.aborted && !args.controller.signal.aborted) {
    interrupted = true
  }
  return { activeRun, interrupted }
}

/**
 * A failed turn stream: a forceful steer's interruption returns once the durable run is terminal;
 * anything else throws, as the turn failure it is.
 */
async function settleFailedTurn(
  error: unknown,
  args: StreamBridgeArgs,
  signals: BridgeTurnSignals,
  activeRun: ActiveBridgeRun,
  external: AbortSignal,
): Promise<void> {
  const { seam } = args
  // A forceful steer detaches this reader, cancels the durable run and waits for terminal proof;
  // resuming earlier would race two harness processes against one session.
  const interruptAbort =
    signals.interrupt.aborted && !args.signal.aborted && !args.controller.signal.aborted
  if (interruptAbort) {
    const terminal = await cancelBridgeRunToTerminal(seam, activeRun, 'infinity', external)
    if (!terminal) {
      throw new ValidationError(
        `bridgeExecutor: interrupted run ${activeRun.id} did not reach terminal state`,
      )
    }
    return
  }
  // A per-turn timeout is owned here, not by the socket: request cancellation before surfacing it.
  if (signals.silent && !signals.timedOut) {
    if (!activeRun.terminal) await requestBridgeRunCancellation(seam, activeRun, 0)
    // Silence is the same accident as a deadline, found sooner: the turn failed, the run goes on.
    throw new HarnessTurnFailedError('bridge', {
      error: `the model sent nothing for ${seam.modelSilenceMs} ms with no tool call open; cancellation of bridge run ${activeRun.id} requested`,
      errorCode: 'timeout',
    })
  }
  if (signals.timedOut) {
    if (!activeRun.terminal) await requestBridgeRunCancellation(seam, activeRun, 0)
    // The turn ran out its own deadline: it failed, the run did not stop. As the transport's
    // AbortError it classified terminal (one silent 4-hour turn settled magnetar-rust-20261019b, a
    // 48-hour run); as a failed turn the driver re-enters it, bounded like any other failure.
    throw new HarnessTurnFailedError('bridge', {
      error: `the turn ran out its ${seam.timeoutMs} ms deadline; cancellation of bridge run ${activeRun.id} requested`,
      errorCode: 'timeout',
    })
  }
  throw error
}

/** Hold the served model and system fingerprint a chunk names to the profile and to each other. */
function observeChunkIdentity(
  chunk: BridgeStreamChunk,
  ledger: BridgeSessionLedger,
  args: StreamBridgeArgs,
): void {
  const { seam } = args
  if (chunk.model !== undefined) {
    try {
      if (!observedModelMatchesDeclared(chunk.model, seam.providerModel)) {
        args.onProviderIdentityConflict()
        throw new ValidationError(
          `bridgeExecutor: bridge reported model ${JSON.stringify(chunk.model)} but the profile requires ${JSON.stringify(seam.providerModel)}`,
        )
      }
      const isWireModel = chunk.model === seam.model
      // The exact request id is transport metadata: never served identity.
      if (!isWireModel && observedModelHasSnapshot(chunk.model)) {
        // Record each snapshot before merging so a later conflict stays visible (fail-closed).
        args.onProviderModel(chunk.model)
      }
      if (!isWireModel) {
        ledger.observedModel = mergeBridgeObservedModel(ledger.observedModel, chunk.model)
      }
    } catch (error) {
      args.onProviderIdentityConflict()
      throw error
    }
  }
  if (chunk.systemFingerprint !== undefined) {
    if (
      ledger.observedSystemFingerprint !== undefined &&
      ledger.observedSystemFingerprint !== chunk.systemFingerprint
    ) {
      args.onProviderIdentityConflict()
      throw new ValidationError(
        `bridgeExecutor: bridge changed system fingerprint from ${JSON.stringify(ledger.observedSystemFingerprint)} to ${JSON.stringify(chunk.systemFingerprint)}`,
      )
    }
    ledger.observedSystemFingerprint = chunk.systemFingerprint
  }
}

/** The model output and tool steps a chunk carried, mirrored locally before each is published. */
function* chunkProgress(
  chunk: BridgeStreamChunk,
  ledger: BridgeSessionLedger,
  args: StreamBridgeArgs,
): Generator<UsageEvent> {
  const { observation } = args
  if (chunk.finalOutput) {
    if (ledger.turn.finalOutput !== undefined)
      throw new ValidationError('bridgeExecutor: multiple final_output values in one turn')
    ledger.turn.finalOutput = chunk.finalOutput
  }
  if (chunk.content) {
    ledger.turn.text += chunk.content
    yield { kind: 'progress', progress: { kind: 'text_delta', text: chunk.content } }
  }
  // Reasoning is the model's own record of why; it is never part of the turn's text.
  if (chunk.reasoning) {
    yield { kind: 'progress', progress: { kind: 'reasoning_delta', text: chunk.reasoning } }
  }
  for (const step of chunk.toolCalls ?? []) {
    ledger.toolCalls.push({
      ...(step.callId === undefined ? {} : { id: step.callId }),
      name: step.toolName,
      arguments: step.args,
    })
    observation.activity.push({
      at: Date.now(),
      kind: 'tool',
      label: step.toolName,
      // No `status`: the wire reports the DECISION to call, never the finish.
      ...(describeToolArgs(step.args) ? { detail: describeToolArgs(step.args) } : {}),
    })
    args.record(step)
    // Published after the mirrors update, so `progress()` readers see the same call.
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
  for (const result of chunk.toolResults ?? []) {
    // A finished call is a second fact, with its own note, carrying the status the decision lacked.
    observation.activity.push({
      at: Date.now(),
      kind: 'tool',
      label: result.name,
      status: result.status === 'completed' ? 'ok' : 'error',
      ...(result.status === 'error' && result.error !== undefined ? { detail: result.error } : {}),
    })
    yield {
      kind: 'progress',
      progress: {
        kind: 'tool_result',
        toolName: result.name,
        ...(result.id === undefined ? {} : { toolCallId: result.id }),
        result: result.status === 'completed' ? result.output : { error: result.error },
      },
    }
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
