import type { Sha256Digest } from '@tangle-network/agent-interface'
import { ConfigError } from '../errors'
import type { ImproveCandidateValidationInput, ImproveCandidateValidator } from './improve-types'
import type { ReadonlyAgentProfile } from './profile-types'

/** Validate the callback itself before any optimizer, trainer, or candidate work starts. */
export function assertCandidateValidator(
  validator: unknown,
): asserts validator is ImproveCandidateValidator | undefined {
  if (validator !== undefined && typeof validator !== 'function') {
    throw new ConfigError('validateCandidate must be a function when present')
  }
}

/** A validator accepts synchronously by returning void, or rejects by throwing. */
export function validateProfileCandidate(
  validator: ImproveCandidateValidator | undefined,
  input: ImproveCandidateValidationInput,
): void {
  assertCandidateValidator(validator)
  const result: unknown = validator?.(Object.freeze(input))
  if (result !== undefined) {
    // Observe a rejected async callback without treating its eventual result as admission.
    void Promise.resolve(result).catch(() => {})
    throw new ConfigError('candidate validators must return void synchronously or throw')
  }
}

/**
 * Refuse exact held-out content digests already declared in this profile's training lineage.
 * Both training and trainer-visible validation rows are exposure. This is an exact
 * provenance check, not fuzzy decontamination or proof that undeclared training was fresh.
 */
export function assertProfileTrainingIsHeldOut(
  profile: ReadonlyAgentProfile,
  heldOutDigests: ReadonlySet<Sha256Digest>,
): void {
  const training = profile.metadata?.training
  if (!training) return
  for (const receipt of [training.receipt, ...training.ancestors]) {
    if (receipt.dataset.tasks.some((task) => heldOutDigests.has(task.contentDigest))) {
      // Do not disclose held-out task identities or payloads to an optimizer via errors.
      throw new ConfigError('known training exposure overlaps held-out evaluation')
    }
  }
}
