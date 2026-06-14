/**
 * Bounded turn-level tool-dispatch loop.
 *
 * `runAgentTaskStream` runs ONE model turn; `runLoop` orchestrates DELEGATED
 * multi-agent topologies (refine / fanout-vote). Neither is the everyday
 * interactive shape: a chat turn where the model may emit tool calls, each is
 * executed, the results are folded back, and the turn re-runs until the model
 * stops (or a turn cap). Every agent app hand-rolls that loop — this is it,
 * as a reusable primitive.
 *
 * Substrate-neutral by design: the caller supplies `streamTurn` (wrapping
 * whatever backend / `runAgentTaskStream` it uses) and `executeToolCall`
 * (routing to its executors). This module owns the LOOP; the caller owns the
 * model and the executors. `Raw` (streaming variant) is the caller's own
 * event type. The only imported contract is the runtime hook type: hooks are
 * execution-scoped observers, not part of the agent profile.
 */

import type { RuntimeDecisionEvidenceRef, RuntimeHooks } from './runtime-hooks'
import { notifyRuntimeDecisionPoint, notifyRuntimeHookEvent } from './runtime-hooks'

export interface ToolLoopCall {
  toolCallId?: string
  toolName: string
  args: Record<string, unknown>
}

/** Outcome of one tool dispatch — structurally compatible with a hub/integration
 *  tool-outcome union, so callers can fold either through the loop. */
export type ToolCallOutcome =
  | { ok: true; result: unknown }
  | { ok: false; code: string; message: string; status?: number }

/** Runaway-backstop: stops an infinite tool loop where cost is unmetered. Set
 *  far above any legitimate workflow — this is a watchdog, not a policy cap.
 *  Legitimate per-call budgets come from `maxCostUsd` + `costOf`. */
const RUNAWAY_BACKSTOP_TURNS = 200
const DEFAULT_DECISION_CONTEXT_CHARS = 12_000
const FAILURE_RECOVERY_ACTIONS = ['retry', 'verify', 'continue', 'stop']
/** Consecutive identical calls (same tool + canonical-JSON args) that trigger
 *  stuck-loop detection. The window resets on any different call. */
const STUCK_LOOP_THRESHOLD = 3

/** One OpenAI-shaped tool-call entry carried on an assistant message. */
export interface ToolLoopAssistantToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * A message in the running conversation the loop sends to `streamTurn`.
 *
 * The base `{ role, content }` covers `system` / `user` / plain `assistant`
 * turns. Two optional fields carry the OpenAI function-calling contract so a
 * strict model (Claude, and any OpenAI-compatible provider that validates tool
 * history) reads its own tool use back instead of re-issuing the same call:
 *
 *   - an assistant turn that emitted tool calls carries `tool_calls`, and its
 *     `content` is `null` when the turn was tool-only;
 *   - each tool result is its own `{ role: 'tool', tool_call_id, content }`
 *     message keyed to the call that produced it.
 *
 * Widening is additive: a `streamTurn` that reads only `role` + `content` still
 * works; one that forwards the whole message to an OpenAI-compatible endpoint
 * now sends correct tool history.
 */
export type ToolLoopMessage = {
  role: string
  content: string | null
  tool_calls?: ToolLoopAssistantToolCall[]
  tool_call_id?: string
}

/** A tool-call id is required to key a `role: 'tool'` result back to its call.
 *  When the model omitted one, derive a stable id from the tool name so the
 *  assistant `tool_calls` entry and its `tool` result still match. */
function toolCallId(call: ToolLoopCall): string {
  return call.toolCallId ?? `call_${call.toolName}`
}

/** The assistant turn that emitted `pending`, in OpenAI shape: text content
 *  (null when the turn was tool-only) plus its `tool_calls` array. */
function assistantToolCallMessage(turnText: string, pending: ToolLoopCall[]): ToolLoopMessage {
  return {
    role: 'assistant',
    content: turnText.trim() || null,
    tool_calls: pending.map((call) => ({
      id: toolCallId(call),
      type: 'function',
      function: { name: call.toolName, arguments: JSON.stringify(call.args) },
    })),
  }
}

/** One `role: 'tool'` result message keyed to its call by `tool_call_id`. */
function toolResultMessage(call: ToolLoopCall, content: string): ToolLoopMessage {
  return { role: 'tool', tool_call_id: toolCallId(call), content }
}

function defaultRender(label: string, outcome: ToolCallOutcome): string {
  if (outcome.ok) return `- ${label} → ok: ${JSON.stringify(outcome.result)}`
  return `- ${label} → failed (${outcome.code}): ${outcome.message}`
}

// ── Awaitable variant (drain-only callers, tests) ──────────────────────────

export type ToolLoopEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolLoopCall }
  | { type: 'other'; event: unknown }

/** Why the loop stopped. `completed` = model finished naturally; `stuck-loop` =
 *  ≥3 consecutive identical tool calls (same tool + args); `backstop` = hit the
 *  runaway-backstop cap (200 by default); `deadline` = wall-clock deadlineMs
 *  exceeded; `budget` = maxCostUsd exhausted. Non-`completed` stops are infra /
 *  resource outcomes — eval scoring must distinguish them from capability failure. */
export type ToolLoopStopReason = 'completed' | 'stuck-loop' | 'backstop' | 'deadline' | 'budget'

export interface ToolLoopResult {
  finalText: string
  toolResults: Array<{ call: ToolLoopCall; label: string; outcome: ToolCallOutcome }>
  turns: number
  stopReason: ToolLoopStopReason
  /** @deprecated Use `stopReason !== 'completed'` instead. */
  cappedOut: boolean
}

export interface RunToolLoopOptions {
  systemPrompt: string
  userMessage: string
  priorMessages?: ToolLoopMessage[]
  streamTurn: (messages: ToolLoopMessage[]) => AsyncIterable<ToolLoopEvent>
  executeToolCall: (call: ToolLoopCall) => Promise<ToolCallOutcome>
  isExecutableTool: (toolName: string) => boolean
  /** Runaway-backstop cap. Default 200 — set far above any legitimate workflow.
   *  For per-workflow limits, use `maxCostUsd` or `deadlineMs` instead. */
  maxToolTurns?: number
  /** Wall-clock deadline in ms since epoch (Date.now()-based). When exceeded the
   *  loop stops with stopReason `deadline`. */
  deadlineMs?: number
  /** Maximum total cost in USD. Requires `costOf` to meter each tool call. */
  maxCostUsd?: number
  /** Return the USD cost of one outcome. Required for `maxCostUsd` to work. */
  costOf?: (call: ToolLoopCall, outcome: ToolCallOutcome) => number
  renderResult?: (label: string, outcome: ToolCallOutcome) => string
  labelFor?: (call: ToolLoopCall) => string
  runId?: string
  scenarioId?: string
  hooks?: RuntimeHooks
}

/** Run the bounded tool loop and return the final text + every executed tool
 *  outcome. Awaitable — callers needing to stream events to a UI use
 *  {@link streamToolLoop}. */
export async function runToolLoop(opts: RunToolLoopOptions): Promise<ToolLoopResult> {
  const backstop = opts.maxToolTurns ?? RUNAWAY_BACKSTOP_TURNS
  const render = opts.renderResult ?? defaultRender
  const labelFor = opts.labelFor ?? ((c: ToolLoopCall) => c.toolName)
  const runId = opts.runId ?? `agent-run-${randomSuffix()}`
  const messages: ToolLoopMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...(opts.priorMessages ?? []),
    { role: 'user', content: opts.userMessage },
  ]
  const observer = createToolLoopObserver(opts.hooks, runId, opts.scenarioId)
  const toolResults: ToolLoopResult['toolResults'] = []
  let finalText = ''
  let turns = 0
  let accumulatedCostUsd = 0
  // Stuck-loop detection: track the last canonical-JSON call signature and how
  // many consecutive times we've seen it.
  let lastCallHash: string | null = null
  let consecutiveCount = 0

  observer.loopBefore(backstop, messages.length)

  for (let toolTurn = 0; ; toolTurn++) {
    turns++

    // Wall-clock deadline check — before every new turn.
    if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
      observer.loopAfter({ turns, toolResults: toolResults.length, stopReason: 'deadline' })
      return { finalText, toolResults, turns, stopReason: 'deadline', cappedOut: true }
    }

    let turnText = ''
    const pending: ToolLoopCall[] = []
    const turnEventId = observer.turnBefore(toolTurn, messages.length)
    for await (const ev of opts.streamTurn([...messages])) {
      if (ev.type === 'text') {
        turnText += ev.text
        finalText += ev.text
      } else if (ev.type === 'tool_call' && opts.isExecutableTool(ev.call.toolName)) {
        pending.push(ev.call)
      }
    }
    if (pending.length === 0) {
      observer.turnAfter(toolTurn, turnEventId, {
        pendingToolCalls: 0,
        finalTextChars: finalText.length,
      })
      break
    }

    // Runaway backstop — the model keeps emitting calls past the safety ceiling.
    if (toolTurn >= backstop) {
      observer.turnAfter(toolTurn, turnEventId, {
        pendingToolCalls: pending.length,
        stopReason: 'backstop',
      })
      observer.loopAfter({ turns, toolResults: toolResults.length, stopReason: 'backstop' })
      return { finalText, toolResults, turns, stopReason: 'backstop', cappedOut: true }
    }

    // The assistant turn that emitted the calls, carrying its tool_calls array,
    // so a strict model reads its own tool use back in OpenAI shape.
    messages.push(assistantToolCallMessage(turnText, pending))
    const outcomes: ExecutedToolCall[] = []
    for (const [callIndex, call] of pending.entries()) {
      // Stuck-loop detection: hash the first pending call each turn (a model
      // stuck in a loop re-issues the same call repeatedly, not alternating calls).
      const callHash = canonicalCallHash(call)
      if (callHash === lastCallHash) {
        consecutiveCount++
      } else {
        lastCallHash = callHash
        consecutiveCount = 1
      }
      if (consecutiveCount >= STUCK_LOOP_THRESHOLD) {
        observer.turnAfter(toolTurn, turnEventId, {
          pendingToolCalls: pending.length,
          stopReason: 'stuck-loop',
        })
        observer.loopAfter({ turns, toolResults: toolResults.length, stopReason: 'stuck-loop' })
        return { finalText, toolResults, turns, stopReason: 'stuck-loop', cappedOut: true }
      }

      const callEventId = observer.toolCallBefore(toolTurn, turnEventId, callIndex, call)
      let outcome: ToolCallOutcome
      try {
        outcome = await opts.executeToolCall(call)
      } catch (err) {
        outcome = {
          ok: false,
          code: 'executor_error',
          message: err instanceof Error ? err.message : String(err),
        }
      }

      // Budget check after each tool call.
      if (opts.maxCostUsd !== undefined && opts.costOf !== undefined) {
        accumulatedCostUsd += opts.costOf(call, outcome)
        if (accumulatedCostUsd >= opts.maxCostUsd) {
          const label = labelFor(call)
          toolResults.push({ call, label, outcome })
          messages.push(toolResultMessage(call, render(label, outcome)))
          observer.toolCallAfter(toolTurn, callEventId, call, outcome)
          observer.turnAfter(toolTurn, turnEventId, {
            pendingToolCalls: pending.length,
            stopReason: 'budget',
          })
          observer.loopAfter({ turns, toolResults: toolResults.length, stopReason: 'budget' })
          return { finalText, toolResults, turns, stopReason: 'budget', cappedOut: true }
        }
      }

      const label = labelFor(call)
      const rendered = render(label, outcome)
      toolResults.push({ call, label, outcome })
      outcomes.push({ call, label, outcome, rendered })
      // One role:'tool' message per result, keyed to its call by tool_call_id.
      messages.push(toolResultMessage(call, rendered))
      observer.toolCallAfter(toolTurn, callEventId, call, outcome)
    }
    observer.failureRecovery({
      toolTurn,
      messages,
      turnText,
      outcomes,
    })
    observer.turnAfter(toolTurn, turnEventId, {
      pendingToolCalls: pending.length,
      toolResults: outcomes.map((item) => ({
        toolName: item.call.toolName,
        toolCallId: item.call.toolCallId,
        ok: item.outcome.ok,
      })),
      failedToolCalls: outcomes.filter((item) => !item.outcome.ok).length,
    })
  }
  observer.loopAfter({ turns, toolResults: toolResults.length, stopReason: 'completed' })
  return { finalText, toolResults, turns, stopReason: 'completed', cappedOut: false }
}

// ── Streaming variant (SSE chat runtimes + per-event telemetry) ────────────

export type StreamToolLoopYield<Raw> =
  | { kind: 'event'; event: Raw }
  | {
      kind: 'tool_result'
      toolName: string
      toolCallId?: string
      label: string
      outcome: ToolCallOutcome
    }
  | { kind: 'capped'; pending: number; stopReason: Exclude<ToolLoopStopReason, 'completed'> }

export interface StreamToolLoopOptions<Raw> {
  systemPrompt: string
  userMessage: string
  priorMessages?: ToolLoopMessage[]
  streamTurn: (messages: ToolLoopMessage[]) => AsyncIterable<Raw>
  extractText: (event: Raw) => string
  extractToolCall: (event: Raw) => ToolLoopCall | null
  isExecutableTool: (toolName: string) => boolean
  executeToolCall: (call: ToolLoopCall) => Promise<ToolCallOutcome>
  /** Runaway-backstop cap. Default 200 — set far above any legitimate workflow. */
  maxToolTurns?: number
  /** Wall-clock deadline in ms since epoch (Date.now()-based). */
  deadlineMs?: number
  /** Maximum total cost in USD. Requires `costOf` to meter each tool call. */
  maxCostUsd?: number
  /** Return the USD cost of one outcome. Required for `maxCostUsd` to work. */
  costOf?: (call: ToolLoopCall, outcome: ToolCallOutcome) => number
  renderResult?: (label: string, outcome: ToolCallOutcome) => string
  labelFor?: (call: ToolLoopCall) => string
  runId?: string
  scenarioId?: string
  hooks?: RuntimeHooks
}

/** Streaming bounded tool loop: yields each raw turn event (the caller maps +
 *  telemetries + re-emits it) and each executed `tool_result`; emits one
 *  `capped` if it stops for any non-completed reason with calls still pending. */
export async function* streamToolLoop<Raw>(
  opts: StreamToolLoopOptions<Raw>,
): AsyncGenerator<StreamToolLoopYield<Raw>, void, unknown> {
  const backstop = opts.maxToolTurns ?? RUNAWAY_BACKSTOP_TURNS
  const render = opts.renderResult ?? defaultRender
  const labelFor = opts.labelFor ?? ((c: ToolLoopCall) => c.toolName)
  const runId = opts.runId ?? `agent-run-${randomSuffix()}`
  const messages: ToolLoopMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...(opts.priorMessages ?? []),
    { role: 'user', content: opts.userMessage },
  ]
  const observer = createToolLoopObserver(opts.hooks, runId, opts.scenarioId)
  let accumulatedCostUsd = 0
  let lastCallHash: string | null = null
  let consecutiveCount = 0

  observer.loopBefore(backstop, messages.length)

  for (let toolTurn = 0; ; toolTurn++) {
    // Wall-clock deadline check before every new turn.
    if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
      observer.loopAfter({ turns: toolTurn + 1, stopReason: 'deadline' })
      yield { kind: 'capped', pending: 0, stopReason: 'deadline' }
      return
    }

    let turnText = ''
    const pending: ToolLoopCall[] = []
    const turnEventId = observer.turnBefore(toolTurn, messages.length)
    for await (const event of opts.streamTurn([...messages])) {
      yield { kind: 'event', event }
      turnText += opts.extractText(event)
      const call = opts.extractToolCall(event)
      if (call && opts.isExecutableTool(call.toolName)) pending.push(call)
    }
    if (pending.length === 0) {
      observer.turnAfter(toolTurn, turnEventId, { pendingToolCalls: 0 })
      observer.loopAfter({ turns: toolTurn + 1, stopReason: 'completed' })
      return
    }

    // Runaway backstop.
    if (toolTurn >= backstop) {
      observer.turnAfter(toolTurn, turnEventId, {
        pendingToolCalls: pending.length,
        stopReason: 'backstop',
      })
      observer.loopAfter({ turns: toolTurn + 1, stopReason: 'backstop' })
      yield { kind: 'capped', pending: pending.length, stopReason: 'backstop' }
      return
    }

    // The assistant turn that emitted the calls, carrying its tool_calls array,
    // so a strict model reads its own tool use back in OpenAI shape.
    messages.push(assistantToolCallMessage(turnText, pending))
    const outcomes: ExecutedToolCall[] = []
    for (const [callIndex, call] of pending.entries()) {
      // Stuck-loop detection.
      const callHash = canonicalCallHash(call)
      if (callHash === lastCallHash) {
        consecutiveCount++
      } else {
        lastCallHash = callHash
        consecutiveCount = 1
      }
      if (consecutiveCount >= STUCK_LOOP_THRESHOLD) {
        observer.turnAfter(toolTurn, turnEventId, {
          pendingToolCalls: pending.length,
          stopReason: 'stuck-loop',
        })
        observer.loopAfter({ turns: toolTurn + 1, stopReason: 'stuck-loop' })
        yield { kind: 'capped', pending: pending.length, stopReason: 'stuck-loop' }
        return
      }

      const callEventId = observer.toolCallBefore(toolTurn, turnEventId, callIndex, call)
      let outcome: ToolCallOutcome
      try {
        outcome = await opts.executeToolCall(call)
      } catch (err) {
        outcome = {
          ok: false,
          code: 'executor_error',
          message: err instanceof Error ? err.message : String(err),
        }
      }

      // Budget check after each tool call.
      if (opts.maxCostUsd !== undefined && opts.costOf !== undefined) {
        accumulatedCostUsd += opts.costOf(call, outcome)
        if (accumulatedCostUsd >= opts.maxCostUsd) {
          const label = labelFor(call)
          yield {
            kind: 'tool_result',
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            label,
            outcome,
          }
          messages.push(toolResultMessage(call, render(label, outcome)))
          observer.toolCallAfter(toolTurn, callEventId, call, outcome)
          observer.turnAfter(toolTurn, turnEventId, {
            pendingToolCalls: pending.length,
            stopReason: 'budget',
          })
          observer.loopAfter({ turns: toolTurn + 1, stopReason: 'budget' })
          yield { kind: 'capped', pending: pending.length, stopReason: 'budget' }
          return
        }
      }

      const label = labelFor(call)
      yield {
        kind: 'tool_result',
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        label,
        outcome,
      }
      const rendered = render(label, outcome)
      outcomes.push({ call, label, outcome, rendered })
      // One role:'tool' message per result, keyed to its call by tool_call_id.
      messages.push(toolResultMessage(call, rendered))
      observer.toolCallAfter(toolTurn, callEventId, call, outcome)
    }
    observer.failureRecovery({
      toolTurn,
      messages,
      turnText,
      outcomes,
    })
    observer.turnAfter(toolTurn, turnEventId, {
      pendingToolCalls: pending.length,
      toolResults: outcomes.map((item) => ({
        toolName: item.call.toolName,
        toolCallId: item.call.toolCallId,
        ok: item.outcome.ok,
      })),
      failedToolCalls: outcomes.filter((item) => !item.outcome.ok).length,
    })
  }
}

interface ExecutedToolCall {
  call: ToolLoopCall
  label: string
  outcome: ToolCallOutcome
  rendered: string
}

interface NotifyToolFailureRecoveryOptions {
  hooks?: RuntimeHooks
  runId: string
  scenarioId?: string
  stepIndex: number
  messages: ToolLoopMessage[]
  turnText: string
  outcomes: ExecutedToolCall[]
}

interface NotifyToolLoopEventOptions {
  hooks?: RuntimeHooks
  runId: string
  scenarioId?: string
  target: 'agent.run' | 'agent.turn' | 'agent.tool_call'
  phase: 'before' | 'after' | 'error' | 'event'
  id?: string
  stepIndex?: number
  parentId?: string
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface ToolLoopObserver {
  loopBefore(maxToolTurns: number, messageCount: number): void
  loopAfter(payload: Record<string, unknown>): void
  turnBefore(toolTurn: number, messageCount: number): string
  turnAfter(toolTurn: number, turnEventId: string, payload: Record<string, unknown>): void
  toolCallBefore(
    toolTurn: number,
    turnEventId: string,
    callIndex: number,
    call: ToolLoopCall,
  ): string
  toolCallAfter(
    toolTurn: number,
    callEventId: string,
    call: ToolLoopCall,
    outcome: ToolCallOutcome,
  ): void
  failureRecovery(options: {
    toolTurn: number
    messages: ToolLoopMessage[]
    turnText: string
    outcomes: ExecutedToolCall[]
  }): void
}

function createToolLoopObserver(
  hooks: RuntimeHooks | undefined,
  runId: string,
  scenarioId: string | undefined,
): ToolLoopObserver {
  const loopEventId = `${runId}:agent.run`
  return {
    loopBefore: (maxToolTurns, messageCount) => {
      notifyToolLoopEvent({
        hooks,
        runId,
        scenarioId,
        target: 'agent.run',
        phase: 'before',
        id: `${loopEventId}:before`,
        payload: { maxToolTurns, messageCount },
      })
    },
    loopAfter: (payload) => {
      notifyToolLoopEvent({
        hooks,
        runId,
        scenarioId,
        target: 'agent.run',
        phase: 'after',
        id: `${loopEventId}:after`,
        payload,
      })
    },
    turnBefore: (toolTurn, messageCount) => {
      const turnEventId = `${loopEventId}:${toolTurn}`
      notifyToolLoopEvent({
        hooks,
        runId,
        scenarioId,
        target: 'agent.turn',
        phase: 'before',
        id: turnEventId,
        stepIndex: toolTurn,
        parentId: loopEventId,
        payload: { messageCount },
      })
      return turnEventId
    },
    turnAfter: (toolTurn, turnEventId, payload) => {
      notifyToolLoopEvent({
        hooks,
        runId,
        scenarioId,
        target: 'agent.turn',
        phase: 'after',
        id: `${turnEventId}:after`,
        stepIndex: toolTurn,
        parentId: turnEventId,
        payload,
      })
    },
    toolCallBefore: (toolTurn, turnEventId, callIndex, call) => {
      const callEventId = `${turnEventId}:tool-call:${callIndex}`
      notifyToolLoopEvent({
        hooks,
        runId,
        scenarioId,
        target: 'agent.tool_call',
        phase: 'before',
        id: callEventId,
        stepIndex: toolTurn,
        parentId: turnEventId,
        payload: toolCallPayload(call),
      })
      return callEventId
    },
    toolCallAfter: (toolTurn, callEventId, call, outcome) => {
      notifyToolLoopEvent({
        hooks,
        runId,
        scenarioId,
        target: 'agent.tool_call',
        phase: 'after',
        id: `${callEventId}:after`,
        stepIndex: toolTurn,
        parentId: callEventId,
        payload: { ...toolCallPayload(call), outcome: outcomePayload(outcome) },
      })
    },
    failureRecovery: (options) => {
      notifyToolFailureRecovery({
        hooks,
        runId,
        scenarioId,
        stepIndex: options.toolTurn,
        messages: options.messages,
        turnText: options.turnText,
        outcomes: options.outcomes,
      })
    },
  }
}

function notifyToolLoopEvent(options: NotifyToolLoopEventOptions): void {
  notifyRuntimeHookEvent(options.hooks, {
    id: options.id ?? `${options.runId}:${options.target}:${options.phase}`,
    runId: options.runId,
    scenarioId: options.scenarioId,
    target: options.target,
    phase: options.phase,
    timestamp: Date.now(),
    stepIndex: options.stepIndex,
    parentId: options.parentId,
    payload: options.payload,
    metadata: { producer: 'tool-loop', ...options.metadata },
  })
}

function notifyToolFailureRecovery(options: NotifyToolFailureRecoveryOptions): void {
  const failed = options.outcomes.filter((item) => !item.outcome.ok)
  if (failed.length === 0) return

  const evidence: RuntimeDecisionEvidenceRef[] = []
  for (const item of failed) {
    const id = item.call.toolCallId ?? `${options.stepIndex}:${item.label}`
    evidence.push({
      source: 'tool_call',
      id,
      detail: `${item.call.toolName} ${stringifySafe(item.call.args, 2_000)}`,
      metadata: { toolName: item.call.toolName, label: item.label },
    })
    evidence.push({
      source: 'tool_result',
      id: `${id}:result`,
      detail: item.rendered,
      metadata: failureMetadata(item.outcome),
    })
  }

  notifyRuntimeDecisionPoint(options.hooks, {
    id: `${options.runId}:agent.turn:${options.stepIndex}:failure-recovery`,
    runId: options.runId,
    scenarioId: options.scenarioId,
    stepIndex: options.stepIndex,
    kind: 'retry',
    candidateActions: [...FAILURE_RECOVERY_ACTIONS],
    context: renderDecisionContext(options.messages, options.turnText, options.outcomes),
    evidence,
    metadata: {
      target: 'failure-recovery',
      source: 'agent.turn',
      failedToolCount: failed.length,
      toolNames: failed.map((item) => item.call.toolName),
    },
  })
}

function toolCallPayload(call: ToolLoopCall): Record<string, unknown> {
  return {
    toolName: call.toolName,
    toolCallId: call.toolCallId,
    argsPreview: stringifySafe(call.args, 2_000),
  }
}

function outcomePayload(outcome: ToolCallOutcome): Record<string, unknown> {
  if (!outcome.ok) {
    return {
      ok: false,
      code: outcome.code,
      message: trimText(outcome.message, 2_000),
      status: outcome.status,
    }
  }
  return {
    ok: true,
    resultPreview: stringifySafe(outcome.result, 2_000),
  }
}

function failureMetadata(outcome: ToolCallOutcome): Record<string, unknown> | undefined {
  if (outcome.ok) return undefined
  return {
    code: outcome.code,
    message: outcome.message,
    status: outcome.status,
  }
}

function renderDecisionContext(
  messages: ToolLoopMessage[],
  turnText: string,
  outcomes: ExecutedToolCall[],
): string {
  const recent = messages.slice(-6).map((message) => `[${message.role}]\n${message.content ?? ''}`)
  const assistant = turnText.trim() ? [`[assistant]\n${turnText}`] : []
  const toolResults = [`[tool results]\n${outcomes.map((item) => item.rendered).join('\n')}`]
  return trimText(
    [...recent, ...assistant, ...toolResults].join('\n\n'),
    DEFAULT_DECISION_CONTEXT_CHARS,
  )
}

/** Canonical identifier for a tool call used by stuck-loop detection.
 *  Keys are sorted so `{b:1,a:2}` and `{a:2,b:1}` produce the same hash. */
function canonicalCallHash(call: ToolLoopCall): string {
  const sortedArgs = Object.fromEntries(
    Object.entries(call.args).sort(([a], [b]) => a.localeCompare(b)),
  )
  return `${call.toolName}:${JSON.stringify(sortedArgs)}`
}

function stringifySafe(value: unknown, max: number): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return trimText(text, max)
}

function trimText(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function randomSuffix(len = 8): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + len)
}
