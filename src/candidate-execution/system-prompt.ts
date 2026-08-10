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

/**
 * How ONE harness expresses a replacement system prompt natively, for the harnesses whose plans
 * still arrive with `plan.systemPrompt` set — the materializer delegates the lowering to the
 * launcher for these (claude-code and pi both take a prompt-file flag on their own argv).
 *
 * codex and opencode are deliberately NOT rows here anymore. agent-profile-materialize 0.12 lowers
 * codex's prompt itself — the bytes land in the plan at `.codex/system-prompt.md` and the flags
 * carry `-c model_instructions_file=…` — and refuses opencode outright (its only replacement
 * control binds to the agent selected at launch, which a workspace plan cannot guarantee). A plan
 * whose `systemPrompt` is set for a harness with no row is refused rather than launched with an
 * unprojected prompt.
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

/**
 * Codex config keys that decide the request's instructions. `model_instructions_file` replaces the
 * whole instructions field (the materializer's own delivery key); `developer_instructions` injects
 * developer-channel text beside it. A caller argv setting either would shadow or contaminate the
 * profile's sealed prompt, so both refuse.
 */
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
      appendFlags(addSystemPromptFile(plan, systemPrompt), '--system-prompt-file', path),
    conflictsWithArgs: argsSetSystemPromptFlag,
  },
  pi: {
    executable: 'pi',
    project: (plan, systemPrompt, path) =>
      appendFlags(addSystemPromptFile(plan, systemPrompt), '--system-prompt', path),
    conflictsWithArgs: argsSetSystemPromptFlag,
  },
} as const satisfies Partial<Record<HarnessId, HarnessSystemPrompt>>

/**
 * Deliveries the MATERIALIZER already lowered into the plan, whose effect still rides argv. The
 * prompt bytes are in the digested plan files, but the flag that makes the harness read them is
 * only meaningful to the native binary's own argument parser — handed to any other executable it
 * is inert argv, and the sealed candidate would claim an active prompt that never applied.
 *
 * That is the exact hazard the launch guard exists for, and it is how the guard was once silently
 * disabled: when agent-profile-materialize 0.12 moved codex from an inline flag this module
 * projected to file+flag it lowers itself, `plan.systemPrompt` stopped being set for codex, the
 * old `systemPrompt === undefined` early-return skipped every check, and two refusal tests began
 * resolving. Delivery detection therefore keys on the LOWERED FLAG, not on the field.
 */
interface MaterializedFlagDelivery {
  readonly executable: string
  readonly delivered: (plan: AgentCandidateWorkspacePlan) => boolean
  readonly conflictsWithArgs: (values: readonly string[]) => boolean
}

const MATERIALIZED_FLAG_DELIVERIES = {
  codex: {
    executable: 'codex',
    delivered: (plan) =>
      plan.flags.some((flag) => flag.value.startsWith('model_instructions_file=')),
    conflictsWithArgs: argsSetCodexInstructionOverride,
  },
} as const satisfies Partial<Record<HarnessId, MaterializedFlagDelivery>>

/** Project a replacement system prompt onto the exact native process control. */
export function projectCandidateSystemPrompt(
  plan: AgentCandidateWorkspacePlan,
  launch: AgentCandidateLaunch,
  systemPromptFilePath: string,
): AgentCandidateWorkspacePlan {
  const systemPrompt = plan.systemPrompt
  if (systemPrompt === undefined) {
    // No launcher-delegated prompt — but the materializer may have lowered one into the plan
    // whose flag only the native binary can honor. Same guards, no projection to apply.
    const delivery = MATERIALIZED_FLAG_DELIVERIES[
      plan.harness as keyof typeof MATERIALIZED_FLAG_DELIVERIES
    ] as MaterializedFlagDelivery | undefined
    if (!delivery || !delivery.delivered(plan)) return plan
    assertProvableNativeLaunch(plan.harness, delivery.executable, launch)
    assertNoShadowingArgs(plan.harness, delivery.conflictsWithArgs, launch)
    return plan
  }

  const projection = HARNESS_SYSTEM_PROMPTS[plan.harness as keyof typeof HARNESS_SYSTEM_PROMPTS] as
    | HarnessSystemPrompt
    | undefined
  if (!projection) {
    throw new Error(`candidate system prompt has no native launch projection for ${plan.harness}`)
  }
  assertProvableNativeLaunch(plan.harness, projection.executable, launch)
  assertNoShadowingArgs(plan.harness, projection.conflictsWithArgs, launch)
  // The source-profile digest already binds the authored value. Sign only the
  // native projection here so an inert systemPrompt field cannot look active.
  return projection.project(
    omitUnappliedSystemPrompt(plan),
    systemPrompt.value,
    systemPromptFilePath,
  )
}

/** A prompt whose delivery rides argv is provable only on the native binary's own command line. */
function assertProvableNativeLaunch(
  harness: string,
  expectedExecutable: string,
  launch: AgentCandidateLaunch,
): asserts launch is AgentCandidateLaunch & { kind: 'container-command' } {
  if (launch.kind !== 'container-command') {
    throw new Error(`candidate-entrypoint launch cannot prove ${harness} system-prompt replacement`)
  }
  if (
    launch.executable !== expectedExecutable &&
    !(
      posix.isAbsolute(launch.executable) &&
      posix.basename(launch.executable) === expectedExecutable
    )
  ) {
    throw new Error(
      `${harness} system-prompt replacement requires the native ${expectedExecutable} executable`,
    )
  }
}

function assertNoShadowingArgs(
  harness: string,
  conflictsWithArgs: (values: readonly string[]) => boolean,
  launch: Extract<AgentCandidateLaunch, { kind: 'container-command' }>,
): void {
  if (conflictsWithArgs((launch.args ?? []).map((value) => value.value))) {
    throw new Error(`${harness} launch arguments conflict with the candidate profile system prompt`)
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
