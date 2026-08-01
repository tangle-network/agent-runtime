/**
 * The token budget below which a harness child cannot do ANY useful work.
 *
 * A coding-agent harness spends a fixed amount before it reads its task: system prompt, tool
 * definitions, workspace context — re-sent every turn. A parent that authors a child budget under
 * that amount has not set a tight ceiling, it has set an impossible one, and the child dies partway
 * through with no signal that the number was never satisfiable.
 *
 * Measured, not guessed. Six live `pi` children on `tangle-router/glm-5.2` settled at 31,211 /
 * 32,296 / 47,365 / 47,965 / 48,253 / 62,616 input tokens for 1–4 iterations, against 515–1,128
 * output. Four separate roots then authored child budgets of 2,000 / 8,000 / 12,000 / 20,000 —
 * every one below the observed minimum. One of those children wrote its deliverable correctly and
 * was killed before it could report, which the run recorded as a failure.
 *
 * A floor is `null` where nobody has measured one. That is deliberate: an unmeasured floor is
 * UNKNOWN, never zero, and enforcing a made-up number would refuse work that would have succeeded.
 * `null` means "admit anything and let the pool decide", the behavior before this table existed.
 *
 * The floor is a property of a harness/model pairing, not a universal constant, so this is a
 * conservative lower bound: it uses the smallest spend ever observed, not the median, so a refusal
 * means the budget is below what has EVER worked rather than below what is typical.
 */
import type { BackendType } from '@tangle-network/sandbox'

// Already the target shape: one exhaustive row per harness, `satisfies` pinned so a new
// `BackendType` is a compile error rather than a silent gap. Add a harness by adding a row.
export const WORKER_TOKEN_FLOOR = {
  // 31,211 was the lowest of six measured settlements; nothing rounds it up.
  pi: 31_211,
  // Unmeasured. Add a number here only with runs behind it.
  opencode: null,
  'claude-code': null,
  'kimi-code': null,
  codex: null,
  amp: null,
  'factory-droids': null,
  hermes: null,
  forge: null,
  openclaw: null,
  nanoclaw: null,
  acp: null,
  cursor: null,
  'cli-base': null,
} as const satisfies Record<BackendType, number | null>

/**
 * The floor for a spawn's harness, or `null` when there is none to enforce.
 *
 * A `null` harness is the router/inline arm: it holds only coordination verbs and re-sends no
 * harness scaffolding, so it has no floor of this kind.
 */
export function workerTokenFloor(harness: BackendType | null): number | null {
  if (harness === null) return null
  return (WORKER_TOKEN_FLOOR as Record<string, number | null>)[harness] ?? null
}
