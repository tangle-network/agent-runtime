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
   *  into a conserved pool (the supervisor brain). `runBrainLoop` itself ignores it. */
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

/** Self-compaction — bound the loop's OWN context window the way a fresh-respawn (dumb-Ralph) loop
 *  does, but in place. A stateless chat API re-sends the WHOLE running conversation every turn, so an
 *  agent that accumulates dozens of turns of tool results re-bills its entire transcript on every
 *  inference — the context-overflow-one-level-up that the conserved budget pool cannot fix. With
 *  compaction set, once the conversation exceeds `thresholdTokens` the accumulated middle (every prior
 *  assistant turn + tool result) is distilled into ONE compact progress note and the conversation is
 *  reset to `[...head, digest]`: the preserved head (system + the original task) survives, the stale
 *  turn-by-turn history does not. The model keeps deciding; it stops re-billing the whole transcript.
 *  Fires at a CLEAN turn boundary (after a turn's tool results are folded in, before the next
 *  inference) so it never orphans an assistant `tool_calls` from its `tool` replies. */
export interface ToolLoopCompaction {
  /** Compact once the estimated token count of the conversation exceeds this. */
  readonly thresholdTokens: number
  /** Distill the conversation into a compact progress note that REPLACES the middle. Receives the
   *  full conversation (so it can summarize everything done so far); returns the digest string. */
  readonly distill: (messages: ReadonlyArray<Msg>) => Promise<string> | string
  /** Leading messages preserved verbatim (system + the original task). Default 2. */
  readonly preserveHead?: number
  /** Token estimator over the conversation. Default ≈ chars/4 (incl. tool-call arguments). */
  readonly estimateTokens?: (messages: ReadonlyArray<Msg>) => number
  /** Notified each time a compaction fires — for observability/metering. */
  readonly onCompact?: (info: { turn: number; beforeTokens: number; afterTokens: number }) => void
}

/** Public supervisor-facing compaction config: same knobs as the primitive, but `distill` is optional
 *  because the supervisor has a default digest that combines a brain note with live worker state. */
export type ToolLoopCompactionOptions = Omit<ToolLoopCompaction, 'distill'> & {
  readonly distill?: ToolLoopCompaction['distill']
}

/** ≈ chars/4 over content + any tool-call arguments — a cheap, provider-agnostic size proxy. The
 *  exact constant does not matter: it only has to track GROWTH so the threshold trips as history
 *  accumulates, which a uniform chars/4 does. */
function estimateConversationTokens(messages: ReadonlyArray<Msg>): number {
  let chars = 0
  for (const m of messages) {
    const content = (m as { content?: unknown }).content
    chars += typeof content === 'string' ? content.length : safeJsonLength(content)
    const calls = (m as { tool_calls?: Array<{ function?: { arguments?: string } }> }).tool_calls
    if (calls) for (const c of calls) chars += c.function?.arguments?.length ?? 0
  }
  return Math.ceil(chars / 4)
}

function safeJsonLength(value: unknown): number {
  if (value === undefined || value === null) return 0
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return String(value).length
  }
}

/** Distill the conversation's accumulated middle into one note and splice it in, IF the estimated
 *  size exceeds the threshold. Returns true when a compaction fired. The preserved head keeps the
 *  system + task verbatim; everything after collapses to a single `user` progress note, so no
 *  assistant `tool_calls` is left without its `tool` replies. */
async function maybeCompact(
  messages: Msg[],
  c: ToolLoopCompaction,
  turn: number,
): Promise<boolean> {
  // A negative `preserveHead` would make `splice(head, …)` index from the END and silently preserve
  // the wrong messages; an invalid value falls back to the default (keep system + task) rather than
  // zero (which would splice the system message away). A too-large value is already safe — the length
  // guard below makes it a no-op. (Callers never pass `preserveHead`; this guards the exported primitive.)
  const head = c.preserveHead !== undefined && c.preserveHead > 0 ? c.preserveHead : 2
  // Nothing meaningful to collapse yet (only head + at most one trailing message).
  if (messages.length <= head + 1) return false
  const estimate = c.estimateTokens ?? estimateConversationTokens
  const before = estimate(messages)
  if (before <= c.thresholdTokens) return false
  const digest = await c.distill([...messages])
  messages.splice(head, messages.length - head, {
    role: 'user',
    content: `[earlier work compacted to save context — progress so far]\n${digest}`,
  })
  c.onCompact?.({ turn, beforeTokens: before, afterTokens: estimate(messages) })
  return true
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

export async function runBrainLoop(opts: {
  chat: ToolLoopChat
  tools: ReadonlyArray<ToolSpec>
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
  /** Seed the conversation (a fresh `[system,user]` or a depth continuation). The array is copied. */
  initialMessages: ReadonlyArray<Msg>
  maxTurns?: number
  hooks?: ToolLoopHooks
  /** Bound the loop's own context window in place (the chapter-close a dumb-Ralph respawn gets for
   *  free). Off by default — when unset the conversation accumulates exactly as before. */
  compaction?: ToolLoopCompaction
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
    // Close the chapter BEFORE the inference turn that would otherwise re-bill the whole transcript:
    // distill the accumulated middle to a compact note so this and every later turn pay O(working-set),
    // not O(total-history). A clean boundary — the prior turn's tool replies are already folded in.
    if (opts.compaction) await maybeCompact(messages, opts.compaction, turn)
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
