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

const NATIVE_EXECUTABLES = {
  'claude-code': 'claude',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi',
} as const satisfies Partial<Record<HarnessId, string>>

const SYSTEM_PROMPT_FILE = '.tangle/system-prompt.md'

/** Project a replacement system prompt onto the exact native process control. */
export function projectCandidateSystemPrompt(
  plan: AgentCandidateWorkspacePlan,
  launch: AgentCandidateLaunch,
  systemPromptFilePath: string,
): AgentCandidateWorkspacePlan {
  const systemPrompt = plan.systemPrompt
  if (systemPrompt === undefined) return plan

  const expectedExecutable = NATIVE_EXECUTABLES[plan.harness as keyof typeof NATIVE_EXECUTABLES]
  if (!expectedExecutable) {
    throw new Error(`candidate system prompt has no native launch projection for ${plan.harness}`)
  }
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

  assertNoSystemPromptOverride(plan.harness, launch.args ?? [])
  // The source-profile digest already binds the authored value. Sign only the
  // native projection here so an inert systemPrompt field cannot look active.
  const projectedPlan = omitUnappliedSystemPrompt(plan)

  switch (plan.harness) {
    case 'codex':
      return appendFlags(
        projectedPlan,
        '-c',
        `developer_instructions=${tomlString(systemPrompt.value)}`,
      )
    case 'claude-code':
      return appendFlags(
        addSystemPromptFile(projectedPlan, systemPrompt.value),
        '--system-prompt-file',
        systemPromptFilePath,
      )
    case 'opencode':
      return {
        ...projectedPlan,
        files: projectOpenCodeSystemPrompt(projectedPlan.files, systemPrompt.value),
      }
    case 'pi':
      return appendFlags(
        addSystemPromptFile(projectedPlan, systemPrompt.value),
        '--system-prompt',
        systemPromptFilePath,
      )
    default:
      throw new Error(`candidate system prompt has no native launch projection for ${plan.harness}`)
  }
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

function assertNoSystemPromptOverride(
  harness: HarnessId,
  args: readonly AgentCandidateConfigValue[],
): void {
  const values = args.map((value) => value.value)
  if (harness === 'claude-code' || harness === 'pi') {
    if (
      values.some(
        (value) =>
          value === '--system-prompt' ||
          value.startsWith('--system-prompt=') ||
          value === '--system-prompt-file' ||
          value.startsWith('--system-prompt-file='),
      )
    ) {
      throw new Error(
        `${harness} launch arguments conflict with the candidate profile system prompt`,
      )
    }
    return
  }
  if (harness !== 'codex') return

  for (let index = 0; index < values.length; index++) {
    const value = values[index]!
    const config =
      value === '-c' || value === '--config'
        ? values[index + 1]
        : value.startsWith('--config=')
          ? value.slice('--config='.length)
          : undefined
    if (config?.trimStart().startsWith('developer_instructions=')) {
      throw new Error('codex launch arguments conflict with the candidate profile system prompt')
    }
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
