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
  AgentRuntime,
  AgentRunContext,
  AnalystConfig,
  AutoApplyPolicy,
  JudgeConfig,
  RubricDimension,
} from './define-agent'
export { AgentManifestError, defineAgent } from './define-agent'

export type { AgentSurfaces, ResolvedSurface, SurfaceValidationIssue } from './surfaces'
export { renderSurfaceIssues, resolveSubjectPath, validateSurfaces } from './surfaces'

export type {
  CreateSurfaceImprovementAdapterOpts,
  DraftPatchInput,
  DraftPatchOutput,
  SurfaceImprovementEdit,
} from './improvement-adapter'
export { createSurfaceImprovementAdapter } from './improvement-adapter'

export type {
  CreateSurfaceKnowledgeAdapterOpts,
  KnowledgeAdapterDeps,
} from './knowledge-adapter'
export { createSurfaceKnowledgeAdapter } from './knowledge-adapter'

export type { OutcomeMeasurement, OutcomeMeasurementOpts } from './outcome'
export { measureOutcome } from './outcome'
