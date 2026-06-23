/**
 * The TOOL knob — swap the agent's tool surface in ONE line.
 *
 * A tool surface is a PRESET, not forked code. Each preset authors the SAME two
 * fields onto a profile — native tools on/off (`profile.tools`) and an optional
 * mounted MCP server (`profile.mcp`) — and the sandbox substrate materializes them
 * into each harness's real shape (`.claude/`, `opencode.json`, codex config, ...).
 * We never hand-write a per-harness config file.
 *
 *   withTools(profile, 'web')        // turn on the native web tools
 *   withTools(profile, 'search-mcp') // mount a search MCP instead
 *   withTools(profile, 'none')       // baseline: no web, no MCP
 *
 * To add the tool surface as a 4TH matrix axis, build the profile list as the
 * cartesian of harnesses × presets (see benchmark.ts, `--tools` flag).
 *
 * Honesty note for partners: a preset only takes effect for a (harness, lever)
 * pair the sandbox actually materializes. If a harness has no native `webfetch`,
 * `withTools(p,'web')` is a no-op THERE — that is a substrate fact, not something
 * this example silently patches over. Check `@tangle-network/sandbox` for the
 * materialization matrix before trusting a tool swap on a given harness.
 */

import type { AgentProfile, AgentProfileMcpServer } from '@tangle-network/agent-interface'

/** Where a search MCP lives, when the `search-mcp` preset is selected. */
const searchMcpUrl = process.env.TANGLE_SEARCH_MCP ?? 'https://search-mcp.tangle.tools/mcp'

export type ToolPreset = 'none' | 'web' | 'search-mcp'

interface ToolSurface {
  /** Native harness tools, by name → enabled. Maps to `profile.tools`. */
  tools?: Record<string, boolean>
  /** A mounted MCP server, by name. Maps to `profile.mcp`. */
  mcp?: Record<string, AgentProfileMcpServer>
}

const presets: Record<ToolPreset, ToolSurface> = {
  none: { tools: { websearch: false, webfetch: false } },
  web: { tools: { websearch: true, webfetch: true } },
  'search-mcp': {
    tools: { websearch: false, webfetch: false },
    mcp: { search: { transport: 'http', url: searchMcpUrl, enabled: true } },
  },
}

/** Author a tool surface onto a profile. Returns a NEW profile (pure). */
export function withTools(profile: AgentProfile, preset: ToolPreset): AgentProfile {
  const surface = presets[preset]
  return {
    ...profile,
    ...(surface.tools ? { tools: surface.tools } : {}),
    ...(surface.mcp ? { mcp: surface.mcp } : {}),
  }
}
