/**
 * `@tangle-network/agent-runtime/agent` — declarative agent manifest +
 * substrate-default adapters.
 *
 * Every vertical agent (tax / legal / gtm / creative / N future
 * verticals) ships ONE `defineAgent({...})` call + a thin invocation
 * of `runAnalystLoop` wired through the substrate-default adapters.
 * No per-vertical glue. No fabricated paths. No theater.
 */

export type {
  AgentManifest,
  AgentRubric,
  AgentRunContext,
  AgentRunInvocation,
  AgentRuntime,
  AnalystConfig,
  JudgeConfig,
  RubricDimension,
} from './define-agent'
export {
  AgentManifestError,
  collectAgentRun,
  defineAgent,
  unimplementedAgentRun,
} from './define-agent'
export type {
  CreateSurfaceImprovementProposerOptions,
  DraftPatchInput,
  DraftPatchOutput,
  SurfaceImprovementEdit,
} from './improvement-adapter'
export { createSurfaceImprovementProposer } from './improvement-adapter'
export type {
  AgentProfileMaterializationAxis,
  AssertProfileMaterializationOptions,
  DefineProfileMaterializationContractOptions,
  KnownAgentProfileMaterializationAxis,
  ProfileMaterializationContract,
  ProfileMaterializationIssue,
  ValidateProfileMaterializationOptions,
} from './profile-materialization'
export {
  AGENT_PROFILE_MATERIALIZATION_AXES,
  assertProfileMaterialization,
  defineProfileMaterializationContract,
  promptOnlyProfileMaterialization,
  promptResourceProfileMaterialization,
  renderProfileMaterializationIssues,
  sandboxActProfileMaterialization,
  validateProfileMaterialization,
} from './profile-materialization'
export type { CreateSandboxActOptions } from './sandbox-act'
export { createSandboxAct } from './sandbox-act'
export type { AgentSurfaces, ResolvedSurface, SurfaceValidationIssue } from './surfaces'
export { renderSurfaceIssues, resolveSubjectPath, validateSurfaces } from './surfaces'
