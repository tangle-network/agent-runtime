import type { ProxySecretBinding } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'

/** Runtime-owned journal data, never a replacement for the canonical provider wire contract. */
export type ProxySecretParents = Readonly<Record<string, string | null>>

/** Supplied by the trusted parent scope after its actual allocation is known. */
export const proxySecretParentsSeamKey = 'runtime.proxySecretParents'

export function captureProxySecretParents(value: unknown): ProxySecretParents {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Runtime proxySecretParents must be an explicit total map')
  }
  const captured: Record<string, string | null> = {}
  for (const [envName, parent] of Object.entries(value)) {
    if (parent !== null && (typeof parent !== 'string' || parent.trim().length === 0 || parent !== parent.trim())) {
      throw new ValidationError('Runtime proxySecretParents contains an invalid parent reference')
    }
    Object.defineProperty(captured, envName, { value: parent, enumerable: true })
  }
  return Object.freeze(captured)
}

/** The final authored and host-selected bindings must each have exactly one explicit pin. */
export function assertProxySecretParentKeys(
  parents: ProxySecretParents,
  bindings: readonly Pick<ProxySecretBinding, 'envName'>[],
): void {
  const expected = [...new Set(bindings.map(binding => binding.envName))].sort()
  const actual = Object.keys(parents).sort()
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new ValidationError('Runtime proxySecretParents must match the complete proxy-secret selection')
  }
}

/** Missing pins are never interpreted as root authority. */
export function prepareProxySecretParents(
  value: unknown,
  bindings: readonly Pick<ProxySecretBinding, 'envName'>[] | undefined,
): ProxySecretParents | undefined {
  if (value === undefined && bindings === undefined) return undefined
  const parents = captureProxySecretParents(value)
  assertProxySecretParentKeys(parents, bindings ?? [])
  return parents
}

/** Remove this refusal only when the canonical create/get port carries these exact pins. */
export function assertProxySecretParentWireAvailable(
  parents: ProxySecretParents | undefined,
): void {
  if (parents !== undefined && Object.keys(parents).length > 0) {
    throw new ValidationError('proxy-secret-parent-wire-unavailable: canonical provider support is required')
  }
}
