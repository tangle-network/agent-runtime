/**
 * The HARNESS axis + the TOOL knob — the agent-config side of the matrix.
 *
 * We measure the HARNESS on its default behavior, so each profile is deliberately
 * bare: a name, the model it runs, and NOTHING else (no skills, no injected system
 * prompt). Adding scaffolding here would measure our scaffolding, not the harness.
 * The tool surface is a separate, orthogonal knob authored onto the profile in one
 * line (`withTools`), so harness × tool is a clean cartesian.
 *
 * Two things to know about the shape:
 *  - `runProfileMatrix` takes `AgentProfile[]` from `@tangle-network/agent-interface`.
 *    That type has NO `harness` field (harness is a SANDBOX concept, not a profile
 *    concept), so we carry the harness selector on `metadata.harness`. `dispatch.ts`
 *    reads it to pick `backend.type`. `harnessOf()` below is the one reader.
 *  - The matrix REQUIRES a snapshot-dated `model.default` (it stamps it onto every
 *    run record). For a real harness the agent uses the harness's own default model;
 *    we still name a model id here so the record is honest about what ran.
 */

import type { AgentProfile, AgentProfileMcpServer } from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'

/** The harnesses we sweep. `cli-base` is the plain-CLI baseline (no agent harness). */
export const harnesses = [
  'claude-code',
  'opencode',
  'codex',
  'cli-base',
] as const satisfies readonly BackendType[]

/** Read the harness a profile targets. The ONE place metadata.harness is decoded. */
export function harnessOf(profile: AgentProfile): BackendType {
  const h = profile.metadata?.harness
  if (typeof h !== 'string') {
    throw new Error(`profile "${profile.name}" is missing metadata.harness — see profiles.ts`)
  }
  return h as BackendType
}

/** The default model each harness runs. Override per-harness via env if you like;
 *  the value is stamped onto the run record, so keep it truthful.
 *
 *  IMPORTANT — the model id MUST carry a SNAPSHOT DATE. `runProfileMatrix` rejects a
 *  bare alias and requires the snapshot form (`provider/name-YYYY-MM-DD`), because a
 *  run record without the exact model snapshot is not reproducible ("which gpt-4.1
 *  was that?"). This is the substrate keeping the benchmark paper-grade — keep the
 *  date current. */
const harnessModel: Record<BackendType, string> = {
  'claude-code': process.env.CLAUDE_CODE_MODEL ?? 'anthropic/claude-sonnet-4-5-2025-09-29',
  opencode: process.env.OPENCODE_MODEL ?? 'anthropic/claude-sonnet-4-5-2025-09-29',
  codex: process.env.CODEX_MODEL ?? 'openai/gpt-5-codex-2025-09-15',
  'cli-base': process.env.CLI_BASE_MODEL ?? 'openai/gpt-4.1-2025-04-14',
  // unreached by this example, but BackendType is a closed union — name them all
  'kimi-code': 'moonshot/kimi-k2-2025-07-11',
  amp: 'anthropic/claude-sonnet-4-5-2025-09-29',
  'factory-droids': 'anthropic/claude-sonnet-4-5-2025-09-29',
  pi: 'openai/gpt-4.1-2025-04-14',
  hermes: 'openai/gpt-4.1-2025-04-14',
  forge: 'openai/gpt-4.1-2025-04-14',
  openclaw: 'anthropic/claude-sonnet-4-5-2025-09-29',
  nanoclaw: 'anthropic/claude-sonnet-4-5-2025-09-29',
  acp: 'openai/gpt-4.1-2025-04-14',
  cursor: 'anthropic/claude-sonnet-4-5-2025-09-29',
}

/**
 * One bare baseline profile per harness. The agent's behavior here is the
 * harness's OUT-OF-THE-BOX behavior — exactly what a partner gets on day one.
 */
export const harnessProfiles: AgentProfile[] = harnesses.map((harness) => ({
  name: `${harness}-baseline`,
  model: { default: harnessModel[harness] },
  // NO prompt, NO resources — measure the harness, not our scaffolding.
  metadata: { harness },
}))

// ── the tool knob ─────────────────────────────────────────────────────────────
//
// A tool surface is a PRESET, not forked code. Each preset authors the SAME two
// fields onto a profile — native tools on/off (`profile.tools`) and an optional
// mounted MCP server (`profile.mcp`) — and the sandbox substrate materializes them
// into each harness's real shape (`.claude/`, `opencode.json`, codex config, ...).
// We never hand-write a per-harness config file.
//
//   withTools(profile, 'web')        // turn on the native web tools
//   withTools(profile, 'search-mcp') // mount a search MCP instead
//   withTools(profile, 'none')       // baseline: no web, no MCP
//
// Honesty note for partners: a preset only takes effect for a (harness, lever) pair
// the sandbox actually materializes. If a harness has no native `webfetch`,
// `withTools(p,'web')` is a no-op THERE — a substrate fact, not something this
// example silently patches over. See `@tangle-network/sandbox` for the matrix.

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
