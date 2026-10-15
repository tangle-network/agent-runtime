import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentGetOptions,
} from '@tangle-network/agent-interface/environment-provider'
import {
  ProxySecretCapabilitiesSchema,
  ProxySecretReceiptSchema,
  isProxySecretScopeAttenuation,
  proxySecretPresentationsEqual,
} from '@tangle-network/agent-interface/environment-provider'

/** Capability omission refuses declared custody before provider allocation or rebinding. */
export function assertProxySecretCapabilities(
  capabilities: AgentEnvironmentCapabilities,
  bindings: AgentEnvironmentGetOptions['proxySecrets'],
): void {
  if (bindings === undefined) return
  const parsed = ProxySecretCapabilitiesSchema.safeParse(capabilities.create?.proxySecrets)
  if (!parsed.success || bindings.some((binding) =>
    !parsed.data.presentations.includes(binding.presentation.type) ||
    !parsed.data.placeholderFormats.includes(binding.placeholderFormat ?? 'opaque'))) {
    throw new Error('provider does not advertise the requested proxy-secret enforcement')
  }
}

/** Omission preserves grants; it never makes stale custody safe for another native dispatch. */
export function assertProxySecretReceiptLive(environment: AgentEnvironment): void {
  if (environment.proxySecretReceipt === undefined) return
  const receipt = ProxySecretReceiptSchema.safeParse(environment.proxySecretReceipt)
  if (!receipt.success || receipt.data.status === 'proxy-installed' || receipt.data.sandboxId !== environment.id ||
      receipt.data.bindings.some(({ grant }) =>
        Date.parse(grant.issuedAt) > Date.now() || Date.parse(grant.expiresAt) <= Date.now())) {
    throw new Error('provider proxy-secret custody is stale or unconfirmed; rebind before native dispatch')
  }
}

/** Release only an allocation this call is proven to own; preserve replayed and uncertain boxes. */
export async function rejectUnmaterializedProviderEnvironment(
  environment: AgentEnvironment,
  cause: unknown,
  preserve = false,
): Promise<never> {
  if (preserve || environment.creation !== 'created') throw cause
  try {
    if (!environment.destroy) throw new Error('provider created an environment without a destroy operation')
    await environment.destroy()
  } catch (cleanupError) {
    throw new AggregateError([cause, cleanupError], 'provider materialization failed and its unused allocation could not be destroyed')
  }
  throw cause
}

/** Reject incomplete, stale or differently bound materialization before any native dispatch. */
export function assertProxySecretInstallation(
  environment: AgentEnvironment,
  bindings: AgentEnvironmentGetOptions['proxySecrets'],
  id = environment.id,
  operation: 'create' | 'rebind' = 'create',
): void {
  if (bindings === undefined) return
  const receipt = ProxySecretReceiptSchema.safeParse(environment.proxySecretReceipt)
  if (!receipt.success || environment.id !== id || receipt.data.sandboxId !== id ||
      (bindings.length === 0
        ? receipt.data.status !== 'revoked' && (operation === 'rebind' || receipt.data.status !== 'installed')
        : receipt.data.status !== 'installed') ||
      receipt.data.bindings.length !== bindings.length ||
      bindings.some((binding) => {
        const entry = receipt.data.bindings.find((entry) => entry.envName === binding.envName)
        const installed = entry?.grant
        const scope = { hosts: binding.hosts, methods: binding.methods, paths: binding.paths }
        return !installed || entry?.secretRef.key !== binding.secretRef.key ||
          installed.sandboxId !== id ||
          !isProxySecretScopeAttenuation(scope, installed.scope) ||
          !proxySecretPresentationsEqual(binding.presentation, installed.presentation) ||
          installed.placeholderFormat !== (binding.placeholderFormat ?? 'opaque') ||
          (binding.ttlSeconds !== undefined &&
            Date.parse(installed.expiresAt) - Date.parse(installed.issuedAt) > binding.ttlSeconds * 1000) ||
          Date.parse(installed.issuedAt) > Date.now() ||
          Date.parse(installed.expiresAt) <= Date.now()
      })) {
    throw new Error('retained provider did not confirm proxy-secret installation for this environment')
  }
}

