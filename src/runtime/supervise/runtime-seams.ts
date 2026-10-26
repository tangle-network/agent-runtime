import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import type { runLocalHarness } from '../../mcp/local-harness-process'
import type { GitRunner } from '../../mcp/worktree'
import type { WorktreeCheckRunner } from '../../mcp/worktree-harness'
import type { CodeModeStore, CodeModeToolContext, CodeModeToolsOptions } from '../code-mode'
import type { ProviderExecutorOptions } from '../environment-provider/provider-executor-admission'
import type { AgentEnvironmentProviderRegistry } from '../environment-provider/provider-registry'
import type { ProviderWorkspaceCaptureReceipt } from '../provider-workspace-retention'
import type { RouterResponseReceipt } from '../router-http-transport'
import type { RouterConfig, RouterRouting, ToolSpec } from '../router-request-body'
import type { SandboxLeafOut } from '../sandbox-executor-output'
import type { SharedBoxPlacement } from '../shared-box'
import type { ExecCtx, SandboxClient, Validator } from '../types'
import type { SandboxSteeringOptions } from './sandbox-session'

export const sandboxCaptureOutputSeamKey = 'runtime.sandboxCaptureOutput'

/**
 * Router/inline transport seam. The profile owns model, prompt, and generation behavior.
 */
export interface RouterSeam {
  routerBaseUrl: string
  routerKey: string
  /** Provider routing lowered into every request, for example `{ only: ['zai'] }`. */
  routing?: RouterRouting
  /** Injectable transport for offline/local execution; still passes through Runtime metering. */
  complete?: RouterConfig['complete']
  /** When present, return one turn's requested tool calls without executing them. */
  tools?: ReadonlyArray<ToolSpec>
}

/**
 * Sandbox executor seam. The `sandboxClient` the composed `runAgentRounds` creates
 * boxes through, plus the optional trace/run/lineage wiring forwarded into the
 * loop. `lineage` is opaque here (PR #150's `RunAgentRoundsOptions.lineage`): forwarded
 * forward-compatibly, never inspected — this executor does NOT reinvent
 * checkpoint/fork.
 */
export interface SandboxSeam {
  sandboxClient: SandboxClient
  /** Surface evidence capture failures from session cleanup. */
  failOnDestroyError?: boolean
  /** Verified provider captures collected before session teardown. */
  workspaceCaptures?: () => ReadonlyArray<ProviderWorkspaceCaptureReceipt>
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
 * (claude / codex / opencode / pi / kimi-code) on its own git worktree — the leaf `createWorktreeCliExecutor`
 * named as data. `repoRoot` is transport data; `AgentProfile.harness` selects the CLI.
 * `taskPrompt` remains an optional direct-call fallback for callers that execute with `undefined`.
 * The authored
 * `profile.prompt` uses native replace/append controls and a caller-instruction preamble;
 * `profile.model.default` selects the native model. Everything else mirrors `WorktreeCliExecutorOptions`.
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
 * `AgentProfile.harness` selects the CLI, and the authored `profile.prompt` +
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
  /**
   * Place each worker whose profile a shared box can carry as its own process in a pool of shared
   * boxes, and keep a dedicated environment from `provider` for every other profile. Build it with
   * `sharedBoxPlacement`. A manager never uses it: its coordination credential is create-time
   * environment that every co-tenant of a shared box could read.
   */
  shared?: SharedBoxPlacement
}

export const routerSeamKey = 'router'

export const sandboxSeamKey = 'sandbox'

export const cliSeamKey = 'cli'

export const cliWorktreeSeamKey = 'cli-worktree'

export const cliInPlaceSeamKey = 'cli-in-place'

export const providerSeamKey = 'provider'

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
  /** Provider routing lowered into every request, for example `{ only: ['zai'] }`. */
  routing?: RouterRouting
  complete?: RouterConfig['complete']
  tools: ReadonlyArray<ToolSpec>
  executeToolCall: (
    name: string,
    args: Record<string, unknown>,
    task: unknown,
    context: CodeModeToolContext,
  ) => Promise<unknown>
  /** Run model-written scripts over the same profile-authorized tool handlers. */
  codeMode?: true | Omit<CodeModeToolsOptions, 'wasm' | 'workerUrl'>
  /** Exact conversation to continue. Runtime validates its system message against the profile. */
  initialMessages?: ReadonlyArray<Readonly<Record<string, unknown>>>
  /** Persist each buffered HTTP attempt, including failed responses, before the next turn. */
  onProviderResponse?: (receipt: RouterResponseReceipt) => void | Promise<void>
  /** Observe the detached final conversation for session persistence. */
  onMessages?: (
    messages: ReadonlyArray<Readonly<Record<string, unknown>>>,
    context?: { codeModeStore: CodeModeStore },
  ) => void | Promise<void>
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

export const routerToolsSeamKey = 'router-tools'
