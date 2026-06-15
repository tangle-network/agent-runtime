/**
 * @experimental
 *
 * The supervisor's intelligence is AUTHORING the agents it spawns — not pressing buttons.
 *
 * Every agent here is three things: instructions (system prompt), tools, and a model — its
 * `AgentProfile`. The supervisor's job is to WRITE those profiles: read the task, decompose it,
 * and for each sub-task author a tailored worker recipe. `supervisorSkill` is the how-to the
 * supervisor reads (its system prompt); `authoredWorker` builds a worker AGENT from a profile the
 * supervisor authored — the authored systemPrompt + model shape the worker's call.
 *
 * The skill is the single OPTIMIZABLE surface: edit it → the supervisor designs better agents.
 * That is the self-improvement lever (the prompt/skill lever), not the execution plumbing.
 */

import type { AgentProfile } from '@tangle-network/sandbox'
import { contentAddress } from '../../durable/spawn-journal'
import { type RouterConfig, routerChatWithUsage } from '../router-client'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import type { Agent, AgentSpec, Executor, ExecutorResult } from './types'

/** What the supervisor AUTHORS per sub-task — a worker recipe (a partial `AgentProfile`). */
export interface AuthoredProfile {
  name: string
  /** The rich, task-specific instructions the supervisor wrote for THIS worker. */
  systemPrompt: string
  /** The model the supervisor chose for this sub-task (falls back to the run default). */
  model?: string
}

/** Narrow an untyped `spawn_worker` profile argument to an `AuthoredProfile`, or null if the
 *  supervisor failed to author one (empty/placeholder profile — a skill violation worth catching). */
export function asAuthoredProfile(raw: unknown): AuthoredProfile | null {
  const p = raw as Partial<AuthoredProfile> | undefined
  if (!p || typeof p.systemPrompt !== 'string' || p.systemPrompt.trim().length === 0) return null
  return {
    name: typeof p.name === 'string' && p.name.length > 0 ? p.name : 'worker',
    systemPrompt: p.systemPrompt,
    ...(typeof p.model === 'string' ? { model: p.model } : {}),
  }
}

/** The supervisor SKILL — the how-to the supervisor reads (its system prompt). THE optimizable
 *  surface: editing this changes how the supervisor designs every agent it spawns. */
export function supervisorSkill(opts?: { goal?: string }): string {
  return [
    'You are a SUPERVISOR. You do NOT do the work yourself — your job is to DESIGN and DRIVE specialist worker agents.',
    '',
    'For the task you are given:',
    '1. DECOMPOSE it into the smallest set of sub-tasks a single focused worker can each deliver.',
    '2. For EACH sub-task, AUTHOR a worker by calling spawn_worker with a COMPLETE `profile`:',
    '   • name: a short id for the worker.',
    '   • systemPrompt: rich, specific instructions for THIS sub-task — tell the worker exactly what to produce, how to use its tools fully, and what "done" means. Never a one-liner; write the prompt a power-user would write.',
    '   • model: the model best suited to this sub-task (omit to use the default).',
    '   NEVER spawn a worker with an empty profile. The quality of the worker IS the quality of the profile you write.',
    '3. await_next to collect each worker. Its result says valid:true only if the deployable check passed.',
    '4. If a worker did NOT deliver, AUTHOR A NEW worker whose systemPrompt names the SPECIFIC failure and how to fix it — never just retry the same prompt.',
    '5. Stop (reply with no tool call) once the work is delivered. You cannot declare done yourself — only a delivered (valid:true) worker counts.',
    ...(opts?.goal ? ['', `The goal: ${opts.goal}`] : []),
  ].join('\n')
}

/** Build a worker AGENT from a profile the supervisor authored: the authored `systemPrompt` +
 *  `model` shape the worker's one model call; the deliverable gates settlement (valid ⟺ delivered). */
export function authoredWorker(
  profile: AuthoredProfile,
  opts: {
    cfg: RouterConfig
    taskPrompt: string
    deliverable: DeliverableSpec
    temperature?: number
  },
): Agent<unknown, unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  const model = profile.model ?? opts.cfg.model
  const inner: Executor<unknown> = {
    runtime: 'router',
    async execute(_t, signal) {
      const res = await routerChatWithUsage(
        { ...opts.cfg, model },
        [
          { role: 'system', content: profile.systemPrompt },
          { role: 'user', content: opts.taskPrompt },
        ],
        { temperature: opts.temperature ?? 0.4, ...(signal ? { signal } : {}) },
      )
      artifact = {
        outRef: contentAddress(res.content),
        out: res.content,
        spent: {
          iterations: 1,
          tokens: res.usage ?? { input: 0, output: 0 },
          usd: res.costUsd ?? 0,
          ms: 0,
        },
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => {
      if (!artifact) throw new Error('authoredWorker: resultArtifact read before execute')
      return artifact
    },
  }
  const gated = gateOnDeliverable(inner, opts.deliverable)
  const spec: AgentSpec = {
    profile: { name: profile.name } as AgentProfile,
    harness: null,
    executor: gated,
  }
  return { name: profile.name, act: async () => '', executorSpec: spec } as Agent<
    unknown,
    unknown
  > & {
    executorSpec: AgentSpec
  }
}
