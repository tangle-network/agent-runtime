/**
 * @experimental
 *
 * `TraceSource` — the ONE substrate-agnostic source of a worker's tool-call trace. The online
 * detectors and the settle-time analyzers consume agent-eval `ToolSpan`s from here, regardless of
 * whether the worker is:
 *   - an OWNED tool loop (router-tools, cli-bridge tool dispatch) → push spans as we dispatch them;
 *   - a SANDBOX / fleet box → read the harness's tool calls off the session (`streamPrompt` parts
 *     live, `session.messages()` / `findCompletedTurn` at settle).
 *
 * The common currency is agent-eval's `ToolSpan` (so the same detectors + `buildTrajectory`/
 * `stuckLoopView`/`toolWasteView` run over any source). A source exposes two lanes:
 *   - `onSpan` — live spans for ONLINE detection (best-effort; a black-box box may only collect).
 *   - `collect` — the full span set at settle for the BATCH analyzers (always available).
 *
 * This module imports NO substrate SDK — it decodes generic message parts / OpenAI tool-call shapes.
 * The sandbox wiring (`sandboxSessionTraceSource`) is the thin adapter that feeds box session parts in.
 */

import type { ToolSpan } from '@tangle-network/agent-eval'

export interface ToolStepInput {
  readonly toolName: string
  readonly args: unknown
  readonly status?: 'ok' | 'error'
  readonly result?: unknown
}

export interface TraceSource {
  /** Subscribe to tool spans as they are produced (ONLINE). Returns an unsubscribe. A source that
   *  only exposes its trace at the end registers nothing and returns a no-op. */
  onSpan(handler: (span: ToolSpan) => void): () => void
  /** The full set of tool spans for the run (SETTLE / batch). Always available. */
  collect(): Promise<ToolSpan[]>
}

/** Project a normalized tool step into the canonical agent-eval `ToolSpan`. */
export function toToolSpan(input: ToolStepInput, runId: string, seq: number, at: number): ToolSpan {
  return {
    spanId: `${runId}-t${seq}`,
    runId,
    kind: 'tool',
    name: input.toolName,
    toolName: input.toolName,
    args: input.args,
    status: input.status ?? 'ok',
    startedAt: at,
    endedAt: at,
    ...(input.result !== undefined ? { result: input.result } : {}),
  }
}

/** Decode a single harness message part / OpenAI tool-call into a tool step, or `undefined` if it is
 *  not a tool call. Defensive across the shapes a harness or the OpenAI API emit:
 *    - OpenAI: `{ type:'function'|'tool_call', function:{ name, arguments } }` or `{ name, arguments }`
 *    - harness part: `{ type:'tool'|'tool-call'|'tool_use'|'tool-invocation', tool/name/toolName,
 *                      args/input/arguments, state/status }`
 *  Unknown args strings are left as-is (the detector hashes them); never throws. */
export function decodeToolPart(part: unknown): ToolStepInput | undefined {
  if (!part || typeof part !== 'object') return undefined
  const p = part as Record<string, unknown>
  const type = typeof p.type === 'string' ? p.type.toLowerCase() : ''
  const fn = (p.function ?? p.tool ?? p.toolInvocation) as Record<string, unknown> | undefined

  const isOpenAiToolCall = type === 'function' || type === 'tool_call' || !!p.function
  const isHarnessTool =
    type.includes('tool') || (typeof p.toolName === 'string' && p.toolName.length > 0)
  if (!isOpenAiToolCall && !isHarnessTool) return undefined

  const name =
    (typeof fn?.name === 'string' && fn.name) ||
    (typeof p.toolName === 'string' && p.toolName) ||
    (typeof p.name === 'string' && p.name) ||
    ''
  if (!name) return undefined

  const rawArgs = fn?.arguments ?? p.args ?? p.input ?? p.arguments ?? fn?.input
  const args = typeof rawArgs === 'string' ? safeParse(rawArgs) : (rawArgs ?? {})

  const state =
    (typeof p.state === 'string' && p.state) || (typeof p.status === 'string' && p.status)
  const status: 'ok' | 'error' | undefined =
    state === 'error' || p.error
      ? 'error'
      : state === 'completed' || state === 'result'
        ? 'ok'
        : undefined

  return { toolName: name, args, ...(status ? { status } : {}) }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

let runSeq = 0

/** A push source for OWNED tool loops (router-tools / cli-bridge tool dispatch): the loop calls
 *  `record(step)` for each tool call; it becomes a span, fan-out to live subscribers + buffered for
 *  `collect`. */
export function createPushTraceSource(opts: { runId?: string; now?: () => number } = {}): {
  source: TraceSource
  record: (input: ToolStepInput) => ToolSpan
} {
  const runId = opts.runId ?? `push-${runSeq++}`
  const now = opts.now ?? Date.now
  const spans: ToolSpan[] = []
  const subs = new Set<(span: ToolSpan) => void>()
  return {
    record(input) {
      const span = toToolSpan(input, runId, spans.length, now())
      spans.push(span)
      for (const fn of subs) fn(span)
      return span
    },
    source: {
      onSpan(handler) {
        subs.add(handler)
        return () => subs.delete(handler)
      },
      collect: () => Promise.resolve([...spans]),
    },
  }
}

/** A source backed by harness message PARTS (sandbox session, cli-bridge). `collect` reads the full
 *  part list and decodes the tool calls; `subscribe`, when given, streams parts live for online
 *  detection. The caller supplies how to get parts (e.g. `box.session(id).messages()` flat-mapped to
 *  parts) — keeping this module free of any substrate SDK. */
export function createPartsTraceSource(opts: {
  collectParts: () => Promise<ReadonlyArray<unknown>>
  subscribeParts?: (onPart: (part: unknown) => void) => () => void
  runId?: string
  now?: () => number
}): TraceSource {
  const runId = opts.runId ?? `parts-${runSeq++}`
  const now = opts.now ?? Date.now
  const subs = new Set<(span: ToolSpan) => void>()
  let liveSeq = 0
  let unsub: (() => void) | undefined
  const startLive = () => {
    if (unsub || !opts.subscribeParts) return
    unsub = opts.subscribeParts((part) => {
      const step = decodeToolPart(part)
      if (!step) return
      const span = toToolSpan(step, runId, liveSeq++, now())
      for (const fn of subs) fn(span)
    })
  }
  return {
    onSpan(handler) {
      subs.add(handler)
      startLive()
      return () => {
        subs.delete(handler)
        if (subs.size === 0 && unsub) {
          unsub()
          unsub = undefined
        }
      }
    },
    async collect() {
      const parts = await opts.collectParts()
      const spans: ToolSpan[] = []
      for (const part of parts) {
        const step = decodeToolPart(part)
        if (step) spans.push(toToolSpan(step, runId, spans.length, now()))
      }
      return spans
    },
  }
}

/** A harness session message carrying parts (the shape `box.messages()` returns). Structurally typed
 *  so this works with the real `@tangle-network/sandbox` box AND a test double, no SDK import. */
export interface SessionMessageLike {
  readonly parts?: ReadonlyArray<unknown>
}

/** The minimal box surface this needs: list a session's messages (incl. mid-turn partials). */
export interface SessionTraceBox {
  messages(opts: { sessionId: string }): Promise<ReadonlyArray<SessionMessageLike>>
}

/** The SANDBOX / fleet trace source: read a box session's message parts and decode the harness's tool
 *  calls into spans. `collect` (settle) is the solid path — `box.messages({sessionId})` → parts → spans;
 *  black-box harnesses aren't mid-step interruptible, so online steering is the owned-loop's job and a
 *  live `subscribe` is opt-in (pass `subscribeParts` from `streamPrompt` when the harness streams parts). */
export function sandboxSessionTraceSource(
  box: SessionTraceBox,
  sessionId: string,
  opts: {
    subscribeParts?: (onPart: (part: unknown) => void) => () => void
    runId?: string
    now?: () => number
  } = {},
): TraceSource {
  return createPartsTraceSource({
    collectParts: async () => {
      const msgs = await box.messages({ sessionId })
      return msgs.flatMap((m) => (m.parts ? [...m.parts] : []))
    },
    ...(opts.subscribeParts ? { subscribeParts: opts.subscribeParts } : {}),
    runId: opts.runId ?? `box-${sessionId}`,
    ...(opts.now ? { now: opts.now } : {}),
  })
}
