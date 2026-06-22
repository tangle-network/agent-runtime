/**
 * `@tangle-network/agent-runtime/lifecycle` — the artifact-lifecycle closed loop.
 *
 * The §1.5 law: an agent IS its `AgentProfile`. This module grows that profile
 * by treating each promotable piece — a skill, a tool grant, a prompt line, an
 * MCP server — as an "artifact" with a stable id, and runs ONE surface-agnostic
 * loop over them:
 *
 *   GENERATE (per-surface `CandidateGenerator`)  →  MEASURE (`measureMarginalLift`
 *   on the held-back split)  →  PROMOTE (`PromotionGate` — the held-back exam)  →
 *   STORE (`ArtifactRegistry`, lift recorded as the receipt)  →  COMPOSE
 *   (`composeProfile` — top-k active artifacts folded back into a profile).
 *
 * The ONLY per-surface code is the thin `CandidateGenerator` adapter; everything
 * else is shared. The reference generator, `skillGenerator`, DISTILLS a new skill
 * from traces (the create step an optimizer can't do) then refines it — the
 * answer to "an empty profile has no skills".
 *
 * INVARIANT: an artifact is active (`promoted`) IFF it carries a measured held-
 * back lift (`registry.liftOf` returns a number). `composeProfile` folds in only
 * those — a status flag without a lift receipt is invisible.
 */

export { applyArtifact, applyArtifacts } from './apply'
export { type ComposeProfileOptions, composeProfile } from './compose'
export {
  type HeldOutPromotionGateOptions,
  heldOutPromotionGate,
  type PromotionGate,
  type PromotionVerdict,
  thresholdPromotionGate,
} from './gate'
export type { CandidateGenerator, GenerateContext } from './generator'
export {
  type EvalResult,
  type EvalRunner,
  type MarginalLift,
  type MeasureMarginalLiftOptions,
  measureMarginalLift,
} from './marginal-lift'
export {
  type ArtifactQuery,
  ArtifactRegistry,
  createArtifactRegistry,
  liftMetadataKey,
} from './registry'
export {
  type CandidateOutcome,
  type RunLifecycleOptions,
  type RunLifecycleResult,
  runLifecycle,
} from './run-lifecycle'
export {
  type DistillSkills,
  type RefineSkill,
  type SkillDraft,
  type SkillGeneratorOptions,
  skillGenerator,
} from './skill-generator'
export type {
  ArtifactInput,
  ArtifactKind,
  ArtifactPayloads,
  ArtifactStatus,
  ProfileArtifact,
} from './types'
