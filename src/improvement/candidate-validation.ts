import { redact } from '@tangle-network/agent-eval/traces'
import { type Sha256Digest, sha256DigestSchema } from '@tangle-network/agent-interface'
import { ConfigError } from '../errors'
import type { ImproveCandidateValidationInput, ImproveCandidateValidator } from './improve-types'
import type { ReadonlyAgentProfile } from './profile-types'

/** One spelling of the execution-identity rule for optimization, training, and the harness. */
export function parseExecutionRef(value: unknown, label: string): Sha256Digest {
  const parsed = sha256DigestSchema.safeParse(value)
  if (!parsed.success) {
    throw new ConfigError(`${label}: executionRef must be a lowercase sha256:<64 hex> digest`)
  }
  return parsed.data
}

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

/**
 * JSON paths of credential and private values in candidate content, found by
 * the redaction core, which names each value it would change. A candidate that
 * leaves Runtime (an external optimizer, a search ledger) is refused on any.
 */
export function privateValuePaths(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) =>
        redact(value).report.findings.map((finding) => jsonPathOf(finding.path)),
      ),
    ),
  ]
}

/** `/remote/url` or `/tools/0/env` as `$.remote.url` or `$.tools[0].env`. */
function jsonPathOf(pointer: string): string {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce(
      (path, segment) => (/^\d+$/.test(segment) ? `${path}[${segment}]` : `${path}.${segment}`),
      '$',
    )
}
