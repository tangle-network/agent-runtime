/**
 * @experimental
 *
 * Named driver policies — a registry, not a constructor zoo.
 *
 * A "driver variant" is just a `TopologyPlanner` function. There is one
 * interpreter (`createDynamicDriver`) and one move vocabulary (refine/fanout/
 * stop); a variant is the *policy* that chooses moves from history. So new
 * variants are entries in `PROMPT_PLANNERS`, not new `createXDriver` factories
 * — pick one by name the same way a benchmark is picked by key.
 *
 * The only thing that is genuinely data here is the skill directive *text*
 * (`SKILL_DIRECTIVES`) — the optimizable surface. A planner injects a directive
 * into the next attempt; GEPA/skill-opt can later rewrite those strings, or an
 * auto-research loop can add a new planner function, without touching the kernel.
 *
 * Scope: these planners operate on a *string* task (a prompt) — the shape every
 * benchmark worker already takes. Structured-task variants get their own small
 * registry; this one stays concrete on purpose.
 */

import type { Iteration } from '../types'
import type { TopologyMove, TopologyPlanner } from './dynamic'

/** A driver policy over prompt-shaped (string) tasks. Output is consulted only
 *  through the iteration's verdict, so it stays `unknown`. */
export type PromptPlanner = TopologyPlanner<string, unknown>

/**
 * Skill directives — the data surface. Each maps a steering intent to the
 * instruction prepended onto the next attempt. Phrased as what a strong
 * operator would say at that point in the loop, not as lifecycle narration.
 * This is what an optimizer rewrites.
 */
export const SKILL_DIRECTIVES: Record<string, string> = {
  pursue:
    'Take the boldest correct approach: make the central design decision and implement it fully — not a timid first cut.',
  evolve:
    'The prior attempt fell short. Diagnose the single highest-impact gap, fix exactly that, and re-check it — do not rewrite wholesale.',
  'critical-audit':
    'Progress has stalled. Stop and adversarially review the current attempt for the real defect — a wrong assumption, a missed edge case, incorrect logic — then fix that root cause.',
  verify:
    'A candidate solution looks valid. Before finishing, verify completeness: exercise the failing case, check edge cases, and confirm nothing else regressed.',
}

const DIRECTIVE_RE = /^\[skill:([a-z-]+)\]/

/** Prepend a skill directive onto the *root* task (never onto an already-steered
 *  task — directives must not stack). Carries a parseable marker so a stateless
 *  planner can read back which directive produced an earlier iteration. */
function withDirective(rootTask: string, skill: string): string {
  const directive = SKILL_DIRECTIVES[skill]
  if (!directive) throw new Error(`planners: unknown skill directive '${skill}'`)
  return `[skill:${skill}] ${directive}\n\n${rootTask}`
}

/** Which directive (if any) produced this iteration's task. */
function directiveOf(task: string): string | undefined {
  return task.match(DIRECTIVE_RE)?.[1]
}

/** Two consecutive scored attempts that didn't clear the bar and didn't improve. */
function plateaued(history: ReadonlyArray<Iteration<string, unknown>>): boolean {
  const scored = history.filter((h) => h.verdict).slice(-2)
  if (scored.length < 2) return false
  const [a, b] = scored as [Iteration<string, unknown>, Iteration<string, unknown>]
  if (b.verdict?.valid) return false
  return (b.verdict?.score ?? 0) <= (a.verdict?.score ?? 0) + 0.01
}

/**
 * `blind` — one shot, then stop. The no-driver baseline: a single worker
 * attempt with no steering, so a benchmark can isolate "what the driver adds"
 * against it.
 */
export const blind: PromptPlanner = ({ task, history }): TopologyMove<string> =>
  history.length === 0
    ? { kind: 'refine', task, rationale: 'blind: single attempt' }
    : { kind: 'stop', rationale: 'blind: one attempt only' }

/**
 * `refineOnFail` — keep refining, feeding the prior shortfall back in as
 * guidance, until a valid result or the budget runs out. The simplest planner
 * that uses *information* (the last verdict) rather than luck.
 */
export const refineOnFail: PromptPlanner = ({
  task,
  history,
  iterationsRemaining,
}): TopologyMove<string> => {
  if (history.some((h) => h.verdict?.valid))
    return { kind: 'stop', rationale: 'a valid result exists' }
  if (history.length === 0) return { kind: 'refine', task, rationale: 'first attempt' }
  if (iterationsRemaining <= 1) return { kind: 'stop', rationale: 'budget exhausted' }
  const score = history.at(-1)?.verdict?.score
  const why =
    typeof score === 'number' ? `prior attempt scored ${score.toFixed(2)}` : 'prior attempt failed'
  return {
    kind: 'refine',
    task: `${task}\n\n--- ${why} and did not clear the bar. Diagnose what was missing and fix it. ---`,
    rationale: 'refine on failure',
  }
}

/**
 * `drew` — the operator persona, derived from the real skill-loop dynamics:
 * open with `pursue` (the architectural leap), grind with `evolve` while there's
 * room, escalate to `critical-audit` on a plateau, and `verify` a valid result
 * once before declaring done. Stateless: it reads which directive drove each
 * prior iteration from the task marker, so the kernel needs no extra memory.
 */
export const drew: PromptPlanner = ({
  task,
  history,
  iterationsRemaining,
}): TopologyMove<string> => {
  if (history.length === 0)
    return { kind: 'refine', task: withDirective(task, 'pursue'), rationale: 'pursue' }
  const last = history.at(-1)
  if (last?.verdict?.valid) {
    return directiveOf(last.task) === 'verify'
      ? { kind: 'stop', rationale: 'verified — done' }
      : { kind: 'refine', task: withDirective(task, 'verify'), rationale: 'verify' }
  }
  if (iterationsRemaining <= 1) return { kind: 'stop', rationale: 'budget exhausted' }
  if (plateaued(history))
    return {
      kind: 'refine',
      task: withDirective(task, 'critical-audit'),
      rationale: 'critical-audit',
    }
  return { kind: 'refine', task: withDirective(task, 'evolve'), rationale: 'evolve' }
}

/**
 * The registry. A driver variant is a name → policy entry; pick one with e.g.
 * `DRIVER=drew`. Adding a variant is adding a line here (or a function an
 * auto-research loop wrote), never a new factory.
 */
export const PROMPT_PLANNERS: Record<string, PromptPlanner> = {
  blind,
  'refine-on-fail': refineOnFail,
  drew,
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
