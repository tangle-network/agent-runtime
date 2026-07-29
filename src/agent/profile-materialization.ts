import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'

/** Known AgentProfile axes a run path may or may not carry into execution. */
export const AGENT_PROFILE_MATERIALIZATION_AXES = [
  'identity',
  'name',
  'description',
  'version',
  'tags',
  'model',
  'modelDefault',
  'modelSmall',
  'modelProvider',
  'modelReasoningEffort',
  'modelMetadata',
  'harness',
  'prompt',
  'systemPrompt',
  'instructions',
  'resources',
  'files',
  'resourceInstructions',
  'skills',
  'resourceTools',
  'resourceAgents',
  'commands',
  'resourceFailOnError',
  'tools',
  'permissions',
  'mcp',
  'mcpConnections',
  'connections',
  'subagents',
  'hooks',
  'modes',
  'confidential',
  'metadata',
  'extensions',
] as const

export type KnownAgentProfileMaterializationAxis =
  (typeof AGENT_PROFILE_MATERIALIZATION_AXES)[number]

/** AgentProfile axis name, with `custom:<name>` reserved for caller-owned extensions. */
export type AgentProfileMaterializationAxis =
  | KnownAgentProfileMaterializationAxis
  | `custom:${string}`

type AgentProfileIdentityProperty = 'name' | 'description' | 'version' | 'tags'
type AgentProfilePropertyMaterializationAxis = Exclude<
  keyof AgentProfile,
  AgentProfileIdentityProperty
>

/** Canonical AgentProfile axes used when checking one complete profile. */
export type CanonicalAgentProfileMaterializationAxis = KnownAgentProfileMaterializationAxis

/** Declares which AgentProfile axes a concrete run path really carries. */
export interface ProfileMaterializationContract {
  /** Human-readable run path, e.g. `createSandboxAct` or `prompt-only-message`. */
  name: string
  /** Profile axes this run path actually carries into execution. */
  axes: readonly AgentProfileMaterializationAxis[]
}

/** One changed AgentProfile axis that would be dropped by a run path. */
export interface ProfileMaterializationIssue {
  contract: string
  axis: AgentProfileMaterializationAxis
  reason: 'unsupported-axis'
  supportedAxes: readonly AgentProfileMaterializationAxis[]
}

/** Input for declaring a run path's profile-axis support. */
export interface DefineProfileMaterializationContractOptions {
  name: string
  axes: readonly AgentProfileMaterializationAxis[]
}

/** Input for checking a candidate diff against a run path. */
export interface ValidateProfileMaterializationOptions {
  contract: ProfileMaterializationContract
  changedAxes: readonly AgentProfileMaterializationAxis[]
}

/** Input for throwing on dropped profile axes. */
export interface AssertProfileMaterializationOptions extends ValidateProfileMaterializationOptions {
  /** Extra label included in the thrown error, usually the caller or run id. */
  context?: string
}

const KNOWN_AXIS_SET = new Set<string>(AGENT_PROFILE_MATERIALIZATION_AXES)

const AXIS_PARENTS: Partial<
  Record<KnownAgentProfileMaterializationAxis, KnownAgentProfileMaterializationAxis>
> = {
  name: 'identity',
  description: 'identity',
  version: 'identity',
  tags: 'identity',
  modelDefault: 'model',
  modelSmall: 'model',
  modelProvider: 'model',
  modelReasoningEffort: 'model',
  modelMetadata: 'model',
  systemPrompt: 'prompt',
  instructions: 'prompt',
  files: 'resources',
  resourceInstructions: 'resources',
  skills: 'resources',
  resourceTools: 'resources',
  resourceAgents: 'resources',
  commands: 'resources',
  resourceFailOnError: 'resources',
  mcpConnections: 'mcp',
}

const canonicalAgentProfilePropertyAxes = [
  'prompt',
  'model',
  'harness',
  'permissions',
  'tools',
  'mcp',
  'connections',
  'subagents',
  'resources',
  'hooks',
  'modes',
  'confidential',
  'metadata',
  'extensions',
] as const satisfies readonly AgentProfilePropertyMaterializationAxis[]

type MissingAgentProfilePropertyMaterializationAxis = Exclude<
  AgentProfilePropertyMaterializationAxis,
  (typeof canonicalAgentProfilePropertyAxes)[number]
>
const agentProfilePropertyAxesAreExhaustive: MissingAgentProfilePropertyMaterializationAxis extends never
  ? true
  : never = true
void agentProfilePropertyAxesAreExhaustive

const fullProfileMaterializationAxes = [
  'identity',
  ...canonicalAgentProfilePropertyAxes,
] as const satisfies readonly CanonicalAgentProfileMaterializationAxis[]

/** Materialization contract for a run path that executes every canonical AgentProfile axis. */
export const fullProfileMaterialization = defineProfileMaterializationContract({
  name: 'full-profile-execution',
  axes: fullProfileMaterializationAxes,
})

/**
 * Materialization contract for an intentionally limited prompt-and-model execution path.
 * Identity, harness, and metadata are control fields consumed for naming, placement,
 * authorization, and durable attribution; they are carried without adding worker behavior.
 * Every behavioral axis other than prompt and model remains unsupported.
 */
export const promptModelProfileMaterialization = defineProfileMaterializationContract({
  name: 'prompt-model-execution',
  axes: ['name', 'systemPrompt', 'instructions', 'modelDefault', 'harness', 'metadata'],
})

/**
 * Materialization contract for a local coding CLI in an isolated git worktree.
 * The shared workspace materializer carries native tools, permissions, MCP, hooks, subagents,
 * modes, and file-backed resources when the selected CLI supports their exact values. Runtime
 * placement concerns (hub connections and confidential execution), provider-native extensions,
 * unused model hints, and `resources.failOnError` are deliberately absent so they fail before a
 * worktree or executor is created rather than being mistaken for an effective candidate change.
 */
export const worktreeCliProfileMaterialization = defineProfileMaterializationContract({
  name: 'worktree-cli-execution',
  axes: [
    'name',
    'systemPrompt',
    'instructions',
    'modelDefault',
    'modelReasoningEffort',
    'harness',
    'permissions',
    'tools',
    'mcp',
    'subagents',
    'files',
    'resourceTools',
    'skills',
    'resourceAgents',
    'commands',
    'resourceInstructions',
    'hooks',
    'modes',
    'metadata',
  ],
})

/** Materialization contract for a raw process path that carries only control/identity fields. */
export const controlProfileMaterialization = defineProfileMaterializationContract({
  name: 'control-only-execution',
  axes: ['name', 'harness', 'metadata'],
})

/** Materialization contract for an injected inference function whose surrounding driver still
 * applies the profile prompt, name, placement, and metadata, but not model selection. */
export const promptControlProfileMaterialization = defineProfileMaterializationContract({
  name: 'prompt-control-execution',
  axes: ['name', 'systemPrompt', 'instructions', 'harness', 'metadata'],
})

/** Materialization contract for `createSandboxAct`, which forwards the full AgentProfile. */
export const sandboxActProfileMaterialization = defineProfileMaterializationContract({
  name: 'createSandboxAct',
  axes: fullProfileMaterialization.axes,
})

/** Materialization contract for a run path that only injects prompt text. */
export const promptOnlyProfileMaterialization = defineProfileMaterializationContract({
  name: 'prompt-only-message',
  axes: ['prompt'],
})

/** Materialization contract for a run path that injects prompt text plus inline resources. */
export const promptResourceProfileMaterialization = defineProfileMaterializationContract({
  name: 'prompt-resource-attachment',
  axes: ['prompt', 'resources'],
})

/** Define the profile axes a concrete run path actually carries into execution. */
export function defineProfileMaterializationContract(
  options: DefineProfileMaterializationContractOptions,
): ProfileMaterializationContract {
  const name = options.name.trim()
  if (!name) {
    throw new ValidationError('defineProfileMaterializationContract: name is required')
  }
  return {
    name,
    axes: normalizeAxes(options.axes, `${name}.axes`),
  }
}

/**
 * Return the exact canonical axes a complete profile actually requests. Compound prompt, model,
 * identity, and resource objects are split so a path cannot claim an entire object while silently
 * dropping one of its fields.
 * Empty strings, arrays, and nested records do not claim support; explicit
 * scalar values such as `false` and `0` remain meaningful requests.
 */
export function profileMaterializationAxes(
  profile: AgentProfile,
): readonly CanonicalAgentProfileMaterializationAxis[] {
  const axes: CanonicalAgentProfileMaterializationAxis[] = []
  addIfRequested(axes, 'name', profile.name)
  addIfRequested(axes, 'description', profile.description)
  addIfRequested(axes, 'version', profile.version)
  addIfRequested(axes, 'tags', profile.tags)
  addIfRequested(axes, 'systemPrompt', profile.prompt?.systemPrompt)
  addIfRequested(axes, 'instructions', profile.prompt?.instructions)
  addIfRequested(axes, 'modelDefault', profile.model?.default)
  addIfRequested(axes, 'modelSmall', profile.model?.small)
  addIfRequested(axes, 'modelProvider', profile.model?.provider)
  addIfRequested(axes, 'modelReasoningEffort', profile.model?.reasoningEffort)
  addIfRequested(axes, 'modelMetadata', profile.model?.metadata)
  addIfRequested(axes, 'harness', profile.harness)
  addIfRequested(axes, 'permissions', profile.permissions)
  addIfRequested(axes, 'tools', profile.tools)
  addIfRequested(axes, 'mcp', profile.mcp)
  addIfRequested(axes, 'connections', profile.connections)
  addIfRequested(axes, 'subagents', profile.subagents)
  addIfRequested(axes, 'files', profile.resources?.files)
  addIfRequested(axes, 'resourceTools', profile.resources?.tools)
  addIfRequested(axes, 'skills', profile.resources?.skills)
  addIfRequested(axes, 'resourceAgents', profile.resources?.agents)
  addIfRequested(axes, 'commands', profile.resources?.commands)
  addIfRequested(axes, 'resourceInstructions', profile.resources?.instructions)
  addIfRequested(axes, 'resourceFailOnError', profile.resources?.failOnError)
  addIfRequested(axes, 'hooks', profile.hooks)
  addIfRequested(axes, 'modes', profile.modes)
  addIfRequested(axes, 'confidential', profile.confidential)
  addIfRequested(axes, 'metadata', profile.metadata)
  addIfRequested(axes, 'extensions', profile.extensions)
  return axes
}

function addIfRequested(
  axes: CanonicalAgentProfileMaterializationAxis[],
  axis: CanonicalAgentProfileMaterializationAxis,
  value: unknown,
): void {
  if (hasNonEmptyMaterializationValue(value)) axes.push(axis)
}

/** Return every changed profile axis that the selected run path would drop. */
export function validateProfileMaterialization(
  options: ValidateProfileMaterializationOptions,
): readonly ProfileMaterializationIssue[] {
  const changedAxes = normalizeAxes(options.changedAxes, 'changedAxes')
  const supported = new Set<string>(
    normalizeAxes(options.contract.axes, `${options.contract.name}.axes`),
  )
  const issues: ProfileMaterializationIssue[] = []
  for (const axis of changedAxes) {
    if (isAxisSupported(axis, supported)) continue
    issues.push({
      contract: options.contract.name,
      axis,
      reason: 'unsupported-axis',
      supportedAxes: [...supported] as AgentProfileMaterializationAxis[],
    })
  }
  return issues
}

/** Throw when a candidate changes axes the selected run path cannot carry. */
export function assertProfileMaterialization(options: AssertProfileMaterializationOptions): void {
  const issues = validateProfileMaterialization(options)
  if (issues.length === 0) return
  throw new ValidationError(renderProfileMaterializationIssues(issues, options.context))
}

/** Format profile-axis drop issues into a concise operator-facing error. */
export function renderProfileMaterializationIssues(
  issues: readonly ProfileMaterializationIssue[],
  context?: string,
): string {
  if (issues.length === 0) return ''
  const contract = issues[0]?.contract ?? '<unknown>'
  const prefix = context ? `${context}: ` : ''
  const droppedAxes = issues.map((issue) => issue.axis).join(', ')
  const supportedAxes = issues[0]?.supportedAxes.join(', ') || '<none>'
  return [
    `${prefix}profile materialization would drop axis changes on "${contract}": ${droppedAxes}.`,
    `Supported axes: ${supportedAxes}.`,
    'Use a run path that carries those AgentProfile axes, or remove them from the candidate.',
  ].join('\n')
}

function normalizeAxes(
  axes: readonly AgentProfileMaterializationAxis[],
  label: string,
): AgentProfileMaterializationAxis[] {
  const out: AgentProfileMaterializationAxis[] = []
  const seen = new Set<string>()
  for (const raw of axes) {
    const axis = normalizeAxis(raw, label)
    if (seen.has(axis)) continue
    seen.add(axis)
    out.push(axis)
  }
  return out
}

function normalizeAxis(
  raw: AgentProfileMaterializationAxis,
  label: string,
): AgentProfileMaterializationAxis {
  if (typeof raw !== 'string') {
    throw new ValidationError(`${label}: profile axis must be a string`)
  }
  const axis = raw.trim()
  if (!axis) {
    throw new ValidationError(`${label}: profile axis must be non-empty`)
  }
  if (!KNOWN_AXIS_SET.has(axis) && !axis.startsWith('custom:')) {
    throw new ValidationError(
      `${label}: unknown profile axis "${axis}". Use a known axis or custom:<name>.`,
    )
  }
  return axis as AgentProfileMaterializationAxis
}

function isAxisSupported(
  axis: AgentProfileMaterializationAxis,
  supported: ReadonlySet<string>,
): boolean {
  if (supported.has(axis)) return true
  let parent = AXIS_PARENTS[axis as KnownAgentProfileMaterializationAxis]
  while (parent) {
    if (supported.has(parent)) return true
    parent = AXIS_PARENTS[parent]
  }
  return false
}

function hasNonEmptyMaterializationValue(root: unknown): boolean {
  const pending: unknown[] = [root]
  const seen = new Set<object>()
  while (pending.length > 0) {
    const value = pending.pop()
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      if (value.trim().length > 0) return true
      continue
    }
    if (typeof value === 'object') {
      // Profiles are normally serializable trees. Treat a repeated reference as nonempty so a
      // cyclic opaque metadata value cannot recurse forever or make an unsupported axis disappear.
      if (seen.has(value)) return true
      seen.add(value)
      for (const child of Array.isArray(value) ? value : Object.values(value)) {
        pending.push(child)
      }
      continue
    }
    return true
  }
  return false
}
