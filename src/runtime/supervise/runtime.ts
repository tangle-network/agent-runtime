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
import { estimateCost, isModelPriced } from '@tangle-network/agent-eval'
import type { BackendType, SandboxEvent } from '@tangle-network/sandbox'
import { ValidationError } from '../../errors'
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
 * cli-bridge seam. A local OpenAI-compatible bridge that fronts harness CLIs
 * (claude-code / opencode / kimi / pi) behind one HTTP surface; `model` doubles
 * as the harness selector (e.g. `claude-code/sonnet`, `opencode/<provider>/<model>`).
 * `agentProfile` is the bridge-dialect profile (metadata.disallowedTools, mcp)
 * forwarded verbatim per request — how an arm disables native tools or injects
 * a provider search MCP.
 */
export interface BridgeSeam {
  bridgeUrl: string
  bridgeBearer: string
  model: string
  agentProfile?: Record<string, unknown>
  timeoutMs?: number
}

const routerSeamKey = 'router'
const sandboxSeamKey = 'sandbox'
const cliSeamKey = 'cli'
const bridgeSeamKey = 'bridge'

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

  let artifact: ExecutorResult<unknown> | undefined

  return {
    runtime: 'router' as Runtime,
    async execute(task, signal): Promise<ExecutorResult<unknown>> {
      const started = Date.now()
      const linked = linkSignals(signal, controller.signal)
      const messages: Array<Record<string, unknown>> = [
        ...(taskToMessages(task, spec) as Array<Record<string, unknown>>),
      ]
      const tokens = zeroTokenUsage()
      let turns = 0
      let lastText = ''

      for (let t = 0; t < maxTurns; t += 1) {
        turns += 1
        const res = await fetch(`${seam.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
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
          ...(linked ? { signal: linked } : {}),
        })
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
        if (toolCalls.length === 0) break // the model answered — loop done

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
          const result = await seam.executeToolCall(tc?.function?.name ?? '', args, task)
          messages.push({ role: 'tool', tool_call_id: id, content: result })
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
 * One harness turn through the cli-bridge: a single OpenAI-compatible chat call
 * whose `model` selects the harness and whose `agent_profile` carries the arm
 * (native-tool disables, provider MCPs). One-shot like router/inline; reports
 * REAL usage when the bridge surfaces it, never a fabricated cost.
 */
export const bridgeExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<BridgeSeam>(ctx, bridgeSeamKey, 'bridge')
  if (!seam.bridgeUrl || !seam.bridgeBearer || !seam.model) {
    throw new ValidationError(
      'bridgeExecutor: BridgeSeam.bridgeUrl + bridgeBearer + model required',
    )
  }
  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  let artifact: ExecutorResult<unknown> | undefined

  return {
    runtime: 'cli' as Runtime,
    async execute(task, signal): Promise<ExecutorResult<unknown>> {
      const messages = taskToMessages(task, spec)
      const started = Date.now()
      const linked = linkSignals(signal, controller.signal)
      const timer = seam.timeoutMs
        ? setTimeout(() => controller.abort(), seam.timeoutMs)
        : undefined
      try {
        const res = await fetch(`${seam.bridgeUrl.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${seam.bridgeBearer}`,
          },
          body: JSON.stringify({
            model: seam.model,
            stream: false,
            ...(seam.agentProfile ? { agent_profile: seam.agentProfile } : {}),
            messages,
          }),
          ...(linked ? { signal: linked } : {}),
        })
        if (!res.ok) {
          throw new ValidationError(
            `bridgeExecutor: bridge ${res.status}: ${(await res.text()).slice(0, 300)}`,
          )
        }
        const data = (await res.json()) as {
          choices?: Array<{
            message?: { content?: string; tool_calls?: Array<{ function?: { name?: string } }> }
          }>
          usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
        }
        const u = data.usage
        const usage =
          u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
            ? { input: u.prompt_tokens, output: u.completion_tokens }
            : undefined
        const msg = data.choices?.[0]?.message
        const content = msg?.content ?? ''
        const toolCalls = (msg?.tool_calls ?? []).map((t) => t.function?.name ?? 'unknown')
        const spent: Spend = {
          iterations: 1,
          tokens: usage ? { input: usage.input, output: usage.output } : zeroTokenUsage(),
          usd: typeof u?.cost === 'number' ? u.cost : 0,
          ms: Date.now() - started,
        }
        const out = { content, toolCalls } as unknown
        artifact = { outRef: contentRef('bridge', { model: seam.model, content }), out, spent }
        return artifact
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
    teardown(_grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError('bridgeExecutor: resultArtifact() read before execute()')
      }
      return { ...artifact, spent: artifact.spent }
    },
  }
}

// ── createExecutor: the ONE built-in factory (backend as data) ──────────────────

/**
 * The single built-in executor entrypoint. The backend is DATA — the cost dial a
 * profile, an experiment config, or a replay journal can name — not an import
 * choice. Injects the matching seam and delegates to the built-in implementation;
 * the port stays OPEN: bring-your-own agents implement `Executor` directly and
 * never pass through here.
 */
export type ExecutorConfig =
  | ({ backend: 'router' } & RouterSeam)
  | ({ backend: 'router-tools' } & RouterToolsSeam)
  | ({ backend: 'bridge' } & BridgeSeam)
  | ({ backend: 'cli' } & CliSeam)
  | ({ backend: 'sandbox'; harness?: BackendType } & SandboxSeam)

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

// Re-export the verdict + spend surface so a consumer importing the runtime
// built-ins gets the budget vocabulary from one place.
export type { DefaultVerdict, Executor, ExecutorResult, Spend, UsageEvent }
