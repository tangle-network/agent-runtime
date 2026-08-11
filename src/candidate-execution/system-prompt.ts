import { posix } from 'node:path'

import type {
  AgentCandidateConfigValue,
  AgentCandidateLaunch,
} from '@tangle-network/agent-interface'
import type {
  AgentCandidateWorkspacePlan,
  HarnessId,
} from '@tangle-network/agent-profile-materialize'

const SYSTEM_PROMPT_FILE = '.tangle/system-prompt.md'
const APPEND_SYSTEM_PROMPT_FILE = '.tangle/append-system-prompt.md'

/**
 * One row describes the native process control for each prompt intent this adapter owns.
 * A row with no executor projection means the shared materializer already lowered the intent into
 * the signed workspace plan; this adapter still proves that the launch reaches the native binary.
 */
interface HarnessSystemPrompt {
  /** The native binary the launch must run for this projection to be provable. */
  readonly executable: string
  /** Apply a replacement prompt to the harness's own control. */
  readonly project: (
    plan: AgentCandidateWorkspacePlan,
    systemPrompt: string,
    systemPromptFilePath: string,
  ) => AgentCandidateWorkspacePlan
  /** Apply an addition without replacing the harness's own prompt. */
  readonly projectAppend?: (
    plan: AgentCandidateWorkspacePlan,
    appendSystemPrompt: string,
    appendSystemPromptFilePath: string,
  ) => AgentCandidateWorkspacePlan
  /** The materializer already projected replacement text into native plan files and flags. */
  readonly retainsProjectedSystemPrompt?: boolean
  /** Does caller argv already set a replacement control this projection would shadow? */
  readonly conflictsWithArgs: (values: readonly string[]) => boolean
  /** Does caller argv already set an additive control this projection would shadow? */
  readonly conflictsWithAppendArgs: (values: readonly string[]) => boolean
}

const SYSTEM_PROMPT_FLAGS = ['--system-prompt', '--system-prompt-file'] as const
const APPEND_SYSTEM_PROMPT_FLAGS = [
  '--append-system-prompt',
  '--append-system-prompt-file',
] as const

function argsSetSystemPromptFlag(values: readonly string[]): boolean {
  return values.some((value) =>
    SYSTEM_PROMPT_FLAGS.some((flag) => value === flag || value.startsWith(`${flag}=`)),
  )
}

function argsSetAppendSystemPromptFlag(values: readonly string[]): boolean {
  return values.some((value) =>
    APPEND_SYSTEM_PROMPT_FLAGS.some((flag) => value === flag || value.startsWith(`${flag}=`)),
  )
}

/** Codex keys that can replace or contaminate the materializer's sealed instructions file. */
const CODEX_INSTRUCTION_KEYS = ['model_instructions_file', 'developer_instructions'] as const

function argsSetCodexInstructionOverride(values: readonly string[]): boolean {
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!
    const config =
      value === '-c' || value === '--config'
        ? values[index + 1]
        : value.startsWith('--config=')
          ? value.slice('--config='.length)
          : undefined
    if (
      config !== undefined &&
      CODEX_INSTRUCTION_KEYS.some((key) => config.trimStart().startsWith(`${key}=`))
    ) {
      return true
    }
  }
  return false
}

const HARNESS_SYSTEM_PROMPTS = {
  'claude-code': {
    executable: 'claude',
    project: (plan, systemPrompt, path) =>
      appendFlags(
        addPromptFile(plan, SYSTEM_PROMPT_FILE, systemPrompt),
        '--system-prompt-file',
        path,
      ),
    projectAppend: (plan, appendSystemPrompt, path) =>
      appendFlags(
        addPromptFile(plan, APPEND_SYSTEM_PROMPT_FILE, appendSystemPrompt),
        '--append-system-prompt-file',
        path,
      ),
    conflictsWithArgs: argsSetSystemPromptFlag,
    conflictsWithAppendArgs: argsSetAppendSystemPromptFlag,
  },
  /** OpenCode's bound primary agent is already selected by the materializer's --agent flag. */
  opencode: {
    executable: 'opencode',
    project: (plan) => plan,
    retainsProjectedSystemPrompt: true,
    conflictsWithArgs: (values) =>
      values.some((value) => value === '--agent' || value.startsWith('--agent=')),
    conflictsWithAppendArgs: argsSetAppendSystemPromptFlag,
  },
  pi: {
    executable: 'pi',
    project: (plan, systemPrompt, path) =>
      appendFlags(addPromptFile(plan, SYSTEM_PROMPT_FILE, systemPrompt), '--system-prompt', path),
    projectAppend: (plan, appendSystemPrompt, path) =>
      appendFlags(
        addPromptFile(plan, APPEND_SYSTEM_PROMPT_FILE, appendSystemPrompt),
        '--append-system-prompt',
        path,
      ),
    conflictsWithArgs: argsSetSystemPromptFlag,
    conflictsWithAppendArgs: argsSetAppendSystemPromptFlag,
  },
  prime: {
    executable: 'prime-agent',
    project: (plan, systemPrompt, path) =>
      appendFlags(addPromptFile(plan, SYSTEM_PROMPT_FILE, systemPrompt), '--system-prompt', path),
    projectAppend: (plan, appendSystemPrompt, path) =>
      appendFlags(
        addPromptFile(plan, APPEND_SYSTEM_PROMPT_FILE, appendSystemPrompt),
        '--append-system-prompt',
        path,
      ),
    conflictsWithArgs: argsSetSystemPromptFlag,
    conflictsWithAppendArgs: argsSetAppendSystemPromptFlag,
  },
  /** Gemini's file and env lowering is materializer-owned; this row supplies the launch proof. */
  gemini: {
    executable: 'gemini',
    project: (plan) => plan,
    conflictsWithArgs: argsSetSystemPromptFlag,
    conflictsWithAppendArgs: argsSetAppendSystemPromptFlag,
  },
} as const satisfies Partial<Record<HarnessId, HarnessSystemPrompt>>

interface MaterializedPromptDelivery {
  readonly executable: string
  readonly delivered: (plan: AgentCandidateWorkspacePlan) => boolean
  readonly conflictsWithArgs: (values: readonly string[]) => boolean
}

/**
 * These controls are lowered by agent-profile-materialize into files plus launch inputs. The
 * candidate adapter does not own the spawn, so it must reject an arbitrary entrypoint even when
 * the plan has the right bytes: only the native binary can make those inputs effective.
 */
const MATERIALIZED_PROMPT_DELIVERIES = {
  codex: {
    executable: 'codex',
    delivered: (plan) =>
      plan.files.some((file) => file.relPath === '.codex/system-prompt.md') &&
      plan.flags.some((flag) => flag.value === 'model_instructions_file=.codex/system-prompt.md'),
    conflictsWithArgs: argsSetCodexInstructionOverride,
  },
  gemini: {
    executable: 'gemini',
    delivered: (plan) =>
      plan.files.some((file) => file.relPath === '.gemini/system.md') &&
      plan.env.GEMINI_SYSTEM_MD?.value === '1',
    conflictsWithArgs: argsSetSystemPromptFlag,
  },
} as const satisfies Partial<Record<HarnessId, MaterializedPromptDelivery>>

/** Project both prompt intents onto their distinct native process controls. */
export function projectCandidatePromptIntents(
  plan: AgentCandidateWorkspacePlan,
  launch: AgentCandidateLaunch,
  systemPromptFilePath: string,
  requestedSystemPrompt: string | undefined = plan.systemPrompt?.value,
  requestedAppendSystemPrompt: string | undefined = plan.appendSystemPrompt?.value,
): AgentCandidateWorkspacePlan {
  const systemPrompt = plan.systemPrompt
  const appendSystemPrompt = plan.appendSystemPrompt
  const delivery = MATERIALIZED_PROMPT_DELIVERIES[
    plan.harness as keyof typeof MATERIALIZED_PROMPT_DELIVERIES
  ] as MaterializedPromptDelivery | undefined

  if (systemPrompt === undefined && delivery?.delivered(plan)) {
    assertProvableNativeLaunch(plan.harness, delivery.executable, launch, 'replacement')
    assertNoShadowingArgs(plan.harness, delivery.conflictsWithArgs, launch, 'replacement')
    if (requestedSystemPrompt === undefined) return plan
    return plan
  }

  if (requestedSystemPrompt === undefined && requestedAppendSystemPrompt === undefined) {
    return plan
  }

  const projection = HARNESS_SYSTEM_PROMPTS[plan.harness as keyof typeof HARNESS_SYSTEM_PROMPTS] as
    | HarnessSystemPrompt
    | undefined
  if (!projection) {
    throw new Error(`candidate system prompt has no native launch projection for ${plan.harness}`)
  }

  const requestedReplacement = requestedSystemPrompt !== undefined
  if (requestedReplacement && systemPrompt === undefined) {
    throw new Error(
      `profile materializer did not deliver the candidate system prompt for ${plan.harness}`,
    )
  }
  if (systemPrompt !== undefined && requestedSystemPrompt === undefined) {
    throw new Error(
      `profile materializer added an unexpected candidate system prompt for ${plan.harness}`,
    )
  }
  if (systemPrompt !== undefined && systemPrompt.value !== requestedSystemPrompt) {
    throw new Error('profile materializer changed the candidate system prompt')
  }
  if (
    appendSystemPrompt !== undefined &&
    appendSystemPrompt.value !== requestedAppendSystemPrompt
  ) {
    throw new Error('profile materializer changed the candidate append system prompt')
  }

  const intent = requestedReplacement ? 'replacement' : 'addition'
  assertProvableNativeLaunch(plan.harness, projection.executable, launch, intent)
  const launchArgs = (launch.args ?? []).map((value) => value.value)
  if (requestedReplacement && projection.conflictsWithArgs(launchArgs)) {
    throw new Error(
      `${plan.harness} launch arguments conflict with the candidate profile system prompt`,
    )
  }
  if (requestedAppendSystemPrompt !== undefined && projection.conflictsWithAppendArgs(launchArgs)) {
    throw new Error(
      `${plan.harness} launch arguments conflict with the candidate profile append system prompt`,
    )
  }

  let projected = plan
  if (systemPrompt !== undefined) {
    projected = projection.project(
      projection.retainsProjectedSystemPrompt
        ? projected
        : omitPromptIntent(projected, 'systemPrompt'),
      systemPrompt.value,
      systemPromptFilePath,
    )
  }
  if (appendSystemPrompt !== undefined) {
    if (!projection.projectAppend) {
      throw new Error(
        `candidate append system prompt has no native launch projection for ${plan.harness}`,
      )
    }
    projected = projection.projectAppend(
      omitPromptIntent(projected, 'appendSystemPrompt'),
      appendSystemPrompt.value,
      posix.join(posix.dirname(systemPromptFilePath), 'append-system-prompt.md'),
    )
  }
  // The source-profile digest binds authored values. Remove executor handoff fields only after
  // converting them into native controls; materializer-owned controls remain visible in the plan.
  return projected
}

function assertProvableNativeLaunch(
  harness: string,
  expectedExecutable: string,
  launch: AgentCandidateLaunch,
  intent: 'replacement' | 'addition',
): asserts launch is AgentCandidateLaunch & { kind: 'container-command' } {
  if (launch.kind !== 'container-command') {
    throw new Error(`candidate-entrypoint launch cannot prove ${harness} system-prompt ${intent}`)
  }
  if (
    launch.executable !== expectedExecutable &&
    !(
      posix.isAbsolute(launch.executable) &&
      posix.basename(launch.executable) === expectedExecutable
    )
  ) {
    throw new Error(
      `${harness} system-prompt ${intent} requires the native ${expectedExecutable} executable`,
    )
  }
}

function assertNoShadowingArgs(
  harness: string,
  conflictsWithArgs: (values: readonly string[]) => boolean,
  launch: Extract<AgentCandidateLaunch, { kind: 'container-command' }>,
  intent: 'replacement' | 'addition',
): void {
  if (conflictsWithArgs((launch.args ?? []).map((value) => value.value))) {
    throw new Error(
      `${harness} launch arguments conflict with the candidate profile ${intent === 'replacement' ? 'system' : 'append system'} prompt`,
    )
  }
}

function omitPromptIntent(
  plan: AgentCandidateWorkspacePlan,
  intent: 'systemPrompt' | 'appendSystemPrompt',
): AgentCandidateWorkspacePlan {
  const projected = { ...plan }
  delete projected[intent]
  return projected
}

function appendFlags(
  plan: AgentCandidateWorkspacePlan,
  ...values: string[]
): AgentCandidateWorkspacePlan {
  return {
    ...plan,
    flags: [...plan.flags, ...values.map(publicValue)],
  }
}

function publicValue(value: string): AgentCandidateConfigValue {
  return { kind: 'public', value }
}

function addPromptFile(
  plan: AgentCandidateWorkspacePlan,
  relPath: string,
  prompt: string,
): AgentCandidateWorkspacePlan {
  // Candidate argv rejects control characters. Native prompt-file loading preserves multiline
  // bytes without weakening the shared process schema.
  if (plan.files.some((file) => file.relPath === relPath)) {
    throw new Error(`candidate profile conflicts with reserved ${relPath}`)
  }
  return {
    ...plan,
    files: [
      ...plan.files,
      {
        relPath,
        content: prompt,
        source: 'generated',
      },
    ],
  }
}
