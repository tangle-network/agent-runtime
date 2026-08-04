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
import { type AgentProfile, type HarnessType, agentProfileSchema } from '@tangle-network/agent-interface'

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
  /** Bearer for the router search MCP. Required for a provider arm. Valid for the
   *  `bridge` (local) backend; in `sandbox` mode the box egress proxy rejects
   *  foreign router credentials (403), so the provider arm needs the box-side
   *  credential flow before sandbox-backed provider runs are trustworthy. */
  tangleApiKey: string
  harness: HarnessType
  model: string
  provider: string
  /** Optional name/metadata to merge. */
  name?: string
  metadata?: Record<string, unknown>
}

/**
 * Build the complete executable AgentProfile for one search arm.
 */
export function buildArmProfile(args: BuildArmProfileArgs): AgentProfile {
  const { arm, routerBaseUrl, tangleApiKey } = args
  const base: AgentProfile = {
    name: args.name ?? 'search-bench-worker',
    harness: args.harness,
    model: { provider: args.provider, default: args.model },
    ...(args.metadata ? { metadata: args.metadata } : {}),
  }

  if (arm === 'native') {
    // Native web tools stay on (harness default). No search MCP. For codex,
    // whose web_search ships off, explicitly enable it so the native arm is real.
    return agentProfileSchema.parse({ ...base, tools: { web_search: true } })
  }

  if (arm === 'off') {
    // No web access at all — the parametric floor (search contributes nothing).
    return agentProfileSchema.parse({
      ...base,
      tools: { ...nativeWebToolsDisabled },
      permission: { webfetch: 'deny' },
    })
  }

  if (!tangleApiKey) {
    throw new Error(`buildArmProfile: provider arm "${arm.provider}" requires a tangleApiKey for the search MCP`)
  }
  return agentProfileSchema.parse({
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
  })
}

/** Stable condition label for the corpus: `<harness>:<arm>`. */
export function armLabel(arm: SearchArm): string {
  if (arm === 'native') return 'native'
  if (arm === 'off') return 'off'
  return arm.provider
}
