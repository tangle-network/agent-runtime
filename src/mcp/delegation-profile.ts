/**
 * Production-profile composition for the agent-runtime delegation MCP.
 *
 * A product agent's sandbox loads the delegation tools (`delegate_code`,
 * `delegate_research`, `delegate_feedback`, `delegation_status`,
 * `delegation_history`) by mounting the `agent-runtime-mcp` stdio server as
 * an MCP entry in its `AgentProfile`. This module is the single composer for
 * that wiring, so every consumer — the fleet agents and agent-builder's
 * generated agents — shares one implementation instead of copying it.
 *
 * The load-bearing invariant: the delegation MCP entry is only ever emitted
 * when a sandbox API key is present. Without the key the kernel's
 * coder/researcher delegate cannot construct an authenticated sandbox client,
 * so we omit the entry rather than ship an MCP child that fails to
 * authenticate on startup. No static profile entry, ever.
 */

import type {
  AgentProfile,
  AgentProfileFileMount,
  AgentProfileMcpServer,
  AgentSubagentProfile,
} from '@tangle-network/sandbox'

/** One hook command entry. The SDK declares `AgentProfile.hooks` as
 *  `Record<string, AgentProfileHookCommand[]>` but does not re-export the element
 *  type from the package entry, so derive it from `AgentProfile` by indexed
 *  access — the single source of truth, no drift from the SDK shape. */
type AgentProfileHookCommand = NonNullable<AgentProfile['hooks']>[string][number]

/** MCP server key under which the agent-runtime delegation tools mount. */
export const DELEGATION_MCP_SERVER_KEY = 'agent-runtime-delegation'

/**
 * Env vars forwarded into the delegation MCP child so its delegated
 * build/research loops export topology spans to the configured OTLP /
 * Tangle Intelligence sink. Each is forwarded only when present, so the
 * child is a no-op exporter until `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the
 * parent env — never a hardcoded endpoint.
 */
const OTEL_FORWARD_KEYS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'TRACE_ID',
  'PARENT_SPAN_ID',
] as const

export const DEFAULT_SANDBOX_BASE_URL = 'https://sandbox.tangle.tools'

export interface BuildDelegationMcpServerOptions {
  /** Sandbox API key forwarded as `TANGLE_API_KEY` to the MCP child. The
   *  agent-runtime MCP bin reads `TANGLE_API_KEY` and passes it straight to
   *  `new Sandbox({ apiKey })`. Defaults to `env.TANGLE_API_KEY`. */
  sandboxApiKey?: string
  /** Sandbox base URL forwarded as `SANDBOX_BASE_URL`. Defaults to
   *  `env.SANDBOX_BASE_URL`, then `env.SANDBOX_API_URL`, then the public
   *  sandbox endpoint. */
  sandboxBaseUrl?: string
  /** Environment source for key + OTEL resolution. Defaults to `process.env`;
   *  injectable for tests and non-process callers. */
  env?: Record<string, string | undefined>
}

/**
 * Build the delegation MCP entry the sandbox-side agent loads on startup.
 * Returns `undefined` when no sandbox API key is resolvable — callers merge
 * the result into a profile's `mcp` map only when defined.
 */
export function buildDelegationMcpServer(
  options: BuildDelegationMcpServerOptions = {},
): Record<string, AgentProfileMcpServer> | undefined {
  const env = options.env ?? process.env
  const sandboxApiKey = options.sandboxApiKey ?? env.TANGLE_API_KEY
  if (!sandboxApiKey) return undefined
  const baseUrl =
    options.sandboxBaseUrl ??
    env.SANDBOX_BASE_URL ??
    env.SANDBOX_API_URL ??
    DEFAULT_SANDBOX_BASE_URL

  const otelEnv: Record<string, string> = {}
  for (const key of OTEL_FORWARD_KEYS) {
    const value = env[key]
    if (value) otelEnv[key] = value
  }

  return {
    [DELEGATION_MCP_SERVER_KEY]: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@tangle-network/agent-runtime', 'mcp'],
      env: {
        TANGLE_API_KEY: sandboxApiKey,
        SANDBOX_BASE_URL: baseUrl,
        ...otelEnv,
      },
      enabled: true,
      metadata: {
        surface: 'delegation:dispatch',
        tools: [
          'delegate_code',
          'delegate_research',
          'delegate_feedback',
          'delegation_status',
          'delegation_history',
        ],
      },
    },
  }
}

export interface ComposeProductionAgentProfileOptions {
  /** Sandbox API key forwarded to the delegation MCP child. Defaults to
   *  `env.TANGLE_API_KEY`. When unset, the delegation MCP entry is omitted. */
  sandboxApiKey?: string
  /** Sandbox base URL forwarded as `SANDBOX_BASE_URL` to the MCP child. */
  sandboxBaseUrl?: string
  /** Replace the base profile's system prompt. Used by per-turn calls that
   *  swap in workspace-augmented prompts (board summary, learned style). */
  systemPrompt?: string
  /** Extra file mounts layered after the base profile's `resources.files`. */
  extraFiles?: AgentProfileFileMount[]
  /** Override the profile `name`. Defaults to the base profile's name. */
  name?: string
  /** Environment source for key + OTEL resolution. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /** Box built-in tool ON/OFF flags merged over the base profile's `tools`
   *  (overlay wins per key). The sandbox-seam mapping of a certified surface's
   *  tool grants — `AgentProfile.tools` is `Record<string, boolean>` box flags,
   *  so it carries grants, not arbitrary tool defs. */
  tools?: Record<string, boolean>
  /** Per-event hook commands merged over the base profile's `hooks`. An event
   *  present in both has the extra commands appended after the base ones. */
  hooks?: Record<string, AgentProfileHookCommand[]>
  /** Subagent definitions merged over the base profile's `subagents` (overlay
   *  wins per key). */
  subagents?: Record<string, AgentSubagentProfile>
  /** Resolved certified MCP connections injected into `AgentProfile.mcp` — the
   *  sandbox-seam delivery of a `ResolvedSurface.mcpConnections`. Merged after
   *  the base map and before the delegation entry, so a base/delegation key is
   *  never silently shadowed by an injected one. */
  mcpConnections?: Record<string, AgentProfileMcpServer>
}

/**
 * Compose the production `AgentProfile`: the canonical base profile with the
 * delegation MCP merged into `mcp`. Used by every call site that boots a
 * sandbox or runs a chat turn through the sandbox path, and by eval wiring so
 * the scorecard profile hash reflects the actual production profile.
 *
 * Merge rules:
 *   - `mcp`: base map preserved; `options.mcpConnections` (resolved certified
 *     servers) merged over it; the delegation entry is appended last under
 *     {@link DELEGATION_MCP_SERVER_KEY}, and omitted entirely when no sandbox
 *     API key resolves.
 *   - `tools`: base box-flags map preserved; `options.tools` overlaid per key.
 *   - `hooks`: per event, base commands preserved; `options.hooks[event]`
 *     appended after the base ones.
 *   - `subagents`: base map preserved; `options.subagents` overlaid per key.
 *   - `prompt.systemPrompt`: replaced when `options.systemPrompt` is set.
 *   - `resources.files`: `options.extraFiles` concatenated after base files.
 *   - `name`: replaced when `options.name` is set.
 */
export function composeProductionAgentProfile(
  baseProfile: AgentProfile,
  options: ComposeProductionAgentProfileOptions = {},
): AgentProfile {
  const delegationMcp = buildDelegationMcpServer({
    sandboxApiKey: options.sandboxApiKey,
    sandboxBaseUrl: options.sandboxBaseUrl,
    env: options.env,
  })

  const baseMcp = baseProfile.mcp ?? {}
  const withInjected: Record<string, AgentProfileMcpServer> = options.mcpConnections
    ? { ...baseMcp, ...options.mcpConnections }
    : { ...baseMcp }
  const mergedMcp: Record<string, AgentProfileMcpServer> = delegationMcp
    ? { ...withInjected, ...delegationMcp }
    : withInjected

  const baseFiles = baseProfile.resources?.files ?? []
  const mergedFiles: AgentProfileFileMount[] = options.extraFiles?.length
    ? [...baseFiles, ...options.extraFiles]
    : [...baseFiles]

  const prompt = options.systemPrompt
    ? { ...baseProfile.prompt, systemPrompt: options.systemPrompt }
    : baseProfile.prompt

  const mergedTools = options.tools
    ? { ...(baseProfile.tools ?? {}), ...options.tools }
    : baseProfile.tools

  const mergedHooks = mergeHooks(baseProfile.hooks, options.hooks)

  const mergedSubagents = options.subagents
    ? { ...(baseProfile.subagents ?? {}), ...options.subagents }
    : baseProfile.subagents

  return {
    ...baseProfile,
    name: options.name ?? baseProfile.name,
    prompt,
    ...(mergedTools ? { tools: mergedTools } : {}),
    ...(mergedHooks ? { hooks: mergedHooks } : {}),
    ...(mergedSubagents ? { subagents: mergedSubagents } : {}),
    mcp: mergedMcp,
    resources: {
      ...baseProfile.resources,
      files: mergedFiles,
    },
  }
}

/** Merge per-event hook command lists: base commands first, overlay commands
 *  appended after. Returns the base map unchanged when no overlay is given. */
function mergeHooks(
  base: Record<string, AgentProfileHookCommand[]> | undefined,
  overlay: Record<string, AgentProfileHookCommand[]> | undefined,
): Record<string, AgentProfileHookCommand[]> | undefined {
  if (!overlay) return base
  const merged: Record<string, AgentProfileHookCommand[]> = { ...(base ?? {}) }
  for (const [event, commands] of Object.entries(overlay)) {
    merged[event] = [...(merged[event] ?? []), ...commands]
  }
  return merged
}
