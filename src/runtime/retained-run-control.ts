import {
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type { AgentSession } from '@tangle-network/agent-interface/environment-provider'
import {
  exactContinuedControlRef,
  freezeControlRef,
  RetainedRunProviderContractError,
  sameControlCoordinates,
} from './retained-run-binding'

/**
 * The control reference one retained handle currently believes in, with every reference it
 * has seen. A provider may expose the previous reference while a terminal read catches up;
 * remembering what was seen keeps that read from moving control backwards.
 */
export class RetainedRunControl {
  private active: AgentExactRunControlRef
  private readonly known: Set<string>

  constructor(
    readonly session: AgentSession,
    initial: AgentExactRunControlRef,
  ) {
    this.active = freezeControlRef(initial)
    this.known = new Set([canonicalCandidateDigest(this.active)])
  }

  get current(): AgentExactRunControlRef {
    return this.active
  }

  /** Make an already-validated continuation reference the current one. */
  adopt(next: AgentExactRunControlRef): AgentExactRunControlRef {
    this.active = freezeControlRef(next)
    this.known.add(canonicalCandidateDigest(this.active))
    return this.active
  }

  assertContinuationIsCurrent(
    continuationSource: AgentExactRunControlRef,
    nextControlRef: AgentExactRunControlRef,
  ): void {
    if (
      !sameControlCoordinates(this.active, continuationSource) &&
      !sameControlCoordinates(this.active, nextControlRef)
    ) {
      throw new Error(
        'provider advanced the retained session while another native continuation was pending',
      )
    }
  }

  /** Read the provider's current reference and advance to it when it is a valid continuation. */
  sync(): void {
    let candidate: unknown
    try {
      candidate = this.session.controlRef
    } catch (error) {
      throw new RetainedRunProviderContractError(
        'provider retained session control reference read failed',
        { code: 'RETAINED_CONTROL_REF_READ_FAILED', cause: error },
      )
    }
    if (candidate === undefined) return
    const parsed = AgentExactRunControlRefSchema.safeParse(candidate)
    if (!parsed.success) {
      throw new RetainedRunProviderContractError(
        'provider retained session returned an invalid current control reference',
        { code: 'RETAINED_CONTROL_REF_INVALID', cause: parsed.error },
      )
    }
    const candidateDigest = canonicalCandidateDigest(parsed.data)
    if (sameControlCoordinates(parsed.data, this.active) || this.known.has(candidateDigest)) return
    try {
      this.active = freezeControlRef(exactContinuedControlRef(parsed.data, this.active))
      this.known.add(candidateDigest)
    } catch (error) {
      throw new RetainedRunProviderContractError(
        'provider retained session advanced to an invalid control reference',
        { code: 'RETAINED_CONTROL_REF_ADVANCE_INVALID', cause: error },
      )
    }
  }
}
