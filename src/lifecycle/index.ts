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
 * Two maintenance stages close the lifecycle once artifacts are live:
 *
 *   DRIFT-WATCH (`driftWatch`)  — a scheduled re-measure of the active set that
 *     DEMOTES (`active` → `decayed`) any artifact whose held-back lift decayed
 *     below the keep-bar. Promotion is a snapshot; the world moves on.
 *   DEDUPE (`dedupeArtifacts`)  — a stacking judge over active artifact PAIRS that
 *     RETIRES (→ `retired`) the weaker member of any pair whose lifts do not stack
 *     (they teach the agent the same thing, so keeping both is wasted surface).
 *
 * The ONLY per-surface code is the thin `CandidateGenerator` adapter; everything
 * else — measure, gate, compose, drift-watch, dedupe — is shared. The reference
 * generator, `skillGenerator`, DISTILLS a new skill from traces (the create step
 * an optimizer can't do) then refines it — the answer to "an empty profile has no
 * skills".
 *
 * INVARIANT: an artifact is `active` IFF it carries a measured held-back lift
 * (`registry.liftOf` returns a number). `composeProfile` folds in only the active
 * set — a `candidate`/`decayed`/`retired` artifact is invisible to compose.
 */

export { applyArtifact, applyArtifacts } from './apply'
export { type ComposeProfileOptions, composeProfile } from './compose'
export {
  type ConnectionArtifactOptions,
  connectionArtifact,
  connectionMcpServer,
  type ExternalMcpGrant,
  validateExternalMcpGrant,
} from './connection'
export {
  type DedupeOptions,
  type DedupeResult,
  dedupeArtifacts,
  type PairStackCheck,
} from './dedupe'
export {
  type DriftCheck,
  type DriftWatchOptions,
  type DriftWatchResult,
  driftWatch,
} from './drift-watch'
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
  type AgentMemorySpec,
  CURATED_MEMORY_BLOCK_END,
  CURATED_MEMORY_BLOCK_START,
  lessonsFromCuratedSurface,
  type MemoryArtifactOptions,
  type MemoryGeneratorOptions,
  type MemoryItem,
  type MemoryMcpServerOptions,
  memoryArtifactFromCuratedSurface,
  memoryArtifactFromLessons,
  memoryGenerator,
  memoryMcpServer,
  memoryOfProfile,
  type ProfileWithMemory,
  profileMemoryMetadataKey,
  readMemoryItemsFile,
  validateMemorySpec,
  writeMemoryStore,
} from './memory'
export {
  type AuthorDiverseSeeds,
  gepaRefine,
  type ProductionPromptGeneratorOptions,
  type PromptDraft,
  type PromptGeneratorOptions,
  productionPromptGenerator,
  promptGenerator,
  type RefinePrompt,
  routerSeedAuthor,
} from './prompt-generator'
export {
  type AutopsyOptions,
  authorDiverseSweSeeds,
  autopsySweFailures,
  FAILURE_MECHANISMS,
  type FailureMechanism,
  type ReflectiveSweOptions,
  reflectiveSweRefine,
  type SweFailureRow,
} from './reflective-swe'
export {
  type ArtifactQuery,
  ArtifactRegistry,
  createArtifactRegistry,
  lifecycleReasonKey,
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
export {
  type SweEvalRunnerOptions,
  type SweEvalTask,
  type SweEvalTaskResult,
  sweEvalRunner,
} from './swe-eval-runner'
export { type WorktreeBuildOptions, worktreeBuildCandidate } from './tool-build'
export {
  type BuildableGeneratorOptions,
  type BuildableKind,
  type BuildCandidate,
  type BuiltCandidate,
  buildableGenerator,
} from './tool-generator'
export type {
  ArtifactInput,
  ArtifactKind,
  ArtifactPayloads,
  ArtifactStatus,
  ProfileArtifact,
} from './types'
