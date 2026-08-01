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
import { ConfigError } from '../errors'
import { type RouterEnv, resolveRouterBaseUrl } from '../model-resolution.js'
import type { SandboxClient } from '../runtime'
import type { RouterConfig } from '../runtime/router-client'
import type { ExecutorConfig } from '../runtime/supervise/runtime'
import type { DelegateHandlerOptions } from './tools/delegate'

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

/**
 * Resolve the supervisor brain's router substrate from env. The base reuses `resolveRouterBaseUrl`,
 * normalised to `/v1`.
 *
 * The KEY is the one for INFERENCE, which inside a sandbox is not the one for the sandbox. A box
 * carries both: `OPENAI_API_KEY` is its credential for the OpenAI-compatible endpoint the brain
 * calls, and `TANGLE_API_KEY` authenticates the sandbox CONTROL API — create a box, run a process —
 * which the router answers `403`. The brain therefore prefers the inference credential and keeps
 * the platform key as the last rung, for a host that runs one key for both.
 *
 * The MODEL is NAMED, never guessed. Which ids a given router serves is deployment state this
 * package cannot know, and a wrong guess is invisible until the supervisor's first completion
 * rejects — after the tool has been advertised to an agent, from inside a child process whose
 * stderr nobody reads. `TANGLE_ROUTER_MODEL` is on the ladder because the sandbox platform sets it
 * on every box: a delegate child running there inherits the model its own host declared. When
 * nothing names one, fail at startup with the ladder in the message.
 */
function resolveRouter(env: NodeJS.ProcessEnv): RouterConfig {
  const routerKey =
    trimmed(env.MCP_SUPERVISOR_ROUTER_KEY) ??
    trimmed(env.OPENAI_API_KEY) ??
    trimmed(env.TANGLE_API_KEY) ??
    ''
  const base = trimmed(env.MCP_SUPERVISOR_ROUTER_BASE_URL) ?? resolveRouterBaseUrl(env as RouterEnv)
  const routerBaseUrl = /\/v\d+\/?$/.test(base)
    ? base.replace(/\/$/, '')
    : `${base.replace(/\/$/, '')}/v1`
  const model =
    trimmed(env.MCP_SUPERVISOR_MODEL) ??
    trimmed(env.MCP_WORKER_MODEL) ??
    trimmed(env.WORKER_MODEL) ??
    trimmed(env.TANGLE_ROUTER_MODEL)
  if (!model) {
    throw new ConfigError(
      'agent-runtime-mcp: no supervisor brain model — set MCP_SUPERVISOR_MODEL (or MCP_WORKER_MODEL / ' +
        'WORKER_MODEL / TANGLE_ROUTER_MODEL) to a tool-calling model the router serves.',
    )
  }
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
