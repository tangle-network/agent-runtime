/**
 * `@tangle-network/agent-runtime/lifecycle` — the artifact-lifecycle FOUNDATION.
 *
 * PHASE 1: two primitives the rest of the lifecycle hangs off.
 *   - `ArtifactRegistry` — a typed catalog of profile artifacts with stable ids
 *     (`register` / `list` / `get` / `promote` / `compose`).
 *   - `measureMarginalLift` — the with-vs-without ablation: how much score/cost a
 *     single artifact adds on top of a baseline profile.
 *
 * Both sit on the §1.5 profile law (`applyArtifact` is the one bridge from an
 * `ArtifactKind` to an `AgentProfile` field). The per-surface lifecycles, the
 * `BuildableSurface` author contract, and the promotion-gate wiring are deferred
 * to later phases.
 */

export { applyArtifact, applyArtifacts } from './apply'
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
} from './registry'
export type {
  ArtifactInput,
  ArtifactKind,
  ArtifactPayloads,
  ArtifactStatus,
  ProfileArtifact,
} from './types'
