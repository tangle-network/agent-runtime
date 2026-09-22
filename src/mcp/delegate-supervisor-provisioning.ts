/**
 *
 * Build the supervisor used by the MCP `delegate` tool.
 *
 * The supervisor uses the configured router for planning and the configured
 * environment provider for workers. Tangle credentials configure both when
 * the standalone MCP binary is used.
 *
 * @experimental
 */

import type { HarnessType } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { type RouterEnv, resolveRouterBaseUrl } from '../model-resolution.js'
import type { RouterConfig } from '../runtime/router-client'
import type { EnvironmentWorkerOptions } from '../runtime/supervise/runtime'
import type { DelegateHandlerOptions } from './tools/delegate'

const DEFAULT_SUPERVISOR_MODEL = 'moonshotai/kimi-k2.6'
const DEFAULT_WORKER_HARNESS = 'opencode'

function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v ? v : undefined
}

/** True when the operator opted the generic `delegate` verb in (`MCP_ENABLE_DELEGATE=1`). Default off:
 *  the wiring is additive, so consumers that do not enable it are unaffected. */
export function delegateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MCP_ENABLE_DELEGATE === '1'
}

/** Resolve the supervisor brain's router substrate from env. The key falls back through the platform
 *  key the bin already requires; the base reuses `resolveRouterBaseUrl`, normalised to `/v1`. */
function resolveRouter(env: NodeJS.ProcessEnv): RouterConfig {
  const routerKey = trimmed(env.MCP_SUPERVISOR_ROUTER_KEY) ?? trimmed(env.TANGLE_API_KEY) ?? ''
  const base = trimmed(env.MCP_SUPERVISOR_ROUTER_BASE_URL) ?? resolveRouterBaseUrl(env as RouterEnv)
  const routerBaseUrl = /\/v\d+\/?$/.test(base)
    ? base.replace(/\/$/, '')
    : `${base.replace(/\/$/, '')}/v1`
  const model =
    trimmed(env.MCP_SUPERVISOR_MODEL) ??
    trimmed(env.MCP_WORKER_MODEL) ??
    trimmed(env.WORKER_MODEL) ??
    DEFAULT_SUPERVISOR_MODEL
  return { routerBaseUrl, routerKey, model }
}

/**
 * Build `delegateSupervisor` for `createMcpServer` from environment settings
 * and the loaded provider. Returns `undefined` unless delegation is enabled.
 * Workers use the harness named by `MCP_DELEGATE_WORKER_HARNESS`.
 */
export function resolveDelegateSupervisor(
  provider: AgentEnvironmentProvider,
  env: NodeJS.ProcessEnv = process.env,
): DelegateHandlerOptions | undefined {
  if (!delegateEnabled(env)) return undefined
  const router = resolveRouter(env)
  const harness = (trimmed(env.MCP_DELEGATE_WORKER_HARNESS) ??
    DEFAULT_WORKER_HARNESS) as HarnessType
  const worker: EnvironmentWorkerOptions = {
    provider,
    environment: { backend: harness },
  }
  return {
    router,
    worker,
    model: router.model,
  }
}
