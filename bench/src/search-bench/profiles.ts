/**
 * Per-arm AgentProfiles for the coding-harness web-search comparison.
 *
 * Three arms, one variable (the search backend the agent can reach):
 *   - `native`   — the harness's built-in web search/fetch, untouched. No MCP.
 *   - `provider` — native search DISABLED + a router-backed search MCP added
 *     (provider-pinned: you / exa / …). The agent's only web access is the MCP.
 *
 * The disable directive is the harness-agnostic `tools` map landed in
 * agent-dev-container#1810 (claude `--disallowed-tools`, codex
 * `-c tools.web_search=false`, opencode `tools.{websearch,webfetch}`). We set
 * both canonical (`web_search`/`web_fetch`) and opencode-native
 * (`websearch`/`webfetch`) keys so a single profile is correct on every harness
 * pre- and post-deploy, plus the opencode `permission.webfetch=deny` belt.
 *
 * The provider MCP mirrors the SDK's official `buildTangleRouterSearchProfile`
 * shape — a `transport:'http'` server at the router's `/v1/search/mcp` endpoint,
 * provider pinned via the `?provider=` query param.
 */
import type { AgentProfile } from '@tangle-network/sandbox'

export type SearchArm = 'native' | 'off' | { provider: string }

const routerSearchMcpUrl = (provider: string, routerBaseUrl: string): string => {
  // routerBaseUrl is typically https://router.tangle.tools/v1 — the search MCP
  // lives at /v1/search/mcp, so trim a trailing /v1 then re-append the path.
  const root = routerBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  return `${root}/v1/search/mcp?provider=${encodeURIComponent(provider)}`
}

/** Tool keys that turn OFF a harness's native web search/fetch across harnesses. */
const nativeWebToolsDisabled: Record<string, boolean> = {
  web_search: false,
  web_fetch: false,
  websearch: false,
  webfetch: false,
}

export interface BuildArmProfileArgs {
  arm: SearchArm
  /** Router base URL (…/v1). Used to derive the search-MCP endpoint. */
  routerBaseUrl: string
  /** Bearer for the router search MCP. Required for a provider arm. */
  tangleApiKey: string
  /** Optional name/metadata to merge. */
  name?: string
  metadata?: Record<string, unknown>
}

/**
 * Build the AgentProfile fragment (tools / permission / mcp) for one search arm.
 * Returned as a partial profile to be spread into `sandboxAgentRun({ profile })`.
 */
export function buildArmProfile(args: BuildArmProfileArgs): AgentProfile {
  const { arm, routerBaseUrl, tangleApiKey } = args
  const base: AgentProfile = {
    name: args.name ?? 'search-bench-worker',
    ...(args.metadata ? { metadata: args.metadata } : {}),
  } as AgentProfile

  if (arm === 'native') {
    // Native web tools stay on (harness default). No search MCP. For codex,
    // whose web_search ships off, explicitly enable it so the native arm is real.
    return { ...base, tools: { web_search: true } } as AgentProfile
  }

  if (arm === 'off') {
    // No web access at all — the parametric floor (search contributes nothing).
    return { ...base, tools: { ...nativeWebToolsDisabled }, permission: { webfetch: 'deny' } } as AgentProfile
  }

  if (!tangleApiKey) {
    throw new Error(`buildArmProfile: provider arm "${arm.provider}" requires a tangleApiKey for the search MCP`)
  }
  return {
    ...base,
    tools: { ...nativeWebToolsDisabled },
    permission: { webfetch: 'deny' },
    mcp: {
      tangle_search: {
        transport: 'http',
        url: routerSearchMcpUrl(arm.provider, routerBaseUrl),
        headers: { Authorization: `Bearer ${tangleApiKey}` },
        enabled: true,
      },
    },
  } as AgentProfile
}

/** Stable condition label for the corpus: `<harness>:<arm>`. */
export function armLabel(arm: SearchArm): string {
  if (arm === 'native') return 'native'
  if (arm === 'off') return 'off'
  return arm.provider
}
