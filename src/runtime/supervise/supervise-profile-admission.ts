import {
  type AgentProfile,
  type AgentProfileSecurityPolicy,
  agentProfileSchema,
} from '@tangle-network/agent-interface'
import {
  type HarnessId,
  isMaterializerHarness,
  type SkippableDimension,
} from '@tangle-network/agent-profile-materialize'
import {
  assertProfileMaterialization,
  controlProfileMaterialization,
  defineProfileMaterializationContract,
  fullProfileMaterialization,
  type ProfileMaterializationContract,
  profileMaterializationAxes,
  promptModelProfileMaterialization,
  renderUnsupported,
  sandboxProfileMaterialization,
  unsupportedProfileDimensions,
  worktreeCliProfileMaterialization,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import { coordinationVerbNames } from '../../mcp/tools/coordination-events'
import { agentHarness, harnessRunsAgent } from '../harness-role'
import type { ExecutorConfig } from './runtime'
import {
  type CoordinationBinding,
  coordinationProfileToolPrefix,
  providerVisibleProfile,
} from './supervisor-agent'

/**
 * NOT a harness-name test — `ExecutorConfig.backend` is a discriminated-union TAG naming HOW a
 * profile is materialized (bridge / sandbox / cli-worktree / cli-in-place / router / cli /
 * provider), which is a
 * different axis from WHICH CLI runs. An exhaustive switch on a closed union tag is the correct
 * shape and must stay: it is what makes a new executor kind a compile error here rather than a
 * silently weaker materialization contract. Every other `backend.backend === …` in this file and
 * in `runtime.ts` is the same tag; none of them are harness names.
 */
export function backendProfileMaterialization(
  backend: ExecutorConfig,
): ProfileMaterializationContract {
  switch (backend.backend) {
    case 'bridge':
    case 'provider':
      return fullProfileMaterialization
    case 'sandbox':
      return sandboxProfileMaterialization
    case 'cli-worktree':
      return backend.bridge ? fullProfileMaterialization : worktreeCliProfileMaterialization
    case 'cli-in-place':
      return worktreeCliProfileMaterialization
    case 'router':
    case 'router-tools':
      return promptModelProfileMaterialization
    case 'cli':
      return controlProfileMaterialization
  }
}

export function assertProfileContract(
  profile: AgentProfile,
  contract: ProfileMaterializationContract,
  context: string,
  runtimeConsumesCoordinationTools = false,
): void {
  const materializedProfile = runtimeConsumesCoordinationTools
    ? providerVisibleProfile(profile)
    : profile
  assertProfileMaterialization({
    contract,
    changedAxes: profileMaterializationAxes(materializedProfile),
    context,
  })
}

/**
 * Materialization contracts need the profile axes the provider owns, before an individual manager
 * has asynchronously resolved its exact product-tool descriptors. Runtime-owned declarations are
 * not provider tools; unsupported declarations still fail when the coordination surface resolves.
 */

/** The child with its manager's Runtime coordination grants, unless the child's author wrote any
 *  coordination entry: an explicit grant or refusal is the author's choice and stands. A refusal
 *  (`false`) grants nothing, so it is removed once it has decided the child stays a leaf; a
 *  harness-less leaf carries no tools axis at all. */
export function withInheritedSpawnRights(parent: AgentProfile, child: AgentProfile): AgentProfile {
  const childTools = child.tools ?? {}
  const authored = Object.entries(childTools).filter(([name]) =>
    name.startsWith(coordinationProfileToolPrefix),
  )
  if (authored.length > 0) {
    if (authored.every(([, enabled]) => enabled !== false)) return child
    const kept = Object.entries(childTools).filter(
      ([name, enabled]) => !(name.startsWith(coordinationProfileToolPrefix) && enabled === false),
    )
    const { tools: _tools, ...rest } = child
    return agentProfileSchema.parse(
      kept.length === 0 ? rest : { ...rest, tools: Object.fromEntries(kept) },
    )
  }
  const inherited = Object.entries(parent.tools ?? {}).filter(
    ([name, enabled]) =>
      enabled === true &&
      name.startsWith(coordinationProfileToolPrefix) &&
      coordinationVerbNameSet.has(name.slice(coordinationProfileToolPrefix.length)),
  )
  if (!inherited.some(([name]) => name === `${coordinationProfileToolPrefix}spawn_worker`)) {
    return child
  }
  // A worker that becomes a manager must still be able to deliver work it does itself.
  return agentProfileSchema.parse({
    ...child,
    tools: {
      ...childTools,
      ...Object.fromEntries(inherited),
      [`${coordinationProfileToolPrefix}submit_result`]: true,
    },
  })
}

const coordinationVerbNameSet: ReadonlySet<string> = new Set<string>(coordinationVerbNames)

export function assertBackendProfileMaterialization(
  profile: AgentProfile,
  backend: ExecutorConfig,
  context: string,
): void {
  assertProfileContract(profile, backendProfileMaterialization(backend), context)
}

/**
 * The dimensions cli-bridge lowers through its OWN native controls rather than the workspace plan,
 * per harness. The pre-spawn check must skip exactly these, or it refuses a profile the bridge
 * would have executed. Mirrors `provisionProfileWorkspace` / `provisionPiProfile` in cli-bridge
 * `src/backends/profile-support.ts`.
 */
function bridgeMaterializationSkip(harness: HarnessId): readonly SkippableDimension[] {
  return harness === 'pi' ? ['mcp', 'extensions'] : ['mcp']
}

/**
 * The two prompt intents, gated here because they are the ONLY profile dimensions cli-bridge
 * refuses independently of whether a harness materializes a workspace at all
 * (`assertProfilePromptIntentsSupported`, cli-bridge `src/backends/profile-support.ts`): a
 * backend either owns a control that reaches the harness's system-prompt position or it does not.
 * Every other dimension's verdict belongs to the workspace plan the executing backend builds, and
 * the run's own materialization receipt already refuses those after the fact.
 */
const gatedPromptDimensions = ['systemPrompt', 'appendSystemPrompt'] as const

/**
 * Refuse a bridge-bound profile whose prompt intent the harness cannot execute, at the SYNCHRONOUS
 * spawn seam — before the reservation commits, the `spawned` event is journaled, or a token is
 * metered. The verdict is a pure function of the profile and the harness, but the bridge only
 * reaches it while assembling the prompt, by which point the child is spawned, metered, and
 * settled `down` to deliver an answer that was available before it started.
 *
 * Applies to the profiles the runtime SPAWNS — a worker and a nested driver child. A root manager
 * profile is the caller's own input and is not a spawn: the bridge answers it on the manager's
 * first turn without a child ever existing.
 *
 * Silent for every other backend: `cli-worktree` runs the full plan check on its own local plan
 * (`runWorktreeHarness`), and no other backend hands the profile to a harness materializer.
 */
export function assertBridgeProfileMaterializes(
  profile: AgentProfile,
  backend: ExecutorConfig,
  context: string,
): void {
  if (backend.backend !== 'bridge') return
  const harness = agentHarness(profile.harness)
  if (harness === undefined || !isMaterializerHarness(harness)) return
  const unsupported = unsupportedProfileDimensions(
    profile,
    harness,
    gatedPromptDimensions,
    bridgeMaterializationSkip(harness),
  )
  if (unsupported.length === 0) return
  throw new ValidationError(
    `${context}: ${harness} cannot materialize the profile: ${renderUnsupported(unsupported)}`,
  )
}

/**
 * The ROOT router-brained supervisor's materialization claim. The router arm consumes the
 * identity fields, the resolved system prompt (`prompt.systemPrompt` + `prompt.instructions` +
 * `resources.instructions`), and the resolved model id (`model.default`); the remaining model
 * fields are either applied by the profile-bound Router adapter or refused. Every behavioral axis
 * the Router brain cannot materialize fails before compute.
 *
 * `resourceFailOnError` is carried by the router arm itself. A strict root fails closed on an
 * instruction resource the arm cannot fetch, which is the policy the profile declares. A
 * best-effort root is refused, because the arm reports no skipped resource. Dropping the field
 * would instead force an edit to a champion profile before it can be re-seated as a supervisor
 * root, and that edit changes the profile's canonical identity.
 */
export const routerSupervisorProfileMaterialization = defineProfileMaterializationContract({
  name: 'router-supervisor-execution',
  axes: [
    'name',
    'description',
    'version',
    'tags',
    'systemPrompt',
    'instructions',
    'resourceInstructions',
    'resourceFailOnError',
    'modelDefault',
    'modelProvider',
    'modelReasoningEffort',
    'modelMaxVisibleOutputTokens',
    'modelMaxTotalOutputTokens',
    'modelMetadata',
    'harness',
    'metadata',
  ],
})

const defaultAllowedMcpHosts: string[] = []
Object.freeze(defaultAllowedMcpHosts)

/** Manager-authored profiles are untrusted until product policy says otherwise. Remote MCP and
 * ambient connection grants therefore fail closed by default, in addition to local MCP and hooks. */
export const DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY: AgentProfileSecurityPolicy = Object.freeze({
  allowLocalMcp: false,
  allowHooks: false,
  allowedMcpHosts: defaultAllowedMcpHosts,
  allowConnections: false,
})

/**
 * A manager keeps a dedicated environment. It serves its coordination credential through
 * create-time environment, and every co-tenant of a shared box could read it.
 */
export function managerExecutorConfig(config: ExecutorConfig): ExecutorConfig {
  if (config.backend !== 'provider' || config.shared === undefined) return config
  const { shared: _shared, ...dedicated } = config
  return Object.freeze(dedicated)
}

export function isExternalSupervisor(profile: AgentProfile): boolean {
  return harnessRunsAgent(profile.harness)
}

export function automaticDriverBackendSupported(
  backend: ExecutorConfig,
  coordination?: CoordinationBinding,
): boolean {
  return (
    backend.backend === 'bridge' ||
    (backend.backend === 'provider' &&
      !backend.steering &&
      coordination?.authentication !== undefined &&
      coordination.publicUrl !== undefined)
  )
}
