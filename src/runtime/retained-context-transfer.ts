import {
  type ContextTransferReceipt,
  ContextTransferReceiptSchema,
  type ContextTransferRequest,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  contextTransferReceiptMatches,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
} from '@tangle-network/agent-interface/environment-provider'
import type { RetainedRunStartMaterial } from './retained-run-types'
import { detachedSnapshot } from './supervise/snapshot'

/** Validate attachment authority before admission or any provider operation. */
export function retainedContextTransferReceipt(
  options: RetainedRunStartMaterial,
  provider: string,
  request: ContextTransferRequest | undefined,
): ContextTransferReceipt | undefined {
  if (request === undefined) {
    if (options.contextTransferReceipt !== undefined)
      throw new Error('context transfer receipt requires its exact request')
    return undefined
  }
  if (options.contextTransferReceipt === undefined) {
    throw new Error(
      'retained context transfer requires an accepted receipt; it cannot create another environment',
    )
  }
  const receipt = detachedSnapshot(
    ContextTransferReceiptSchema.parse(options.contextTransferReceipt),
    'retained context transfer receipt',
  )
  if (!contextTransferReceiptMatches(request, receipt) || receipt.provider !== provider) {
    throw new Error(
      'retained context transfer receipt does not match its exact request or provider',
    )
  }
  const { environment, turn } = options
  const destination = request.plan.destination
  if (
    request.profile === undefined ||
    typeof environment.profile === 'string' ||
    canonicalAgentProfileDigest(environment.profile) !== destination.profileDigest ||
    (turn.profile !== undefined &&
      canonicalAgentProfileDigest(turn.profile) !== destination.profileDigest)
  ) {
    throw new Error('retained context transfer requires the accepted exact profile')
  }
  if (environment.backend !== undefined && environment.backend !== destination.runner) {
    throw new Error('retained context transfer runner conflicts with the accepted destination')
  }
  // The attaching provider resolves and pins the accepted effective model, including profile
  // defaults, and validates any turn override. Runtime cannot interpret provider-native routes.
  if (
    canonicalCandidateDigest(environment.workspace ?? null) !==
      canonicalCandidateDigest(request.workspace ?? null) ||
    canonicalCandidateDigest(environment.resources ?? null) !==
      canonicalCandidateDigest(request.resources ?? null)
  ) {
    throw new Error('retained context transfer workspace or resources conflict with acceptance')
  }
  if (
    (environment.requestedId !== undefined && environment.requestedId !== receipt.environmentId) ||
    (options.existingEnvironmentId !== undefined &&
      options.existingEnvironmentId !== receipt.environmentId)
  ) {
    throw new Error('retained context transfer targets another environment')
  }
  // These are create-time effects, absent from the accepted transfer request. Attachment cannot
  // apply them retroactively or silently drop them. Public labels and admission metadata are local.
  if (
    environment.runtimeAttachments !== undefined ||
    environment.egress !== undefined ||
    environment.billingOwner !== undefined ||
    Object.keys(environment.env ?? {}).length > 0 ||
    Object.keys(environment.secrets ?? {}).length > 0 ||
    Object.keys(environment.providerOptions ?? {}).length > 0
  ) {
    throw new Error(
      'retained context transfer attachment cannot apply unaccepted create-time options',
    )
  }
  return receipt
}

export function assertRetainedContextTransferIdentity(
  receipt: ContextTransferReceipt | undefined,
  identity: { sessionId: string; executionId: string },
): void {
  if (
    receipt !== undefined &&
    (identity.sessionId !== receipt.sessionId || identity.executionId !== receipt.executionId)
  ) {
    throw new Error('retained context transfer identity conflicts with the accepted receipt')
  }
}

export function assertRetainedContextTransferCapability(
  capabilities: AgentEnvironmentCapabilities,
): void {
  if (capabilities.contextTransfer?.attach !== true) {
    throw new Error('provider cannot attach the accepted context transfer destination')
  }
}

/** The provider get contract performs the authoritative operation lookup once. */
export function assertRetainedContextTransferEnvironment(
  environment: AgentEnvironment,
  request: ContextTransferRequest,
  receipt: ContextTransferReceipt,
): void {
  const actual = ContextTransferReceiptSchema.safeParse(environment.contextTransferReceipt)
  if (
    !actual.success ||
    !contextTransferReceiptMatches(request, actual.data) ||
    environment.id !== receipt.environmentId ||
    environment.provider !== receipt.provider ||
    canonicalCandidateDigest({ ...actual.data, status: 'accepted' }) !==
      canonicalCandidateDigest({ ...receipt, status: 'accepted' })
  ) {
    throw new Error(
      'provider did not reconstruct the authoritative accepted context transfer receipt',
    )
  }
}
