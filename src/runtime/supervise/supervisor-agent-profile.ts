import {
  type AgentProfile,
  type AgentProfileResources,
  agentProfileSchema,
} from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import { coordinationVerbNames } from '../../mcp/tools/coordination'
import { agentHarness } from '../harness-role'
import type { DeliverableSpec } from './completion-gate'
import { assertExecutableAgentProfile, concreteProfileModel } from './model-policy'
import { coordinationMcpAlias, coordinationProfileToolPrefix } from './provider-visible-profile'

/**
 * The completion check of a managed child that no `resolveDeliverable` gave a check of its own, a
 * `run_graph` node included: its accepted submission settles it, and the result goes to the manager
 * that assigned the task. The run's own check judges the run's result, never a child's narrower
 * assignment. Held to the run's check, a child's submission is refused for as long as the run's
 * is: every node of test-canary-graph-tools-20261017a, and the `delay` child of
 * test-retained-root-wake-20261018b (2026-10-18: "Expected: the canary runs to its deadline"), was
 * refused at submit_result, never settled, and its manager was never woken with it.
 *
 * It is the one check a harness manager may hold without a continuation policy: it accepts every
 * submission, so there is nothing to send the child back for. test-canary-graph-tools-20261018c and
 * -d (2026-10-18) had every harness-run graph lead refused at spawn until this exemption.
 */
export const ownSubmissionDeliverable: DeliverableSpec<unknown> = Object.freeze({
  describe:
    'the result your task asks for; it goes to the manager that assigned the task, and the ' +
    "run's own check judges that manager's result",
  check: () => true,
})

const coordinationVerbNameSet = new Set<string>(coordinationVerbNames)

/** Bare Runtime tool names explicitly enabled by one exact profile. */
export function declaredRuntimeToolNames(profile: AgentProfile): ReadonlyArray<string> {
  const names = Object.entries(profile.tools ?? {})
    .filter(([name, enabled]) => enabled === true && name.startsWith(coordinationProfileToolPrefix))
    .map(([name]) => name.slice(coordinationProfileToolPrefix.length))
  // Tool maps are sets in AgentProfile. Normalize their order before a provider sees a tool list or
  // Runtime records an attachment, so equivalent authored maps cannot change model behavior.
  return Object.freeze([...new Set(names)].sort())
}

/** Describe Runtime declarations that cannot resolve without a product tool provider. */
export function runtimeToolDeclarationError(
  profile: AgentProfile,
  hasProductToolResolver: boolean,
  mountedStaticToolNames: ReadonlyArray<string> = [],
): string | undefined {
  const mountedStaticToolNameSet = new Set(mountedStaticToolNames)
  if (declaredRuntimeToolNames(profile).includes('await_event')) {
    return `the profile declares ${JSON.stringify(`${coordinationProfileToolPrefix}await_event`)}, which no longer exists: a manager ends its turn to wait, and Runtime wakes it with what happened. Remove the grant`
  }
  const unresolved = declaredRuntimeToolNames(profile).filter(
    (name) =>
      !coordinationVerbNameSet.has(name) &&
      !hasProductToolResolver &&
      !mountedStaticToolNameSet.has(name),
  )
  if (unresolved.length === 0) return undefined
  return `the profile declares ${unresolved
    .map((name) => JSON.stringify(`${coordinationProfileToolPrefix}${name}`))
    .join(
      ', ',
    )}, but this run has no resolveSupervisorTools provider or router-mounted static tool for those tools`
}

/** Runtime owns this attachment alias. An authored entry would make the provider mount ambiguous. */
export function assertNoReservedCoordinationMcpAlias(profile: AgentProfile, context: string): void {
  if (profile.mcp?.[coordinationMcpAlias] === undefined) return
  throw new ValidationError(
    `${context}: profile MCP alias ${JSON.stringify(coordinationMcpAlias)} is reserved for Runtime coordination`,
  )
}

/** A supervisor is an exact canonical AgentProfile; no looser model/prompt shape exists. */
export type SupervisorProfile = AgentProfile

/** The exact profile fields consumed by supervisor materialization. */
export interface ResolvedSupervisorProfile {
  readonly name: string
  readonly harness: string | null
  readonly modelId: string
  readonly systemPrompt?: string
}

/**
 * The instruction lines a canonical `resources.instructions` contributes. A plain string and an
 * `inline` resource are their own text; a `github` reference names bytes that live elsewhere and
 * cannot be fetched while building a supervisor synchronously — that fails loud rather than
 * dropping instructions the profile says the agent runs under (the same rule
 * `improve()`'s memory surface applies to the same field).
 */
function resourceInstructionLines(
  instructions: AgentProfileResources['instructions'],
): readonly string[] {
  if (instructions === undefined) return []
  if (typeof instructions === 'string') return instructions.length > 0 ? [instructions] : []
  if (instructions.kind === 'inline') {
    return instructions.content.length > 0 ? [instructions.content] : []
  }
  throw new ConfigError(
    'supervisorAgent: profile.resources.instructions is a github resource reference ' +
      `(${JSON.stringify(instructions.path)}), which cannot be fetched while the supervisor is ` +
      'built — pass the instruction text as a string or an inline resource',
  )
}

/**
 * Refuse a best-effort resource policy on the router arm.
 *
 * The router arm inlines `resources.instructions` into the standing prompt and has no channel that
 * could report a resource it skipped. `resources.failOnError: false` asks for the supported subset
 * plus a warning about the rest, so this arm cannot honor it. Running such a profile as strict
 * would apply a policy the profile did not ask for, which is the silent drop the materialization
 * contract exists to prevent.
 */
export function assertRouterArmResourcePolicy(profile: SupervisorProfile): void {
  if (profile.resources?.failOnError !== false) return
  throw new ConfigError(
    'supervisorAgent: resources.failOnError: false requests a best-effort resource subset; the ' +
      'router-brained supervisor inlines its resources and reports no skipped resource, so the ' +
      'best-effort policy is refused rather than applied as strict',
  )
}

/**
 * The standing instruction both arms run under: `prompt.systemPrompt`, then canonical prompt and
 * resource instruction lines.
 * `undefined` only when the profile names none at all.
 */
export function resolveSupervisorSystemPrompt(profile: SupervisorProfile): string | undefined {
  const promptSystem = profile.prompt?.systemPrompt
  const lines = [
    ...(profile.prompt?.instructions ?? []),
    ...resourceInstructionLines(profile.resources?.instructions),
  ]
  if (lines.length === 0) return promptSystem
  return (promptSystem !== undefined ? [promptSystem, ...lines] : lines).join('\n')
}

/** Resolve the model after refusing any incomplete execution identity. */
export function resolveSupervisorModelId(profile: SupervisorProfile): string {
  assertExecutableAgentProfile(profile, 'supervisorAgent')
  return concreteProfileModel(profile)!
}

/**
 * Reduce one canonical executable profile to the scalars the two brain arms consume.
 */
export function resolveSupervisorProfile(profile: SupervisorProfile): ResolvedSupervisorProfile {
  const exact = agentProfileSchema.parse(profile)
  assertExecutableAgentProfile(exact, 'resolveSupervisorProfile')
  const systemPrompt = resolveSupervisorSystemPrompt(exact)
  const modelId = resolveSupervisorModelId(exact)
  return {
    name: exact.name ?? 'supervisor',
    harness: agentHarness(exact.harness) ?? null,
    modelId,
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
  }
}

/** Listener, authenticated remote endpoint, and bounded request policy for one manager. */
