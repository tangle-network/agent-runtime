import { posix } from 'node:path'
import type {
  AgentCandidateConfigValue,
  AgentCandidateLaunch,
} from '@tangle-network/agent-interface'
import type {
  AgentCandidateWorkspacePlan,
  HarnessId,
} from '@tangle-network/agent-profile-materialize'
import { nativeSystemPrompt } from '../agent/native-system-prompt'
import { requirePublicCandidateConfigValue } from './public-config'

interface HarnessSystemPrompt {
  readonly executable: string
  readonly conflictsWithArgs: (values: readonly string[]) => boolean
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
    conflictsWithArgs: argsSetSystemPromptFlag,
    conflictsWithAppendArgs: argsSetAppendSystemPromptFlag,
  },
  codex: {
    executable: 'codex',
    conflictsWithArgs: argsSetCodexInstructionOverride,
    conflictsWithAppendArgs: argsSetCodexInstructionOverride,
  },
  opencode: {
    executable: 'opencode',
    conflictsWithArgs: (values: readonly string[]) =>
      values.some((value) => value === '--agent' || value.startsWith('--agent=')),
    conflictsWithAppendArgs: argsSetAppendSystemPromptFlag,
  },
  pi: {
    executable: 'pi',
    conflictsWithArgs: argsSetSystemPromptFlag,
    conflictsWithAppendArgs: argsSetAppendSystemPromptFlag,
  },
  prime: {
    executable: 'prime-agent',
    conflictsWithArgs: argsSetSystemPromptFlag,
    conflictsWithAppendArgs: argsSetAppendSystemPromptFlag,
  },
  gemini: {
    executable: 'gemini',
    conflictsWithArgs: argsSetSystemPromptFlag,
    conflictsWithAppendArgs: argsSetAppendSystemPromptFlag,
  },
} satisfies Partial<Record<HarnessId, HarnessSystemPrompt>>

/** Project both prompt intents onto their distinct native process controls. */
export function projectCandidatePromptIntents(
  plan: AgentCandidateWorkspacePlan,
  launch: AgentCandidateLaunch,
  systemPromptFilePath: string,
  requestedSystemPrompt: string | undefined = plan.systemPrompt === undefined
    ? undefined
    : requirePublicCandidateConfigValue(plan.systemPrompt, 'profile.systemPrompt'),
  requestedAppendSystemPrompt: string | undefined = plan.appendSystemPrompt === undefined
    ? undefined
    : requirePublicCandidateConfigValue(plan.appendSystemPrompt, 'profile.appendSystemPrompt'),
): AgentCandidateWorkspacePlan {
  const systemPrompt = plan.systemPrompt
  const appendSystemPrompt = plan.appendSystemPrompt
  const geminiSystem = plan.files.find((file) => file.relPath === '.gemini/system.md')
  const delivered =
    plan.harness === 'gemini' &&
    geminiSystem?.content === requestedSystemPrompt &&
    plan.env.GEMINI_SYSTEM_MD !== undefined &&
    requirePublicCandidateConfigValue(plan.env.GEMINI_SYSTEM_MD, 'profile.env.GEMINI_SYSTEM_MD') ===
      '1'

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
  if (requestedReplacement && systemPrompt === undefined && !delivered) {
    throw new Error(
      `profile materializer did not deliver the candidate system prompt for ${plan.harness}`,
    )
  }
  if (systemPrompt !== undefined && requestedSystemPrompt === undefined) {
    throw new Error(
      `profile materializer added an unexpected candidate system prompt for ${plan.harness}`,
    )
  }
  if (
    systemPrompt !== undefined &&
    requirePublicCandidateConfigValue(systemPrompt, 'profile.systemPrompt') !==
      requestedSystemPrompt
  ) {
    throw new Error('profile materializer changed the candidate system prompt')
  }
  if (
    appendSystemPrompt !== undefined &&
    requirePublicCandidateConfigValue(appendSystemPrompt, 'profile.appendSystemPrompt') !==
      requestedAppendSystemPrompt
  ) {
    throw new Error('profile materializer changed the candidate append system prompt')
  }

  const intent = requestedReplacement ? 'replacement' : 'addition'
  assertProvableNativeLaunch(plan.harness, projection.executable, launch, intent)
  const launchArgs = (launch.args ?? []).map((value, index) =>
    requirePublicCandidateConfigValue(value, `launch.args[${index}]`),
  )
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

  // These harnesses already have native file/config delivery owned by the materializer.
  if (plan.harness === 'opencode' || plan.harness === 'gemini') return plan
  const native = nativeSystemPrompt(
    plan.harness,
    {
      ...(systemPrompt === undefined ? {} : { systemPrompt: requestedSystemPrompt }),
      appendSystemPrompt: requestedAppendSystemPrompt,
    },
    systemPromptFilePath,
  )
  for (const file of native.files) {
    if (plan.files.some((existing) => existing.relPath === file.relPath)) {
      throw new Error(`candidate profile conflicts with reserved ${file.relPath}`)
    }
  }
  const { systemPrompt: _system, appendSystemPrompt: _append, ...projected } = plan
  return {
    ...projected,
    files: [...plan.files, ...native.files],
    flags: [
      ...plan.flags,
      ...native.flags.map((value): AgentCandidateConfigValue => ({ kind: 'public', value })),
    ],
  }
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
