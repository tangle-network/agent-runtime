import {
  AGENT_PROFILE_MATERIALIZATION_AXES,
  type CanonicalAgentProfileMaterializationAxis,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'

/**
 * The canonical AgentProfile leaves, re-exported from `@tangle-network/agent-interface`.
 *
 * These are LEAVES only: `modelReasoningEffort`, not `model`; `systemPrompt`, not `prompt`. A
 * contract must name every leaf it carries, because claiming a compound parent while dropping one
 * of its children is exactly the silent-drop this module exists to catch.
 */
export { AGENT_PROFILE_MATERIALIZATION_AXES }

export type KnownAgentProfileMaterializationAxis = CanonicalAgentProfileMaterializationAxis

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

/**
 * Compound AgentProfile properties and the canonical leaves they expand to. Used ONLY to turn a
 * rejected compound name into an actionable error — a contract must still name each leaf, so that
 * dropping one is a visible edit rather than a silent consequence of claiming the parent.
 */
const compoundAxisLeaves: Record<string, readonly CanonicalAgentProfileMaterializationAxis[]> = {
  identity: ['name', 'description', 'version', 'tags'],
  prompt: ['systemPrompt', 'instructions'],
  model: ['modelDefault', 'modelSmall', 'modelProvider', 'modelReasoningEffort', 'modelMetadata'],
  resources: [
    'files',
    'resourceTools',
    'skills',
    'resourceAgents',
    'commands',
    'resourceInstructions',
    'resourceFailOnError',
  ],
  mcpConnections: ['mcp'],
}

/**
 * Materialization contract for `createSandboxAct`.
 *
 * `createSandboxAct` hands the whole `AgentProfile` to the sandbox as `backend.profile`, so every
 * profile leaf crosses the boundary — except `harness`. `buildBackendOptions` resolves the runner
 * from an explicit `sandboxOverrides.backend.type`, then `profile.metadata.backendType`, then
 * `'opencode'`; it never reads `profile.harness`. A candidate that changes only `harness` would
 * therefore run on the SAME backend, so this path does not claim that axis.
 */
export const sandboxActProfileMaterialization = defineProfileMaterializationContract({
  name: 'createSandboxAct',
  axes: [
    'name',
    'description',
    'version',
    'tags',
    'systemPrompt',
    'instructions',
    'modelDefault',
    'modelSmall',
    'modelProvider',
    'modelReasoningEffort',
    'modelMetadata',
    'permissions',
    'tools',
    'mcp',
    'connections',
    'subagents',
    'files',
    'resourceTools',
    'skills',
    'resourceAgents',
    'commands',
    'resourceInstructions',
    'resourceFailOnError',
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
  axes: ['systemPrompt', 'instructions'],
})

/**
 * Materialization contract for a run path that injects prompt text plus inline resources.
 *
 * `resourceFailOnError` is absent: it is a resolution POLICY the attaching path would have to
 * enforce, and inlining resource content does not carry it.
 */
export const promptResourceProfileMaterialization = defineProfileMaterializationContract({
  name: 'prompt-resource-attachment',
  axes: [
    'systemPrompt',
    'instructions',
    'files',
    'resourceTools',
    'skills',
    'resourceAgents',
    'commands',
    'resourceInstructions',
  ],
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
    const leaves = compoundAxisLeaves[axis]
    if (leaves) {
      throw new ValidationError(
        `${label}: "${axis}" is a compound AgentProfile property, not a materialization axis. ` +
          `Name the exact leaves this path carries: ${leaves.join(', ')}.`,
      )
    }
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
  return supported.has(axis)
}
