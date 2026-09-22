/** Provider-backed evaluation and repository-improvement utilities. */
export type {
  AgentRunContext,
  AgentRunInvocation,
  CreateEnvironmentActOptions,
  EnvironmentActComposeOverrides,
} from './environment-act'
export {
  collectAgentRun,
  createEnvironmentAct,
  environmentActProfileMaterialization,
} from './environment-act'
export type {
  CreateSurfaceImprovementProposerOptions,
  DraftPatchInput,
  DraftPatchOutput,
  SurfaceImprovementEdit,
} from './improvement-adapter'
export { createSurfaceImprovementProposer } from './improvement-adapter'
export type {
  AgentImprovementPaths,
  ImprovementPathIssue,
  ResolvedImprovementPath,
} from './improvement-paths'
export {
  renderImprovementPathIssues,
  resolveSubjectPath,
  validateImprovementPaths,
} from './improvement-paths'
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
  validateProfileMaterialization,
} from './profile-materialization'
