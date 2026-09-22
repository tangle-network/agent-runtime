/**
 *
 * `uiAuditorProfile` — preset for vision-driven UI audit iterations.
 *
 * A `runAgentRounds` bundle with the profile, prompt formatter, output parser,
 * and validator needed for vision-driven browser review. Use it with
 * `createInProcessUiAuditEnvironmentProvider` or another
 * `AgentEnvironmentProvider`.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { AgentRunSpec, OutputAdapter, Validator } from '../../runtime/types'
import { buildAuditorSystemPrompt } from './lens-prompts'
import { parseAuditorEvents } from './output-adapter'
import { encodeAuditTaskEnvelope, formatAuditorPrompt } from './prompt'
import type { UiAuditOutput, UiAuditTask } from './task'
import { createUiAuditorValidator } from './validator'

/** @experimental */
export interface UiAuditorProfileOptions {
  /**
   * Stable name surfaced in trace events. Defaults to `ui-auditor`.
   */
  name?: string
  /**
   * Optional model identifier passed in `AgentProfile.model.default`.
   * The environment provider chooses how to interpret it.
   */
  model?: string
  /**
   * Task bound to the validator. Without it the validator uses the lens
   * embedded in the iteration output as its expectation — fine for one-off
   * use; less strict than passing the task explicitly.
   */
  task?: UiAuditTask
}

/**
 * Preset `runAgentRounds` bundle for vision-driven UI audits: returns the `AgentRunSpec`, output adapter, validator, and prompt formatter the loop kernel needs.
 *
 * @experimental
 */
export function uiAuditorProfile(options: UiAuditorProfileOptions = {}): {
  profile: AgentProfile
  taskToPrompt: (task: UiAuditTask) => string
  output: OutputAdapter<UiAuditOutput>
  validator: Validator<UiAuditOutput>
  agentRunSpec: AgentRunSpec<UiAuditTask>
} {
  const name = options.name ?? 'ui-auditor'

  // Lens is per-task; the profile's system prompt is filled in by the
  // taskToPrompt formatter at iteration time (prefixed to the user
  // message). Keeping the profile lens-agnostic lets one AgentRunSpec
  // serve every lens-iteration of the loop.
  const profile: AgentProfile = {
    name,
    description: 'Vision-driven UI auditor. One lens per iteration.',
    prompt: { systemPrompt: '' },
    model: options.model ? { default: options.model } : undefined,
    tools: { browser: true, vision: true },
    metadata: { role: 'ui-auditor' },
  }

  const output: OutputAdapter<UiAuditOutput> = { parse: parseAuditorEvents }
  const validator: Validator<UiAuditOutput> = options.task
    ? createUiAuditorValidator(options.task)
    : createUiAuditorValidator({ lens: 'other', captures: [] })

  // Prompt shape consumed by environment providers:
  //   <<UI_AUDIT_TASK>>{json}<<UI_AUDIT_TASK_END>>
  //   <system-prompt for the lens>
  //   <human-readable iteration brief>
  // The envelope makes the iteration self-describing so concurrent fanout
  // does not race over provider state. The in-process provider decodes it
  // into a typed UiAuditTask.
  const taskToPrompt = (task: UiAuditTask): string =>
    `${encodeAuditTaskEnvelope(task)}\n${buildAuditorSystemPrompt(task.lens)}\n\n${formatAuditorPrompt(task)}`

  const agentRunSpec: AgentRunSpec<UiAuditTask> = {
    name,
    profile,
    taskToPrompt,
  }

  return { profile, taskToPrompt, output, validator, agentRunSpec }
}
