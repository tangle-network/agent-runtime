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
  AgentRunContext,
  AgentRunInvocation,
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
  DraftPatchInput,
  DraftPatchOutput,
  SurfaceImprovementEdit,
} from './improvement-adapter'
export { createSurfaceImprovementProposer } from './improvement-adapter'
export {
  assertProfileMaterialization,
  assertProfileMaterializes,
  controlProfileMaterialization,
  defineProfileMaterializationContract,
  fullProfileMaterialization,
  profileMaterializationAxes,
  promptControlProfileMaterialization,
  promptModelProfileMaterialization,
  promptOnlyProfileMaterialization,
  promptResourceProfileMaterialization,
  sandboxActProfileMaterialization,
  validateProfileMaterialization,
  worktreeCliProfileMaterialization,
} from './profile-materialization'
export { createSandboxAct } from './sandbox-act'
export type { AgentSurfaces } from './surfaces'
export { renderSurfaceIssues, validateSurfaces } from './surfaces'
