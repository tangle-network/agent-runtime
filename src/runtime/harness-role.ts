/**
 * Which `HarnessType` values name a real coding-agent runtime, and which name a MODE that has no
 * agent behind it.
 *
 * `cli-base` is the router-backed mode — a plain multi-turn router call with no coding-agent
 * harness (`@tangle-network/agent-interface`'s `HarnessType` doc, and the same table's
 * `harnessReasoningCeiling['cli-base'] = 'none'` commented "cli-base has no agent"). The
 * distinction is REAL; what was accidental is that three call sites each spelled the test
 * themselves, so a second no-agent mode would have to be remembered in three places.
 *
 * SHOULD UPSTREAM: this belongs next to `harnessHonorsEffort` in agent-interface's
 * `harness-capabilities.ts`, which already encodes the fact but exports no predicate for it.
 * Until it does, this is the one local copy — extend the set here, never re-test the name.
 */

import type { HarnessType } from '@tangle-network/agent-interface'

/**
 * Harness ids that select a router/no-agent mode rather than a coding-agent runtime.
 *
 * `nanoclaw` is deliberately ABSENT: the shared capability table clamps its reasoning ceiling the
 * same way it clamps `cli-base`, but nanoclaw does run an agent (a socket-bridge runner to the
 * NanoClaw daemon) and every caller here treats it as a full harness. Add a row only with the
 * behavior change stated, never to make the two clamps look symmetric.
 */
const NO_AGENT_HARNESSES: ReadonlySet<string> = new Set<string>(['cli-base' satisfies HarnessType])

/** Whether this profile harness selects a real coding-agent runtime (vs. the router/no-agent mode
 *  or no preference at all). Accepts the looser `string` some local profile shapes declare, and
 *  preserves the caller's own harness type when it is narrower. */
export function harnessRunsAgent<T extends string>(harness: T | null | undefined): harness is T {
  return harness != null && !NO_AGENT_HARNESSES.has(harness)
}

/** The coding-agent harness this profile selects, or `undefined` when it selects none — the shape
 *  callers want when a no-agent mode must fall through to the router arm. */
export function agentHarness<T extends string>(harness: T | null | undefined): T | undefined {
  return harnessRunsAgent(harness) ? harness : undefined
}
