/**
 * @experimental
 *
 * `createSandboxPlanner` — wire the dynamic driver's `TopologyPlanner` to a
 * real agent. Each round it spins a sandbox on `profile`, streams a prompt that
 * carries the history summary, and decodes the agent's chosen `TopologyMove`
 * from a JSON envelope it emits. This is the "agent authors its own loop
 * topology" path: the planner profile can be any harness (claude-code, codex,
 * opencode, pi) — its only job is to read what happened and emit the next move.
 *
 * The planner profile is deliberately distinct from the worker `agentRuns`: a
 * cheap fast model can steer topology while expensive workers do the labor, and
 * the planner never names which harness runs a branch — the kernel's
 * `agentRuns` round-robin decides that.
 *
 * Three execution modes, all the same code path:
 *   - LLM call        — a cheap-model `profile`; one prompt → one move.
 *   - different sandbox (default) — a fresh planner-owned box per round.
 *   - same sandbox     — pass `reuseBox` to stream the move into the worker's
 *                        own box (a session against its live filesystem/state),
 *                        so the driver steers from what the worker actually did.
 *
 * Envelope contract the agent must emit (fenced ```json or a structured
 * `result`/`final` event payload):
 *   { "kind": "refine" | "fanout" | "stop",
 *     "tasks"?: [ <task>, ... ],   // decoded via `decodeTask`
 *     "n"?: number,                // fanout shorthand: N copies of the root task
 *     "rationale"?: string }
 *
 * A missing / unparseable / unknown-kind envelope throws `PlannerError` — the
 * loop never silently runs a topology the agent did not choose.
 */

import type { AgentProfile, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { PlannerError, ValidationError } from '../../errors'
import { buildBackendOptions } from '../sandbox-backend'
import type { AgentRunSpec, LoopSandboxClient } from '../types'
import { deleteBoxSafe, stringifySafe } from '../util'
import type { PlannerContext, TopologyMove, TopologyPlanner } from './dynamic'
import { renderAnalyses, summarizeHistory } from './dynamic'

/** Raw, pre-decode envelope an agent emits to choose the next move. */
export interface TopologyMoveEnvelope {
  kind: string
  tasks?: unknown[]
  n?: number
  rationale?: string
}

/** @experimental */
export interface CreateSandboxPlannerOptions<Task, Output> {
  /** Sandbox client — the planner calls `.create()` once per round. */
  client: LoopSandboxClient
  /** The planner agent. Steers topology; does not run the work. */
  profile: AgentProfile
  /**
   * Decode one raw task from the envelope's `tasks[]` into a domain `Task`.
   * Required because `Task` is opaque to this module — only the caller knows
   * its shape. Throw to reject a malformed task; the error surfaces as a
   * `PlannerError`.
   */
  decodeTask: (raw: unknown, ctx: PlannerContext<Task, Output>) => Task
  /** Override the default prompt (history summary + envelope contract). */
  buildPrompt?: (ctx: PlannerContext<Task, Output>) => string | Promise<string>
  /** Override envelope extraction from the event stream. */
  parseEnvelope?: (events: SandboxEvent[]) => TopologyMoveEnvelope | undefined
  /** Sandbox overrides for the planner sandbox (timeouts, env, etc.). */
  sandboxOverrides?: AgentRunSpec<Task>['sandboxOverrides']
  /** Cancellation for the planner's own LLM call. */
  signal?: AbortSignal
  /**
   * Same-sandbox mode. Return an existing box and the planner streams its move
   * INTO that box (a session against the worker's environment) instead of
   * spinning its own — so the driver can inspect the worker's real filesystem
   * and state, not just the history summary. The returned box's lifecycle is
   * the CALLER's: the planner neither creates nor deletes it. Return
   * `undefined` to fall back to the default (a fresh, planner-owned box =
   * different-sandbox mode). Omit entirely for the default.
   */
  reuseBox?: () => SandboxInstance | undefined | Promise<SandboxInstance | undefined>
}

/** @experimental */
export function createSandboxPlanner<Task, Output>(
  opts: CreateSandboxPlannerOptions<Task, Output>,
): TopologyPlanner<Task, Output> {
  if (!opts.client || typeof opts.client.create !== 'function') {
    throw new ValidationError('createSandboxPlanner: client.create is required')
  }
  if (typeof opts.decodeTask !== 'function') {
    throw new ValidationError('createSandboxPlanner: decodeTask is required')
  }
  const buildPrompt = opts.buildPrompt ?? defaultBuildPrompt
  const parseEnvelope = opts.parseEnvelope ?? defaultParseEnvelope

  return async (ctx) => {
    // Same-sandbox mode: reuse the caller-owned box; else spin a planner-owned one.
    const reused = opts.reuseBox ? await opts.reuseBox() : undefined
    if (reused !== undefined) assertReusableBox(reused)
    const box =
      reused ?? (await opts.client.create(buildBackendOptions(opts.profile, opts.sandboxOverrides)))
    const plannerOwnsBox = reused === undefined
    try {
      const prompt = await buildPrompt(ctx)
      const events: SandboxEvent[] = []
      for await (const event of box.streamPrompt(prompt, { signal: opts.signal })) {
        events.push(event)
      }
      const envelope = parseEnvelope(events)
      if (!envelope) {
        throw new PlannerError('sandbox planner emitted no parseable topology-move envelope')
      }
      return envelopeToMove(envelope, ctx, opts.decodeTask)
    } finally {
      // Tear down only a box WE created (one per plan() round, so it doesn't
      // leak). A reused (same-sandbox) box belongs to the caller — never delete it.
      if (plannerOwnsBox) await deleteBoxSafe(box)
    }
  }
}

function envelopeToMove<Task, Output>(
  envelope: TopologyMoveEnvelope,
  ctx: PlannerContext<Task, Output>,
  decodeTask: (raw: unknown, ctx: PlannerContext<Task, Output>) => Task,
): TopologyMove<Task> {
  const kind = String(envelope.kind ?? '').toLowerCase()
  const rationale = typeof envelope.rationale === 'string' ? envelope.rationale : undefined
  if (kind === 'stop') {
    return { kind: 'stop', rationale }
  }
  if (kind === 'refine') {
    const raw = Array.isArray(envelope.tasks) ? envelope.tasks[0] : undefined
    // No new task → replay the root task; the worker self-corrects from its
    // own prior attempt in sandbox state, mirroring the refine driver default.
    const task = raw === undefined ? ctx.task : decodeTaskGuarded(decodeTask, raw, ctx)
    return { kind: 'refine', task, rationale }
  }
  if (kind === 'fanout') {
    const tasks = resolveFanoutTasks(envelope, ctx, decodeTask)
    return { kind: 'fanout', tasks, rationale }
  }
  throw new PlannerError(
    `sandbox planner emitted unknown move kind: ${JSON.stringify(envelope.kind)}`,
  )
}

// Hard ceiling on materialized fanout branches BEFORE the dynamic driver's
// maxFanout clamp runs — an LLM emitting `n: 1e6` (or a million-element tasks[])
// must not allocate the array first and OOM. The driver clamps the survivors to
// its own (lower) maxFanout afterward; this only caps the allocation.
const HARD_FANOUT_CEILING = 64

function resolveFanoutTasks<Task, Output>(
  envelope: TopologyMoveEnvelope,
  ctx: PlannerContext<Task, Output>,
  decodeTask: (raw: unknown, ctx: PlannerContext<Task, Output>) => Task,
): Task[] {
  if (Array.isArray(envelope.tasks) && envelope.tasks.length > 0) {
    return envelope.tasks
      .slice(0, HARD_FANOUT_CEILING)
      .map((raw) => decodeTaskGuarded(decodeTask, raw, ctx))
  }
  // `n` shorthand: N copies of the root task, leaning on `agentRuns` diversity.
  if (typeof envelope.n === 'number' && Number.isFinite(envelope.n) && envelope.n >= 1) {
    const count = Math.min(Math.floor(envelope.n), HARD_FANOUT_CEILING)
    return Array.from({ length: count }, () => ctx.task)
  }
  throw new PlannerError('sandbox planner fanout envelope needs a non-empty tasks[] or n >= 1')
}

function decodeTaskGuarded<Task, Output>(
  decodeTask: (raw: unknown, ctx: PlannerContext<Task, Output>) => Task,
  raw: unknown,
  ctx: PlannerContext<Task, Output>,
): Task {
  try {
    return decodeTask(raw, ctx)
  } catch (err) {
    throw new PlannerError(`sandbox planner decodeTask rejected ${JSON.stringify(raw)}`, {
      cause: err,
    })
  }
}

const TERMINAL_BOX_STATUS = new Set(['failed', 'expired', 'stopped'])

/**
 * Same-sandbox guard: a `reuseBox` is only valid when the kernel's `onWorkerBox`
 * kept it alive. Reject a box the kernel already tore down (terminal status)
 * with a typed error instead of streaming into a dead sandbox, where the failure
 * would surface as a confusing "no parseable envelope".
 */
function assertReusableBox(box: SandboxInstance): void {
  const status = (box as { status?: unknown }).status
  if (typeof status === 'string' && TERMINAL_BOX_STATUS.has(status)) {
    throw new PlannerError(`sandbox planner reuseBox returned a non-live box (status: ${status})`)
  }
}

function defaultBuildPrompt<Task, Output>(ctx: PlannerContext<Task, Output>): string {
  const summary = summarizeHistory(ctx.history)
  return [
    'You are the loop planner. You do not do the work — you decide the topology of the next round.',
    '',
    `Root task:\n${stringifySafe(ctx.task, { pretty: true })}`,
    '',
    `Iterations spent: ${ctx.iterationsSpent}. Remaining before the hard cap: ${ctx.iterationsRemaining}.`,
    '',
    ctx.history.length === 0
      ? 'No attempts yet.'
      : `Attempts so far (index, agent, verdict, output):\n${stringifySafe(summary, { pretty: true })}`,
    '',
    // The analyses wire: when an analyze hook is fed in, the planner sees the
    // trace diagnosis here and steers from it, not the verdict score alone.
    ...(ctx.analyses && ctx.analyses.length > 0 ? [renderAnalyses(ctx.analyses), ''] : []),
    'Choose ONE move and emit it as a fenced JSON block:',
    '  - {"kind":"refine","tasks":[<task>],"rationale":"..."} — one more attempt; omit tasks to replay the root task.',
    '  - {"kind":"fanout","tasks":[<task>,<task>],"rationale":"..."} — N parallel branches (or "n": N for N copies of the root task).',
    '  - {"kind":"stop","rationale":"..."} — a valid result exists or further attempts will not help.',
    '',
    'Stop as soon as an attempt is valid. Prefer refine when an attempt is close; fan out when attempts disagree or the approach is uncertain.',
    'Emit ONLY the JSON block.',
  ].join('\n')
}

const TERMINAL_EVENT_TYPES = new Set(['result', 'final', 'planner.move', 'done'])

/**
 * Harness-agnostic move extraction. The move arrives one of two ways and we must
 * not assume which harness/SDK-version we're on (opencode emits `data.finalText`,
 * others `data.result`/`data.text`/…) — so we cover all text-bearing fields and
 * prefer (1) a STRUCTURED payload, then (2) a fenced move in a TERMINAL event's
 * final text, then (3) the latest schema-valid fenced/bare envelope anywhere.
 * Reverse iteration is load-bearing: the agent's real move is the LAST envelope
 * emitted; the JSON *examples* echoed from the prompt appear earlier, so latest-
 * first never mistakes an example for the answer.
 *
 * The reliable long-term path is a structured-output tool the planner CALLS (no
 * prose scraping at all); this text extractor is the resilient fallback for
 * harnesses without one.
 */
function defaultParseEnvelope(events: SandboxEvent[]): TopologyMoveEnvelope | undefined {
  const moveText = (data: Record<string, unknown>): string | undefined =>
    pickString(data.finalText) ??
    pickString(data.text) ??
    pickString(data.delta) ??
    pickString(data.content) ??
    pickString(data.message)

  // 1) Terminal events, latest first: structured payload, else a fenced move in the final text.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    const data = isRecord(event.data) ? event.data : undefined
    if (!data) continue
    if (!TERMINAL_EVENT_TYPES.has(String(event.type ?? ''))) continue
    const structured = coerceEnvelope(data.result ?? data.output ?? data.move ?? data)
    if (structured) return structured
    const fromText = coerceLatestFenced(moveText(data) ?? '')
    if (fromText) return fromText
  }
  // 2) Any text-bearing event, latest first: the last schema-valid fenced/bare envelope.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    const data = isRecord(event.data) ? event.data : undefined
    if (!data) continue
    const text = moveText(data)
    if (!text) continue
    const coerced = coerceLatestFenced(text)
    if (coerced) return coerced
  }
  return undefined
}

function coerceEnvelope(value: unknown): TopologyMoveEnvelope | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.kind !== 'string' || value.kind.length === 0) return undefined
  const out: TopologyMoveEnvelope = { kind: value.kind }
  if (Array.isArray(value.tasks)) out.tasks = value.tasks
  if (typeof value.n === 'number') out.n = value.n
  if (typeof value.rationale === 'string') out.rationale = value.rationale
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Pick the LAST schema-valid envelope from `text`. A harness that echoes the
 * prompt's example fences and then appends its real answer in one message puts
 * the chosen move LAST — so when multiple fenced blocks exist we take the last
 * that coerces, never the first (which would silently run an example move). The
 * bare body (no fence) is the fallback.
 */
function coerceLatestFenced(text: string): TopologyMoveEnvelope | undefined {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  let latest: TopologyMoveEnvelope | undefined
  for (const fence of fences) {
    const coerced = coerceEnvelope(parseJsonSafe(fence[1]))
    if (coerced) latest = coerced
  }
  if (latest) return latest
  return coerceEnvelope(parseJsonSafe(text))
}

function parseJsonSafe(text: string | undefined): unknown | undefined {
  const body = (text ?? '').trim()
  if (!body) return undefined
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}
