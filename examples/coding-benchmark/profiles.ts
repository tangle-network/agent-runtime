/**
 * The HARNESS axis + the TOOL knob — the agent-config side of the matrix.
 *
 * Each profile is deliberately bare (name + model, no skills, no injected prompt) so we
 * measure the HARNESS, not our scaffolding; the tool surface is a separate orthogonal knob
 * (`withTools`), making harness × tool a clean cartesian. Two non-obvious facts about the
 * shape: `AgentProfile` (`@tangle-network/agent-interface`) has no `harness` field (harness
 * is a SANDBOX concept), so the harness selector rides `metadata.harness` (`harnessOf()` is
 * the one reader); and `runProfileMatrix` REQUIRES a snapshot-dated `model.default` — see
 * `harnessModel` below.
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

/** The default model each harness runs (override per-harness via env). The model id MUST
 *  carry a SNAPSHOT DATE (`provider/name-YYYY-MM-DD`): `runProfileMatrix` rejects a bare
 *  alias, because a record without the exact snapshot is not reproducible. */
const harnessModel: Record<BackendType, string> = {
  'claude-code': process.env.CLAUDE_CODE_MODEL ?? 'anthropic/claude-sonnet-4-5-2025-09-29',
  opencode: process.env.OPENCODE_MODEL ?? 'anthropic/claude-sonnet-4-5-2025-09-29',
  codex: process.env.CODEX_MODEL ?? 'openai/gpt-5-codex-2025-09-15',
  'cli-base': process.env.CLI_BASE_MODEL ?? 'openai/gpt-4.1-2025-04-14',
  // unreached by this example, but BackendType is a closed union — name them all
  'kimi-code': 'moonshot/kimi-k2-2025-07-11',
  // `prime` joined the canonical harness enum in interface 0.45; BackendType is a closed union,
  // so the table names it even though this example never routes there.
  prime: 'openai/gpt-5-codex-2025-09-15',
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

/** One bare baseline profile per harness — the harness's out-of-the-box behavior. */
export const harnessProfiles: AgentProfile[] = harnesses.map((harness) => ({
  name: `${harness}-baseline`,
  model: { default: harnessModel[harness] },
  metadata: { harness },
}))

// ── the tool knob ─────────────────────────────────────────────────────────────
// A tool surface is a PRESET (the README's "How a tool swap works" section explains the
// one-line knob + the honesty caveat). Each preset authors the same two profile fields —
// `profile.tools` and `profile.mcp` — and the sandbox substrate materializes them into
// each harness's real config; we never hand-write a per-harness config file.

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
