/**
 *
 * The supervisor's intelligence is AUTHORING the agents it spawns — not pressing buttons.
 *
 * Every agent here is three things: instructions (system prompt), tools, and a model — its
 * `AgentProfile`. The supervisor's job is to WRITE those profiles: read the task, decompose it,
 * and for each sub-task author a tailored worker recipe. `supervisorInstructions` is the how-to the
 * supervisor reads (its system prompt); `authoredWorker` builds a worker AGENT from a profile the
 * supervisor authored — the authored systemPrompt + model shape the worker's call.
 *
 * The skill is the single OPTIMIZABLE surface: edit it → the supervisor designs better agents.
 * That is the self-improvement lever (the prompt/skill lever), not the execution plumbing.
 *
 * @experimental
 */

import { type AnalystFinding, computeFindingId, makeFinding } from '@tangle-network/agent-eval'
import {
  type AgentProfile,
  type AgentProfilePrompt,
  agentProfileSchema,
} from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/spawn-journal'
import { type RouterConfig, routerChatWithUsage } from '../router-client'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import { attestRuntimeOwnedExecutor, newExecutionAttemptId } from './materialization'
import type { Agent, AgentSpec, Executor, ExecutorResult } from './types'

/** What the supervisor AUTHORS per sub-task: one complete canonical profile whose name and
 *  task-specific system prompt are present. Every other `AgentProfile` axis is preserved exactly. */
export type AuthoredProfile = AgentProfile & {
  readonly name: string
  readonly prompt: AgentProfilePrompt & { readonly systemPrompt: string }
}

/** Narrow an untyped `spawn_agent` profile argument to an `AuthoredProfile`, or null if the
 *  supervisor failed to author one (empty/placeholder profile — a skill violation worth catching). */
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

/** The supervisor SKILL — the how-to the supervisor reads (its system prompt). THE optimizable
 *  surface: editing this changes how the supervisor designs every agent it spawns. */
export function supervisorInstructions(opts?: { goal?: string }): string {
  return [
    'You are a SUPERVISOR. You do NOT do the work yourself — your job is to DESIGN and DRIVE specialist worker agents.',
    '',
    'For the task you are given:',
    '1. DECOMPOSE it into the smallest set of sub-tasks a single focused worker can each deliver.',
    '2. For EACH sub-task, AUTHOR a worker by calling spawn_agent with a COMPLETE `profile`:',
    '   • name and description: who this specialist is and why it exists.',
    '   • prompt.systemPrompt: rich instructions for THIS sub-task — exact output, process, evidence, and what "done" means.',
    '   • model.default, model.reasoningEffort, and harness: choose the execution system deliberately when the task benefits from it.',
    '   • tools, mcp, resources.skills/files/instructions, hooks, subagents, permissions, and modes: grant or attach every capability the worker needs; omit an axis only when it is intentionally unnecessary.',
    '   • metadata.role="driver" when this child should be a sub-supervisor that may author and drive its own children.',
    '   NEVER spawn a worker with an empty profile. The quality of the worker IS the quality of the profile you write.',
    "3. await_event (kinds:['settled']) to collect each worker. Its result says valid:true only if the deployable check passed.",
    '4. If a worker did NOT deliver, AUTHOR A NEW profile whose prompt.systemPrompt names the SPECIFIC failure and how to fix it — never just retry the same profile.',
    '5. Stop (reply with no tool call) once the work is delivered. You cannot declare done yourself — only a delivered (valid:true) worker counts.',
    ...(opts?.goal ? ['', `The goal: ${opts.goal}`] : []),
  ].join('\n')
}

/** Build a router-only worker from an authored profile. This helper executes the prompt/model axes;
 *  use `workerFromBackend` for full materialization of tools, MCP, resources, hooks, and subagents. */
export function authoredWorker(
  profile: AuthoredProfile,
  opts: {
    cfg: RouterConfig
    taskPrompt: string
    deliverable: DeliverableSpec
    temperature?: number
  },
): Agent<unknown, unknown> {
  const model = profile.model?.default ?? opts.cfg.model
  const executorFactory: NonNullable<AgentSpec['executorFactory']> = (spec, ctx) => {
    let artifact: ExecutorResult<unknown> | undefined
    const executionId = ctx.node?.nodeId ?? `authored-router-${profile.name}`
    const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)
    const inner: Executor<unknown> = attestRuntimeOwnedExecutor(
      {
        runtime: 'router',
        async execute(_t, signal) {
          const res = await routerChatWithUsage(
            { ...opts.cfg, model },
            [
              { role: 'system', content: profile.prompt.systemPrompt },
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
      },
      {
        effectiveProfile: spec.profile,
        backend: 'router',
        model: { status: 'known', id: model },
        execution: { kind: 'request', id: executionId },
        materializer: 'authored-router-prompt',
        plan: {
          kind: 'authored-router-completion',
          model,
          temperature: opts.temperature ?? 0.4,
          taskPrompt: opts.taskPrompt,
        },
      },
      {
        attemptId,
        binding: { endpoint: opts.cfg.routerBaseUrl, executionId, model },
        descriptor: { kind: 'router-request', transport: 'http', backend: 'router' },
      },
    )
    return gateOnDeliverable(inner, opts.deliverable)
  }
  const spec: AgentSpec = {
    profile,
    harness: null,
    executorFactory,
  }
  return { name: profile.name, act: async () => '', executorSpec: spec } as Agent<
    unknown,
    unknown
  > & {
    executorSpec: AgentSpec
  }
}

// ── Profile-richness gate ────────────────────────────────────────────────────
//
// The supervisor's product is the worker PROFILE it authors. The failure mode the existing
// gates miss: `asAuthoredProfile` / `local-harness` only reject a FULLY EMPTY system prompt —
// a two-sentence stub passes. `assessAuthoredProfile` OBSERVES the authored artifact (it reads
// no judge verdict, so it steers cleanly past `assertTraceDerivedFindings`) and flags THIN:
// a short/few-line system prompt, OR no tools, OR no skills, OR no MCP when the task needs one.
// It emits a real `AnalystFinding` so it rides the SAME coordination bus the driver pulls via
// `await_event({kinds:['finding']})` — the supervisor can self-correct and re-author richer.

/** Thresholds below which a system prompt is treated as a thin stub. Tunable per call. */
export interface ProfileRichnessThresholds {
  /** A prompt shorter than this many characters is thin (default 600). */
  readonly minSystemPromptChars: number
  /** A prompt with fewer than this many non-blank lines is thin (default 6). */
  readonly minSystemPromptLines: number
}

/** Default thresholds for `ProfileRichnessThresholds` — 600 chars / 6 lines minimum system prompt. */
export const defaultProfileRichnessThresholds: ProfileRichnessThresholds = {
  minSystemPromptChars: 600,
  minSystemPromptLines: 6,
}

/** Per-field verdict on one authored profile — the raw material the bench renders + scores. */
export interface ProfileRichness {
  readonly name: string
  /** The resolved system prompt (canonical `prompt.systemPrompt`, the sandbox `prompt.system`
   *  convention, or a bare-string prompt — whichever the author used). */
  readonly systemPrompt: string
  readonly systemPromptChars: number
  readonly systemPromptLines: number
  readonly sentenceCount: number
  readonly hasDescription: boolean
  readonly hasTools: boolean
  readonly hasSkills: boolean
  readonly hasMcp: boolean
  readonly hasSubagents: boolean
  /** 0..1 — fraction of richness signals present (prompt-depth + the four levers). */
  readonly richness: number
  /** True when the supervisor authored a stub instead of a real profile. */
  readonly thin: boolean
  /** The specific reasons it is thin (empty when rich) — used in the finding's action. */
  readonly reasons: string[]
}

/** Read the system prompt from any authored shape: canonical `prompt.systemPrompt`, the sandbox
 *  `prompt.system` convention, or a bare-string `prompt`. */
function resolveSystemPrompt(profile: AgentProfile): string {
  const pr = (profile as { prompt?: unknown }).prompt
  if (typeof pr === 'string') return pr
  if (pr && typeof pr === 'object') {
    const o = pr as { systemPrompt?: unknown; system?: unknown }
    if (typeof o.systemPrompt === 'string') return o.systemPrompt
    if (typeof o.system === 'string') return o.system
  }
  return ''
}

/** OBSERVE one authored `AgentProfile` and score its richness (no judge verdict is read). The task
 *  context (`needsMcp`) lets a domain say "this work needs a data/tool MCP" so a missing MCP counts. */
export function assessAuthoredProfile(
  profile: AgentProfile,
  opts?: { needsMcp?: boolean; thresholds?: Partial<ProfileRichnessThresholds> },
): ProfileRichness {
  const th = { ...defaultProfileRichnessThresholds, ...(opts?.thresholds ?? {}) }
  const systemPrompt = resolveSystemPrompt(profile)
  const trimmed = systemPrompt.trim()
  const systemPromptChars = trimmed.length
  const systemPromptLines = trimmed
    ? trimmed.split('\n').filter((l) => l.trim().length > 0).length
    : 0
  const sentenceCount = trimmed
    ? (trimmed.match(/[.!?](\s|$)/g) ?? []).length || (trimmed ? 1 : 0)
    : 0
  const hasDescription =
    typeof profile.description === 'string' && profile.description.trim().length > 0
  const tools = (profile as { tools?: Record<string, unknown> }).tools
  const hasTools = !!tools && Object.keys(tools).length > 0
  const skills = (profile.resources as { skills?: unknown[] } | undefined)?.skills
  const hasSkills = Array.isArray(skills) && skills.length > 0
  const mcp = (profile as { mcp?: Record<string, unknown> }).mcp
  const hasMcp = !!mcp && Object.keys(mcp).length > 0
  const subagents = (profile as { subagents?: Record<string, unknown> }).subagents
  const hasSubagents = !!subagents && Object.keys(subagents).length > 0

  const reasons: string[] = []
  const promptThin =
    systemPromptChars < th.minSystemPromptChars || systemPromptLines < th.minSystemPromptLines
  if (promptThin)
    reasons.push(
      `system prompt is thin (${systemPromptChars} chars, ${systemPromptLines} lines; need ≥${th.minSystemPromptChars} chars and ≥${th.minSystemPromptLines} lines)`,
    )
  if (!hasTools)
    reasons.push('no tools granted (a worker can only act through the tools you grant it)')
  if (!hasSkills) reasons.push('no skills attached (no reusable how-to notes injected)')
  if (opts?.needsMcp && !hasMcp) reasons.push('no MCP server, but the task needs data/tool access')

  // Richness = fraction of signals present. Prompt-depth is one signal; the four levers are the rest.
  const signals = [!promptThin, hasTools, hasSkills, hasDescription, opts?.needsMcp ? hasMcp : true]
  const richness = signals.filter(Boolean).length / signals.length
  // THIN ⟺ the prompt is a stub OR the worker has no levers at all (no tools AND no skills AND no mcp).
  const thin = promptThin || (!hasTools && !hasSkills && !hasMcp)

  return {
    name: profile.name ?? 'worker',
    systemPrompt,
    systemPromptChars,
    systemPromptLines,
    sentenceCount,
    hasDescription,
    hasTools,
    hasSkills,
    hasMcp,
    hasSubagents,
    richness,
    thin,
    reasons,
  }
}

/** Turn a {@link ProfileRichness} verdict into a bus-routable `AnalystFinding` (area `profile-quality`).
 *  Severity scales with thinness; the recommended action names the MISSING lever so the supervisor can
 *  re-author. `subject` = the worker name so per-worker findings diff cleanly across re-authors. */
export function profileRichnessFinding(
  richness: ProfileRichness,
  opts?: { analystId?: string; runId?: string },
): AnalystFinding {
  const analyst_id = opts?.analystId ?? 'profile-richness'
  const subject = richness.name
  const claim = richness.thin
    ? `Worker "${richness.name}" was authored as a THIN profile: ${richness.reasons.join('; ')}.`
    : `Worker "${richness.name}" was authored as a rich profile (richness ${(richness.richness * 100).toFixed(0)}%).`
  const severity: AnalystFinding['severity'] = richness.thin
    ? richness.richness < 0.25
      ? 'high'
      : 'medium'
    : 'info'
  return makeFinding({
    analyst_id,
    severity,
    area: 'profile-quality',
    claim,
    subject,
    confidence: 0.9,
    evidence_refs: [
      {
        kind: 'metric',
        uri: `profile:${subject}`,
        excerpt: `chars=${richness.systemPromptChars} lines=${richness.systemPromptLines} tools=${richness.hasTools} skills=${richness.hasSkills} mcp=${richness.hasMcp} richness=${richness.richness.toFixed(2)}`,
      },
    ],
    ...(richness.thin
      ? { recommended_action: `Re-author "${richness.name}" with: ${richness.reasons.join('; ')}.` }
      : {}),
    id_basis: computeFindingId({
      analyst_id,
      area: 'profile-quality',
      subject,
      claim: `richness:${richness.thin ? 'thin' : 'rich'}`,
    }),
  })
}
