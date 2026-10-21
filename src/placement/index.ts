/**
 * Execution placement: choose the cheapest executor whose declared capabilities
 * cover the work, before any key, sandbox or model call.
 *
 * A pure decision over DECLARED data — the work's requirements and its resolved
 * {@link AgentProfile}. It never reads the prompt and does no I/O, so it is safe
 * in a Worker or Durable Object and costs nothing on the path to the first word.
 * Tiers, cheapest first:
 *  - `inference`: one Router call, when nothing needs a tool, a file or a session;
 *  - `loop`: the Runtime tool loop in the caller's own process (a Worker or the
 *    Platform workflow worker), when the only tools are ones that loop holds;
 *  - `sandbox`: anything that needs a harness, a filesystem, a shell, files, MCP
 *    servers, subagents, hooks or an interactive session.
 * A requirement no tier can meet refuses the work by name
 * ({@link PlacementRefusedError}); a capability is never dropped silently, and a
 * pinned harness always runs in the sandbox.
 *
 * This is Platform's `agent-placement/2` (`selectAgentPlacement` and
 * `workerProfileRefusal`) moved here unchanged in semantics. Its reason strings
 * are kept byte-identical so a shadow comparison against Platform's copy reads
 * equal; only the tier name changes (`worker` → `loop`). `agent-placement/3`
 * adds two caller opt-ins, both off by default:
 *  - {@link PlaceExecutionInput.vacuousAxes}: a deny-only `permissions` map asks
 *    for nothing a tier lacks, so it counts as covered;
 *  - {@link PlaceExecutionInput.inlineSkills}: profile skills count as covered on
 *    `loop` when the caller inlines their content.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentProfileMaterializationAxis,
  ProfileMaterializationContract,
} from '../agent/profile-materialization'

/** The policy version every {@link PlacementRecord} carries. */
export const PLACEMENT_POLICY = 'agent-placement/3'

/** Where one unit of agent work runs, cheapest first. */
export type ExecutionTier = 'inference' | 'loop' | 'sandbox'

/** What was chosen, under which policy, why, and why each other tier was refused. */
export interface PlacementRecord {
  chosen: ExecutionTier
  policy: typeof PLACEMENT_POLICY
  reason: string
  /**
   * The profile's declared materialization axes the chosen tier carries. A tier that
   * cannot carry a declared axis is rejected, so on a fresh decision this is every
   * declared axis; an authored or resumed record makes no coverage decision and is empty.
   */
  coveredAxes: AgentProfileMaterializationAxis[]
  rejected: Array<{ placement: ExecutionTier; reason: string }>
}

/**
 * The declared requirements of the work, beside its profile. Field names follow
 * Platform's `agent.run` action, the first consumer; an app's chat turn usually
 * declares none of them.
 */
export interface PlacementRequirements {
  /** A pinned harness. Always runs in the sandbox. */
  harness?: string
  /** A model other than the profile's own needs the sandbox to choose between them. */
  model?: string
  source?: unknown
  /** Skill ids resolved into a box. Profile skills are `profile.resources.skills`. */
  skills?: unknown
  env?: unknown
  image?: unknown
  size?: unknown
  resources?: unknown
  fromSnapshot?: unknown
  fromSandboxId?: unknown
  resume?: unknown
  maxRounds?: number
  ask?: boolean
  /** Hub connections: tools the loop holds. */
  connections?: readonly string[]
  /** Owner-object grants: tools only the loop holds. */
  objects?: unknown
  /** Public HTTPS reads: a tool only the loop holds. */
  http?: unknown
  /** Tools the caller binds into the loop itself, such as an app's product tools. */
  tools?: readonly string[]
}

/** Which tiers this deployment has wired. */
export interface PlacementContext {
  interactive: boolean
  inferenceAvailable: boolean
  loopAvailable: boolean
  /** Why the loop cannot take this work, when it cannot. */
  loopUnavailableReason?: string
}

/** Profile axes a tier may count as covered when their declared value grants nothing. */
export type VacuousAxis = 'permissions'

export interface PlaceExecutionInput {
  requirements?: PlacementRequirements
  /** The RESOLVED profile: a named profile is read before the decision. */
  profile?: AgentProfile | object
  context: PlacementContext
  /**
   * Axes whose deny-only value counts as covered on `inference` and `loop`.
   * `permissions` qualifies when every rule is `deny`: a tier without native tools
   * already denies them. Deny-only `tools` are covered without opting in.
   */
  vacuousAxes?: readonly VacuousAxis[]
  /**
   * The caller inlines the profile's skill content into the loop's context, so
   * `resources.skills` (with a strict `resources.failOnError`) and the native `skill`
   * tool and permission that load them count as covered on `loop`. Off by default:
   * the skills then keep the work in the sandbox.
   */
  inlineSkills?: boolean
}

/** No tier can meet every declared requirement. Raised before any spend. */
export class PlacementRefusedError extends Error {
  constructor(readonly reason: string) {
    super(`placement cannot run this work — ${reason}`)
    this.name = 'PlacementRefusedError'
  }
}

/**
 * The profile axes `inference` and `loop` carry: identity, prompt, model controls and
 * metadata. No harness, native tools, files, MCP, subagents, hooks or modes.
 */
export const loopTierProfileMaterialization: ProfileMaterializationContract = {
  name: 'placement-loop-tier',
  axes: [
    'name',
    'description',
    'version',
    'tags',
    'systemPrompt',
    'appendSystemPrompt',
    'instructions',
    'modelDefault',
    'modelSmall',
    'modelProvider',
    'modelReasoningEffort',
    'modelMaxVisibleOutputTokens',
    'modelMaxTotalOutputTokens',
    'modelMetadata',
    'metadata',
  ],
}

/** Compound profile properties and the axis each child maps to. */
const COMPOUND_FIELDS: Record<string, Record<string, AgentProfileMaterializationAxis>> = {
  prompt: {
    systemPrompt: 'systemPrompt',
    appendSystemPrompt: 'appendSystemPrompt',
    instructions: 'instructions',
  },
  model: {
    default: 'modelDefault',
    small: 'modelSmall',
    provider: 'modelProvider',
    reasoningEffort: 'modelReasoningEffort',
    maxVisibleOutputTokens: 'modelMaxVisibleOutputTokens',
    maxReasoningTokens: 'modelMaxReasoningTokens',
    maxTotalOutputTokens: 'modelMaxTotalOutputTokens',
    metadata: 'modelMetadata',
  },
  resources: {
    files: 'files',
    tools: 'resourceTools',
    skills: 'skills',
    agents: 'resourceAgents',
    commands: 'commands',
    instructions: 'resourceInstructions',
    failOnError: 'resourceFailOnError',
  },
}

/** Top-level profile properties that are themselves an axis (the rest are compounds). */
const TOP_LEVEL_AXES: ReadonlySet<string> = new Set([
  'name',
  'description',
  'version',
  'tags',
  'harness',
  'seats',
  'permissions',
  'tools',
  'mcp',
  'connections',
  'subagents',
  'hooks',
  'modes',
  'confidential',
  'metadata',
  'extensions',
])

/** Options for {@link loopProfileRefusal}. */
interface LoopProfileRefusalOptions {
  vacuousAxes?: readonly VacuousAxis[]
  inlineSkills?: boolean
}

/**
 * Why `inference` and `loop` cannot run this profile, or undefined when they can.
 * A profile that needs a harness, files, harness built-in tools, MCP servers,
 * subagents, hooks or modes needs a sandbox; the loop never drops one silently.
 * Platform's `workerProfileRefusal`, read through {@link loopTierProfileMaterialization}.
 */
function loopProfileRefusal(
  profile: object,
  options: LoopProfileRefusalOptions = {},
): string | undefined {
  const fields = profile as Record<string, unknown>
  const vacuousPermissions = options.vacuousAxes?.includes('permissions') === true
  const inlineSkills = options.inlineSkills === true
  const carried = new Set<string>(loopTierProfileMaterialization.axes)
  if (inlineSkills) carried.add('skills')
  const childCovered = (field: string, child: string, value: unknown): boolean => {
    const axis = COMPOUND_FIELDS[field]?.[child]
    if (axis === undefined) return false
    // A strict failure policy is honoured by an inliner that fails closed; a best-effort
    // one would have to report a skipped skill, which the loop has no channel for.
    if (axis === 'resourceFailOnError') return inlineSkills && value === true
    return carried.has(axis)
  }
  const reasons: string[] = []
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (field === 'tools') continue
    if (
      field === 'permissions' &&
      vacuousPermissions &&
      permissionsGrantNothing(value, inlineSkills)
    )
      continue
    if (TOP_LEVEL_AXES.has(field) && carried.has(field)) continue
    const children = COMPOUND_FIELDS[field]
    if (children && Object.values(children).some((axis) => carried.has(axis))) continue
    reasons.push(`profile ${field} needs a sandbox`)
  }
  for (const field of Object.keys(COMPOUND_FIELDS)) {
    const value = fields[field]
    if (typeof value !== 'object' || value === null) continue
    // A compound the loop carries none of was refused whole above.
    if (!Object.values(COMPOUND_FIELDS[field] ?? {}).some((axis) => carried.has(axis))) continue
    for (const [child, inner] of Object.entries(value)) {
      if (inner !== undefined && !childCovered(field, child, inner)) {
        reasons.push(`profile ${field}.${child} is not supported by the worker`)
      }
    }
  }
  // Harness built-in tools (shell, edit, browser) exist only in a sandbox. A profile may
  // still switch them off. The `skill` tool only loads skills, which an inliner supplies.
  const tools = fields.tools
  if (typeof tools === 'object' && tools !== null) {
    const enabled = Object.entries(tools)
      .filter(([name, on]) => on === true && !(inlineSkills && name === 'skill'))
      .map(([name]) => name)
    if (enabled.length > 0) reasons.push(`profile tools ${enabled.join(', ')} need a sandbox`)
  }
  return reasons.length > 0 ? reasons.join('; ') : undefined
}

/** True when every permission rule denies, or allows only `skill` under inlined skills. */
function permissionsGrantNothing(value: unknown, inlineSkills: boolean): boolean {
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).every(([tool, rule]) => {
    if (inlineSkills && tool === 'skill') return true
    if (rule === 'deny') return true
    if (typeof rule !== 'object' || rule === null) return false
    return Object.values(rule).every((inner) => inner === 'deny')
  })
}

/** Requirement fields that only mean something inside a provisioned box. */
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
] as const satisfies ReadonlyArray<keyof PlacementRequirements>

interface RequirementOptions extends LoopProfileRefusalOptions {
  requirements: PlacementRequirements
  profile?: object
  interactive: boolean
}

/** Every declared requirement only a sandbox can meet, in field order. */
function sandboxRequirements(options: RequirementOptions): string[] {
  const { requirements: cfg, profile } = options
  const needs: string[] = []
  if (options.interactive) needs.push('interactive run needs a session')
  if (cfg.harness !== undefined) needs.push(`harness ${cfg.harness} is pinned`)
  for (const field of SANDBOX_FIELDS) {
    if (cfg[field] !== undefined) needs.push(`${field} needs a sandbox`)
  }
  if (cfg.maxRounds !== undefined && cfg.maxRounds > 1)
    needs.push('maxRounds > 1 needs a multi-round session')
  if (cfg.ask === true) needs.push('ask needs a session to answer into')
  const refusal = profile ? loopProfileRefusal(profile, options) : undefined
  if (refusal) needs.push(refusal)
  // Inference and the loop run the profile's own model and refuse another; only the
  // sandbox decides between a requested model and the profile's.
  const profileModel = profileDefaultModel(profile)
  if (cfg.model !== undefined && profileModel !== undefined && cfg.model !== profileModel) {
    needs.push(
      `the action model ${cfg.model} differs from the profile model ${String(profileModel)}`,
    )
  }
  return needs
}

function profileDefaultModel(profile: object | undefined): unknown {
  return (profile as { model?: { default?: unknown } } | undefined)?.model?.default
}

/** Tools the work grants, each of which the loop can hold. */
function toolRequirements(cfg: PlacementRequirements): string[] {
  const tools: string[] = []
  if ((cfg.connections ?? []).length > 0) tools.push('connections need Hub tools')
  if (cfg.objects !== undefined) tools.push('objects need object tools')
  if (cfg.http !== undefined) tools.push('http needs a fetch tool')
  if ((cfg.tools ?? []).length > 0) tools.push(`tools ${cfg.tools?.join(', ')} need the loop`)
  return tools
}

/** Grants only the loop holds: a sandbox cannot honour them. */
function loopOnlyGrants(cfg: PlacementRequirements): string[] {
  return [
    ...(cfg.objects !== undefined ? ['objects'] : []),
    ...(cfg.http !== undefined ? ['http'] : []),
  ]
}

/** True when the profile declares skills that only an inliner on the loop can carry. */
function declaresProfileSkills(profile: object | undefined): boolean {
  const fields = (profile ?? {}) as {
    resources?: { skills?: unknown }
    tools?: Record<string, unknown>
    permissions?: Record<string, unknown>
  }
  const skills = fields.resources?.skills
  return (
    (Array.isArray(skills) && skills.length > 0) ||
    fields.tools?.skill === true ||
    (fields.permissions?.skill !== undefined && fields.permissions.skill !== 'deny')
  )
}

/**
 * Choose where work runs: the cheapest tier every declared requirement allows.
 * Throws {@link PlacementRefusedError} when no tier can meet every requirement.
 */
export function placeExecution(input: PlaceExecutionInput): PlacementRecord {
  const cfg = input.requirements ?? {}
  const { context, profile } = input
  const opts: LoopProfileRefusalOptions = {
    ...(input.vacuousAxes ? { vacuousAxes: input.vacuousAxes } : {}),
    ...(input.inlineSkills ? { inlineSkills: true } : {}),
  }
  const sandboxNeeds = sandboxRequirements({
    requirements: cfg,
    profile,
    interactive: context.interactive,
    ...opts,
  })
  const tools = toolRequirements(cfg)
  if (input.inlineSkills && declaresProfileSkills(profile))
    tools.push('skills are inlined by the loop')
  const loopOnly = loopOnlyGrants(cfg)
  const coveredAxes = profile ? declaredAxes(profile) : []
  const record = (
    chosen: ExecutionTier,
    reason: string,
    rejected: PlacementRecord['rejected'],
  ): PlacementRecord => ({ chosen, policy: PLACEMENT_POLICY, reason, coveredAxes, rejected })

  if (sandboxNeeds.length > 0) {
    const reason = sandboxNeeds.join('; ')
    if (loopOnly.length > 0) {
      throw new PlacementRefusedError(
        `${loopOnly.join(' and ')} run only in the worker, but ${reason}`,
      )
    }
    return record('sandbox', reason, [
      { placement: 'inference', reason },
      { placement: 'loop', reason },
    ])
  }

  // Past the sandbox check the profile is one the loop (and a single Router call) can
  // honour, so only granted tools separate the two.
  if (tools.length > 0) {
    const reason = `${tools.join('; ')}, which the worker holds without a sandbox`
    if (!context.loopAvailable) {
      const unavailable =
        context.loopUnavailableReason ?? 'worker placement is not wired on this deployment'
      if (loopOnly.length > 0) {
        throw new PlacementRefusedError(
          `${loopOnly.join(' and ')} need the worker, but ${unavailable}`,
        )
      }
      // Inlined skills are the one loop need a sandbox also meets, natively.
      return record('sandbox', unavailable, [
        { placement: 'inference', reason: tools.join('; ') },
        { placement: 'loop', reason: unavailable },
      ])
    }
    return record('loop', reason, [
      { placement: 'inference', reason: tools.join('; ') },
      { placement: 'sandbox', reason: 'costs more and no declared requirement needs it' },
    ])
  }

  if (context.inferenceAvailable) {
    return record('inference', 'no declared requirement needs tools, files or a session', [
      { placement: 'loop', reason: 'no declared tool needs a loop' },
      { placement: 'sandbox', reason: 'costs more and no declared requirement needs it' },
    ])
  }
  const unwired = 'inference is not wired on this deployment'
  if (context.loopAvailable) {
    return record('loop', `${unwired}; one tool-free worker turn`, [
      { placement: 'inference', reason: unwired },
      { placement: 'sandbox', reason: 'costs more and no declared requirement needs it' },
    ])
  }
  return record('sandbox', unwired, [
    { placement: 'inference', reason: unwired },
    { placement: 'loop', reason: 'worker placement is not wired on this deployment' },
  ])
}

/** The materialization axes a profile declares, in its own field order. Read from the
 *  same field map as {@link loopProfileRefusal}, so the module has no runtime import. */
function declaredAxes(profile: object): AgentProfileMaterializationAxis[] {
  const axes: AgentProfileMaterializationAxis[] = []
  for (const [field, value] of Object.entries(profile)) {
    if (value === undefined) continue
    if (TOP_LEVEL_AXES.has(field)) axes.push(field as AgentProfileMaterializationAxis)
    const children = COMPOUND_FIELDS[field]
    if (!children || typeof value !== 'object' || value === null) continue
    for (const [child, inner] of Object.entries(value)) {
      const axis = children[child]
      if (axis !== undefined && inner !== undefined) axes.push(axis)
    }
  }
  return axes
}
