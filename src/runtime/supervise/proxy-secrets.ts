import { type AgentProfile, isProxySecretBindingAttenuation } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { ExecutorConfig } from './runtime'

/** Shared create defaults would grant undeclared authority to every descendant. */
export function assertNoInheritedProxySecrets(backend: ExecutorConfig | undefined): void {
  if (backend?.backend !== 'provider') return
  if (
    backend.defaults?.proxySecrets?.length ||
    backend.placements?.some((placement) => placement.create.proxySecrets?.length)
  ) {
    throw new ValidationError(
      'supervise: proxySecrets belong on profile.proxySecrets, not provider defaults or placements',
    )
  }
}

/** Early defense only. The provider must authenticate lineage and install fresh child grants. */
export function assertProxySecretDescendant(
  parent: AgentProfile,
  child: AgentProfile,
  hasAuthorization: boolean,
): void {
  if (!child.proxySecrets?.length) return
  if (!hasAuthorization) {
    throw new ValidationError('supervise: spawned proxySecrets require authorizeSpawn')
  }
  if (child.proxySecrets.some((binding) =>
    !parent.proxySecrets?.some((allowed) => isProxySecretBindingAttenuation(allowed, binding)))) {
    throw new ValidationError('supervise: spawned proxySecrets exceed parent declarations')
  }
}
