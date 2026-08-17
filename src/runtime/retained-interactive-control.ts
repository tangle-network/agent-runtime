import type { AgentInteractiveSessionControlClaim } from '@tangle-network/agent-interface'
import {
  agentInteractiveSessionControlClaimRequestDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type { RetainedInteractiveRunHandle } from './retained-interactive-types'
import { abortError } from './retained-run-binding'

const MAX_GENERATION_CONFLICTS = 8

/** Input for acquiring write authority over one exact interactive process. @stable */
export interface ClaimRetainedInteractiveControlOptions {
  readonly handle: RetainedInteractiveRunHandle
  readonly holderId: string
  /** Last known provider generation. Zero discovers the current generation safely. */
  readonly expectedGeneration?: number
  readonly signal?: AbortSignal
}

/**
 * Acquire provider-issued write authority without reading authority from status.
 *
 * A new coordinator starts at generation zero. If another claim already exists,
 * the provider returns its public generation and this helper retries one new
 * compare-and-swap operation. Every generation has a deterministic operation
 * identifier, so retrying after an ambiguous response cannot create two claims.
 * @stable
 */
export async function claimRetainedInteractiveControl(
  options: ClaimRetainedInteractiveControlOptions,
): Promise<AgentInteractiveSessionControlClaim> {
  const expected = options.expectedGeneration ?? 0
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new Error('interactive control expectedGeneration must be a non-negative integer')
  }

  let generation = expected
  for (let conflict = 0; conflict <= MAX_GENERATION_CONFLICTS; conflict += 1) {
    if (options.signal?.aborted) throw abortError(options.signal.reason)
    const material = {
      operationId: controlClaimOperationId(options.handle, options.holderId, generation),
      ref: options.handle.ref,
      holderId: options.holderId,
      expectedGeneration: generation,
    }
    const acknowledgement = await options.handle.claimControl(
      {
        ...material,
        requestDigest: agentInteractiveSessionControlClaimRequestDigest(material),
      },
      options.signal === undefined ? undefined : { signal: options.signal },
    )
    if (acknowledgement.status === 'accepted' || acknowledgement.status === 'replayed') {
      const control = acknowledgement.control
      if (control === undefined) {
        throw new Error('provider accepted interactive control without returning its claim')
      }
      if (Date.parse(control.expiresAt) <= Date.now()) {
        throw new Error('provider returned an expired interactive control claim')
      }
      return control
    }
    if (
      acknowledgement.status !== 'conflict' ||
      acknowledgement.conflictReason !== 'generation_mismatch'
    ) {
      throw new Error(
        acknowledgement.status === 'unknown'
          ? 'interactive control claim outcome is unknown; retry the same acquisition'
          : 'interactive control claim operation conflicts with different request material',
      )
    }
    const current = acknowledgement.currentGeneration
    if (current === undefined || current <= generation) {
      throw new Error('provider returned a non-advancing interactive control generation')
    }
    generation = current
  }
  throw new Error('interactive control changed too often to acquire safely')
}

function controlClaimOperationId(
  handle: RetainedInteractiveRunHandle,
  holderId: string,
  expectedGeneration: number,
): string {
  const digest = canonicalCandidateDigest({
    kind: 'retained-interactive-control-claim.v1',
    ref: handle.ref,
    holderId,
    expectedGeneration,
  })
  return `interactive-claim-${digest.slice('sha256:'.length, 'sha256:'.length + 40)}`
}
