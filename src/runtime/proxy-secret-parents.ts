import {
  canonicalCandidateDigest,
  isProxySecretParentsTotal,
  type ProxySecretBinding,
  type ProxySecretParents,
  ProxySecretParentsSchema,
} from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../errors'

export type { ProxySecretParents } from '@tangle-network/agent-interface'

/** Supplied by the trusted parent scope after its actual allocation is known. */
export const proxySecretParentsSeamKey = 'runtime.proxySecretParents'

export function captureProxySecretParents(value: unknown): ProxySecretParents {
  const parsed = ProxySecretParentsSchema.safeParse(value)
  if (!parsed.success) {
    throw new ValidationError('Runtime proxySecretParents must be an explicit canonical map')
  }
  return Object.freeze(parsed.data)
}

/** The canonical owner validates the final authored and host-selected binding selection. */
export function assertProxySecretParentKeys(
  parents: ProxySecretParents,
  bindings: readonly ProxySecretBinding[],
): void {
  if (!isProxySecretParentsTotal(bindings, parents)) {
    throw new ValidationError(
      'Runtime proxySecretParents must match the complete proxy-secret selection',
    )
  }
}

/** Missing pins are never interpreted as root authority. */
export function prepareProxySecretParents(
  value: unknown,
  bindings: readonly ProxySecretBinding[] | undefined,
  declaredValue?: unknown,
): ProxySecretParents | undefined {
  if (
    value === undefined &&
    declaredValue === undefined &&
    (bindings === undefined || bindings.length === 0)
  )
    return undefined
  const parents = captureProxySecretParents(value === undefined ? declaredValue : value)
  if (
    value !== undefined &&
    declaredValue !== undefined &&
    canonicalCandidateDigest(parents) !==
      canonicalCandidateDigest(captureProxySecretParents(declaredValue))
  ) {
    throw new ValidationError(
      'Runtime proxySecretParents conflicts with the canonical create request',
    )
  }
  assertProxySecretParentKeys(parents, bindings ?? [])
  return parents
}

/** A typed request is effective only when the provider confirms the exact admitted pins. */
export function assertProxySecretParentReadback(
  environment: Pick<AgentEnvironment, 'proxySecretReceipt' | 'proxySecretParents'>,
  expected: ProxySecretParents | undefined,
  adoptPersisted = false,
): ProxySecretParents | undefined {
  const bindings =
    environment.proxySecretReceipt?.bindings.map(({ envName, secretRef, grant }) => ({
      envName,
      secretRef,
      ...grant.scope,
      presentation: grant.presentation,
      placeholderFormat: grant.placeholderFormat,
    })) ?? []
  const actualValue = environment.proxySecretParents
  // An omitted update adopts verified persisted pins; it never invents root authority.
  if (actualValue === undefined && bindings.length === 0) {
    return prepareProxySecretParents(expected, undefined)
  }
  const actual = ProxySecretParentsSchema.safeParse(actualValue)
  if (
    !actual.success ||
    !isProxySecretParentsTotal(bindings, actual.data) ||
    (expected === undefined && !adoptPersisted && bindings.length > 0)
  ) {
    throw new ValidationError('provider proxySecretParents readback differs from admitted pins')
  }
  if (expected !== undefined) {
    const parents = prepareProxySecretParents(expected, bindings)
    if (canonicalCandidateDigest(actual.data) !== canonicalCandidateDigest(parents)) {
      throw new ValidationError('provider proxySecretParents readback differs from admitted pins')
    }
  }
  return captureProxySecretParents(actual.data)
}
