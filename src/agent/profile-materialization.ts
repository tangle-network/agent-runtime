import {
  AGENT_PROFILE_MATERIALIZATION_AXES,
  type CanonicalAgentProfileMaterializationAxis,
  profileMaterializationAxes,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'

export type { CanonicalAgentProfileMaterializationAxis }
/**
 * The canonical AgentProfile leaves, re-exported from `@tangle-network/agent-interface`.
 *
 * These are LEAVES only: `modelReasoningEffort`, not `model`; `systemPrompt`, not `prompt`. A
 * contract must name every leaf it carries, because claiming a compound parent while dropping one
 * of its children is exactly the silent-drop this module exists to catch.
 */
export { AGENT_PROFILE_MATERIALIZATION_AXES, profileMaterializationAxes }

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
 * Compound AgentProfile properties and the canonical leaves they cover.
 *
 * agent-interface publishes two axis vocabularies, and this module has to sit between them:
 * `profileMaterializationAxes` emits canonical LEAVES, while `changedAgentProfileAxes` emits
 * DIFF axes, which are compound property names (`model`, `prompt`, `resources`, `identity`) for
 * everything except the already-scalar properties. A changed-axis input is therefore expanded
 * through this map, so both producers compose with this validator.
 *
 * A CONTRACT may still only name leaves. Expanding an input is safe — it asks about more, never
 * less — whereas letting a contract claim a parent is what silently swallows a dropped child.
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

/** Materialization contract for a run path that executes every canonical AgentProfile leaf. */
export const fullProfileMaterialization = defineProfileMaterializationContract({
  name: 'full-profile-execution',
  axes: AGENT_PROFILE_MATERIALIZATION_AXES,
})

/**
 * Materialization contract for an intentionally limited prompt-and-model execution path.
 * Identity, harness, and metadata are control fields consumed for naming, placement,
 * authorization, and durable attribution; they are carried without adding worker behavior.
 * Every behavioral axis other than prompt and model remains unsupported.
 */
export const promptModelProfileMaterialization = defineProfileMaterializationContract({
  name: 'prompt-model-execution',
  axes: [
    'name',
    'systemPrompt',
    'instructions',
    'modelDefault',
    'modelProvider',
    'modelReasoningEffort',
    'modelMetadata',
    'harness',
    'metadata',
  ],
})

/**
 * Materialization contract for a local coding CLI in an isolated git worktree.
 * The shared workspace materializer carries native tools, permissions, MCP, hooks, subagents,
 * modes, and file-backed resources when the selected CLI supports their exact values.
 * `resourceFailOnError` is carried: it is the fail-closed policy the pre-worktree resource
 * RESOLUTION step (`resolveAgentProfileResources`) applies to remote profile resources. Runtime
 * placement concerns (hub connections and confidential execution), provider-native extensions,
 * and unused model hints are deliberately absent so they fail before a worktree or executor is
 * created rather than being mistaken for an effective candidate change.
 */
export const worktreeCliProfileMaterialization = defineProfileMaterializationContract({
  name: 'worktree-cli-execution',
  axes: [
    'name',
    'systemPrompt',
    'instructions',
    'modelDefault',
    'modelProvider',
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
    'resourceFailOnError',
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
  axes: [
    'name',
    'systemPrompt',
    'instructions',
    'modelDefault',
    'modelProvider',
    'modelReasoningEffort',
    'modelMetadata',
    'harness',
    'metadata',
  ],
})

/**
 * Materialization contract for `createSandboxAct`.
 *
 * `createSandboxAct` hands the whole `AgentProfile` to the sandbox as `backend.profile`, so every
 * profile leaf crosses the boundary. `buildBackendOptions` resolves the runner from an explicit
 * `sandboxOverrides.backend.type`, then `profile.metadata.backendType`, then `profile.harness`,
 * so a candidate that changes only `harness` runs on the harness it declares — and one declaring
 * a harness the sandbox cannot run throws rather than running elsewhere and reporting success.
 */
export const sandboxActProfileMaterialization = defineProfileMaterializationContract({
  name: 'createSandboxAct',
  axes: fullProfileMaterialization.axes,
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
    axes: normalizeContractAxes(options.axes, `${name}.axes`),
  }
}

/** Return every changed profile axis that the selected run path would drop. */
export function validateProfileMaterialization(
  options: ValidateProfileMaterializationOptions,
): readonly ProfileMaterializationIssue[] {
  const changedAxes = normalizeChangedAxes(options.changedAxes, 'changedAxes')
  const supported = new Set<string>(
    normalizeContractAxes(options.contract.axes, `${options.contract.name}.axes`),
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

/** Contract side: leaves (or `custom:`) only. A parent claim would hide a dropped child. */
function normalizeContractAxes(
  axes: readonly AgentProfileMaterializationAxis[],
  label: string,
): AgentProfileMaterializationAxis[] {
  return dedupe(axes.map((raw) => assertLeafAxis(raw, label)))
}

/**
 * Input side: leaves, `custom:`, and compound diff axes, which expand to their leaves so
 * `changedAgentProfileAxes` output composes with a leaf-only contract.
 */
function normalizeChangedAxes(
  axes: readonly AgentProfileMaterializationAxis[],
  label: string,
): AgentProfileMaterializationAxis[] {
  const out: AgentProfileMaterializationAxis[] = []
  for (const raw of axes) {
    const axis = readAxisName(raw, label)
    const leaves = compoundAxisLeaves[axis]
    if (leaves && !KNOWN_AXIS_SET.has(axis)) {
      out.push(...leaves)
      continue
    }
    out.push(assertLeafAxis(raw, label))
  }
  return dedupe(out)
}

function dedupe(
  axes: readonly AgentProfileMaterializationAxis[],
): AgentProfileMaterializationAxis[] {
  const out: AgentProfileMaterializationAxis[] = []
  const seen = new Set<string>()
  for (const axis of axes) {
    if (seen.has(axis)) continue
    seen.add(axis)
    out.push(axis)
  }
  return out
}

function readAxisName(raw: AgentProfileMaterializationAxis, label: string): string {
  if (typeof raw !== 'string') {
    throw new ValidationError(`${label}: profile axis must be a string`)
  }
  const axis = raw.trim()
  if (!axis) {
    throw new ValidationError(`${label}: profile axis must be non-empty`)
  }
  return axis
}

function assertLeafAxis(
  raw: AgentProfileMaterializationAxis,
  label: string,
): AgentProfileMaterializationAxis {
  const axis = readAxisName(raw, label)
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
