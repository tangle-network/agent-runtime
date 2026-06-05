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

const DEFAULT_MAX_TOOL_TURNS = 8
const DEFAULT_DECISION_CONTEXT_CHARS = 12_000
const FAILURE_RECOVERY_ACTIONS = ['retry', 'verify', 'continue', 'stop']

export type ToolLoopMessage = { role: string; content: string }

function defaultRender(label: string, outcome: ToolCallOutcome): string {
  if (outcome.ok) return `- ${label} → ok: ${JSON.stringify(outcome.result)}`
  return `- ${label} → failed (${outcome.code}): ${outcome.message}`
}

// ── Awaitable variant (drain-only callers, tests) ──────────────────────────

export type ToolLoopEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolLoopCall }
  | { type: 'other'; event: unknown }

export interface ToolLoopResult {
  finalText: string
  toolResults: Array<{ call: ToolLoopCall; label: string; outcome: ToolCallOutcome }>
  turns: number
  cappedOut: boolean
}

export interface RunToolLoopOptions {
  systemPrompt: string
  userMessage: string
  priorMessages?: ToolLoopMessage[]
  streamTurn: (messages: ToolLoopMessage[]) => AsyncIterable<ToolLoopEvent>
  executeToolCall: (call: ToolLoopCall) => Promise<ToolCallOutcome>
  isExecutableTool: (toolName: string) => boolean
  maxToolTurns?: number
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
  const maxTurns = opts.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS
  const render = opts.renderResult ?? defaultRender
  const labelFor = opts.labelFor ?? ((c: ToolLoopCall) => c.toolName)
  const runId = opts.runId ?? `tool-loop-${randomSuffix()}`
  const messages: ToolLoopMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...(opts.priorMessages ?? []),
    { role: 'user', content: opts.userMessage },
  ]
  const observer = createToolLoopObserver(opts.hooks, runId, opts.scenarioId)
  const toolResults: ToolLoopResult['toolResults'] = []
  let finalText = ''
  let turns = 0

  observer.loopBefore(maxTurns, messages.length)

  for (let toolTurn = 0; ; toolTurn++) {
    turns++
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
    if (toolTurn >= maxTurns) {
      observer.turnAfter(toolTurn, turnEventId, {
        pendingToolCalls: pending.length,
        cappedOut: true,
      })
      observer.loopAfter({ turns, toolResults: toolResults.length, cappedOut: true })
      return { finalText, toolResults, turns, cappedOut: true }
    }
    if (turnText.trim()) messages.push({ role: 'assistant', content: turnText })
    const lines: string[] = []
    const outcomes: ExecutedToolCall[] = []
    for (const [callIndex, call] of pending.entries()) {
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
      const label = labelFor(call)
      const rendered = render(label, outcome)
      toolResults.push({ call, label, outcome })
      lines.push(rendered)
      outcomes.push({ call, label, outcome, rendered })
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
    messages.push({ role: 'user', content: `Tool results:\n${lines.join('\n')}` })
  }
  observer.loopAfter({ turns, toolResults: toolResults.length, cappedOut: false })
  return { finalText, toolResults, turns, cappedOut: false }
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
  | { kind: 'capped'; pending: number }

export interface StreamToolLoopOptions<Raw> {
  systemPrompt: string
  userMessage: string
  priorMessages?: ToolLoopMessage[]
  streamTurn: (messages: ToolLoopMessage[]) => AsyncIterable<Raw>
  extractText: (event: Raw) => string
  extractToolCall: (event: Raw) => ToolLoopCall | null
  isExecutableTool: (toolName: string) => boolean
  executeToolCall: (call: ToolLoopCall) => Promise<ToolCallOutcome>
  maxToolTurns?: number
  renderResult?: (label: string, outcome: ToolCallOutcome) => string
  labelFor?: (call: ToolLoopCall) => string
  runId?: string
  scenarioId?: string
  hooks?: RuntimeHooks
}

/** Streaming bounded tool loop: yields each raw turn event (the caller maps +
 *  telemetries + re-emits it) and each executed `tool_result`; emits one
 *  `capped` if it stops at the turn limit with calls still pending. */
export async function* streamToolLoop<Raw>(
  opts: StreamToolLoopOptions<Raw>,
): AsyncGenerator<StreamToolLoopYield<Raw>, void, unknown> {
  const maxTurns = opts.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS
  const render = opts.renderResult ?? defaultRender
  const labelFor = opts.labelFor ?? ((c: ToolLoopCall) => c.toolName)
  const runId = opts.runId ?? `tool-loop-${randomSuffix()}`
  const messages: ToolLoopMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...(opts.priorMessages ?? []),
    { role: 'user', content: opts.userMessage },
  ]
  const observer = createToolLoopObserver(opts.hooks, runId, opts.scenarioId)

  observer.loopBefore(maxTurns, messages.length)

  for (let toolTurn = 0; ; toolTurn++) {
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
      observer.loopAfter({ turns: toolTurn + 1, cappedOut: false })
      return
    }
    if (toolTurn >= maxTurns) {
      observer.turnAfter(toolTurn, turnEventId, {
        pendingToolCalls: pending.length,
        cappedOut: true,
      })
      observer.loopAfter({ turns: toolTurn + 1, cappedOut: true })
      yield { kind: 'capped', pending: pending.length }
      return
    }
    if (turnText.trim()) messages.push({ role: 'assistant', content: turnText })
    const lines: string[] = []
    const outcomes: ExecutedToolCall[] = []
    for (const [callIndex, call] of pending.entries()) {
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
      const label = labelFor(call)
      yield {
        kind: 'tool_result',
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        label,
        outcome,
      }
      const rendered = render(label, outcome)
      lines.push(rendered)
      outcomes.push({ call, label, outcome, rendered })
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
    messages.push({ role: 'user', content: `Tool results:\n${lines.join('\n')}` })
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
  target: 'tool-loop' | 'tool-loop.turn' | 'tool-loop.tool-call'
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
  const loopEventId = `${runId}:tool-loop`
  return {
    loopBefore: (maxToolTurns, messageCount) => {
      notifyToolLoopEvent({
        hooks,
        runId,
        scenarioId,
        target: 'tool-loop',
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
        target: 'tool-loop',
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
        target: 'tool-loop.turn',
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
        target: 'tool-loop.turn',
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
        target: 'tool-loop.tool-call',
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
        target: 'tool-loop.tool-call',
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
    metadata: options.metadata,
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
    id: `${options.runId}:tool-loop:${options.stepIndex}:failure-recovery`,
    runId: options.runId,
    scenarioId: options.scenarioId,
    stepIndex: options.stepIndex,
    kind: 'retry',
    candidateActions: [...FAILURE_RECOVERY_ACTIONS],
    context: renderDecisionContext(options.messages, options.turnText, options.outcomes),
    evidence,
    metadata: {
      target: 'failure-recovery',
      source: 'tool-loop',
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
  const recent = messages.slice(-6).map((message) => `[${message.role}]\n${message.content}`)
  const assistant = turnText.trim() ? [`[assistant]\n${turnText}`] : []
  const toolResults = [`[tool results]\n${outcomes.map((item) => item.rendered).join('\n')}`]
  return trimText(
    [...recent, ...assistant, ...toolResults].join('\n\n'),
    DEFAULT_DECISION_CONTEXT_CHARS,
  )
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
