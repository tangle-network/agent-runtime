import type { Scenario } from '@tangle-network/agent-eval/contract'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import { improve } from './improve'
import type {
  ImproveCandidateValidator,
  ImproveMethodOptions,
  ImproveMethodResult,
  ImproveProfileAgent,
} from './improve-types'
import type { ReadonlyAgentProfile } from './profile-types'

export interface CreateProfileImprovementHarnessOptions<
  TScenario extends Scenario,
  TArtifact,
> {
  /** Exact baseline profile. It is parsed, detached, and frozen at construction. */
  profile: AgentProfile
  /**
   * Immutable identity of the bound executor, models, tools, component mapping,
   * and every closure or external setting that can change measured behavior.
   */
  executionRef: Sha256Digest
  /** Execute one exact materialized profile on one scenario. */
  agent: ImproveProfileAgent<TScenario, TArtifact>
  /** Optional validator shared by every run from this harness. */
  validateCandidate?: ImproveCandidateValidator
}

export type ProfileImprovementHarnessRunOptions<
  TScenario extends Scenario,
  TArtifact,
> = Omit<
  ImproveMethodOptions<TScenario, TArtifact>,
  'executionRef' | 'agent' | 'validateCandidate'
> & {
  /** Override the harness-level validator for this run. */
  validateCandidate?: ImproveCandidateValidator
}

/**
 * A small, reusable front door over `improve(profile, options)`.
 *
 * The harness freezes the baseline and binds execution identity once, which
 * removes the two easiest sources of accidental experiment drift when a
 * developer runs several methods, surfaces, or held-out suites against the
 * same agent. It does not replace or narrow `improve`; callers retain every
 * method option and may still use the lower-level API directly.
 */
export interface ProfileImprovementHarness<TScenario extends Scenario, TArtifact> {
  /** Detached immutable baseline actually used by every run. */
  readonly profile: ReadonlyAgentProfile
  /** Canonical digest of the bound baseline profile. */
  readonly profileDigest: Sha256Digest
  /** Exact execution identity bound at construction. */
  readonly executionRef: Sha256Digest
  run(
    options: ProfileImprovementHarnessRunOptions<TScenario, TArtifact>,
  ): Promise<ImproveMethodResult>
}

/**
 * Bind one exact profile and executor into a repeatable self-improvement
 * harness. The returned `run` method remains generic over every existing
 * profile surface, optimization method, split, gate, and budget option.
 */
export function createProfileImprovementHarness<
  TScenario extends Scenario,
  TArtifact,
>(
  options: CreateProfileImprovementHarnessOptions<TScenario, TArtifact>,
): ProfileImprovementHarness<TScenario, TArtifact> {
  const parsed = agentProfileSchema.safeParse(options.profile)
  if (!parsed.success) {
    throw new ConfigError(
      `createProfileImprovementHarness: invalid AgentProfile: ${parsed.error.message}`,
    )
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(options.executionRef)) {
    throw new ConfigError(
      'createProfileImprovementHarness: executionRef must be a lowercase sha256 digest',
    )
  }
  if (typeof options.agent !== 'function') {
    throw new ConfigError('createProfileImprovementHarness: agent must be a function')
  }

  const profile = immutableCandidateValue(parsed.data)
  const executionRef = options.executionRef
  const defaultValidator = options.validateCandidate

  return Object.freeze({
    profile,
    profileDigest: canonicalAgentProfileDigest(profile),
    executionRef,
    run(runOptions) {
      return improve(profile, {
        ...runOptions,
        executionRef,
        agent: options.agent,
        ...(runOptions.validateCandidate !== undefined
          ? { validateCandidate: runOptions.validateCandidate }
          : defaultValidator !== undefined
            ? { validateCandidate: defaultValidator }
            : {}),
      })
    },
  })
}
