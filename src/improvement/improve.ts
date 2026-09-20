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
import { agentProfileSchema } from '@tangle-network/agent-interface'
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
import type { ReadonlyAgentProfile } from './profile-types'
import {
  type ImproveTrainingOptions,
  type ImproveTrainingResult,
  runProfileTraining,
} from './training'

// The owning modules are the single list of these names; re-exporting them by
// hand made every new option type a three-file edit.
export type * from './improve-types'
export type * from './training'
export { createCommandProfileTrainer } from './training'

/** Train and serve a checkpoint without implying that it improved held-out quality. */
export function improve(
  profile: ReadonlyAgentProfile,
  opts: ImproveTrainingOptions,
): Promise<ImproveTrainingResult>
/**
 * Optimize one exact profile surface with a complete method.
 */
export function improve<TScenario extends Scenario, TArtifact>(
  profile: ReadonlyAgentProfile,
  opts: ImproveMethodOptions<TScenario, TArtifact>,
): Promise<ImproveMethodResult>
/**
 * Optimize repository code through Runtime's isolated worktree path.
 */
export function improve<TScenario extends Scenario, TArtifact>(
  opts: ImproveCodeRunOptions<TScenario, TArtifact>,
): Promise<ImproveCodeResult<TScenario, TArtifact>>
export async function improve<TScenario extends Scenario, TArtifact>(
  profileOrCode: ReadonlyAgentProfile | ImproveCodeRunOptions<TScenario, TArtifact>,
  opts?: ImproveMethodOptions<TScenario, TArtifact> | ImproveTrainingOptions,
): Promise<ImproveResult<TScenario, TArtifact> | ImproveTrainingResult> {
  if (opts === undefined) {
    const code = profileOrCode as ImproveCodeRunOptions<TScenario, TArtifact>
    if (code?.surface !== 'code') {
      throw new ConfigError("improve(): the one-argument form requires { surface: 'code', ... }")
    }
    return runCodeImprovement(code)
  }
  if (opts === null || typeof opts !== 'object') {
    throw new ConfigError('improve(): options must be an object')
  }
  if ('mode' in opts) {
    if (opts.mode !== 'training') throw new ConfigError('improve(): unsupported mode')
    return runProfileTraining(profileOrCode as ReadonlyAgentProfile, opts)
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
  return runMethodImprovement(immutableCandidateValue(parsedProfile.data), opts)
}
