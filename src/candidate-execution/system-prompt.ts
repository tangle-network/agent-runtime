import { posix } from 'node:path'

import type {
  AgentCandidateConfigValue,
  AgentCandidateLaunch,
} from '@tangle-network/agent-interface'
import type {
  AgentCandidateWorkspacePlan,
  HarnessId,
  PlanFile,
} from '@tangle-network/agent-profile-materialize'

const SYSTEM_PROMPT_FILE = '.tangle/system-prompt.md'

/**
 * How ONE harness expresses a replacement system prompt natively. Every difference between
 * harnesses lives in a row: the executable that must be on the command line, the projection onto
 * that harness's own control, and the launch arguments that would silently shadow the projection.
 *
 * The differences here are REAL — codex takes a TOML config override, claude-code and pi take
 * prompt-file flags with different spellings, opencode has no flag at all and needs a mutated
 * `opencode.json`. Adding harness N+1 is one entry; a harness with NO entry is refused by
 * {@link projectCandidateSystemPrompt} rather than launched with an unprojected prompt, so the
 * conflict check inherits the same fail-closed default instead of returning early.
 */
interface HarnessSystemPrompt {
  /** The native binary the launch must run for this projection to be provable. */
  readonly executable: string
  /** Apply the prompt to the harness's own control, returning the projected plan. */
  readonly project: (
    plan: AgentCandidateWorkspacePlan,
    systemPrompt: string,
    systemPromptFilePath: string,
  ) => AgentCandidateWorkspacePlan
  /** Does the caller's argv already set a system prompt this projection would silently shadow? */
  readonly conflictsWithArgs: (values: readonly string[]) => boolean
}

const SYSTEM_PROMPT_FLAGS = ['--system-prompt', '--system-prompt-file'] as const

/** Shared by the harnesses whose native control IS a `--system-prompt*` flag. */
function argsSetSystemPromptFlag(values: readonly string[]): boolean {
  return values.some((value) =>
    SYSTEM_PROMPT_FLAGS.some((flag) => value === flag || value.startsWith(`${flag}=`)),
  )
}

function argsSetCodexDeveloperInstructions(values: readonly string[]): boolean {
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!
    const config =
      value === '-c' || value === '--config'
        ? values[index + 1]
        : value.startsWith('--config=')
          ? value.slice('--config='.length)
          : undefined
    if (config?.trimStart().startsWith('developer_instructions=')) return true
  }
  return false
}

const HARNESS_SYSTEM_PROMPTS = {
  'claude-code': {
    executable: 'claude',
    project: (plan, systemPrompt, path) =>
      appendFlags(addSystemPromptFile(plan, systemPrompt), '--system-prompt-file', path),
    conflictsWithArgs: argsSetSystemPromptFlag,
  },
  codex: {
    executable: 'codex',
    project: (plan, systemPrompt) =>
      appendFlags(plan, '-c', `developer_instructions=${tomlString(systemPrompt)}`),
    conflictsWithArgs: argsSetCodexDeveloperInstructions,
  },
  opencode: {
    executable: 'opencode',
    project: (plan, systemPrompt) => ({
      ...plan,
      files: projectOpenCodeSystemPrompt(plan.files, systemPrompt),
    }),
    // `opencode run` takes no system-prompt flag; the prompt lives in `opencode.json`, whose
    // conflicts `projectOpenCodeSystemPrompt` rejects at the file level.
    conflictsWithArgs: () => false,
  },
  pi: {
    executable: 'pi',
    project: (plan, systemPrompt, path) =>
      appendFlags(addSystemPromptFile(plan, systemPrompt), '--system-prompt', path),
    conflictsWithArgs: argsSetSystemPromptFlag,
  },
} as const satisfies Partial<Record<HarnessId, HarnessSystemPrompt>>

/** Project a replacement system prompt onto the exact native process control. */
export function projectCandidateSystemPrompt(
  plan: AgentCandidateWorkspacePlan,
  launch: AgentCandidateLaunch,
  systemPromptFilePath: string,
): AgentCandidateWorkspacePlan {
  const systemPrompt = plan.systemPrompt
  if (systemPrompt === undefined) return plan

  const projection = HARNESS_SYSTEM_PROMPTS[plan.harness as keyof typeof HARNESS_SYSTEM_PROMPTS] as
    | HarnessSystemPrompt
    | undefined
  if (!projection) {
    throw new Error(`candidate system prompt has no native launch projection for ${plan.harness}`)
  }
  const expectedExecutable = projection.executable
  if (launch.kind !== 'container-command') {
    throw new Error(
      `candidate-entrypoint launch cannot prove ${plan.harness} system-prompt replacement`,
    )
  }
  if (
    launch.executable !== expectedExecutable &&
    !(
      posix.isAbsolute(launch.executable) &&
      posix.basename(launch.executable) === expectedExecutable
    )
  ) {
    throw new Error(
      `${plan.harness} system-prompt replacement requires the native ${expectedExecutable} executable`,
    )
  }

  if (projection.conflictsWithArgs((launch.args ?? []).map((value) => value.value))) {
    throw new Error(
      `${plan.harness} launch arguments conflict with the candidate profile system prompt`,
    )
  }
  // The source-profile digest already binds the authored value. Sign only the
  // native projection here so an inert systemPrompt field cannot look active.
  return projection.project(
    omitUnappliedSystemPrompt(plan),
    systemPrompt.value,
    systemPromptFilePath,
  )
}

function omitUnappliedSystemPrompt(plan: AgentCandidateWorkspacePlan): AgentCandidateWorkspacePlan {
  const { systemPrompt: _systemPrompt, ...projected } = plan
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

function addSystemPromptFile(
  plan: AgentCandidateWorkspacePlan,
  systemPrompt: string,
): AgentCandidateWorkspacePlan {
  // Candidate argv rejects control characters. Native prompt-file loading
  // preserves multiline bytes without weakening the shared process schema.
  if (plan.files.some((file) => file.relPath === SYSTEM_PROMPT_FILE)) {
    throw new Error(`candidate profile conflicts with reserved ${SYSTEM_PROMPT_FILE}`)
  }
  return {
    ...plan,
    files: [
      ...plan.files,
      {
        relPath: SYSTEM_PROMPT_FILE,
        content: systemPrompt,
        source: 'generated',
      },
    ],
  }
}

function projectOpenCodeSystemPrompt(files: readonly PlanFile[], prompt: string): PlanFile[] {
  const configIndex = files.findIndex((file) => file.relPath === 'opencode.json')
  if (configIndex === -1) {
    return [
      ...files,
      {
        relPath: 'opencode.json',
        content: openCodeConfigWithPrompt({}, prompt),
        source: 'generated',
      },
    ]
  }

  const configFile = files[configIndex]!
  if (configFile.source !== 'generated') {
    throw new Error('opencode system-prompt replacement requires generated opencode.json')
  }
  const config = parseJsonObject(configFile.content, 'generated opencode.json')
  const output = [...files]
  output[configIndex] = {
    ...configFile,
    content: openCodeConfigWithPrompt(config, prompt),
  }
  return output
}

function openCodeConfigWithPrompt(config: Record<string, unknown>, prompt: string): string {
  const agent = optionalJsonObject(config.agent, 'generated opencode.json agent')
  const build = optionalJsonObject(agent.build, 'generated opencode.json agent.build')
  const plan = optionalJsonObject(agent.plan, 'generated opencode.json agent.plan')
  assertCompatiblePrompt(build.prompt, prompt, 'build')
  assertCompatiblePrompt(plan.prompt, prompt, 'plan')
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      ...config,
      agent: {
        ...agent,
        build: { ...build, prompt },
        plan: { ...plan, prompt },
      },
    },
    null,
    2,
  )
}

function parseJsonObject(content: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (cause) {
    throw new Error(`${label} must contain valid JSON`, { cause })
  }
  return jsonObject(value, label)
}

function optionalJsonObject(value: unknown, label: string): Record<string, unknown> {
  return value === undefined ? {} : jsonObject(value, label)
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function assertCompatiblePrompt(value: unknown, prompt: string, agent: string): void {
  if (value !== undefined && value !== prompt) {
    throw new Error(`generated opencode.json agent.${agent}.prompt conflicts with the profile`)
  }
}

function tomlString(value: string): string {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')}"`
}
