/**
 * `improve` runs one complete optimization method against an exact profile
 * surface. Runtime extracts and materializes the profile value; agent-eval owns
 * optimization, disjoint data partitions, final-test scoring, and uncertainty.
 *
 * Code owns isolated git worktrees. Training owns checkpoint execution and
 * serving receipts; unlike optimization, it does not make a promotion decision.
 *
 * @stable
 */

import type { Scenario } from '@tangle-network/agent-eval/contract'
import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import { runCodeImprovement } from './code-execution'
import type {
  ImproveCodeResult,
  ImproveCodeRunOptions,
  ImproveMethodOptions,
  ImproveMethodResult,
  ImproveResult,
} from './improve-types'
import { runMethodImprovement } from './method-execution'
import {
  type ImproveTrainingOptions,
  type ImproveTrainingResult,
  runProfileTraining,
} from './training'

export type {
  ImproveCandidateValidationInput,
  ImproveCandidateValidator,
  ImproveCodeBaseOptions,
  ImproveCodeOptions,
  ImproveCodeResult,
  ImproveCodeRunOptions,
  ImproveCost,
  ImproveCustomCodeGeneratorOptions,
  ImproveLineage,
  ImproveMethodContext,
  ImproveMethodFactory,
  ImproveMethodLineage,
  ImproveMethodOptions,
  ImproveMethodResult,
  ImproveMethodSource,
  ImprovementCandidate,
  ImprovementCodeCandidate,
  ImprovementMaterializedProfilePopulationCandidate,
  ImprovementProfileCandidate,
  ImprovementProfileCandidatePopulation,
  ImprovementProfileCandidatePopulationAvailable,
  ImprovementProfileCandidatePopulationUnavailable,
  ImprovementProfilePopulationArtifactSource,
  ImprovementProfilePopulationCandidate,
  ImprovementProfilePopulationCandidateSource,
  ImprovementProfilePopulationLineage,
  ImprovementProfilePopulationLineageNode,
  ImprovementProfilePopulationObservationSource,
  ImprovementRefusedProfilePopulationCandidate,
  ImproveOptimizationRunOptions,
  ImproveOptions,
  ImproveProfileAgent,
  ImproveProfileComponents,
  ImproveProfileSurface,
  ImproveResult,
  ImproveRuntimeCodeGeneratorOptions,
  ImproveScenarioPartitions,
  ImproveSkillsOptions,
  ImproveSurface,
} from './improve-types'
export type {
  CheckpointServingPort,
  ControlledTrainingCommand,
  ImproveTrainingOptions,
  ImproveTrainingResult,
  ProfileTrainer,
  ProfileTrainerRequest,
  TrainingBoundaryResult,
  TrainingDatasetDocument,
} from './training'
export { createCommandProfileTrainer } from './training'

/** Train and serve a checkpoint without implying that it improved held-out quality. */
export function improve(
  profile: AgentProfile,
  opts: ImproveTrainingOptions,
): Promise<ImproveTrainingResult>
/**
 * Optimize one exact profile surface with a complete method.
 */
export function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveMethodOptions<TScenario, TArtifact>,
): Promise<ImproveMethodResult>
/**
 * Optimize repository code through Runtime's isolated worktree path.
 */
export function improve<TScenario extends Scenario, TArtifact>(
  opts: ImproveCodeRunOptions<TScenario, TArtifact>,
): Promise<ImproveCodeResult<TScenario, TArtifact>>
export async function improve<TScenario extends Scenario, TArtifact>(
  profileOrCode: AgentProfile | ImproveCodeRunOptions<TScenario, TArtifact>,
  opts?: ImproveMethodOptions<TScenario, TArtifact> | ImproveTrainingOptions,
): Promise<ImproveResult<TScenario, TArtifact> | ImproveTrainingResult> {
  if (opts === undefined) {
    const code = profileOrCode as ImproveCodeRunOptions<TScenario, TArtifact>
    if (code?.surface !== 'code') {
      throw new ConfigError("improve(): the one-argument form requires { surface: 'code', ... }")
    }
    return runCodeImprovement(code)
  }
  if ('mode' in opts && opts.mode === 'training') {
    return runProfileTraining(profileOrCode as AgentProfile, opts)
  }
  if ((opts as { surface?: string }).surface === 'code') {
    throw new ConfigError("improve(): code takes one argument: improve({ surface: 'code', ... })")
  }
  const parsedProfile = agentProfileSchema.safeParse(profileOrCode)
  if (!parsedProfile.success) {
    throw new ConfigError(
      `improve(): input is not a valid AgentProfile: ${parsedProfile.error.message}`,
    )
  }
  return runMethodImprovement(
    immutableCandidateValue(parsedProfile.data),
    opts as ImproveMethodOptions<TScenario, TArtifact>,
  )
}
