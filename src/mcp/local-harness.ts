/**
 *
 * Subprocess wrappers for the local coding-harness CLIs installed in the
 * sandbox image (claude-code, codex, opencode). Used by the in-process
 * delegation executor (`createInProcessExecutor`) so a delegated coding task
 * spawns a real harness on a real git worktree instead of provisioning a
 * sibling sandbox.
 *
 * All harness invocations:
 *   - run with `cwd` set to the worktree
 *   - inherit env from the parent (the MCP server inside the sandbox has
 *     the harness's auth already)
 *   - capture stdout/stderr
 *   - support cancellation via AbortSignal
 *   - enforce a wall-clock timeout
 *
 * @experimental
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { AgentProfile, HarnessType, ReasoningEffort } from '@tangle-network/agent-interface'
import {
  codexSensitiveEnvironmentName,
  collectCodexDiagnosticRedactionValues,
  createCodexExecutionDiagnosticError,
  readCodexAuthRedactionText,
  redactCodexHome,
} from './codex-diagnostics'

export type { CodexExecutionFailureDiagnostic } from './codex-diagnostics'
export { CodexExecutionDiagnosticError } from './codex-diagnostics'

/**
 * Local coding harness available inside the sandbox — a narrowing of the shared `HarnessType`
 * vocabulary, NOT a private spelling of it. The harness id is `claude-code`; `claude` is the
 * EXECUTABLE name and lives only in the `command` field below. Keeping one vocabulary is what
 * lets a `LocalHarness` be handed straight to the profile materializer and the capability table
 * with no translation step.
 */
export type LocalHarness = Extract<HarnessType, 'claude-code' | 'codex' | 'opencode'>

/**
 * Canonical reasoning effort → the native level string a harness's own control accepts.
 * PRESENCE of a key is the capability claim: a level with no entry has no native spelling on
 * that harness and is refused rather than silently dropped.
 */
type NativeReasoningLevels = Partial<Record<ReasoningEffort, string>>

/** `codex -c model_reasoning_effort=…`. `ultracode` has no distinct native level; it saturates
 *  at `xhigh`, which is also the ceiling `assertCodexReproducibleInvocation` admits. */
const CODEX_REASONING_LEVELS: NativeReasoningLevels = {
  none: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  ultracode: 'xhigh',
}

/** `claude --effort <level>` accepts `low, medium, high, xhigh, max` (verified against the
 *  installed CLI's `--help`); canonical `ultracode` is its `max`. It expresses no thinking-off
 *  or `minimal` level, so those two canonical levels have no entry. */
const CLAUDE_CODE_REASONING_LEVELS: NativeReasoningLevels = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  ultracode: 'max',
}

/** `opencode run --variant <variant>` is documented as "provider-specific reasoning effort,
 *  e.g. high, max, minimal", so the canonical level passes through as the variant name and
 *  `ultracode` maps to `max`. Thinking-off is expressed by omitting the flag, not by a variant
 *  named `none`, so `none` has no entry. */
const OPENCODE_REASONING_LEVELS: NativeReasoningLevels = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  ultracode: 'max',
}

interface HarnessInvocationSpec {
  command: string
  buildArgs: (taskPrompt: string) => string[]
  /** Map a resolved model to the harness's model-selector flag. */
  modelArgs: (model: string) => string[]
  /** Native reasoning-effort control, absent when the harness exposes none. */
  reasoning?: {
    levels: NativeReasoningLevels
    args: (nativeLevel: string) => string[]
  }
  /**
   * Argv that lets an unattended run edit its workspace without stopping on an interactive
   * approval gate. Absent when the harness has no such gate on its non-interactive path.
   */
  permissionBypassArgs?: () => string[]
}

/**
 * Default per-harness command + arg shape. `buildArgs` takes ONLY the task prompt and
 * emits the prompt-only invocation (no model, no system prompt) — the safe default shape
 * the in-process executor's `streamPrompt` drives. `modelArgs` maps a resolved model to
 * the harness's selector flag (every supported harness takes `-m <model>`). The §1.5
 * profile-aware mapper `harnessInvocation` composes these to thread the full
 * supervisor-authored profile (systemPrompt + model) into argv.
 *
 * Every per-harness difference is a FIELD on this row, never a test on the harness name at a
 * call site: adding harness N+1 is one entry here, and a caller asking for a capability the
 * row does not declare is refused up front instead of silently losing the request.
 */
const HARNESS_INVOCATIONS: Record<LocalHarness, HarnessInvocationSpec> = {
  'claude-code': {
    command: 'claude',
    // `-p` IS headless/print mode; the old `--headless` flag was removed from the CLI.
    // Permission bypass is an explicit per-run opt-in below, never the public default.
    buildArgs: (taskPrompt) => ['-p', taskPrompt],
    modelArgs: (model) => ['-m', model],
    reasoning: {
      levels: CLAUDE_CODE_REASONING_LEVELS,
      args: (level) => ['--effort', level],
    },
    permissionBypassArgs: () => ['--dangerously-skip-permissions'],
  },
  codex: {
    command: 'codex',
    buildArgs: (taskPrompt) => ['exec', taskPrompt],
    modelArgs: (model) => ['-m', model],
    reasoning: {
      levels: CODEX_REASONING_LEVELS,
      args: (level) => ['-c', `model_reasoning_effort="${level}"`],
    },
    // Non-interactive editing WITHOUT surrendering the OS sandbox. `codex exec` has no approval
    // gate to stall on (`-a/--ask-for-approval` exists only on the top-level `codex`), so
    // `--dangerously-bypass-approvals-and-sandbox` buys nothing on the approvals axis and pays the
    // entire sandbox for it — writes would escape the worktree to ~/.ssh, ~/.aws, and secrets.
    // The sandbox is what MAKES the blast radius the worktree. Same form as CODEX_REPRODUCIBLE_ARGS.
    permissionBypassArgs: () => ['--sandbox', 'workspace-write', '-c', 'approval_policy="never"'],
  },
  opencode: {
    command: 'opencode',
    buildArgs: (taskPrompt) => ['run', taskPrompt],
    modelArgs: (model) => ['-m', model],
    reasoning: {
      levels: OPENCODE_REASONING_LEVELS,
      args: (level) => ['--variant', level],
    },
    // `opencode run` is non-interactive and has no approval gate to bypass.
  },
}

/** Every local harness, in table order — the one list `AGENT_RUNTIME_LOCAL_HARNESSES` and any
 *  other harness enumeration reads, so adding a row above is the only edit a new harness needs. */
export const LOCAL_HARNESSES = Object.keys(HARNESS_INVOCATIONS) as ReadonlyArray<LocalHarness>

/** The harness a caller gets when it expresses no preference. A composition-root default, not a
 *  capability claim: one constant so the several entry points cannot drift apart. */
export const DEFAULT_LOCAL_HARNESS: LocalHarness = 'claude-code'

/** The CLI binary a harness id runs. The two are NOT the same string (`claude-code` runs `claude`),
 *  so anything spawning a harness — a version probe, a login check — reads it from here rather than
 *  passing the harness id as a command. */
export function localHarnessExecutable(harness: LocalHarness): string {
  return HARNESS_INVOCATIONS[harness].command
}

/**
 * Whether the harness's native control can express this reasoning effort. Admission checks read
 * this so a profile the invocation would later refuse is rejected BEFORE any workspace state is
 * created, against the same table that emits the argv.
 */
export function harnessSupportsReasoningEffort(
  harness: LocalHarness,
  reasoningEffort: ReasoningEffort,
): boolean {
  return HARNESS_INVOCATIONS[harness].reasoning?.levels[reasoningEffort] !== undefined
}

function harnessReasoningArgs(harness: LocalHarness, reasoningEffort: ReasoningEffort): string[] {
  const reasoning = HARNESS_INVOCATIONS[harness].reasoning
  const level = reasoning?.levels[reasoningEffort]
  if (reasoning === undefined || level === undefined) {
    throw new Error(
      `harnessInvocation: ${harness} cannot express reasoning effort ${String(reasoningEffort)}`,
    )
  }
  return reasoning.args(level)
}

/** Result of mapping an `AgentProfile` + task prompt onto a harness invocation. */
export interface HarnessInvocation {
  command: string
  args: string[]
  /** Exact profile-composed prompt carried by the invocation. */
  prompt: string
}

export interface HarnessInvocationOptions {
  /** Let an unattended process edit its isolated candidate worktree without stopping on an
   *  interactive approval gate. A property of the WORKSPACE, not of any one CLI: each harness
   *  contributes its own `permissionBypassArgs`, and a harness with no approval gate on its
   *  non-interactive path contributes nothing.
   *
   *  This never surrenders an OS sandbox. A harness that offers one flag for "skip approvals" and
   *  another for "skip approvals AND sandbox" must contribute the former: the sandbox is what keeps
   *  the blast radius equal to the worktree, and without it a prompt-injected worker reaches
   *  `~/.ssh`, `~/.aws`, and any secrets on the box. */
  dangerouslySkipPermissions?: boolean
  /** Run Codex with benchmark-safe process controls and JSONL usage output.
   *  Valid only for the Codex harness. */
  codexReproducible?: boolean
}

const CODEX_REPRODUCIBLE_ARGS = [
  '--ephemeral',
  '--ignore-rules',
  '--json',
  '-c',
  'approval_policy="never"',
  '-c',
  'web_search="disabled"',
  '-c',
  'project_doc_max_bytes=0',
  '-c',
  'skills.include_instructions=false',
  '-c',
  'include_apps_instructions=false',
  '--disable',
  'tool_suggest',
  '-c',
  'features.multi_agent_v2.root_agent_usage_hint_text=""',
  '-c',
  'features.multi_agent_v2.subagent_usage_hint_text=""',
  '-c',
  'features.multi_agent_v2.multi_agent_mode_hint_text=""',
  '--strict-config',
] as const

function buildHarnessArgs(
  harness: LocalHarness,
  taskPrompt: string,
  options: HarnessInvocationOptions = {},
): string[] {
  const invocation = HARNESS_INVOCATIONS[harness]
  const args = invocation.buildArgs(taskPrompt)
  // Reproducible mode pins `approval_policy="never"` inside its own controlled config, which is
  // the same non-interactive guarantee with the sandbox left INTACT. Emitting a blanket bypass
  // flag on top would tear that sandbox down and break the exact-argv reproducibility contract,
  // so the reproducible arg set owns approvals whenever it is active.
  if (options.dangerouslySkipPermissions && !options.codexReproducible) {
    args.push(...(invocation.permissionBypassArgs?.() ?? []))
  }
  if (options.codexReproducible) {
    // KEPT harness-name test: same reason as `runLocalHarness` below — `codexReproducible` is a
    // codex-SPECIFIC public option, so this asserts caller self-consistency and throws loudly.
    if (harness !== 'codex') {
      throw new Error('harnessInvocation: codexReproducible requires the Codex harness')
    }
    args.push(...CODEX_REPRODUCIBLE_ARGS)
  }
  return args
}

/**
 * Map a supervisor-authored `AgentProfile` + the per-task prompt onto a concrete harness
 * `command` + `args` (the §1.5 fix). UNLIKE the prompt-only `HARNESS_INVOCATIONS.buildArgs`
 * — which drops both the authored model and the system prompt — this threads the FULL
 * profile payload into argv:
 *
 *  - `profile.prompt.systemPrompt` → the PROMPT channel: a portable, harness-agnostic
 *    default that prepends the system prompt above the task prompt (`<system>\n\n<task>`),
 *    so the authored standing instructions reach EVERY harness (none of the three CLIs
 *    expose a portable replace-system-prompt flag for a one-shot non-interactive run).
 *  - `profile.prompt.instructions[]` → appended prompt sections in authored order.
 *  - `profile.model.default` → the harness's `-m <model>` selector.
 *
 * The task prompt alone is the floor; an empty/absent profile yields exactly the legacy
 * `buildArgs(taskPrompt)` shape so existing callers are byte-identical.
 */
export function harnessInvocation(
  harness: LocalHarness,
  profile: AgentProfile,
  taskPrompt: string,
  options: HarnessInvocationOptions = {},
): HarnessInvocation {
  const invocation = HARNESS_INVOCATIONS[harness]
  if (!invocation) {
    throw new Error(`harnessInvocation: unknown harness ${String(harness)}`)
  }

  if (options.codexReproducible) {
    const model = profile.model?.default
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new Error('harnessInvocation: codexReproducible requires profile.model.default')
    }
    if (profile.model?.reasoningEffort === undefined) {
      throw new Error('harnessInvocation: codexReproducible requires profile.model.reasoningEffort')
    }
  }

  const systemPrompt = profile.prompt?.systemPrompt
  const instructions = profile.prompt?.instructions
  if (
    instructions !== undefined &&
    (!Array.isArray(instructions) ||
      instructions.some((instruction) => typeof instruction !== 'string'))
  ) {
    throw new Error('harnessInvocation: profile.prompt.instructions must be an array of strings')
  }
  const promptSections = [
    ...(typeof systemPrompt === 'string' && systemPrompt.trim().length > 0 ? [systemPrompt] : []),
    ...(instructions?.filter((instruction) => instruction.trim().length > 0) ?? []),
    taskPrompt,
  ]
  const composedPrompt = promptSections.join('\n\n')

  const args = buildHarnessArgs(harness, composedPrompt, options)

  const model = profile.model?.default
  if (typeof model === 'string' && model.length > 0) {
    args.push(...invocation.modelArgs(model))
  }

  const reasoningEffort = profile.model?.reasoningEffort
  if (reasoningEffort !== undefined) {
    args.push(...harnessReasoningArgs(harness, reasoningEffort))
  }

  return { command: invocation.command, args, prompt: composedPrompt }
}

/** @experimental */
export interface RunLocalHarnessOptions {
  harness: LocalHarness
  /** Working directory for the subprocess (typically a worktree path). */
  cwd: string
  /** Prompt forwarded as the harness CLI's task argument. */
  taskPrompt: string
  /**
   * Pre-built command + args (e.g. from `harnessInvocation` so the full authored
   * `AgentProfile` — systemPrompt + model — reaches the harness). When set it OVERRIDES the
   * default prompt-only `buildArgs(taskPrompt)` path; `command` defaults to the harness's
   * default binary when only `args` is supplied. When absent the legacy prompt-only shape
   * is used unchanged.
   */
  invocation?: { command?: string; args: ReadonlyArray<string> }
  /** Allow autonomous edits without an interactive approval gate, using whichever bypass argv the
   *  harness declares. Use only when `cwd` is an isolated candidate worktree. */
  dangerouslySkipPermissions?: boolean
  /** Isolate Codex from ambient configuration/instructions and require JSONL token usage.
   *  The invocation should come from `harnessInvocation(..., { codexReproducible: true })`. */
  codexReproducible?: boolean
  /** Absolute host paths that reproducible Codex must not read. The normalized set is compiled
   *  into the controlled permission profile and its digest is returned in execution evidence. */
  codexReadDeniedPaths?: ReadonlyArray<string>
  /** Wall-clock kill deadline (ms). Default 5 min. Subprocess SIGTERMed on expiry. */
  timeoutMs?: number
  /** Newest stdout/stderr bytes retained per stream. Default 64 MiB. */
  maxOutputBytes?: number
  /** Caller cancellation. SIGTERM is sent on abort. */
  signal?: AbortSignal
  /** Override env (defaults to inheriting from the parent). */
  env?: NodeJS.ProcessEnv
  /**
   * Test seam — inject a custom spawner so unit tests can mock the
   * subprocess without touching the OS. Defaults to node's `child_process.spawn`.
   */
  spawn?: (
    command: string,
    args: ReadonlyArray<string>,
    opts: {
      cwd: string
      env: NodeJS.ProcessEnv
      stdio: 'pipe'
      detached: boolean
    },
  ) => ChildProcess
  /** Test seam for locating the native Codex executable before it is staged in the worktree. */
  resolveCodexExecutable?: (command: string, env: NodeJS.ProcessEnv) => Promise<string>
}

/** Exact aggregate usage emitted by Codex's terminal `turn.completed` JSONL event. */
export interface CodexTokenUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

/** Isolation settings asserted before a reproducible Codex run is allowed to start. */
export interface CodexExecutionPolicy {
  sessionPersistence: 'ephemeral'
  userConfig: false
  rules: false
  projectInstructions: false
  skillInstructions: false
  appInstructions: false
  toolSuggestions: false
  multiAgentInstructions: false
  sandbox: 'workspace-write'
  permissionProfile: 'agent_runtime_reproducible'
  approvalPolicy: 'never'
  shellNetwork: false
  webSearch: false
  serviceTier: 'default'
  shellEnvironment: 'core-filtered'
  loginShell: false
  credentialsReadable: false
  hostHomeReadable: false
  procEnvironment: 'private-sanitized'
  sensitiveEnvironmentNamesVisible: false
  parentRepoRead: false
  gitMetadata: false
  temporaryDirectory: 'workspace-private'
  stagedExecutable: 'static-elf-read-only'
  callerReadDeniedPaths: 'enforced'
  containerSockets: false
}

/** Zero-model-call evidence for the exact Codex process about to run. */
export interface CodexExecutionEvidence {
  cliVersion: string
  executableSha256: string
  /** SHA-256 of the exact composed prompt argument proved present in the rendered prompt. */
  requestedPromptSha256: string
  effectivePromptSha256: string
  nonPromptArgsSha256: string
  controlledConfigSha256: string
  /** Sorted normalized paths compiled into the permission profile. */
  readDeniedPaths: string[]
  readDeniedPathsSha256: string
  readDeniedPathCount: number
  policy: CodexExecutionPolicy
}

/** @experimental */
export interface LocalHarnessResult {
  /** OS exit code. `null` when killed before exit. */
  exitCode: number | null
  /** Concatenated stdout. */
  stdout: string
  /** Concatenated stderr. */
  stderr: string
  /** Set when the process exited via signal (timeout / abort). */
  killedBySignal: NodeJS.Signals | null
  /** Wall-clock duration ms (spawn → exit). */
  durationMs: number
  /** Set when timeoutMs elapsed before exit. */
  timedOut: boolean
  /**
   * Set when the caller's AbortSignal fired before this result settled.
   * Optional so injected runners and stored results from older releases remain valid.
   */
  aborted?: boolean
  /** Present for a reproducible Codex run; parsed from the real terminal JSONL event. */
  usage?: CodexTokenUsage
  /** Present for reproducible Codex runs; generated and checked before model execution. */
  evidence?: CodexExecutionEvidence
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const processKillGraceMs = 250
const processGroupExitConfirmMs = 1_000
const processGroupExitPollMs = 10

class RollingByteCapture {
  private readonly chunks: Buffer[] = []
  private bytes = 0

  constructor(private readonly maxBytes: number) {}

  append(chunk: unknown): void {
    if (this.maxBytes === 0) return
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    this.chunks.push(buffer)
    this.bytes += buffer.length
    let excess = this.bytes - this.maxBytes
    while (excess > 0 && this.chunks.length > 0) {
      const first = this.chunks[0]!
      if (first.length <= excess) {
        this.chunks.shift()
        this.bytes -= first.length
        excess -= first.length
      } else {
        this.chunks[0] = first.subarray(excess)
        this.bytes -= excess
        excess = 0
      }
    }
  }

  text(): string {
    return Buffer.concat(this.chunks, this.bytes).toString('utf8')
  }
}

/**
 * Spawn a local coding harness CLI as a subprocess + collect its output.
 *
 * NOT responsible for parsing the harness's output or extracting a diff —
 * the in-process executor's `streamPrompt` orchestrates `git diff` against
 * the worktree after this resolves. This function is intentionally narrow:
 * spawn, wait, capture, return.
 *
 * Fails loud — throws when:
 *   - `cwd` doesn't exist (subprocess emits ENOENT; surfaced as Error)
 *   - the harness binary is not on PATH (ENOENT)
 *   - the caller signal was already aborted before process launch
 *
 * Does NOT throw when:
 *   - the subprocess exits non-zero (`result.exitCode` carries the code)
 *   - a non-reproducible subprocess is aborted / timed out (`result.aborted` /
 *     `result.timedOut` carries the reason even when a TERM-aware child exits zero)
 *
 * Reproducible Codex additionally requires a terminal usage event. If cancellation
 * prevents that event, this rejects with `CodexExecutionDiagnosticError` instead of
 * returning an incomplete reproducibility receipt.
 *
 * @experimental
 */
export async function runLocalHarness(
  options: RunLocalHarnessOptions,
): Promise<LocalHarnessResult> {
  const { harness, cwd, taskPrompt } = options
  // KEPT harness-name test: `codexReproducible` is a codex-SPECIFIC public option (its arg set,
  // its permission profile, its JSONL usage event), so this guard asserts caller self-consistency
  // and throws loudly rather than varying behavior by name. When a second harness gains a
  // reproducible mode, rename the option and make the arg set a row on `HARNESS_INVOCATIONS`.
  if (options.codexReproducible && harness !== 'codex') {
    throw new Error('runLocalHarness: codexReproducible requires the Codex harness')
  }
  if (options.codexReproducible && process.platform !== 'linux') {
    throw new Error('runLocalHarness: codexReproducible currently requires Linux')
  }
  if (options.codexReadDeniedPaths !== undefined && !options.codexReproducible) {
    throw new Error('runLocalHarness: codexReadDeniedPaths requires codexReproducible')
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new Error('runLocalHarness: maxOutputBytes must be a non-negative safe integer')
  }
  const spawnImpl = options.spawn ?? spawn

  const invocation = HARNESS_INVOCATIONS[harness]
  if (!invocation) {
    throw new Error(`runLocalHarness: unknown harness ${String(harness)}`)
  }

  const startedAt = Date.now()
  const requestedCommand = options.invocation?.command ?? invocation.command
  const args = options.invocation
    ? [...options.invocation.args]
    : buildHarnessArgs(harness, taskPrompt, options)
  if (options.codexReproducible) assertCodexReproducibleInvocation(requestedCommand, args)
  options.signal?.throwIfAborted()

  // We spawn the harness with `cwd`, but a harness that resolves its working
  // directory from `$PWD` rather than `getcwd()` (opencode does; the others may)
  // inherits the parent's stale `PWD` and edits the WRONG directory — its
  // worktree diff then comes back empty and the delegation fails with a phantom
  // "empty patch". Pin `PWD` to `cwd` so the harness edits where it was placed.
  // `baseEnv` feeds both the codex-isolated and the plain spawn paths below, so
  // pinning it here covers every runLocalHarness consumer.
  const baseEnv: NodeJS.ProcessEnv = { ...(options.env ?? process.env), PWD: cwd }
  const isolated = options.codexReproducible
    ? await isolateCodexHome({
        baseEnv,
        cwd,
        command: requestedCommand,
        readDeniedPaths: options.codexReadDeniedPaths ?? [],
        resolveExecutable: options.resolveCodexExecutable ?? resolveCodexNativeExecutable,
      })
    : {
        env: baseEnv,
        command: requestedCommand,
        cleanup: async () => undefined,
        controlledConfigSha256: '',
        executableSha256: '',
        readDeniedPathsSha256: '',
        readDeniedPathCount: 0,
        readDeniedPaths: [] as string[],
        diagnosticRedactionValues: [] as string[],
        ambientAuth: '',
        isolatedAuth: '',
        writeProbe: '',
        stagedWriteProbe: '',
        deniedProbePaths: [] as string[],
      }
  const env = isolated.env
  const command = isolated.command
  if (options.codexReproducible) assertCodexReproducibleInvocation(command, args)

  try {
    const evidence = options.codexReproducible
      ? await collectCodexExecutionEvidence({
          command,
          args,
          cwd,
          env,
          spawn: spawnImpl,
          controlledConfigSha256: isolated.controlledConfigSha256,
          executableSha256: isolated.executableSha256,
          readDeniedPathsSha256: isolated.readDeniedPathsSha256,
          readDeniedPathCount: isolated.readDeniedPathCount,
          readDeniedPaths: isolated.readDeniedPaths,
          ambientAuth: isolated.ambientAuth,
          isolatedAuth: isolated.isolatedAuth,
          writeProbe: isolated.writeProbe,
          stagedWriteProbe: isolated.stagedWriteProbe,
          deniedProbePaths: isolated.deniedProbePaths,
          ...(options.signal ? { signal: options.signal } : {}),
        })
      : undefined
    return await new Promise<LocalHarnessResult>((resolve, reject) => {
      let child: ChildProcess
      try {
        options.signal?.throwIfAborted()
        child = spawnImpl(command, args, {
          cwd,
          env,
          stdio: 'pipe',
          detached: process.platform !== 'win32',
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }

      // The harness takes its task as an argv arg, not on stdin. Leaving stdin
      // OPEN makes a non-TTY `opencode run` (and likely the other harnesses)
      // BLOCK forever waiting on input — zero output, SIGTERM at the wall cap,
      // empty patch -> "no candidate passed validation". Close stdin so the
      // subprocess sees EOF and proceeds (the `cliExecutor` leaf does the same).
      child.stdin?.end()

      const stdoutCapture = new RollingByteCapture(maxOutputBytes)
      const stderrCapture = new RollingByteCapture(maxOutputBytes)
      let timedOut = false
      let aborted = false
      let settled = false
      let leaderClosed = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let termination: Promise<void> | null = null

      const clearLifecycle = () => {
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const rejectOnce = (err: unknown) => {
        if (settled) return
        settled = true
        clearLifecycle()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      const terminate = (): Promise<void> => {
        if (!termination) {
          termination = terminateProcessTreeAndConfirm(child, () => leaderClosed)
          void termination.catch(rejectOnce)
        }
        return termination
      }

      timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              void terminate()
            }, timeoutMs)
          : null
      if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
        ;(timer as { unref: () => void }).unref()
      }

      const onAbort = () => {
        aborted = true
        void terminate()
      }
      if (options.signal) {
        if (options.signal.aborted) onAbort()
        else options.signal.addEventListener('abort', onAbort, { once: true })
      }

      child.stdout?.on('data', (chunk) => {
        stdoutCapture.append(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderrCapture.append(chunk)
      })

      const finalize = (result: LocalHarnessResult) => {
        if (settled) return
        settled = true
        clearLifecycle()
        resolve(result)
      }

      child.on('error', (err) => {
        leaderClosed = true
        if (timer) clearTimeout(timer)
        void (async () => {
          try {
            if (termination) await termination
            rejectOnce(err)
          } catch (terminationError) {
            rejectOnce(terminationError)
          }
        })()
      })

      child.on('close', (code, signal) => {
        leaderClosed = true
        if (timer) clearTimeout(timer)
        void (async () => {
          const stdout = stdoutCapture.text()
          const stderr = stderrCapture.text()
          try {
            if (
              !termination &&
              process.platform !== 'win32' &&
              typeof child.pid === 'number' &&
              processGroupExists(child.pid)
            ) {
              await terminate()
            }
            if (termination) await termination
            const durationMs = Date.now() - startedAt
            const usage = options.codexReproducible ? parseCodexTokenUsage(stdout) : undefined
            finalize({
              exitCode: code,
              stdout,
              stderr: redactCodexHome(stderr, env.CODEX_HOME),
              killedBySignal: signal,
              durationMs,
              timedOut,
              aborted,
              ...(usage ? { usage } : {}),
              ...(evidence ? { evidence } : {}),
            })
          } catch (err) {
            if (settled) return
            settled = true
            clearLifecycle()
            const durationMs = Date.now() - startedAt
            const reason = err instanceof Error ? err.message : String(err)
            reject(
              options.codexReproducible
                ? createCodexExecutionDiagnosticError({
                    reason,
                    exitCode: code,
                    killedBySignal: signal,
                    timedOut,
                    aborted,
                    durationMs,
                    stdout,
                    stderr,
                    codexHome: env.CODEX_HOME,
                    redactionValues: isolated.diagnosticRedactionValues,
                    cause: err,
                  })
                : err instanceof Error
                  ? err
                  : new Error(reason),
            )
          }
        })()
      })
    })
  } finally {
    await isolated.cleanup()
  }
}

const CODEX_EXECUTION_POLICY: CodexExecutionPolicy = {
  sessionPersistence: 'ephemeral',
  userConfig: false,
  rules: false,
  projectInstructions: false,
  skillInstructions: false,
  appInstructions: false,
  toolSuggestions: false,
  multiAgentInstructions: false,
  sandbox: 'workspace-write',
  permissionProfile: 'agent_runtime_reproducible',
  approvalPolicy: 'never',
  shellNetwork: false,
  webSearch: false,
  serviceTier: 'default',
  shellEnvironment: 'core-filtered',
  loginShell: false,
  credentialsReadable: false,
  hostHomeReadable: false,
  procEnvironment: 'private-sanitized',
  sensitiveEnvironmentNamesVisible: false,
  parentRepoRead: false,
  gitMetadata: false,
  temporaryDirectory: 'workspace-private',
  stagedExecutable: 'static-elf-read-only',
  callerReadDeniedPaths: 'enforced',
  containerSockets: false,
}

const FORBIDDEN_CODEX_PROMPT_MARKERS = [
  '<skills_instructions>',
  '# AGENTS.md instructions',
  '<apps_instructions>',
  '<recommended_plugins>',
  '<multi_agent_mode>',
  'You are `/root`, the primary agent',
] as const

async function collectCodexExecutionEvidence(opts: {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  spawn: NonNullable<RunLocalHarnessOptions['spawn']>
  controlledConfigSha256: string
  readDeniedPaths: string[]
  executableSha256: string
  readDeniedPathsSha256: string
  readDeniedPathCount: number
  ambientAuth: string
  isolatedAuth: string
  writeProbe: string
  stagedWriteProbe: string
  deniedProbePaths: string[]
  signal?: AbortSignal
}): Promise<CodexExecutionEvidence> {
  assertCodexReproducibleInvocation(opts.command, opts.args)
  const prompt = opts.args[1]
  if (opts.args[0] !== 'exec' || typeof prompt !== 'string' || prompt.length === 0) {
    throw new Error('runLocalHarness: reproducible Codex invocation must be codex exec <prompt>')
  }
  const cliVersion = (await runCodexProbe(opts, ['--version'])).stdout.trim()
  if (!/^codex-cli \d+\.\d+\.\d+(?:[-+].+)?$/.test(cliVersion)) {
    throw new Error(
      `runLocalHarness: unexpected Codex CLI version output ${JSON.stringify(cliVersion)}`,
    )
  }

  const hiddenEnvironmentChecks = [
    'CODEX_HOME',
    'CODEX_ACCESS_TOKEN',
    'CODEX_API_KEY',
    'OPENAI_API_KEY',
  ]
    .map((name) => `test -z "\${${name}:-}"`)
    .join(' && ')
  const sandboxProof = [
    hiddenEnvironmentChecks,
    'test -r .',
    '! test -r .git',
    'touch "$1"',
    'rm "$1"',
    'staged_dir=$(dirname "$2")',
    'test -x "$staged_dir/codex"',
    '! chmod 700 "$staged_dir" 2>/dev/null',
    '! rm "$staged_dir/codex" 2>/dev/null',
    '! touch "$2" 2>/dev/null',
    'shift 2',
    'for path in "$@"; do ! test -r "$path" || exit 1; done',
    'touch "$TMPDIR/.agent-runtime-tmp-proof"',
    'rm "$TMPDIR/.agent-runtime-tmp-proof"',
  ].join(' && ')
  await runCodexProbe(opts, [
    'sandbox',
    '-P',
    CODEX_PERMISSION_PROFILE,
    '-C',
    opts.cwd,
    'sh',
    '-c',
    sandboxProof,
    'sh',
    opts.writeProbe,
    opts.stagedWriteProbe,
    ...opts.deniedProbePaths,
  ])
  await runCodexProbe(opts, [
    'sandbox',
    '-P',
    CODEX_PERMISSION_PROFILE,
    '-C',
    opts.cwd,
    'python3',
    '-c',
    `import os,re
pattern=re.compile(br'(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|CODEX_HOME)', re.I)
paths=('/proc/1/environ', '/proc/self/environ', f'/proc/{os.getppid()}/environ')
for path in dict.fromkeys(paths):
 data=open(path,'rb').read().split(b'\\0')
 names=(item.split(b'=',1)[0] for item in data if b'=' in item)
 assert not any(pattern.search(name) for name in names), path`,
  ])
  await runCodexProbe(opts, [
    'sandbox',
    '-P',
    CODEX_PERMISSION_PROFILE,
    '-C',
    opts.cwd,
    'python3',
    '-c',
    'import socket,sys\nfor path in sys.argv[1:]:\n s=socket.socket(socket.AF_UNIX)\n try: s.connect(path)\n except OSError: continue\n raise SystemExit(1)',
    '/var/run/docker.sock',
    '/run/docker.sock',
    '/var/run/containerd/containerd.sock',
    '/run/containerd/containerd.sock',
  ])

  const debugArgs = codexPromptDebugArgs(opts.args, prompt)
  const renderedPrompt = (await runCodexProbe(opts, debugArgs)).stdout
  let parsedPrompt: unknown
  try {
    parsedPrompt = JSON.parse(renderedPrompt)
  } catch {
    throw new Error('runLocalHarness: codex debug prompt-input returned invalid JSON')
  }
  const promptEvidenceText = normalizeCodexDebugPromptNewlines(prompt)
  if (!Array.isArray(parsedPrompt) || !jsonTextContains(parsedPrompt, promptEvidenceText)) {
    throw new Error('runLocalHarness: Codex prompt evidence did not contain the exact task prompt')
  }
  const promptContextWithoutTask = JSON.stringify(redactJsonText(parsedPrompt, promptEvidenceText))
  for (const marker of FORBIDDEN_CODEX_PROMPT_MARKERS) {
    if (promptContextWithoutTask.includes(marker)) {
      throw new Error(`runLocalHarness: Codex prompt evidence contains forbidden marker ${marker}`)
    }
  }
  for (const marker of ['<permissions instructions>', '<environment_context>']) {
    if (!renderedPrompt.includes(marker)) {
      throw new Error(`runLocalHarness: Codex prompt evidence is missing required marker ${marker}`)
    }
  }

  const nonPromptArgs = [
    'codex',
    ...opts.args.map((arg, index) => (index === 1 ? '<PROMPT>' : arg)),
  ]
  return {
    cliVersion,
    executableSha256: opts.executableSha256,
    requestedPromptSha256: sha256(prompt),
    effectivePromptSha256: sha256(renderedPrompt),
    nonPromptArgsSha256: sha256(JSON.stringify(nonPromptArgs)),
    controlledConfigSha256: opts.controlledConfigSha256,
    readDeniedPathsSha256: opts.readDeniedPathsSha256,
    readDeniedPathCount: opts.readDeniedPathCount,
    readDeniedPaths: [...opts.readDeniedPaths],
    policy: { ...CODEX_EXECUTION_POLICY },
  }
}

function assertCodexReproducibleInvocation(command: string, args: string[]): void {
  const executable = basename(command)
  if (executable !== 'codex' && executable !== 'codex.exe') {
    throw new Error('runLocalHarness: reproducible Codex invocation must use the Codex executable')
  }
  const prompt = args[1]
  const expectedPrefix = ['exec', prompt, ...CODEX_REPRODUCIBLE_ARGS]
  const hasExactPrefix = expectedPrefix.every((arg, index) => args[index] === arg)
  const tail = args.slice(expectedPrefix.length)
  const validModel =
    tail[0] === '-m' &&
    typeof tail[1] === 'string' &&
    tail[1].length > 0 &&
    !tail[1].startsWith('-')
  const validReasoning =
    tail[2] === '-c' &&
    typeof tail[3] === 'string' &&
    /^model_reasoning_effort="(?:none|minimal|low|medium|high|xhigh)"$/.test(tail[3])
  if (!hasExactPrefix || tail.length !== 4 || !validModel || !validReasoning) {
    throw new Error(
      'runLocalHarness: reproducible Codex invocation does not match the required isolated argv',
    )
  }
}

function codexPromptDebugArgs(execArgs: string[], prompt: string): string[] {
  const debugArgs = ['debug', 'prompt-input']
  for (let index = 2; index < execArgs.length; index += 1) {
    const arg = execArgs[index]
    const value = execArgs[index + 1]
    if (arg === '-c' && value !== undefined) {
      debugArgs.push('-c', value)
      index += 1
    } else if (arg === '--disable' && value !== undefined) {
      debugArgs.push('--disable', value)
      index += 1
    } else if (arg === '-m' && value !== undefined) {
      debugArgs.push('-c', `model=${JSON.stringify(value)}`)
      index += 1
    } else if (arg === '-s' && value !== undefined) {
      debugArgs.push('-c', `sandbox_mode=${JSON.stringify(value)}`)
      index += 1
    }
  }
  debugArgs.push(prompt)
  return debugArgs
}

function runCodexProbe(
  opts: {
    command: string
    cwd: string
    env: NodeJS.ProcessEnv
    spawn: NonNullable<RunLocalHarnessOptions['spawn']>
    signal?: AbortSignal
  },
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = opts.spawn(opts.command, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: 'pipe',
        detached: process.platform !== 'win32',
      })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    child.stdin?.end()
    let stdout = ''
    let stderr = ''
    let settled = false
    let leaderClosed = false
    let termination: Promise<void> | null = null
    let terminationReason: 'aborted' | 'timed out' | null = null
    const clearLifecycle = () => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const rejectOnce = (err: unknown) => {
      if (settled) return
      settled = true
      clearLifecycle()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    const terminate = (reason?: 'aborted' | 'timed out'): Promise<void> => {
      if (reason) terminationReason ??= reason
      if (!termination) {
        termination = terminateProcessTreeAndConfirm(child, () => leaderClosed)
        void termination.catch(rejectOnce)
      }
      return termination
    }
    const timer = setTimeout(() => {
      void terminate('timed out')
    }, 10_000)
    timer.unref?.()
    const onAbort = () => {
      void terminate('aborted')
    }
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      leaderClosed = true
      clearTimeout(timer)
      void (async () => {
        try {
          if (termination) await termination
          rejectOnce(err)
        } catch (terminationError) {
          rejectOnce(terminationError)
        }
      })()
    })
    child.on('close', (code, signal) => {
      leaderClosed = true
      clearTimeout(timer)
      void (async () => {
        try {
          if (
            !termination &&
            process.platform !== 'win32' &&
            typeof child.pid === 'number' &&
            processGroupExists(child.pid)
          ) {
            await terminate()
          }
          if (termination) await termination
          if (settled) return
          settled = true
          clearLifecycle()
          if (code !== 0 || terminationReason) {
            const safeStderr = redactCodexHome(stderr, opts.env.CODEX_HOME)
            reject(
              new Error(
                `runLocalHarness: Codex evidence probe ${terminationReason ?? 'failed'} (exit ${String(code)}, signal ${String(signal)}): ${safeStderr.trim()}`,
              ),
            )
            return
          }
          resolve({ stdout, stderr })
        } catch (err) {
          rejectOnce(err)
        }
      })()
    })
  })
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Codex's debug renderer converts CRLF pairs to LF. No other whitespace is equivalent. */
function normalizeCodexDebugPromptNewlines(value: string): string {
  return value.replaceAll('\r\n', '\n')
}

function jsonTextContains(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle)
  if (Array.isArray(value)) return value.some((item) => jsonTextContains(item, needle))
  if (isRecord(value)) return Object.values(value).some((item) => jsonTextContains(item, needle))
  return false
}

function redactJsonText(value: unknown, text: string): unknown {
  if (typeof value === 'string') return value.replaceAll(text, '')
  if (Array.isArray(value)) return value.map((item) => redactJsonText(item, text))
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJsonText(item, text)]),
    )
  }
  return value
}

const CODEX_AUTH_ENV = ['CODEX_ACCESS_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY'] as const

const CODEX_PERMISSION_PROFILE = 'agent_runtime_reproducible'

async function isolateCodexHome(opts: {
  baseEnv: NodeJS.ProcessEnv
  cwd: string
  command: string
  readDeniedPaths: ReadonlyArray<string>
  resolveExecutable: (command: string, env: NodeJS.ProcessEnv) => Promise<string>
}): Promise<{
  env: NodeJS.ProcessEnv
  command: string
  cleanup: () => Promise<void>
  controlledConfigSha256: string
  executableSha256: string
  readDeniedPaths: string[]
  readDeniedPathsSha256: string
  readDeniedPathCount: number
  diagnosticRedactionValues: string[]
  ambientAuth: string
  isolatedAuth: string
  writeProbe: string
  stagedWriteProbe: string
  deniedProbePaths: string[]
}> {
  const isolatedHome = await mkdtemp(join(tmpdir(), 'agent-runtime-codex-'))
  await chmod(isolatedHome, 0o700)
  let workspaceTemp = ''
  let stagedExecutableDir = ''
  let ownsStagedExecutableDir = false
  let writeProbe = ''
  const cleanup = async () => {
    if (ownsStagedExecutableDir) {
      await chmod(stagedExecutableDir, 0o700).catch(() => undefined)
    }
    await Promise.all([
      ...(writeProbe ? [rm(writeProbe, { force: true })] : []),
      ...(workspaceTemp ? [rm(workspaceTemp, { recursive: true, force: true })] : []),
      ...(ownsStagedExecutableDir
        ? [rm(stagedExecutableDir, { recursive: true, force: true })]
        : []),
      rm(isolatedHome, { recursive: true, force: true }),
    ])
  }
  try {
    const readDeniedPaths = await normalizeReadDeniedPaths(opts.readDeniedPaths)
    const candidateRoot = await realpath(opts.cwd)
    writeProbe = join(candidateRoot, `.agent-runtime-write-proof-${randomUUID()}`)
    const stagedPath = join(candidateRoot, '.agent-runtime-bin')
    if (
      readDeniedPaths.some(
        (path) =>
          isSameOrDescendant(candidateRoot, path) ||
          isSameOrDescendant(stagedPath, path) ||
          isSameOrDescendant(path, stagedPath),
      )
    ) {
      throw new Error(
        'runLocalHarness: codexReadDeniedPaths cannot contain the candidate root or staged executable',
      )
    }
    const nativeExecutable = await opts.resolveExecutable(opts.command, opts.baseEnv)
    if (!(await isStaticElfExecutable(nativeExecutable))) {
      throw new Error(
        'runLocalHarness: reproducible Codex mode requires a statically linked Linux Codex ELF',
      )
    }
    const sourceExecutableSha256 = await sha256File(nativeExecutable)

    stagedExecutableDir = stagedPath
    try {
      await mkdir(stagedExecutableDir, { mode: 0o700 })
      ownsStagedExecutableDir = true
    } catch (err) {
      throw new Error(
        `runLocalHarness: candidate-private .agent-runtime-bin must not already exist: ${String((err as NodeJS.ErrnoException).code ?? err)}`,
      )
    }
    const stagedExecutable = join(stagedExecutableDir, 'codex')
    await copyFile(nativeExecutable, stagedExecutable, constants.COPYFILE_FICLONE)
    await chmod(stagedExecutable, 0o500)
    const executableSha256 = await sha256File(stagedExecutable)
    if (
      executableSha256 !== sourceExecutableSha256 ||
      !(await isStaticElfExecutable(stagedExecutable))
    ) {
      throw new Error('runLocalHarness: staged Codex executable digest mismatch')
    }
    await chmod(stagedExecutableDir, 0o500)

    workspaceTemp = await mkdtemp(join(candidateRoot, '.agent-runtime-tmp-'))
    await chmod(workspaceTemp, 0o700)
    const ambientHome = resolve(opts.baseEnv.CODEX_HOME?.trim() || join(homedir(), '.codex'))
    const ambientAuth = join(ambientHome, 'auth.json')
    const isolatedAuth = join(isolatedHome, 'auth.json')
    let authText = ''
    try {
      await access(ambientAuth, constants.R_OK)
      authText = await readCodexAuthRedactionText(ambientAuth)
      await symlink(ambientAuth, isolatedAuth)
    } catch (err) {
      throw new Error(
        `runLocalHarness: reproducible Codex mode requires readable auth.json: ${String((err as NodeJS.ErrnoException).code ?? err)}`,
      )
    }
    const deniedHostRoots = [homedir(), opts.baseEnv.HOME?.trim(), ambientHome]
      .filter((path): path is string => Boolean(path))
      .map((path) => resolve(path))
      .filter((path, index, paths) => paths.indexOf(path) === index)
    const controlledConfig = codexControlledConfig({
      ambientTmp: opts.baseEnv.TMPDIR?.trim() || tmpdir(),
      deniedHostRoots,
      workspaceTemp,
      stagedExecutableDir,
      readDeniedPaths,
    })
    await writeFile(join(isolatedHome, 'config.toml'), controlledConfig, { mode: 0o600 })
    const env = { ...opts.baseEnv }
    for (const name of Object.keys(env)) {
      if (
        codexSensitiveEnvironmentName.test(name) ||
        CODEX_AUTH_ENV.some((authName) => authName === name)
      ) {
        delete env[name]
      }
    }
    env.CODEX_HOME = isolatedHome
    const home = homedir()
    const deniedProbePaths = [
      ...deniedHostRoots,
      ambientAuth,
      isolatedAuth,
      join(home, '.claude', '.credentials.json'),
      join(home, '.claude.json'),
      join(home, '.local', 'share', 'opencode', 'auth.json'),
      join(home, '.agents'),
      join(home, 'Documents'),
      join(home, 'Downloads'),
      join(home, '.npm'),
      join(home, 'code'),
      ...readDeniedPaths,
    ].filter((path, index, paths) => paths.indexOf(path) === index)
    return {
      env,
      command: stagedExecutable,
      cleanup,
      controlledConfigSha256: sha256(controlledConfig),
      executableSha256,
      readDeniedPaths,
      readDeniedPathsSha256: sha256(JSON.stringify(readDeniedPaths)),
      readDeniedPathCount: readDeniedPaths.length,
      diagnosticRedactionValues: collectCodexDiagnosticRedactionValues(opts.baseEnv, authText),
      ambientAuth,
      isolatedAuth,
      writeProbe,
      stagedWriteProbe: join(stagedExecutableDir, 'write-proof'),
      deniedProbePaths,
    }
  } catch (err) {
    await cleanup()
    throw err
  }
}

function codexControlledConfig(opts: {
  ambientTmp: string
  deniedHostRoots: string[]
  workspaceTemp: string
  stagedExecutableDir: string
  readDeniedPaths: string[]
}): string {
  const rules = new Map<string, 'deny' | 'read' | 'write'>()
  const broadDeniedPaths = minimalPathRoots([
    ...opts.deniedHostRoots.map((path) => resolve(path)),
    tmpdir(),
    opts.ambientTmp,
    '/proc',
    '/run/docker',
    '/run/containerd',
  ])
  for (const path of broadDeniedPaths) {
    rules.set(path, 'deny')
  }
  const workspaceRoot = dirname(opts.workspaceTemp)
  for (const path of opts.readDeniedPaths) {
    const alreadyDenied = broadDeniedPaths.some((root) => isSameOrDescendant(path, root))
    if (!alreadyDenied || isSameOrDescendant(path, workspaceRoot)) rules.set(path, 'deny')
  }
  if (!rules.has(opts.workspaceTemp)) rules.set(opts.workspaceTemp, 'write')
  if (!rules.has(opts.stagedExecutableDir)) rules.set(opts.stagedExecutableDir, 'read')
  const filesystemRules = [...rules]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, access]) => `${JSON.stringify(path)} = ${JSON.stringify(access)}`)
    .join('\n')
  return `default_permissions = "${CODEX_PERMISSION_PROFILE}"
approval_policy = "never"
allow_login_shell = false
service_tier = "default"

[shell_environment_policy]
inherit = "core"
ignore_default_excludes = false
exclude = ["^CODEX_HOME$", "(?i).*TOKEN.*", "(?i).*KEY.*", "(?i).*SECRET.*", "(?i).*PASSWORD.*", "(?i).*CREDENTIAL.*", "(?i).*AUTH.*", "(?i).*COOKIE.*"]
set = { TMPDIR = ${JSON.stringify(opts.workspaceTemp)} }

[permissions.${CODEX_PERMISSION_PROFILE}.filesystem]
":minimal" = "read"
${filesystemRules}
":slash_tmp" = "deny"

[permissions.${CODEX_PERMISSION_PROFILE}.filesystem.":workspace_roots"]
"." = "write"
".git" = "deny"

[permissions.${CODEX_PERMISSION_PROFILE}.network]
enabled = false

[permissions.${CODEX_PERMISSION_PROFILE}.network.unix_sockets]
"/var/run/docker.sock" = "deny"
"/run/docker.sock" = "deny"
"/var/run/containerd/containerd.sock" = "deny"
"/run/containerd/containerd.sock" = "deny"
`
}

function isSameOrDescendant(path: string, root: string): boolean {
  const normalizedPath = resolve(path)
  const normalizedRoot = resolve(root)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`)
}

function minimalPathRoots(paths: ReadonlyArray<string>): string[] {
  const ordered = [...new Set(paths.map((path) => resolve(path)))].sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  )
  return ordered.filter(
    (path, index) => !ordered.slice(0, index).some((root) => isSameOrDescendant(path, root)),
  )
}

async function normalizeReadDeniedPaths(paths: ReadonlyArray<string>): Promise<string[]> {
  if (!Array.isArray(paths)) {
    throw new Error('runLocalHarness: codexReadDeniedPaths must be an array of absolute paths')
  }
  const normalized = new Set<string>()
  for (const path of paths) {
    if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || !isAbsolute(path)) {
      throw new Error('runLocalHarness: codexReadDeniedPaths must contain absolute paths')
    }
    const absolute = resolve(path)
    normalized.add(absolute)
    try {
      normalized.add(await realpath(absolute))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  return [...normalized].sort()
}

async function resolveCodexNativeExecutable(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const candidates =
    command.includes(sep) || isAbsolute(command)
      ? [resolve(command)]
      : (env.PATH ?? '')
          .split(delimiter)
          .filter(Boolean)
          .map((entry) => join(entry, command))
  const seen = new Set<string>()
  for (const candidate of candidates) {
    let resolved: string
    try {
      await access(candidate, constants.X_OK)
      resolved = await realpath(candidate)
    } catch {
      continue
    }
    if (seen.has(resolved)) continue
    seen.add(resolved)
    if (await isStaticElfExecutable(resolved)) return resolved
    const packageRoot = await findCodexPackageRoot(resolved)
    if (!packageRoot) continue
    const bundled = await findBundledCodexExecutable(packageRoot)
    if (bundled) return bundled
  }
  throw new Error(
    'runLocalHarness: could not resolve the native Codex executable from the requested command',
  )
}

async function findCodexPackageRoot(file: string): Promise<string | undefined> {
  let cursor = dirname(file)
  while (true) {
    try {
      const parsed = JSON.parse(await readFile(join(cursor, 'package.json'), 'utf8')) as {
        name?: unknown
      }
      if (parsed.name === '@openai/codex') return cursor
    } catch {
      // Keep walking; PATH wrappers commonly live outside the package directory.
    }
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    cursor = parent
  }
}

async function findBundledCodexExecutable(packageRoot: string): Promise<string | undefined> {
  const target = linuxCodexTarget()
  const candidates = [
    join(
      packageRoot,
      'node_modules',
      '@openai',
      target.packageName,
      'vendor',
      target.triple,
      'bin',
      'codex',
    ),
    join(packageRoot, 'vendor', target.triple, 'bin', 'codex'),
  ]
  for (const executable of candidates) {
    if (await isStaticElfExecutable(executable)) return executable
  }
  return undefined
}

function linuxCodexTarget(): { packageName: string; triple: string } {
  if (process.platform !== 'linux') {
    throw new Error('runLocalHarness: reproducible Codex mode requires Linux')
  }
  if (process.arch === 'x64') {
    return { packageName: 'codex-linux-x64', triple: 'x86_64-unknown-linux-musl' }
  }
  if (process.arch === 'arm64') {
    return { packageName: 'codex-linux-arm64', triple: 'aarch64-unknown-linux-musl' }
  }
  throw new Error(`runLocalHarness: unsupported Linux architecture ${process.arch}`)
}

async function isStaticElfExecutable(path: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    await access(path, constants.X_OK)
    handle = await open(path, 'r')
    const header = Buffer.alloc(64)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (
      bytesRead !== header.length ||
      !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      header[4] !== 2 ||
      header[5] !== 1
    ) {
      return false
    }
    const programHeaderOffset = Number(header.readBigUInt64LE(32))
    const programHeaderSize = header.readUInt16LE(54)
    const programHeaderCount = header.readUInt16LE(56)
    const expectedMachine = process.arch === 'x64' ? 62 : process.arch === 'arm64' ? 183 : -1
    if (
      ![2, 3].includes(header.readUInt16LE(16)) ||
      header.readUInt16LE(18) !== expectedMachine ||
      !Number.isSafeInteger(programHeaderOffset) ||
      programHeaderOffset < 64 ||
      programHeaderSize < 56 ||
      programHeaderSize > 1024 ||
      programHeaderCount === 0 ||
      programHeaderCount > 1024
    ) {
      return false
    }
    const tableSize = programHeaderSize * programHeaderCount
    const table = Buffer.alloc(tableSize)
    const tableRead = await handle.read(table, 0, tableSize, programHeaderOffset)
    if (tableRead.bytesRead !== tableSize) return false
    for (let index = 0; index < programHeaderCount; index += 1) {
      const type = table.readUInt32LE(index * programHeaderSize)
      if (type === 3) return false
    }
    return true
  } catch {
    return false
  } finally {
    await handle?.close()
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveDigest(hash.digest('hex')))
  })
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return
    }
  }
  try {
    child.kill(signal)
  } catch {
    // The process may have exited between the timer and signal delivery.
  }
}

export async function terminateProcessTreeAndConfirm(
  child: ChildProcess,
  leaderClosed: () => boolean,
  context = 'runLocalHarness',
): Promise<void> {
  signalProcessTree(child, 'SIGTERM')
  if (process.platform === 'win32' || typeof child.pid !== 'number') {
    const graceDeadline = Date.now() + processKillGraceMs
    while (!leaderClosed() && Date.now() < graceDeadline) {
      await delayUntilNextProcessCheck(graceDeadline)
    }
    if (!leaderClosed()) signalProcessTree(child, 'SIGKILL')
    return
  }
  const processGroupId = child.pid
  const graceDeadline = Date.now() + processKillGraceMs
  if (await waitForProcessGroupExit(processGroupId, graceDeadline)) return

  signalProcessTree(child, 'SIGKILL')
  const killDeadline = Date.now() + processGroupExitConfirmMs
  if (await waitForProcessGroupExit(processGroupId, killDeadline)) return
  throw new Error(`${context}: process group ${processGroupId} survived SIGKILL`)
}

async function waitForProcessGroupExit(processGroupId: number, deadline: number): Promise<boolean> {
  while (processGroupExists(processGroupId)) {
    if (Date.now() >= deadline) return false
    await delayUntilNextProcessCheck(deadline)
  }
  return true
}

async function delayUntilNextProcessCheck(deadline: number): Promise<void> {
  const delayMs = Math.min(processGroupExitPollMs, Math.max(0, deadline - Date.now()))
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
}

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return false
    return true
  }
}

/** Parse and validate the one terminal usage event emitted by `codex exec --json`. */
export function parseCodexTokenUsage(stdout: string): CodexTokenUsage {
  const completed: unknown[] = []
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      throw new Error(`runLocalHarness: Codex JSONL line ${index + 1} is not valid JSON`)
    }
    if (isRecord(event) && event.type === 'turn.completed') completed.push(event)
  }
  if (completed.length !== 1) {
    throw new Error(
      `runLocalHarness: expected exactly one Codex turn.completed usage event, received ${completed.length}`,
    )
  }
  const event = completed[0]
  if (!isRecord(event) || !isRecord(event.usage)) {
    throw new Error('runLocalHarness: Codex turn.completed event is missing usage')
  }
  const usage = event.usage
  const inputTokens = naturalNumber(usage.input_tokens, 'input_tokens')
  const cachedInputTokens = naturalNumber(usage.cached_input_tokens, 'cached_input_tokens')
  const outputTokens = naturalNumber(usage.output_tokens, 'output_tokens')
  const reasoningOutputTokens = naturalNumber(
    usage.reasoning_output_tokens,
    'reasoning_output_tokens',
  )
  if (cachedInputTokens > inputTokens) {
    throw new Error('runLocalHarness: Codex cached_input_tokens exceeds input_tokens')
  }
  if (reasoningOutputTokens > outputTokens) {
    throw new Error('runLocalHarness: Codex reasoning_output_tokens exceeds output_tokens')
  }
  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function naturalNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`runLocalHarness: Codex usage.${field} must be a non-negative safe integer`)
  }
  return value
}
