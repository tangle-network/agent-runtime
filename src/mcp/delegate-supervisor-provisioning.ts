/**
 *
 * Resolve the `delegate` supervisor substrate (router brain + worker backend) from env, so the
 * `agent-runtime-mcp` bin can serve the ONE generic `delegate` verb by env, over the SAME stdio
 * invocation a consumer already mounts.
 *
 * `delegate` is wired into `createMcpServer` via `McpServerOptions.delegateSupervisor`, which needs a
 * router (the supervisor brain's substrate) and a backend (WHERE the authored workers run). Inside a
 * sandbox child the natural backend is `sandbox`: authored workers run as sub-sandboxes through the
 * SAME `SandboxClient` the bin already loads from `TANGLE_API_KEY`. The brain's router reuses the
 * repo's `resolveRouterBaseUrl` convention
 * (`TANGLE_ROUTER_URL` / `TANGLE_ROUTER_BASE_URL`), normalised to an OpenAI-compatible `/v1` endpoint,
 * keyed by `TANGLE_API_KEY`.
 *
 * @experimental
 */

import type { BackendType } from '@tangle-network/sandbox'
import { type RouterEnv, resolveRouterBaseUrl } from '../model-resolution.js'
import type { SandboxClient } from '../runtime'
import type { RouterConfig } from '../runtime/router-client'
import type { ExecutorConfig } from '../runtime/supervise/runtime'
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
 * Build the `delegateSupervisor` substrate for `createMcpServer` from env + the bin's loaded
 * `SandboxClient`. Returns `undefined` when `delegate` is not opted in, so the caller mounts it only
 * when asked. The worker backend is `sandbox` (authored workers run as sub-sandboxes via the same
 * client) on the harness named by `MCP_DELEGATE_WORKER_HARNESS` (default `opencode`).
 */
export function resolveDelegateSupervisor(
  sandboxClient: SandboxClient,
  env: NodeJS.ProcessEnv = process.env,
): DelegateHandlerOptions | undefined {
  if (!delegateEnabled(env)) return undefined
  const router = resolveRouter(env)
  const harness = (trimmed(env.MCP_DELEGATE_WORKER_HARNESS) ??
    DEFAULT_WORKER_HARNESS) as BackendType
  const backend: ExecutorConfig = {
    backend: 'sandbox',
    harness,
    sandboxClient,
  }
  return {
    router,
    backend,
    model: router.model,
  }
}
