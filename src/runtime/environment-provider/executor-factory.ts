import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { selectProviderPlacement } from '../provider-placement'
import { detachedSnapshot } from '../supervise/snapshot'
import type { ExecutorFactory } from '../supervise/types'
import type { ProviderExecutorOptions } from './contracts'
import { createProviderExecutor } from './executor'
import { ValidationError } from './validation-error'

/** Adapt an environment provider into an `ExecutorFactory` for `createExecutor`.
 *
 * `createExecutor({ backend: 'provider', provider })` is the composition most callers want; it
 * builds this factory and injects the seam. See `examples/provider-executor/`.
 *
 * Still `@experimental`: the entry point that consumes it, `createExecutor`, carries no stability
 * tag and is therefore experimental by default, so a stable promise here would be reachable only
 * through an experimental symbol.
 *
 * @experimental */
export function providerAsExecutor(
  provider: AgentEnvironmentProvider,
  options: ProviderExecutorOptions = {},
): ExecutorFactory<unknown> {
  const captured =
    options.placements === undefined
      ? options
      : {
          ...options,
          placements: detachedSnapshot(options.placements, 'provider placements'),
          defaults: detachedSnapshot(options.defaults, 'provider placement defaults'),
        }
  return (spec, ctx) => {
    const profile =
      captured.placements === undefined
        ? spec.profile
        : detachedSnapshot(spec.profile, 'provider placement profile')
    const selected = selectProviderPlacement(profile, captured)
    return createProviderExecutor(provider, profile, ctx, selected.options, selected.identity)
  }
}

/**
 * Run a provider under a placement Runtime chose for the whole execution, such as a shared box.
 * The identity lands in the execution's materialization plan and binding, exactly where a
 * declared {@link ProviderPlacement} lands, so a record says which placement served it.
 * @internal
 */
export function placedProviderExecutor(
  provider: AgentEnvironmentProvider,
  options: ProviderExecutorOptions,
  identity: { id: string; digest: string },
): ExecutorFactory<unknown> {
  if (options.placements !== undefined) {
    throw new ValidationError('placedProviderExecutor: placements select within one provider')
  }
  return (spec, ctx) => createProviderExecutor(provider, spec.profile, ctx, options, identity)
}
