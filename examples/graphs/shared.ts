/**
 * Shared OFFLINE seams for the graph examples — the same two seams the kernel's own graph tests
 * use (`tests/kernel/graph.test.ts`):
 *
 *   • `scriptedBrain` — a `ToolLoopChat` that plays a fixed sequence of driver turns, so the
 *     driver's tool calls (spawn / steer) and its waits are deterministic and cost $0.
 *   • `leafSeam` — a `MakeWorkerAgent` whose leaf executors settle instantly with configurable
 *     per-shot outputs and verdicts, optionally block until a steer arrives (`awaitSteer`), and
 *     optionally expose a live tool trace (`withTrace` / `storm`) for analysts and detectors.
 *
 * Only the leaf `act` and the driver brain are scripted. The graph machinery AROUND them — node
 * pinning, directive delivery, the edge ledger, the journal twin — is the real shipped path
 * (`runGraph` → `supervise()`), which is what makes every example an offline proof, not a mock
 * of the system.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type Agent,
  type AgentSpec,
  createPushTraceSource,
  type Executor,
  type ExecutorResult,
  type GraphNode,
  type GraphResult,
  type MakeWorkerAgent,
  type RouterTransportConfig,
  type TraceSource,
  type WorkerSpawnContext,
} from '@tangle-network/agent-runtime/kernel'
import type { ToolLoopChat } from '../../src/testing'

/** Exact profile identity for the examples' injected, deterministic executors. */
export function offlineProfile(name: string, systemPrompt: string): AgentProfile {
  return {
    name,
    harness: 'cli-base',
    model: { provider: 'offline', default: `offline/${name}` },
    prompt: { systemPrompt },
  }
}

// ── The scripted driver brain ──────────────────────────────────────────────────

/** A scripted driver turn in the easy-to-write form (parsed tool args). */
export interface ScriptedTurn {
  content?: string
  toolCalls?: Array<{ id?: string; name: string; arguments: Record<string, unknown> }>
  /** A turn with no tool call ends the driver's turn, and Runtime wakes it with what happened.
   *  With `until`, the turn repeats on every wake until the condition holds (the events the next
   *  scripted decision depends on), so a script cannot move on early when those events arrive in
   *  different wakes. End a script with a turn that has no `until`. */
  until?: (messages: ReadonlyArray<Record<string, unknown>>) => boolean
}

/** A `ScriptedTurn.until` condition: the conversation holds at least `count` occurrences of
 *  `text`. A wake lists each event as one JSON line, so `text` names the event. */
export function seen(
  text: string,
  count = 1,
): (messages: ReadonlyArray<Record<string, unknown>>) => boolean {
  return (messages) =>
    messages.reduce(
      (found, message) =>
        found + (typeof message.content === 'string' ? message.content.split(text).length - 1 : 0),
      0,
    ) >= count
}

/** Build a scripted `ToolLoopChat` brain from a fixed turn sequence: converts parsed tool args to
 *  the raw-string form the canonical tool loop parses and advances through the turns (repeating
 *  the last). */
export function scriptedBrain(turns: ScriptedTurn[]): ToolLoopChat {
  let i = 0
  return async (messages) => {
    // A waiting turn whose events have arrived is over: the next scripted turn answers them.
    while (turns[i]?.until?.(messages) === true) i += 1
    const turn = turns[Math.min(i, turns.length - 1)] ?? {}
    if (turn.until === undefined) i += 1
    return {
      ...(turn.content !== undefined ? { content: turn.content } : {}),
      toolCalls: (turn.toolCalls ?? []).map((tc, j) => ({
        id: tc.id ?? `call-${i}-${j}`,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
    }
  }
}

// ── The leaf seam ──────────────────────────────────────────────────────────────

/** What one settle of a node should produce (per spawn ordinal; the last entry repeats). */
export interface LeafShot {
  /** The settle output. */
  out?: unknown
  /** For an analyst node: build the settle output from the source worker's output exactly as this
   *  spawn's task carried it (`sourceOutputOf`), so the finding reports what the analyst read. */
  fromSource?: (source: unknown) => unknown
  valid: boolean
  score?: number
  /** Awaited just before this settle, so an example can hold one worker open until another
   *  event has happened (a rendezvous, or a downstream spawn). */
  after?: () => Promise<void>
}

const SOURCE_EXCERPT = 'Bounded source excerpt (omitted evidence is not inspected): '

/** The settled worker's output as an analyst agent's task carries it: Runtime hands every analyst
 *  run the source envelope (`{ worker, output }`) as a bounded excerpt. Throws when the task has no
 *  excerpt or the excerpt was cut, so an analyst can never report on output it did not see. */
export function sourceOutputOf(task: unknown): unknown {
  const part =
    typeof task === 'string'
      ? task.split('\n\n').find((p) => p.startsWith(SOURCE_EXCERPT))
      : undefined
  if (part === undefined) throw new Error('not an analyst task: it carries no source excerpt')
  const excerpt = JSON.parse(part.slice(SOURCE_EXCERPT.length)) as {
    text: string
    omittedChars: number
  }
  if (excerpt.omittedChars > 0) {
    throw new Error(`the source excerpt omits ${excerpt.omittedChars} characters`)
  }
  return (JSON.parse(excerpt.text) as { output?: unknown }).output
}

export interface LeafOptions {
  /** Block settlement until a deliver() arrives — so a steer can reach a LIVE worker. */
  awaitSteer?: boolean
  /** Expose a live tool-trace source, so settle-time analysts and online detectors have
   *  evidence to read. */
  withTrace?: boolean
  /** Record this many IDENTICAL failing tool calls into the live trace at execute start — the
   *  stuck-loop storm the online detector panel fires on. Implies nothing without `withTrace`. */
  storm?: number
  /** Per-spawn scripts for this node: spawn k settles with `shots[k]` (last entry repeats).
   *  Omit for a generic valid settle. */
  shots?: ReadonlyArray<LeafShot>
}

export interface LeafSeamHooks {
  /** Called with each spawned node's live trace source (when `withTrace`), so an example can
   *  wire `watchTrace` over it — the online-watchdog seam. */
  onTraceSource?: (nodeId: string, source: TraceSource) => void
  /** Called with each spawn's `WorkerSpawnContext` — the kernel-authored facts the executor seam
   *  receives (continuity mode, `resume` lineage, the analyst marker), so an example can PROVE
   *  what actually crossed the seam. */
  onSpawnContext?: (nodeId: string, context: WorkerSpawnContext | undefined) => void
}

/** A leaf-agent factory keyed by node name. Every spawned profile (what the graph pinned + the
 *  edge directive) is captured into `received` for inspection. */
export function leafSeam(
  received: AgentProfile[],
  optsByNode: Record<string, LeafOptions> = {},
  hooks: LeafSeamHooks = {},
): MakeWorkerAgent {
  const attempts = new Map<string, number>()
  return (profile, context) => {
    received.push(profile)
    hooks.onSpawnContext?.(profile.name ?? 'leaf', context)
    const name = profile.name ?? 'leaf'
    const opts = optsByNode[name] ?? {}
    const attempt = (attempts.get(name) ?? 0) + 1
    attempts.set(name, attempt)
    const shot = opts.shots?.[Math.min(attempt - 1, opts.shots.length - 1)]
    let release: (() => void) | undefined
    const gate = opts.awaitSteer
      ? new Promise<void>((resolve) => {
          release = resolve
        })
      : undefined
    const trace = opts.withTrace
      ? createPushTraceSource({ runId: `leaf-${name}-${attempt}` })
      : undefined
    if (trace) hooks.onTraceSource?.(name, trace.source)
    let artifact: ExecutorResult<unknown> | undefined
    const ex: Executor<unknown> = {
      runtime: 'router',
      ...(opts.awaitSteer
        ? {
            deliver: () => {
              release?.()
              return true
            },
          }
        : {}),
      ...(trace ? { traceSource: () => trace.source } : {}),
      async execute() {
        if (trace) {
          trace.record({ toolName: 'write_file', args: { path: `${name}.ts` }, status: 'ok' })
          for (let i = 0; i < (opts.storm ?? 0); i += 1) {
            trace.record({
              toolName: 'bash',
              args: { cmd: 'pnpm test' },
              status: 'error',
              error: '1 failing',
            })
          }
        }
        if (gate) await gate
        if (shot?.after) await shot.after()
        const valid = shot ? shot.valid : true
        artifact = {
          outRef: `w:${name}:${attempt}`,
          out: shot?.fromSource
            ? shot.fromSource(sourceOutputOf(context?.task))
            : shot
              ? shot.out
              : { built: name, attempt },
          verdict: { valid, score: shot?.score ?? (valid ? 1 : 0) },
          spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
        }
        return artifact
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: () => {
        if (!artifact) throw new Error(`leaf ${name}: no terminal artifact`)
        return artifact
      },
    }
    const spec: AgentSpec = { profile, harness: null, executor: ex }
    return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
}

// ── The proof artifact ─────────────────────────────────────────────────────────

/** Print the EDGE LEDGER — every traversal, in occurrence order. This is each example's proof:
 *  who spawned whom, what crossed each edge, and what actually got delivered. */
export function printLedger(tag: string, res: GraphResult): void {
  console.log(`\n${tag} — result: ${res.result.kind} (runId: ${res.runId})`)
  if (res.result.kind === 'winner') console.log(`winner out: ${JSON.stringify(res.result.out)}`)
  console.log('EDGE LEDGER:')
  for (const row of res.ledger) {
    const worker = row.workerId !== undefined ? ` -> ${row.workerId}` : ''
    const reason = row.reason !== undefined ? `  (${row.reason})` : ''
    console.log(
      `  #${row.traversal} ${row.edge} [${row.outcome}|${row.continuity}] ${row.bytes}B${worker}${reason}`,
    )
  }
  if (res.exhaustedEdges.length > 0) {
    console.log(`exhausted edges: ${res.exhaustedEdges.join(', ')}`)
  }
}

// ── Graph literals, shortened ──────────────────────────────────────────────────

/** The root's spawn grant — the one tool a node needs to be a driver (or a nested supervisor). */
export const SPAWN_TOOL = 'agent_runtime_coordination_spawn_worker'

/** The grants a root needs to DELIVER its own decision: `observe_agent` reads a settled worker's
 *  output, and `submit_result` hands the result to the graph's deliverable check, which makes it
 *  the run's `result.out`. Without them the run's output is whatever the default finalizer picks
 *  (the first highest-scoring delivered worker), whatever the root decided. */
export const DECIDING_ROOT_TOOLS: Readonly<Record<string, boolean>> = {
  agent_runtime_coordination_observe_agent: true,
  agent_runtime_coordination_submit_result: true,
}

/** A root node: an offline profile that may spawn the graph's workers (plus any extra grants). */
export function driverNode(
  id: string,
  systemPrompt: string,
  extraTools: Record<string, boolean> = {},
): GraphNode {
  return {
    id,
    profile: { ...offlineProfile(id, systemPrompt), tools: { [SPAWN_TOOL]: true, ...extraTools } },
  }
}

/** A worker or analyst node. `provider` names the model family, so a panel of nodes can differ in
 *  the one axis a panel exists for (`anthropic`, `openai`, `google`); it defaults to `offline`. */
export function workerNode(id: string, systemPrompt: string, provider = 'offline'): GraphNode {
  return {
    id,
    profile: {
      ...offlineProfile(id, systemPrompt),
      model: { provider, default: `${provider}/${id}` },
    },
  }
}

// ── Reading what woke the driver ───────────────────────────────────────────────

/** One event a wake listed (`- {json}` lines): a `settled` worker or an analyst `finding`. */
export type WakeEvent = Record<string, unknown> & { type?: string }

/** Every event the driver has been woken with so far, in arrival order. */
export function wakeEvents(messages: ReadonlyArray<Record<string, unknown>>): WakeEvent[] {
  const events: WakeEvent[] = []
  for (const message of messages) {
    if (typeof message.content !== 'string') continue
    for (const line of message.content.split('\n')) {
      if (!line.startsWith('- {')) continue
      try {
        events.push(JSON.parse(line.slice(2)) as WakeEvent)
      } catch {
        // a line that is not an event is simply not one
      }
    }
  }
  return events
}

/** The analyst findings among the events: who analyzed which worker, and what they said. */
export function findingsOf(
  events: ReadonlyArray<WakeEvent>,
  analyst?: string,
): Array<{ analyst: string; fromWorker: string; findings: Record<string, unknown> }> {
  return events
    .filter((e) => e.type === 'finding' && (analyst === undefined || e.analyst === analyst))
    .map((e) => ({
      analyst: String(e.analyst),
      fromWorker: String(e.fromWorker),
      findings: (e.findings ?? {}) as Record<string, unknown>,
    }))
}

/** The settled workers among the events, with the leaf's own verdict (`valid`, `score`). */
export function settledOf(
  events: ReadonlyArray<WakeEvent>,
): Array<{ id: string; valid: boolean; score: number }> {
  return events
    .filter((e) => e.type === 'settled')
    .map((e) => ({ id: String(e.settled), valid: e.valid === true, score: Number(e.score ?? 0) }))
}

/** Every tool result the driver has received, by tool-call id, parsed when it is JSON. */
export function toolResults(
  messages: ReadonlyArray<Record<string, unknown>>,
): Map<string, unknown> {
  const results = new Map<string, unknown>()
  for (const message of messages) {
    if (message.role !== 'tool' || typeof message.tool_call_id !== 'string') continue
    const content = message.content
    try {
      results.set(message.tool_call_id, typeof content === 'string' ? JSON.parse(content) : content)
    } catch {
      results.set(message.tool_call_id, content)
    }
  }
  return results
}

/** The worker output an `observe_agent` call (by its tool-call id) returned, if it has returned. */
export function observedOutput(results: ReadonlyMap<string, unknown>, callId: string): unknown {
  return (results.get(callId) as { output?: unknown } | undefined)?.output
}

/** The worker id a `spawn_worker` call (by its tool-call id) returned, if it has returned. */
export function spawnedId(
  results: ReadonlyMap<string, unknown>,
  callId: string,
): string | undefined {
  return (results.get(callId) as { workerId?: string } | undefined)?.workerId
}

/** The driver's last step: submit `result` through `submit_result`. Once a submission is accepted
 *  the turn ends; a submission refused because work is still open ends the turn too, and the next
 *  wake submits again. */
export function submitTurn(
  results: ReadonlyMap<string, unknown>,
  call: number,
  result: unknown,
): ScriptedTurn {
  for (const [id, value] of results) {
    if (id.startsWith('submit-') && (value as { accepted?: unknown }).accepted === true) {
      return { content: 'delivered' }
    }
  }
  if (results.has(`submit-${call - 1}`)) return { content: 'waiting to submit again' }
  return { toolCalls: [{ id: `submit-${call}`, name: 'submit_result', arguments: { result } }] }
}

/** A driver whose next move depends on what the events SAY, not just that they arrived: `decide`
 *  sees every event so far, how many times it has been asked, and every tool result so far (by
 *  tool-call id), and returns the next turn (a turn with no tool call ends the driver's turn to
 *  wait). Tool-call ids not given by the turn are minted here. */
export function reactiveBrain(
  decide: (
    events: WakeEvent[],
    call: number,
    results: ReadonlyMap<string, unknown>,
  ) => ScriptedTurn,
): ToolLoopChat {
  let call = 0
  return async (messages) => {
    const turn = decide(wakeEvents(messages), call, toolResults(messages))
    call += 1
    return {
      ...(turn.content !== undefined ? { content: turn.content } : {}),
      toolCalls: (turn.toolCalls ?? []).map((tc, j) => ({
        id: tc.id ?? `rc-${call}-${j}`,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
    }
  }
}

/** A scripted OpenAI-compatible transport for a NESTED supervisor's router brain — the HTTP peer,
 *  faked at the process boundary (`RouterTransportConfig.complete`), so the nested supervisor runs
 *  its real tool loop offline. Turns advance like `scriptedBrain` (the last repeats). */
export function scriptedRouter(
  turns: ScriptedTurn[],
): NonNullable<RouterTransportConfig['complete']> {
  let i = 0
  return async (body) => {
    const messages = (body.messages ?? []) as ReadonlyArray<Record<string, unknown>>
    while (turns[i]?.until?.(messages) === true) i += 1
    const turn = turns[Math.min(i, turns.length - 1)] ?? {}
    if (turn.until === undefined) i += 1
    return {
      model: String(body.model ?? 'offline'),
      choices: [
        {
          message: {
            content: turn.content ?? null,
            tool_calls: (turn.toolCalls ?? []).map((tc, j) => ({
              id: tc.id ?? `rt-${i}-${j}`,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          },
          finish_reason: turn.toolCalls?.length ? 'tool_calls' : 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, cost_usd: 0 },
    }
  }
}
