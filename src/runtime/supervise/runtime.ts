/** Built-in executor configuration and selection over the shared Executor contract. */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { estimateCost, isModelPriced } from '@tangle-network/agent-eval'
import {
  type AgentProfile,
  type AgentProfileResourceRef,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  profileMaterializationAxes,
  type ReasoningEffort,
} from '@tangle-network/agent-interface'
import type { BackendType, SandboxEvent } from '@tangle-network/sandbox'
import {
  assertProfileMaterialization,
  defineProfileMaterializationContract,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import type { runLocalHarness } from '../../mcp/local-harness'
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
import { observedModelMatchesDeclared } from '../model-identity'
import { selectProviderPlacement } from '../provider-placement'
import {
  type PromptCacheUsage,
  type RouterChatResult,
  type RouterChatToolsResult,
  type RouterConfig,
  routerChatWithTools,
  routerChatWithUsage,
  routerTransportAttemptsFromError,
  streamRouterChatWithTools,
  type ToolSpec,
} from '../router-client'
import { type RunAgentRoundsOptions, runAgentRounds } from '../run-loop'
import {
  type SandboxLeafOut,
  type SandboxOutputMarker,
  sandboxLeafOutputFromEvents,
} from '../sandbox-executor-output'
import type {
  AgentRunSpec,
  Driver,
  ExecCtx,
  Iteration,
  OutputAdapter,
  SandboxClient,
  Validator,
} from '../types'
import {
  addTokenUsage,
  cloneTokenUsage,
  promptCacheTokenClasses,
  roundBoxMinutes,
  unmeteredSpend,
  zeroTokenUsage,
} from '../util'
import { linkAbort } from './abortable'
import { type BridgeSeam, bridgeSeamKey, validateBridgeModelCredential } from './bridge-config'
import { bridgeExecutor, bridgeProfileModel } from './bridge-executor'
import { executableAgentProfileSnapshot, executableAgentSpecSnapshot } from './executable-spec'
import { contentRef } from './executor-outcome'
import { assertExactConfigKeys, readSeam } from './executor-seams'
import { createInPlaceCliExecutor } from './in-place-cli-executor'
import { createInbox } from './inbox'
import {
  attestRuntimeOwnedExecutor,
  attestRuntimeOwnedPendingExecutor,
  finalizeRuntimeOwnedPendingExecutor,
  inheritRuntimeOwnedExecutorAttestation,
  newExecutionAttemptId,
  recordRuntimeOwnedProviderAttemptStart,
  recordRuntimeOwnedProviderModel,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
} from './materialization'
import {
  assertExecutableAgentProfile,
  concreteProfileModel,
  enforceTokenLimits,
  type ProfileModelExecutionSettings,
  profileModelExecutionSettings,
  profileProviderModel,
  type TokenLimitDecision,
} from './model-policy'
import type { ExecutorProgress } from './progress'
import { addResourceSpend } from './resources'
import { createSteerableSandboxSession, type SandboxSteeringOptions } from './sandbox-session'
import { detachedSnapshot } from './snapshot'
import { taskToPrompt } from './task-prompt'
import type { TraceSource } from './trace-source'
import type {
  AgentSpec,
  DefaultVerdict,
  Executor,
  ExecutorCancellation,
  ExecutorContext,
  ExecutorFactory,
  ExecutorRegistry,
  ExecutorResult,
  ExecutorToolCall,
  Runtime,
  Spend,
  UsageEvent,
} from './types'
import { WORKER_TRACE_PROPAGATION, workerTraceEnv } from './worker-trace'
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

/**
 * Materialization contract for one direct Router turn.
 *
 * `resourceFailOnError` is carried: this executor has no workspace, so it inlines resource content
 * into the system prompt and applies the profile's own resource-failure policy while it does so
 * (`renderRouterProfilePrompt`). No value of the field is dropped — a strict profile fails closed
 * on a resource that cannot be inlined, and a best-effort profile is refused because this path has
 * no way to report a skipped resource.
 */
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
    'modelMaxVisibleOutputTokens',
    'modelMaxTotalOutputTokens',
    'modelMetadata',
    'harness',
    'tools',
    'files',
    'resourceTools',
    'skills',
    'resourceAgents',
    'commands',
    'resourceInstructions',
    'resourceFailOnError',
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
   * OPT-IN executable score for this worker. Forwarded to the composed
   * `runAgentRounds` as its `validator`, so the kernel calls `validate` while the
   * iteration's box is still alive: `ValidationCtx.box` is a LIVE `SandboxInstance`
   * and the check can run commands or read files in the container it is scoring.
   * Every other supervised hook fires after teardown and can only read the artifact.
   *
   * The resulting verdict becomes the winner's verdict, which this executor already
   * surfaces on its `ExecutorResult`. Absent, nothing changes: the loop runs
   * unscored and the leaf falls back to its own settle verdict.
   *
   * Not representable with `steering` — a steerable session is a multi-turn session
   * on one box, not a `runAgentRounds` composition, so the pair is rejected instead
   * of silently dropping the score.
   */
  validator?: Validator<SandboxLeafOut>
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

export type { SandboxLeafOut, SandboxOutputMarker } from '../sandbox-executor-output'

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

/**
 * cli-in-place seam. A supervisor-authored `AgentProfile` driving a local coding-harness CLI
 * (claude-code / codex / opencode / pi) on a workspace the CALLER supplies — the leaf
 * `createInPlaceCliExecutor` named as data. `workspacePath` is transport data;
 * `AgentProfile.harness` selects the CLI, and the authored `profile.prompt.systemPrompt` +
 * `profile.model.default` reach the harness via the §1.5 `harnessInvocation` mapper.
 *
 * READ THIS BEFORE CHOOSING BETWEEN THIS AND `cli-worktree`. They differ in ONE thing, and it is
 * the thing that decides which one a caller wants:
 *
 *   - `cli-worktree` cuts a git worktree of its OWN off `repoRoot`, runs the harness there,
 *     returns the captured patch, and removes the worktree at teardown. The directory it was
 *     given is never edited. That is correct for a fanout of N candidate authors that must not
 *     clobber each other, and for a caller whose deliverable IS the patch.
 *   - `cli-in-place` runs the harness in `workspacePath` itself. The edits stay in that directory
 *     after the call, so the NEXT call sees them. That is what a caller needs when the workspace
 *     has to persist between calls — a multi-shot author resuming on top of its own edits
 *     (`agenticGenerator`), or a candidate directory the caller commits itself.
 *
 * Because the workspace persists, so would the profile inputs this path materializes into it. They
 * are removed before the call returns, so the directory a caller inspects afterwards holds the
 * harness's own edits and nothing else, and a `git status` over it answers "did the author change
 * anything" rather than "did Runtime write a settings file".
 *
 * There is no reproducible-Codex mode here: that mode stages an executable and a write probe INTO
 * its working directory, which a caller-owned workspace is not the place for. Use `cli-worktree`
 * with `codexReproducible` when the isolated, metered Codex run is what you want.
 */
export interface CliInPlaceSeam {
  /** Absolute path to the EXISTING directory the harness edits. Runtime never creates, cleans, or
   *  removes it. */
  workspacePath: string
  taskPrompt?: string
  harnessTimeoutMs?: number
  /** Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`. */
  runHarness?: typeof runLocalHarness
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
 * Generic environment provider executor config. External packages implement
 * `AgentEnvironmentProvider`; this built-in wrapper lets `createExecutor` consume them as backend
 * data while preserving the existing usage channel. Runtime depends on no provider package, so a
 * Tangle provider and a hand-written one compose identically. Worked wiring:
 * `examples/provider-executor/`.
 *
 * Everything a create needs travels on `CreateAgentEnvironmentInput` through
 * {@link ProviderExecutorOptions.defaults}; everything one turn needs travels on
 * {@link ProviderExecutorOptions.promptOptions}. Wrapping the provider's own client to reach a
 * field is what this seam exists to replace: the wrapper is invisible to Runtime, so its options
 * are absent from every record the run produces.
 *
 * READINESS IS THE PROVIDER'S CONTRACT. `provider.create` resolves with an environment that can
 * take a turn, so this seam streams straight into it and adds no readiness wait of its own. The
 * sandbox seam's `acquireSandbox` exists because a raw `SandboxClient.create` returns before the
 * box is ready; a second poll here would hide a provider that does not honor the contract, and
 * that provider is an upstream defect to report rather than a race to paper over.
 */
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

const cliWorktreeSeamKey = 'cli-worktree'

const cliInPlaceSeamKey = 'cli-in-place'

const providerSeamKey = 'provider'

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
/**
 * The honest answer for a backend with no cancel operation: the local request stopped, and
 * nothing about the remote run is known. Never `accepted` — a client that advertises provider
 * cancellation from this would claim more than Runtime observed.
 */
function localAbortCancellation(detail: string): ExecutorCancellation {
  return {
    status: 'unknown',
    effect: 'cancel_requested',
    observedAt: new Date().toISOString(),
    detail,
  }
}

export const routerInlineExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<RouterSeam>(ctx, routerSeamKey, 'router/inline')
  const model = exactRouterModel(spec.profile, 'routerInlineExecutor')
  if (!seam.routerBaseUrl || !seam.routerKey) {
    throw new ValidationError('routerInlineExecutor: RouterSeam.routerBaseUrl + routerKey required')
  }
  const profileExecution = routerProfileExecution(spec.profile, seam, { multiTurn: false })
  const requestIdentity = routerRequestIdentity(ctx)

  const controller = linkAbort(ctx.signal)

  let artifact: ExecutorResult<unknown> | undefined
  const executionId = ctx.node?.nodeId ?? `router-request-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)

  let executor!: Executor<unknown>
  executor = attestRuntimeOwnedExecutor(
    {
      runtime: 'router' as Runtime,
      async execute(task, signal): Promise<ExecutorResult<unknown>> {
        const messages = taskToMessages(task, spec, profileExecution.systemPrompt)
        const started = Date.now()
        const linked = linkAbort(signal, controller.signal).signal
        const extraBody = {
          ...(profileExecution.extraBody ?? {}),
          ...(profileExecution.reasoningEffort
            ? { reasoning_effort: profileExecution.reasoningEffort }
            : {}),
        }
        recordRuntimeOwnedProviderAttemptStart(executor)
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
                    ...profileExecution.tokenLimits.applied,
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
                    ...profileExecution.tokenLimits.applied,
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
        if (r.model !== undefined) recordRuntimeOwnedProviderModel(executor, r.model)
        const spent: Spend = {
          ...addResourceSpend(r.resources),
          iterations: 1,
          tokens: r.usage
            ? cloneTokenUsage({
                input: r.usage.input,
                output: r.usage.output,
                ...promptCacheTokenClasses(r.usage.input, r.cache),
              })
            : zeroTokenUsage(),
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
      cancel(_request): Promise<ExecutorCancellation> {
        controller.abort('executor cancelled')
        return Promise.resolve(
          localAbortCancellation(
            'the Router chat-completions API exposes no cancel operation; the local request was aborted and the provider may still bill the completion',
          ),
        )
      },
      teardown(_grace): Promise<{ destroyed: boolean }> {
        controller.abort('executor torn down')
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
        tokenLimits: profileExecution.tokenLimits,
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
  return executor
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

  const controller = linkAbort(ctx.signal)

  // The down-leg receive end: the driver's steer/answer/resume land here via `Scope.send`.
  const inbox = createInbox()

  let artifact: ExecutorResult<unknown> | undefined
  const executionId = ctx.node?.nodeId ?? `router-tools-run-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)

  let executor!: Executor<unknown>
  executor = attestRuntimeOwnedExecutor(
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
        let resources: Spend['resources']
        let transportAttempts = 0
        let observedModel: string | undefined
        let reasoningTokens = 0
        let reasoningKnown = true
        const promptCache: Record<string, number | string> = {}
        let lastText = ''
        // Every call this loop decided to make, in order. The count of executed calls is
        // `executedToolCalls.length`; the entries themselves keep the per-call detail the
        // terminal artifact publishes.
        const executedToolCalls: ExecutorToolCall[] = []
        // Fold any queued down-messages into the conversation as one operator turn (the boundary flush).
        const flush = () => {
          const pending = inbox.drain()
          if (pending.length) messages.push({ role: 'user', content: inbox.fold(pending) })
        }

        // The external abort sources (caller signal + executor teardown), merged ONCE — so we don't
        // re-register listeners on these long-lived signals every turn.
        const external = linkAbort(signal, controller.signal).signal

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
              recordRuntimeOwnedProviderAttemptStart(executor)
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
                  ...profileExecution.tokenLimits.applied,
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
              // interrupt — not the external teardown/budget signal). The request reached the transport,
              // so count its iteration and exact physical attempts. Without a terminal receipt its token,
              // reasoning, and dollar totals are unknown; treating it as free can overspend the pool.
              // Any other error — incl. a network fault coincident with an interrupt — is fatal: rethrow.
              const interruptAbort =
                e instanceof DOMException &&
                e.name === 'AbortError' &&
                interruptSig.aborted &&
                !signal.aborted &&
                !controller.signal.aborted
              if (interruptAbort) {
                turns += 1
                resources = addResourceSpend(
                  Object.fromEntries(
                    Object.entries(resources ?? {}).map(([name, value]) => [
                      name,
                      { ...value, known: false },
                    ]),
                  ),
                ).resources
                transportAttempts += routerTransportAttemptsFromError(e) ?? 1
                tokensKnown = false
                usdKnown = false
                reasoningKnown = false
                continue
              }
              throwRouterTransportFailure('routerToolsInlineExecutor', e)
            }
            cleanup()
            // The inference completed — count the turn and merge its terminal receipt.
            turns += 1
            const priorResources = resources
            resources = addResourceSpend(resources, res.resources).resources
            resources = addResourceSpend(
              Object.fromEntries(
                Object.entries(resources ?? {}).map(([name, value]) => [
                  name,
                  {
                    ...value,
                    known:
                      value.known &&
                      res.resources?.[name] !== undefined &&
                      (turns === 1 || priorResources?.[name] !== undefined),
                  },
                ]),
              ),
            ).resources
            transportAttempts += res.transportAttempts
            if (res.model !== undefined) recordRuntimeOwnedProviderModel(executor, res.model)
            assertObservedRouterModel(res.model, model, 'routerToolsInlineExecutor')
            if (res.model !== undefined) observedModel = res.model
            mergePromptCache(promptCache, res.cache)
            if (res.usage) {
              addTokenUsage(tokens, {
                input: res.usage.input,
                output: res.usage.output,
                ...promptCacheTokenClasses(res.usage.input, res.cache),
              })
              if (res.usage.reasoning !== undefined) reasoningTokens += res.usage.reasoning
              else reasoningKnown = false
            } else {
              addTokenUsage(tokens, promptCacheTokenClasses(undefined, res.cache))
              tokensKnown = false
              reasoningKnown = false
            }
            if (res.billedCostUsd !== undefined) billedUsd += res.billedCostUsd
            else usdKnown = false
            if (res.content) lastText = res.content
            const toolCalls = res.toolCalls
            if (toolCalls.length === 0) {
              // Only authority messages require another turn. Peer mail joins an already-required
              // turn at the next boundary, but cannot keep a finished worker running.
              if (inbox.pendingAuthority() > 0) continue
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
              executedToolCalls.push({ id, name: toolName, arguments: tc?.arguments ?? '' })
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
          ...addResourceSpend(resources),
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
          toolCalls: executedToolCalls,
          transportAttempts,
          ...(estimatedUsd !== undefined ? { estimatedCostUsd: estimatedUsd } : {}),
          ...(Object.keys(promptCache).length > 0 ? { promptCache } : {}),
          ...(reasoningKnown && turns > 0 ? { reasoningTokens } : {}),
        } as unknown
        artifact = { outRef: contentRef('router-tools', { model, content: lastText }), out, spent }
        return artifact
      },
      cancel(_request): Promise<ExecutorCancellation> {
        controller.abort('executor cancelled')
        return Promise.resolve(
          localAbortCancellation(
            'the Router chat-completions API exposes no cancel operation; the in-flight turn was aborted and the provider may still bill it',
          ),
        )
      },
      teardown(_grace): Promise<{ destroyed: boolean }> {
        controller.abort('executor torn down')
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
        tokenLimits: profileExecution.tokenLimits,
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
  return executor
}

function assertObservedRouterModel(
  observed: string | undefined,
  expected: string,
  context: string,
): void {
  if (observed !== undefined && !observedModelMatchesDeclared(observed, expected)) {
    throw new ValidationError(
      `${context}: provider reported model ${JSON.stringify(observed)} but AgentProfile requires ${JSON.stringify(expected)}`,
    )
  }
}

function routerRequestIdentity(ctx: ExecutorContext): {
  readonly callId?: string
  readonly correlationId?: string
  readonly propagatedHeaders?: Readonly<Record<string, string>>
} {
  const correlation = ctx.node?.identity?.correlation
  return {
    ...(correlation?.callId ? { callId: correlation.callId } : {}),
    ...(correlation?.correlationId ? { correlationId: correlation.correlationId } : {}),
    ...(ctx.propagatedHeaders ? { propagatedHeaders: ctx.propagatedHeaders } : {}),
  }
}

function routerTurnRequestIdentity(
  identity: {
    readonly callId?: string
    readonly correlationId?: string
    readonly propagatedHeaders?: Readonly<Record<string, string>>
  },
  turnIndex: number,
): {
  readonly callId?: string
  readonly correlationId?: string
  readonly propagatedHeaders?: Readonly<Record<string, string>>
} {
  return {
    ...(identity.callId ? { callId: `${identity.callId}:turn:${turnIndex + 1}` } : {}),
    ...(identity.correlationId ? { correlationId: identity.correlationId } : {}),
    ...(identity.propagatedHeaders ? { propagatedHeaders: identity.propagatedHeaders } : {}),
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
  // The harness owns its own model calls inside the box and the Sandbox API exposes no completion
  // cap, so a requested ceiling is refused here rather than dropped on the way to a paid run.
  const sandboxTokenLimits = enforceTokenLimits(
    profileModelExecutionSettings(spec.profile, 'sandboxExecutor').tokenLimits,
    'sandbox',
    'sandboxExecutor',
  )
  // The cross-MACHINE case this exists for: the box gets `TRACE_ID` / `PARENT_SPAN_ID` through
  // `CreateSandboxOptions.env`, so whatever the remote worker emits lands in this run's trace under
  // the spawning node's span. Empty when the run records no spans, and an empty record adds no
  // `env` key to the create options at all.
  const traceEnv = workerTraceEnv(ctx)

  const controller = linkAbort(ctx.signal)

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
      tokenLimits: sandboxTokenLimits,
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
    if (seam.validator) {
      throw new ValidationError(
        'sandboxExecutor: validator is not representable with steering — the steerable session is not a runAgentRounds composition, so the score would be silently dropped',
      )
    }
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
        cancel: (request): Promise<ExecutorCancellation> => session.cancel(request),
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

  // The leaf runs an opaque, self-parallelizing coding harness. Runtime keeps
  // its complete event archive and projects the visible answer and tool calls.
  const output: OutputAdapter<SandboxLeafOut> = {
    parse(events: SandboxEvent[]): SandboxLeafOut {
      return sandboxLeafOutputFromEvents(events)
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
          ...(seam.validator ? { validator: seam.validator } : {}),
          traceEnv,
          onArtifact: (a) => {
            artifact = a
          },
        })
      },
      cancel(_request): Promise<ExecutorCancellation> {
        controller.abort('executor cancelled')
        return Promise.resolve(
          localAbortCancellation(
            'the composed sandbox run owns its boxes, so this executor retains no exact session control reference to cancel against',
          ),
        )
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
  /** Forwarded to the composed loop, which scores each iteration against its LIVE box. */
  validator?: Validator<SandboxLeafOut>
  loopCtx?: Partial<Omit<ExecCtx, 'sandboxClient' | 'signal'>>
  /** Inherited `TRACE_ID` / `PARENT_SPAN_ID` for the box; empty when tracing is off. */
  traceEnv: Record<string, string>
  onArtifact: (a: ExecutorResult<unknown>) => void
}

async function* streamSandboxLeaf(args: StreamSandboxArgs): AsyncIterable<UsageEvent> {
  const linked = linkAbort(args.signal, args.controller.signal)

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
    ...(args.validator ? { validator: args.validator } : {}),
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
    const winningIteration = result.winner
      ? result.iterations.find((iteration) => iteration.index === result.winner?.iterationIndex)
      : result.iterations.at(-1)
    const out =
      winningIteration?.output ?? sandboxLeafOutputFromEvents(winningIteration?.events ?? [])
    const sandboxOutcome = winningIteration?.sandboxOutcome
    const outWithOutcome: SandboxLeafOut = {
      ...out,
      ...(sandboxOutcome ? { outcome: sandboxOutcome } : {}),
    }
    const verdict =
      sandboxOutcome && !sandboxOutcome.success
        ? { valid: false, score: 0 }
        : (result.winner?.verdict ?? leafVerdict(result))
    const tokensKnown = result.tokenUsage.tokensKnown !== false
    const usdKnown = result.costUsdKnown !== false
    // The dollars no billing receipt proves are a price rather than a charge. Naming them on the
    // estimate channel is what keeps `usd - usdEstimated` reading as billed money: without it a
    // cloud child's whole figure read as provider spend and a pursuit report was 40x the money
    // that had actually moved (#1175).
    //
    // The amount comes from the loop's PER-CALL sum, never from `costUsdKnown`: that flag is an
    // AND across every call and iteration, so a settlement mixing a receipted turn with an
    // unproven one would price the receipted dollars too and report $0 billed against money a
    // provider really did charge. Clamped by `costUsd` because the estimate is a part OF the
    // total, which is the pool's own rule (`assertValidSpend`). `usdKnown` is untouched — an
    // unproven number never becomes a receipt, and a dollar cap still refuses it.
    const unprovenUsd = Math.min(result.unprovenCostUsd ?? 0, result.costUsd)
    const usdEstimated = unprovenUsd > 0 ? unprovenUsd : undefined
    const outWithUsage = {
      ...outWithOutcome,
      ...(result.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: result.estimatedCostUsd }
        : {}),
      ...(result.promptCache ? { promptCache: result.promptCache } : {}),
    }
    // The platform channel. A sandbox worker on a subscription seat pays no marginal dollar per
    // model call, so box wall time is the only real resource it consumes — and until this channel
    // existed the run reported `$0` with nothing beside it. The number is DERIVED from the box
    // lifetime this loop watched, never a platform receipt, so it rides as `'estimated'` and the
    // conserved budget pool never reserves against it (`budget.ts`). A run whose boxes could not
    // be paired says `'uncaptured'` and carries no number: a missing measurement is not a zero.
    const boxMinutes =
      result.boxLiveMs === undefined ? undefined : roundBoxMinutes(result.boxLiveMs / 60_000)
    const spent: Spend = {
      iterations: result.iterations.length,
      tokens: cloneTokenUsage(result.tokenUsage),
      ...(tokensKnown ? {} : { tokensKnown: false }),
      usd: result.costUsd,
      ...(usdKnown ? {} : { usdKnown: false }),
      ...(usdEstimated === undefined ? {} : { usdEstimated }),
      ms: Date.now() - started,
      ...(boxMinutes === undefined
        ? { boxMinutesKnown: false, boxMinutesProvenance: 'uncaptured' as const }
        : {
            boxMinutes,
            boxMinutesKnown: result.boxLiveMsKnown !== false,
            boxMinutesProvenance: 'estimated' as const,
          }),
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
        ...(result.tokenUsage.freshInput !== undefined
          ? { freshInput: result.tokenUsage.freshInput }
          : {}),
        ...(result.tokenUsage.cacheRead !== undefined
          ? { cacheRead: result.tokenUsage.cacheRead }
          : {}),
        ...(result.tokenUsage.cacheWrite !== undefined
          ? { cacheWrite: result.tokenUsage.cacheWrite }
          : {}),
        ...(result.tokenUsage.cacheBreakdownKnown === false
          ? { cacheBreakdownKnown: false as const }
          : {}),
      }
    }
    if (result.iterations.length > 0 || result.costUsd) {
      yield usdKnown
        ? { kind: 'cost', usdKnown: true, usd: result.costUsd, provenance: 'provider-receipt' }
        : {
            kind: 'cost',
            usdKnown: false,
            usd: result.costUsd,
            ...(usdEstimated === undefined ? {} : { usdEstimated }),
            provenance: 'uncaptured',
          }
    }
  } finally {
    linked.release()
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
 * well the worker ran. Structural, never self-reported: the round's
 * {@link SandboxOutputMarker} says what the harness produced, and the verdict is
 * that marker.
 *
 * `text` is the only marker that passes. `empty` (a text-bearing terminal event
 * carrying an empty string) and `absent` (no text-bearing event at all) each settle
 * `valid: false` with the marker named in `notes`, because a box that answered
 * nothing is not a worker whose output a finalizer may select. The two stay
 * distinct: `empty` reports a box that ran and said nothing, `absent` reports an
 * answer no reader can confirm was ever produced.
 */
function leafVerdict(result: { winner?: { output?: SandboxLeafOut } }): DefaultVerdict | undefined {
  const output = result.winner?.output
  if (output === undefined) return undefined
  return verdictForOutputMarker(output.output)
}

/** The verdict one {@link SandboxOutputMarker} settles, with the marker named in `notes`. */
function verdictForOutputMarker(marker: SandboxOutputMarker): DefaultVerdict {
  switch (marker.kind) {
    case 'text':
      return { valid: true, score: 1 }
    case 'empty':
      return {
        valid: false,
        score: 0,
        notes:
          'sandbox output marker empty: the round produced a text-bearing terminal event that carried no answer',
      }
    case 'absent':
      return {
        valid: false,
        score: 0,
        notes:
          'sandbox output marker absent: the round produced no text-bearing event, so no answer was observed',
      }
  }
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

  const controller = linkAbort(ctx.signal)

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
  //
  // A child that exits, or closes its stdin, before reading the task leaves this write against a
  // pipe with no reader, and the kernel answers with EPIPE. Node raises that as an `'error'` on
  // the stream, and a Writable with no listener turns it into an uncaught exception: one took down
  // a full serialized kernel run on 2026-09-11 after every test in it had passed. A closed read end
  // is not this leaf's failure — the child's exit code, read below, is the verdict. Any other
  // delivery error is, and fails the leaf once the process has been reaped.
  let deliveryError: Error | undefined
  if (proc.stdin) {
    proc.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') deliveryError ??= error
    })
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
  if (deliveryError) {
    throw new ValidationError(
      `cliExecutor: could not deliver the task to ${args.seam.bin}: ${deliveryError.message}`,
      { cause: deliveryError },
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
        const linked = linkAbort(signal, controller.signal).signal
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

// ── cli-in-place executor (authored profile → harness CLI on a supplied workspace) ──

/**
 * The leaf `createInPlaceCliExecutor` as a backend-as-data factory: a supervisor-authored
 * `AgentProfile` driving a local coding CLI in the workspace the caller supplied, so its edits are
 * still there for the next spawn. `budgetExempt` like the other CLI leaves; the authored
 * systemPrompt + model reach the harness via §1.5.
 */
export const cliInPlaceExecutor: ExecutorFactory<unknown> = (spec, ctx) => {
  const seam = readSeam<CliInPlaceSeam>(ctx, cliInPlaceSeamKey, 'cli-in-place')
  if (!seam.workspacePath) {
    throw new ValidationError('cliInPlaceExecutor: CliInPlaceSeam.workspacePath required')
  }
  const effectiveProfile = agentProfileSchema.parse(spec.profile)
  assertExecutableAgentProfile(effectiveProfile, 'cliInPlaceExecutor')
  return createInPlaceCliExecutor({
    workspacePath: seam.workspacePath,
    profile: effectiveProfile,
    ...(seam.taskPrompt !== undefined ? { taskPrompt: seam.taskPrompt } : {}),
    ...(seam.harnessTimeoutMs !== undefined ? { harnessTimeoutMs: seam.harnessTimeoutMs } : {}),
    ...(seam.runHarness ? { runHarness: seam.runHarness } : {}),
    ...(ctx.node?.attemptId !== undefined ? { executionAttemptId: ctx.node.attemptId } : {}),
  }) as Executor<unknown>
}

// ── createExecutor: the ONE built-in factory (backend as data) ──────────────────

/**
 * Config for {@link createExecutor}: the backend is DATA — the cost dial a profile,
 * an experiment config, or a replay journal can name — not an import choice. Each
 * variant carries its backend's seam.
 */
export type ExecutorConfig =
  | ({ backend: 'router' } & RouterSeam)
  | ({ backend: 'router-tools' } & RouterToolsSeam)
  | ({ backend: 'bridge' } & BridgeSeam)
  | ({ backend: 'cli' } & CliSeam)
  | ({ backend: 'cli-worktree' } & CliWorktreeSeam)
  | ({ backend: 'cli-in-place' } & CliInPlaceSeam)
  | ({ backend: 'provider' } & ProviderSeam)
  | ({ backend: 'sandbox' } & SandboxSeam)

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
    case 'cli-in-place': {
      assertExactConfigKeys(
        config as unknown as Readonly<Record<string, unknown>>,
        new Set(['backend', 'harnessTimeoutMs', 'runHarness', 'taskPrompt', 'workspacePath']),
        'createExecutor cli-in-place config',
      )
      const { runHarness, ...decisionData } = config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor cli-in-place config')
      return Object.freeze({
        ...snapshot,
        ...(runHarness === undefined ? {} : { runHarness }),
      })
    }
    case 'provider': {
      // `validator` is an executable port like `provider`: retained live by reference, never
      // cloned, because `detachedSnapshot` cannot structured-clone its `validate` method.
      const { provider, registry, profileForCreate, taskToTurn, validator, ...decisionData } =
        config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor provider config')
      // A registry is a live service. Resolve its mutable name mapping exactly once at intake and
      // retain the resulting provider instance, never the registry lookup for later execution.
      const resolvedProvider = resolveAgentEnvironmentProvider(provider, registry)
      return Object.freeze({
        ...snapshot,
        provider: resolvedProvider,
        ...(profileForCreate === undefined ? {} : { profileForCreate }),
        ...(taskToTurn === undefined ? {} : { taskToTurn }),
        ...(validator === undefined ? {} : { validator }),
      })
    }
    case 'sandbox': {
      assertExactConfigKeys(
        config as unknown as Readonly<Record<string, unknown>>,
        new Set([
          'backend',
          'lineage',
          'loopCtx',
          'maxIterations',
          'sandboxClient',
          'steering',
          'validator',
        ]),
        'createExecutor sandbox config',
      )
      // `validator` is an executable port like `sandboxClient`: retained live by reference,
      // never cloned, because `detachedSnapshot` cannot structured-clone its `validate` method.
      const { sandboxClient, loopCtx, validator, ...decisionData } = config
      const port = {
        sandboxClient,
        ...(validator === undefined ? {} : { validator }),
      }
      if (loopCtx === undefined) {
        const snapshot = detachedSnapshot(decisionData, 'createExecutor sandbox config')
        return Object.freeze({ ...snapshot, ...port })
      }
      const { hooks, traceEmitter, onSandboxEvent, runHandle, ...loopDecisionData } = loopCtx
      const snapshot = detachedSnapshot(
        { ...decisionData, loopCtx: loopDecisionData },
        'createExecutor sandbox config',
      )
      const loopSnapshot = snapshot.loopCtx
      return Object.freeze({
        ...snapshot,
        ...port,
        loopCtx: Object.freeze({
          ...loopSnapshot,
          ...(hooks === undefined ? {} : { hooks }),
          ...(traceEmitter === undefined ? {} : { traceEmitter }),
          ...(onSandboxEvent === undefined ? {} : { onSandboxEvent }),
          ...(runHandle === undefined ? {} : { runHandle }),
        }),
      })
    }
    case 'bridge': {
      assertExactConfigKeys(
        config as unknown as Readonly<Record<string, unknown>>,
        new Set([
          'activityWindow',
          'backend',
          'bridgeBearer',
          'bridgeUrl',
          'cwd',
          'maxReconnects',
          'modelCredential',
          'sessionId',
          'timeoutMs',
        ]),
        'createExecutor bridge config',
      )
      const { modelCredential, ...decisionData } = config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor bridge config')
      const capturedCredential = validateBridgeModelCredential(
        modelCredential,
        config.bridgeUrl,
        'createExecutor bridge config',
      )
      return Object.freeze({
        ...snapshot,
        ...(capturedCredential === undefined ? {} : { modelCredential: capturedCredential }),
      })
    }
    case 'cli':
      return detachedSnapshot(config, `createExecutor ${config.backend} config`)
    default: {
      // The backend is DATA — a profile, an experiment config, or a replay journal names it — so
      // a value outside the union reaches here untyped. Without this arm the switch returns
      // `undefined`, `createExecutor` hands back a working-looking factory, and the failure lands
      // one call later as a TypeError that never names the backend that caused it.
      const named = (config as { backend?: unknown }).backend
      // The supported list is read off the trace-propagation table rather than written out again:
      // that table is `satisfies Record<ExecutorConfig['backend'], boolean>`, so it is the one
      // copy the compiler already forces to hold every arm.
      const supported = Object.keys(WORKER_TRACE_PROPAGATION).sort().join(', ')
      throw new ValidationError(
        `createExecutor: no backend named ${JSON.stringify(named)}; supported backends are ${supported}`,
      )
    }
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
    case 'cli-in-place':
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
      case 'cli-in-place':
        return cliInPlaceExecutor(spec, seamed)
      case 'provider': {
        const originalSeam = readSeam<ProviderSeam>(seamed, providerSeamKey, 'provider')
        const selected = originalSeam.steering
          ? selectProviderPlacement(spec.profile, originalSeam)
          : undefined
        const providerSeam = selected?.options ?? originalSeam
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
          if (providerSeam.validator) {
            throw new ValidationError(
              'createExecutor(provider, steering): validator is not representable with steering — the steerable session is a multi-turn session on one environment, not a scored single-shot leaf, so the score would be silently dropped',
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
          // The steerable session already speaks this vocabulary: it reads
          // `ExecCtx.promptOptions` and the composed client raises them back onto
          // `AgentTurnInput.providerOptions` before the provider sees them. One declaration on the
          // provider seam therefore serves the plain and the steerable path with no translation.
          const providerCtx: ExecutorContext = {
            ...seamed,
            seams: {
              ...seamed.seams,
              [sandboxSeamKey]: {
                sandboxClient,
                steering: providerSeam.steering,
                ...(providerSeam.promptOptions === undefined
                  ? {}
                  : { loopCtx: { promptOptions: providerSeam.promptOptions } }),
              } satisfies SandboxSeam,
            },
          }
          const executor = sandboxExecutor({ ...spec, harness }, providerCtx)
          // The copy renames the runtime only; it must keep the sandbox executor's materialization
          // evidence, or exact turn execution would refuse the executor Runtime itself built.
          const wrapper = inheritRuntimeOwnedExecutorAttestation(executor, {
            ...executor,
            runtime: providerSeam.runtime ?? (provider.name as Runtime),
          })
          if (selected?.identity) {
            const declaration = runtimeOwnedExecutorMaterialization(executor)!
            const binding = runtimeOwnedExecutorExecutionBinding(executor)!
            attestRuntimeOwnedExecutor(
              wrapper,
              {
                ...declaration,
                plan: { ...(declaration.plan as object), placement: selected.identity },
              },
              {
                ...binding,
                binding: { ...(binding.binding as object), placement: selected.identity },
                descriptor: {
                  ...binding.descriptor,
                  placementId: selected.identity.id,
                  placementDigest: selected.identity.digest,
                },
              },
            )
          }
          return wrapper
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

interface RouterProfileExecution {
  systemPrompt: string
  reasoningEffort?: ReasoningEffort
  temperature?: number
  /** Ceilings this path was asked to enforce and the request fields it sends them as. */
  tokenLimits: TokenLimitDecision
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

  const { tokenLimits, ...rest } = settings
  return {
    systemPrompt: renderRouterProfilePrompt(profile),
    ...(profileEffort ? { reasoningEffort: profileEffort } : {}),
    ...rest,
    tokenLimits: enforceTokenLimits(tokenLimits, 'router', 'routerInlineExecutor'),
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
  const model = profileProviderModel(profile)
  if (!model) {
    throw new ValidationError(
      `${context}: AgentProfile.model.default must name a model after provider ${JSON.stringify(profile.model?.provider?.trim())}`,
    )
  }
  return model
}

/**
 * Render the profile prompt plus every resource this executor can inline.
 *
 * The profile's `resources.failOnError` policy decides what happens to a resource that cannot be
 * inlined. Strict (`true` or absent) is the canonical default and fails closed. Best-effort
 * (`false`) asks for the supported subset plus a warning about the rest; this executor has no
 * channel to carry that warning, so it refuses the value instead of silently running strict.
 */
function renderRouterProfilePrompt(profile: AgentProfile): string {
  const sections: string[] = [
    profile.prompt?.systemPrompt,
    ...(profile.prompt?.instructions ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const resources = profile.resources
  if (!resources) return sections.join('\n')
  if (resources.failOnError === false) {
    throw new ValidationError(
      'routerInlineExecutor: resources.failOnError: false requests a best-effort resource subset; ' +
        'the direct Router executor always fails closed on a resource it cannot inline and reports ' +
        'no skipped resource, so the best-effort policy is refused rather than applied as strict',
    )
  }

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

export type { BridgeHarnessStore, BridgeModelCredential, BridgeSeam } from './bridge-config'

export { bridgeRuntimeAttachmentsKey, bridgeStopSignalKey } from './bridge-config'
export { bridgeExecutor } from './bridge-executor'
export type { BridgeModelRouteRefusal } from './bridge-transport'

export { bridgeAdmissionRefusal, bridgeModelRouteRefusal } from './bridge-transport'
// Re-export the verdict + spend surface so a consumer importing the runtime
// built-ins gets the budget vocabulary from one place.
export type { DefaultVerdict, Executor, ExecutorResult, Spend, UsageEvent }
