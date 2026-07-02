/**
 *
 * `uiAuditorProfile` — preset for vision-driven UI audit iterations.
 *
 * A `runLoop` bundle: it returns the `AgentRunSpec`, output adapter, validator, and prompt
 * formatter the loop kernel needs. The agent's "harness" is not a sandbox-SDK code-runner — it's a
 * vision-capable judge driving a browser. The loop kernel still iterates
 * `client.create() → box.streamPrompt() → box.delete()`; the client/box pair are provided by
 * `createInProcessUiAuditClient` (in `./in-process-client.ts`) or a consumer-supplied `SandboxClient`.
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
   * The consumer's `SandboxClient` chooses how to interpret it.
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
 * Preset `runLoop` bundle for vision-driven UI audits: returns the `AgentRunSpec`, output adapter, validator, and prompt formatter the loop kernel needs.
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

  // Prompt shape (consumed both by sandbox-SDK harnesses AND by the
  // in-process auditor client):
  //   <<UI_AUDIT_TASK>>{json}<<UI_AUDIT_TASK_END>>
  //   <system-prompt for the lens>
  //   <human-readable iteration brief>
  // The envelope makes the iteration self-describing so concurrent fanout
  // does not race over per-client side state. Sandbox-SDK harnesses can
  // ignore the envelope; the in-process auditor client decodes it back
  // into a typed UiAuditTask via decodeAuditTaskEnvelope.
  const taskToPrompt = (task: UiAuditTask): string =>
    `${encodeAuditTaskEnvelope(task)}\n${buildAuditorSystemPrompt(task.lens)}\n\n${formatAuditorPrompt(task)}`

  const agentRunSpec: AgentRunSpec<UiAuditTask> = {
    name,
    profile,
    taskToPrompt,
  }

  return { profile, taskToPrompt, output, validator, agentRunSpec }
}
