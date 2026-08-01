/**
 *
 * `piExecutor` — pi wrapped behind `Executor`, NOT forked.
 *
 * pi already implements everything a steerable worker needs, and implements it well: a queued
 * steering channel delivered between turns, follow-ups, abort, compaction, session persistence
 * with fork/branch, and an out-of-process line-delimited JSON protocol over stdin/stdout
 * (`pi --mode rpc`). Reimplementing any of that here would mean owning a turn loop someone else
 * already maintains. So this module is a thin protocol adapter, and every capability maps onto a
 * verb pi already has:
 *
 *   `execute`        → `prompt`, draining pi's event stream until `agent_settled`
 *   `deliver`        → `prompt` with `streamingBehavior` — pi owns the queue, we do not
 *   `teardown`       → `abort`, then close stdin and reap the process
 *   `progress`       → pi's `tool_execution_start`/`_end` + `turn_end` events, plus `get_state`'s
 *                      `pendingMessageCount` mirrored locally so the read stays synchronous
 *   `traceSource`    → the same tool events decoded into the shared `ToolSpan` currency
 *   `resultArtifact` → the terminal successful assistant turn
 *
 * It is registered through the DOCUMENTED extension point (`ExecutorRegistry.register('pi', …)`),
 * so nothing in the resolver switches on it and a consumer can replace it wholesale.
 *
 * agent-runtime does NOT take a dependency on pi. The wire shapes (`RpcCommand`, `AgentEvent`)
 * are read structurally off JSON lines, so a pi that adds commands stays compatible and a pi that
 * is not installed simply fails loud at spawn instead of at import.
 *
 * Usage accounting: pi repeats the same assistant receipt in `message_end` and `turn_end`.
 * Only `turn_end` is counted, once per model call. Pi reports cache traffic separately from fresh
 * input, so all three input classes are folded into Runtime's two-field token total. Subscription
 * usage whose dollar price is absent or zero stays explicitly unknown through the live usage
 * stream and terminal artifact.
 *
 * ## What of the `AgentProfile` this executor honors, and what it does not
 *
 * This adapter is NOT a profile materializer. It reads a deliberately small part of
 * `spec.profile`, and a caller who needs the rest must lower it before handing the profile over.
 * Stated exhaustively so a silent drop is never a surprise:
 *
 * | Field | Status |
 * | --- | --- |
 * | `profile.name` | honored — trace `runId` label only, no behavioral effect |
 * | `profile.prompt.systemPrompt` | honored — prepended to the task text (pi RPC takes no separate system-prompt channel) |
 * | `profile.mcp` | honored — written to this execution's own file and passed as `--mcp-config` for `pi-mcp-adapter`; see `pi-mcp.ts` |
 * | `profile.extensions.pi.load` | honored — lowered to `--no-extensions` + `--extension <abs>` |
 * | `profile.prompt.instructions` | honored — appended to the system prompt, one per line |
 * | `profile.model.default` | honored — overrides the seam's `model`; the seam is the fallback for profiles that select none |
 * | `profile.model.reasoningEffort` | DROPPED — no `--thinking` flag is emitted, so pi's configured `defaultThinkingLevel` applies |
 * | `profile.tools` | DROPPED — no `--no-tools` / allow-deny mapping; pi runs its full builtin tool set |
 * | `profile.permissions` | DROPPED |
 * | `profile.resources` (context / skills / commands / subagents / instructions) | DROPPED — nothing is written into the run cwd |
 * | `profile.hooks` | DROPPED |
 * | `profile.subagents`, `profile.connections`, `profile.modes`, `profile.confidential` | DROPPED |
 * | `profile.resources.failOnError` | not consulted — the MCP path above is unconditionally fail-closed, which is the stricter reading |
 * | every other `profile.extensions.<ns>` | DROPPED — only the `pi` namespace is read |
 *
 * Closing those gaps belongs in `@tangle-network/agent-profile-materialize`, whose plan this
 * executor would then apply, rather than in a second mapping grown here.
 *
 * @experimental
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import { abortError, throwIfAborted } from '../util'
import { createInbox, type Inbox, type InboxMessage } from './inbox'
import { attestRuntimeOwnedExecutor, newExecutionAttemptId } from './materialization'
import { PI_MCP_ADAPTER, type PiMcpReceipt, preparePiMcp } from './pi-mcp'
import {
  type ActivityLog,
  createActivityLog,
  describeToolArgs,
  type ExecutorProgress,
} from './progress'
import { createPushTraceSource, type ToolStepInput, type TraceSource } from './trace-source'
import type {
  ExecutorContext,
  ExecutorFactory,
  ExecutorResult,
  Runtime,
  Spend,
  UsageEvent,
} from './types'
import { workerTraceEnv } from './worker-trace'

/** The runtime name `piExecutor` registers under. */
export const PI_RUNTIME: Runtime = 'pi'

/** Seam key the registry threads a `PiSeam` through (`ExecutorContext.seams['pi']`). */
export const piSeamKey = 'pi'

/** How to launch pi in its out-of-process RPC mode, and how long to wait on it. */
export interface PiSeam {
  /** The pi executable (default `'pi'`). Anything on PATH or an absolute path. */
  bin?: string
  /** Extra args appended after `--mode rpc`. `--provider` / `--model` are added from `model`. */
  args?: ReadonlyArray<string>
  /** `provider/model` or just `model` — split on the first `/` into pi's two flags. */
  model?: string
  cwd?: string
  env?: Record<string, string>
  /** Wall-clock ceiling for one `prompt` (the wait for `agent_settled`). Omit = no timeout. */
  turnTimeoutMs?: number
  /** Newest-last activity window `progress()` reports. Default 12. */
  activityWindow?: number
}

/** Structural read of Pi's stdout records: agent events plus correlated RPC responses. */
interface PiEvent {
  id?: string
  type?: string
  command?: string
  success?: boolean
  error?: string
  toolCallId?: string
  toolName?: string
  args?: unknown
  result?: unknown
  isError?: boolean
  message?: unknown
}

interface PendingPiTool {
  args: unknown
  startedAt: number
}

interface PiAssistantOutcome {
  text: string
  stopReason?: string
  errorMessage?: string
}

/** Build the `Executor` for one pi worker. Registered as runtime `'pi'`. */
export const piExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const configured = readPiSeam(ctx)
  const seam: PiSeam = {
    ...configured,
    // The backend model is a fallback for profiles that do not select one. AgentProfile is the
    // experiment-owned knob, so an ambient/default seam must never override the authored arm.
    ...(spec.profile.model?.default ? { model: spec.profile.model.default } : {}),
  }
  // `TRACE_ID` / `PARENT_SPAN_ID` for this worker when the run records spans; `{}` otherwise, which
  // leaves the spawn environment byte-identical to the untraced path.
  const traceEnv = workerTraceEnv(ctx)
  const inbox = createInbox()
  const activity = createActivityLog(seam.activityWindow ?? 12)
  // One id per worker EXECUTION, not per factory: it labels the trace and names this worker's
  // private MCP config directory, and two workers built from one seam must not share either.
  const runId = `pi-${spec.profile.name ?? 'worker'}-${Date.now()}`
  const trace = createPushTraceSource({ runId })
  const executionId = ctx.node?.nodeId ?? `pi-run-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)
  // What this executor changed about what the caller declared. Unlike `recentActivity` this is
  // never evicted, so a run that fails after the change still reports it.
  const derived: string[] = []

  const controller = new AbortController()
  const cascade = () => controller.abort()
  if (ctx.signal.aborted) controller.abort()
  else ctx.signal.addEventListener('abort', cascade, { once: true })

  const state = {
    turns: 0,
    lastText: '',
    note: 'starting',
    proc: undefined as ChildProcess | undefined,
    artifact: undefined as ExecutorResult<unknown> | undefined,
  }

  const executor: ReturnType<ExecutorFactory<unknown>> = {
    runtime: PI_RUNTIME,
    // pi owns the queue; `deliver` only routes through its state-safe `prompt` command. Its
    // streaming behavior chooses steer versus follow-up atomically in pi, rather than trusting
    // this adapter's delayed view of whether the current run has already ended.
    deliver: (m) => inbox.deliver(m),
    progress: (): ExecutorProgress => ({
      turns: state.turns,
      pendingMessages: inbox.pending(),
      recentActivity: activity.read(),
      ...(derived.length > 0 ? { derived: [...derived] } : {}),
      note: state.note,
    }),
    traceSource: (): TraceSource => trace.source,
    execute(task, signal): AsyncIterable<UsageEvent> {
      return streamPiSession({
        task,
        signal,
        controller,
        seam,
        traceEnv,
        spec,
        runId,
        inbox,
        activity,
        derived,
        record: (step: ToolStepInput) => {
          trace.record(step)
        },
        state,
      })
    },
    async teardown(grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      const proc = state.proc
      if (!proc || proc.exitCode !== null || proc.killed) return { destroyed: true }
      // Ask pi to stop cleanly first — an `abort` lets it finalize its session JSONL, which is
      // the whole reason to wrap pi rather than kill it.
      sendCommand(proc, { type: 'abort' })
      return killPi(proc, grace)
    },
    resultArtifact() {
      if (!state.artifact) {
        throw new ValidationError('piExecutor: resultArtifact() read before stream drained')
      }
      return state.artifact
    },
  }
  // Attestation binds the KERNEL-minted attempt id. An executor built outside a Scope (no
  // `ctx.node`) has no kernel identity to bind, so it makes no attestation claim and a later
  // scope spawn records honest unknown receipts instead of a mismatched binding.
  if (ctx.node === undefined) return executor
  return attestRuntimeOwnedExecutor(
    executor,
    {
      effectiveProfile: spec.profile,
      backend: 'pi',
      model: seam.model
        ? { status: 'known', id: seam.model }
        : { status: 'unknown', reason: 'pi selected its configured default model' },
      execution: { kind: 'run', id: executionId },
      materializer: 'pi-rpc-agent-profile',
      plan: {
        kind: 'pi-rpc-session',
        bin: seam.bin ?? 'pi',
        args: seam.args ?? [],
        cwd: seam.cwd ?? null,
        model: seam.model ?? null,
        turnTimeoutMs: seam.turnTimeoutMs ?? null,
      },
    },
    {
      attemptId,
      binding: {
        executionId,
        bin: seam.bin ?? 'pi',
        cwd: seam.cwd ?? null,
        model: seam.model ?? null,
      },
      descriptor: { kind: 'pi-rpc-run', transport: 'process', backend: 'pi' },
    },
  )
}

/** What one pi run reports about the terminal assistant turn, plus any derived MCP mount. */
export interface PiExecutorOutput {
  content: string
  turns: number
  /** Present only when `profile.mcp` declared at least one usable server. Records what pi was
   *  actually given — including an extension this executor added that the profile did not list. */
  mcp?: PiMcpReceipt
}

interface StreamPiArgs {
  task: unknown
  signal: AbortSignal
  controller: AbortController
  seam: PiSeam
  /** Inherited `TRACE_ID` / `PARENT_SPAN_ID` for the pi subprocess; empty when tracing is off. */
  traceEnv: Record<string, string>
  spec: { profile: AgentProfile }
  /** This execution's id — labels the trace and names the private MCP config directory. */
  runId: string
  inbox: Inbox
  activity: ActivityLog
  /** Append-only record of what this executor changed about the caller's declaration. */
  derived: string[]
  record: (step: ToolStepInput) => void
  state: {
    turns: number
    lastText: string
    note: string
    proc: ChildProcess | undefined
    artifact: ExecutorResult<unknown> | undefined
  }
}

/**
 * One pi RPC session, run to `agent_settled`. Every steer delivered while the turn is in flight is
 * forwarded to pi IMMEDIATELY (pi queues and delivers it at its own turn boundary — the queue we
 * deliberately do not reimplement), and any steer still unread when pi settles re-prompts it.
 * `agent_end` is deliberately not terminal: Pi may auto-retry or compact after emitting it.
 */
async function* streamPiSession(args: StreamPiArgs): AsyncIterable<UsageEvent> {
  const { seam, inbox, activity, state } = args
  const started = Date.now()
  const tokens = { input: 0, output: 0 }
  let usd = 0
  let usdKnown = true
  let tokensKnown = true
  throwIfAborted(args.signal)
  throwIfAborted(args.controller.signal)

  // Profile-declared MCP servers become this execution's OWN `--mcp-config` file BEFORE pi starts,
  // because `pi-mcp-adapter` reads that path at load time. The file is private to this worker, so
  // two workers built from one seam never share it. This THROWS — before any file is written and
  // before pi is spawned — when the adapter that gives pi MCP at all is missing, rather than
  // starting a worker whose declared tools silently do not exist.
  const piMcp = preparePiMcp(args.spec.profile, {
    ...(seam.cwd !== undefined ? { cwd: seam.cwd } : {}),
    runId: args.runId,
  })
  if (piMcp.receipt) {
    const injected = piMcp.receipt.adapterInjected ? ` (+${PI_MCP_ADAPTER} added)` : ''
    activity.push({
      at: Date.now(),
      kind: 'note',
      label: 'mcp',
      detail: `${piMcp.receipt.servers.join(', ')}${injected}`,
    })
    // `recentActivity` is a bounded ring and `resultArtifact()` throws until the stream drains, so
    // neither can answer "what was pi actually given?" for a run that failed on turn 40. This can.
    args.derived.push(
      `mcp: mounted ${piMcp.receipt.servers.join(', ')} via --mcp-config ${piMcp.receipt.configPath}`,
    )
    if (piMcp.receipt.adapterInjected) {
      args.derived.push(
        `extensions: added ${PI_MCP_ADAPTER} to extensions.pi.load — the profile's own list would ` +
          'have run under --no-extensions and suppressed it, mounting zero servers',
      )
    }
  }

  let proc: ChildProcess
  try {
    proc = spawnPi(seam, piMcp.args, args.traceEnv)
  } catch (spawnFailure) {
    // The config directory was created before the spawn was attempted; a spawn that never happened
    // still owes its removal.
    piMcp.mount?.cleanup()
    throw spawnFailure
  }
  state.proc = proc
  state.note = 'connected'

  const events: PiEvent[] = []
  const pendingTools = new Map<string, PendingPiTool>()
  const awaitingPromptResponses = new Set<string>()
  let settled = false
  let acceptedPromptSinceSettlement = false
  let promptSequence = 0
  let lastAssistant: PiAssistantOutcome | undefined
  let failure: Error | undefined
  let abortDeadline: number | undefined
  let exited = false
  let exitCode: number | null | undefined
  let wake: (() => void) | undefined
  const notify = () => {
    const w = wake
    wake = undefined
    w?.()
  }

  const stdoutLines = readJsonLines(proc, (value) => {
    const ev = value as PiEvent
    events.push(ev)
    notify()
  })

  proc.once('exit', (code) => {
    exited = true
    exitCode = code
    notify()
  })
  proc.once('error', (e) => {
    failure = new ValidationError(`piExecutor: pi failed to start: ${e.message}`)
    notify()
  })

  const abortAll = () => {
    if (abortDeadline !== undefined) return
    sendCommand(proc, { type: 'abort' })
    abortDeadline = Date.now() + PI_ABORT_RECEIPT_MS
    state.note = 'aborting'
    notify()
  }
  args.signal.addEventListener('abort', abortAll, { once: true })
  args.controller.signal.addEventListener('abort', abortAll, { once: true })

  const system = [
    args.spec.profile.prompt?.systemPrompt,
    ...(args.spec.profile.prompt?.instructions ?? []),
  ]
    .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    .join('\n')
  const opening = system ? `${system}\n\n${taskText(args.task)}` : taskText(args.task)
  const deadline = seam.turnTimeoutMs ? Date.now() + seam.turnTimeoutMs : undefined
  const sendPrompt = (message: string, streamingBehavior?: 'steer' | 'followUp'): void => {
    const id = `agent-runtime-prompt-${++promptSequence}`
    awaitingPromptResponses.add(id)
    sendCommand(proc, {
      id,
      type: 'prompt',
      message,
      ...(streamingBehavior ? { streamingBehavior } : {}),
    })
  }

  try {
    // Close the check→listener race without ever dispatching a cancelled task.
    if (args.signal.aborted || args.controller.signal.aborted) throw abortError()
    sendPrompt(opening)
    state.note = 'turn 0'

    for (;;) {
      // Forward anything the driver delivered — pi's own queue is the single source of truth
      // for ordering, so this is a route, not a second queue.
      if (!settled && abortDeadline === undefined) forwardPending(inbox, activity, sendPrompt)

      // Drain what pi has emitted so far, projecting usage + activity.
      while (events.length > 0) {
        const ev = events.shift() as PiEvent
        if (
          ev.type === 'response' &&
          ev.command === 'prompt' &&
          typeof ev.id === 'string' &&
          awaitingPromptResponses.delete(ev.id)
        ) {
          if (ev.success === true) {
            // A settlement that preceded this acceptance belongs to an older prompt. Require a
            // later `agent_settled` before ending the session.
            acceptedPromptSinceSettlement = true
          } else {
            failure = new ValidationError(
              `piExecutor: Pi rejected prompt: ${ev.error ?? 'unknown RPC error'}`,
            )
          }
        }
        if (ev.type === 'agent_start') settled = false
        if (ev.type === 'agent_settled') {
          settled = true
          acceptedPromptSinceSettlement = false
        }
        const projected = projectPiEvent(ev, args, tokens, pendingTools)
        if (projected.assistant) lastAssistant = projected.assistant
        if (projected.tokensUnknown) tokensKnown = false
        for (const usage of projected.events) {
          if (usage.kind === 'cost') {
            usd += usage.usd
            if (usage.usdKnown === false) usdKnown = false
          }
          yield usage
        }
      }

      if (failure) throw failure
      if (abortDeadline !== undefined && (settled || exited)) throw abortError()
      if (
        abortDeadline === undefined &&
        exited &&
        (!settled || awaitingPromptResponses.size > 0 || acceptedPromptSinceSettlement)
      ) {
        throw new ValidationError(
          `piExecutor: pi exited before agent_settled (code ${exitCode ?? 'unknown'})`,
        )
      }
      // Once cancellation starts, Pi's terminal receipt gets its own bounded drain window.
      if (abortDeadline === undefined && deadline !== undefined && Date.now() > deadline) {
        throw new ValidationError('piExecutor: turn exceeded turnTimeoutMs')
      }
      if (abortDeadline !== undefined && Date.now() > abortDeadline) {
        const error = abortError()
        error.message = `piExecutor: abort did not settle within ${PI_ABORT_RECEIPT_MS}ms`
        throw error
      }

      if (settled && awaitingPromptResponses.size === 0 && !acceptedPromptSinceSettlement) {
        // A steer delivered in the settle gap starts a new Pi prompt. Pi has declared the prior
        // session activity fully quiet, so no retry/compaction can race this transition.
        const pending = inbox.drain()
        if (pending.length === 0) break
        settled = false
        lastAssistant = undefined
        sendPrompt(inbox.fold(pending))
        state.note = `turn ${state.turns}`
        continue
      }

      await new Promise<void>((resolve) => {
        wake = resolve
        // A short fence keeps the loop responsive to a steer that arrives with no pi output.
        const t = setTimeout(() => {
          if (wake === resolve) {
            wake = undefined
            resolve()
          }
        }, 50)
        if (typeof t.unref === 'function') t.unref()
      })
    }
  } finally {
    stdoutLines()
    state.note = 'settled'
    args.signal.removeEventListener('abort', abortAll)
    args.controller.signal.removeEventListener('abort', abortAll)
    await killPi(proc, 2_000).catch(() => ({ destroyed: false }))
    // Every exit path — settle, throw, abort, turn timeout — removes this execution's config
    // directory. Only after pi is reaped, so a still-running pi can never observe it half-removed.
    piMcp.mount?.cleanup()
  }

  if (args.signal.aborted || args.controller.signal.aborted) throw abortError()
  if (!lastAssistant) {
    throw new ValidationError('piExecutor: agent_settled without an assistant turn')
  }
  if (lastAssistant.stopReason === 'aborted') throw abortError()
  if (lastAssistant.stopReason === 'error') {
    throw new ValidationError(
      `piExecutor: Pi assistant failed: ${lastAssistant.errorMessage ?? 'unknown provider error'}`,
    )
  }
  state.lastText = lastAssistant.text

  const spent: Spend = {
    iterations: state.turns,
    tokens,
    ...(tokensKnown ? {} : { tokensKnown: false }),
    usd,
    ...(usdKnown ? {} : { usdKnown: false }),
    ms: Date.now() - started,
  }
  const out: PiExecutorOutput = {
    content: state.lastText,
    turns: state.turns,
    ...(piMcp.receipt ? { mcp: piMcp.receipt } : {}),
  }
  state.artifact = {
    outRef: `pi:${hash(state.lastText)}`,
    out,
    spent,
  }
}

/** Route messages through pi's state-safe prompt command; pi owns the queue and idle transition. */
function forwardPending(
  inbox: Inbox,
  activity: ActivityLog,
  sendPrompt: (message: string, streamingBehavior?: 'steer' | 'followUp') => void,
): void {
  const pending = inbox.drain()
  for (const m of pending) {
    sendPrompt(renderOne(m), m.interrupt ? 'steer' : 'followUp')
    activity.push({
      at: Date.now(),
      kind: 'note',
      label: m.interrupt ? 'steer' : 'follow-up',
      detail: m.text.length > 80 ? `${m.text.slice(0, 77)}...` : m.text,
    })
  }
}

function renderOne(m: InboxMessage): string {
  if (m.kind === 'answer') {
    return `Answer to your question${m.questionId ? ` (${m.questionId})` : ''}: ${m.text}`
  }
  return `New instruction from your supervisor: ${m.text}`
}

/** Project one pi event onto usage events, updating turn count / activity / trace as a side
 *  effect. pi's tool events are the live trace; its `turn_end` bumps the turn counter. */
function projectPiEvent(
  ev: PiEvent,
  args: StreamPiArgs,
  tokens: { input: number; output: number },
  pendingTools: Map<string, PendingPiTool>,
): { events: UsageEvent[]; assistant?: PiAssistantOutcome; tokensUnknown?: true } {
  const out: UsageEvent[] = []
  const at = Date.now()
  if (ev.type === 'tool_execution_start' && typeof ev.toolName === 'string') {
    args.activity.push({ at, kind: 'tool', label: ev.toolName, detail: describeToolArgs(ev.args) })
    if (typeof ev.toolCallId === 'string') {
      pendingTools.set(ev.toolCallId, { args: ev.args ?? {}, startedAt: at })
    }
    return { events: out }
  }
  if (ev.type === 'tool_execution_end' && typeof ev.toolName === 'string') {
    const status = ev.isError === true ? 'error' : 'ok'
    const callId = typeof ev.toolCallId === 'string' ? ev.toolCallId : undefined
    const started = callId ? pendingTools.get(callId) : undefined
    if (callId) pendingTools.delete(callId)
    const error = status === 'error' ? describeToolError(ev.result) : undefined
    args.activity.push({ at, kind: 'tool', label: ev.toolName, status })
    args.record({
      toolName: ev.toolName,
      args: started?.args ?? {},
      ...(started ? {} : { argsCaptured: false }),
      status,
      ...(ev.result !== undefined ? { result: ev.result } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(callId ? { callId } : {}),
      ...(started ? { startedAt: started.startedAt } : {}),
      endedAt: at,
    })
    return { events: out }
  }
  // Pi emits this for user, assistant, and toolResult messages. `turn_end.message` is the
  // authoritative assistant receipt; a generic message can never become the result artifact.
  if (ev.type === 'message_end') return { events: out }
  if (ev.type === 'turn_end') {
    const usage = readUsage(ev.message)
    if (usage && (usage.input || usage.output)) {
      tokens.input += usage.input
      tokens.output += usage.output
      out.push({ kind: 'tokens', input: usage.input, output: usage.output })
    }
    out.push(
      usage?.usd !== undefined
        ? { kind: 'cost', usd: usage.usd }
        : { kind: 'cost', usd: 0, usdKnown: false },
    )
    args.state.turns += 1
    args.activity.push({ at, kind: 'turn', label: `turn ${args.state.turns}` })
    out.push({ kind: 'iteration' })
    const assistant = readAssistantOutcome(ev.message)
    // A turn whose receipt named no token field at all did real work with an unreported count.
    // The terminal artifact must carry that as `tokensKnown: false`, never as a silent zero.
    const tokensUnknown = !usage || usage.tokensKnown === false
    return {
      events: out,
      ...(assistant ? { assistant } : {}),
      ...(tokensUnknown ? { tokensUnknown: true as const } : {}),
    }
  }
  return { events: out }
}

/** Pi's fresh input excludes cache reads and writes. Runtime's input channel includes all model
 * input, so combine them once at the assistant receipt. A missing or zero price is unknown because
 * subscription-backed providers report zero even when compute was not free. */
function readUsage(
  message: unknown,
): { input: number; output: number; usd?: number; tokensKnown: boolean } | undefined {
  if (!message || typeof message !== 'object') return undefined
  const usage = (message as { usage?: unknown }).usage
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const promptTokens = num(u.prompt_tokens)
  const freshInput = num(u.input) ?? num(u.inputTokens)
  const outputRaw = num(u.output) ?? num(u.outputTokens) ?? num(u.completion_tokens)
  const input =
    promptTokens ??
    (freshInput ?? 0) +
      (num(u.cacheRead) ?? num(u.cache_read_input_tokens) ?? num(u.cacheReadInputTokens) ?? 0) +
      (num(u.cacheWrite) ??
        num(u.cache_creation_input_tokens) ??
        num(u.cacheCreationInputTokens) ??
        0)
  const output = outputRaw ?? 0
  const costRaw = u.cost
  const reportedUsd =
    num(costRaw) ??
    (costRaw && typeof costRaw === 'object'
      ? (num((costRaw as Record<string, unknown>).total) ??
        num((costRaw as Record<string, unknown>).totalCost))
      : undefined)
  return {
    input,
    output,
    ...(reportedUsd !== undefined && reportedUsd > 0 ? { usd: reportedUsd } : {}),
    // A usage object that named NO token field is a receipt without a count, not a zero.
    tokensKnown: promptTokens !== undefined || freshInput !== undefined || outputRaw !== undefined,
  }
}

function readAssistantOutcome(message: unknown): PiAssistantOutcome | undefined {
  if (!message || typeof message !== 'object') return undefined
  const value = message as Record<string, unknown>
  if (value.role !== 'assistant') return undefined
  return {
    text: readText(message) ?? '',
    ...(typeof value.stopReason === 'string' ? { stopReason: value.stopReason } : {}),
    ...(typeof value.errorMessage === 'string' ? { errorMessage: value.errorMessage } : {}),
  }
}

function readText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string' && content.length > 0) return content
  if (!Array.isArray(content)) return undefined
  const text = content
    .map((block) =>
      block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? ((block as { text: string }).text ?? '')
        : '',
    )
    .join('')
  return text.length > 0 ? text : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

function describeToolError(result: unknown): string | undefined {
  if (typeof result === 'string' && result.length > 0) return result
  if (result && typeof result === 'object') {
    const value = result as Record<string, unknown>
    const direct = value.error ?? value.message
    if (typeof direct === 'string' && direct.length > 0) return direct
    if (Array.isArray(value.content)) {
      const text = value.content
        .map((block) =>
          block &&
          typeof block === 'object' &&
          typeof (block as { text?: unknown }).text === 'string'
            ? (block as { text: string }).text
            : '',
        )
        .filter(Boolean)
        .join('\n')
      if (text.length > 0) return text
    }
  }
  return undefined
}

function taskText(task: unknown): string {
  if (typeof task === 'string') return task
  try {
    return JSON.stringify(task) ?? String(task)
  } catch {
    return String(task)
  }
}

/**
 * Launch `pi --mode rpc`, plus provider/model flags derived from the seam's `provider/model` and
 * the profile-derived extension flags (`--no-extensions` / `--extension`). Seam args go LAST so an
 * operator's explicit flag wins over a derived one under pi's last-flag-wins parsing; RPC mode has
 * no positional prompt, so nothing here has to precede an argument.
 *
 * `traceEnv` is the inherited `TRACE_ID` / `PARENT_SPAN_ID` pair (empty when the run records no
 * spans). It sits ABOVE the supervisor's ambient `process.env` — a supervisor that was itself
 * launched as someone's worker holds ids describing ITS place in an outer trace, which are the
 * wrong parent for this child — and BELOW `seam.env`, so an operator who sets either id explicitly
 * still wins. See `worker-trace.ts` for the full precedence rule.
 */
function spawnPi(
  seam: PiSeam,
  profileArgs: ReadonlyArray<string> = [],
  traceEnv: Record<string, string> = {},
): ChildProcess {
  const bin = seam.bin ?? 'pi'
  const argv = ['--mode', 'rpc']
  if (seam.model) {
    const slash = seam.model.indexOf('/')
    if (slash > 0) {
      argv.push('--provider', seam.model.slice(0, slash), '--model', seam.model.slice(slash + 1))
    } else {
      argv.push('--model', seam.model)
    }
  }
  argv.push(...profileArgs)
  if (seam.args) argv.push(...seam.args)
  return spawn(bin, argv, {
    ...(seam.cwd ? { cwd: seam.cwd } : {}),
    env: { ...process.env, ...traceEnv, ...(seam.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/** Write one `RpcCommand` as a JSON line on pi's stdin. Best-effort: a dead process is not an
 *  error here (the stream loop already observes the exit and fails loud there). */
function sendCommand(proc: ChildProcess, command: Record<string, unknown>): void {
  try {
    proc.stdin?.write(`${JSON.stringify(command)}\n`)
  } catch {
    // The exit/error handlers own the failure path.
  }
}

/** Read newline-delimited JSON off pi's stdout; returns an unsubscribe. Malformed lines are
 *  ignored (pi writes only JSONL on stdout; anything else is noise from a wrapper script). */
function readJsonLines(proc: ChildProcess, onValue: (value: unknown) => void): () => void {
  let buffer = ''
  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (;;) {
      const nl = buffer.indexOf('\n')
      if (nl < 0) break
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        onValue(JSON.parse(line))
      } catch {
        // not JSON — ignore
      }
    }
  }
  proc.stdout?.on('data', onData)
  return () => {
    proc.stdout?.off('data', onData)
  }
}

/** The grace window pi gets to act on the `abort` it was just sent, before a signal is used.
 *  Without it the SIGTERM races the command down the pipe and pi never sees the abort at all —
 *  which defeats the reason to wrap pi rather than kill it (a clean abort finalizes its session). */
const PI_ABORT_GRACE_MS = 500
/** Maximum wait for Pi's aborted receipt and `agent_settled` before forced teardown. */
const PI_ABORT_RECEIPT_MS = 2_000

async function killPi(
  proc: ChildProcess,
  grace: number | 'brutalKill' | 'infinity',
): Promise<{ destroyed: boolean }> {
  if (proc.exitCode !== null || proc.killed) return { destroyed: true }
  if (grace === 'brutalKill') {
    endStdin(proc)
    proc.kill('SIGKILL')
    return { destroyed: true }
  }
  const total = grace === 'infinity' ? 10_000 : Math.max(0, grace)
  // Phase 1: let the already-sent `abort` land and pi exit on its own terms.
  if (await waitForExit(proc, Math.min(PI_ABORT_GRACE_MS, total))) return { destroyed: true }
  // Phase 2: close its input and ask the OS politely.
  endStdin(proc)
  proc.kill('SIGTERM')
  if (await waitForExit(proc, Math.max(0, total - PI_ABORT_GRACE_MS))) return { destroyed: true }
  proc.kill('SIGKILL')
  return { destroyed: true }
}

function endStdin(proc: ChildProcess): void {
  try {
    proc.stdin?.end()
  } catch {
    // already closed
  }
}

function waitForExit(proc: ChildProcess, ms: number): Promise<boolean> {
  if (proc.exitCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    if (typeof timer.unref === 'function') timer.unref()
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

function readPiSeam(ctx: ExecutorContext): PiSeam {
  const seam = ctx.seams[piSeamKey]
  if (seam === undefined) return {}
  if (!seam || typeof seam !== 'object') {
    throw new ValidationError(`piExecutor: seams['${piSeamKey}'] must be a PiSeam object`)
  }
  return seam as PiSeam
}

/** FNV-1a over the terminal text — the same non-cryptographic content address the other leaf
 *  executors mint for their `outRef` dedup hint (the journal re-derives the canonical one). */
function hash(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
