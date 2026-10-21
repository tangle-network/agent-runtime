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
export {
  type AssertProfileMaterializationOptions,
  assertProfileMaterialization,
  assertProfileMaterializes,
  controlProfileMaterialization,
  type DefineProfileMaterializationContractOptions,
  defineProfileMaterializationContract,
  fullProfileMaterialization,
  type ProfileMaterializationContract,
  type ProfileMaterializationIssue,
  profileMaterializationAxes,
  promptControlProfileMaterialization,
  promptModelProfileMaterialization,
  promptOnlyProfileMaterialization,
  promptResourceProfileMaterialization,
  sandboxActProfileMaterialization,
  type ValidateProfileMaterializationOptions,
  validateProfileMaterialization,
  worktreeCliProfileMaterialization,
} from './profile-materialization'
export {
  type CreateSandboxActOptions,
  createSandboxAct,
  type SandboxActComposeOverrides,
} from './sandbox-act'
export type { AgentSurfaces, ResolvedSurface, SurfaceValidationIssue } from './surfaces'
export { renderSurfaceIssues, validateSurfaces } from './surfaces'
