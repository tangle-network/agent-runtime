import type { AgentProfile, HarnessType, ReasoningEffort } from '@tangle-network/agent-interface'
import { concreteProfileModel } from '../runtime/supervise/model-policy'
import { CODEX_REPRODUCIBLE_ARGS } from './codex-execution-policy'

/**
 * Local coding harness available inside the sandbox — a narrowing of the shared `HarnessType`
 * vocabulary, NOT a private spelling of it. The harness id is `claude-code`; `claude` is the
 * EXECUTABLE name and lives only in the `command` field below. Keeping one vocabulary is what
 * lets a `LocalHarness` be handed straight to the profile materializer and the capability table
 * with no translation step.
 */
export type LocalHarness = Extract<HarnessType, 'claude-code' | 'codex' | 'opencode' | 'pi'>

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

/** pi's own thinking scale, which happens to match the shared effort names one-for-one. */
const PI_REASONING_LEVELS: NativeReasoningLevels = {
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
  /** Argv for a run whose caller owns the workspace AND the machine it runs on, when that is
   *  more than `permissionBypassArgs` grants. Absent means `permissionBypassArgs` already is
   *  full access for this harness (Claude Code's skip-permissions has no OS sandbox to drop). */
  fullAccessArgs?: () => string[]
}

/**
 * Default per-harness command + arg shape. `buildArgs` takes ONLY the task prompt and
 * emits the prompt-only invocation (no model, no system prompt) — the safe default shape
 * the in-process executor's `streamPrompt` drives. `modelArgs` maps a resolved model to
 * the harness's selector flag, which each harness spells for itself: codex and opencode
 * take `-m <model>`, claude-code and pi take `--model <model>`. The §1.5
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
    // workspace-write keeps every `.git` read-only and has no network (codex-cli 0.163.0, measured
    // 2026-10-19: `git commit` exit 128 even with `--add-dir <git dir>`, and `curl` exit 6), so an
    // in-place caller that commits and pushes its own tree needs the sandbox off, as Claude has.
    fullAccessArgs: () => ['--dangerously-bypass-approvals-and-sandbox'],
  },
  opencode: {
    command: 'opencode',
    buildArgs: (taskPrompt) => ['run', taskPrompt],
    modelArgs: (model) => ['-m', model],
    reasoning: {
      levels: OPENCODE_REASONING_LEVELS,
      args: (level) => ['--variant', level],
    },
    // `opencode run` DOES gate permissions: without this it denies writes outside the
    // working directory and phrases the refusal as "The user rejected permission", which
    // reads as an agent that gave up rather than a harness that was never granted rights.
    // Measured: three unattended worktree runs produced empty patches for exactly this.
    permissionBypassArgs: () => ['--auto'],
  },
  pi: {
    command: 'pi',
    // `--print` IS the non-interactive mode: process the prompt and exit.
    buildArgs: (taskPrompt) => ['--print', taskPrompt],
    // pi takes a pattern that accepts `provider/id`, so a routed id passes through whole.
    modelArgs: (model) => ['--model', model],
    reasoning: {
      levels: PI_REASONING_LEVELS,
      args: (level) => ['--thinking', level],
    },
    // `--approve` trusts project-local files for this run, which is what an unattended
    // run in a throwaway worktree needs. It grants no OS-level escape: unlike a full
    // sandbox bypass, the blast radius stays the working directory.
    permissionBypassArgs: () => ['--approve'],
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
    const model = harnessProfileModel(harness, profile)
    if (!model) {
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

  const model = harnessProfileModel(harness, profile)
  if (model) {
    args.push(...invocation.modelArgs(model))
  }

  const reasoningEffort = profile.model?.reasoningEffort
  if (reasoningEffort !== undefined) {
    args.push(...harnessReasoningArgs(harness, reasoningEffort))
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
  const nativeProvider = harness === 'codex' ? 'openai' : 'anthropic'
  if (provider !== nativeProvider) {
    throw new Error(
      `harnessInvocation: ${harness} cannot materialize model provider ${JSON.stringify(provider)}; expected ${nativeProvider}`,
    )
  }
  return model
}
