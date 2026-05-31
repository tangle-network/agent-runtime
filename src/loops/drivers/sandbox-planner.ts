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

import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
} from '@tangle-network/sandbox'
import { PlannerError, ValidationError } from '../../errors'
import type { AgentRunSpec, LoopSandboxClient } from '../types'
import type { PlannerContext, TopologyMove, TopologyPlanner } from './dynamic'
import { summarizeHistory } from './dynamic'

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
  buildPrompt?: (ctx: PlannerContext<Task, Output>) => string
  /** Override envelope extraction from the event stream. */
  parseEnvelope?: (events: SandboxEvent[]) => TopologyMoveEnvelope | undefined
  /** Sandbox overrides for the planner sandbox (timeouts, env, etc.). */
  sandboxOverrides?: AgentRunSpec<Task>['sandboxOverrides']
  /** Cancellation for the planner's own LLM call. */
  signal?: AbortSignal
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
    const box = await opts.client.create(buildSandboxOptions(opts.profile, opts.sandboxOverrides))
    const events: SandboxEvent[] = []
    for await (const event of box.streamPrompt(buildPrompt(ctx), { signal: opts.signal })) {
      events.push(event)
    }
    const envelope = parseEnvelope(events)
    if (!envelope) {
      throw new PlannerError('sandbox planner emitted no parseable topology-move envelope')
    }
    return envelopeToMove(envelope, ctx, opts.decodeTask)
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
  throw new PlannerError(`sandbox planner emitted unknown move kind: ${JSON.stringify(envelope.kind)}`)
}

function resolveFanoutTasks<Task, Output>(
  envelope: TopologyMoveEnvelope,
  ctx: PlannerContext<Task, Output>,
  decodeTask: (raw: unknown, ctx: PlannerContext<Task, Output>) => Task,
): Task[] {
  if (Array.isArray(envelope.tasks) && envelope.tasks.length > 0) {
    return envelope.tasks.map((raw) => decodeTaskGuarded(decodeTask, raw, ctx))
  }
  // `n` shorthand: N copies of the root task, leaning on `agentRuns` diversity.
  if (typeof envelope.n === 'number' && Number.isFinite(envelope.n) && envelope.n >= 1) {
    return Array.from({ length: Math.floor(envelope.n) }, () => ctx.task)
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

function buildSandboxOptions(
  profile: AgentProfile,
  overrides: AgentRunSpec<unknown>['sandboxOverrides'],
): CreateSandboxOptions {
  const base = overrides ?? {}
  const overrideBackend = base.backend
  const explicitType = profile.metadata?.backendType
  type BackendType = NonNullable<CreateSandboxOptions['backend']>['type']
  return {
    ...base,
    backend: {
      type: (overrideBackend?.type ?? explicitType ?? 'opencode') as BackendType,
      profile,
      ...(overrideBackend?.model ? { model: overrideBackend.model } : {}),
      ...(overrideBackend?.server ? { server: overrideBackend.server } : {}),
    },
  }
}

function defaultBuildPrompt<Task, Output>(ctx: PlannerContext<Task, Output>): string {
  const summary = summarizeHistory(ctx.history)
  return [
    'You are the loop planner. You do not do the work — you decide the topology of the next round.',
    '',
    `Root task:\n${safeJson(ctx.task)}`,
    '',
    `Iterations spent: ${ctx.iterationsSpent}. Remaining before the hard cap: ${ctx.iterationsRemaining}.`,
    '',
    ctx.history.length === 0
      ? 'No attempts yet.'
      : `Attempts so far (index, agent, verdict, output):\n${safeJson(summary)}`,
    '',
    'Choose ONE move and emit it as a fenced JSON block:',
    '  - {"kind":"refine","tasks":[<task>],"rationale":"..."} — one more attempt; omit tasks to replay the root task.',
    '  - {"kind":"fanout","tasks":[<task>,<task>],"rationale":"..."} — N parallel branches (or "n": N for N copies of the root task).',
    '  - {"kind":"stop","rationale":"..."} — a valid result exists or further attempts will not help.',
    '',
    'Stop as soon as an attempt is valid. Prefer refine when an attempt is close; fan out when attempts disagree or the approach is uncertain.',
    'Emit ONLY the JSON block.',
  ].join('\n')
}

function defaultParseEnvelope(events: SandboxEvent[]): TopologyMoveEnvelope | undefined {
  // Structured payload on a terminal event wins — sandbox SDKs lift emitted
  // JSON onto data.result / data.output / data of a result|final event.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    const type = String(event.type ?? '')
    const data = isRecord(event.data) ? event.data : undefined
    if (!data) continue
    if (type === 'result' || type === 'final' || type === 'planner.move') {
      const direct = coerceEnvelope(data.result ?? data.output ?? data)
      if (direct) return direct
    }
  }
  // Fall back to a fenced JSON block in the most recent text delta.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    const data = isRecord(event.data) ? event.data : undefined
    if (!data) continue
    const text = pickString(data.text) ?? pickString(data.delta) ?? pickString(data.content)
    if (!text) continue
    const fenced = extractFencedJson(text)
    const coerced = coerceEnvelope(fenced)
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

function extractFencedJson(text: string): unknown | undefined {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (match?.[1] ?? text).trim()
  if (!body) return undefined
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
