/**
 *
 * Resolve the `delegate` supervisor substrate (router brain + worker backend) from env, so the
 * `agent-runtime-mcp` bin can serve the ONE generic `delegate` verb by env, over the SAME stdio
 * invocation a consumer already mounts.
 *
 * `delegate` is wired into `createMcpServer` via `McpServerOptions.delegateSupervisor`, which needs a
 * router (the supervisor brain's transport) and a backend (WHERE the authored workers run). Inside a
 * sandbox child the natural backend is `sandbox`: authored workers run as sub-sandboxes through the
 * SAME `SandboxClient` the bin already loads from `TANGLE_API_KEY`. Dedicated MCP variables name
 * the supervisor's router connection and exact model; inherited worker/model aliases are rejected.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../errors'
import type { SandboxClient } from '../runtime'
import type { RouterTransportConfig } from '../runtime/router-client'
import { supervisorInstructions } from '../runtime/supervise/authoring'
import type { ExecutorConfig } from '../runtime/supervise/runtime'
import type { DelegateHandlerOptions } from './tools/delegate'

function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v ? v : undefined
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = trimmed(env[name])
  if (value) return value
  throw new ConfigError(`agent-runtime-mcp: ${name} is required when MCP_ENABLE_DELEGATE=1`)
}

/** True when the operator opted the generic `delegate` verb in (`MCP_ENABLE_DELEGATE=1`). Default off:
 *  the wiring is additive, so consumers that do not enable it are unaffected. */
export function delegateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MCP_ENABLE_DELEGATE === '1'
}

/**
 * Resolve the supervisor brain from dedicated MCP configuration. The model is part of the exact
 * profile; the URL and key are transport-only. No generic worker/model/key variable may silently
 * select this paid execution path.
 */
function resolveRouterSupervisor(env: NodeJS.ProcessEnv): {
  router: RouterTransportConfig
  profile: AgentProfile
} {
  const routerKey = requiredEnv(env, 'MCP_SUPERVISOR_ROUTER_KEY')
  const base = requiredEnv(env, 'MCP_SUPERVISOR_ROUTER_BASE_URL')
  const routerBaseUrl = /\/v\d+\/?$/.test(base)
    ? base.replace(/\/$/, '')
    : `${base.replace(/\/$/, '')}/v1`
  const model = requiredEnv(env, 'MCP_SUPERVISOR_MODEL')
  return {
    router: { routerBaseUrl, routerKey },
    profile: {
      name: 'delegate-supervisor',
      harness: 'cli-base',
      model: { provider: 'tangle-router', default: model },
      prompt: { systemPrompt: supervisorInstructions() },
    },
  }
}

/**
 * Build the `delegateSupervisor` substrate for `createMcpServer` from env + the bin's loaded
 * `SandboxClient`. Returns `undefined` when `delegate` is not opted in, so the caller mounts it only
 * when asked. The worker backend is `sandbox`; every authored worker's exact profile selects its
 * own harness/provider/model.
 */
export function resolveDelegateSupervisor(
  sandboxClient: SandboxClient,
  env: NodeJS.ProcessEnv = process.env,
): DelegateHandlerOptions | undefined {
  if (!delegateEnabled(env)) return undefined
  const supervisor = resolveRouterSupervisor(env)
  const backend: ExecutorConfig = {
    backend: 'sandbox',
    sandboxClient,
  }
  return {
    router: supervisor.router,
    supervisorProfile: supervisor.profile,
    backend,
  }
}
