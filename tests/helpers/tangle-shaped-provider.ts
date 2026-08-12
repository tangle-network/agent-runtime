import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  AgentSession,
} from '@tangle-network/agent-interface/environment-provider'

/**
 * Provider with agent-provider-tangle's session surface: the session accessor
 * is lazy — it never throws for an unknown id — and it echoes a control
 * reference only when the caller already supplied one as a hint. A bare
 * `session(id)` therefore always yields `controlRef: undefined`, so the
 * provider can never self-identify a session from stored state alone.
 */
export function tangleShapedProvider(inner: AgentEnvironmentProvider): AgentEnvironmentProvider {
  const wrapEnvironment = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session(id, options) {
      let real: AgentSession | undefined
      try {
        real = environment.session?.(id, options)
      } catch {
        real = undefined
      }
      // A lazy client fails on first use, never on access.
      const lazyFailure = (): never => {
        throw new Error(`tangle-shaped session ${id} has no committed state`)
      }
      const base: AgentSession =
        real ??
        ({
          id,
          status: async () => lazyFailure(),
          events: () => lazyFailure(),
          result: async () => lazyFailure(),
          prompt: async () => lazyFailure(),
          cancel: async () => lazyFailure(),
        } as AgentSession)
      return {
        ...base,
        id,
        get controlRef() {
          return options?.controlRef === undefined ? undefined : base.controlRef
        },
      }
    },
  })
  return {
    ...inner,
    async create(input) {
      return wrapEnvironment(await inner.create(input))
    },
    async get(id, options) {
      const environment = await inner.get?.(id, options)
      return environment ? wrapEnvironment(environment) : null
    },
  }
}
