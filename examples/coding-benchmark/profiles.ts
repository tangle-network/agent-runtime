/**
 * The HARNESS axis — one baseline `AgentProfile` per coding harness.
 *
 * We measure the HARNESS on its default behavior, so each profile is deliberately
 * bare: a name, the model it runs, and NOTHING else (no skills, no injected system
 * prompt, no extra tools). Adding scaffolding here would measure our scaffolding,
 * not the harness.
 *
 * Two things to know about the shape:
 *  - `runProfileMatrix` takes `AgentProfile[]` from `@tangle-network/agent-interface`.
 *    That type has NO `harness` field (harness is a SANDBOX concept, not a profile
 *    concept), so we carry the harness selector on `metadata.harness`. `dispatch.ts`
 *    reads it to pick `backend.type` for the sandbox. `harnessOf()` below is the one
 *    reader.
 *  - The matrix REQUIRES `model.default` (it stamps it onto every run record). For a
 *    real harness the agent uses the harness's own default model; we still name a
 *    model id here so the record is honest about what ran.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
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
 *  bare `name` and requires `name@YYYY-MM-DD` or `name-YYYYMMDD`, because a run record
 *  without the exact model snapshot is not reproducible ("which gpt-4.1 was that?").
 *  This is the substrate keeping the benchmark paper-grade — keep the date current. */
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
  // NO prompt, NO resources, NO tools — measure the harness, not our scaffolding.
  metadata: { harness },
}))
