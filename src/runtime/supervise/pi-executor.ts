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
 *   `execute`        → `prompt`, draining pi's event stream until `agent_end`
 *   `deliver`        → `steer` (forceful) / `follow_up` (queued) — pi owns the queue, we do not
 *   `teardown`       → `abort`, then close stdin and reap the process
 *   `progress`       → pi's `tool_execution_start`/`_end` + `turn_end` events, plus `get_state`'s
 *                      `pendingMessageCount` mirrored locally so the read stays synchronous
 *   `traceSource`    → the same tool events decoded into the shared `ToolSpan` currency
 *   `resultArtifact` → the last assistant text collected off the stream
 *
 * It is registered through the DOCUMENTED extension point (`ExecutorRegistry.register('pi', …)`),
 * so nothing in the resolver switches on it and a consumer can replace it wholesale.
 *
 * agent-runtime does NOT take a dependency on pi. The wire shapes (`RpcCommand`, `AgentEvent`)
 * are read structurally off JSON lines, so a pi that adds commands stays compatible and a pi that
 * is not installed simply fails loud at spawn instead of at import.
 *
 * Usage accounting: pi reports token usage on its assistant messages when the provider supplies
 * it. Nothing is fabricated — a turn whose usage pi does not report contributes an `iteration`
 * event and zero tokens, exactly like the other honest executors.
 *
 * @experimental
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { ValidationError } from '../../errors'
import { createInbox, type Inbox, type InboxMessage } from './inbox'
import { type ActivityLog, createActivityLog, type ExecutorProgress } from './progress'
import { createPushTraceSource, type ToolStepInput, type TraceSource } from './trace-source'
import type {
  ExecutorContext,
  ExecutorFactory,
  ExecutorResult,
  Runtime,
  Spend,
  UsageEvent,
} from './types'

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
  /** Wall-clock ceiling for one `prompt` (the wait for `agent_end`). Omit = no timeout. */
  turnTimeoutMs?: number
  /** Newest-last activity window `progress()` reports. Default 12. */
  activityWindow?: number
}

/** Structural read of pi's `AgentEvent` union — only the fields this adapter consumes. */
interface PiEvent {
  type?: string
  toolCallId?: string
  toolName?: string
  args?: unknown
  result?: unknown
  isError?: boolean
  message?: unknown
}

/** Build the `Executor` for one pi worker. Registered as runtime `'pi'`. */
export const piExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readPiSeam(ctx)
  const inbox = createInbox()
  const activity = createActivityLog(seam.activityWindow ?? 12)
  const trace = createPushTraceSource({
    runId: `pi-${spec.profile.name ?? 'worker'}-${Date.now()}`,
  })

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

  return {
    runtime: PI_RUNTIME,
    // pi owns the queue; `deliver` only routes. A forceful message becomes pi's `steer` (which
    // pi delivers after the current tool batch and before the next model call); a queued one
    // becomes `follow_up` (after the turn finishes). Never throws — the inbox contract.
    deliver: (m) => inbox.deliver(m),
    progress: (): ExecutorProgress => ({
      turns: state.turns,
      pendingMessages: inbox.pending(),
      recentActivity: activity.read(),
      note: state.note,
    }),
    traceSource: (): TraceSource => trace.source,
    execute(task, signal): AsyncIterable<UsageEvent> {
      return streamPiSession({
        task,
        signal,
        controller,
        seam,
        spec,
        inbox,
        activity,
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
}

interface StreamPiArgs {
  task: unknown
  signal: AbortSignal
  controller: AbortController
  seam: PiSeam
  spec: { profile: { name?: string; prompt?: { systemPrompt?: string } } }
  inbox: Inbox
  activity: ActivityLog
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
 * One pi RPC session, run to `agent_end`. Every steer delivered while the turn is in flight is
 * forwarded to pi IMMEDIATELY (pi queues and delivers it at its own turn boundary — the queue we
 * deliberately do not reimplement), and any steer still unread when pi goes idle re-prompts it,
 * so a pi worker cannot settle while a message it never saw is pending.
 */
async function* streamPiSession(args: StreamPiArgs): AsyncIterable<UsageEvent> {
  const { seam, inbox, activity, state } = args
  const started = Date.now()
  const tokens = { input: 0, output: 0 }
  let usd = 0

  const proc = spawnPi(seam)
  state.proc = proc
  state.note = 'connected'

  const events: PiEvent[] = []
  let idle = false
  let failure: Error | undefined
  let wake: (() => void) | undefined
  const notify = () => {
    const w = wake
    wake = undefined
    w?.()
  }

  const stdoutLines = readJsonLines(proc, (value) => {
    const ev = value as PiEvent
    if (ev.type === 'agent_end') idle = true
    events.push(ev)
    notify()
  })

  proc.once('exit', (code) => {
    if (!idle && code !== 0 && code !== null) {
      failure = new ValidationError(`piExecutor: pi exited with code ${code}`)
    }
    idle = true
    notify()
  })
  proc.once('error', (e) => {
    failure = new ValidationError(`piExecutor: pi failed to start: ${e.message}`)
    idle = true
    notify()
  })

  const abortAll = () => {
    sendCommand(proc, { type: 'abort' })
    idle = true
    notify()
  }
  if (args.signal.aborted || args.controller.signal.aborted) abortAll()
  else {
    args.signal.addEventListener('abort', abortAll, { once: true })
    args.controller.signal.addEventListener('abort', abortAll, { once: true })
  }

  const system = args.spec.profile.prompt?.systemPrompt
  const opening = system ? `${system}\n\n${taskText(args.task)}` : taskText(args.task)

  const deadline = seam.turnTimeoutMs ? Date.now() + seam.turnTimeoutMs : undefined

  try {
    sendCommand(proc, { type: 'prompt', message: opening })
    state.note = 'turn 0'

    for (;;) {
      // Forward anything the driver delivered — pi's own queue is the single source of truth
      // for ordering, so this is a route, not a second queue.
      forwardPending(proc, inbox, activity)

      // Drain what pi has emitted so far, projecting usage + activity.
      while (events.length > 0) {
        const ev = events.shift() as PiEvent
        for (const usage of projectPiEvent(ev, args, tokens)) {
          if (usage.kind === 'cost') usd += usage.usd
          yield usage
        }
      }

      if (failure) throw failure
      if (deadline !== undefined && Date.now() > deadline) {
        throw new ValidationError('piExecutor: turn exceeded turnTimeoutMs')
      }

      if (idle) {
        // pi went idle. A steer delivered in the gap re-prompts it: a worker must not settle
        // while an unread instruction is pending (the same contract every steerable runtime
        // in this package honors).
        const pending = inbox.drain()
        if (pending.length === 0) break
        idle = false
        sendCommand(proc, { type: 'prompt', message: inbox.fold(pending) })
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
  }

  const spent: Spend = { iterations: state.turns, tokens, usd, ms: Date.now() - started }
  state.artifact = {
    outRef: `pi:${hash(state.lastText)}`,
    out: { content: state.lastText, turns: state.turns },
    spent,
  }
}

/** Route delivered messages onto pi's OWN queue: forceful → `steer`, queued → `follow_up`. */
function forwardPending(proc: ChildProcess, inbox: Inbox, activity: ActivityLog): void {
  const pending = inbox.drain()
  for (const m of pending) {
    sendCommand(proc, {
      type: m.interrupt ? 'steer' : 'follow_up',
      message: renderOne(m),
    })
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
): UsageEvent[] {
  const out: UsageEvent[] = []
  const at = Date.now()
  if (ev.type === 'tool_execution_start' && typeof ev.toolName === 'string') {
    args.activity.push({ at, kind: 'tool', label: ev.toolName, detail: describeArgs(ev.args) })
    return out
  }
  if (ev.type === 'tool_execution_end' && typeof ev.toolName === 'string') {
    const status = ev.isError === true ? 'error' : 'ok'
    args.activity.push({ at, kind: 'tool', label: ev.toolName, status })
    args.record({
      toolName: ev.toolName,
      args: ev.args ?? {},
      status,
      ...(typeof ev.toolCallId === 'string' ? { callId: ev.toolCallId } : {}),
    })
    return out
  }
  if (ev.type === 'turn_end' || ev.type === 'message_end') {
    const usage = readUsage(ev.message)
    if (usage && (usage.input || usage.output)) {
      tokens.input += usage.input
      tokens.output += usage.output
      out.push({ kind: 'tokens', input: usage.input, output: usage.output })
    }
    if (usage?.usd) out.push({ kind: 'cost', usd: usage.usd })
    const text = readText(ev.message)
    if (text) args.state.lastText = text
    if (ev.type === 'turn_end') {
      args.state.turns += 1
      args.activity.push({ at, kind: 'turn', label: `turn ${args.state.turns}` })
      out.push({ kind: 'iteration' })
    }
  }
  return out
}

/** pi's assistant message carries provider usage when the provider reported it. Absent, nothing
 *  is fabricated — the turn still counts as an iteration with zero tokens. */
function readUsage(message: unknown): { input: number; output: number; usd: number } | undefined {
  if (!message || typeof message !== 'object') return undefined
  const usage = (message as { usage?: unknown }).usage
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const input = num(u.input) ?? num(u.inputTokens) ?? num(u.prompt_tokens) ?? 0
  const output = num(u.output) ?? num(u.outputTokens) ?? num(u.completion_tokens) ?? 0
  const costRaw = u.cost
  const usd =
    num(costRaw) ??
    (costRaw && typeof costRaw === 'object'
      ? (num((costRaw as Record<string, unknown>).totalCost) ?? 0)
      : 0)
  return { input, output, usd }
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
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function describeArgs(argsValue: unknown): string | undefined {
  if (!argsValue || typeof argsValue !== 'object') return undefined
  const a = argsValue as Record<string, unknown>
  for (const key of ['filePath', 'file_path', 'path', 'file', 'command', 'cmd', 'pattern']) {
    const v = a[key]
    if (typeof v === 'string' && v.length > 0) return v.length > 120 ? `${v.slice(0, 117)}...` : v
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

/** Launch `pi --mode rpc`, plus provider/model flags derived from the seam's `provider/model`. */
function spawnPi(seam: PiSeam): ChildProcess {
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
  if (seam.args) argv.push(...seam.args)
  return spawn(bin, argv, {
    ...(seam.cwd ? { cwd: seam.cwd } : {}),
    env: { ...process.env, ...(seam.env ?? {}) },
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
