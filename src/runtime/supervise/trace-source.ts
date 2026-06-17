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
  /** Stable id of the tool call — used to de-duplicate the repeated state transitions a harness
   *  streams for one call (opencode emits pending→running→completed, plus a `raw`-wrapped copy). */
  readonly callId?: string
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

/** Decode one harness message part into a tool step, or `undefined` if it is not a (completed) tool
 *  call. ONE adapter per harness family — each owns its real wire shape; the flow downstream is
 *  identical. Add a harness = add a decoder + register it; no other code changes. */
export type ToolPartDecoder = (part: Record<string, unknown>) => ToolStepInput | undefined

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** opencode (VALIDATED LIVE): `{ type:'tool', tool:'<name>', callID, state:{ status, input } }`.
 *  The same call streams pending→running→completed/error — only the terminal state decodes. */
export const decodeOpencodePart: ToolPartDecoder = (p) => {
  if (str(p.type)?.toLowerCase() !== 'tool' || !str(p.tool)) return undefined
  const state = obj(p.state)
  const status = str(state?.status) ?? ''
  if (status === 'pending' || status === 'running') return undefined
  return {
    toolName: p.tool as string,
    args: state?.input ?? {},
    ...(status === 'error'
      ? { status: 'error' as const }
      : status
        ? { status: 'ok' as const }
        : {}),
    ...(str(p.callID) ? { callId: p.callID as string } : {}),
  }
}

/** Anthropic / claude-code: a `{ type:'tool_use', id, name, input }` content block. From the public
 *  Anthropic format — NOT yet live-validated (the claude-code harness crashed `exit 1` with the test
 *  model, so a real box produced no tool calls to confirm against; owed the same proof opencode got). */
export const decodeAnthropicPart: ToolPartDecoder = (p) => {
  if (str(p.type)?.toLowerCase() !== 'tool_use' || !str(p.name)) return undefined
  return {
    toolName: p.name as string,
    args: p.input ?? {},
    ...(str(p.id) ? { callId: p.id as string } : {}),
  }
}

/** OpenAI-compatible (codex / router / kimi / glm): `{ type:'function'|'tool_call', id,
 *  function:{ name, arguments:<JSON string> } }`. From the public OpenAI format — NOT yet live-
 *  validated on a box (the codex harness crashed `exit 1` with the test model); router/owned-loop
 *  tool dispatch produces this shape directly, so the owned-loop path IS exercised. */
export const decodeOpenAiPart: ToolPartDecoder = (p) => {
  const type = str(p.type)?.toLowerCase()
  const fn = obj(p.function)
  // Match on the type OpenAI always sets — not the mere presence of a `.function` field (a
  // `{type:'text', function:{…}}` part must not decode). Name is required below.
  if (type !== 'function' && type !== 'tool_call') return undefined
  const name = str(fn?.name) ?? str(p.name)
  if (!name) return undefined
  const rawArgs = fn?.arguments ?? p.arguments
  return {
    toolName: name,
    args: typeof rawArgs === 'string' ? safeParse(rawArgs) : (rawArgs ?? {}),
    ...(str(p.id) ? { callId: p.id as string } : str(fn?.id) ? { callId: fn?.id as string } : {}),
  }
}

/** The harness → decoder registry. Add a harness by adding one entry. */
export const toolPartDecoders: Record<string, ToolPartDecoder> = {
  opencode: decodeOpencodePart,
  'claude-code': decodeAnthropicPart,
  anthropic: decodeAnthropicPart,
  codex: decodeOpenAiPart,
  openai: decodeOpenAiPart,
  router: decodeOpenAiPart,
  kimi: decodeOpenAiPart,
}

/** Decode a part with a specific harness's adapter when known, else try every registered adapter
 *  (the composite — robust to mixed/unknown streams). Never throws. */
export function decodeToolPart(part: unknown, harness?: string): ToolStepInput | undefined {
  const p = obj(part)
  if (!p) return undefined
  const specific = harness ? toolPartDecoders[harness] : undefined
  if (specific) return specific(p)
  for (const decode of new Set(Object.values(toolPartDecoders))) {
    const step = decode(p)
    if (step) return step
  }
  return undefined
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
      for (const fn of subs) {
        try {
          fn(span)
        } catch {
          // a throwing subscriber (e.g. a detector onSignal) must never break the producer loop
        }
      }
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
  /** The harness whose decoder to use (e.g. 'opencode'); omit to try every registered adapter. */
  harness?: string
  runId?: string
  now?: () => number
}): TraceSource {
  const runId = opts.runId ?? `parts-${runSeq++}`
  const now = opts.now ?? Date.now
  const subs = new Set<(span: ToolSpan) => void>()
  // De-dup the repeated transitions a harness streams for one call (pending/running/completed + a
  // `raw`-wrapped copy all decode to the same terminal step) — one span per callId.
  const seenLive = new Set<string>()
  let liveSeq = 0
  let unsub: (() => void) | undefined
  const startLive = () => {
    if (unsub || !opts.subscribeParts) return
    unsub = opts.subscribeParts((part) => {
      const step = decodeToolPart(part, opts.harness)
      if (!step) return
      if (step.callId) {
        if (seenLive.has(step.callId)) return
        seenLive.add(step.callId)
      }
      const span = toToolSpan(step, runId, liveSeq++, now())
      for (const fn of subs) {
        try {
          fn(span)
        } catch {
          // a throwing subscriber (e.g. a detector onSignal) must never break the producer loop
        }
      }
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
      const seen = new Set<string>()
      for (const part of parts) {
        const step = decodeToolPart(part, opts.harness)
        if (!step) continue
        if (step.callId) {
          if (seen.has(step.callId)) continue
          seen.add(step.callId)
        }
        spans.push(toToolSpan(step, runId, spans.length, now()))
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
    /** The box's harness (e.g. 'opencode', 'claude-code') → selects its decoder adapter. */
    harness?: string
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
    ...(opts.harness ? { harness: opts.harness } : {}),
    ...(opts.subscribeParts ? { subscribeParts: opts.subscribeParts } : {}),
    runId: opts.runId ?? `box-${sessionId}`,
    ...(opts.now ? { now: opts.now } : {}),
  })
}
