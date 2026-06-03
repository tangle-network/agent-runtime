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
 * event type — this file imports nothing.
 */

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
  priorMessages?: Array<{ role: string; content: string }>
  streamTurn: (messages: Array<{ role: string; content: string }>) => AsyncIterable<ToolLoopEvent>
  executeToolCall: (call: ToolLoopCall) => Promise<ToolCallOutcome>
  isExecutableTool: (toolName: string) => boolean
  maxToolTurns?: number
  renderResult?: (label: string, outcome: ToolCallOutcome) => string
  labelFor?: (call: ToolLoopCall) => string
}

/** Run the bounded tool loop and return the final text + every executed tool
 *  outcome. Awaitable — callers needing to stream events to a UI use
 *  {@link streamToolLoop}. */
export async function runToolLoop(opts: RunToolLoopOptions): Promise<ToolLoopResult> {
  const maxTurns = opts.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS
  const render = opts.renderResult ?? defaultRender
  const labelFor = opts.labelFor ?? ((c: ToolLoopCall) => c.toolName)
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: opts.systemPrompt },
    ...(opts.priorMessages ?? []),
    { role: 'user', content: opts.userMessage },
  ]
  const toolResults: ToolLoopResult['toolResults'] = []
  let finalText = ''
  let turns = 0

  for (let toolTurn = 0; ; toolTurn++) {
    turns++
    let turnText = ''
    const pending: ToolLoopCall[] = []
    for await (const ev of opts.streamTurn([...messages])) {
      if (ev.type === 'text') {
        turnText += ev.text
        finalText += ev.text
      } else if (ev.type === 'tool_call' && opts.isExecutableTool(ev.call.toolName)) {
        pending.push(ev.call)
      }
    }
    if (pending.length === 0) break
    if (toolTurn >= maxTurns) return { finalText, toolResults, turns, cappedOut: true }
    if (turnText.trim()) messages.push({ role: 'assistant', content: turnText })
    const lines: string[] = []
    for (const call of pending) {
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
      toolResults.push({ call, label, outcome })
      lines.push(render(label, outcome))
    }
    messages.push({ role: 'user', content: `Tool results:\n${lines.join('\n')}` })
  }
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
  priorMessages?: Array<{ role: string; content: string }>
  streamTurn: (messages: Array<{ role: string; content: string }>) => AsyncIterable<Raw>
  extractText: (event: Raw) => string
  extractToolCall: (event: Raw) => ToolLoopCall | null
  isExecutableTool: (toolName: string) => boolean
  executeToolCall: (call: ToolLoopCall) => Promise<ToolCallOutcome>
  maxToolTurns?: number
  renderResult?: (label: string, outcome: ToolCallOutcome) => string
  labelFor?: (call: ToolLoopCall) => string
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
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: opts.systemPrompt },
    ...(opts.priorMessages ?? []),
    { role: 'user', content: opts.userMessage },
  ]

  for (let toolTurn = 0; ; toolTurn++) {
    let turnText = ''
    const pending: ToolLoopCall[] = []
    for await (const event of opts.streamTurn([...messages])) {
      yield { kind: 'event', event }
      turnText += opts.extractText(event)
      const call = opts.extractToolCall(event)
      if (call && opts.isExecutableTool(call.toolName)) pending.push(call)
    }
    if (pending.length === 0) return
    if (toolTurn >= maxTurns) {
      yield { kind: 'capped', pending: pending.length }
      return
    }
    if (turnText.trim()) messages.push({ role: 'assistant', content: turnText })
    const lines: string[] = []
    for (const call of pending) {
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
      lines.push(render(label, outcome))
    }
    messages.push({ role: 'user', content: `Tool results:\n${lines.join('\n')}` })
  }
}
