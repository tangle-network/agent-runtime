/**
 * Bounded turn-level tool-dispatch loop.
 *
 * `runAgentTaskStream` runs ONE model turn; `runAgentRounds` orchestrates DELEGATED
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
 * event type. The only imported contracts are the runtime hook type (hooks are
 * execution-scoped observers, not part of the agent profile) and the task queue
 * a turn's calls run on.
 */

import { runTaskQueue } from './runtime/task-queue'
import type { RuntimeDecisionEvidenceRef, RuntimeHooks } from './runtime-hooks'
import { notifyRuntimeDecisionPoint, notifyRuntimeHookEvent } from './runtime-hooks'

export interface ToolLoopCall {
  toolCallId?: string
  toolName: string
  args: Record<string, unknown>
  /**
   * Provider-specific fields the model attached to this call, echoed back on
   * its assistant `tool_calls` entry in the next request. Gemini 3 returns
   * `extra_content: { google: { thought_signature } }` on each call and answers
   * HTTP 400 when the next request omits it.
   */
  providerFields?: Record<string, unknown>
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
/** Consecutive model turns issuing the same call set (tool + canonical-JSON args)
 *  that trigger stuck-loop detection. The window resets on any different set. */
const STUCK_LOOP_THRESHOLD = 3
/** Calls of one model turn that run at once unless `maxConcurrentToolCalls` says otherwise. */
const DEFAULT_CONCURRENT_TOOL_CALLS = 1

/** One OpenAI-shaped tool-call entry carried on an assistant message, plus any
 *  provider-specific fields the model attached to the call (`ToolLoopCall.providerFields`). */
export interface ToolLoopAssistantToolCall {
  [providerField: string]: unknown
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
      ...call.providerFields,
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

/**
 * One progress report from a running tool, shaped like an MCP `notifications/progress`
 * payload: a free-text `message`, a monotonic `progress` count with an optional
 * `total`, and any structured `data` the caller's UI understands.
 */
export interface ToolProgressUpdate {
  message?: string
  progress?: number
  total?: number
  data?: unknown
}

/** What the loop hands a running tool besides its call. */
export interface ToolCallContext {
  /**
   * Report progress while the call runs. The streaming loop yields each update as a
   * `tool_progress` step, in order, before the call's `tool_result`; updates sent after
   * the call settles are dropped.
   */
  progress: (update: ToolProgressUpdate) => void
}

/** Executes one tool call. Implementations that take only the call stay valid. */
export type ToolCallExecutor = (
  call: ToolLoopCall,
  context: ToolCallContext,
) => Promise<ToolCallOutcome>

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
 *  ≥3 consecutive model turns issuing the same calls (tool + args); `backstop` = hit the
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
  executeToolCall: ToolCallExecutor
  /** Receives each progress update a running tool reports, in order. */
  onToolProgress?: (call: ToolLoopCall, update: ToolProgressUpdate) => void
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
  /** How many of one model turn's calls run at once. Default 1: one at a time, in call order.
   *  Above 1, results and tool messages still keep call order; once `maxCostUsd` is spent no
   *  further call starts, and the turn stops with `budget` after the started calls settle. */
  maxConcurrentToolCalls?: number
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
  const overBudget = () =>
    opts.maxCostUsd !== undefined &&
    opts.costOf !== undefined &&
    accumulatedCostUsd >= opts.maxCostUsd
  const width = opts.maxConcurrentToolCalls ?? DEFAULT_CONCURRENT_TOOL_CALLS
  const isStuck = stuckLoopDetector()

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

    if (isStuck(pending)) {
      observer.turnAfter(toolTurn, turnEventId, {
        pendingToolCalls: pending.length,
        stopReason: 'stuck-loop',
      })
      observer.loopAfter({ turns, toolResults: toolResults.length, stopReason: 'stuck-loop' })
      return { finalText, toolResults, turns, stopReason: 'stuck-loop', cappedOut: true }
    }

    // The assistant turn that emitted the calls, carrying its tool_calls array,
    // so a strict model reads its own tool use back in OpenAI shape.
    messages.push(assistantToolCallMessage(turnText, pending))
    const queue = turnCalls(pending, width, overBudget, async (call, callIndex) => {
      const callEventId = observer.toolCallBefore(toolTurn, turnEventId, callIndex, call)
      let settled = false
      const outcome = await executeGuarded(opts.executeToolCall, call, (update) => {
        if (!settled) opts.onToolProgress?.(call, update)
      })
      settled = true
      if (opts.maxCostUsd !== undefined && opts.costOf !== undefined) {
        accumulatedCostUsd += opts.costOf(call, outcome)
      }
      observer.toolCallAfter(toolTurn, callEventId, call, outcome)
      return outcome
    })
    const executed: ToolCallOutcome[] = []
    for await (const settlement of queue) {
      if (settlement.status === 'rejected') throw settlement.reason
      executed[settlement.task.value] = settlement.value
    }
    const outcomes: ExecutedToolCall[] = []
    for (const [callIndex, outcome] of executed.entries()) {
      const call = pending[callIndex]!
      const label = labelFor(call)
      const rendered = render(label, outcome)
      toolResults.push({ call, label, outcome })
      outcomes.push({ call, label, outcome, rendered })
      // One role:'tool' message per result, keyed to its call by tool_call_id.
      messages.push(toolResultMessage(call, rendered))
    }
    if (overBudget()) {
      observer.turnAfter(toolTurn, turnEventId, {
        pendingToolCalls: pending.length,
        stopReason: 'budget',
      })
      observer.loopAfter({ turns, toolResults: toolResults.length, stopReason: 'budget' })
      return { finalText, toolResults, turns, stopReason: 'budget', cappedOut: true }
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
      kind: 'tool_progress'
      toolName: string
      toolCallId?: string
      update: ToolProgressUpdate
    }
  | {
      kind: 'tool_result'
      toolName: string
      toolCallId?: string
      label: string
      outcome: ToolCallOutcome
    }
  | {
      kind: 'capped'
      pending: number
      stopReason: Exclude<ToolLoopStopReason, 'completed'>
      /** On `deadline` only: the conversation after the system prompt, every tool call answered.
       *  Passing it back as `priorMessages` with no `userMessage` continues the same turn. */
      messages?: ToolLoopMessage[]
    }

export interface StreamToolLoopOptions<Raw> {
  systemPrompt: string
  /** Omit to continue a checkpointed turn whose `priorMessages` already end with tool results. */
  userMessage?: string
  priorMessages?: ToolLoopMessage[]
  streamTurn: (messages: ToolLoopMessage[]) => AsyncIterable<Raw>
  extractText: (event: Raw) => string
  extractToolCall: (event: Raw) => ToolLoopCall | null
  isExecutableTool: (toolName: string) => boolean
  executeToolCall: ToolCallExecutor
  /** Runaway-backstop cap. Default 200 — set far above any legitimate workflow. */
  maxToolTurns?: number
  /** Wall-clock deadline in ms since epoch (Date.now()-based). */
  deadlineMs?: number
  /** Maximum total cost in USD. Requires `costOf` to meter each tool call. */
  maxCostUsd?: number
  /** Return the USD cost of one outcome. Required for `maxCostUsd` to work. */
  costOf?: (call: ToolLoopCall, outcome: ToolCallOutcome) => number
  /** How many of one model turn's calls run at once. Default 1: one at a time, in call order.
   *  Above 1, each call's `tool_progress` streams as it lands; `tool_result`s and tool messages
   *  keep call order. Once `maxCostUsd` is spent no further call starts, and the turn stops
   *  with `budget` after the started calls settle. */
  maxConcurrentToolCalls?: number
  renderResult?: (label: string, outcome: ToolCallOutcome) => string
  labelFor?: (call: ToolLoopCall) => string
  runId?: string
  scenarioId?: string
  hooks?: RuntimeHooks
}

/** Streaming bounded tool loop: yields each raw turn event (the caller maps +
 *  telemetries + re-emits it), each `tool_progress` a running tool reports, and
 *  each executed `tool_result`; emits one `capped` if it stops for any
 *  non-completed reason with calls still pending. */
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
    ...(opts.userMessage !== undefined
      ? [{ role: 'user' as const, content: opts.userMessage }]
      : []),
  ]
  const observer = createToolLoopObserver(opts.hooks, runId, opts.scenarioId)
  let accumulatedCostUsd = 0
  const overBudget = () =>
    opts.maxCostUsd !== undefined &&
    opts.costOf !== undefined &&
    accumulatedCostUsd >= opts.maxCostUsd
  const width = opts.maxConcurrentToolCalls ?? DEFAULT_CONCURRENT_TOOL_CALLS
  const isStuck = stuckLoopDetector()

  observer.loopBefore(backstop, messages.length)

  for (let toolTurn = 0; ; toolTurn++) {
    // Wall-clock deadline check before every new turn.
    if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
      observer.loopAfter({ turns: toolTurn + 1, stopReason: 'deadline' })
      // A turn boundary: every call is answered, so the history is a resumable checkpoint.
      yield { kind: 'capped', pending: 0, stopReason: 'deadline', messages: messages.slice(1) }
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

    if (isStuck(pending)) {
      observer.turnAfter(toolTurn, turnEventId, {
        pendingToolCalls: pending.length,
        stopReason: 'stuck-loop',
      })
      observer.loopAfter({ turns: toolTurn + 1, stopReason: 'stuck-loop' })
      yield { kind: 'capped', pending: pending.length, stopReason: 'stuck-loop' }
      return
    }

    // The assistant turn that emitted the calls, carrying its tool_calls array,
    // so a strict model reads its own tool use back in OpenAI shape.
    messages.push(assistantToolCallMessage(turnText, pending))
    // Progress streams as it lands, attributed to its call; results stream in call order,
    // each after its own call's progress, and no update is accepted once its call settles.
    const progress: StreamToolLoopYield<Raw>[] = []
    const settled: ToolCallOutcome[] = []
    let wake: (() => void) | undefined
    const queue = turnCalls(pending, width, overBudget, async (call, callIndex) => {
      const callEventId = observer.toolCallBefore(toolTurn, turnEventId, callIndex, call)
      let done = false
      const outcome = await executeGuarded(opts.executeToolCall, call, (update) => {
        if (done) return
        progress.push({
          kind: 'tool_progress',
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          update,
        })
        wake?.()
      })
      done = true
      if (opts.maxCostUsd !== undefined && opts.costOf !== undefined) {
        accumulatedCostUsd += opts.costOf(call, outcome)
      }
      observer.toolCallAfter(toolTurn, callEventId, call, outcome)
      return outcome
    })
    const outcomes: ExecutedToolCall[] = []
    // The queue admits a call only while this generator pulls it, which it does only when it has
    // nothing to yield: call k+1 starts after the consumer has taken result k at width 1.
    let pull: ReturnType<typeof queue.next> | undefined
    try {
      while (outcomes.length < pending.length) {
        const update = progress.shift()
        if (update !== undefined) {
          yield update
          continue
        }
        const outcome = settled[outcomes.length]
        if (outcome !== undefined) {
          const call = pending[outcomes.length]!
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
          continue
        }
        pull ??= queue.next()
        const woke = new Promise<null>((resolve) => {
          wake = () => resolve(null)
        })
        const step = await Promise.race([pull, woke])
        wake = undefined
        if (step === null) continue
        pull = undefined
        if (step.done) break
        if (step.value.status === 'rejected') throw step.value.reason
        settled[step.value.task.value] = step.value.value
      }
    } finally {
      // Closing early (break, `return()` or a throw) stops admission and settles the started calls.
      await queue.return(undefined)
    }
    if (overBudget()) {
      observer.turnAfter(toolTurn, turnEventId, {
        pendingToolCalls: pending.length,
        stopReason: 'budget',
      })
      observer.loopAfter({ turns: toolTurn + 1, stopReason: 'budget' })
      yield { kind: 'capped', pending: pending.length, stopReason: 'budget' }
      return
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

/** Run one call; a thrown executor becomes an `executor_error` outcome. */
async function executeGuarded(
  execute: ToolCallExecutor,
  call: ToolLoopCall,
  progress: (update: ToolProgressUpdate) => void,
): Promise<ToolCallOutcome> {
  try {
    return await execute(call, { progress })
  } catch (err) {
    return {
      ok: false,
      code: 'executor_error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/** One model turn's calls as a task queue keyed by call index: admitted in call order, at most
 *  `width` at once, each only when the queue is pulled. The turn's first call always starts and
 *  no later one starts once the budget is spent, so width 1 checks it after each call. */
function turnCalls(
  calls: ToolLoopCall[],
  width: number,
  spent: () => boolean,
  run: (call: ToolLoopCall, callIndex: number) => Promise<ToolCallOutcome>,
) {
  let next = 0
  return runTaskQueue<number, ToolCallOutcome>({
    concurrency: width,
    take: () =>
      next < calls.length && (next === 0 || !spent())
        ? { id: String(next), value: next++ }
        : undefined,
    execute: ({ value }) => run(calls[value]!, value),
  })
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

/** Stuck-loop detection across model turns: true once {@link STUCK_LOOP_THRESHOLD}
 *  consecutive turns issue the same call set. Repeats inside one parallel batch
 *  are not a loop; each runs and its result reaches the model. */
function stuckLoopDetector(): (batch: ToolLoopCall[]) => boolean {
  let last: string | undefined
  let count = 0
  return (batch) => {
    const signature = [...new Set(batch.map(canonicalCallHash))].sort().join('\n')
    count = signature === last ? count + 1 : 1
    last = signature
    return count >= STUCK_LOOP_THRESHOLD
  }
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
