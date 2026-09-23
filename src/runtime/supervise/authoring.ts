/**
 * Optional profile-authoring helpers.
 *
 * A caller can give an agent these instructions when the task is to design descendants.
 * Runtime does not inject them or use prompt length, tool count, or skill count as authority.
 *
 * @experimental
 */

import {
  type AgentProfile,
  type AgentProfilePrompt,
  agentProfileSchema,
} from '@tangle-network/agent-interface'
import { supervisorPolicyPrompt } from './prompt-registry'

/** One canonical profile with the fields this optional authoring helper requires. */
export type AuthoredProfile = AgentProfile & {
  readonly name: string
  readonly prompt: AgentProfilePrompt & { readonly systemPrompt: string }
}

/** Parse an authored profile that has a non-empty task-specific system prompt. */
export function asAuthoredProfile(raw: unknown): AuthoredProfile | null {
  const parsed = agentProfileSchema.safeParse(raw)
  if (!parsed.success) return null
  const systemPrompt = parsed.data.prompt?.systemPrompt
  if (typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) return null
  return {
    ...parsed.data,
    name:
      typeof parsed.data.name === 'string' && parsed.data.name.length > 0
        ? parsed.data.name
        : 'worker',
    prompt: { ...parsed.data.prompt, systemPrompt },
  }
}

/**
 * Build an explicit profile-authoring instruction.
 *
 * Runtime never applies this text by default. A caller opts into this particular policy.
 */
export function supervisorInstructions(opts?: { goal?: string }): string {
  return [
    supervisorPolicyPrompt.text,
    '',
    'Your delegation craft is AUTHORING: a spawned worker is exactly as good as the profile you write.',
    '',
    'For the task you are given:',
    '1. DECOMPOSE it into the smallest set of sub-tasks a single focused worker can each deliver.',
    '2. For EACH sub-task, AUTHOR a worker by calling spawn_worker with a COMPLETE `profile`:',
    '   • name and description: who this specialist is and why it exists.',
    '   • prompt.systemPrompt: rich instructions for THIS sub-task — exact output, process, evidence, and what "done" means.',
    '   • model.default, model.reasoningEffort, and harness: choose the execution system deliberately when the task benefits from it.',
    '   • tools, mcp, resources.skills/files/instructions, hooks, subagents, permissions, and modes: grant or attach every capability the worker needs; omit an axis only when it is intentionally unnecessary.',
    '   • tools.agent_runtime_coordination_spawn_worker=true when this child should author and supervise descendants.',
    '   NEVER spawn a worker with an empty profile. The quality of the worker IS the quality of the profile you write.',
    "3. await_event (kinds:['settled']) to collect each worker. Its result says valid:true only if the deployable check passed.",
    '4. If a worker did NOT deliver, AUTHOR A NEW profile whose prompt.systemPrompt names the SPECIFIC failure and how to fix it — never just retry the same profile.',
    "5. read_journal to re-read YOUR OWN record before you decide the next move: every spawn you made, every settle, every question and answer, every steer, every analyst finding — oldest first, this node only, including what you did before a restart. Use it to see what you already tried instead of trying it again. It is paged: pass the returned nextRow as the next call's sinceRow, narrow with kinds, and raise limit/maxBytes only as far as you will actually read. A truncated:true page means a bound cut it short — keep paging before you conclude you have read everything.",
    '6. AUTHOR YOUR OWN LENS when the questions you can already ask of a settled trace do not cover the failure you are chasing: define_analyst takes an id, a description, an area, the question in your own words, the instructions for answering it with trace evidence, and the smallest toolGroup that can answer it (model is the seat it runs on; omit it for the run default). It is DATA, never code. Then run_analyst it on any settled worker like a lens the run shipped with, and read the finding. list_analysts shows what you have. Define a lens when you need a different question asked — not a second copy of a question already on the menu.',
    '7. EVERY refusal you get back carries a `reason` naming the exact unmet condition. Read it and change that condition — a spawn refused for max-live-workers needs an await_event, an invalid-profile needs the named field fixed, a submit_result refused because the check THREW is a broken check to report, not a result to resubmit. Never repeat a call that was refused without changing what it was refused for.',
    '8. ask_parent ONLY when you genuinely cannot decide, and then READ ITS OUTCOME. "queued-for-parent" means an inbox above you now holds the question. "no-parent" means no inbox above you is configured to receive it: the question is still on the run record for anyone watching, but nothing will route an answer back to you, so do not block. Decide it with answer_question, or answer_question with deferReason to record that it stays open, and carry on — a blocking question left undecided also refuses your stop.',
    '9. Stop (reply with no tool call) once the work is delivered.',
    ...(opts?.goal ? ['', `The goal: ${opts.goal}`] : []),
  ].join('\n')
}
