/**
 * THE canonical agentic tool-loop. One inference turn → run any requested tools → fold the
 * results back as `tool` messages → repeat, until the model answers without a tool call or the
 * turn budget is hit. One turn = one inference call (the equal-compute unit vs random@k).
 *
 * The inference is an INJECTABLE seam (`ToolLoopChat`): a router model, a sandboxed CLI
 * harness, or a scripted mock all satisfy it — so the loop is backend-agnostic. The metered /
 * steerable concerns the call sites add (a driver's conserved-pool + deadline bound; an inline
 * executor's inbox flush + abort) attach via optional `hooks`; the skeleton stays one copy.
 */
import type { RouterToolCall, ToolSpec } from './router-client'

type Msg = Record<string, unknown>

/** One inference turn over the running conversation + the tool specs → the model's text, any
 *  tool calls, and token usage. The seam every brain satisfies. */
export type ToolLoopChat = (
  messages: ReadonlyArray<Msg>,
  tools: ReadonlyArray<ToolSpec>,
) => Promise<{
  content?: string | null
  toolCalls: RouterToolCall[]
  usage?: { input: number; output: number }
  /** The turn's inference cost (usd) when the provider priced it — for callers that meter usd
   *  into a conserved pool (the supervisor brain). `runToolLoop` itself ignores it. */
  costUsd?: number
}>

/** Optional per-loop concerns the metered/steerable call sites attach. The loop is one copy;
 *  the budget/deadline bound, the inbox flush, and the metering hook in HERE — not as forks. */
export interface ToolLoopHooks {
  /** Run before each inference turn (e.g. flush queued steers into `messages`). */
  beforeTurn?(turn: number, messages: Msg[]): void | Promise<void>
  /** Return true to stop before the next turn (e.g. pool starved / deadline passed / aborted). */
  stopBefore?(turn: number): boolean
  /** Each turn's usage, for metering into a conserved budget pool. */
  onUsage?(usage: { input: number; output: number }): void
}

export interface ToolLoopResult {
  /** The model's final assistant text (where it stopped calling tools, or the budget turn). */
  final: string
  /** Inference turns spent (≤ maxTurns) — the equal-compute unit. */
  turns: number
  toolCalls: number
  /** The behavior trace: each call + its result, in order — what a trace-analyst steerer reads. */
  toolTrace: Array<{ name: string; args: string; result: string }>
  usage: { input: number; output: number }
  /** The full conversation after the loop — lets a caller CARRY the messages into the next shot. */
  messages: Msg[]
}

export async function runToolLoop(opts: {
  chat: ToolLoopChat
  tools: ReadonlyArray<ToolSpec>
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
  /** Seed the conversation (a fresh `[system,user]` or a depth continuation). The array is copied. */
  initialMessages: ReadonlyArray<Msg>
  maxTurns?: number
  hooks?: ToolLoopHooks
}): Promise<ToolLoopResult> {
  const maxTurns = opts.maxTurns ?? 4
  const messages: Msg[] = [...opts.initialMessages]
  let toolCalls = 0
  let lastText = ''
  const usage = { input: 0, output: 0 }
  const toolTrace: Array<{ name: string; args: string; result: string }> = []

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    if (opts.hooks?.stopBefore?.(turn)) break
    await opts.hooks?.beforeTurn?.(turn, messages)
    const r = await opts.chat(messages, opts.tools)
    if (r.usage) {
      usage.input += r.usage.input
      usage.output += r.usage.output
      opts.hooks?.onUsage?.(r.usage)
    }
    if (r.content) lastText = r.content
    if (r.toolCalls.length === 0)
      return { final: lastText, turns: turn, toolCalls, toolTrace, usage, messages }

    // Record the assistant turn verbatim (content + the tool_calls it requested), then run each
    // call and fold the result back as a `tool` message.
    messages.push({
      role: 'assistant',
      content: r.content ?? '',
      tool_calls: r.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    })
    for (const tc of r.toolCalls) {
      toolCalls += 1
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.arguments) as Record<string, unknown>
      } catch {
        // Malformed args from the model are a real outcome, not an infra fault — feed the error
        // back so it can correct, rather than throwing the whole loop.
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `error: arguments were not valid JSON: ${tc.arguments.slice(0, 200)}`,
        })
        continue
      }
      const out = await opts.execute(tc.name, args)
      messages.push({ role: 'tool', tool_call_id: tc.id, content: out })
      toolTrace.push({ name: tc.name, args: tc.arguments, result: out })
    }
  }
  return { final: lastText, turns: maxTurns, toolCalls, toolTrace, usage, messages }
}
