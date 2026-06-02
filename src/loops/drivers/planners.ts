/**
 * @experimental
 *
 * Named driver policies — a registry, not a constructor zoo.
 *
 * A "driver variant" is just a `TopologyPlanner` chosen by name and run by the
 * one interpreter (`createDynamicDriver`). The agentic variants are sandboxed
 * agents (`createSandboxPlanner`) — an LLM/agent in a box that emits the next
 * move; this registry holds the *deterministic* ones a benchmark needs as
 * controls. Today that's `blind`: a single attempt, no steering — the baseline
 * you measure a real driver against.
 *
 * Adding a variant is a line here (or a sandboxed planner registered by name),
 * never a new `createXDriver` factory and never a spec schema.
 */

import type { TopologyMove, TopologyPlanner } from './dynamic'

/** A driver policy over prompt-shaped (string) tasks. Output is consulted only
 *  through the iteration's verdict, so it stays `unknown`. */
export type PromptPlanner = TopologyPlanner<string, unknown>

/**
 * `blind` — one attempt, then stop. The no-driver control: a single worker run
 * with no steering, so a benchmark can isolate what a real driver adds.
 */
export const blind: PromptPlanner = ({ task, history }): TopologyMove<string> =>
  history.length === 0
    ? { kind: 'refine', task, rationale: 'blind: single attempt' }
    : { kind: 'stop', rationale: 'blind: one attempt only' }

/** The registry. Pick a driver by name (e.g. `DRIVER=blind`); fail loud on an
 *  unknown key. Sandboxed-agent planners can be registered here too. */
export const PROMPT_PLANNERS: Record<string, PromptPlanner> = {
  blind,
}

/** Resolve a planner by name; fail loud on an unknown variant. */
export function resolvePlanner(name: string): PromptPlanner {
  const planner = PROMPT_PLANNERS[name]
  if (!planner) {
    throw new Error(
      `planners: unknown driver '${name}' (have: ${Object.keys(PROMPT_PLANNERS).join(', ')})`,
    )
  }
  return planner
}
