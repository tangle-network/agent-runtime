import type { SandboxEvent } from '@tangle-network/sandbox'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import type { RuntimeStreamEvent } from '../../types'
import { type SandboxServedBackend, sandboxEventServedBackend } from '../sandbox-events'
import {
  createSandboxToolPartState,
  sandboxOutputMarker,
  sandboxProgressEvents,
} from '../sandbox-executor-output'
import type { SandboxLineageHandle } from '../sandbox-lineage'
import { addTokenUsage, promptCacheTokenClasses, zeroTokenUsage } from '../util'
import {
  type ActivityLog,
  type ActivityNote,
  createActivityLog,
  describeToolArgs,
} from './progress'
import type { SteerableSandboxArgs } from './sandbox-session'
import { createPushTraceSource, decodeBoxPart } from './trace-source'
import type {
  DefaultVerdict,
  ExecutorCancellation,
  ExecutorCancellationRequest,
  ExecutorProgressEvent,
  ExecutorToolCall,
  Spend,
  UsageEvent,
} from './types'

/** The one record a steerable sandbox session reads and writes: its activity, spend and settlement. */
export interface SandboxSessionRun {
  readonly args: SteerableSandboxArgs
  readonly now: () => number
  readonly activity: ActivityLog
  readonly trace: ReturnType<typeof createPushTraceSource>
  readonly toolParts: ReturnType<typeof createSandboxToolPartState>
  readonly seenToolCalls: Set<string>
  readonly toolCalls: ExecutorToolCall[]
  readonly tokens: ReturnType<typeof zeroTokenUsage>
  turns: number
  /** `undefined` until a text-bearing terminal event is observed; never seeded with `''`. */
  lastText: string | undefined
  servedBackend: SandboxServedBackend | undefined
  artifact: { outRef: string; out: unknown; verdict?: DefaultVerdict; spent: Spend } | undefined
  latestOutcome: AgentRunOutcome | undefined
  /** The live lineage handle once a box and session exist, for exact cancellation. */
  handle: SandboxLineageHandle | undefined
  teardown: (() => Promise<void>) | undefined
  note: string
  /** True once `stream()` has started and `output()` can be read. */
  outputReady: boolean
  tokensKnown: boolean
  usd: number
  usageFailure: string | undefined
  preservationFailure: string | undefined
}

export function newSandboxSessionRun(args: SteerableSandboxArgs): SandboxSessionRun {
  const now = args.now ?? Date.now
  return {
    args,
    now,
    activity: createActivityLog(args.options?.activityWindow ?? 12),
    trace: createPushTraceSource({ runId: `sandbox-${args.harness}-${now()}`, now }),
    toolParts: createSandboxToolPartState(),
    seenToolCalls: new Set(),
    toolCalls: [],
    tokens: zeroTokenUsage(),
    turns: 0,
    lastText: undefined,
    servedBackend: undefined,
    artifact: undefined,
    latestOutcome: undefined,
    handle: undefined,
    teardown: undefined,
    note: 'starting',
    outputReady: false,
    tokensKnown: true,
    usd: 0,
    usageFailure: undefined,
    preservationFailure: undefined,
  }
}

/** Same output projection used at capture and terminal publication. */
export function sandboxSessionOutput(run: SandboxSessionRun): unknown {
  return {
    content: run.lastText,
    output: sandboxOutputMarker(run.lastText),
    ...(run.servedBackend === undefined ? {} : { servedBackend: run.servedBackend }),
    turns: run.turns,
    toolCalls: run.toolCalls,
    ...(run.latestOutcome ? { outcome: run.latestOutcome } : {}),
    // The reason behind a `false` `spent.tokensKnown` rides the settlement, not the verdict: SUCCEEDED
    // and MEASURED differ, and collapsing them would drop a correct worker from winner selection.
    ...(run.usageFailure === undefined ? {} : { tokensUnknownReason: run.usageFailure }),
    ...(run.args.workspaceCaptures === undefined
      ? {}
      : { workspaceCaptures: run.args.workspaceCaptures() }),
    ...(run.preservationFailure === undefined
      ? {}
      : { preservationFailure: run.preservationFailure }),
  }
}

/** Record one box event for the trace and the activity window, and return the live output it
 *  carries so the caller can publish it to the turn stream. */
export function recordBoxEvent(
  run: SandboxSessionRun,
  event: SandboxEvent,
): ExecutorProgressEvent[] {
  const at = run.now()
  const data = (event as { data?: unknown }).data
  const part = data && typeof data === 'object' ? (data as { part?: unknown }).part : undefined
  if (part !== undefined) {
    const step = decodeBoxPart(part, run.args.harness)
    if (step) {
      // The same call streams several frames; count it once so the detector panel and the
      // driver's activity window both see ONE entry per real tool call.
      const key = step.callId ?? `${step.toolName}:${run.activity.size()}`
      if (!run.seenToolCalls.has(key)) {
        run.seenToolCalls.add(key)
        run.trace.record(step)
        const note: ActivityNote = {
          at,
          kind: 'tool',
          label: step.toolName,
          ...(step.status ? { status: step.status } : {}),
          ...(describeToolArgs(step.args) ? { detail: describeToolArgs(step.args) } : {}),
        }
        run.activity.push(note)
      }
    }
  }
  const text = readFinalText(event)
  if (text !== undefined) run.lastText = text
  const served = sandboxEventServedBackend(event)
  if (served !== undefined) run.servedBackend = served
  const progress = sandboxProgressEvents(event, run.toolParts)
  for (const item of progress) {
    if (item.kind !== 'tool_call') continue
    run.toolCalls.push({
      ...(item.toolCallId === undefined ? {} : { id: item.toolCallId }),
      name: item.toolName,
      arguments: item.args ?? {},
    })
  }
  return progress
}

/** Credit one LLM call's tokens and cost to the run, yielding the usage the pool must see. */
export function* creditSandboxCall(
  run: SandboxSessionRun,
  call: RuntimeStreamEvent & { type: 'llm_call' },
): Generator<UsageEvent> {
  const callTokensKnown =
    call.tokensKnown !== false &&
    typeof call.tokensIn === 'number' &&
    typeof call.tokensOut === 'number'
  if (!callTokensKnown) run.tokensKnown = false
  // A receipt the ledger could not read marks the SPEND unknown, never the stream failed: the
  // worker keeps running and settles on its own outcome with `tokensKnown: false` plus this
  // message. The first message is kept: it names the receipt, and a later one adds no fact.
  if (call.tokensUnknownReason !== undefined) {
    run.usageFailure ??= call.tokensUnknownReason
    run.activity.push({
      at: run.now(),
      kind: 'note',
      label: 'usage-unreadable',
      detail: call.tokensUnknownReason,
    })
  }
  const input = call.tokensIn ?? 0
  const output = call.tokensOut ?? 0
  if (input || output || !callTokensKnown) {
    const usage: Extract<UsageEvent, { kind: 'tokens' }> = {
      kind: 'tokens',
      input,
      output,
      ...(callTokensKnown ? {} : { tokensKnown: false }),
      // Classify against THIS call's own prompt total, so the classes partition the
      // number they belong to rather than a running sum from other calls.
      ...promptCacheTokenClasses(call.tokensIn, call.promptCache),
    }
    addTokenUsage(run.tokens, usage)
    yield usage
  }
  if (typeof call.costUsd === 'number' && call.costUsd > 0) {
    run.usd += call.costUsd
    // Numeric sandbox cost has no billing-provenance/completeness receipt, so the whole amount
    // is a price rather than a charge and rides the estimate channel too — `usd - usdEstimated`
    // is what names billed money, and without it this figure read as provider spend (#1175).
    yield {
      kind: 'cost',
      usd: call.costUsd,
      usdKnown: false,
      usdEstimated: call.costUsd,
      provenance: 'uncaptured',
    }
  }
}

/** Ask the box to stop the running execution on this exact session and report what it answered. */
export async function cancelSandboxSession(
  run: SandboxSessionRun,
  request: ExecutorCancellationRequest,
): Promise<ExecutorCancellation> {
  const live = run.handle
  const observedAt = () => new Date().toISOString()
  if (!live) {
    return {
      status: 'unknown',
      effect: 'cancel_requested',
      observedAt: observedAt(),
      detail: 'no box session exists yet for this worker; nothing remote could be asked',
    }
  }
  const session = (
    live.box as unknown as {
      session?: (id: string) => { interrupt?: (options?: unknown) => Promise<unknown> }
    }
  ).session?.(live.sessionId)
  if (!session || typeof session.interrupt !== 'function') {
    return {
      status: 'unknown',
      effect: 'cancel_requested',
      observedAt: observedAt(),
      detail: 'the sandbox client exposes no session interrupt operation',
      evidence: { sessionId: live.sessionId },
    }
  }
  try {
    const result = (await session.interrupt()) as { cancelled?: unknown }
    const evidence = { sessionId: live.sessionId, operationId: request.operationId, result }
    if (result?.cancelled === true) {
      run.args.controller.abort('executor cancelled')
      return {
        status: 'accepted',
        effect: 'cancelled',
        observedAt: observedAt(),
        detail: 'the box reported the running execution cancelled',
        evidence,
      }
    }
    // `cancelled: false` is the platform saying the selected execution was not running.
    return {
      status: 'already-terminal',
      effect: 'not_live',
      observedAt: observedAt(),
      detail: 'the box reported no running execution on this session',
      evidence,
    }
  } catch (error) {
    return {
      status: 'unknown',
      effect: 'cancel_requested',
      observedAt: observedAt(),
      detail: `the box interrupt failed: ${error instanceof Error ? error.message : String(error)}`,
      evidence: { sessionId: live.sessionId, operationId: request.operationId },
    }
  }
}

/** The terminal text a sandbox `result` event carries, when it carries one. An observed empty
 *  string is returned as `''`, because "the box answered nothing" is not "the box never
 *  answered". */
function readFinalText(event: SandboxEvent): string | undefined {
  const data = (event as { data?: unknown }).data
  if (!data || typeof data !== 'object') return undefined
  const text = (data as { finalText?: unknown; text?: unknown }).finalText
  if (typeof text === 'string') return text
  const alt = (data as { text?: unknown }).text
  return typeof alt === 'string' ? alt : undefined
}
