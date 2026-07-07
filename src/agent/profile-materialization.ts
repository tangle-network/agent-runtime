import { ValidationError } from '../errors'

/** Known AgentProfile axes a run path may or may not carry into execution. */
export const AGENT_PROFILE_MATERIALIZATION_AXES = [
  'identity',
  'name',
  'model',
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
  systemPrompt: 'prompt',
  instructions: 'prompt',
  files: 'resources',
  resourceInstructions: 'resources',
  skills: 'resources',
  resourceTools: 'resources',
  resourceAgents: 'resources',
  commands: 'resources',
  mcpConnections: 'mcp',
}

/** Materialization contract for `createSandboxAct`, which forwards the full AgentProfile. */
export const sandboxActProfileMaterialization = defineProfileMaterializationContract({
  name: 'createSandboxAct',
  axes: [
    'identity',
    'model',
    'prompt',
    'resources',
    'tools',
    'permissions',
    'mcp',
    'connections',
    'subagents',
    'hooks',
    'modes',
    'confidential',
    'metadata',
    'extensions',
  ],
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
