/**
 * `improve` runs one complete optimization method against an exact profile
 * surface. Runtime extracts and materializes the profile value; agent-eval owns
 * optimization, disjoint data partitions, final-test scoring, and uncertainty.
 *
 * Code is the sole exception. It uses Runtime's isolated git worktrees because
 * checkout ownership and cleanup cannot cross a generic optimizer boundary.
 *
 * @experimental
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
  ImproveOptions,
  ImproveResult,
} from './improve-types'
import { runMethodImprovement } from './method-execution'

export type {
  ImproveCodeOptions,
  ImproveCodeResult,
  ImproveCodeRunOptions,
  ImproveCost,
  ImproveLineage,
  ImproveMethodContext,
  ImproveMethodFactory,
  ImproveMethodOptions,
  ImproveMethodResult,
  ImproveMethodSource,
  ImprovementCandidate,
  ImprovementCodeCandidate,
  ImprovementProfileCandidate,
  ImproveOptimizationRunOptions,
  ImproveOptions,
  ImproveProfileAgent,
  ImproveProfileComponents,
  ImproveProfileSurface,
  ImproveResult,
  ImproveSkillsOptions,
  ImproveSurface,
} from './improve-types'

/**
 * Optimize one exact profile surface with a complete method, or optimize code
 * through Runtime's isolated worktree path. The input profile is never changed.
 */
export function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveMethodOptions<TScenario, TArtifact>,
): Promise<ImproveMethodResult>
export function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveCodeRunOptions<TScenario, TArtifact>,
): Promise<ImproveCodeResult<TScenario, TArtifact>>
export function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveOptions<TScenario, TArtifact>,
): Promise<ImproveResult<TScenario, TArtifact>>
export async function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveOptions<TScenario, TArtifact>,
): Promise<ImproveResult<TScenario, TArtifact>> {
  const parsedProfile = agentProfileSchema.safeParse(profile)
  if (!parsedProfile.success) {
    throw new ConfigError(
      `improve(): input is not a valid AgentProfile: ${parsedProfile.error.message}`,
    )
  }
  if (opts.surface === 'code') {
    return runCodeImprovement(opts)
  }
  return runMethodImprovement(immutableCandidateValue(parsedProfile.data), opts)
}
