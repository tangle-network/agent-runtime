/**
 *
 * The leaf runtime — the built-in `Executor` IMPLEMENTATIONS behind the ONE
 * open interface frozen in `./types`, plus the open resolver/registry that maps
 * an `AgentSpec` to one of them OR accepts a bring-your-own executor verbatim.
 *
 * The interface is the extension point, not a closed `inline|sandbox|cli` union:
 *   - router/inline : a direct OpenAI-compatible Router call, no box (one-shot).
 *   - sandbox       : COMPOSES the existing `runAgentRounds` kernel as a single-task
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
 * `@tangle-network/agent-eval`; `runAgentRounds`/`acquireSandbox` are runtime kernels
 * from this package. No per-vendor adapters live here.
 *
 * @experimental
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { estimateCost, isModelPriced } from '@tangle-network/agent-eval'
import {
  type AgentProfile,
  type AgentProfileResourceRef,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  profileMaterializationAxes,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from '@tangle-network/agent-interface'
import type { BackendType, SandboxEvent } from '@tangle-network/sandbox'
import {
  assertProfileMaterialization,
  defineProfileMaterializationContract,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import { mergeTraceEnv } from '../../mcp/trace-propagation'
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
import {
  type AgentEnvironmentProvider,
  type AgentEnvironmentProviderRegistry,
  type ProviderExecutorOptions,
  providerAsExecutor,
  providerAsSandboxClient,
  resolveAgentEnvironmentProvider,
} from '../environment-provider'
import { agentHarness } from '../harness-role'
import {
  type PromptCacheUsage,
  type RouterChatResult,
  type RouterChatToolsResult,
  type RouterConfig,
  routerChatWithTools,
  routerChatWithUsage,
  streamRouterChatWithTools,
  type ToolSpec,
} from '../router-client'
import type { RunAgentRoundsOptions } from '../run-loop'
import { runAgentRounds } from '../run-loop'
import type {
  AgentRunSpec,
  Driver,
  ExecCtx,
  Iteration,
  OutputAdapter,
  SandboxClient,
} from '../types'
import { zeroTokenUsage } from '../util'
import { executableAgentProfileSnapshot, executableAgentSpecSnapshot } from './executable-spec'
import { createInbox, type Inbox } from './inbox'
import {
  attestRuntimeOwnedExecutor,
  attestRuntimeOwnedPendingExecutor,
  finalizeRuntimeOwnedPendingExecutor,
  newExecutionAttemptId,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
} from './materialization'
import {
  assertExecutableAgentProfile,
  concreteProfileModel,
  type ProfileModelExecutionSettings,
  profileBridgeWireModel,
  profileModelExecutionSettings,
} from './model-policy'
import {
  type ActivityLog,
  createActivityLog,
  describeToolArgs,
  type ExecutorProgress,
} from './progress'
import { createSteerableSandboxSession, type SandboxSteeringOptions } from './sandbox-session'
import { detachedSnapshot } from './snapshot'
import {
  createPushTraceSource,
  decodeOpenAiPart,
  type ToolStepInput,
  type TraceSource,
} from './trace-source'
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
import { workerTraceEnv } from './worker-trace'
import { createWorktreeCliExecutor } from './worktree-cli-executor'

// ── Seam contracts (read off ExecutorContext.seams, narrowed per built-in) ─────

/**
 * Router/inline transport seam. The profile owns model, prompt, and generation behavior.
 */
export interface RouterSeam {
  routerBaseUrl: string
  routerKey: string
  /** Injectable transport for offline/local execution; still passes through Runtime metering. */
  complete?: RouterConfig['complete']
  /** When present, return one turn's requested tool calls without executing them. */
  tools?: ReadonlyArray<ToolSpec>
}

const routerTurnProfileMaterialization = defineProfileMaterializationContract({
  name: 'router-profile-turn',
  axes: [
    'name',
    'description',
    'version',
    'tags',
    'systemPrompt',
    'instructions',
    'modelDefault',
    'modelProvider',
    'modelReasoningEffort',
    'modelMetadata',
    'harness',
    'tools',
    'files',
    'resourceTools',
    'skills',
    'resourceAgents',
    'commands',
    'resourceInstructions',
    'metadata',
  ],
})

/**
 * Sandbox executor seam. The `sandboxClient` the composed `runAgentRounds` creates
 * boxes through, plus the optional trace/run/lineage wiring forwarded into the
 * loop. `lineage` is opaque here (PR #150's `RunAgentRoundsOptions.lineage`): forwarded
 * forward-compatibly, never inspected — this executor does NOT reinvent
 * checkpoint/fork.
 */
export interface SandboxSeam {
  sandboxClient: SandboxClient
  /** Forwarded into the composed `runAgentRounds`'s `ctx` (trace emitter, run handle, etc.). */
  loopCtx?: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>
  /** PR #150 `RunAgentRoundsOptions.lineage` passthrough — opaque; forwarded, not parsed. */
  lineage?: unknown
  /** Hard cap on the composed loop's iterations. The budget pool reserves against
   *  the spawn `Budget.maxIterations`; this is the leaf's own ceiling. Default 1. */
  maxIterations?: number
  /**
   * OPT-IN: run this worker as a multi-turn, STEERABLE session instead of the historical
   * single-shot `runAgentRounds` composition. Setting it gives the sandbox worker an `Executor.deliver`
   * inbox (so `Scope.send` / `steer_agent` actually reach it), a live tool-activity trace, and a
   * `progress()` read — turning the default cloud worker from something a supervisor can only
   * wait on into something it can watch and correct.
   *
   * Absent, nothing changes: the same `runAgentRounds` leaf, no inbox, `steer_agent` still reports
   * `delivered:false`. Opt-in because a steerable worker holds ONE box across several turns,
   * which is a different resource profile from a fire-and-forget shot.
   */
  steering?: SandboxSteeringOptions
}

/**
 * UNMETERED CLI subprocess seam. `bin` + `args` describe the process to spawn.
 *
 * READ THIS BEFORE CHOOSING `backend: 'cli'`. This backend pipes a prompt to a subprocess's stdin
 * and reads its stdout. It has no usage receipt of any kind, so it reports its spend with
 * `Spend.tokensKnown: false`: the work is recorded, its `{0,0}` tokens and `$0` are a FLOOR rather
 * than a measurement, and a ceiling priced from either is a ceiling that cannot fire. The executor
 * is also `budgetExempt: true`, which is why `driveHarnessFromBackend` refuses it outright rather
 * than pretending to budget it.
 *
 * If you need a metered harness worker, use `backend: 'bridge'` (a cli-bridge session, which
 * reports the harness's real per-turn tokens and cost) or `backend: 'cli-worktree'` with
 * `codexReproducible`. Reach for this seam only when the subprocess genuinely is not an inference
 * agent, or when you have accepted that its cost is invisible.
 *
 * `args` is argv for a LOCAL, in-process spawn under this process's own privileges. It is not a
 * remote channel and nothing forwards it over a wire.
 */
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
 * named as data. `repoRoot` is transport data; `AgentProfile.harness` selects the CLI.
 * `taskPrompt` remains an optional direct-call fallback for callers that execute with `undefined`.
 * The authored
 * `profile.prompt.systemPrompt` + `profile.model.default` reach the harness via the §1.5
 * `harnessInvocation` mapper. Everything else mirrors `WorktreeCliExecutorOptions`.
 */
export interface CliWorktreeSeam {
  repoRoot: string
  taskPrompt?: string
  runId?: string
  baseRef?: string
  harnessTimeoutMs?: number
  /** Isolated, network-off Codex execution with terminal JSONL usage capture. */
  codexReproducible?: boolean
  /** Absolute host paths denied to reproducible Codex. */
  codexReadDeniedPaths?: ReadonlyArray<string>
  testCmd?: string
  typecheckCmd?: string
  checkTimeoutMs?: number
  checkOutputCap?: number
  budgetExempt?: boolean
  /** Live cli-bridge transport inside the worktree. When set, the worktree leaf accepts
   *  `deliver()` messages and resumes the same bridge session in this worktree cwd. */
  bridge?: CliWorktreeBridgeSeam
  /** Test seam — forwarded to worktree helpers. */
  runGit?: GitRunner
  /** Test seam — forwarded to verification checks. */
  runCommand?: WorktreeCheckRunner
}

export interface CliWorktreeBridgeSeam {
  bridgeUrl: string
  bridgeBearer: string
  /** Caller-owned deadline for each bridge turn. Runtime enforces it locally and sends the
   *  same value in `execution.timeoutMs` so cli-bridge cannot substitute its own cutoff. */
  timeoutMs?: number
  /** Stable cli-bridge session id. Defaults to `bridge-worktree-${runId}`. */
  sessionId?: string
  /** Transport reconnects allowed after the first POST. Default 3; set 0 to disable. */
  maxReconnects?: number
}

/**
 * cli-bridge seam. A local OpenAI-compatible bridge that fronts harness CLIs
 * (claude-code / opencode / kimi / pi) behind one HTTP surface. The spawned
 * `AgentProfile` is the sole harness/provider/model and behavioral authority and
 * is forwarded verbatim per request; this seam carries transport data only.
 *
 * The executor opens a resumable cli-bridge session. `sessionId` identifies the
 * harness conversation across turns; each turn also receives its own durable run id.
 * A dropped HTTP reader reattaches to that exact run and explicit cancel is the only
 * operation allowed to stop it. Omit `sessionId` and the executor mints one per spawn.
 *
 * ── HOW TO CONTROL WHAT THE HARNESS LOADS (there is no argv field, by design) ──
 *
 * A worker often needs the harness started in a KNOWN state — no ambient extensions, skills,
 * context files, or prompt templates — because ambient state is how a paired experiment silently
 * loses its pairing: an installed extension that persists memory across runs carries arm A's state
 * into arm B, and nothing reports it.
 *
 * That is what the spawned `AgentProfile` is FOR. `agent_profile`
 * rides every request verbatim, and cli-bridge maps it onto each harness's own native controls:
 *
 *   - Materializing any profile at all already starts the harness isolated from ambient
 *     workspace state — for pi that is `--no-context-files --no-skills --no-prompt-templates`,
 *     applied to every request that carries an `agent_profile`.
 *   - `AgentProfile.extensions.<harness>` is the named, per-harness control channel. An explicit
 *     `extensions: { pi: { load: [] } }` disables ambient extension discovery outright
 *     (pi's `--no-extensions`); listing package names loads exactly those and nothing else.
 *   - `permissions` / `tools` / `mcp` map onto the harness's native tool and server controls.
 *
 * A caller therefore does NOT need to hand-roll an `Executor` to isolate a harness run, and the
 * profile expressing it stays portable: the same declaration means the same thing on a different
 * harness, whereas an argv string means nothing anywhere else.
 *
 * WHY NOT A GENERAL ARGV PASSTHROUGH. `bridgeUrl` addresses a process-spawning server. Forwarding
 * an arbitrary argv array to it would let any caller holding a bearer token choose the flags of a
 * process on the bridge host — which for real harness CLIs includes flags that load code from a
 * path, read a file into the prompt, redirect the working directory, or turn off the isolation the
 * bridge applies. cli-bridge deliberately confines workers (a filesystem jail and deny-by-default
 * network egress), and every one of those confinements is expressed as spawn configuration, so an
 * argv channel is a channel for unwinding them. It would also break this executor's own contract:
 * the durable-run replay protocol, session pinning, and streaming mode are all argv the bridge
 * owns, and a caller-supplied duplicate silently wins or corrupts the parse. The structured profile
 * channel is validated, per-harness, portable, and refuses controls it does not understand — keep
 * new harness capability there.
 */
export interface BridgeSeam {
  bridgeUrl: string
  bridgeBearer: string
  /** Optional working directory forwarded to cli-bridge and persisted with the session. */
  cwd?: string
  /** Caller-owned deadline for each bridge turn. Runtime enforces it locally and sends the
   *  same value in `execution.timeoutMs` so the bridge-owned process follows the same policy. */
  timeoutMs?: number
  /** Stable, caller-owned cli-bridge session id for harness-side resume. Defaults
   *  to a freshly minted per-spawn id so each worker is its own resumable session. */
  sessionId?: string
  /** Transport reconnects allowed after the first POST. Default 3; set 0 to disable. */
  maxReconnects?: number
  /** Newest-last activity window `progress()` reports. Default 12 (matches `PiSeam`). */
  activityWindow?: number
}

/** Generic environment provider executor config. External packages implement
 *  `AgentEnvironmentProvider`; this built-in wrapper lets `createExecutor`
 *  consume them as backend data while preserving the existing usage channel. */
export interface ProviderSeam extends ProviderExecutorOptions {
  provider: AgentEnvironmentProvider | string
  registry?: AgentEnvironmentProviderRegistry
  /**
   * Compose the provider through the existing steerable sandbox session.
   * The exact profile must name its harness, and the provider must expose live
   * continuation plus session controls. The provider still owns environment
   * creation and session semantics.
   */
  steering?: SandboxSteeringOptions
}

const routerSeamKey = 'router'
const sandboxSeamKey = 'sandbox'
const cliSeamKey = 'cli'
const bridgeSeamKey = 'bridge'
const maxBridgeTimeoutMs = 2_147_483_647
const bridgeProfileMaterializationSchema = 'cli-bridge.profile-materialization.v2'
const bridgeUsageCostSchema = 'cli-bridge.usage-cost.v1'
const cliWorktreeSeamKey = 'cli-worktree'
const providerSeamKey = 'provider'

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

/**
 * The spend of work that HAPPENED and reported no usage receipt.
 *
 * Not the same value as a plain zero even though both carry `{0,0}` tokens and `$0`. A bare zero
 * asserts a MEASUREMENT — "this ran and cost nothing" — and every consumer downstream reads it that
 * way: the pool keeps reporting `readout().tokensKnown === true`, the journal totals stay clean, the
 * OTEL span records a priced zero, and a caller's token-denominated ceiling can never fire no matter
 * how much the work really burned. A ceiling that cannot fire is worse than no ceiling, because it
 * reads as protection.
 *
 * `Spend.tokensKnown` is the marker the substrate already threads end to end for exactly this case
 * (`budget.ts`, `otel-spans.ts`, `spawn-journal.ts`, `supervisor.ts`): the work is recorded, the
 * zero is labelled a floor rather than a total, and every rollup that touches it reports its balance
 * as a ceiling rather than a measurement. Use this — never a bare zero — whenever a runtime cannot
 * see what its worker spent.
 *
 * The same rule applies to dollars. A dollar-capped run must refuse an executor whose billed spend
 * is unknowable; `budgetExempt` does not authorize Runtime to relabel unknown spend as a measured
 * zero. Callers that require dollar accounting must use a backend with a trusted billing receipt.
 */
function unmeteredSpend(ms: number): Spend {
  return {
    iterations: 0,
    tokens: zeroTokenUsage(),
    tokensKnown: false,
    usd: 0,
    usdKnown: false,
    ms,
  }
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
  const model = exactRouterModel(spec.profile, 'routerInlineExecutor')
  if (!seam.routerBaseUrl || !seam.routerKey) {
    throw new ValidationError('routerInlineExecutor: RouterSeam.routerBaseUrl + routerKey required')
  }
  const profileExecution = routerProfileExecution(spec.profile, seam, { multiTurn: false })
  const requestIdentity = routerRequestIdentity(ctx)

  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  let artifact: ExecutorResult<unknown> | undefined
  const executionId = ctx.node?.nodeId ?? `router-request-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)

  return attestRuntimeOwnedExecutor(
    {
      runtime: 'router' as Runtime,
      async execute(task, signal): Promise<ExecutorResult<unknown>> {
        const messages = taskToMessages(task, spec, profileExecution.systemPrompt)
        const started = Date.now()
        const linked = linkSignals(signal, controller.signal)
        const extraBody = {
          ...(profileExecution.extraBody ?? {}),
          ...(profileExecution.reasoningEffort
            ? { reasoning_effort: profileExecution.reasoningEffort }
            : {}),
        }
        const r = await runRouterTransport<RouterChatResult | RouterChatToolsResult>(
          'routerInlineExecutor',
          () =>
            seam.tools
              ? (profileExecution.stream === true
                  ? streamRouterChatWithTools
                  : routerChatWithTools)(
                  {
                    routerBaseUrl: seam.routerBaseUrl,
                    routerKey: seam.routerKey,
                    model,
                    ...(profileExecution.retry !== undefined
                      ? { retry: profileExecution.retry }
                      : {}),
                    ...(seam.complete ? { complete: seam.complete } : {}),
                  },
                  messages,
                  seam.tools,
                  {
                    ...(profileExecution.temperature !== undefined
                      ? { temperature: profileExecution.temperature }
                      : {}),
                    ...(linked ? { signal: linked } : {}),
                    ...(profileExecution.toolChoice
                      ? { toolChoice: profileExecution.toolChoice }
                      : {}),
                    ...(profileExecution.maxTokens !== undefined
                      ? { maxTokens: profileExecution.maxTokens }
                      : {}),
                    ...(profileExecution.seed !== undefined ? { seed: profileExecution.seed } : {}),
                    ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
                    ...requestIdentity,
                  },
                )
              : routerChatWithUsage(
                  {
                    routerBaseUrl: seam.routerBaseUrl,
                    routerKey: seam.routerKey,
                    model,
                    ...(profileExecution.retry !== undefined
                      ? { retry: profileExecution.retry }
                      : {}),
                    ...(seam.complete ? { complete: seam.complete } : {}),
                  },
                  messages,
                  {
                    ...(profileExecution.temperature !== undefined
                      ? { temperature: profileExecution.temperature }
                      : {}),
                    ...(linked ? { signal: linked } : {}),
                    ...(profileExecution.maxTokens !== undefined
                      ? { maxTokens: profileExecution.maxTokens }
                      : {}),
                    ...(profileExecution.seed !== undefined ? { seed: profileExecution.seed } : {}),
                    ...(profileExecution.reasoningEffort
                      ? { reasoningEffort: profileExecution.reasoningEffort }
                      : {}),
                    ...(profileExecution.extraBody
                      ? { extraBody: profileExecution.extraBody }
                      : {}),
                    ...requestIdentity,
                  },
                ),
        )
        const spent: Spend = {
          iterations: 1,
          tokens: r.usage ? { input: r.usage.input, output: r.usage.output } : zeroTokenUsage(),
          usd: r.billedCostUsd ?? 0,
          ...(r.usage ? {} : { tokensKnown: false }),
          ...(r.billedCostUsd === undefined ? { usdKnown: false } : {}),
          ms: Date.now() - started,
        }
        assertObservedRouterModel(r.model, model, 'routerInlineExecutor')
        const out = {
          content: r.content ?? '',
          ...(r.model !== undefined ? { model: r.model } : {}),
          transportAttempts: r.transportAttempts,
          ...(r.costUsd !== undefined ? { estimatedCostUsd: r.costUsd } : {}),
          ...(r.cache ? { promptCache: r.cache } : {}),
          ...(r.usage?.reasoning !== undefined ? { reasoningTokens: r.usage.reasoning } : {}),
          ...('toolCalls' in r ? { toolCalls: r.toolCalls } : {}),
          ...(r.reasoning ? { reasoning: r.reasoning } : {}),
          ...(r.finishReason
            ? { finishReason: r.finishReason }
            : 'toolCalls' in r && r.toolCalls.length > 0
              ? { finishReason: 'tool_calls' }
              : {}),
        } as unknown
        artifact = { outRef: contentRef('router', { model, out }), out, spent }
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
    },
    {
      effectiveProfile: spec.profile,
      backend: 'router',
      model: { status: 'known', id: model },
      execution: {
        kind: 'request',
        id: executionId,
      },
      materializer: 'router-prompt-model',
      plan: {
        kind: 'openai-chat-completion',
        model,
        provider: spec.profile.model?.provider ?? null,
        temperature: profileExecution.temperature ?? null,
        maxTokens: profileExecution.maxTokens ?? null,
        retry: profileExecution.retry ?? null,
        seed: profileExecution.seed ?? null,
        reasoningEffort: profileExecution.reasoningEffort ?? null,
        extraBody: profileExecution.extraBody ?? null,
        tools: seam.tools ?? null,
        toolChoice: profileExecution.toolChoice ?? null,
        systemPrompt: profileExecution.systemPrompt || null,
      },
    },
    {
      attemptId,
      binding: {
        endpoint: seam.routerBaseUrl,
        executionId,
        model,
      },
      descriptor: { kind: 'router-request', transport: 'http', backend: 'router' },
    },
  )
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
  complete?: RouterConfig['complete']
  tools: ReadonlyArray<ToolSpec>
  executeToolCall: (name: string, args: Record<string, unknown>, task: unknown) => Promise<string>
  /** Exact conversation to continue. Runtime validates its system message against the profile. */
  initialMessages?: ReadonlyArray<Readonly<Record<string, unknown>>>
  /** Observe the detached final conversation for session persistence. */
  onMessages?: (messages: ReadonlyArray<Readonly<Record<string, unknown>>>) => void | Promise<void>
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
}
const routerToolsSeamKey = 'router-tools'

function mergePromptCache(
  target: Record<string, number | string>,
  cache: PromptCacheUsage | undefined,
): void {
  if (!cache) return
  for (const key of ['readTokens', 'writeTokens', 'missTokens', 'readSavingsUsd'] as const) {
    const value = cache[key]
    if (value !== undefined) target[key] = (Number(target[key]) || 0) + value
  }
  if (cache.status !== undefined) target.status = cache.status
}

async function runRouterTransport<T>(context: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throwRouterTransportFailure(context, error)
  }
}

function throwRouterTransportFailure(context: string, error: unknown): never {
  if (
    error instanceof ValidationError ||
    (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
  ) {
    throw error
  }
  const message = error instanceof Error ? error.message : String(error)
  throw new ValidationError(`${context}: transport failed: ${message}`)
}

/**
 * The tool-using router executor. Drives the multi-turn tool loop the single-shot
 * `routerInlineExecutor` cannot express; same fail-loud + real-usage discipline.
 */
export const routerToolsInlineExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<RouterToolsSeam>(ctx, routerToolsSeamKey, 'router-tools')
  const model = exactRouterModel(spec.profile, 'routerToolsInlineExecutor')
  if (!seam.routerBaseUrl || !seam.routerKey) {
    throw new ValidationError(
      'routerToolsInlineExecutor: RouterToolsSeam.routerBaseUrl + routerKey required',
    )
  }
  const profileExecution = routerProfileExecution(
    spec.profile,
    {
      routerBaseUrl: seam.routerBaseUrl,
      routerKey: seam.routerKey,
      tools: seam.tools,
    },
    { multiTurn: true },
  )
  const enabledToolNames = new Set(seam.tools.map((tool) => tool.function.name))
  const maxTurns = profileExecution.maxTurns ?? 0
  const requestIdentity = routerRequestIdentity(ctx)

  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  // The down-leg receive end: the driver's steer/answer/resume land here via `Scope.send`.
  const inbox = createInbox()

  let artifact: ExecutorResult<unknown> | undefined
  const executionId = ctx.node?.nodeId ?? `router-tools-run-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)

  return attestRuntimeOwnedExecutor(
    {
      runtime: 'router' as Runtime,
      deliver: (m) => inbox.deliver(m),
      async execute(task, signal): Promise<ExecutorResult<unknown>> {
        const started = Date.now()
        const messages: Array<Record<string, unknown>> = seam.initialMessages
          ? taskToMessages(
              {
                messages: [...seam.initialMessages, { role: 'user', content: taskToPrompt(task) }],
              },
              spec,
              profileExecution.systemPrompt,
            )
          : taskToMessages(task, spec, profileExecution.systemPrompt)
        const tokens = zeroTokenUsage()
        let tokensKnown = true
        let billedUsd = 0
        let usdKnown = true
        let turns = 0
        let transportAttempts = 0
        let observedModel: string | undefined
        let reasoningTokens = 0
        let reasoningKnown = true
        const promptCache: Record<string, number | string> = {}
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

        try {
          for (let t = 0; maxTurns === 0 || t < maxTurns; t += 1) {
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
            let res: Awaited<ReturnType<typeof routerChatWithTools>>
            try {
              res = await (profileExecution.stream === true
                ? streamRouterChatWithTools
                : routerChatWithTools)(
                {
                  routerBaseUrl: seam.routerBaseUrl,
                  routerKey: seam.routerKey,
                  model,
                  ...(profileExecution.retry !== undefined
                    ? { retry: profileExecution.retry }
                    : {}),
                  ...(seam.complete ? { complete: seam.complete } : {}),
                },
                messages,
                seam.tools,
                {
                  ...(profileExecution.temperature !== undefined
                    ? { temperature: profileExecution.temperature }
                    : {}),
                  signal: turnController.signal,
                  ...(profileExecution.toolChoice
                    ? { toolChoice: profileExecution.toolChoice }
                    : {}),
                  ...(profileExecution.maxTokens !== undefined
                    ? { maxTokens: profileExecution.maxTokens }
                    : {}),
                  ...(profileExecution.seed !== undefined ? { seed: profileExecution.seed } : {}),
                  ...(profileExecution.reasoningEffort
                    ? { reasoningEffort: profileExecution.reasoningEffort }
                    : {}),
                  ...(profileExecution.extraBody ? { extraBody: profileExecution.extraBody } : {}),
                  ...routerTurnRequestIdentity(requestIdentity, t),
                },
              )
            } catch (e) {
              cleanup()
              // Re-plan ONLY when a forceful inbox message aborted this turn (a real AbortError, with the
              // interrupt — not the external teardown/budget signal). The re-planned turn still consumes a
              // loop slot when the caller configured a finite maxTurns, but does not bill a turn.
              // Any other error — incl. a network fault coincident with an interrupt — is fatal: rethrow.
              const interruptAbort =
                e instanceof DOMException &&
                e.name === 'AbortError' &&
                interruptSig.aborted &&
                !signal.aborted &&
                !controller.signal.aborted
              if (interruptAbort) continue
              throwRouterTransportFailure('routerToolsInlineExecutor', e)
            }
            cleanup()
            // The inference completed — count the turn now (an interrupted, re-planned turn doesn't bill).
            turns += 1
            transportAttempts += res.transportAttempts
            assertObservedRouterModel(res.model, model, 'routerToolsInlineExecutor')
            if (res.model !== undefined) observedModel = res.model
            mergePromptCache(promptCache, res.cache)
            if (res.usage) {
              tokens.input += res.usage.input
              tokens.output += res.usage.output
              if (res.usage.reasoning !== undefined) reasoningTokens += res.usage.reasoning
              else reasoningKnown = false
            } else {
              tokensKnown = false
              reasoningKnown = false
            }
            if (res.billedCostUsd !== undefined) billedUsd += res.billedCostUsd
            else usdKnown = false
            if (res.content) lastText = res.content
            const toolCalls = res.toolCalls
            if (toolCalls.length === 0) {
              // Before settling, flush once more — a worker may not finish while a steer/answer it never
              // read is still pending. If anything flushed, keep going; otherwise it is truly done.
              if (flush()) continue
              messages.push({ role: 'assistant', content: res.content ?? '' })
              break
            }

            // Record the assistant turn verbatim, then run each call on the host and
            // fold the result back as a `tool` message for the next turn.
            messages.push({
              role: 'assistant',
              content: res.content ?? '',
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              })),
            })
            for (let i = 0; i < toolCalls.length; i += 1) {
              const tc = toolCalls[i]
              const id = tc?.id ?? `call_${i}`
              const toolName = tc?.name ?? ''
              if (!enabledToolNames.has(toolName)) {
                messages.push({
                  role: 'tool',
                  tool_call_id: id,
                  content: `error: tool ${JSON.stringify(toolName)} is not enabled by AgentProfile.tools`,
                })
                try {
                  seam.onToolStep?.({ toolName, args: {}, status: 'error' })
                } catch {
                  // Monitoring cannot authorize or execute a refused tool call.
                }
                continue
              }
              let args: Record<string, unknown> = {}
              try {
                args = JSON.parse(tc?.arguments ?? '{}') as Record<string, unknown>
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
        } finally {
          await seam.onMessages?.(
            structuredClone(messages) as ReadonlyArray<Readonly<Record<string, unknown>>>,
          )
        }

        const priced = isModelPriced(model)
        const estimatedUsd = priced ? estimateCost(tokens.input, tokens.output, model) : undefined
        const spent: Spend = {
          iterations: turns,
          tokens,
          ...(tokensKnown ? {} : { tokensKnown: false }),
          usd: billedUsd,
          ...(usdKnown ? {} : { usdKnown: false }),
          ms: Date.now() - started,
        }
        const out = {
          content: lastText,
          ...(observedModel !== undefined ? { model: observedModel } : {}),
          messages,
          turns,
          toolCalls: messages.filter((message) => message.role === 'tool').length,
          transportAttempts,
          ...(estimatedUsd !== undefined ? { estimatedCostUsd: estimatedUsd } : {}),
          ...(Object.keys(promptCache).length > 0 ? { promptCache } : {}),
          ...(reasoningKnown && turns > 0 ? { reasoningTokens } : {}),
        } as unknown
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
    },
    {
      effectiveProfile: spec.profile,
      backend: 'router-tools',
      model: { status: 'known', id: model },
      execution: {
        kind: 'run',
        id: executionId,
      },
      materializer: 'router-tools-prompt-model',
      plan: {
        kind: 'openai-tool-loop',
        model,
        provider: spec.profile.model?.provider ?? null,
        maxTurns,
        tools: seam.tools,
        temperature: profileExecution.temperature ?? null,
        maxTokens: profileExecution.maxTokens ?? null,
        retry: profileExecution.retry ?? null,
        toolChoice: profileExecution.toolChoice ?? null,
        extraBody: profileExecution.extraBody ?? null,
        reasoningEffort: profileExecution.reasoningEffort ?? null,
        systemPrompt: profileExecution.systemPrompt || null,
      },
    },
    {
      attemptId,
      binding: {
        endpoint: seam.routerBaseUrl,
        executionId,
        model,
      },
      descriptor: { kind: 'router-tool-loop', transport: 'http', backend: 'router-tools' },
    },
  )
}

function assertObservedRouterModel(
  observed: string | undefined,
  expected: string,
  context: string,
): void {
  if (observed !== undefined && observed !== expected) {
    throw new ValidationError(
      `${context}: provider reported model ${JSON.stringify(observed)} but AgentProfile requires ${JSON.stringify(expected)}`,
    )
  }
}

function routerRequestIdentity(ctx: ExecutorContext): {
  readonly callId?: string
  readonly correlationId?: string
} {
  const correlation = ctx.node?.identity?.correlation
  return {
    ...(correlation?.callId ? { callId: correlation.callId } : {}),
    ...(correlation?.correlationId ? { correlationId: correlation.correlationId } : {}),
  }
}

function routerTurnRequestIdentity(
  identity: { readonly callId?: string; readonly correlationId?: string },
  turnIndex: number,
): { readonly callId?: string; readonly correlationId?: string } {
  return {
    ...(identity.callId ? { callId: `${identity.callId}:turn:${turnIndex + 1}` } : {}),
    ...(identity.correlationId ? { correlationId: identity.correlationId } : {}),
  }
}

// ── sandbox executor (harness is a BackendType) ────────────────────────────────

/**
 * COMPOSES `runAgentRounds` as a single-task leaf: one box, a refine driver bounded to
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
  // The cross-MACHINE case this exists for: the box gets `TRACE_ID` / `PARENT_SPAN_ID` through
  // `CreateSandboxOptions.env`, so whatever the remote worker emits lands in this run's trace under
  // the spawning node's span. Empty when the run records no spans, and an empty record adds no
  // `env` key to the create options at all.
  const traceEnv = workerTraceEnv(ctx)

  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  let artifact: ExecutorResult<unknown> | undefined
  const executionId = ctx.node?.nodeId ?? `sandbox-run-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)
  const profileModel = concreteProfileModel(spec.profile)
  const sandboxMaterialization = {
    effectiveProfile: spec.profile,
    backend: harness,
    model: profileModel
      ? ({ status: 'known', id: profileModel } as const)
      : ({ status: 'unknown', reason: 'sandbox harness selected its default model' } as const),
    execution: {
      kind: 'run',
      id: executionId,
    },
    materializer: 'sandbox-agent-profile',
    plan: {
      kind: 'sandbox-agent-rounds',
      harness,
      maxIterations,
      steering: seam.steering !== undefined,
    },
  }
  const sandboxBinding = {
    attemptId,
    binding: {
      executionId,
      harness,
      model: profileModel ?? null,
    },
    descriptor: { kind: 'sandbox-run', transport: 'sandbox', backend: harness },
  }

  // STEERABLE mode (opt-in): the worker becomes a multi-turn session on one box, with a real
  // inbox, so a driver's steer has a turn boundary to be folded into. This is the path that
  // makes `Scope.send` return `true` for the DEFAULT cloud worker.
  if (seam.steering) {
    const inbox = createInbox()
    const session = createSteerableSandboxSession({
      controller,
      profile: spec.profile,
      harness,
      sandboxClient: seam.sandboxClient,
      inbox,
      taskToPrompt: (t) => taskToPrompt(t),
      options: seam.steering,
      ...(seam.loopCtx ? { loopCtx: seam.loopCtx } : {}),
      ...(Object.keys(traceEnv).length > 0 ? { traceEnv } : {}),
      contentRef,
    })
    return attestRuntimeOwnedExecutor(
      {
        runtime: 'sandbox' as Runtime,
        deliver: (m) => inbox.deliver(m),
        progress: (): ExecutorProgress => session.progress(),
        traceSource: (): TraceSource => session.traceSource(),
        execute(task, signal): AsyncIterable<UsageEvent> {
          return session.stream(task, signal)
        },
        async teardown(_grace): Promise<{ destroyed: boolean }> {
          controller.abort()
          await session.teardown()
          return { destroyed: true }
        },
        resultArtifact() {
          const a = session.artifact()
          if (!a) {
            throw new ValidationError(
              'sandboxExecutor(steering): resultArtifact() read before stream drained',
            )
          }
          return a
        },
      },
      sandboxMaterialization,
      sandboxBinding,
    )
  }

  // The leaf runs an opaque, self-parallelizing coding harness; the loop just
  // refines once over it. Output is the raw event stream parsed to its tail text.
  const output: OutputAdapter<SandboxLeafOut> = {
    parse(events: SandboxEvent[]): SandboxLeafOut {
      return { events }
    },
  }
  const driver = singleShotDriver<SandboxLeafOut>(maxIterations)

  return attestRuntimeOwnedExecutor(
    {
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
          traceEnv,
          onArtifact: (a) => {
            artifact = a
          },
        })
      },
      teardown(_grace): Promise<{ destroyed: boolean }> {
        // The composed runAgentRounds owns its box teardown (finally{allSettled(destroy)});
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
    },
    sandboxMaterialization,
    sandboxBinding,
  )
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
  /** Inherited `TRACE_ID` / `PARENT_SPAN_ID` for the box; empty when tracing is off. */
  traceEnv: Record<string, string>
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
    sandboxOverrides: {
      backend: { type: args.harness },
      // Absent entirely when tracing is off, so the create options are byte-identical to before.
      ...(Object.keys(args.traceEnv).length > 0 ? { env: args.traceEnv } : {}),
    },
  }
  const started = Date.now()

  // `lineage` is a PR #150 RunAgentRoundsOptions field absent on this branch — forwarded
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
  } as RunAgentRoundsOptions<unknown, SandboxLeafOut, string>

  try {
    const result = await runAgentRounds(loopOptions)
    // Fail loud on a round that produced nothing: the worker settles `down`
    // carrying the loop's own reason (a rejected profile, a box that would not
    // provision) rather than an artifact it never produced.
    const failure = failedRound(result)
    if (failure) throw failure
    const out = result.winner?.output ?? { events: [] }
    const verdict = result.winner?.verdict ?? leafVerdict(result)
    const tokensKnown = result.tokenUsage.tokensKnown !== false
    const usdKnown = result.costUsdKnown !== false
    const outWithUsage = {
      ...out,
      ...(result.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: result.estimatedCostUsd }
        : {}),
      ...(result.promptCache ? { promptCache: result.promptCache } : {}),
    }
    const spent: Spend = {
      iterations: result.iterations.length,
      tokens: { input: result.tokenUsage.input, output: result.tokenUsage.output },
      ...(tokensKnown ? {} : { tokensKnown: false }),
      usd: result.costUsd,
      ...(usdKnown ? {} : { usdKnown: false }),
      ms: Date.now() - started,
    }
    args.onArtifact({
      outRef: contentRef('sandbox', { harness: args.harness, out: outWithUsage }),
      out: outWithUsage,
      ...(verdict ? { verdict } : {}),
      spent,
    })
    for (let i = 0; i < result.iterations.length; i += 1) yield { kind: 'iteration' }
    if (result.iterations.length > 0 || result.tokenUsage.input || result.tokenUsage.output) {
      yield {
        kind: 'tokens',
        input: result.tokenUsage.input,
        output: result.tokenUsage.output,
        ...(tokensKnown ? {} : { tokensKnown: false }),
      }
    }
    if (result.iterations.length > 0 || result.costUsd) {
      yield { kind: 'cost', usd: result.costUsd, ...(usdKnown ? {} : { usdKnown: false }) }
    }
  } finally {
    args.signal.removeEventListener('abort', cascade)
    args.controller.signal.removeEventListener('abort', cascade)
  }
}

/** The loop's own failure, when NO iteration produced an output: the first error it
 *  recorded, renamed so the settled worker names the leaf it died in. `undefined`
 *  when any iteration produced an output — a partly-failed round still has material
 *  to settle on. */
function failedRound(result: {
  iterations: ReadonlyArray<{ output?: unknown; error?: Error }>
}): Error | undefined {
  if (result.iterations.length === 0) return undefined
  if (result.iterations.some((iteration) => iteration.output !== undefined)) return undefined
  const first = result.iterations.find((iteration) => iteration.error)?.error
  if (!first) return undefined
  return new Error(`sandboxExecutor: agent round failed — ${first.message}`, { cause: first })
}

/**
 * The leaf's OWN verdict, for a round the loop scored no validator against.
 *
 * `settled ⟺ delivered` is written by the completion oracle, and a caller that
 * passes one keeps it: `gateOnDeliverable` wraps this executor and overrides
 * `valid` from its check. This is the sandbox backend's structural answer for a
 * run with no oracle at all — without it nothing ever writes `valid`, no settled
 * child is ever DELIVERED, and the finalizer has nothing to select no matter how
 * well the worker ran. Structural, never self-reported: the harness completed a
 * round and returned an output artifact, or it did not.
 */
function leafVerdict(result: { winner?: { output?: unknown } }): DefaultVerdict | undefined {
  if (result.winner?.output === undefined) return undefined
  return { valid: true, score: 1 }
}

// ── cli executor (Halo / external RLM subprocess) ──────────────────────────────

/**
 * Spawns a subprocess (`bin` + `args`). It cannot account tokens, so it is
 * `budgetExempt: true`: it remains usable as a direct executor, while budgeted supervision
 * refuses it before process execution because the CLI exposes no usage receipt. teardown is SIGTERM → SIGKILL
 * with a grace window. Streaming: yields one `iteration` event on clean exit.
 *
 * Its terminal spend is `unmeteredSpend`, NOT a zero: an unmetered runtime that reports a plain
 * `0` is indistinguishable from one that measured zero, and every ceiling downstream then reads
 * as enforced while enforcing nothing.
 */
export const cliExecutor: ExecutorFactory<unknown> = (_spec, ctx) => {
  const seam = readSeam<CliSeam>(ctx, cliSeamKey, 'cli')
  if (!seam.bin) throw new ValidationError('cliExecutor: CliSeam.bin required')
  // `TRACE_ID` / `PARENT_SPAN_ID` for this worker when the run records spans; `{}` otherwise.
  const traceEnv = workerTraceEnv(ctx)

  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  let proc: ReturnType<typeof spawn> | undefined
  let artifact: ExecutorResult<unknown> | undefined
  const executionId = ctx.node?.nodeId ?? `cli-process-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)

  return attestRuntimeOwnedExecutor(
    {
      runtime: 'cli' as Runtime,
      budgetExempt: true,
      execute(task, signal): AsyncIterable<UsageEvent> {
        return streamCliLeaf({
          task,
          signal,
          traceEnv,
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
    },
    {
      effectiveProfile: _spec.profile,
      backend: 'cli',
      model: { status: 'unknown', reason: 'raw subprocess has no model identity contract' },
      execution: { kind: 'process-attempt', id: executionId },
      materializer: 'raw-cli-stdin',
      plan: {
        kind: 'raw-cli-process',
        bin: seam.bin,
        args: seam.args ?? [],
        cwd: seam.cwd ?? null,
        envOverrides: seam.env ?? {},
        ambientEnvironment: 'inherited',
      },
    },
    {
      attemptId,
      binding: {
        executionId,
        bin: seam.bin,
        cwd: seam.cwd ?? null,
      },
      descriptor: { kind: 'cli-process', transport: 'process', backend: 'cli' },
    },
  )
}

interface StreamCliArgs {
  task: unknown
  signal: AbortSignal
  seam: CliSeam
  /** Inherited `TRACE_ID` / `PARENT_SPAN_ID` for the subprocess; empty when tracing is off. */
  traceEnv: Record<string, string>
  controller: AbortController
  onProc: (p: ReturnType<typeof spawn>) => void
  onArtifact: (a: ExecutorResult<unknown>) => void
}

async function* streamCliLeaf(args: StreamCliArgs): AsyncIterable<UsageEvent> {
  const started = Date.now()
  const prompt = taskToPrompt(args.task)
  const proc = spawn(args.seam.bin, args.seam.args ?? [], {
    ...(args.seam.cwd ? { cwd: args.seam.cwd } : {}),
    // Trace context above ambient `process.env` (whose ids describe the SUPERVISOR's place in an
    // outer trace, not this child's) and below `seam.env` (a deliberate operator declaration).
    // `mergeTraceEnv`, not a plain spread: a seam that overrides the legacy pair without its own
    // `TRACEPARENT` gets the W3C wire rebuilt from ITS ids, never left as the recorder's.
    env: mergeTraceEnv(process.env, args.traceEnv, args.seam.env),
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
  // A raw subprocess exposes no usage receipt, so its spend is UNKNOWN — not zero. Wall-clock is
  // the one thing this runtime did measure, so that is the one field reported as measured.
  args.onArtifact({
    outRef: contentRef('cli', out),
    out,
    spent: unmeteredSpend(Date.now() - started),
  })
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
 *  - ABORT: reader abort only detaches HTTP. Interrupt/teardown then call the
 *    bridge's explicit cancel operation and wait for the owned run to terminate.
 *
 * Reports REAL usage when the bridge surfaces it, never a fabricated cost.
 */
interface ResolvedBridgeSeam extends BridgeSeam {
  /** Derived once from the exact AgentProfile; never accepted as backend configuration. */
  readonly model: string
}

/** Resolve the exact bridge wire id from the profile and nowhere else. */
function bridgeProfileModel(profile: AgentProfile, context: string): string {
  assertExecutableAgentProfile(profile, context)
  if (!agentHarness(profile.harness)) {
    throw new ValidationError(`${context}: AgentProfile.harness must select a coding-agent harness`)
  }
  const model = profileBridgeWireModel(profile)
  if (!model) {
    throw new ValidationError(`${context}: AgentProfile did not resolve a bridge wire model`)
  }
  return model
}

export const bridgeExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const base = readSeam<BridgeSeam>(ctx, bridgeSeamKey, 'bridge')
  const effectiveProfile = agentProfileSchema.parse(spec.profile)
  const model = bridgeProfileModel(effectiveProfile, 'bridgeExecutor')
  const seam: ResolvedBridgeSeam = { ...base, model }
  if (!seam.bridgeUrl || !seam.bridgeBearer) {
    throw new ValidationError('bridgeExecutor: bridgeUrl + bridgeBearer are required')
  }
  if (
    seam.timeoutMs !== undefined &&
    (!Number.isSafeInteger(seam.timeoutMs) ||
      seam.timeoutMs < 1 ||
      seam.timeoutMs > maxBridgeTimeoutMs)
  ) {
    throw new ValidationError(
      `bridgeExecutor: timeoutMs must be an integer from 1 to ${maxBridgeTimeoutMs}`,
    )
  }
  if (
    seam.maxReconnects !== undefined &&
    (!Number.isSafeInteger(seam.maxReconnects) || seam.maxReconnects < 0)
  ) {
    throw new ValidationError('bridgeExecutor: maxReconnects must be a nonnegative safe integer')
  }
  const maxTurns = profileModelExecutionSettings(effectiveProfile, 'bridgeExecutor').maxTurns ?? 0
  const maxReconnects = seam.maxReconnects ?? 3
  // A stable per-spawn session id (caller can pin one) — cli-bridge keys harness
  // resume off this exactly as a box id keys a sandbox session.
  const sessionId = seam.sessionId ?? `bridge-${spec.profile.name ?? 'worker'}-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(sessionId)

  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  // The down-leg receive end: the driver's steer/answer/resume land here via `Scope.send`.
  const inbox = createInbox()
  let artifact: ExecutorResult<unknown> | undefined
  // One spawn owns one resumable session and, at most, one live durable run per
  // turn. Keep the server-owned run identities until the bridge proves each job
  // terminal; closing a response body is deliberately not terminal evidence.
  const activeRuns = new Map<string, ActiveBridgeRun>()
  // The live read-model behind `progress()`, filled as the SSE stream is consumed.
  const observation: BridgeObservation = {
    turns: 0,
    note: 'starting',
    activity: createActivityLog(seam.activityWindow ?? 12),
    derived: [],
    refreshedAt: 0,
    refreshing: false,
    closed: false,
  }
  // One push source per SPAWN, not per turn: a steered worker's turn 4 tool calls belong to the
  // same trace as its turn 0 calls, and `collect()` must still answer after the stream drains.
  const trace = createPushTraceSource({ runId: sessionId })

  // Interface's AgentExecutionPreparationReceipt cannot be reused here yet: it is a pre-compute
  // contract requiring an execution-bound workspace lease, source/prepared workspace digests,
  // profile-activation evidence, and full per-axis ownership. cli-bridge currently has only its
  // terminal applied WorkspacePlan acknowledgement. Keep that acknowledgement explicitly terminal,
  // bind it into Runtime's existing declaration, and never present this planned declaration as
  // evidence that the remote process actually used it.
  const plannedDeclaration = {
    effectiveProfile,
    backend: 'bridge',
    model: { status: 'known' as const, id: seam.model },
    execution: { kind: 'session', id: sessionId },
    materializer: 'cli-bridge-agent-profile',
    plan: {
      kind: 'cli-bridge-session',
      cwd: seam.cwd ?? null,
      maxTurns,
      maxReconnects,
      timeoutMs: seam.timeoutMs ?? null,
      streaming: true,
      terminalAcknowledgement: null,
    },
  }
  const plannedBinding = {
    attemptId,
    binding: {
      bridgeUrl: seam.bridgeUrl,
      cwd: seam.cwd ?? null,
      effectiveProfile,
      model: seam.model,
      sessionId,
    },
    descriptor: { kind: 'bridge-session', transport: 'http', backend: 'bridge' },
  }
  let acknowledged: BridgeProfileMaterializationReceipt | undefined
  let executor!: Executor<unknown>
  executor = {
    runtime: 'cli' as Runtime,
    deliver: (m) => inbox.deliver(m),
    /**
     * The LIVE read of this worker, answered entirely from local mirrors so it is synchronous
     * and cannot block or fail the run. The bridge's own run state is refreshed OUT OF BAND —
     * a read schedules a fetch whose answer lands for the NEXT read — because the executor
     * cannot know from its own stream whether a silent run is thinking, detached mid-reconnect,
     * or already cancelled server-side, and that is exactly the distinction a supervisor's
     * respawn decision turns on.
     */
    progress: (): ExecutorProgress | undefined => {
      try {
        scheduleBridgeRunStateRefresh(seam, activeRuns, observation)
        return {
          turns: observation.turns,
          pendingMessages: inbox.pending(),
          recentActivity: observation.activity.read(),
          ...(observation.derived.length > 0 ? { derived: [...observation.derived] } : {}),
          note: bridgeProgressNote(observation, liveBridgeRunId(activeRuns)),
        }
      } catch {
        return undefined
      }
    },
    traceSource: (): TraceSource => trace.source,
    execute(task, signal): AsyncIterable<UsageEvent> {
      return streamBridgeSession({
        task,
        signal,
        profile: effectiveProfile,
        seam,
        sessionId,
        maxTurns,
        maxReconnects,
        inbox,
        controller,
        activeRuns,
        observation,
        record: (step: ToolStepInput) => {
          trace.record(step)
        },
        onArtifact: (a) => {
          artifact = a
        },
        onProfileMaterialization: (receipt) => {
          if (acknowledged !== undefined) {
            if (JSON.stringify(acknowledged) !== JSON.stringify(receipt)) {
              throw new ValidationError(
                'bridgeExecutor: profile materialization changed across session turns',
              )
            }
            return
          }
          acknowledged = receipt
          finalizeRuntimeOwnedPendingExecutor(
            executor,
            {
              ...plannedDeclaration,
              plan: { ...plannedDeclaration.plan, terminalAcknowledgement: receipt },
            },
            plannedBinding,
          )
        },
      })
    },
    async teardown(grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      const remaining = [...activeRuns.values()].filter((run) => !run.terminal)
      if (remaining.length === 0) return { destroyed: true }
      const terminal = await Promise.all(
        remaining.map((run) => cancelBridgeRunToTerminal(seam, run, grace)),
      )
      return { destroyed: terminal.every(Boolean) }
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError('bridgeExecutor: resultArtifact() read before stream drained')
      }
      return { ...artifact, spent: artifact.spent }
    },
  }
  return attestRuntimeOwnedPendingExecutor(executor, 'cli', plannedDeclaration, plannedBinding)
}

interface StreamBridgeArgs {
  task: unknown
  signal: AbortSignal
  profile: AgentProfile
  seam: ResolvedBridgeSeam
  sessionId: string
  maxTurns: number
  maxReconnects: number
  inbox: Inbox
  controller: AbortController
  activeRuns: Map<string, ActiveBridgeRun>
  /** The live read-model `progress()` answers from; the turn loop is its only writer. */
  observation: BridgeObservation
  record: (step: ToolStepInput) => void
  onArtifact: (a: ExecutorResult<unknown>) => void
  onProfileMaterialization: (receipt: BridgeProfileMaterializationReceipt) => void
}

/** Everything `bridgeExecutor.progress()` answers from. Every field is written by the turn loop as
 *  the stream is consumed, so the read itself touches no I/O and cannot block the run. */
interface BridgeObservation {
  turns: number
  note: string
  readonly activity: ActivityLog
  /** Append-only record of what this executor changed about the caller's declaration. */
  readonly derived: string[]
  /** Newest bridge-side run snapshot; written by the out-of-band refresh, never awaited. */
  runState?: BridgeRunStateRead
  /** When the last refresh was STARTED — the rate limit, so a hot observe loop can't hammer. */
  refreshedAt: number
  refreshing: boolean
  /** Set once the bridge reports the run terminal, or the stream ends. Stops all further reads. */
  closed: boolean
}

/** The bridge's own view of the durable run, as `GET /v1/runs/:id` reports it. `at` is when this
 *  executor read it, so a stale snapshot is presented as stale rather than as current truth. */
interface BridgeRunStateRead {
  readonly runId: string
  readonly status: string
  readonly state: string
  readonly terminal: boolean
  readonly lastSeq: number
  readonly at: number
}

/** Minimum spacing between out-of-band run-state reads. A driver polling `observe_agent` in a
 *  tight loop must not turn an observability read into load on the bridge. */
const BRIDGE_RUN_STATE_REFRESH_MS = 1_000
/** Ceiling on one run-state read. A bridge that hangs must not pin `refreshing` forever and
 *  silently stop every later refresh. */
const BRIDGE_RUN_STATE_TIMEOUT_MS = 2_000

/** One human-readable line: the local turn phase, plus the bridge's own run state when a snapshot
 *  has been read for a run that is still live. The snapshot's AGE is stated because a driver
 *  reading "running" must be able to tell a fresh read from a 40-second-old one; and once this
 *  executor holds terminal proof the line is DROPPED rather than left repeating a last-known
 *  "running" that stopped being true the moment the run ended. */
function bridgeProgressNote(observation: BridgeObservation, liveRunId: string | undefined): string {
  const run = observation.runState
  if (!run || run.runId !== liveRunId) return observation.note
  const age = Math.max(0, Date.now() - run.at)
  return `${observation.note} · bridge run ${run.state} (status ${run.status}, seq ${run.lastSeq}, read ${age}ms ago)`
}

/** The run this executor still believes live, if any — the one worth reporting on and the only one
 *  worth asking the bridge about. */
function liveBridgeRunId(activeRuns: Map<string, ActiveBridgeRun>): string | undefined {
  for (const run of activeRuns.values()) {
    if (!run.terminal) return run.id
  }
  return undefined
}

/**
 * Start a NON-BLOCKING read of the bridge's run state; the answer lands on `observation` for a
 * later `progress()` call. Nothing here is awaited by the caller and no failure escapes: a bridge
 * that is down, slow, or has forgotten the run leaves the previous snapshot in place, and
 * `progress()` still returns the local mirror.
 */
function scheduleBridgeRunStateRefresh(
  seam: BridgeSeam,
  activeRuns: Map<string, ActiveBridgeRun>,
  observation: BridgeObservation,
): void {
  // A terminal answer is the end of the question. Local run state is NOT proof: `run.terminal`
  // stays false forever when a session dies without it (a failed teardown), so keying only on that
  // polls a dead worker for the life of the process.
  if (observation.closed) return
  if (observation.refreshing) return
  const now = Date.now()
  if (now - observation.refreshedAt < BRIDGE_RUN_STATE_REFRESH_MS) return
  // Only a run this executor still believes live is worth asking about; a terminal one is already
  // known, and there is nothing to steer.
  const runId = liveBridgeRunId(activeRuns)
  if (runId === undefined) return
  observation.refreshedAt = now
  observation.refreshing = true
  void (async () => {
    try {
      const snapshot = await bridgeRunStateGet(seam, runId)
      if (snapshot) {
        observation.runState = snapshot
        // Never write `run.terminal` from an observability read: `teardown` treats that field as
        // terminal proof and would skip the cancel.
        if (snapshot.terminal) observation.closed = true
      }
    } catch {
      // Keep the previous snapshot. An unreadable run state is not evidence about the run.
    } finally {
      observation.refreshing = false
    }
  })()
}

/** `GET /v1/runs/:id` — the bridge's durable-run registry read. Resolves `undefined` for any
 *  non-200 or non-conforming body rather than throwing: this is only ever an observability read. */
function bridgeRunStateGet(
  seam: BridgeSeam,
  runId: string,
): Promise<BridgeRunStateRead | undefined> {
  const target = new URL(
    `${seam.bridgeUrl.replace(/\/$/, '')}/v1/runs/${encodeURIComponent(runId)}`,
  )
  target.searchParams.set('wait_ms', '0')
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<BridgeRunStateRead | undefined>((resolve, reject) => {
    const req = requestFn(
      target,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${seam.bridgeBearer}` },
        timeout: BRIDGE_RUN_STATE_TIMEOUT_MS,
      },
      (res) => {
        void (async () => {
          const chunks: Buffer[] = []
          for await (const chunk of res) chunks.push(Buffer.from(chunk))
          if (res.statusCode !== 200) {
            resolve(undefined)
            return
          }
          resolve(readBridgeRunState(runId, Buffer.concat(chunks).toString('utf8')))
        })().catch(reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('bridgeExecutor: run state read timed out')))
    req.on('error', reject)
    req.end()
  })
}

/** Decode one run snapshot. A body that does not carry the fields we report is `undefined`, never
 *  a partially-invented snapshot. */
function readBridgeRunState(runId: string, body: string): BridgeRunStateRead | undefined {
  let parsed: {
    id?: unknown
    status?: unknown
    state?: unknown
    terminal?: unknown
    lastSeq?: unknown
  }
  try {
    parsed = JSON.parse(body) as typeof parsed
  } catch {
    return undefined
  }
  if (parsed.id !== runId) return undefined
  if (typeof parsed.status !== 'string' || typeof parsed.state !== 'string') return undefined
  if (typeof parsed.terminal !== 'boolean' || typeof parsed.lastSeq !== 'number') return undefined
  return {
    runId,
    status: parsed.status,
    state: parsed.state,
    terminal: parsed.terminal,
    lastSeq: parsed.lastSeq,
    at: Date.now(),
  }
}

interface ActiveBridgeRun {
  readonly id: string
  requestDigest?: string
  profileMaterialization?: BridgeProfileMaterializationReceipt
  transportAttempts: number
  lastEventId: number
  terminal: boolean
  cancelInFlight?: Promise<boolean>
}

interface BridgeProfileMaterializationReceipt {
  readonly schema: typeof bridgeProfileMaterializationSchema
  readonly effectiveProfileDigest: string
  readonly harness: string
  readonly provider: string | null
  /** Exact full bridge wire id, for example `pi/tangle-router/deepseek-v4-flash`. */
  readonly model: string
  readonly reasoningEffort: {
    readonly requested: ReasoningEffort | null
    /** Exact native argv/config value after the bridge's backend mapping. */
    readonly applied: string | null
  }
  readonly workspacePlanDigest: string
  readonly files: ReadonlyArray<{ path: string; mode: number }>
  readonly unsupported: ReadonlyArray<{ dimension: string; reason: string }>
}

/**
 * One resumable cli-bridge session, run as a streamed turn loop. Turn 0 sends the
 * task; each subsequent turn fires ONLY when the inbox has a steer/answer to fold —
 * re-calling the SAME `session_id` so cli-bridge resumes the harness conversation.
 * Mirrors `routerToolsInlineExecutor`'s drain→turn→settle loop, but each turn is a
 * full streamed harness session call rather than a single chat round.
 */
async function* streamBridgeSession(args: StreamBridgeArgs): AsyncIterable<UsageEvent> {
  const { seam, inbox, observation } = args
  const started = Date.now()
  const external = mergeAbortSignals(args.signal, args.controller.signal)
  const tokens = zeroTokenUsage()
  let tokensKnown = true
  let usd = 0
  let usdKnown = true
  let estimatedUsd = 0
  let sawEstimatedUsd = false
  let turns = 0
  let transportAttempts = 0
  let lastText = ''
  const toolCalls: string[] = []
  const promptCache: { freshInput?: number; readInput?: number; writeInput?: number } = {}

  // Turn 0 is the task; later turns carry the folded steer/answer as the next prompt
  // on the SAME session. `nextPrompt` is undefined once there's nothing pending.
  let nextPrompt: string | undefined = taskToPrompt(args.task)
  for (let t = 0; args.maxTurns === 0 || t < args.maxTurns; t += 1) {
    // Drain queued down-messages; on turns > 0 they ARE the prompt (resume content).
    const pending = inbox.drain()
    if (pending.length) {
      const folded = inbox.fold(pending)
      nextPrompt = t === 0 && nextPrompt ? `${nextPrompt}\n\n${folded}` : folded
      for (const m of pending) {
        observation.activity.push({
          at: Date.now(),
          kind: 'note',
          label: m.interrupt ? 'steer' : 'follow-up',
          detail: m.text.length > 80 ? `${m.text.slice(0, 77)}...` : m.text,
        })
      }
    }
    if (nextPrompt === undefined) break
    observation.note = `turn ${t}`

    // Each turn sends ONLY the new task/steer. The full canonical profile carries the standing
    // prompt, and cli-bridge materializes it once; duplicating it as a system message changes the
    // instructions and makes profile-vs-message precedence backend-dependent.
    const messages: Array<{ role: string; content: string }> = []
    messages.push({ role: 'user', content: nextPrompt })
    nextPrompt = undefined

    // Per-turn signal: external teardown/abort OR a forceful interrupt steer.
    const interruptSig = inbox.freshInterrupt()
    const turnController = new AbortController()
    const abortTurn = () => turnController.abort()
    if (external.aborted) turnController.abort()
    else external.addEventListener('abort', abortTurn)
    interruptSig.addEventListener('abort', abortTurn, { once: true })
    let timedOut = false
    const timer =
      seam.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true
            abortTurn()
          }, seam.timeoutMs)
        : undefined
    const cleanup = () => {
      external.removeEventListener('abort', abortTurn)
      if (timer) clearTimeout(timer)
    }

    const activeRun: ActiveBridgeRun = {
      id: `bridge-run-${randomUUID()}`,
      transportAttempts: 0,
      lastEventId: 0,
      terminal: false,
    }
    args.activeRuns.set(activeRun.id, activeRun)
    const requestBody = {
      model: seam.model,
      stream: true,
      run_id: activeRun.id,
      session_id: args.sessionId,
      ...(seam.cwd ? { cwd: seam.cwd } : {}),
      execution: {
        kind: 'host' as const,
        ...(seam.timeoutMs !== undefined ? { timeoutMs: seam.timeoutMs } : {}),
      },
      agent_profile: args.profile,
      messages,
    }

    let turnText = ''
    let sawTurnTokenUsage = false
    let turnTokensKnown = true
    let sawTurnCostStatus = false
    let turnUsdKnown = true
    let turnKnownCostSubtotal = 0
    let turnEstimatedCostSubtotal = 0
    let interrupted = false
    try {
      for await (const chunk of streamDurableBridgeRun({
        seam,
        profile: args.profile,
        sessionId: args.sessionId,
        body: requestBody,
        signal: turnController.signal,
        run: activeRun,
        maxReconnects: args.maxReconnects,
      })) {
        if (chunk.content) {
          turnText += chunk.content
        }
        for (const step of chunk.toolCalls ?? []) {
          toolCalls.push(step.toolName)
          observation.activity.push({
            at: Date.now(),
            kind: 'tool',
            label: step.toolName,
            // No `status`: the bridge reported the DECISION to call this tool, and nothing on
            // this wire ever reports the call finishing. An 'ok' here would be invented.
            ...(describeToolArgs(step.args) ? { detail: describeToolArgs(step.args) } : {}),
          })
          args.record(step)
        }
        if (chunk.usage) {
          sawTurnTokenUsage = true
          if (!chunk.usage.known) turnTokensKnown = false
          tokens.input += chunk.usage.input
          tokens.output += chunk.usage.output
          yield {
            kind: 'tokens',
            input: chunk.usage.input,
            output: chunk.usage.output,
            ...(chunk.usage.known ? {} : { tokensKnown: false }),
          }
          if (chunk.usage.promptCache) {
            if (chunk.usage.promptCache.freshInput !== undefined) {
              promptCache.freshInput =
                (promptCache.freshInput ?? 0) + chunk.usage.promptCache.freshInput
            }
            if (chunk.usage.promptCache.readInput !== undefined) {
              promptCache.readInput =
                (promptCache.readInput ?? 0) + chunk.usage.promptCache.readInput
            }
            if (chunk.usage.promptCache.writeInput !== undefined) {
              promptCache.writeInput =
                (promptCache.writeInput ?? 0) + chunk.usage.promptCache.writeInput
            }
          }
        }
        if (chunk.costKnown !== undefined) {
          sawTurnCostStatus = true
          if (!chunk.costKnown) turnUsdKnown = false
          // A trusted total is the complete charge for the turn. It supersedes earlier
          // incremental chunks that correctly reported that their subtotal was incomplete.
          if (chunk.costKnown && chunk.costScope === 'total') turnUsdKnown = true
        }
        if (typeof chunk.cost === 'number') {
          const increment =
            chunk.costScope === 'total' ? chunk.cost - turnKnownCostSubtotal : chunk.cost
          if (increment < 0) {
            throw new ValidationError('bridgeExecutor: total billed cost decreased within a turn')
          }
          turnKnownCostSubtotal += increment
          if (increment > 0) {
            usd += increment
            yield { kind: 'cost', usd: increment }
          }
        }
        if (typeof chunk.estimatedCost === 'number') {
          const increment =
            chunk.costScope === 'total'
              ? chunk.estimatedCost - turnEstimatedCostSubtotal
              : chunk.estimatedCost
          if (increment < 0) {
            throw new ValidationError(
              'bridgeExecutor: total estimated cost decreased within a turn',
            )
          }
          turnEstimatedCostSubtotal += increment
          estimatedUsd += increment
          sawEstimatedUsd = true
        }
      }
      args.onProfileMaterialization(activeRun.profileMaterialization!)
    } catch (error) {
      // A forceful steer first detaches this HTTP reader, then explicitly cancels
      // the durable run and waits for terminal proof. Starting the resume turn
      // before that acknowledgement would race two harness processes against one
      // resumable session.
      const interruptAbort =
        interruptSig.aborted && !args.signal.aborted && !args.controller.signal.aborted
      if (interruptAbort) {
        const terminal = await cancelBridgeRunToTerminal(seam, activeRun, 'infinity', external)
        if (!terminal) {
          throw new ValidationError(
            `bridgeExecutor: interrupted run ${activeRun.id} did not reach terminal state`,
          )
        }
        interrupted = true
      } else {
        // A per-turn timeout is owned here, not by the HTTP socket. Request
        // explicit cancellation before surfacing it; external scope teardown
        // performs the same operation under its own grace budget.
        if (timedOut && !activeRun.terminal) {
          await requestBridgeRunCancellation(seam, activeRun, 0)
        }
        throw error
      }
    } finally {
      transportAttempts += activeRun.transportAttempts
      cleanup()
    }
    // Some transports can finish a buffered body normally after their signal fires. The forceful
    // steer still wins and must become a new turn rather than letting this response settle.
    if (interruptSig.aborted && !args.signal.aborted && !args.controller.signal.aborted) {
      interrupted = true
    }
    turns += 1
    observation.turns = turns
    observation.activity.push({ at: Date.now(), kind: 'turn', label: `turn ${turns}` })
    if (!sawTurnTokenUsage || !turnTokensKnown) tokensKnown = false
    if (!sawTurnCostStatus || !turnUsdKnown) usdKnown = false
    yield { kind: 'iteration' }
    if (!interrupted && turnText) lastText = turnText

    if (interrupted) {
      observation.note = `turn ${turns} interrupted, resuming`
      continue
    }

    // Before settling, drain once more — the worker can't finish while a steer it
    // never read is pending (the sandbox/router settle contract). A pending steer
    // becomes the next resume turn; otherwise the session is truly done.
    if (inbox.pending() === 0) break
  }

  observation.note = 'settled'
  const spent: Spend = {
    iterations: turns,
    tokens,
    ...(tokensKnown ? {} : { tokensKnown: false }),
    usd,
    ...(usdKnown ? {} : { usdKnown: false }),
    ms: Date.now() - started,
  }
  const out = {
    content: lastText,
    model: seam.model,
    toolCalls,
    transportAttempts,
    ...(Object.keys(promptCache).length > 0 ? { promptCache } : {}),
    ...(sawEstimatedUsd ? { estimatedCostUsd: estimatedUsd } : {}),
  } as unknown
  args.onArtifact({
    outRef: contentRef('bridge', { model: seam.model, session: args.sessionId, content: lastText }),
    out,
    spent,
  })
}

const BRIDGE_CANCEL_LONG_POLL_MS = 30_000
const BRIDGE_BRUTAL_KILL_WAIT_MS = 150

interface StreamDurableBridgeRunArgs {
  seam: ResolvedBridgeSeam
  profile: AgentProfile
  sessionId: string
  body: unknown
  signal: AbortSignal
  run: ActiveBridgeRun
  maxReconnects: number
}

/**
 * Drain one server-owned bridge run. A transport loss replays from the last
 * contiguous event id under the SAME run id and request bytes. No unnumbered,
 * duplicate, or skipped event is accepted: an exact replay contract that
 * cannot prove continuity fails instead of returning a plausible partial answer.
 */
async function* streamDurableBridgeRun(
  args: StreamDurableBridgeRunArgs,
): AsyncIterable<BridgeStreamChunk> {
  await assertBridgeExecutionCapabilities(args.seam, args.signal)
  let reconnects = 0
  let pendingUpstreamError: ValidationError | undefined

  for (;;) {
    let res: BridgeResponse
    try {
      args.run.transportAttempts += 1
      res = await bridgeStreamPost(args.seam.bridgeUrl, {
        bearer: args.seam.bridgeBearer,
        sessionId: args.sessionId,
        runId: args.run.id,
        afterEventId: args.run.lastEventId,
        body: args.body,
        signal: args.signal,
      })
    } catch (error) {
      if (args.signal.aborted) throw error
      if (reconnects >= args.maxReconnects) {
        throw new ValidationError(
          `bridgeExecutor: run ${args.run.id} disconnected before terminal acknowledgement after ${reconnects + 1} attempts: ${errorMessage(error)}`,
        )
      }
      reconnects += 1
      continue
    }

    if (!res.ok) {
      throw new ValidationError(
        `bridgeExecutor: bridge ${res.status}: ${(await res.text()).slice(0, 300)}`,
      )
    }
    if (!res.body) {
      throw new ValidationError('bridgeExecutor: bridge response had no body to stream')
    }
    assertBridgeResponseIdentity(res, args.run)

    let sawDone = false
    try {
      for await (const event of parseSseChatStream(res.body)) {
        if (event.kind === 'done') {
          sawDone = true
          break
        }
        const expected = args.run.lastEventId + 1
        if (event.id !== expected) {
          throw new ValidationError(
            `bridgeExecutor: run ${args.run.id} replay gap: expected event ${expected}, received ${event.id}`,
          )
        }
        args.run.lastEventId = event.id
        if (event.error) pendingUpstreamError = event.error
        if (event.chunk?.profileMaterialization) {
          const receipt = assertBridgeProfileMaterialization(
            event.chunk.profileMaterialization,
            args.profile,
            args.seam.model,
          )
          if (
            args.run.profileMaterialization !== undefined &&
            JSON.stringify(args.run.profileMaterialization) !== JSON.stringify(receipt)
          ) {
            throw new ValidationError(
              `bridgeExecutor: run ${args.run.id} profile materialization changed across replay`,
            )
          }
          args.run.profileMaterialization = receipt
        }
        if (event.chunk) yield event.chunk
      }
    } catch (error) {
      if (args.signal.aborted) throw error
      if (error instanceof ValidationError) throw error
      if (reconnects >= args.maxReconnects) {
        throw new ValidationError(
          `bridgeExecutor: run ${args.run.id} stream disconnected before terminal acknowledgement after ${reconnects + 1} attempts: ${errorMessage(error)}`,
        )
      }
      reconnects += 1
      continue
    }

    if (sawDone) {
      if (args.run.profileMaterialization === undefined) {
        throw new ValidationError(
          `bridgeExecutor: run ${args.run.id} completed without ${bridgeProfileMaterializationSchema}`,
        )
      }
      args.run.terminal = true
      if (pendingUpstreamError) throw pendingUpstreamError
      return
    }
    // Preserve the provider's actual diagnostic even when a non-conforming
    // bridge drops the final [DONE]. The run remains nonterminal in our local
    // state, so teardown still has to cancel and obtain real terminal proof.
    if (pendingUpstreamError) throw pendingUpstreamError
    if (args.signal.aborted) {
      throw new DOMException('bridgeExecutor: turn aborted', 'AbortError')
    }
    if (reconnects >= args.maxReconnects) {
      throw new ValidationError(
        `bridgeExecutor: run ${args.run.id} ended without terminal acknowledgement after ${reconnects + 1} attempts`,
      )
    }
    reconnects += 1
  }
}

/** Refuse an old bridge before it can start a paid harness turn. This is intentionally uncached:
 * a process may restart behind the same URL, and a remembered capability from the prior process
 * is not evidence about the process that will receive the next POST. The terminal receipt remains
 * mandatory because the bridge can still restart between this GET and the run request. */
async function assertBridgeExecutionCapabilities(
  seam: BridgeSeam,
  signal: AbortSignal,
): Promise<void> {
  const target = new URL(`${seam.bridgeUrl.replace(/\/$/, '')}/`)
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  const response = await new Promise<BridgeBufferedResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('bridgeExecutor: aborted before capability preflight', 'AbortError'))
      return
    }
    const req = requestFn(
      target,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${seam.bridgeBearer}` },
        timeout: 0,
      },
      (res) => {
        void (async () => {
          const chunks: Buffer[] = []
          for await (const chunk of res) chunks.push(Buffer.from(chunk))
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })().catch(reject)
      },
    )
    const abort = () =>
      req.destroy(new DOMException('bridgeExecutor: preflight aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    req.on('error', reject)
    req.on('close', () => signal.removeEventListener('abort', abort))
    req.end()
  })
  if (response.status < 200 || response.status >= 300) {
    throw new ValidationError(
      `bridgeExecutor: capability preflight returned ${response.status}: ${response.text.slice(0, 200)}`,
    )
  }
  let body: { capabilities?: Record<string, unknown> }
  try {
    body = JSON.parse(response.text) as typeof body
  } catch {
    throw new ValidationError('bridgeExecutor: capability preflight returned invalid JSON')
  }
  if (body.capabilities?.profileMaterialization !== bridgeProfileMaterializationSchema) {
    throw new ValidationError(
      `bridgeExecutor: bridge does not advertise ${bridgeProfileMaterializationSchema}`,
    )
  }
  if (body.capabilities?.usageCostProvenance !== bridgeUsageCostSchema) {
    throw new ValidationError(`bridgeExecutor: bridge does not advertise ${bridgeUsageCostSchema}`)
  }
}

/** The subset of `Response` `streamBridgeSession` consumes: status gate, an error
 *  body reader, and a web `ReadableStream` the SSE parser drains. */
interface BridgeResponse {
  ok: boolean
  status: number
  headers: Readonly<Record<string, string | string[] | undefined>>
  text: () => Promise<string>
  body: ReadableStream<Uint8Array> | null
}

interface BridgeStreamPostArgs {
  bearer: string
  sessionId: string
  runId: string
  afterEventId: number
  body: unknown
  signal: AbortSignal
}

/**
 * POST one streamed turn to the cli-bridge over the `node:http(s)` core client
 * instead of global `fetch`. The bridge runs a harness CLI and streams SSE only
 * once that harness starts producing — first byte routinely arrives >5 min into a
 * heavy turn. `fetch` (undici) caps the wait for response headers at a fixed
 * `headersTimeout` (~300s) that no per-request option or `AbortSignal` overrides,
 * so it aborts a live-but-slow bridge with an opaque "Headers Timeout Error". The
 * core client has no such cap; the turn's `AbortSignal` (external teardown, a
 * forceful steer, or `seam.timeoutMs`) is the sole deadline. The response's
 * `IncomingMessage` (a Node `Readable`) is adapted to a web `ReadableStream` so the
 * shared `parseSseChatStream` consumes it unchanged.
 */
function bridgeStreamPost(url: string, args: BridgeStreamPostArgs): Promise<BridgeResponse> {
  const target = new URL(`${url.replace(/\/$/, '')}/v1/chat/completions`)
  const payload = JSON.stringify(args.body)
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<BridgeResponse>((resolve, reject) => {
    if (args.signal.aborted) {
      reject(new DOMException('bridgeExecutor: aborted before request', 'AbortError'))
      return
    }
    const req = requestFn(
      target,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${args.bearer}`,
          'x-session-id': args.sessionId,
          'x-run-id': args.runId,
          ...(args.afterEventId > 0 ? { 'last-event-id': String(args.afterEventId) } : {}),
          'content-length': Buffer.byteLength(payload),
        },
        // No header/body idle timeout: a slow bridge is a live bridge; the abort
        // signal is the sole deadline.
        timeout: 0,
      },
      (res) => {
        response = res
        res.once('close', () => args.signal.removeEventListener('abort', onAbort))
        const status = res.statusCode ?? 0
        const ok = status >= 200 && status < 300
        const body = Readable.toWeb(res) as ReadableStream<Uint8Array>
        resolve({
          ok,
          status,
          headers: res.headers,
          body,
          text: async () => {
            const chunks: Buffer[] = []
            for await (const c of res) chunks.push(c as Buffer)
            return Buffer.concat(chunks).toString('utf8')
          },
        })
      },
    )
    let response: Parameters<typeof Readable.toWeb>[0] | undefined
    const onAbort = (): void => {
      req.destroy(new DOMException('bridgeExecutor: turn aborted', 'AbortError'))
      if (response && 'destroy' in response && typeof response.destroy === 'function') {
        response.destroy(new DOMException('bridgeExecutor: turn aborted', 'AbortError'))
      }
    }
    if (args.signal.aborted) onAbort()
    else args.signal.addEventListener('abort', onAbort, { once: true })
    req.on('error', (e) => {
      args.signal.removeEventListener('abort', onAbort)
      reject(e)
    })
    req.on('close', () => {
      if (!response) args.signal.removeEventListener('abort', onAbort)
    })
    req.write(payload)
    req.end()
  })
}

interface BridgeBufferedResponse {
  status: number
  headers: Readonly<Record<string, string | string[] | undefined>>
  text: string
}

function bridgeHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const raw = headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw.length === 1 ? raw[0] : undefined
  return raw
}

function assertBridgeResponseIdentity(response: BridgeResponse, run: ActiveBridgeRun): void {
  assertBridgeIdentityHeaders(response.headers, run)
}

function assertBridgeIdentityHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  run: ActiveBridgeRun,
): void {
  const responseRunId = bridgeHeader(headers, 'x-run-id')
  if (responseRunId !== run.id) {
    throw new ValidationError(
      `bridgeExecutor: bridge run identity mismatch: expected ${run.id}, received ${responseRunId ?? 'missing'}`,
    )
  }
  const digest = bridgeHeader(headers, 'x-run-request-digest')
  if (!digest || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new ValidationError('bridgeExecutor: bridge response omitted a valid request digest')
  }
  if (run.requestDigest !== undefined && run.requestDigest !== digest) {
    throw new ValidationError(
      `bridgeExecutor: bridge request digest changed for run ${run.id}: expected ${run.requestDigest}, received ${digest}`,
    )
  }
  run.requestDigest = digest
}

/** Explicitly cancel one server-owned run and long-poll for its terminal snapshot. */
function bridgeCancelPost(
  seam: BridgeSeam,
  run: ActiveBridgeRun,
  waitMs: number,
): Promise<BridgeBufferedResponse> {
  const target = new URL(
    `${seam.bridgeUrl.replace(/\/$/, '')}/v1/runs/${encodeURIComponent(run.id)}/cancel`,
  )
  target.searchParams.set('wait_ms', String(waitMs))
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<BridgeBufferedResponse>((resolve, reject) => {
    const req = requestFn(
      target,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${seam.bridgeBearer}`,
          'x-run-id': run.id,
          'content-length': '0',
        },
        timeout: 0,
      },
      (res) => {
        void (async () => {
          const chunks: Buffer[] = []
          for await (const chunk of res) chunks.push(Buffer.from(chunk))
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })().catch(reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function requestBridgeRunCancellation(
  seam: BridgeSeam,
  run: ActiveBridgeRun,
  waitMs: number,
): Promise<boolean> {
  if (run.terminal) return true
  if (run.cancelInFlight) return run.cancelInFlight
  const work = (async (): Promise<boolean> => {
    const response = await bridgeCancelPost(seam, run, waitMs)
    if (response.status === 404) {
      throw new ValidationError(
        `bridgeExecutor: bridge no longer knows run ${run.id}; terminal state is unproven`,
      )
    }
    if (response.status !== 200 && response.status !== 202) {
      throw new ValidationError(
        `bridgeExecutor: cancel ${run.id} returned ${response.status}: ${response.text.slice(0, 300)}`,
      )
    }
    assertBridgeIdentityHeaders(response.headers, run)
    let parsed: {
      terminal?: unknown
      run?: { id?: unknown; requestDigest?: unknown; terminal?: unknown }
    }
    try {
      parsed = JSON.parse(response.text) as typeof parsed
    } catch {
      throw new ValidationError(`bridgeExecutor: cancel ${run.id} returned invalid JSON`)
    }
    if (
      parsed.run?.id !== run.id ||
      parsed.run.requestDigest !== run.requestDigest ||
      typeof parsed.terminal !== 'boolean' ||
      typeof parsed.run.terminal !== 'boolean' ||
      parsed.terminal !== parsed.run.terminal
    ) {
      throw new ValidationError(
        `bridgeExecutor: cancel ${run.id} returned an inconsistent terminal snapshot`,
      )
    }
    if (response.status === 200 && parsed.terminal === true) {
      run.terminal = true
      return true
    }
    if (response.status === 202 && parsed.terminal === false) return false
    throw new ValidationError(
      `bridgeExecutor: cancel ${run.id} status ${response.status} disagreed with terminal=${String(parsed.terminal)}`,
    )
  })()
  run.cancelInFlight = work
  try {
    return await work
  } finally {
    if (run.cancelInFlight === work) run.cancelInFlight = undefined
  }
}

async function cancelBridgeRunToTerminal(
  seam: BridgeSeam,
  run: ActiveBridgeRun,
  grace: number | 'brutalKill' | 'infinity',
  stopSignal?: AbortSignal,
): Promise<boolean> {
  if (run.terminal) return true
  const deadline =
    grace === 'infinity'
      ? undefined
      : Date.now() + (grace === 'brutalKill' ? BRIDGE_BRUTAL_KILL_WAIT_MS : Math.max(0, grace))
  let first = true
  for (;;) {
    const remaining = deadline === undefined ? BRIDGE_CANCEL_LONG_POLL_MS : deadline - Date.now()
    if (!first && remaining <= 0) return false
    if (!first && stopSignal?.aborted) return false
    const waitMs = Math.max(
      0,
      Math.min(
        stopSignal ? 1_000 : BRIDGE_CANCEL_LONG_POLL_MS,
        deadline === undefined ? remaining : Math.max(0, remaining),
      ),
    )
    const terminal = await requestBridgeRunCancellation(seam, run, waitMs)
    if (terminal) return true
    first = false
    if (deadline !== undefined && Date.now() >= deadline) return false
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface BridgeStreamChunk {
  content?: string
  /** Every tool call the delta carried, decoded into the shared tool-step currency. */
  toolCalls?: ReadonlyArray<ToolStepInput>
  usage?: {
    input: number
    output: number
    known: boolean
    promptCache?: { freshInput?: number; readInput?: number; writeInput?: number }
  }
  cost?: number
  costKnown?: boolean
  estimatedCost?: number
  costScope?: 'incremental' | 'total'
  profileMaterialization?: BridgeProfileMaterializationReceipt
}

function assertBridgeProfileMaterialization(
  value: unknown,
  profile: AgentProfile,
  wireModel: string | undefined,
): BridgeProfileMaterializationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('bridgeExecutor: profile materialization receipt must be an object')
  }
  const raw = value as Record<string, unknown>
  const exactKeys = [
    'effectiveProfileDigest',
    'files',
    'harness',
    'model',
    'provider',
    'reasoningEffort',
    'schema',
    'unsupported',
    'workspacePlanDigest',
  ]
  if (Object.keys(raw).sort().join(',') !== exactKeys.sort().join(',')) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has missing or unknown fields',
    )
  }
  if (raw.schema !== bridgeProfileMaterializationSchema) {
    throw new ValidationError(
      `bridgeExecutor: profile materialization receipt is not ${bridgeProfileMaterializationSchema}`,
    )
  }
  const effectiveProfileDigest = raw.effectiveProfileDigest
  if (
    typeof effectiveProfileDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(effectiveProfileDigest)
  ) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has an invalid effectiveProfileDigest',
    )
  }
  const expectedDigest = canonicalAgentProfileDigest(profile)
  if (effectiveProfileDigest !== expectedDigest) {
    throw new ValidationError(
      `bridgeExecutor: bridge materialized profile ${effectiveProfileDigest}, expected ${expectedDigest}`,
    )
  }
  if (typeof raw.harness !== 'string' || raw.harness.length === 0) {
    throw new ValidationError('bridgeExecutor: profile materialization receipt has no harness')
  }
  if (raw.provider !== null && (typeof raw.provider !== 'string' || raw.provider.length === 0)) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has invalid provider',
    )
  }
  if (typeof raw.model !== 'string' || raw.model.length === 0 || raw.model !== wireModel) {
    throw new ValidationError(
      `bridgeExecutor: bridge materialized model ${JSON.stringify(raw.model)}, expected ${JSON.stringify(wireModel)}`,
    )
  }
  const expectedHarness = agentHarness(profile.harness) ?? wireModel?.split('/')[0]
  if (!expectedHarness || raw.harness !== expectedHarness) {
    throw new ValidationError(
      `bridgeExecutor: bridge materialized harness ${JSON.stringify(raw.harness)}, expected ${JSON.stringify(expectedHarness)}`,
    )
  }
  const expectedProvider = profile.model?.provider ?? null
  if (expectedProvider !== null && raw.provider !== expectedProvider) {
    throw new ValidationError(
      `bridgeExecutor: bridge materialized provider ${JSON.stringify(raw.provider)}, expected ${JSON.stringify(expectedProvider)}`,
    )
  }
  if (
    !raw.reasoningEffort ||
    typeof raw.reasoningEffort !== 'object' ||
    Array.isArray(raw.reasoningEffort)
  ) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has invalid reasoningEffort',
    )
  }
  const reasoningEffort = raw.reasoningEffort as Record<string, unknown>
  if (Object.keys(reasoningEffort).sort().join(',') !== 'applied,requested') {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt reasoningEffort has missing or unknown fields',
    )
  }
  const requested = reasoningEffort.requested
  const applied = reasoningEffort.applied
  if (
    (requested !== null &&
      (typeof requested !== 'string' ||
        !REASONING_EFFORTS.includes(requested as ReasoningEffort))) ||
    (applied !== null && (typeof applied !== 'string' || applied.length === 0))
  ) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has invalid reasoning effort values',
    )
  }
  const expectedRequested = profile.model?.reasoningEffort ?? null
  const expectedApplied = expectedBridgeAppliedReasoning(raw.harness, expectedRequested)
  if (requested !== expectedRequested || applied !== expectedApplied) {
    throw new ValidationError(
      `bridgeExecutor: bridge materialized reasoning effort ${JSON.stringify({ requested, applied })}, expected ${JSON.stringify({ requested: expectedRequested, applied: expectedApplied })}`,
    )
  }
  if (
    typeof raw.workspacePlanDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(raw.workspacePlanDigest)
  ) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has invalid workspacePlanDigest',
    )
  }
  if (!Array.isArray(raw.files) || !Array.isArray(raw.unsupported)) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt files/unsupported must be arrays',
    )
  }
  const files = raw.files.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ValidationError('bridgeExecutor: profile materialization receipt has invalid file')
    }
    const file = entry as Record<string, unknown>
    if (
      Object.keys(file).sort().join(',') !== 'mode,path' ||
      typeof file.path !== 'string' ||
      file.path.length === 0 ||
      !Number.isSafeInteger(file.mode) ||
      (file.mode as number) < 0
    ) {
      throw new ValidationError('bridgeExecutor: profile materialization receipt has invalid file')
    }
    return { path: file.path, mode: file.mode as number }
  })
  const unsupported = raw.unsupported.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ValidationError(
        'bridgeExecutor: profile materialization receipt has invalid unsupported entry',
      )
    }
    const item = entry as Record<string, unknown>
    if (
      Object.keys(item).sort().join(',') !== 'dimension,reason' ||
      typeof item.dimension !== 'string' ||
      item.dimension.length === 0 ||
      typeof item.reason !== 'string' ||
      item.reason.length === 0
    ) {
      throw new ValidationError(
        'bridgeExecutor: profile materialization receipt has invalid unsupported entry',
      )
    }
    return { dimension: item.dimension, reason: item.reason }
  })
  if (unsupported.length > 0) {
    throw new ValidationError(
      `bridgeExecutor: bridge did not materialize profile dimensions: ${unsupported.map((item) => item.dimension).join(', ')}`,
    )
  }
  return Object.freeze({
    schema: bridgeProfileMaterializationSchema,
    effectiveProfileDigest,
    harness: raw.harness,
    provider: raw.provider as string | null,
    model: raw.model,
    reasoningEffort: {
      requested: requested as ReasoningEffort | null,
      applied: applied as string | null,
    },
    workspacePlanDigest: raw.workspacePlanDigest,
    files: Object.freeze(files),
    unsupported: Object.freeze(unsupported),
  })
}

/** Expected native control for the bridge backends that can emit the v2 acknowledgement. These
 * mappings mirror the actual cli-bridge argv functions, so the acknowledgement is checked against
 * what the process must have received rather than merely echoing the canonical request. */
function expectedBridgeAppliedReasoning(
  harness: string,
  requested: ReasoningEffort | null,
): string | null {
  if (requested === null) return null
  switch (harness) {
    case 'pi':
      if (requested === 'none') return 'off'
      return requested === 'ultracode' ? 'xhigh' : requested
    case 'claude-code':
      if (requested === 'none' || requested === 'minimal') return 'low'
      return requested === 'ultracode' ? 'max' : requested
    case 'codex':
      if (requested === 'none') return 'minimal'
      return requested === 'xhigh' || requested === 'ultracode' ? 'high' : requested
    case 'kimi-code':
      if (requested === 'medium') return null
      return requested === 'none' || requested === 'minimal' || requested === 'low'
        ? '--no-thinking'
        : '--thinking'
    case 'gemini':
      return null
    default:
      // OpenCode and bridge backends with direct reasoning variants preserve the canonical label.
      return requested
  }
}

/**
 * Decode the OpenAI-shaped `tool_calls` of one delta into the shared `ToolStepInput` currency,
 * through the SAME `decodeOpenAiPart` adapter the sandbox/parts trace source uses — the wire shape
 * cli-bridge emits (`{index, id, type:'function', function:{name, arguments}}`) is exactly the one
 * that decoder owns, so there is no second mapping to drift.
 *
 * FIDELITY, stated once: this wire carries the model's DECISION to call a tool. cli-bridge's
 * backends surface the call the moment the harness announces it and NEVER report the call
 * finishing, so no outcome, result, or duration exists to read. Each step is therefore marked
 * `statusCaptured: false` and carries no `startedAt`/`endedAt` — its span is an instant with no
 * status. Synthesising an end time would inject a fabricated 0ms latency, and defaulting to 'ok'
 * would count an unobserved call as a success; both would silently corrupt any downstream latency
 * or error-rate analysis. An honest lower-fidelity span beats a fabricated one. A harness whose
 * native protocol reports tool completion could carry true durations; this wire does not.
 *
 * cli-bridge emits each call complete in ONE delta (`{id, name, arguments}` together), so no
 * cross-delta argument-fragment assembly is needed; a frame that carries argument bytes without a
 * name decodes to nothing rather than to a nameless call.
 */
function decodeBridgeToolCalls(raw: unknown): ToolStepInput[] {
  if (!Array.isArray(raw)) return []
  const steps: ToolStepInput[] = []
  for (const call of raw) {
    if (!call || typeof call !== 'object') continue
    const record = call as Record<string, unknown>
    const fn = record.function as Record<string, unknown> | undefined
    // `type` is what `decodeOpenAiPart` matches on. A named function is a tool call whatever the
    // entry calls itself, and the previous parser keyed only on `function.name` — so normalize on
    // the name and never let an unrecognized `type` narrow what this executor observes. Dropping
    // one here also drops it from the public `out.toolCalls`.
    const named = typeof fn?.name === 'string' && fn.name.length > 0
    const step = decodeOpenAiPart(named ? { ...record, type: 'function' } : record)
    if (!step) continue
    const rawArgs = fn?.arguments ?? record.arguments
    const argsCaptured =
      typeof rawArgs === 'string' ? rawArgs.trim().length > 0 : rawArgs !== undefined
    steps.push({
      ...step,
      // An empty/absent `arguments` is an uncaptured argument list, not an empty one.
      ...(argsCaptured ? {} : { args: {}, argsCaptured: false }),
      statusCaptured: false,
    })
  }
  return steps
}

type BridgeSseEvent =
  | { kind: 'event'; id: number; chunk?: BridgeStreamChunk; error?: ValidationError }
  | { kind: 'done' }

/**
 * Parse cli-bridge's OpenAI-compatible SSE stream into normalized chunks. Each
 * `data:` line is an OpenAI chat-completion chunk (`choices[].delta`). Every
 * run-owned frame, including an id-only comment, is returned so the caller can
 * prove a contiguous replay sequence. Transport keepalives have no id and are ignored.
 */
async function* parseSseChatStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<BridgeSseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // SSE frames are separated by a blank line; split on it and keep the tail.
      let separator = /\r?\n\r?\n/u.exec(buf)
      while (separator) {
        const frame = buf.slice(0, separator.index)
        buf = buf.slice(separator.index + separator[0].length)
        const event = parseSseFrame(frame)
        if (event) yield event
        separator = /\r?\n\r?\n/u.exec(buf)
      }
    }
    buf += decoder.decode()
    // Upstream failures routinely arrive UNTERMINATED: a final `data:` frame
    // with no trailing blank line, or a bare JSON error body with no SSE
    // framing at all (kimi's access_terminated_error). Dropping the tail here
    // ends the stream as one empty zero-token turn — the integrity guard still
    // fails the run, but the diagnostic dies with the buffer. Parse the tail so
    // the upstream error message rides the thrown event instead.
    const tail = parseSseStreamTail(buf)
    if (tail !== undefined) yield tail
  } finally {
    reader.releaseLock()
  }
}

/** Parse the stream's unterminated tail: an SSE frame missing its trailing
 *  blank line, or a bare (non-SSE) JSON body — the shape bridge upstreams use
 *  for terminal failures. Throws `ValidationError` on an error payload; returns
 *  `undefined` for keepalive noise or non-JSON leftovers. */
function parseSseStreamTail(buf: string): BridgeSseEvent | undefined {
  const tail = buf.trim()
  if (!tail) return undefined
  const framed = parseSseFrame(tail)
  if (framed !== undefined) return framed
  let parsed: { error?: { message?: string; type?: string } }
  try {
    parsed = JSON.parse(tail)
  } catch {
    return undefined
  }
  if (parsed.error) {
    throw new ValidationError(
      `bridgeExecutor: bridge upstream error: ${parsed.error.message ?? parsed.error.type ?? 'unknown'}`,
    )
  }
  return undefined
}

/** Parse one SSE frame into a numbered run event, terminal marker, or unnumbered keepalive. */
function parseSseFrame(frame: string): BridgeSseEvent | undefined {
  const dataLines: string[] = []
  let id: number | undefined
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('id:')) {
      const rawId = line.slice('id:'.length).trim()
      if (!/^[1-9][0-9]*$/u.test(rawId)) {
        throw new ValidationError(`bridgeExecutor: invalid SSE event id ${JSON.stringify(rawId)}`)
      }
      const parsedId = Number(rawId)
      if (!Number.isSafeInteger(parsedId)) {
        throw new ValidationError(`bridgeExecutor: SSE event id exceeds safe integer range`)
      }
      id = parsedId
      continue
    }
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart())
  }
  if (dataLines.length === 0) {
    return id === undefined ? undefined : { kind: 'event', id }
  }
  const data = dataLines.join('\n')
  if (data === '[DONE]') return { kind: 'done' }
  let parsed: {
    choices?: Array<{
      delta?: {
        content?: string | null
        tool_calls?: unknown
      }
      message?: { content?: string | null }
    }>
    error?: { message?: string; type?: string }
    usage?: {
      prompt_tokens?: unknown
      completion_tokens?: unknown
      fresh_input_tokens?: unknown
      cache_read_input_tokens?: unknown
      cache_write_input_tokens?: unknown
      cost?: unknown
      estimated_cost?: unknown
      cost_known?: unknown
      cost_provenance?: unknown
      cost_scope?: unknown
      estimated?: unknown
    }
    profile_materialization?: unknown
  }
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new ValidationError('bridgeExecutor: bridge emitted a non-JSON SSE data frame')
  }
  if (id === undefined) {
    throw new ValidationError('bridgeExecutor: bridge emitted an unnumbered run event')
  }
  if (parsed.error) {
    // `type` is the upstream's error class (e.g. kimi's access_terminated_error)
    // — carry it when the payload has no message, never collapse to 'unknown'.
    return {
      kind: 'event',
      id,
      error: new ValidationError(
        `bridgeExecutor: bridge stream error: ${parsed.error.message ?? parsed.error.type ?? 'unknown'}`,
      ),
    }
  }
  const out: BridgeStreamChunk = {}
  const choice = parsed.choices?.[0]
  const content = choice?.delta?.content ?? choice?.message?.content
  if (typeof content === 'string' && content.length > 0) out.content = content
  const toolCalls = decodeBridgeToolCalls(choice?.delta?.tool_calls)
  if (toolCalls.length > 0) out.toolCalls = toolCalls
  const u = parsed.usage
  if (u) {
    const input = optionalBridgeTokenCount(u.prompt_tokens, 'prompt_tokens')
    const output = optionalBridgeTokenCount(u.completion_tokens, 'completion_tokens')
    const freshInput = optionalBridgeTokenCount(u.fresh_input_tokens, 'fresh_input_tokens')
    const readInput = optionalBridgeTokenCount(u.cache_read_input_tokens, 'cache_read_input_tokens')
    const writeInput = optionalBridgeTokenCount(
      u.cache_write_input_tokens,
      'cache_write_input_tokens',
    )
    if (
      input !== undefined ||
      output !== undefined ||
      freshInput !== undefined ||
      readInput !== undefined ||
      writeInput !== undefined
    ) {
      out.usage = {
        input: input ?? 0,
        output: output ?? 0,
        known: input !== undefined && output !== undefined && u.estimated !== true,
        ...(freshInput !== undefined || readInput !== undefined || writeInput !== undefined
          ? {
              promptCache: {
                ...(freshInput !== undefined ? { freshInput } : {}),
                ...(readInput !== undefined ? { readInput } : {}),
                ...(writeInput !== undefined ? { writeInput } : {}),
              },
            }
          : {}),
      }
    }
    if (u.estimated !== undefined && typeof u.estimated !== 'boolean') {
      throw new ValidationError('bridgeExecutor: usage.estimated must be boolean')
    }
    if (u.cost_scope !== undefined && u.cost_scope !== 'incremental' && u.cost_scope !== 'total') {
      throw new ValidationError("bridgeExecutor: usage.cost_scope must be 'incremental' or 'total'")
    }
    out.costScope = u.cost_scope === 'total' ? 'total' : 'incremental'
    applyBridgeCostReceipt(out, u)
  }
  if (parsed.profile_materialization !== undefined) {
    out.profileMaterialization =
      parsed.profile_materialization as BridgeProfileMaterializationReceipt
  }
  return {
    kind: 'event',
    id,
    ...(Object.keys(out).length > 0 ? { chunk: out } : {}),
  }
}

function optionalBridgeTokenCount(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ValidationError(`bridgeExecutor: usage.${field} must be a nonnegative safe integer`)
  }
  return value as number
}

function optionalBridgeMoney(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(`bridgeExecutor: usage.${field} must be a finite nonnegative number`)
  }
  return value
}

/** Admit billed spend only with explicit trusted provenance. A catalog estimate remains visible on
 * the result but can never debit a dollar budget or turn unknown dollars into a known zero. */
function applyBridgeCostReceipt(
  out: BridgeStreamChunk,
  usage: {
    cost?: unknown
    estimated_cost?: unknown
    cost_known?: unknown
    cost_provenance?: unknown
  },
): void {
  const cost = optionalBridgeMoney(usage.cost, 'cost')
  const estimatedCost = optionalBridgeMoney(usage.estimated_cost, 'estimated_cost')
  const provenance = usage.cost_provenance
  if (usage.cost_known !== true && usage.cost_known !== false) {
    throw new ValidationError('bridgeExecutor: usage.cost_known must be an explicit boolean')
  }
  if (usage.cost_known) {
    if (
      cost === undefined ||
      (provenance !== 'provider-receipt' && provenance !== 'billing-receipt') ||
      estimatedCost !== undefined
    ) {
      throw new ValidationError(
        'bridgeExecutor: known cost requires cost plus provider-receipt or billing-receipt provenance',
      )
    }
    out.costKnown = true
    out.cost = cost
    return
  }
  if (cost !== undefined) {
    throw new ValidationError('bridgeExecutor: unknown cost cannot carry billed cost')
  }
  if (estimatedCost !== undefined && provenance !== 'catalog-estimate') {
    throw new ValidationError('bridgeExecutor: estimated cost requires catalog-estimate provenance')
  }
  if (
    estimatedCost === undefined &&
    provenance !== undefined &&
    provenance !== 'catalog-estimate'
  ) {
    throw new ValidationError('bridgeExecutor: unknown cost has invalid provenance')
  }
  out.costKnown = false
  if (estimatedCost !== undefined) out.estimatedCost = estimatedCost
}

function bridgeWorktreeExecutor(
  spec: AgentSpec,
  ctx: ExecutorContext,
  seam: CliWorktreeSeam,
): Executor<WorktreeHarnessResult> {
  const bridge = seam.bridge
  if (!bridge) {
    throw new ValidationError('cliWorktreeExecutor: bridge transport missing')
  }
  if (!bridge.bridgeUrl || !bridge.bridgeBearer) {
    throw new ValidationError(
      'cliWorktreeExecutor: bridge.bridgeUrl + bridge.bridgeBearer required',
    )
  }

  const runId = seam.runId ?? randomUUID()
  const sessionId = bridge.sessionId ?? `bridge-worktree-${runId}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(runId)
  const effectiveProfile = agentProfileSchema.parse(spec.profile)
  const model = bridgeProfileModel(effectiveProfile, 'cliWorktreeExecutor bridge')
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

  const deliver = (msg: unknown): void => {
    if (inner?.deliver) {
      inner.deliver(msg)
      return
    }
    pending.push(msg)
  }

  const plannedDeclaration = {
    effectiveProfile,
    backend: 'bridge-worktree',
    model: { status: 'known' as const, id: model },
    execution: { kind: 'worktree-session', id: `${runId}:${sessionId}` },
    materializer: 'bridge-worktree-agent-profile',
    plan: {
      kind: 'bridge-worktree-session',
      runId,
      sessionId,
      baseRef: seam.baseRef ?? 'HEAD',
      model,
      testCmd: seam.testCmd ?? null,
      typecheckCmd: seam.typecheckCmd ?? null,
      checkTimeoutMs:
        seam.checkTimeoutMs ?? seam.harnessTimeoutMs ?? bridge.timeoutMs ?? 5 * 60 * 1000,
      checkOutputCap: seam.checkOutputCap ?? 16_000,
      bridgeAcknowledgement: null,
    },
  }
  const plannedBinding = {
    attemptId,
    binding: {
      bridgeUrl: bridge.bridgeUrl,
      effectiveProfile,
      model,
      repoRoot: seam.repoRoot,
      runId,
      sessionId,
    },
    descriptor: {
      kind: 'bridge-worktree-session',
      transport: 'http',
      backend: 'bridge-worktree',
    },
  }
  let executor!: Executor<WorktreeHarnessResult>
  executor = {
    runtime: 'cli' as Runtime,
    budgetExempt: seam.budgetExempt ?? false,
    deliver,
    execute(task, signal): AsyncIterable<UsageEvent> {
      return (async function* bridgeWorktreeStream() {
        const started = Date.now()
        const linked = mergeAbortSignals(signal, controller.signal)
        let bridgeArtifact: ExecutorResult<unknown> | undefined

        try {
          worktree = await createWorktree({
            repoRoot: seam.repoRoot,
            runId,
            ...(seam.baseRef ? { baseRef: seam.baseRef } : {}),
            ...(seam.runGit ? { runGit: seam.runGit } : {}),
          })
          removed = false

          const bridgeSeam: BridgeSeam = {
            bridgeUrl: bridge.bridgeUrl,
            bridgeBearer: bridge.bridgeBearer,
            cwd: worktree.path,
            sessionId,
            ...(bridge.timeoutMs !== undefined ? { timeoutMs: bridge.timeoutMs } : {}),
            ...(bridge.maxReconnects !== undefined ? { maxReconnects: bridge.maxReconnects } : {}),
          }
          const bridgeCtx: ExecutorContext = {
            ...ctx,
            signal: linked,
            seams: { ...ctx.seams, [bridgeSeamKey]: bridgeSeam },
          }
          inner = bridgeExecutor(spec, bridgeCtx)
          for (const msg of pending.splice(0)) inner.deliver?.(msg)

          const run = inner.execute(task, linked)
          if (isAsyncIterable<UsageEvent>(run)) {
            for await (const event of run) yield event
            bridgeArtifact = inner.resultArtifact()
          } else {
            bridgeArtifact = await run
          }

          const bridgeDeclaration = runtimeOwnedExecutorMaterialization(inner)
          const bridgeBinding = runtimeOwnedExecutorExecutionBinding(inner)
          if (bridgeDeclaration === undefined || bridgeBinding === undefined) {
            throw new ValidationError(
              'cliWorktreeExecutor: bridge completed without a terminal materialization acknowledgement',
            )
          }
          finalizeRuntimeOwnedPendingExecutor(
            executor,
            {
              ...plannedDeclaration,
              plan: {
                ...plannedDeclaration.plan,
                bridgeAcknowledgement: bridgeDeclaration.plan,
              },
            },
            {
              ...plannedBinding,
              binding: {
                ...plannedBinding.binding,
                worktreePath: worktree.path,
                bridgeBinding: bridgeBinding.binding,
              },
            },
          )

          const diff = await captureWorktreeDiff({
            worktree,
            ...(seam.runGit ? { runGit: seam.runGit } : {}),
          })
          const checks = await runWorktreeChecks({
            worktreePath: worktree.path,
            ...(seam.testCmd !== undefined ? { testCmd: seam.testCmd } : {}),
            ...(seam.typecheckCmd !== undefined ? { typecheckCmd: seam.typecheckCmd } : {}),
            timeoutMs:
              seam.checkTimeoutMs ?? seam.harnessTimeoutMs ?? bridge.timeoutMs ?? 5 * 60 * 1000,
            cap: seam.checkOutputCap ?? 16_000,
            ...(seam.runCommand ? { runCommand: seam.runCommand } : {}),
            signal: linked,
          })

          const result: WorktreeHarnessResult = {
            branch: worktree.branch,
            patch: diff.patch,
            stats: diff.stats,
            harness: {
              name: 'bridge',
              exitCode: null,
              timedOut: false,
              killedBySignal: null,
              durationMs: bridgeArtifact.spent.ms || Date.now() - started,
              stdout: bridgeOutputText(bridgeArtifact.out),
              stderr: '',
            },
            ...(checks ? { checks } : {}),
          }
          const spent: Spend = {
            ...bridgeArtifact.spent,
            ms: bridgeArtifact.spent.ms || Date.now() - started,
          }
          artifact = {
            outRef: contentRef('bridge-worktree', { sessionId, result }),
            out: result,
            spent,
          }
        } catch (err) {
          controller.abort()
          await inner?.teardown('brutalKill').catch(() => undefined)
          await cleanupWorktree()
          throw err
        }
      })()
    },
    async teardown(grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      let destroyed = true
      try {
        if (inner) {
          destroyed = (await inner.teardown(grace)).destroyed
        }
      } finally {
        await cleanupWorktree()
      }
      return { destroyed }
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError(
          'cliWorktreeExecutor: bridge resultArtifact() read before stream drained',
        )
      }
      return artifact
    },
  }
  return attestRuntimeOwnedPendingExecutor(executor, 'cli', plannedDeclaration, plannedBinding)
}

function bridgeOutputText(out: unknown): string {
  if (typeof out === 'string') return out
  if (out && typeof out === 'object') {
    const content = (out as { content?: unknown }).content
    if (typeof content === 'string') return content
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

// ── cli-worktree executor (authored profile → harness CLI on a git worktree) ────

/**
 * The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored
 * `AgentProfile` driving claude / codex / opencode on its own worktree. `budgetExempt` like
 * the other CLI leaves; the authored systemPrompt + model reach the harness via §1.5.
 */
export const cliWorktreeExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<CliWorktreeSeam>(ctx, cliWorktreeSeamKey, 'cli-worktree')
  if (!seam.repoRoot) {
    throw new ValidationError('cliWorktreeExecutor: CliWorktreeSeam.repoRoot required')
  }
  if (seam.bridge) return bridgeWorktreeExecutor(spec, ctx, seam)
  const effectiveProfile = agentProfileSchema.parse(spec.profile)
  assertExecutableAgentProfile(effectiveProfile, 'cliWorktreeExecutor')
  return createWorktreeCliExecutor({
    repoRoot: seam.repoRoot,
    profile: effectiveProfile,
    ...(seam.taskPrompt !== undefined ? { taskPrompt: seam.taskPrompt } : {}),
    ...(seam.runId ? { runId: seam.runId } : {}),
    ...(seam.baseRef ? { baseRef: seam.baseRef } : {}),
    ...(seam.harnessTimeoutMs !== undefined ? { harnessTimeoutMs: seam.harnessTimeoutMs } : {}),
    ...(seam.codexReproducible ? { codexReproducible: true } : {}),
    ...(seam.codexReadDeniedPaths ? { codexReadDeniedPaths: seam.codexReadDeniedPaths } : {}),
    ...(seam.testCmd !== undefined ? { testCmd: seam.testCmd } : {}),
    ...(seam.typecheckCmd !== undefined ? { typecheckCmd: seam.typecheckCmd } : {}),
    ...(seam.checkTimeoutMs !== undefined ? { checkTimeoutMs: seam.checkTimeoutMs } : {}),
    ...(seam.checkOutputCap !== undefined ? { checkOutputCap: seam.checkOutputCap } : {}),
    ...(seam.runGit ? { runGit: seam.runGit } : {}),
    ...(seam.runCommand ? { runCommand: seam.runCommand } : {}),
    ...(seam.budgetExempt !== undefined ? { budgetExempt: seam.budgetExempt } : {}),
    ...(ctx.node?.attemptId !== undefined ? { executionAttemptId: ctx.node.attemptId } : {}),
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
  | ({ backend: 'provider' } & ProviderSeam)
  | ({ backend: 'sandbox' } & SandboxSeam)

function assertExactConfigKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new ValidationError(
      `${context}: unknown fields ${unknown.sort().join(', ')}; execution behavior belongs in AgentProfile`,
    )
  }
}

/** Capture one public executor configuration at its call boundary. All data that selects policy,
 * model, process, limits, or backend behavior is detached and deeply frozen.
 * Explicit service/function fields remain live by reference because they are executable ports,
 * not portable configuration. */
export function snapshotExecutorConfig(config: ExecutorConfig): ExecutorConfig {
  switch (config.backend) {
    case 'router-tools': {
      const { complete, executeToolCall, onMessages, onToolStep, ...decisionData } = config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor router-tools config')
      return Object.freeze({
        ...snapshot,
        ...(complete === undefined ? {} : { complete }),
        executeToolCall,
        ...(onMessages === undefined ? {} : { onMessages }),
        ...(onToolStep === undefined ? {} : { onToolStep }),
      })
    }
    case 'router': {
      const { complete, ...decisionData } = config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor router config')
      return Object.freeze({
        ...snapshot,
        ...(complete === undefined ? {} : { complete }),
      })
    }
    case 'cli-worktree': {
      if (config.bridge) {
        assertExactConfigKeys(
          config.bridge as unknown as Readonly<Record<string, unknown>>,
          new Set(['bridgeBearer', 'bridgeUrl', 'maxReconnects', 'sessionId', 'timeoutMs']),
          'createExecutor cli-worktree bridge config',
        )
      }
      const { runGit, runCommand, ...decisionData } = config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor cli-worktree config')
      return Object.freeze({
        ...snapshot,
        ...(runGit === undefined ? {} : { runGit }),
        ...(runCommand === undefined ? {} : { runCommand }),
      })
    }
    case 'provider': {
      const { provider, registry, profileForCreate, taskToTurn, ...decisionData } = config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor provider config')
      // A registry is a live service. Resolve its mutable name mapping exactly once at intake and
      // retain the resulting provider instance, never the registry lookup for later execution.
      const resolvedProvider = resolveAgentEnvironmentProvider(provider, registry)
      return Object.freeze({
        ...snapshot,
        provider: resolvedProvider,
        ...(profileForCreate === undefined ? {} : { profileForCreate }),
        ...(taskToTurn === undefined ? {} : { taskToTurn }),
      })
    }
    case 'sandbox': {
      assertExactConfigKeys(
        config as unknown as Readonly<Record<string, unknown>>,
        new Set(['backend', 'lineage', 'loopCtx', 'maxIterations', 'sandboxClient', 'steering']),
        'createExecutor sandbox config',
      )
      const { sandboxClient, loopCtx, ...decisionData } = config
      if (loopCtx === undefined) {
        const snapshot = detachedSnapshot(decisionData, 'createExecutor sandbox config')
        return Object.freeze({ ...snapshot, sandboxClient })
      }
      const { hooks, traceEmitter, onSandboxEvent, runHandle, ...loopDecisionData } = loopCtx
      const snapshot = detachedSnapshot(
        { ...decisionData, loopCtx: loopDecisionData },
        'createExecutor sandbox config',
      )
      const loopSnapshot = snapshot.loopCtx
      return Object.freeze({
        ...snapshot,
        sandboxClient,
        loopCtx: Object.freeze({
          ...loopSnapshot,
          ...(hooks === undefined ? {} : { hooks }),
          ...(traceEmitter === undefined ? {} : { traceEmitter }),
          ...(onSandboxEvent === undefined ? {} : { onSandboxEvent }),
          ...(runHandle === undefined ? {} : { runHandle }),
        }),
      })
    }
    case 'bridge':
      assertExactConfigKeys(
        config as unknown as Readonly<Record<string, unknown>>,
        new Set([
          'activityWindow',
          'backend',
          'bridgeBearer',
          'bridgeUrl',
          'cwd',
          'maxReconnects',
          'sessionId',
          'timeoutMs',
        ]),
        'createExecutor bridge config',
      )
      return detachedSnapshot(config, 'createExecutor bridge config')
    case 'cli':
      return detachedSnapshot(config, `createExecutor ${config.backend} config`)
  }
}

/** A backend config reused for multiple workers/managers cannot pin execution identity. */
export function captureReusableExecutorConfig(
  config: ExecutorConfig,
  context: string,
): ExecutorConfig {
  const captured = snapshotExecutorConfig(config)
  const fixedIdentity =
    captured.backend === 'bridge' && captured.sessionId !== undefined
      ? 'sessionId'
      : captured.backend === 'cli-worktree' && captured.runId !== undefined
        ? 'runId'
        : captured.backend === 'cli-worktree' && captured.bridge?.sessionId !== undefined
          ? 'bridge.sessionId'
          : undefined
  if (fixedIdentity !== undefined) {
    throw new ValidationError(
      `${context}: fixed ${fixedIdentity} is not allowed on a reusable backend; let each execution derive an isolated id`,
    )
  }
  return captured
}

/** Bind one already-captured reusable backend to the durable identity of the execution that will
 * use it. Stateful bridge backends need an explicit external id: a random default isolates two
 * siblings but cannot reconnect a replacement process to the same harness session. Non-stateful
 * backends carry no external execution id and are returned unchanged. */
export function bindReusableExecutorExecutionId(
  captured: ExecutorConfig,
  executionId: string,
): ExecutorConfig {
  if (typeof executionId !== 'string' || executionId.length === 0) {
    throw new ValidationError(
      'bindReusableExecutorExecutionId: executionId must be a non-empty string',
    )
  }
  switch (captured.backend) {
    case 'bridge':
      return Object.freeze({ ...captured, sessionId: executionId })
    case 'cli-worktree':
      // The bridged worktree derives `bridge-worktree-${runId}` when no inner session id is set,
      // so this one durable value binds both the worktree and its resumed harness conversation.
      return Object.freeze({ ...captured, runId: executionId })
    case 'router':
    case 'router-tools':
    case 'cli':
    case 'provider':
    case 'sandbox':
      return captured
  }
}

/**
 * The single built-in executor factory. Picks a leaf backend by data (`config.backend`),
 * injects the matching seam, and delegates to that backend's built-in implementation.
 * The `Executor` port stays OPEN: bring-your-own agents implement `Executor` directly, while Scope
 * or `createExecutorRegistry` still parses and seals their exact profile before use. Use this instead of a
 * per-vendor adapter or a closed `inline|sandbox|cli` switch — those bypass the
 * `UsageEvent` reporting channel.
 */
export function createExecutor(config: ExecutorConfig): ExecutorFactory<unknown> {
  const captured = snapshotExecutorConfig(config)
  return (rawSpec, ctx) => {
    const spec = executableAgentSpecSnapshot(rawSpec, `createExecutor(${captured.backend})`)
    const { backend, ...seamData } = captured as ExecutorConfig & Record<string, unknown>
    const seam = Object.freeze(seamData)
    const seamed: ExecutorContext = { ...ctx, seams: { ...ctx.seams, [backend]: seam } }
    switch (captured.backend) {
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
      case 'provider': {
        const providerSeam = readSeam<ProviderSeam>(seamed, providerSeamKey, 'provider')
        const provider = resolveAgentEnvironmentProvider(
          providerSeam.provider,
          providerSeam.registry,
        )
        if (providerSeam.steering) {
          if (providerSeam.taskToTurn) {
            throw new ValidationError(
              'createExecutor(provider, steering): taskToTurn is not representable by the text-only steerable session',
            )
          }
          if (providerSeam.destroyOnSettle === false) {
            throw new ValidationError(
              'createExecutor(provider, steering): destroyOnSettle=false conflicts with the session-owned environment lifecycle',
            )
          }
          const harness = requiredProviderProfileHarness(spec, providerSeam)
          const sandboxClient = providerAsSandboxClient(provider, {
            defaults: {
              ...(providerSeam.defaults ?? {}),
              signal: seamed.signal,
            },
            requireTerminalEvent: providerSeam.requireTerminalEvent,
            requireSession: true,
          })
          const providerCtx: ExecutorContext = {
            ...seamed,
            seams: {
              ...seamed.seams,
              [sandboxSeamKey]: {
                sandboxClient,
                steering: providerSeam.steering,
              } satisfies SandboxSeam,
            },
          }
          const executor = sandboxExecutor({ ...spec, harness }, providerCtx)
          return {
            ...executor,
            runtime: providerSeam.runtime ?? (provider.name as Runtime),
          }
        }
        const profileForCreate = providerSeam.profileForCreate
        return providerAsExecutor(provider, {
          ...providerSeam,
          profileForCreate: (profile) => {
            const prepared = executableAgentProfileSnapshot(
              profileForCreate?.(profile) ?? profile,
              'createExecutor(provider)',
            )
            if (canonicalAgentProfileDigest(prepared) !== canonicalAgentProfileDigest(profile)) {
              throw new ValidationError(
                'createExecutor(provider): profileForCreate changed the exact AgentProfile; execution overlays are not allowed',
              )
            }
            return prepared
          },
        })(spec, seamed)
      }
      case 'sandbox': {
        const harness = spec.profile.harness as BackendType
        if (spec.harness != null && spec.harness !== harness) {
          throw new ValidationError(
            `createExecutor(sandbox): AgentSpec.harness ${JSON.stringify(spec.harness)} conflicts with AgentProfile.harness ${JSON.stringify(harness)}`,
          )
        }
        return sandboxExecutor({ ...spec, harness }, seamed)
      }
    }
  }
}

function requiredProviderProfileHarness(spec: AgentSpec, seam: ProviderSeam): BackendType {
  const harness = spec.profile.harness
  if (harness === undefined) {
    throw new ValidationError(
      'createExecutor(provider, steering): AgentProfile.harness is required',
    )
  }
  if (spec.harness != null && spec.harness !== harness) {
    throw new ValidationError(
      `createExecutor(provider, steering): AgentSpec.harness "${spec.harness}" conflicts with AgentProfile.harness "${harness}"`,
    )
  }
  if (seam.defaults?.backend !== undefined && seam.defaults.backend !== harness) {
    throw new ValidationError(
      `createExecutor(provider, steering): provider default backend "${seam.defaults.backend}" conflicts with AgentProfile.harness "${harness}"`,
    )
  }
  return harness as BackendType
}

// ── The open registry ──────────────────────────────────────────────────────────

/**
 * The open resolver/registry. Pre-registers the three built-ins under their
 * runtime tags (`'router'`, `'sandbox'`, `'cli'`) and accepts `register(name,
 * factory)` for any additional runtime. A BYO `AgentSpec.executor` has highest routing precedence
 * after the same exact-profile intake validation. Registration + BYO remain open extension points.
 *
 * `resolve` precedence (frozen in `ExecutorRegistry`): a BYO `spec.executorFactory` →
 * `spec.executor` → `harness === null` → the `'router'` factory; else a registered factory for the
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
      rawSpec: AgentSpec,
    ): { succeeded: true; value: ExecutorFactory<Out> } | { succeeded: false; error: string } {
      const spec = executableAgentSpecSnapshot(rawSpec, 'executor registry')
      const bind =
        (factory: ExecutorFactory<Out>): ExecutorFactory<Out> =>
        (_ignored, context) =>
          factory(spec, context)
      // BYO factory: constructed only after Scope admission with the real signal/context.
      if (spec.executorFactory) {
        return {
          succeeded: true,
          value: bind(spec.executorFactory as ExecutorFactory<Out>),
        }
      }
      // BYO: a caller-supplied executor wins, wrapped in a trivial per-spawn factory.
      if (spec.executor) {
        const byo = spec.executor
        return { succeeded: true, value: bind(() => byo as Executor<Out>) }
      }
      // router/inline: an agent with no harness is a direct Router call.
      if (spec.harness === null) {
        const f = factories.get('router')
        if (!f) return { succeeded: false, error: 'executor registry: no "router" factory' }
        return { succeeded: true, value: bind(f as ExecutorFactory<Out>) }
      }
      // sandbox: any BackendType maps to the sandbox-composing-runAgentRounds executor.
      const runtimeTag: Runtime = 'sandbox'
      const f = factories.get(runtimeTag)
      if (!f) {
        return {
          succeeded: false,
          error: `executor registry: no factory for runtime "${runtimeTag}" (harness "${spec.harness}") and no BYO executor`,
        }
      }
      return { succeeded: true, value: bind(f as ExecutorFactory<Out>) }
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
 *  with a `prompt`/`content`/`task` string field uses it; otherwise it serializes.
 *  Module-exported (not package surface) so sibling leaf executors read a task
 *  identically instead of re-deriving the rule. */
export function taskToPrompt(task: unknown): string {
  if (typeof task === 'string') return task
  if (task && typeof task === 'object') {
    const obj = task as Record<string, unknown>
    for (const k of ['prompt', 'content', 'task', 'message']) {
      if (typeof obj[k] === 'string') return obj[k] as string
    }
  }
  return JSON.stringify(task)
}

interface RouterProfileExecution {
  systemPrompt: string
  reasoningEffort?: ReasoningEffort
  temperature?: number
  maxTokens?: number
  retry?: ProfileModelExecutionSettings['retry']
  seed?: number
  toolChoice?: 'auto' | 'required' | 'none'
  extraBody?: Readonly<Record<string, unknown>>
  maxTurns?: number
  stream?: boolean
}

/** Validate and render every AgentProfile axis the direct Router path claims to carry.
 * Unsupported behavioral axes fail before the HTTP request; inline resources become
 * named system-prompt attachments because this executor has no workspace to mount. */
function routerProfileExecution(
  profile: AgentProfile,
  seam: RouterSeam,
  mode: { multiTurn: boolean },
): RouterProfileExecution {
  assertProfileMaterialization({
    contract: routerTurnProfileMaterialization,
    changedAxes: profileMaterializationAxes(profile),
    context: 'routerInlineExecutor',
  })

  if (agentHarness(profile.harness) !== undefined) {
    throw new ValidationError(
      `routerInlineExecutor: AgentProfile.harness ${JSON.stringify(profile.harness)} requires a harness executor; the direct Router executor cannot materialize it`,
    )
  }

  const profileEffort = profile.model?.reasoningEffort
  const settings = profileModelExecutionSettings(profile, 'routerInlineExecutor')

  if (!mode.multiTurn && settings.maxTurns !== undefined) {
    throw new ValidationError(
      'routerInlineExecutor: AgentProfile.model.metadata.maxTurns requires the router-tools backend',
    )
  }
  if (settings.stream === true && seam.tools === undefined) {
    throw new ValidationError(
      'routerInlineExecutor: streamed chat without tool schemas is not supported; omit stream or use a harness executor',
    )
  }

  const declaredTools = profile.tools ?? {}
  const suppliedTools = seam.tools ?? []
  if (settings.toolChoice !== undefined && suppliedTools.length === 0) {
    throw new ValidationError(
      'routerInlineExecutor: AgentProfile.model.metadata.toolChoice requires at least one enabled tool',
    )
  }
  const suppliedNames = new Set<string>()
  for (const tool of suppliedTools) {
    const name = tool.function.name
    if (!name || suppliedNames.has(name)) {
      throw new ValidationError(
        `routerInlineExecutor: caller tool names must be non-empty and unique (${JSON.stringify(name)})`,
      )
    }
    suppliedNames.add(name)
    if (declaredTools[name] !== true) {
      throw new ValidationError(
        `routerInlineExecutor: caller tool ${JSON.stringify(name)} is not enabled by AgentProfile.tools`,
      )
    }
  }
  for (const [name, enabled] of Object.entries(declaredTools)) {
    if (enabled && !suppliedNames.has(name)) {
      throw new ValidationError(
        `routerInlineExecutor: AgentProfile enables tool ${JSON.stringify(name)} but the caller supplied no matching schema`,
      )
    }
    if (!enabled && suppliedNames.has(name)) {
      throw new ValidationError(
        `routerInlineExecutor: AgentProfile disables tool ${JSON.stringify(name)}`,
      )
    }
  }

  return {
    systemPrompt: renderRouterProfilePrompt(profile),
    ...(profileEffort ? { reasoningEffort: profileEffort } : {}),
    ...settings,
  }
}

/** Resolve the one model id that will cross the Router boundary from the exact profile only. */
function exactRouterModel(profile: AgentProfile, context: string): string {
  assertExecutableAgentProfile(profile, context)
  if (agentHarness(profile.harness) !== undefined) {
    throw new ValidationError(
      `${context}: AgentProfile.harness ${JSON.stringify(profile.harness)} conflicts with direct Router execution; use "cli-base"`,
    )
  }
  return concreteProfileModel(profile)!
}

function renderRouterProfilePrompt(profile: AgentProfile): string {
  const sections: string[] = [
    profile.prompt?.systemPrompt,
    ...(profile.prompt?.instructions ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const resources = profile.resources
  if (!resources) return sections.join('\n')

  if (typeof resources.instructions === 'string') {
    if (resources.instructions.trim()) sections.push(resources.instructions)
  } else if (resources.instructions) {
    sections.push(renderRouterResource('instructions', resources.instructions))
  }
  for (const file of resources.files ?? []) {
    if (file.executable === true) {
      throw new ValidationError(
        `routerInlineExecutor: executable resource ${JSON.stringify(file.path)} requires a workspace backend`,
      )
    }
    sections.push(renderRouterResource(`file ${file.path}`, file.resource))
  }
  for (const [kind, refs] of [
    ['tool', resources.tools],
    ['skill', resources.skills],
    ['agent', resources.agents],
    ['command', resources.commands],
  ] as const) {
    for (const ref of refs ?? []) sections.push(renderRouterResource(kind, ref))
  }
  return sections.join('\n\n')
}

function renderRouterResource(kind: string, resource: AgentProfileResourceRef): string {
  if (resource.kind !== 'inline') {
    throw new ValidationError(
      `routerInlineExecutor: ${kind} resource ${JSON.stringify(resource.name ?? resource.path)} is not inline and cannot be resolved by the direct Router executor`,
    )
  }
  return `## Attached ${kind}: ${resource.name}\n${resource.content}`
}

/** Router messages from the opaque task + every portable profile prompt instruction.
 * The profile prompt is always the immutable first message. Later system-role messages are
 * preserved as per-call task context; they cannot replace or precede the profile policy. */
function taskToMessages(
  task: unknown,
  spec: AgentSpec,
  resolvedSystem?: string,
): Array<{ role: string; content: unknown } & Record<string, unknown>> {
  const system =
    resolvedSystem ??
    [spec.profile.prompt?.systemPrompt, ...(spec.profile.prompt?.instructions ?? [])]
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      .join('\n')

  if (
    task &&
    typeof task === 'object' &&
    Array.isArray((task as { messages?: unknown }).messages)
  ) {
    const supplied = (task as { messages: unknown[] }).messages.map((value, index) => {
      if (!value || typeof value !== 'object') {
        throw new ValidationError(`routerInlineExecutor: messages[${index}] must be an object`)
      }
      const message = { ...(value as Record<string, unknown>) }
      if (typeof message.role !== 'string' || !('content' in message)) {
        throw new ValidationError(
          `routerInlineExecutor: messages[${index}] requires role and content`,
        )
      }
      return message as { role: string; content: unknown } & Record<string, unknown>
    })
    if (system.length > 0 && !(supplied[0]?.role === 'system' && supplied[0].content === system)) {
      return [{ role: 'system', content: system }, ...supplied]
    }
    return supplied
  }

  return [
    ...(system.length > 0 ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: taskToPrompt(task) },
  ]
}

/** A driver that refines a single task up to `maxIterations` times then stops —
 *  the minimal policy that lets the sandbox executor run `runAgentRounds` as one leaf. */
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
 *  which needs >=20.3 — the package floor is >=20). Module-exported (not package surface) so
 *  sibling leaf executors share the one portable implementation. */
export function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
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
