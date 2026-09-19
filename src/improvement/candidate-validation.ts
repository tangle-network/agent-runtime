import { ConfigError } from '../errors'
import type { ImproveCandidateValidationInput, ImproveCandidateValidator } from './improve-types'

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
