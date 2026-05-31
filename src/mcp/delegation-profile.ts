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
} from '@tangle-network/sandbox'

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

const DEFAULT_SANDBOX_BASE_URL = 'https://sandbox.tangle.tools'

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
}

/**
 * Compose the production `AgentProfile`: the canonical base profile with the
 * delegation MCP merged into `mcp`. Used by every call site that boots a
 * sandbox or runs a chat turn through the sandbox path, and by eval wiring so
 * the scorecard profile hash reflects the actual production profile.
 *
 * Merge rules:
 *   - `mcp`: base map preserved; the delegation entry is appended under
 *     {@link DELEGATION_MCP_SERVER_KEY}, and omitted entirely when no sandbox
 *     API key resolves.
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
  const mergedMcp: Record<string, AgentProfileMcpServer> = delegationMcp
    ? { ...baseMcp, ...delegationMcp }
    : { ...baseMcp }

  const baseFiles = baseProfile.resources?.files ?? []
  const mergedFiles: AgentProfileFileMount[] = options.extraFiles?.length
    ? [...baseFiles, ...options.extraFiles]
    : [...baseFiles]

  const prompt = options.systemPrompt
    ? { ...baseProfile.prompt, systemPrompt: options.systemPrompt }
    : baseProfile.prompt

  return {
    ...baseProfile,
    name: options.name ?? baseProfile.name,
    prompt,
    mcp: mergedMcp,
    resources: {
      ...baseProfile.resources,
      files: mergedFiles,
    },
  }
}
