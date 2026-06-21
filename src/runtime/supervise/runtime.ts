/**
 * @experimental
 *
 * The leaf runtime — the built-in `Executor` IMPLEMENTATIONS behind the ONE
 * open interface frozen in `./types`, plus the open resolver/registry that maps
 * an `AgentSpec` to one of them OR accepts a bring-your-own executor verbatim.
 *
 * The interface is the extension point, not a closed `inline|sandbox|cli` union:
 *   - router/inline : a direct OpenAI-compatible Router call, no box (one-shot).
 *   - sandbox       : COMPOSES the existing `runLoop` kernel as a single-task
 *                     leaf and surfaces its token/cost usage as `UsageEvent`s;
 *                     forwards PR #150's optional `lineage` passthrough WITHOUT
 *                     reinventing checkpoint/fork (streaming).
 *   - cli           : a Halo/RLM subprocess; `budgetExempt` (no token accounting),
 *                     excluded from the equal-k arms by construction (streaming).
 * Every metered runtime reports through the SAME normalized `UsageEvent` channel
 * so the conserved budget pool meters them identically. A user's own agent is
 * first-class the moment it implements `Executor` — register it by name or
 * pass it as `AgentSpec.executor`.
 *
 * Layering: `estimateCost`/`isModelPriced` are substrate primitives from
 * `@tangle-network/agent-eval`; `runLoop`/`acquireSandbox` are runtime kernels
 * from this package. No per-vendor adapters live here.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { estimateCost, isModelPriced } from '@tangle-network/agent-eval'
import type { BackendType, SandboxEvent } from '@tangle-network/sandbox'
import { ValidationError } from '../../errors'
import type { LocalHarness } from '../../mcp/local-harness'
import { routerChatWithUsage, type ToolSpec } from '../router-client'
import type { RunLoopOptions } from '../run-loop'
import { runLoop } from '../run-loop'
import type {
  AgentRunSpec,
  Driver,
  ExecCtx,
  Iteration,
  OutputAdapter,
  SandboxClient,
} from '../types'
import { zeroTokenUsage } from '../util'
import { createInbox, type Inbox } from './inbox'
import type {
  AgentSpec,
  DefaultVerdict,
  Executor,
  ExecutorContext,
  ExecutorFactory,
  ExecutorRegistry,
  ExecutorResult,
  Runtime,
  Spend,
  UsageEvent,
} from './types'
import { createWorktreeCliExecutor } from './worktree-cli-executor'

// ── Seam contracts (read off ExecutorContext.seams, narrowed per built-in) ─────

/**
 * Router/inline connection seam. A direct OpenAI-compatible Router endpoint —
 * the cheapest leaf, no box, no tools. `model` overrides the profile's model
 * hint when present; otherwise the profile's `model.default` is required.
 */
export interface RouterSeam {
  routerBaseUrl: string
  routerKey: string
  model?: string
}

/**
 * Sandbox executor seam. The `sandboxClient` the composed `runLoop` creates
 * boxes through, plus the optional trace/run/lineage wiring forwarded into the
 * loop. `lineage` is opaque here (PR #150's `RunLoopOptions.lineage`): forwarded
 * forward-compatibly, never inspected — this executor does NOT reinvent
 * checkpoint/fork.
 */
export interface SandboxSeam {
  sandboxClient: SandboxClient
  /** Forwarded into the composed `runLoop`'s `ctx` (trace emitter, run handle, etc.). */
  loopCtx?: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>
  /** PR #150 `RunLoopOptions.lineage` passthrough — opaque; forwarded, not parsed. */
  lineage?: unknown
  /** Hard cap on the composed loop's iterations. The budget pool reserves against
   *  the spawn `Budget.maxIterations`; this is the leaf's own ceiling. Default 1. */
  maxIterations?: number
}

/** CLI subprocess seam. `bin` + `args` describe the Halo/RLM process to spawn. */
export interface CliSeam {
  bin: string
  args?: string[]
  /** Extra environment for the subprocess (merged over `process.env`). */
  env?: Record<string, string>
  /** Working directory for the subprocess. */
  cwd?: string
}

/**
 * cli-worktree seam. A supervisor-authored `AgentProfile` driving a local coding-harness CLI
 * (claude / codex / opencode) on its own git worktree — the leaf `createWorktreeCliExecutor`
 * named as data. `harness` + `repoRoot` + `taskPrompt` are required; the authored
 * `profile.prompt.systemPrompt` + `profile.model.default` reach the harness via the §1.5
 * `harnessInvocation` mapper. Everything else mirrors `WorktreeCliExecutorOptions`.
 */
export interface CliWorktreeSeam {
  repoRoot: string
  harness: LocalHarness
  taskPrompt: string
  runId?: string
  baseRef?: string
  harnessTimeoutMs?: number
}

/**
 * cli-bridge seam. A local OpenAI-compatible bridge that fronts harness CLIs
 * (claude-code / opencode / kimi / pi) behind one HTTP surface; `model` doubles
 * as the harness selector (e.g. `claude-code/sonnet`, `opencode/<provider>/<model>`).
 * `agentProfile` is the bridge-dialect profile (metadata.disallowedTools, mcp)
 * forwarded verbatim per request — how an arm disables native tools or injects
 * a provider search MCP.
 *
 * The executor opens a RESUMABLE cli-bridge session — structurally identical to the
 * sandbox executor's persistent box, just local. `sessionId` is the stable
 * caller-owned id cli-bridge maps to the harness's internal conversation id; a
 * follow-up steer/resume on the SAME id continues the SAME harness session (opencode
 * `-s`, claude `--resume`, …). Omit it and the executor mints a stable one per spawn.
 */
export interface BridgeSeam {
  bridgeUrl: string
  bridgeBearer: string
  model: string
  agentProfile?: Record<string, unknown>
  timeoutMs?: number
  /** Stable, caller-owned cli-bridge session id for harness-side resume. Defaults
   *  to a freshly minted per-spawn id so each worker is its own resumable session. */
  sessionId?: string
  /** Per-resume-turn inference cap before the worker settles on its last output.
   *  Mirrors `routerToolsInlineExecutor.maxTurns`; default 200 (runaway backstop). */
  maxTurns?: number
}

const routerSeamKey = 'router'
const sandboxSeamKey = 'sandbox'
const cliSeamKey = 'cli'
const bridgeSeamKey = 'bridge'
const cliWorktreeSeamKey = 'cli-worktree'

// ── Content-addressed result pointers (the B1 replay source) ───────────────────

/** Deterministic content hash for an `outRef`. FNV-1a 32-bit over the canonical
 *  JSON of the result — not cryptographic, sufficient for content-addressing the
 *  replay blob so two identical outputs collapse to one pointer. */
function contentRef(prefix: string, value: unknown): string {
  let str: string
  try {
    str = JSON.stringify(value) ?? String(value)
  } catch {
    str = String(value)
  }
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${prefix}:${(h >>> 0).toString(16).padStart(8, '0')}`
}

function zeroSpend(): Spend {
  return { iterations: 0, tokens: zeroTokenUsage(), usd: 0, ms: 0 }
}

// ── router/inline executor (harness === null) ──────────────────────────────────

/**
 * A direct OpenAI-compatible Router chat-completion. One-shot: resolves a
 * `ExecutorResult` and reports its terminal usage as `UsageEvent`s through the
 * conserved pool. Reports REAL token usage — when the provider omits `usage`,
 * the spend records zero tokens but the call still counts one iteration (a
 * phantom fabricated 0 is never emitted as a priced cost).
 *
 * Transport = `routerChatWithUsage` (`../router-client`): transient router
 * failures (429/5xx/Cloudflare-origin) retry with backoff before the executor
 * fails the task.
 */
export const routerInlineExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<RouterSeam>(ctx, routerSeamKey, 'router/inline')
  const model = seam.model ?? spec.profile.model?.default
  if (!model) {
    throw new ValidationError(
      'routerInlineExecutor: no model — set RouterSeam.model or AgentProfile.model.default',
    )
  }
  if (!seam.routerBaseUrl || !seam.routerKey) {
    throw new ValidationError('routerInlineExecutor: RouterSeam.routerBaseUrl + routerKey required')
  }

  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  let artifact: ExecutorResult<unknown> | undefined

  return {
    runtime: 'router' as Runtime,
    async execute(task, signal): Promise<ExecutorResult<unknown>> {
      const messages = taskToMessages(task, spec)
      const started = Date.now()
      const linked = linkSignals(signal, controller.signal)
      const r = await routerChatWithUsage(
        { routerBaseUrl: seam.routerBaseUrl, routerKey: seam.routerKey, model },
        messages,
        linked ? { signal: linked } : {},
      )
      const spent: Spend = {
        iterations: 1,
        tokens: r.usage ? { input: r.usage.input, output: r.usage.output } : zeroTokenUsage(),
        usd: r.costUsd ?? 0,
        ms: Date.now() - started,
      }
      const out = { content: r.content } as unknown
      artifact = { outRef: contentRef('router', { model, content: r.content }), out, spent }
      return artifact
    },
    teardown(_grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError('routerInlineExecutor: resultArtifact() read before execute()')
      }
      return { ...artifact, spent: artifact.spent }
    },
  }
}

export type { ToolSpec }

/**
 * Router seam WITH tool use — the tool-using router backend. Same direct
 * OpenAI-compatible endpoint as `RouterSeam`, but each turn passes `tools`; when
 * the model emits tool_calls they run via `executeToolCall` ON THIS HOST and the
 * results fold back as `tool` messages, repeating until the model answers without
 * a tool or `maxTurns` is hit. A real agentic loop, OFF-BOX — no sandbox, so it
 * is unaffected by a box's egress allowlist. One turn = one completion = the
 * equal-compute unit. `executeToolCall` receives the task so per-task tool
 * surfaces (e.g. a gym keyed by task) can dispatch correctly.
 */
export interface RouterToolsSeam {
  routerBaseUrl: string
  routerKey: string
  model?: string
  tools: ReadonlyArray<ToolSpec>
  executeToolCall: (name: string, args: Record<string, unknown>, task: unknown) => Promise<string>
  /** Online observer of each tool step — the seam a `DetectorMonitor` taps to watch the live pipe
   *  (raise a `finding` when the worker loops/errors). Called after every tool call resolves, with
   *  real per-call wall-clock (`startedAt`/`endedAt`/`durationMs`) so a push `TraceSource` can carry
   *  non-zero span durations onto the unified timeline. */
  onToolStep?: (step: {
    toolName: string
    args: Record<string, unknown>
    status: 'ok' | 'error'
    startedAt: number
    endedAt: number
    durationMs: number
  }) => void
  /** Max inference turns. Default 200 (runaway backstop — set far above any
   *  legitimate workflow). For tighter per-workflow limits use a cost budget
   *  or wall-clock deadline at the call site. */
  maxTurns?: number
}
const routerToolsSeamKey = 'router-tools'

interface RouterToolsResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
    }
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * The tool-using router executor. Drives the multi-turn tool loop the single-shot
 * `routerInlineExecutor` cannot express; same fail-loud + real-usage discipline.
 */
export const routerToolsInlineExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<RouterToolsSeam>(ctx, routerToolsSeamKey, 'router-tools')
  const model = seam.model ?? spec.profile.model?.default
  if (!model) {
    throw new ValidationError(
      'routerToolsInlineExecutor: no model — set RouterToolsSeam.model or AgentProfile.model.default',
    )
  }
  if (!seam.routerBaseUrl || !seam.routerKey) {
    throw new ValidationError(
      'routerToolsInlineExecutor: RouterToolsSeam.routerBaseUrl + routerKey required',
    )
  }
  const maxTurns = seam.maxTurns ?? 200

  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  // The down-leg receive end: the driver's steer/answer/resume land here via `Scope.send`.
  const inbox = createInbox()

  let artifact: ExecutorResult<unknown> | undefined

  return {
    runtime: 'router' as Runtime,
    deliver: (m) => inbox.deliver(m),
    async execute(task, signal): Promise<ExecutorResult<unknown>> {
      const started = Date.now()
      const messages: Array<Record<string, unknown>> = [
        ...(taskToMessages(task, spec) as Array<Record<string, unknown>>),
      ]
      const tokens = zeroTokenUsage()
      let turns = 0
      let lastText = ''
      // Fold any queued down-messages into the conversation as one operator turn (the boundary flush).
      const flush = () => {
        const pending = inbox.drain()
        if (pending.length) messages.push({ role: 'user', content: inbox.fold(pending) })
        return pending.length > 0
      }

      // The external abort sources (caller signal + executor teardown), merged ONCE — so we don't
      // re-register listeners on these long-lived signals every turn.
      const external = mergeAbortSignals(signal, controller.signal)

      for (let t = 0; t < maxTurns; t += 1) {
        // QUEUED messages flush at the step boundary, before this turn's inference.
        flush()
        // A forceful (interrupt) message aborts THIS turn so the worker re-plans immediately. The
        // per-turn controller fires on `external` OR a fresh interrupt; its listener on `external` is
        // removed after the turn (`cleanup`) so nothing accumulates across turns.
        const interruptSig = inbox.freshInterrupt()
        const turnController = new AbortController()
        const abortTurn = () => turnController.abort()
        if (external.aborted) turnController.abort()
        else external.addEventListener('abort', abortTurn)
        interruptSig.addEventListener('abort', abortTurn, { once: true })
        const cleanup = () => external.removeEventListener('abort', abortTurn)
        let res: Response
        try {
          res = await fetch(`${seam.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${seam.routerKey}`,
            },
            body: JSON.stringify({
              model,
              messages,
              tools: seam.tools,
              tool_choice: 'auto',
              temperature: 0.2,
            }),
            signal: turnController.signal,
          })
        } catch (e) {
          cleanup()
          // Re-plan ONLY when a forceful inbox message aborted this turn (a real AbortError, with the
          // interrupt — not the external teardown/budget signal). The re-planned turn still consumes a
          // loop slot (so interrupt spam is bounded by maxTurns, not a hang) but does not bill a turn.
          // Any other error — incl. a network fault coincident with an interrupt — is fatal: rethrow.
          const interruptAbort =
            e instanceof DOMException &&
            e.name === 'AbortError' &&
            interruptSig.aborted &&
            !signal.aborted &&
            !controller.signal.aborted
          if (interruptAbort) continue
          throw e
        }
        cleanup()
        // The inference completed — count the turn now (an interrupted, re-planned turn doesn't bill).
        turns += 1
        if (!res.ok) {
          throw new ValidationError(
            `routerToolsInlineExecutor: router ${res.status}: ${(await res.text()).slice(0, 200)}`,
          )
        }
        const data = (await res.json()) as RouterToolsResponse
        const u = data.usage
        if (u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
          tokens.input += u.prompt_tokens
          tokens.output += u.completion_tokens
        }
        const msg = data.choices?.[0]?.message
        if (msg?.content) lastText = msg.content
        const toolCalls = msg?.tool_calls ?? []
        if (toolCalls.length === 0) {
          // Before settling, flush once more — a worker may not finish while a steer/answer it never
          // read is still pending. If anything flushed, keep going; otherwise it is truly done.
          if (flush()) continue
          break
        }

        // Record the assistant turn verbatim, then run each call on the host and
        // fold the result back as a `tool` message for the next turn.
        messages.push({
          role: 'assistant',
          content: msg?.content ?? '',
          tool_calls: toolCalls.map((tc, i) => ({
            id: tc.id ?? `call_${i}`,
            type: 'function',
            function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' },
          })),
        })
        for (let i = 0; i < toolCalls.length; i += 1) {
          const tc = toolCalls[i]
          const id = tc?.id ?? `call_${i}`
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(tc?.function?.arguments ?? '{}') as Record<string, unknown>
          } catch {
            // Malformed args are a real outcome, not an infra fault — feed the error
            // back so the model can correct, rather than aborting the whole loop.
            messages.push({
              role: 'tool',
              tool_call_id: id,
              content: 'error: tool arguments were not valid JSON',
            })
            continue
          }
          const toolName = tc?.function?.name ?? ''
          let result: string
          let status: 'ok' | 'error' = 'ok'
          const toolStartedAt = Date.now()
          try {
            result = await seam.executeToolCall(toolName, args, task)
          } catch (e) {
            status = 'error'
            result = `error: ${e instanceof Error ? e.message : String(e)}`
          }
          const toolEndedAt = Date.now()
          messages.push({ role: 'tool', tool_call_id: id, content: result })
          // Feed the online detector pipe (stuck-loop / error-streak) — a worker repeating the same
          // call or hammering errors is caught mid-run, not only at settle. This is an observability
          // side-channel: a throwing monitor must never crash the production inference loop.
          try {
            seam.onToolStep?.({
              toolName,
              args,
              status,
              startedAt: toolStartedAt,
              endedAt: toolEndedAt,
              durationMs: toolEndedAt - toolStartedAt,
            })
          } catch {
            // ignore — monitoring must not break the worker
          }
        }
      }

      const usd = isModelPriced(model) ? estimateCost(tokens.input, tokens.output, model) : 0
      const spent: Spend = { iterations: turns, tokens, usd, ms: Date.now() - started }
      const out = { content: lastText } as unknown
      artifact = { outRef: contentRef('router-tools', { model, content: lastText }), out, spent }
      return artifact
    },
    teardown(_grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError(
          'routerToolsInlineExecutor: resultArtifact() read before execute()',
        )
      }
      return { ...artifact, spent: artifact.spent }
    },
  }
}

// ── sandbox executor (harness is a BackendType) ────────────────────────────────

/**
 * COMPOSES `runLoop` as a single-task leaf: one box, a refine driver bounded to
 * the seam's `maxIterations` (default 1), the spec's profile as the agent run.
 * Surfaces the loop's aggregated `tokenUsage` + `costUsd` as `UsageEvent`s after
 * it drains, and yields one `iteration` event per loop iteration. Forwards the
 * optional `lineage` passthrough WITHOUT importing sandbox-lineage / reinventing
 * checkpoint/fork.
 *
 * Streaming shape: the loop runs to completion inside the first `next()`, then
 * the recorded usage events are yielded; the terminal artifact is read from
 * `resultArtifact()` after the stream drains.
 */
export const sandboxExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  if (spec.harness === null) {
    throw new ValidationError('sandboxExecutor: harness is null (router/inline) — wrong executor')
  }
  const harness = spec.harness as BackendType
  const seam = readSeam<SandboxSeam>(ctx, sandboxSeamKey, 'sandbox')
  if (!seam.sandboxClient || typeof seam.sandboxClient.create !== 'function') {
    throw new ValidationError('sandboxExecutor: SandboxSeam.sandboxClient.create required')
  }
  const maxIterations = seam.maxIterations ?? 1
  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    throw new ValidationError('sandboxExecutor: maxIterations must be > 0')
  }

  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  let artifact: ExecutorResult<unknown> | undefined

  // The leaf runs an opaque, self-parallelizing coding harness; the loop just
  // refines once over it. Output is the raw event stream parsed to its tail text.
  const output: OutputAdapter<SandboxLeafOut> = {
    parse(events: SandboxEvent[]): SandboxLeafOut {
      return { events }
    },
  }
  const driver = singleShotDriver<SandboxLeafOut>(maxIterations)

  return {
    runtime: 'sandbox' as Runtime,
    execute(task, signal): AsyncIterable<UsageEvent> {
      return streamSandboxLeaf({
        task,
        signal,
        harness,
        spec,
        seam,
        output,
        driver,
        maxIterations,
        controller,
        loopCtx: seam.loopCtx,
        onArtifact: (a) => {
          artifact = a
        },
      })
    },
    teardown(_grace): Promise<{ destroyed: boolean }> {
      // The composed runLoop owns its box teardown (finally{allSettled(destroy)});
      // aborting the loop's signal cascades into that barrier.
      controller.abort()
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError('sandboxExecutor: resultArtifact() read before stream drained')
      }
      return artifact
    },
  }
}

interface SandboxLeafOut {
  events: SandboxEvent[]
}

interface StreamSandboxArgs {
  task: unknown
  signal: AbortSignal
  harness: BackendType
  spec: AgentSpec
  seam: SandboxSeam
  output: OutputAdapter<SandboxLeafOut>
  driver: Driver<unknown, SandboxLeafOut, string>
  maxIterations: number
  controller: AbortController
  loopCtx?: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>
  onArtifact: (a: ExecutorResult<unknown>) => void
}

async function* streamSandboxLeaf(args: StreamSandboxArgs): AsyncIterable<UsageEvent> {
  const linked = new AbortController()
  const cascade = () => linked.abort()
  if (args.signal.aborted || args.controller.signal.aborted) linked.abort()
  else {
    args.signal.addEventListener('abort', cascade, { once: true })
    args.controller.signal.addEventListener('abort', cascade, { once: true })
  }

  const agentRun: AgentRunSpec<unknown> = {
    profile: args.spec.profile,
    taskToPrompt: (t) => taskToPrompt(t),
    name: args.spec.profile.name ?? args.harness,
    sandboxOverrides: { backend: { type: args.harness } },
  }
  const started = Date.now()

  // `lineage` is a PR #150 RunLoopOptions field absent on this branch — forwarded
  // forward-compatibly without coupling to its (not-yet-present) static type.
  const loopOptions = {
    driver: args.driver,
    agentRun,
    output: args.output,
    task: args.task,
    maxIterations: args.maxIterations,
    maxConcurrency: 1,
    ctx: {
      ...(args.loopCtx ?? {}),
      sandboxClient: args.seam.sandboxClient,
      signal: linked.signal,
    } as ExecCtx,
    ...(args.seam.lineage !== undefined ? { lineage: args.seam.lineage } : {}),
  } as RunLoopOptions<unknown, SandboxLeafOut, string>

  try {
    const result = await runLoop(loopOptions)
    const out = result.winner?.output ?? { events: [] }
    const verdict = result.winner?.verdict
    const spent: Spend = {
      iterations: result.iterations.length,
      tokens: { input: result.tokenUsage.input, output: result.tokenUsage.output },
      usd: result.costUsd,
      ms: Date.now() - started,
    }
    args.onArtifact({
      outRef: contentRef('sandbox', { harness: args.harness, out }),
      out,
      ...(verdict ? { verdict } : {}),
      spent,
    })
    for (let i = 0; i < result.iterations.length; i += 1) yield { kind: 'iteration' }
    if (result.tokenUsage.input || result.tokenUsage.output) {
      yield { kind: 'tokens', input: result.tokenUsage.input, output: result.tokenUsage.output }
    }
    if (result.costUsd) yield { kind: 'cost', usd: result.costUsd }
  } finally {
    args.signal.removeEventListener('abort', cascade)
    args.controller.signal.removeEventListener('abort', cascade)
  }
}

// ── cli executor (Halo / external RLM subprocess) ──────────────────────────────

/**
 * Spawns a subprocess (`bin` + `args`). It cannot account tokens, so it is
 * `budgetExempt: true`: its spend is NOT metered against the conserved pool and
 * its iterations are EXCLUDED from the equal-k arms by construction (the
 * resolver/equal-k path checks `budgetExempt`). teardown is SIGTERM → SIGKILL
 * with a grace window. Streaming: yields one `iteration` event on clean exit.
 */
export const cliExecutor: ExecutorFactory<unknown> = (_spec, ctx) => {
  const seam = readSeam<CliSeam>(ctx, cliSeamKey, 'cli')
  if (!seam.bin) throw new ValidationError('cliExecutor: CliSeam.bin required')

  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  let proc: ReturnType<typeof spawn> | undefined
  let artifact: ExecutorResult<unknown> | undefined

  return {
    runtime: 'cli' as Runtime,
    budgetExempt: true,
    execute(task, signal): AsyncIterable<UsageEvent> {
      return streamCliLeaf({
        task,
        signal,
        seam,
        controller,
        onProc: (p) => {
          proc = p
        },
        onArtifact: (a) => {
          artifact = a
        },
      })
    },
    async teardown(grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      if (!proc || proc.exitCode !== null || proc.killed) return { destroyed: true }
      return killWithGrace(proc, grace)
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError('cliExecutor: resultArtifact() read before stream drained')
      }
      return artifact
    },
  }
}

interface StreamCliArgs {
  task: unknown
  signal: AbortSignal
  seam: CliSeam
  controller: AbortController
  onProc: (p: ReturnType<typeof spawn>) => void
  onArtifact: (a: ExecutorResult<unknown>) => void
}

async function* streamCliLeaf(args: StreamCliArgs): AsyncIterable<UsageEvent> {
  const prompt = taskToPrompt(args.task)
  const proc = spawn(args.seam.bin, args.seam.args ?? [], {
    ...(args.seam.cwd ? { cwd: args.seam.cwd } : {}),
    env: { ...process.env, ...(args.seam.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  args.onProc(proc)

  const onAbort = () => killWithGrace(proc, 'brutalKill')
  if (args.signal.aborted || args.controller.signal.aborted) onAbort()
  else {
    args.signal.addEventListener('abort', onAbort, { once: true })
    args.controller.signal.addEventListener('abort', onAbort, { once: true })
  }

  // Feed the task on stdin; the subprocess owns its own tool/agent loop.
  if (proc.stdin) {
    proc.stdin.write(prompt)
    proc.stdin.end()
  }
  const chunks: string[] = []
  const errChunks: string[] = []
  if (proc.stdout) proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString('utf8')))
  if (proc.stderr) proc.stderr.on('data', (d: Buffer) => errChunks.push(d.toString('utf8')))

  const exit = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
    proc.once('error', (err) => resolve({ code: null, error: err }))
    proc.once('close', (code) => resolve({ code }))
  })
  args.signal.removeEventListener('abort', onAbort)
  args.controller.signal.removeEventListener('abort', onAbort)

  if (exit.error) {
    throw new ValidationError(`cliExecutor: spawn failed: ${exit.error.message}`, {
      cause: exit.error,
    })
  }
  if (exit.code !== 0) {
    throw new ValidationError(
      `cliExecutor: ${args.seam.bin} exited ${exit.code}: ${errChunks.join('').slice(0, 200)}`,
    )
  }
  const out = { content: chunks.join('') } as unknown
  // budgetExempt: spend is recorded zero (not metered) — never a fabricated cost.
  args.onArtifact({ outRef: contentRef('cli', out), out, spent: zeroSpend() })
  yield { kind: 'iteration' }
}

/** SIGTERM, then SIGKILL after `grace` ms (`'brutalKill'` = immediate SIGKILL,
 *  `'infinity'` = await clean exit, never escalate). */
function killWithGrace(
  proc: ReturnType<typeof spawn>,
  grace: number | 'brutalKill' | 'infinity',
): Promise<{ destroyed: boolean }> {
  if (proc.exitCode !== null || proc.killed) return Promise.resolve({ destroyed: true })
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    proc.once('close', () => {
      if (timer) clearTimeout(timer)
      resolve({ destroyed: true })
    })
    if (grace === 'brutalKill') {
      proc.kill('SIGKILL')
      return
    }
    proc.kill('SIGTERM')
    if (grace === 'infinity') return
    timer = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL')
    }, grace)
  })
}

// ── bridge executor (harness CLIs behind the local cli-bridge) ──────────────────

/**
 * A worker as a RESUMABLE cli-bridge harness session — the local twin of the
 * sandbox executor. Both are a persistent, streamed agent session the driver
 * spawns, watches stream `UsageEvent`s, then STEERS/RESUMES out-of-band; the only
 * difference is where the harness runs (local cli-bridge vs a cloud box).
 *
 * Structure mirrors `streamSandboxLeaf` + `routerToolsInlineExecutor`:
 *  - STREAMED: `execute` returns an `AsyncIterable<UsageEvent>`; the SSE chunks
 *    cli-bridge emits (`stream:true`) are parsed into incremental usage + a tail
 *    artifact read via `resultArtifact()` after the stream drains.
 *  - RESUMABLE: every turn carries a stable `session_id`. cli-bridge maps it to the
 *    harness's internal conversation id (SQLite `SessionStore`), so a steer delivered
 *    via `deliver` re-calls the SAME session id — opencode `-s <id>`, claude
 *    `--resume`, … — continuing the SAME harness session, not a fresh one.
 *  - STEERABLE: the down-leg `inbox` is drained at each turn boundary; a queued
 *    steer becomes the next turn's prompt on the same session, and the worker can't
 *    settle while a steer it never read is pending (the sandbox/router contract).
 *  - ABORT: the caller signal + teardown fold into the per-turn fetch signal; a
 *    forceful (`interrupt`) steer aborts the in-flight turn so the worker re-plans.
 *
 * Reports REAL usage when the bridge surfaces it, never a fabricated cost.
 */
export const bridgeExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<BridgeSeam>(ctx, bridgeSeamKey, 'bridge')
  if (!seam.bridgeUrl || !seam.bridgeBearer || !seam.model) {
    throw new ValidationError(
      'bridgeExecutor: BridgeSeam.bridgeUrl + bridgeBearer + model required',
    )
  }
  const maxTurns = seam.maxTurns ?? 200
  // A stable per-spawn session id (caller can pin one) — cli-bridge keys harness
  // resume off this exactly as a box id keys a sandbox session.
  const sessionId = seam.sessionId ?? `bridge-${spec.profile.name ?? 'worker'}-${randomUUID()}`

  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  // The down-leg receive end: the driver's steer/answer/resume land here via `Scope.send`.
  const inbox = createInbox()
  let artifact: ExecutorResult<unknown> | undefined

  return {
    runtime: 'cli' as Runtime,
    deliver: (m) => inbox.deliver(m),
    execute(task, signal): AsyncIterable<UsageEvent> {
      return streamBridgeSession({
        task,
        signal,
        spec,
        seam,
        sessionId,
        maxTurns,
        inbox,
        controller,
        onArtifact: (a) => {
          artifact = a
        },
      })
    },
    teardown(_grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError('bridgeExecutor: resultArtifact() read before stream drained')
      }
      return { ...artifact, spent: artifact.spent }
    },
  }
}

interface StreamBridgeArgs {
  task: unknown
  signal: AbortSignal
  spec: AgentSpec
  seam: BridgeSeam
  sessionId: string
  maxTurns: number
  inbox: Inbox
  controller: AbortController
  onArtifact: (a: ExecutorResult<unknown>) => void
}

/**
 * One resumable cli-bridge session, run as a streamed turn loop. Turn 0 sends the
 * task; each subsequent turn fires ONLY when the inbox has a steer/answer to fold —
 * re-calling the SAME `session_id` so cli-bridge resumes the harness conversation.
 * Mirrors `routerToolsInlineExecutor`'s drain→turn→settle loop, but each turn is a
 * full streamed harness session call rather than a single chat round.
 */
async function* streamBridgeSession(args: StreamBridgeArgs): AsyncIterable<UsageEvent> {
  const { seam, inbox } = args
  const started = Date.now()
  const url = `${seam.bridgeUrl.replace(/\/$/, '')}/v1/chat/completions`
  const external = mergeAbortSignals(args.signal, args.controller.signal)
  const tokens = zeroTokenUsage()
  let usd = 0
  let turns = 0
  let lastText = ''
  const toolCalls: string[] = []

  // Turn 0 is the task; later turns carry the folded steer/answer as the next prompt
  // on the SAME session. `nextPrompt` is undefined once there's nothing pending.
  let nextPrompt: string | undefined = taskToPrompt(args.task)
  const system = args.spec.profile.prompt?.systemPrompt

  for (let t = 0; t < args.maxTurns; t += 1) {
    // Drain queued down-messages; on turns > 0 they ARE the prompt (resume content).
    const pending = inbox.drain()
    if (pending.length) {
      const folded = inbox.fold(pending)
      nextPrompt = t === 0 && nextPrompt ? `${nextPrompt}\n\n${folded}` : folded
    }
    if (nextPrompt === undefined) break

    // Each turn sends ONLY the new prompt — cli-bridge's session resume replays the
    // harness's own history server-side (opencode `-s`), so re-sending it would
    // double the conversation. Turn 0 may include the system preamble.
    const messages: Array<{ role: string; content: string }> = []
    if (t === 0 && typeof system === 'string' && system.length > 0) {
      messages.push({ role: 'system', content: system })
    }
    messages.push({ role: 'user', content: nextPrompt })
    nextPrompt = undefined

    // Per-turn signal: external teardown/abort OR a forceful interrupt steer.
    const interruptSig = inbox.freshInterrupt()
    const turnController = new AbortController()
    const abortTurn = () => turnController.abort()
    if (external.aborted) turnController.abort()
    else external.addEventListener('abort', abortTurn)
    interruptSig.addEventListener('abort', abortTurn, { once: true })
    const timer = seam.timeoutMs ? setTimeout(abortTurn, seam.timeoutMs) : undefined
    const cleanup = () => {
      external.removeEventListener('abort', abortTurn)
      if (timer) clearTimeout(timer)
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${seam.bridgeBearer}`,
          'x-session-id': args.sessionId,
        },
        body: JSON.stringify({
          model: seam.model,
          stream: true,
          session_id: args.sessionId,
          ...(seam.agentProfile ? { agent_profile: seam.agentProfile } : {}),
          messages,
        }),
        signal: turnController.signal,
      })
    } catch (e) {
      cleanup()
      // Re-plan ONLY when a forceful steer (not external teardown) aborted the turn —
      // the steer is already queued, so loop back and fold it. Anything else is fatal.
      const interruptAbort =
        e instanceof DOMException &&
        e.name === 'AbortError' &&
        interruptSig.aborted &&
        !args.signal.aborted &&
        !args.controller.signal.aborted
      if (interruptAbort) continue
      throw e
    }
    if (!res.ok) {
      cleanup()
      throw new ValidationError(
        `bridgeExecutor: bridge ${res.status}: ${(await res.text()).slice(0, 300)}`,
      )
    }
    if (!res.body) {
      cleanup()
      throw new ValidationError('bridgeExecutor: bridge response had no body to stream')
    }

    let turnText = ''
    try {
      for await (const chunk of parseSseChatStream(res.body)) {
        if (chunk.content) {
          turnText += chunk.content
          yield { kind: 'iteration' }
        }
        if (chunk.toolCall) toolCalls.push(chunk.toolCall)
        if (chunk.usage) {
          tokens.input += chunk.usage.input
          tokens.output += chunk.usage.output
          yield { kind: 'tokens', input: chunk.usage.input, output: chunk.usage.output }
        }
        if (typeof chunk.cost === 'number' && chunk.cost > 0) {
          usd += chunk.cost
          yield { kind: 'cost', usd: chunk.cost }
        }
      }
    } finally {
      cleanup()
    }
    turns += 1
    if (turnText) lastText = turnText

    // Before settling, drain once more — the worker can't finish while a steer it
    // never read is pending (the sandbox/router settle contract). A pending steer
    // becomes the next resume turn; otherwise the session is truly done.
    if (inbox.pending() === 0) break
  }

  const spent: Spend = {
    iterations: turns,
    tokens,
    usd,
    ms: Date.now() - started,
  }
  const out = { content: lastText, toolCalls } as unknown
  args.onArtifact({
    outRef: contentRef('bridge', { model: seam.model, session: args.sessionId, content: lastText }),
    out,
    spent,
  })
}

interface BridgeStreamChunk {
  content?: string
  toolCall?: string
  usage?: { input: number; output: number }
  cost?: number
}

/**
 * Parse cli-bridge's OpenAI-compatible SSE stream into normalized chunks. Each
 * `data:` line is an OpenAI chat-completion chunk (`choices[].delta`); `[DONE]`
 * and SSE comments (`:` keepalives) terminate/skip. Mirrors how `streamSandboxLeaf`
 * folds a box's event stream — same `UsageEvent` currency, different wire shape.
 */
async function* parseSseChatStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<BridgeStreamChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // SSE frames are separated by a blank line; split on it and keep the tail.
      let sep = buf.indexOf('\n\n')
      while (sep !== -1) {
        const frame = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        const chunk = parseSseFrame(frame)
        if (chunk === 'done') return
        if (chunk) yield chunk
        sep = buf.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Parse one SSE frame (possibly multi-line `data:`/comment) into a chunk, `'done'`,
 *  or undefined (comment/keepalive/empty). */
function parseSseFrame(frame: string): BridgeStreamChunk | 'done' | undefined {
  const dataLines: string[] = []
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith(':')) continue // comment / keepalive
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart())
  }
  if (dataLines.length === 0) return undefined
  const data = dataLines.join('\n')
  if (data === '[DONE]') return 'done'
  let parsed: {
    choices?: Array<{
      delta?: {
        content?: string | null
        tool_calls?: Array<{ function?: { name?: string } }>
      }
      message?: { content?: string | null }
    }>
    error?: { message?: string }
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
  }
  try {
    parsed = JSON.parse(data)
  } catch {
    return undefined
  }
  if (parsed.error) {
    throw new ValidationError(
      `bridgeExecutor: bridge stream error: ${parsed.error.message ?? 'unknown'}`,
    )
  }
  const out: BridgeStreamChunk = {}
  const choice = parsed.choices?.[0]
  const content = choice?.delta?.content ?? choice?.message?.content
  if (typeof content === 'string' && content.length > 0) out.content = content
  const toolName = choice?.delta?.tool_calls?.[0]?.function?.name
  if (typeof toolName === 'string' && toolName.length > 0) out.toolCall = toolName
  const u = parsed.usage
  if (u && (typeof u.prompt_tokens === 'number' || typeof u.completion_tokens === 'number')) {
    out.usage = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 }
  }
  if (typeof u?.cost === 'number') out.cost = u.cost
  return Object.keys(out).length > 0 ? out : undefined
}

// ── cli-worktree executor (authored profile → harness CLI on a git worktree) ────

/**
 * The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored
 * `AgentProfile` driving claude / codex / opencode on its own worktree. `budgetExempt` like
 * the other CLI leaves; the authored systemPrompt + model reach the harness via §1.5.
 */
export const cliWorktreeExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<CliWorktreeSeam>(ctx, cliWorktreeSeamKey, 'cli-worktree')
  if (!seam.repoRoot || !seam.harness || !seam.taskPrompt) {
    throw new ValidationError(
      'cliWorktreeExecutor: CliWorktreeSeam.repoRoot + harness + taskPrompt required',
    )
  }
  return createWorktreeCliExecutor({
    repoRoot: seam.repoRoot,
    profile: spec.profile,
    harness: seam.harness,
    taskPrompt: seam.taskPrompt,
    ...(seam.runId ? { runId: seam.runId } : {}),
    ...(seam.baseRef ? { baseRef: seam.baseRef } : {}),
    ...(seam.harnessTimeoutMs !== undefined ? { harnessTimeoutMs: seam.harnessTimeoutMs } : {}),
  }) as Executor<unknown>
}

// ── createExecutor: the ONE built-in factory (backend as data) ──────────────────

/**
 * Config for {@link createExecutor}: the backend is DATA — the cost dial a profile,
 * an experiment config, or a replay journal can name — not an import choice. Each
 * variant carries its backend's seam (router/router-tools/bridge/cli/cli-worktree/sandbox).
 */
export type ExecutorConfig =
  | ({ backend: 'router' } & RouterSeam)
  | ({ backend: 'router-tools' } & RouterToolsSeam)
  | ({ backend: 'bridge' } & BridgeSeam)
  | ({ backend: 'cli' } & CliSeam)
  | ({ backend: 'cli-worktree' } & CliWorktreeSeam)
  | ({ backend: 'sandbox'; harness?: BackendType } & SandboxSeam)

/**
 * The single built-in executor factory. Picks a leaf backend by data (`config.backend`),
 * injects the matching seam, and delegates to that backend's built-in implementation.
 * The `Executor` port stays OPEN: bring-your-own agents implement `Executor` directly
 * and never pass through here. Use this (or `createExecutorRegistry`) instead of a
 * per-vendor adapter or a closed `inline|sandbox|cli` switch — those bypass the
 * `UsageEvent` reporting channel.
 */
export function createExecutor(config: ExecutorConfig): ExecutorFactory<unknown> {
  return (spec, ctx) => {
    const { backend, ...seam } = config as ExecutorConfig & Record<string, unknown>
    const seamed: ExecutorContext = { ...ctx, seams: { ...ctx.seams, [backend]: seam } }
    switch (config.backend) {
      case 'router':
        return routerInlineExecutor(spec, seamed)
      case 'router-tools':
        return routerToolsInlineExecutor(spec, seamed)
      case 'bridge':
        return bridgeExecutor(spec, seamed)
      case 'cli':
        return cliExecutor(spec, seamed)
      case 'cli-worktree':
        return cliWorktreeExecutor(spec, seamed)
      case 'sandbox': {
        // The sandbox executor requires a concrete harness; a spec-level harness
        // wins, else the config names it (fail-loud inside if both are absent).
        const harness = spec.harness ?? config.harness ?? null
        return sandboxExecutor({ ...spec, harness }, seamed)
      }
    }
  }
}

// ── The open registry ──────────────────────────────────────────────────────────

/**
 * The open resolver/registry. Pre-registers the three built-ins under their
 * runtime tags (`'router'`, `'sandbox'`, `'cli'`) and accepts `register(name,
 * factory)` for any additional runtime — and a BYO `AgentSpec.executor` resolves
 * without touching the registry at all. NOT a closed switch; registration + BYO
 * ARE the extension points.
 *
 * `resolve` precedence (frozen in `ExecutorRegistry`): a BYO `spec.executor` →
 * `harness === null` → the `'router'` factory; else a registered factory for the
 * harness-derived runtime (`'sandbox'` for any `BackendType`); else fail loud.
 */
export function createExecutorRegistry(): ExecutorRegistry {
  const factories = new Map<Runtime, ExecutorFactory<unknown>>()
  factories.set('router', routerInlineExecutor)
  factories.set('inline', routerInlineExecutor)
  factories.set('sandbox', sandboxExecutor)
  factories.set('cli', cliExecutor)

  return {
    register<Out>(runtime: Runtime, factory: ExecutorFactory<Out>): void {
      if (factories.has(runtime)) {
        throw new ValidationError(`executor registry: runtime "${runtime}" already registered`)
      }
      factories.set(runtime, factory as ExecutorFactory<unknown>)
    },
    resolve<Out>(
      spec: AgentSpec,
    ): { succeeded: true; value: ExecutorFactory<Out> } | { succeeded: false; error: string } {
      // BYO: a caller-supplied executor wins, wrapped in a trivial per-spawn factory.
      if (spec.executor) {
        const byo = spec.executor
        return { succeeded: true, value: (() => byo) as ExecutorFactory<Out> }
      }
      // router/inline: an agent with no harness is a direct Router call.
      if (spec.harness === null) {
        const f = factories.get('router')
        if (!f) return { succeeded: false, error: 'executor registry: no "router" factory' }
        return { succeeded: true, value: f as ExecutorFactory<Out> }
      }
      // sandbox: any BackendType maps to the sandbox-composing-runLoop executor.
      const runtimeTag: Runtime = 'sandbox'
      const f = factories.get(runtimeTag)
      if (!f) {
        return {
          succeeded: false,
          error: `executor registry: no factory for runtime "${runtimeTag}" (harness "${spec.harness}") and no BYO executor`,
        }
      }
      return { succeeded: true, value: f as ExecutorFactory<Out> }
    },
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────────

/** Narrow a named seam off the `ExecutorContext`, failing loud when absent — no
 *  silent default for a required external-boundary seam. */
function readSeam<T>(ctx: ExecutorContext, key: string, who: string): T {
  const seam = ctx.seams[key]
  if (seam === undefined || seam === null) {
    throw new ValidationError(`${who} executor: missing required seam "${key}" on ExecutorContext`)
  }
  return seam as T
}

/** A leaf task is opaque (`unknown`). A string is the prompt verbatim; an object
 *  with a `prompt`/`content`/`task` string field uses it; otherwise it serializes. */
function taskToPrompt(task: unknown): string {
  if (typeof task === 'string') return task
  if (task && typeof task === 'object') {
    const obj = task as Record<string, unknown>
    for (const k of ['prompt', 'content', 'task', 'message']) {
      if (typeof obj[k] === 'string') return obj[k] as string
    }
  }
  return JSON.stringify(task)
}

/** Router messages from the opaque task + the profile's system prompt, when set. */
function taskToMessages(task: unknown, spec: AgentSpec): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []
  const system = spec.profile.prompt?.systemPrompt
  if (typeof system === 'string' && system.length > 0) {
    messages.push({ role: 'system', content: system })
  }
  messages.push({ role: 'user', content: taskToPrompt(task) })
  return messages
}

/** A driver that refines a single task up to `maxIterations` times then stops —
 *  the minimal policy that lets the sandbox executor run `runLoop` as one leaf. */
function singleShotDriver<Out>(maxIterations: number): Driver<unknown, Out, string> {
  return {
    name: 'leaf',
    plan(task, history): Promise<unknown[]> {
      return Promise.resolve(history.length >= maxIterations ? [] : [task])
    },
    decide(history: ReadonlyArray<Iteration<unknown, Out>>): string {
      return history.length >= maxIterations ? 'stop' : 'continue'
    },
  }
}

/** Link two abort signals into one that fires when either does. Returns
 *  `undefined` when neither is present so `fetch` gets no signal at all. */
function linkSignals(a: AbortSignal, b: AbortSignal): AbortSignal | undefined {
  if (a.aborted || b.aborted) {
    const c = new AbortController()
    c.abort()
    return c.signal
  }
  const c = new AbortController()
  const onAbort = () => c.abort()
  a.addEventListener('abort', onAbort, { once: true })
  b.addEventListener('abort', onAbort, { once: true })
  return c.signal
}

/** Combine N abort signals into one that fires when ANY does. Node-portable (no `AbortSignal.any`,
 *  which needs >=20.3 — the package floor is >=20). */
function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const c = new AbortController()
  const onAbort = () => c.abort()
  for (const s of signals) {
    if (s.aborted) {
      c.abort()
      break
    }
    s.addEventListener('abort', onAbort, { once: true })
  }
  return c.signal
}

// Re-export the verdict + spend surface so a consumer importing the runtime
// built-ins gets the budget vocabulary from one place.
export type { DefaultVerdict, Executor, ExecutorResult, Spend, UsageEvent }
