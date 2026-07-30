/**
 * Opt-in wiring for the generic `delegate` MCP tool.
 *
 * A complete supervisor profile and both executor configurations contain live provider objects and
 * cannot be reconstructed safely from generic environment strings. Products therefore inject the
 * exact `DelegateHandlerOptions`; this module only applies the opt-in switch used by the stdio bin.
 *
 * @experimental
 */

import { ConfigError } from '../errors'
import type { DelegateHandlerOptions } from './tools/delegate'

/** True when the operator opted the generic `delegate` verb in. */
export function delegateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MCP_ENABLE_DELEGATE === '1'
}

/**
 * Return an explicitly supplied delegation configuration when the tool is enabled.
 *
 * No provider, model, profile, or resource decision is inferred here.
 */
export function resolveDelegateSupervisor(
  configured: DelegateHandlerOptions | undefined,
  env: NodeJS.ProcessEnv = process.env,
): DelegateHandlerOptions | undefined {
  if (!delegateEnabled(env)) return undefined
  if (!configured) {
    throw new ConfigError(
      'agent-runtime-mcp: delegate requires an explicitly injected AgentProfile, driverBackend, worker backend, budgets, and depth policy',
    )
  }
  return configured
}
