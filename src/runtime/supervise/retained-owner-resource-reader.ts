import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { environmentReader, type SpawnResourceReader } from '../../mcp/tools/spawn-resource-paths'
import { owners } from './retained-owner-state'
import type { Scope } from './types'

/**
 * The owner's environment as a source of by-path spawn resources.
 *
 * Built once per scope, before the environment exists: the coordination tools are created ahead
 * of the owner's first turn, and the environment is admitted during it. So the reader resolves
 * its target on every read — the latest environment admission on this node, reconstructed through
 * the bound provider the same way cleanup reconstructs it, with the same identity check. A manager
 * that has not yet been admitted, or whose provider was never bound, gets a refusal that names the
 * missing piece rather than a read from nowhere.
 *
 * The environment's `read()` serves the sandbox's own workspace; containment against that
 * workspace is the provider's. The relative-path and `..` rules are the reader's, in
 * `environmentReader`, so a manager is refused for the rule it broke.
 */
export function scopeRetainedOwnerResourceReader(
  scope: Scope<unknown>,
): SpawnResourceReader | undefined {
  const state = owners.get(scope)
  if (state === undefined) return undefined
  const latestEnvironmentId = (): string | undefined =>
    state.liveEnvironmentId?.() ??
    [...state.admissions]
      .reverse()
      .flatMap((admission) =>
        admission.phase === 'environment' ? [admission.environmentId] : [],
      )[0]
  return {
    get describe() {
      return `environment ${latestEnvironmentId() ?? '<not yet admitted>'}`
    },
    async read(path) {
      const provider = state.provider
      if (provider === undefined) {
        return { ok: false, reason: 'the manager’s environment provider is not bound yet' }
      }
      const environmentId = latestEnvironmentId()
      if (environmentId === undefined) {
        return { ok: false, reason: 'the manager’s environment has not been admitted yet' }
      }
      if (!provider.get) {
        return {
          ok: false,
          reason: `provider ${provider.name} cannot reconstruct the manager’s environment`,
        }
      }
      let environment: Awaited<ReturnType<NonNullable<AgentEnvironmentProvider['get']>>>
      try {
        environment = await provider.get(environmentId)
      } catch (error) {
        return {
          ok: false,
          reason: `environment ${environmentId}: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      if (environment === null) {
        return { ok: false, reason: `environment ${environmentId} is gone` }
      }
      if (environment.id !== environmentId || environment.provider !== provider.name) {
        return { ok: false, reason: `provider returned another environment for ${environmentId}` }
      }
      if (typeof environment.read !== 'function') {
        return {
          ok: false,
          reason: `environment ${environmentId} does not expose read; its provider cannot serve a resource by path`,
        }
      }
      const read = environment.read.bind(environment)
      return environmentReader({ id: environment.id, read }).read(path)
    },
  }
}
