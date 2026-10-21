/**
 *
 * Resolve the `delegate` supervisor substrate (router brain + worker backend) from env, so the
 * `agent-runtime-mcp` bin can serve the ONE generic `delegate` verb by env, over the SAME stdio
 * invocation a consumer already mounts.
 *
 * `delegate` is wired into `createMcpServer` via `McpServerOptions.delegateSupervisor`, which needs a
 * router (the supervisor brain's transport) and a backend (WHERE the authored workers run). Inside a
 * sandbox child the natural backend is `sandbox`: authored workers run as sub-sandboxes through the
 * SAME `SandboxClient` the bin already loads from its sandbox key. Dedicated MCP variables name
 * the supervisor's router connection and exact model; inherited worker/model aliases are rejected.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../errors'
import type { SandboxClient } from '../runtime'
import type { RouterTransportConfig } from '../runtime/router-http-transport'
import { supervisorInstructions } from '../runtime/supervise/authoring'
import { coordinationProfileToolPrefix } from '../runtime/supervise/provider-visible-profile'
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
 * The Runtime verbs the authoring supervisor is granted. A profile gets no coordination tool it does
 * not declare, so without `spawn_worker` the brain is offered no tools and every delegation settles
 * `no-children-spawned`. The rest let it inspect, steer, stop, and re-read what it already spawned,
 * which its authoring instruction tells it to do.
 */
const delegateSupervisorVerbs = [
  'spawn_worker',
  'observe_agent',
  'steer_agent',
  'cancel_worker',
  'read_journal',
] as const

/**
 * The `delegate` caller asked for a worker to do the task, and only a worker's settled result is
 * delivered. A capable brain otherwise answers a small intent itself (gemini-3.7-flash and kimi-k3
 * both replied to "Reply with exactly DELEGATED-391" directly), which settles `no-children-spawned`
 * and discards the answer.
 */
const delegateContract = [
  '',
  'This task came through `delegate`: the caller wants a worker to do it. However small the task,',
  'call spawn_worker at least once before you end your turn. Your own reply is never delivered;',
  "only a worker's settled result is.",
].join('\n')

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
  // The consumer's own policy for the workers this supervisor authors, such as the only harness and
  // model its worker boxes can run. Without it the brain picks instruments from memory, and on
  // 2026-10-19 every one it picked (claude-code on Anthropic, nanoclaw, cli-base) died in the box.
  const consumerInstructions = trimmed(env.MCP_SUPERVISOR_INSTRUCTIONS)
  return {
    router: { routerBaseUrl, routerKey },
    profile: {
      name: 'delegate-supervisor',
      harness: 'cli-base',
      model: { provider: 'tangle-router', default: model },
      prompt: {
        systemPrompt: [
          supervisorInstructions(),
          delegateContract,
          ...(consumerInstructions ? ['', consumerInstructions] : []),
        ].join('\n'),
      },
      tools: Object.fromEntries(
        delegateSupervisorVerbs.map((verb) => [`${coordinationProfileToolPrefix}${verb}`, true]),
      ),
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
