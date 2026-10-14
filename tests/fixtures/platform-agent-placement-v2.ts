/**
 * ORACLE — Platform's agent-placement/2, copied verbatim from agent-container
 * origin/develop d60344a49e (last change df10dcdb06):
 *   products/platform/api/src/lib/workflow-agent-placement.ts (selectAgentPlacement)
 *   products/platform/api/src/lib/workflow-actions.ts (workerProfileRefusal)
 * Only the imports and formatting differ. The parity test runs `placeExecution` against this copy, so
 * do not edit it to match: a difference here is a disagreement to explain.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'

/** Profile fields worker placement honours. */
const WORKER_PROFILE_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'version',
  'tags',
  'metadata',
  'prompt',
  'model',
  'tools',
])
const WORKER_PROMPT_FIELDS: ReadonlySet<string> = new Set([
  'systemPrompt',
  'appendSystemPrompt',
  'instructions',
])
/** `small`, `provider` and `metadata` are hints with nothing to honour. */
const WORKER_MODEL_FIELDS: ReadonlySet<string> = new Set([
  'default',
  'small',
  'provider',
  'metadata',
  'reasoningEffort',
  'maxVisibleOutputTokens',
  'maxTotalOutputTokens',
])

/**
 * Why worker placement cannot run this profile, or undefined when it can. A
 * profile that needs a harness, files, harness built-in tools, MCP servers,
 * subagents, hooks or modes needs a sandbox; the worker never drops one of
 * those silently. Applies to an inline profile at both schema stages and to a
 * named profile once it resolves.
 */
// oxlint-disable-next-line anti-slop/no-object-parameters
export function workerProfileRefusal(profile: object): string | undefined {
  const reasons: string[] = []
  const fields = profile as Record<string, unknown>
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined && !WORKER_PROFILE_FIELDS.has(field)) {
      reasons.push(`profile ${field} needs a sandbox`)
    }
  }
  const nested = (name: string, allowed: ReadonlySet<string>, label: string) => {
    const value = fields[name]
    if (typeof value !== 'object' || value === null) return
    for (const [field, inner] of Object.entries(value)) {
      if (inner !== undefined && !allowed.has(field)) {
        reasons.push(`profile ${label}.${field} is not supported by the worker`)
      }
    }
  }
  nested('prompt', WORKER_PROMPT_FIELDS, 'prompt')
  nested('model', WORKER_MODEL_FIELDS, 'model')
  // Harness built-in tools (shell, edit, browser) exist only in a sandbox. A
  // profile may still switch them off.
  const tools = fields.tools
  if (typeof tools === 'object' && tools !== null) {
    const enabled = Object.entries(tools)
      .filter(([, on]) => on === true)
      .map(([name]) => name)
    if (enabled.length > 0) {
      reasons.push(`profile tools ${enabled.join(', ')} need a sandbox`)
    }
  }
  return reasons.length > 0 ? reasons.join('; ') : undefined
}

/** The declared `agent.run` fields placement reads. */
export interface AgentPlacementInput {
  harness?: string
  model?: string
  source?: unknown
  skills?: unknown
  env?: unknown
  connections?: readonly string[]
  objects?: unknown
  http?: unknown
  image?: unknown
  size?: unknown
  resources?: unknown
  fromSnapshot?: unknown
  fromSandboxId?: unknown
  resume?: unknown
  maxRounds?: number
  ask?: boolean
}

export const AGENT_PLACEMENT_POLICY = 'agent-placement/2'

export type AgentPlacement = 'inference' | 'worker' | 'sandbox'

export interface AgentPlacementRecord {
  chosen: AgentPlacement
  policy: typeof AGENT_PLACEMENT_POLICY
  reason: string
  rejected: Array<{ placement: AgentPlacement; reason: string }>
}

export interface AgentPlacementContext {
  interactive: boolean
  inferenceAvailable: boolean
  workerAvailable: boolean
  /** Why the worker cannot take this action, when it cannot. */
  workerUnavailableReason?: string
}

/** No placement can meet every declared requirement. Raised before spend. */
export class AgentPlacementRefusedError extends Error {
  constructor(readonly reason: string) {
    super(`agent.run: placement: auto cannot run this action — ${reason}`)
    this.name = 'AgentPlacementRefusedError'
  }
}

/** Fields that only mean something inside a provisioned box. */
const SANDBOX_FIELDS = [
  'source',
  'skills',
  'env',
  'image',
  'size',
  'resources',
  'fromSnapshot',
  'fromSandboxId',
  'resume',
] as const satisfies ReadonlyArray<keyof AgentPlacementInput>

/** Every declared requirement only a sandbox can meet, in field order. */
function sandboxRequirements(
  cfg: AgentPlacementInput,
  profile: AgentProfile | undefined,
  context: AgentPlacementContext,
): string[] {
  const needs: string[] = []
  if (context.interactive) needs.push('interactive run needs a session')
  if (cfg.harness !== undefined) needs.push(`harness ${cfg.harness} is pinned`)
  for (const field of SANDBOX_FIELDS) {
    if (cfg[field] !== undefined) needs.push(`${field} needs a sandbox`)
  }
  if (cfg.maxRounds !== undefined && cfg.maxRounds > 1)
    needs.push('maxRounds > 1 needs a multi-round session')
  if (cfg.ask === true) needs.push('ask needs a session to answer into')
  const refusal = profile ? workerProfileRefusal(profile) : undefined
  if (refusal) needs.push(refusal)
  // Inference and the worker run the profile's own model and refuse another;
  // only the sandbox decides between an action model and the profile's.
  const profileModel = profile?.model?.default
  if (cfg.model !== undefined && profileModel !== undefined && cfg.model !== profileModel) {
    needs.push(`the action model ${cfg.model} differs from the profile model ${profileModel}`)
  }
  return needs
}

/** Every declared requirement only a sandbox can meet, for an action that
 *  is about to resume in the worker it began in. */
export function sandboxOnlyRequirements(
  cfg: AgentPlacementInput,
  profile: AgentProfile | undefined,
  interactive: boolean,
): string[] {
  return sandboxRequirements(cfg, profile, {
    interactive,
    inferenceAvailable: true,
    workerAvailable: true,
  })
}

/** Tools the action grants, each of which the worker loop can hold. */
function toolRequirements(cfg: AgentPlacementInput): string[] {
  const tools: string[] = []
  if ((cfg.connections ?? []).length > 0) tools.push('connections need Hub tools')
  if (cfg.objects !== undefined) tools.push('objects need object tools')
  if (cfg.http !== undefined) tools.push('http needs a fetch tool')
  return tools
}

/** Grants only the worker holds today: a sandbox cannot honour them. */
function workerOnlyGrants(cfg: AgentPlacementInput): string[] {
  return [
    ...(cfg.objects !== undefined ? ['objects'] : []),
    ...(cfg.http !== undefined ? ['http'] : []),
  ]
}

/**
 * Choose where an `auto` action runs. `profile` is the RESOLVED definition —
 * a named profile is read before the decision, so its tools, files and harness
 * count. Throws {@link AgentPlacementRefusedError} when no placement can meet
 * every requirement.
 */
export function selectAgentPlacement(
  cfg: AgentPlacementInput,
  profile: AgentProfile | undefined,
  context: AgentPlacementContext,
): AgentPlacementRecord {
  const sandboxNeeds = sandboxRequirements(cfg, profile, context)
  const tools = toolRequirements(cfg)
  const workerOnly = workerOnlyGrants(cfg)
  const record = (
    chosen: AgentPlacement,
    reason: string,
    rejected: AgentPlacementRecord['rejected'],
  ): AgentPlacementRecord => ({
    chosen,
    policy: AGENT_PLACEMENT_POLICY,
    reason,
    rejected,
  })

  if (sandboxNeeds.length > 0) {
    const reason = sandboxNeeds.join('; ')
    if (workerOnly.length > 0) {
      throw new AgentPlacementRefusedError(
        `${workerOnly.join(' and ')} run only in the worker, but ${reason}`,
      )
    }
    return record('sandbox', reason, [
      { placement: 'inference', reason },
      { placement: 'worker', reason },
    ])
  }

  // Past the sandbox check the profile is one the worker (and a single
  // Router call) can honour, so only granted tools separate the two.
  if (tools.length > 0) {
    const reason = `${tools.join('; ')}, which the worker holds without a sandbox`
    if (!context.workerAvailable) {
      const unavailable =
        context.workerUnavailableReason ?? 'worker placement is not wired on this deployment'
      if (workerOnly.length > 0) {
        throw new AgentPlacementRefusedError(
          `${workerOnly.join(' and ')} need the worker, but ${unavailable}`,
        )
      }
      return record('sandbox', unavailable, [
        { placement: 'inference', reason: tools.join('; ') },
        { placement: 'worker', reason: unavailable },
      ])
    }
    return record('worker', reason, [
      { placement: 'inference', reason: tools.join('; ') },
      {
        placement: 'sandbox',
        reason: 'costs more and no declared requirement needs it',
      },
    ])
  }

  if (context.inferenceAvailable) {
    return record('inference', 'no declared requirement needs tools, files or a session', [
      {
        placement: 'worker',
        reason: 'no declared tool needs a loop',
      },
      {
        placement: 'sandbox',
        reason: 'costs more and no declared requirement needs it',
      },
    ])
  }
  const unwired = 'inference is not wired on this deployment'
  if (context.workerAvailable) {
    return record('worker', `${unwired}; one tool-free worker turn`, [
      { placement: 'inference', reason: unwired },
      {
        placement: 'sandbox',
        reason: 'costs more and no declared requirement needs it',
      },
    ])
  }
  return record('sandbox', unwired, [
    { placement: 'inference', reason: unwired },
    {
      placement: 'worker',
      reason: 'worker placement is not wired on this deployment',
    },
  ])
}

/** The record for a placement the author named: nothing was chosen or refused. */
export function authoredAgentPlacement(chosen: AgentPlacement): AgentPlacementRecord {
  return {
    chosen,
    policy: AGENT_PLACEMENT_POLICY,
    reason: `authored placement: ${chosen}`,
    rejected: [],
  }
}

/** The record for an action that resumes under the placement it began with. */
export function resumedAgentPlacement(chosen: AgentPlacement): AgentPlacementRecord {
  return {
    chosen,
    policy: AGENT_PLACEMENT_POLICY,
    reason: `resumed under the placement it began with: ${chosen}`,
    rejected: [],
  }
}
