import {
  type AgentProfile,
  type HarnessType,
  nativeReasoningControl,
  type ReasoningEffort,
} from '@tangle-network/agent-interface'
import { concreteProfileModel } from '../runtime/supervise/model-policy'
import { CODEX_REPRODUCIBLE_ARGS } from './codex-execution-policy'

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
 * Default per-harness command + arg shape. `buildArgs` takes ONLY the task prompt and
 * emits the prompt-only invocation (no model, no system prompt) — the safe default shape
 * the in-process executor's `streamPrompt` drives. `modelArgs` maps a resolved model to
 * the harness's selector flag, which each harness spells for itself: codex, kimi-code and
 * opencode take `-m <model>`, claude-code and pi take `--model <model>`. The §1.5
 * profile-aware mapper `harnessInvocation` composes these to thread the full
 * supervisor-authored profile (systemPrompt + model) into argv.
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
