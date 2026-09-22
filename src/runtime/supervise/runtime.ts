/**
 *
 * The leaf runtime — the built-in `Executor` IMPLEMENTATIONS behind the ONE
 * open interface frozen in `./types`, plus the open resolver/registry that maps
 * an `AgentSpec` to one of them OR accepts a bring-your-own executor verbatim.
 *
 * The interface is the extension point, not a closed backend union:
 *   - router/inline : a direct OpenAI-compatible Router call, no environment (one-shot).
 *   - provider      : composes `runAgentRounds` over an `AgentEnvironmentProvider`.
 *   - cli           : a Halo/RLM subprocess; `budgetExempt` (no token accounting),
 *                     excluded from the equal-k arms by construction (streaming).
 * Every metered runtime reports through the SAME normalized `UsageEvent` channel
 * so the conserved budget pool meters them identically. A user's own agent is
 * first-class the moment it implements `Executor` — register it by name or
 * pass it as `AgentSpec.executor`.
 *
 * Layering: `estimateCost`/`isModelPriced` are substrate primitives from
 * `@tangle-network/agent-eval`; `runAgentRounds` is a runtime kernel from this
 * package. Provider-specific adapters live in their provider packages.
 *
 * @experimental
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { estimateCost, isModelPriced } from '@tangle-network/agent-eval'
import type {
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../../errors'
import type { LocalHarness } from '../../mcp/local-harness'
import {
  captureWorktreeDiff,
  createWorktree,
  type GitRunner,
  removeWorktree,
  type WorktreeHandle,
} from '../../mcp/worktree'
import {
  runWorktreeChecks,
  type WorktreeCheckRunner,
  type WorktreeHarnessResult,
} from '../../mcp/worktree-harness'
import { extractEnvironmentTurnText, extractLlmCallEvent } from '../environment-events'
import {
  type AgentEnvironmentProviderRegistry,
  resolveAgentEnvironmentProvider,
} from '../environment-provider'
import { routerChatWithUsage, type ToolSpec } from '../router-client'
import type { RunAgentRoundsOptions } from '../run-loop'
import { runAgentRounds } from '../run-loop'
import type {
  AgentRunSpec,
  Driver,
  ExecCtx,
  Iteration,
  LoopLineageOptions,
  OutputAdapter,
} from '../types'
import { zeroTokenUsage } from '../util'
import {
  createSteerableEnvironmentSession,
  type EnvironmentSteeringOptions,
} from './environment-session'
import { createInbox } from './inbox'
import { PI_RUNTIME, piExecutor } from './pi-executor'
import type { ExecutorProgress } from './progress'
import type { TraceSource } from './trace-source'
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
 * the cheapest leaf, no environment, no tools. `model` overrides the profile's model
 * hint when present; otherwise the profile's `model.default` is required.
 */
export interface RouterSeam {
  routerBaseUrl: string
  routerKey: string
  model?: string
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

interface WorktreeCommon {
  repoRoot: string
  taskPrompt: string
  runId?: string
  baseRef?: string
  testCmd?: string
  typecheckCmd?: string
  checkTimeoutMs?: number
  checkOutputCap?: number
  /** Test seam — forwarded to worktree helpers. */
  runGit?: GitRunner
  /** Test seam — forwarded to verification checks. */
  runCommand?: WorktreeCheckRunner
}

/** Provider-backed worker configuration used by supervision and delegation. */
export interface EnvironmentWorkerOptions {
  provider: AgentEnvironmentProvider | string
  registry?: AgentEnvironmentProviderRegistry
  /** Provider-neutral creation fields, including the provider's agent backend. */
  environment?: Omit<CreateAgentEnvironmentInput, 'profile' | 'signal'>
  /** Forwarded into the composed `runAgentRounds` context. */
  loopCtx?: Partial<Omit<ExecCtx, 'environmentProvider' | 'signal'>>
  lineage?: LoopLineageOptions
  /** Leaf iteration cap. Default 1. */
  maxIterations?: number
  /** Multi-turn steering over one provider session. */
  steering?: EnvironmentSteeringOptions
  /** Runtime label. Defaults to the provider name. */
  runtime?: Runtime
}

/** Output returned by a provider-backed supervised worker. */
export interface EnvironmentWorkerResult {
  content: string
  events?: readonly AgentEnvironmentEvent[]
  turns?: number
  toolCalls?: readonly string[]
}

interface LocalWorktreeExecution {
  /** Local coding CLI to run in the worktree. */
  harness: LocalHarness
  provider?: never
  harnessTimeoutMs?: number
  /** Isolated, network-off Codex execution with terminal JSONL usage capture. */
  codexReproducible?: boolean
  /** Absolute host paths denied to reproducible Codex. */
  codexReadDeniedPaths?: ReadonlyArray<string>
  budgetExempt?: boolean
}

/**
 * Worktree execution through any environment provider.
 * The runtime injects the new worktree path as `environment.workspace.cwd`.
 */
interface ProviderWorktreeExecution extends EnvironmentWorkerOptions {
  harness?: never
  harnessTimeoutMs?: never
  codexReproducible?: never
  codexReadDeniedPaths?: never
  budgetExempt?: never
}

/**
 * Run an authored profile in an isolated git worktree.
 * Choose either a local `harness` or an `AgentEnvironmentProvider`.
 */
export type WorktreeSeam = WorktreeCommon & (LocalWorktreeExecution | ProviderWorktreeExecution)

const routerSeamKey = 'router'
const cliSeamKey = 'cli'
const worktreeSeamKey = 'worktree'

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
        ...(r.costUsd === undefined ? { usdKnown: false } : {}),
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
 * a tool or `maxTurns` is hit. It runs on this host and is unaffected by a
 * remote environment's network policy. One turn = one completion = the
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
    // Real per-call wall-clock — the owned-loop executor always supplies these. Optional so an
    // external `RouterToolsSeam` that omits timing still satisfies the type (the span then collapses
    // to order + counts, per `toToolSpan`), keeping this an additive, non-breaking field set.
    startedAt?: number
    endedAt?: number
    durationMs?: number
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
      let usageComplete = true
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
        } else {
          usageComplete = false
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

      const costKnown = usageComplete && isModelPriced(model)
      const usd = costKnown ? estimateCost(tokens.input, tokens.output, model) : 0
      const spent: Spend = {
        iterations: turns,
        tokens,
        usd,
        ...(costKnown ? {} : { usdKnown: false }),
        ms: Date.now() - started,
      }
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

// ── environment provider executor ─────────────────────────────────────────────

/** Build a supervise leaf on the shared environment provider contract. */
export function environmentExecutor(
  provider: AgentEnvironmentProvider,
  seam: EnvironmentWorkerOptions,
): ExecutorFactory<unknown> {
  return (spec, ctx) => {
    const maxIterations = seam.maxIterations ?? 1
    if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
      throw new ValidationError('environmentExecutor: maxIterations must be > 0')
    }

    const controller = new AbortController()
    const abortIfSignalled = () => {
      if (ctx.signal.aborted) controller.abort()
    }
    abortIfSignalled()
    if (!ctx.signal.aborted) {
      ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })
    }
    const releaseContextAbort = () => {
      ctx.signal.removeEventListener('abort', abortIfSignalled)
    }

    const backend = seam.environment?.backend ?? spec.harness ?? undefined
    let artifact: ExecutorResult<unknown> | undefined

    if (seam.steering) {
      const inbox = createInbox()
      const session = createSteerableEnvironmentSession({
        controller,
        profile: spec.profile,
        ...(backend ? { backend } : {}),
        provider,
        ...(seam.environment ? { environment: seam.environment } : {}),
        inbox,
        taskToPrompt,
        options: seam.steering,
        ...(seam.loopCtx ? { loopCtx: seam.loopCtx } : {}),
        contentRef,
      })
      return {
        runtime: seam.runtime ?? provider.name,
        deliver: (message) => inbox.deliver(message),
        progress: (): ExecutorProgress => session.progress(),
        traceSource: (): TraceSource => session.traceSource(),
        async execute(task, signal): Promise<ExecutorResult<unknown>> {
          try {
            for await (const _event of session.stream(task, signal)) {
              // The terminal Spend preserves whether dollar cost was reported.
            }
            const result = session.artifact()
            if (!result) {
              throw new ValidationError(
                'environmentExecutor(steering): artifact missing after session settled',
              )
            }
            return result
          } finally {
            releaseContextAbort()
          }
        },
        async teardown(_grace): Promise<{ destroyed: boolean }> {
          releaseContextAbort()
          controller.abort()
          await session.teardown()
          return { destroyed: true }
        },
        resultArtifact() {
          const result = session.artifact()
          if (!result) {
            throw new ValidationError(
              'environmentExecutor(steering): resultArtifact() read before stream drained',
            )
          }
          return result
        },
      }
    }

    const output: OutputAdapter<EnvironmentWorkerResult> = {
      parse(events: AgentEnvironmentEvent[]): EnvironmentWorkerResult {
        return { content: extractEnvironmentTurnText(events), events }
      },
    }
    const driver = singleShotDriver<EnvironmentWorkerResult>(maxIterations)

    return {
      runtime: seam.runtime ?? provider.name,
      async execute(task, signal): Promise<ExecutorResult<unknown>> {
        try {
          for await (const _event of streamEnvironmentLeaf({
            task,
            signal,
            ...(backend ? { backend } : {}),
            provider,
            spec,
            seam,
            output,
            driver,
            maxIterations,
            controller,
            loopCtx: seam.loopCtx,
            onArtifact: (next) => {
              artifact = next
            },
          })) {
            // The terminal Spend preserves whether dollar cost was reported.
          }
          if (!artifact) {
            throw new ValidationError('environmentExecutor: artifact missing after run settled')
          }
          return artifact
        } finally {
          releaseContextAbort()
        }
      },
      teardown(_grace): Promise<{ destroyed: boolean }> {
        releaseContextAbort()
        controller.abort()
        return Promise.resolve({ destroyed: true })
      },
      resultArtifact() {
        if (!artifact) {
          throw new ValidationError(
            'environmentExecutor: resultArtifact() read before stream drained',
          )
        }
        return artifact
      },
    }
  }
}

interface StreamEnvironmentArgs {
  task: unknown
  signal: AbortSignal
  backend?: string
  provider: AgentEnvironmentProvider
  spec: AgentSpec
  seam: EnvironmentWorkerOptions
  output: OutputAdapter<EnvironmentWorkerResult>
  driver: Driver<unknown, EnvironmentWorkerResult, string>
  maxIterations: number
  controller: AbortController
  loopCtx?: Partial<Omit<ExecCtx, 'environmentProvider' | 'signal'>>
  onArtifact: (artifact: ExecutorResult<unknown>) => void
}

async function* streamEnvironmentLeaf(args: StreamEnvironmentArgs): AsyncIterable<UsageEvent> {
  const linked = new AbortController()
  const cascade = () => linked.abort()
  if (args.signal.aborted || args.controller.signal.aborted) {
    linked.abort()
  } else {
    args.signal.addEventListener('abort', cascade, { once: true })
    args.controller.signal.addEventListener('abort', cascade, { once: true })
  }

  const agentRun: AgentRunSpec<unknown> = {
    profile: args.spec.profile,
    taskToPrompt,
    name: args.spec.profile.name ?? args.backend ?? args.provider.name,
    environment: {
      ...(args.seam.environment ?? {}),
      ...(args.backend ? { backend: args.backend } : {}),
    },
  }
  const started = Date.now()
  const loopOptions: RunAgentRoundsOptions<unknown, EnvironmentWorkerResult, string> = {
    driver: args.driver,
    agentRun,
    output: args.output,
    task: args.task,
    maxIterations: args.maxIterations,
    maxConcurrency: 1,
    ctx: {
      ...(args.loopCtx ?? {}),
      environmentProvider: args.provider,
      signal: linked.signal,
    },
    ...(args.seam.lineage ? { lineage: args.seam.lineage } : {}),
  }

  try {
    const result = await runAgentRounds(loopOptions)
    const out = result.winner?.output ?? { content: '', events: [] }
    const verdict = result.winner?.verdict
    const spent: Spend = {
      iterations: result.iterations.length,
      tokens: { input: result.tokenUsage.input, output: result.tokenUsage.output },
      usd: result.costUsd,
      ...(environmentCostKnown(result.iterations) ? {} : { usdKnown: false }),
      ms: Date.now() - started,
    }
    args.onArtifact({
      outRef: contentRef(`environment:${args.provider.name}`, {
        ...(args.backend ? { backend: args.backend } : {}),
        out,
      }),
      out,
      ...(verdict ? { verdict } : {}),
      spent,
    })
    for (let index = 0; index < result.iterations.length; index += 1) {
      yield { kind: 'iteration' }
    }
    if (result.tokenUsage.input || result.tokenUsage.output) {
      yield {
        kind: 'tokens',
        input: result.tokenUsage.input,
        output: result.tokenUsage.output,
      }
    }
    if (result.costUsd) yield { kind: 'cost', usd: result.costUsd }
  } finally {
    args.signal.removeEventListener('abort', cascade)
    args.controller.signal.removeEventListener('abort', cascade)
  }
}

function environmentCostKnown(
  iterations: ReadonlyArray<{
    readonly agentRunName: string
    readonly events: readonly AgentEnvironmentEvent[]
  }>,
): boolean {
  if (iterations.length === 0) return true
  let sawLlmCall = false
  for (const iteration of iterations) {
    for (const event of iteration.events) {
      const call = extractLlmCallEvent(event, iteration.agentRunName)
      if (!call) continue
      sawLlmCall = true
      if (call.costUsd === undefined) return false
    }
  }
  return sawLlmCall
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

// ── provider-backed worktree executor ───────────────────────────────────────────

function providerWorktreeExecutor(
  spec: AgentSpec,
  ctx: ExecutorContext,
  seam: WorktreeCommon & ProviderWorktreeExecution,
): Executor<WorktreeHarnessResult> {
  const provider = resolveAgentEnvironmentProvider(seam.provider, seam.registry)
  const runId = seam.runId ?? randomUUID()
  const controller = new AbortController()
  const pending: unknown[] = []
  let inner: Executor<unknown> | undefined
  let worktree: WorktreeHandle | undefined
  let removed = false
  let artifact: ExecutorResult<WorktreeHarnessResult> | undefined

  const cleanupWorktree = async (): Promise<void> => {
    if (!worktree || removed) return
    const target = worktree
    removed = true
    worktree = undefined
    await removeWorktree({
      worktree: target,
      repoRoot: seam.repoRoot,
      ...(seam.runGit ? { runGit: seam.runGit } : {}),
    }).catch(() => undefined)
  }

  const deliver = (message: unknown): void => {
    if (inner?.deliver) {
      inner.deliver(message)
      return
    }
    pending.push(message)
  }

  return {
    runtime: seam.runtime ?? provider.name,
    ...(seam.steering ? { deliver } : {}),
    async execute(_task, signal): Promise<ExecutorResult<WorktreeHarnessResult>> {
      const started = Date.now()
      const linked = mergeAbortSignals(signal, controller.signal)

      try {
        worktree = await createWorktree({
          repoRoot: seam.repoRoot,
          runId,
          ...(seam.baseRef ? { baseRef: seam.baseRef } : {}),
          ...(seam.runGit ? { runGit: seam.runGit } : {}),
        })
        removed = false

        const environment: NonNullable<EnvironmentWorkerOptions['environment']> = {
          ...(seam.environment ?? {}),
          idempotencyKey: seam.environment?.idempotencyKey ?? `worktree-${runId}`,
          workspace: {
            ...(seam.environment?.workspace ?? {}),
            cwd: worktree.path,
          },
        }
        const providerSeam: EnvironmentWorkerOptions = {
          provider,
          environment,
          ...(seam.loopCtx ? { loopCtx: seam.loopCtx } : {}),
          ...(seam.lineage ? { lineage: seam.lineage } : {}),
          ...(seam.maxIterations !== undefined ? { maxIterations: seam.maxIterations } : {}),
          ...(seam.steering ? { steering: seam.steering } : {}),
          ...(seam.runtime ? { runtime: seam.runtime } : {}),
        }
        inner = environmentExecutor(provider, providerSeam)(spec, {
          ...ctx,
          signal: linked,
        })
        if (pending.length > 0 && !inner.deliver) {
          throw new ValidationError(
            'worktreeExecutor: delivered messages require provider steering',
          )
        }
        for (const message of pending.splice(0)) inner.deliver?.(message)

        const environmentArtifact = await settleExecutorRun(
          inner.execute(seam.taskPrompt, linked),
          inner,
        )
        const diff = await captureWorktreeDiff({
          worktree,
          ...(seam.runGit ? { runGit: seam.runGit } : {}),
        })
        const checks = await runWorktreeChecks({
          worktreePath: worktree.path,
          ...(seam.testCmd !== undefined ? { testCmd: seam.testCmd } : {}),
          ...(seam.typecheckCmd !== undefined ? { typecheckCmd: seam.typecheckCmd } : {}),
          timeoutMs: seam.checkTimeoutMs ?? seam.steering?.turnTimeoutMs ?? 5 * 60 * 1000,
          cap: seam.checkOutputCap ?? 16_000,
          ...(seam.runCommand ? { runCommand: seam.runCommand } : {}),
          signal: linked,
        })

        const result: WorktreeHarnessResult = {
          branch: worktree.branch,
          patch: diff.patch,
          stats: diff.stats,
          harness: {
            name: inner.runtime,
            exitCode: null,
            timedOut: false,
            killedBySignal: null,
            durationMs: environmentArtifact.spent.ms || Date.now() - started,
            stdout: environmentOutputText(environmentArtifact.out),
            stderr: '',
          },
          ...(checks ? { checks } : {}),
        }
        const spent: Spend = {
          ...environmentArtifact.spent,
          ms: environmentArtifact.spent.ms || Date.now() - started,
        }
        artifact = {
          outRef: contentRef('provider-worktree', {
            provider: provider.name,
            runId,
            result,
          }),
          out: result,
          spent,
        }
        return artifact
      } catch (error) {
        controller.abort()
        await inner?.teardown('brutalKill').catch(() => undefined)
        await cleanupWorktree()
        throw error
      }
    },
    async teardown(grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      let destroyed = true
      try {
        if (inner) destroyed = (await inner.teardown(grace)).destroyed
      } finally {
        await cleanupWorktree()
      }
      return { destroyed }
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError(
          'worktreeExecutor: resultArtifact() read before execute() resolved',
        )
      }
      return artifact
    },
  }
}

async function settleExecutorRun(
  run: Promise<ExecutorResult<unknown>> | AsyncIterable<UsageEvent>,
  executor: Executor<unknown>,
): Promise<ExecutorResult<unknown>> {
  if (!isAsyncIterable<UsageEvent>(run)) return run
  for await (const _event of run) {
    // Drain streamed usage before reading the terminal artifact.
  }
  return executor.resultArtifact()
}

function environmentOutputText(out: unknown): string {
  if (typeof out === 'string') return out
  if (out && typeof out === 'object') {
    const record = out as { content?: unknown; events?: AgentEnvironmentEvent[] }
    if (typeof record.content === 'string') return record.content
    for (const event of [...(record.events ?? [])].reverse()) {
      for (const key of ['finalText', 'text', 'content'] as const) {
        const value = event.data[key]
        if (typeof value === 'string' && value.length > 0) return value
      }
    }
  }
  try {
    return JSON.stringify(out) ?? String(out)
  } catch {
    return String(out)
  }
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  )
}

// ── worktree executor ──────────────────────────────────────────────────────────

/**
 * Run an authored profile in a fresh git worktree through either a local CLI or
 * any registered environment provider.
 */
export const worktreeExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<WorktreeSeam>(ctx, worktreeSeamKey, 'worktree')
  if (!seam.repoRoot || !seam.taskPrompt) {
    throw new ValidationError('worktreeExecutor: WorktreeSeam.repoRoot + taskPrompt required')
  }
  if ('provider' in seam && seam.provider !== undefined) {
    return providerWorktreeExecutor(spec, ctx, seam as WorktreeCommon & ProviderWorktreeExecution)
  }
  const local = seam as WorktreeCommon & LocalWorktreeExecution
  if (!local.harness) {
    throw new ValidationError('worktreeExecutor: exactly one of harness or provider is required')
  }
  return createWorktreeCliExecutor({
    repoRoot: local.repoRoot,
    profile: spec.profile,
    harness: local.harness,
    taskPrompt: local.taskPrompt,
    ...(local.runId ? { runId: local.runId } : {}),
    ...(local.baseRef ? { baseRef: local.baseRef } : {}),
    ...(local.harnessTimeoutMs !== undefined ? { harnessTimeoutMs: local.harnessTimeoutMs } : {}),
    ...(local.codexReproducible ? { codexReproducible: true } : {}),
    ...(local.codexReadDeniedPaths ? { codexReadDeniedPaths: local.codexReadDeniedPaths } : {}),
    ...(local.testCmd !== undefined ? { testCmd: local.testCmd } : {}),
    ...(local.typecheckCmd !== undefined ? { typecheckCmd: local.typecheckCmd } : {}),
    ...(local.checkTimeoutMs !== undefined ? { checkTimeoutMs: local.checkTimeoutMs } : {}),
    ...(local.checkOutputCap !== undefined ? { checkOutputCap: local.checkOutputCap } : {}),
    ...(local.runGit ? { runGit: local.runGit } : {}),
    ...(local.runCommand ? { runCommand: local.runCommand } : {}),
    ...(local.budgetExempt !== undefined ? { budgetExempt: local.budgetExempt } : {}),
  }) as Executor<unknown>
}

// ── The open registry ──────────────────────────────────────────────────────────

/**
 * The open resolver/registry. Pre-registers the three built-ins under their
 * runtime tags (`'router'`, `'cli'`) and accepts `register(name,
 * factory)` for any additional runtime — and a BYO `AgentSpec.executor` resolves
 * without touching the registry at all. NOT a closed switch; registration + BYO
 * ARE the extension points.
 *
 * `resolve` precedence (frozen in `ExecutorRegistry`): a BYO `spec.executor` →
 * `harness === null` → the `'router'` factory; else a registered factory for the
 * exact harness name; else fail loud.
 */
export function createExecutorRegistry(): ExecutorRegistry {
  const factories = new Map<Runtime, ExecutorFactory<unknown>>()
  factories.set('router', routerInlineExecutor)
  factories.set('inline', routerInlineExecutor)
  factories.set('cli', cliExecutor)
  // pi is wrapped, not forked: `piExecutor` speaks pi's own out-of-process RPC protocol, so its
  // steering queue / session persistence / abort stay upstream's. Registered here through the
  // documented extension point so a spec can select it by `AgentSpec.executor` or by name.
  factories.set(PI_RUNTIME, piExecutor)

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
      const runtimeTag: Runtime = spec.harness
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

/** A driver that refines a single task up to `maxIterations` times then stops. */
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
