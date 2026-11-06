import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { environmentReader, type SpawnResourceReader } from '../../mcp/tools/spawn-resource-paths'
import { owners } from './retained-owner-state'
import type { Scope } from './types'

/** Read spawn resources from the owner's latest environment. Path rules live in `environmentReader`. A missing admission or provider is a refusal, not a read from nowhere. */
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
