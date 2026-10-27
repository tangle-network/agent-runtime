import { type ChildProcess, spawn } from 'node:child_process'
import {
  type AgentProfile,
  type HarnessType,
  nativeReasoningControl,
  type ReasoningEffort,
} from '@tangle-network/agent-interface'
import { type CliLaunch, execCli } from '@tangle-network/sdk-cli-runner'
import { concreteProfileModel } from '../runtime/supervise/model-policy'
import { createCodexExecutionDiagnosticError, redactCodexHome } from './codex-diagnostics'
import {
  assertCodexReproducibleInvocation,
  type CodexExecutionEvidence,
  collectCodexExecutionEvidence,
} from './codex-execution-evidence'
import { CODEX_REPRODUCIBLE_ARGS } from './codex-execution-policy'
import { isolateCodexHome } from './codex-home-isolation'
import { isSupportedCodexPlatform, resolveCodexNativeExecutable } from './codex-native-executable'
import { type CodexTokenUsage, parseCodexTokenUsage } from './codex-token-usage'

/**
 * Local coding harness available inside the sandbox — a narrowing of the shared `HarnessType`
 * vocabulary, NOT a private spelling of it. The harness id is `claude-code`; `claude` is the
 * EXECUTABLE name and lives only in the `command` field below. Keeping one vocabulary is what
 * lets a `LocalHarness` be handed straight to the profile materializer and the capability table
 * with no translation step.
 */
export type LocalHarness = Extract<
  HarnessType,
  'claude-code' | 'codex' | 'kimi-code' | 'opencode' | 'pi'
>

/** Result of mapping an `AgentProfile` + task prompt onto a harness invocation. */
interface HarnessInvocation {
  command: string
  args: string[]
  /** Exact profile-composed prompt carried by the invocation. */
  prompt: string
}

interface HarnessInvocationOptions {
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
  /** With `dangerouslySkipPermissions`: the caller owns the workspace and the machine, so the
   *  harness gets full access, OS sandbox included (each row's `fullAccessArgs`). Only the
   *  in-place leaf sets it; a worktree candidate keeps its sandbox. */
  fullAccess?: boolean
  /** Run Codex with benchmark-safe process controls and JSONL usage output.
   *  Valid only for the Codex harness. */
  codexReproducible?: boolean
}

interface HarnessInvocationSpec {
  command: string
  buildArgs: (taskPrompt: string) => string[]
  /** Canonical prompt argument replaced with `-` when this CLI accepts stdin. */
  stdinPromptArgIndex?: number
  /** Map a resolved model to the harness's model-selector flag. */
  modelArgs: (model: string) => string[]
  /** Argv for the native reasoning-effort token agent-interface's `nativeReasoningControl`
   *  returns. Absent when the installed CLI exposes no effort control: a requested effort is
   *  then refused rather than silently dropped. */
  reasoningArgs?: (nativeLevel: string) => string[]
  /**
   * Argv that lets an unattended run edit its workspace without stopping on an interactive
   * approval gate. Absent when the harness has no such gate on its non-interactive path.
   */
  permissionBypassArgs?: () => string[]
  /** Argv for a run whose caller owns the workspace AND the machine it runs on, when that is
   *  more than `permissionBypassArgs` grants. Absent means `permissionBypassArgs` already is
   *  full access for this harness (Claude Code's skip-permissions has no OS sandbox to drop). */
  fullAccessArgs?: () => string[]
  /**
   * Capability claim: a profile's MCP servers reach this harness through the shared
   * materializer's plan on this path — the plan's files and flags must name a configuration
   * surface the installed CLI actually reads. Absent = a profile carrying an enabled MCP
   * server is REFUSED at admission, before any workspace state, because spawning with config
   * the harness never loads would run the agent without its granted tools while nothing
   * reports the loss.
   */
  profileMcp?: true
}

/**
 * Per-harness prompt invocation and model, effort, permission and input capabilities.
 * `harnessInvocation` composes these with the authored profile before execution.
 *
 * Every per-harness difference is a FIELD on this row, never a test on the harness name at a
 * call site: adding harness N+1 is one entry here, and a caller asking for a capability the
 * row does not declare is refused up front instead of silently losing the request.
 */
export const HARNESS_INVOCATIONS: Record<LocalHarness, HarnessInvocationSpec> = {
  'claude-code': {
    command: 'claude',
    // `-p` IS headless/print mode; the old `--headless` flag was removed from the CLI.
    // Permission bypass is an explicit per-run opt-in below, never the public default.
    buildArgs: (taskPrompt) => ['-p', taskPrompt],
    // `--model` is the ONLY spelling the CLI accepts. Claude Code 2.1.239 exits 1 with
    // `error: unknown option '-m'`; `--help` lists `--model <model>` and no short alias.
    // The long form is also accepted by codex and opencode, so it is the safe spelling.
    modelArgs: (model) => ['--model', model],
    reasoningArgs: (level) => ['--effort', level],
    permissionBypassArgs: () => ['--dangerously-skip-permissions'],
    // `.tangle/claude-mcp.json` + `--mcp-config/--strict-mcp-config`, real claude flags.
    profileMcp: true,
  },
  codex: {
    command: 'codex',
    buildArgs: (taskPrompt) => ['exec', taskPrompt],
    stdinPromptArgIndex: 1,
    modelArgs: (model) => ['-m', model],
    reasoningArgs: (level) => ['-c', `model_reasoning_effort="${level}"`],
    // Non-interactive editing WITHOUT surrendering the OS sandbox. `codex exec` has no approval
    // gate to stall on (`-a/--ask-for-approval` exists only on the top-level `codex`), so
    // `--dangerously-bypass-approvals-and-sandbox` buys nothing on the approvals axis and pays the
    // entire sandbox for it — writes would escape the worktree to ~/.ssh, ~/.aws, and secrets.
    // The sandbox is what MAKES the blast radius the worktree. Same form as CODEX_REPRODUCIBLE_ARGS.
    permissionBypassArgs: () => ['--sandbox', 'workspace-write', '-c', 'approval_policy="never"'],
    // workspace-write keeps every `.git` read-only and has no network (codex-cli 0.163.0, measured
    // 2026-10-19: `git commit` exit 128 even with `--add-dir <git dir>`, and `curl` exit 6), so an
    // in-place caller that commits and pushes its own tree needs the sandbox off, as Claude has.
    fullAccessArgs: () => ['--dangerously-bypass-approvals-and-sandbox'],
    // `-c mcp_servers={...}` inline TOML overrides — codex's own config channel.
    profileMcp: true,
  },
  opencode: {
    command: 'opencode',
    buildArgs: (taskPrompt) => ['run', taskPrompt],
    modelArgs: (model) => ['-m', model],
    reasoningArgs: (level) => ['--variant', level],
    // `opencode run` DOES gate permissions: without this it denies writes outside the
    // working directory and phrases the refusal as "The user rejected permission", which
    // reads as an agent that gave up rather than a harness that was never granted rights.
    // Measured: three unattended worktree runs produced empty patches for exactly this.
    permissionBypassArgs: () => ['--auto'],
    // The materializer's generated `opencode.json` `mcp` block, which opencode auto-loads.
    profileMcp: true,
  },
  pi: {
    command: 'pi',
    // `--print` IS the non-interactive mode: process the prompt and exit.
    buildArgs: (taskPrompt) => ['--print', taskPrompt],
    // pi takes a pattern that accepts `provider/id`, so a routed id passes through whole.
    modelArgs: (model) => ['--model', model],
    reasoningArgs: (level) => ['--thinking', level],
    // `--approve` trusts project-local files for this run, which is what an unattended
    // run in a throwaway worktree needs. It grants no OS-level escape: unlike a full
    // sandbox bypass, the blast radius stays the working directory.
    permissionBypassArgs: () => ['--approve'],
    // The materializer writes `.pi/mcp.json` for the `pi-mcp-adapter` extension and declares
    // that prerequisite on the plan's `requires`. This path does not enforce `requires`, so
    // the claim covers the config surface, not the extension's presence.
    profileMcp: true,
  },
  'kimi-code': {
    command: 'kimi',
    // `-p` IS headless prompt mode (verified `kimi --help`, kimi-code 2.2.0): run one prompt
    // non-interactively and print the response. It CANNOT combine with `-y`/`--auto`, and a
    // headless run auto-approves its tool calls, so there is no interactive approval gate on
    // this path and the row contributes no permissionBypassArgs.
    buildArgs: (taskPrompt) => ['-p', taskPrompt],
    // `-m, --model <model>` takes an alias from the user's OWN kimi config (`models[modelId]`,
    // kimi-code 2.3.0 resolveModelForReady); an unknown alias fails at the CLI with
    // `model.not_found`, so any qualified id passes through whole below.
    modelArgs: (model) => ['-m', model],
    // NO reasoningArgs: kimi-code 2.x exposes no effort flag. `--thinking`/`--no-thinking`
    // are legacy kimi-cli spellings — 2.2.0 exits 1 with `unknown option` on both — so a
    // requested effort is refused rather than silently dropped.
    // profileMcp: agent-profile-materialize >= 0.27.2 (the declared range floor) lowers kimi
    // MCP to `<cwd>/.kimi-code/mcp.json` — the surface kimi-code 2.x auto-loads (2.3.0
    // dist/main.mjs: `project: join(input.cwd, ".kimi-code", "mcp.json")`), live-probed on
    // 2.2.0. Materializers < 0.27.2 targeted `.kimi/mcp.json` + a `--mcp-config-file` plan
    // flag no published kimi-code accepts, so the range floor keeps the claim honest.
    profileMcp: true,
  },
}

/** Every local harness, in table order — the one list `AGENT_RUNTIME_LOCAL_HARNESSES` and any
 *  other harness enumeration reads, so adding a row above is the only edit a new harness needs. */
export const LOCAL_HARNESSES = Object.keys(HARNESS_INVOCATIONS) as ReadonlyArray<LocalHarness>

/**
 * Whether the harness's native control can express this reasoning effort. Admission checks read
 * this so a profile the invocation would later refuse is rejected BEFORE any workspace state is
 * created, against the same table that emits the argv. Every harness with a native control
 * expresses every rung through agent-interface's `nativeReasoningControl`.
 */
export function harnessSupportsReasoningEffort(
  harness: LocalHarness,
  _reasoningEffort: ReasoningEffort,
): boolean {
  return HARNESS_INVOCATIONS[harness].reasoningArgs !== undefined
}

/**
 * Whether a profile's MCP servers reach this harness on the local-harness path — the row's
 * `profileMcp` claim that the shared materializer's plan names a config surface the installed
 * CLI reads. Admission checks read this so a profile the spawn would silently disarm is
 * rejected BEFORE any workspace state is created, against the same table that emits the argv.
 */
export function harnessMaterializesProfileMcp(harness: LocalHarness): boolean {
  return HARNESS_INVOCATIONS[harness].profileMcp === true
}

/** The argv for a profile effort; `null` from agent-interface means the CLI takes no flag
 *  for that rung (opencode `none`). */
function harnessReasoningArgs(
  harness: LocalHarness,
  reasoningEffort: ReasoningEffort,
  model: string | undefined,
): string[] {
  const reasoningArgs = HARNESS_INVOCATIONS[harness].reasoningArgs
  if (reasoningArgs === undefined) {
    throw new Error(
      `harnessInvocation: ${harness} cannot express reasoning effort ${String(reasoningEffort)}`,
    )
  }
  const level = nativeReasoningControl(harness, reasoningEffort, model)
  return level === null ? [] : reasoningArgs(level)
}

export function buildHarnessArgs(
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
    const bypass = options.fullAccess
      ? (invocation.fullAccessArgs ?? invocation.permissionBypassArgs)
      : invocation.permissionBypassArgs
    args.push(...(bypass?.() ?? []))
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

/** Task/instruction preamble and model controls; native prompts are applied in the workspace plan. */
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
    const model = harnessProfileModel(harness, profile)
    if (!model) {
      throw new Error('harnessInvocation: codexReproducible requires profile.model.default')
    }
    if (profile.model?.reasoningEffort === undefined) {
      throw new Error('harnessInvocation: codexReproducible requires profile.model.reasoningEffort')
    }
  }

  const instructions = profile.prompt?.instructions
  if (
    instructions !== undefined &&
    (!Array.isArray(instructions) ||
      instructions.some((instruction) => typeof instruction !== 'string'))
  ) {
    throw new Error('harnessInvocation: profile.prompt.instructions must be an array of strings')
  }
  const promptSections = [
    ...(instructions?.filter((instruction) => instruction.trim().length > 0) ?? []),
    taskPrompt,
  ]
  const composedPrompt = promptSections.join('\n\n')

  const args = buildHarnessArgs(harness, composedPrompt, options)

  const model = harnessProfileModel(harness, profile)
  if (model) {
    args.push(...invocation.modelArgs(model))
  }

  const reasoningEffort = profile.model?.reasoningEffort
  if (reasoningEffort !== undefined) {
    args.push(...harnessReasoningArgs(harness, reasoningEffort, model))
  }

  return { command: invocation.command, args, prompt: composedPrompt }
}

/** Render the exact profile provider/model through the selected native harness. */
function harnessProfileModel(harness: LocalHarness, profile: AgentProfile): string | undefined {
  const model = concreteProfileModel(profile)
  if (!model) return undefined
  const provider = profile.model?.provider?.trim()
  if (!provider) return model
  if (harness === 'opencode') {
    return model.includes('/') ? model : `${provider}/${model}`
  }
  // kimi's `-m` resolves an alias against the user's OWN kimi config, whose providers the
  // operator defines (`kimi provider …`); there is no single native provider to enforce, and
  // the CLI refuses an unknown alias itself. The qualified id passes through whole.
  if (harness === 'kimi-code') {
    return model
  }
  const nativeProvider = harness === 'codex' ? 'openai' : 'anthropic'
  if (provider !== nativeProvider) {
    throw new Error(
      `harnessInvocation: ${harness} cannot materialize model provider ${JSON.stringify(provider)}; expected ${nativeProvider}`,
    )
  }
  return model
}

/** @experimental */
export interface RunLocalHarnessOptions {
  harness: LocalHarness
  /** Working directory for the subprocess (typically a worktree path). */
  cwd: string
  /** Task prompt delivered through the harness's supported input transport. */
  taskPrompt: string
  /**
   * Mapper invocation or custom argv; command defaults to the harness binary.
   * The mapper's exact composed `prompt` enables supported stdin transport.
   * Without an invocation, use the default prompt-only shape.
   */
  invocation?: { command?: string; args: ReadonlyArray<string>; prompt?: string }
  /** Allow autonomous edits without an interactive approval gate, using whichever bypass argv the
   *  harness declares. Use only when `cwd` is an isolated candidate worktree. */
  dangerouslySkipPermissions?: boolean
  /** Isolate Codex from ambient configuration/instructions and require JSONL token usage.
   *  The invocation should come from `harnessInvocation(..., { codexReproducible: true })`. */
  codexReproducible?: boolean
  /** Absolute host paths that reproducible Codex must not read. The normalized set is compiled
   *  into the controlled permission profile and its digest is returned in execution evidence. */
  codexReadDeniedPaths?: ReadonlyArray<string>
  /** Optional wall-clock kill deadline (ms). Omit it for no timer. A positive value sends
   *  SIGTERM on expiry. */
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

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** The non-reproducible launch: the caller's environment and command, nothing staged. */
function plainLaunch(env: NodeJS.ProcessEnv, command: string) {
  return {
    env,
    command,
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
}

/**
 * Run a local harness through the shared CLI runner (`@tangle-network/sdk-cli-runner`): it owns
 * the process group, so leftover descendants are stopped and confirmed gone before the result
 * resolves, an abort escalates to SIGKILL, and output keeps the newest `maxOutputBytes` per
 * stream. The caller owns output parsing and workspace diffs.
 *
 * Spawn failures and signals already aborted before launch reject.
 *
 * Ordinary nonzero exits and cancellation return the exit code and timeout/abort flags.
 * A failed prompt delivery rejects after the child is reaped, when the child exited zero.
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
  // and throws loudly rather than varying behavior by name.
  if (options.codexReproducible && harness !== 'codex') {
    throw new Error('runLocalHarness: codexReproducible requires the Codex harness')
  }
  if (options.codexReproducible && !isSupportedCodexPlatform()) {
    throw new Error(
      `runLocalHarness: codexReproducible does not support ${process.platform}/${process.arch};` +
        ' supported: linux and darwin on x64 or arm64',
    )
  }
  if (options.codexReadDeniedPaths !== undefined && !options.codexReproducible) {
    throw new Error('runLocalHarness: codexReadDeniedPaths requires codexReproducible')
  }
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new Error('runLocalHarness: maxOutputBytes must be a non-negative safe integer')
  }
  const invocation = HARNESS_INVOCATIONS[harness]
  if (!invocation) {
    throw new Error(`runLocalHarness: unknown harness ${String(harness)}`)
  }

  const requestedCommand = options.invocation?.command ?? invocation.command
  const args = options.invocation
    ? [...options.invocation.args]
    : buildHarnessArgs(harness, taskPrompt, options)
  if (options.codexReproducible) assertCodexReproducibleInvocation(requestedCommand, args)
  options.signal?.throwIfAborted()

  // Some CLIs resolve cwd through PWD; pin it for both plain and isolated launches.
  const baseEnv: NodeJS.ProcessEnv = { ...(options.env ?? process.env), PWD: cwd }
  const isolated = options.codexReproducible
    ? await isolateCodexHome({
        baseEnv,
        cwd,
        command: requestedCommand,
        readDeniedPaths: options.codexReadDeniedPaths ?? [],
        resolveExecutable: options.resolveCodexExecutable ?? resolveCodexNativeExecutable,
      })
    : plainLaunch(baseEnv, requestedCommand)
  const { env, command } = isolated
  if (options.codexReproducible) assertCodexReproducibleInvocation(command, args)

  try {
    const evidence = options.codexReproducible
      ? await collectCodexExecutionEvidence({
          command,
          args,
          cwd,
          env,
          spawn: options.spawn ?? spawn,
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
    // Codex's debug renderer requires literal argv; preserve reproducible prompt evidence.
    const inputIndex = options.codexReproducible ? undefined : invocation.stdinPromptArgIndex
    const canonicalPrompt = options.invocation ? options.invocation.prompt : taskPrompt
    const input =
      inputIndex !== undefined &&
      args[0] === invocation.buildArgs('')[0] &&
      args[inputIndex] === canonicalPrompt
        ? canonicalPrompt
        : undefined
    // Forced stdin rejects blank prompts that argv accepts. Its decoder strips one BOM.
    const stdinPrompt = input?.trim() ? input : undefined
    const spawnArgs =
      stdinPrompt === undefined
        ? args
        : args.map((arg, index) => (index === inputIndex ? '-' : arg))
    const spawnImpl = options.spawn
    const run = await execCli(
      {
        command,
        args: spawnArgs,
        cwd,
        env,
        inheritEnv: false,
        ...(options.timeoutMs !== undefined && options.timeoutMs > 0
          ? { timeoutMs: options.timeoutMs }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ownProcessGroup: true,
        stdinFailure: 'report',
        ...(spawnImpl
          ? {
              launcher: (spec): CliLaunch => ({
                child: spawnImpl(spec.command, spec.args, {
                  cwd: spec.cwd,
                  env: spec.env,
                  stdio: 'pipe',
                  detached: spec.detached,
                }),
              }),
            }
          : {}),
      },
      undefined,
      {
        maxOutputBytes,
        stdin: stdinPrompt?.startsWith('﻿') ? `﻿${stdinPrompt}` : (stdinPrompt ?? ''),
      },
    )
    const { exit, stdout, stderr: rawStderr, durationMs } = run
    const timedOut = exit.timedOut
    const aborted = exit.aborted === true
    try {
      if (exit.spawnError !== undefined) throw new Error(exit.spawnError)
      if (exit.processGroupError !== undefined) throw new Error(exit.processGroupError)
      if (exit.stdinError !== undefined && exit.code === 0 && !timedOut && !aborted) {
        throw Object.assign(new Error(exit.stdinError), { code: exit.stdinErrorCode })
      }
      const usage = options.codexReproducible ? parseCodexTokenUsage(stdout ?? '') : undefined
      return {
        exitCode: exit.code,
        stdout: stdout ?? '',
        stderr: redactCodexHome(rawStderr, env.CODEX_HOME),
        killedBySignal: exit.signal,
        durationMs,
        timedOut,
        aborted,
        ...(usage ? { usage } : {}),
        ...(evidence ? { evidence } : {}),
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (!options.codexReproducible || exit.spawnError !== undefined) throw err
      throw createCodexExecutionDiagnosticError({
        reason,
        exitCode: exit.code,
        killedBySignal: exit.signal,
        timedOut,
        aborted,
        durationMs,
        stdout: stdout ?? '',
        stderr: rawStderr,
        codexHome: env.CODEX_HOME,
        redactionValues: isolated.diagnosticRedactionValues,
        cause: err,
      })
    }
  } finally {
    await isolated.cleanup()
  }
}
