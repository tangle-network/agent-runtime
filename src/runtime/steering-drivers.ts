/**
 *
 * Leak-free steering drivers — the non-LLM controls for the driven loop.
 *
 * These are the two sibling `Driver`s of the `refine` reference driver
 * (examples/driver-loop/driver-loop.ts), differing ONLY in how much of the
 * prior `verdict` their `plan()` is allowed to read. The amount of the verdict
 * a driver reads IS the experimental axis:
 *
 *   • refine  — reads `verdict.notes` (and/or `verdict.scores`): the grader's
 *               findings. A reviewer/judge LLM turns those findings into the
 *               next prompt. This is the "coached" condition.
 *   • dumb    — reads ONLY `verdict.valid` (the pass/fail boolean). No findings,
 *               no scores, no LLM. The next prompt is one of two fixed strings
 *               keyed on pass/fail. This is the leak-free pass/fail control.
 *   • naive   — reads NOTHING from the verdict. The next prompt is one fixed
 *               continuation string every round. This is the leak-free
 *               no-signal control.
 *
 * The `dumb → refine` gap measured on the same task therefore isolates how much
 * the grader's findings (its notes/scores) inflate the result beyond a bare
 * pass/fail signal: it is exactly the delta between reading `verdict.valid` and
 * reading `verdict.notes`. The `naive → dumb` gap isolates the value of the
 * pass/fail bit alone. Run all three against one task to attribute a loop's
 * lift to its actual source instead of crediting it to the grader for free.
 *
 * GENERALITY CONTRACT
 * -------------------
 * These builders carry ZERO domain coupling:
 *   • The continuation strings are PARAMETERS. The caller passes its own text;
 *     the substrate hardcodes none.
 *   • The Task shape is OPAQUE. The builder never assumes a `prompt` field (or
 *     any field). The caller supplies `applyContinuation(task, text) → Task`,
 *     which folds a steering string into the caller's own Task shape — exactly
 *     symmetric with the caller-supplied `AgentRunSpec.taskToPrompt`. For a Task
 *     that is `{ prompt: string; … }`, the fold is the one-liner
 *     `(task, text) => ({ ...task, prompt: text })`.
 *
 * They consume nothing the loop kernel does not already give `plan()`/`decide()`
 * — `runLoop` requires no change. A benchmark picks a driver by name and the
 * kernel does the rest.
 *
 * @experimental
 */

import type { Driver, Iteration } from './types'

/**
 * Terminal-or-continue decision shared by all three steering drivers. The
 * non-terminal `'refine'` keeps the loop running another shot; the terminal
 * `'pick-winner'`/`'fail'` stop it (`isTerminalDecision` in run-loop.ts treats
 * `'pick-winner'` and `'fail'` as terminal and any other string as a request
 * for another round). Identical to the reference refine driver's decision set.
 */
export type SteeringDecision = 'refine' | 'pick-winner' | 'fail'

/**
 * Fold a steering string into the caller's Task shape, producing the Task for
 * the next shot. The substrate never assumes how a Task carries its prompt, so
 * the caller supplies this — the same way it supplies `taskToPrompt`. The
 * original `task` is passed so the fold can preserve task-level fields (ids,
 * fixtures, feature names) and replace only the instruction.
 */
export type ApplyContinuation<Task> = (task: Task, continuation: string) => Task

/**
 * Shared `decide()` for the steering drivers. Verbatim semantics of the
 * reference refine driver: a valid iteration anywhere → terminal `'pick-winner'`;
 * otherwise `'refine'` (non-terminal, run another shot) while history is under
 * the shot cap, else terminal `'fail'`. Pure over history; reads only
 * `verdict.valid` (never notes/scores) so it adds no leak of its own.
 */
function decideUntilValidOrCapped<Task, Output>(
  history: ReadonlyArray<Iteration<Task, Output>>,
  maxIterations: number,
): SteeringDecision {
  if (history.some((it) => it.verdict?.valid)) return 'pick-winner'
  return history.length < maxIterations ? 'refine' : 'fail'
}

/** Options for {@link naiveDriver}. */
export interface NaiveDriverOptions<Task> {
  /**
   * The fixed continuation issued every round after shot 0. The same string is
   * sent whether the prior shot passed inspection or not — the naive driver
   * reads no part of the verdict. Domain text is the caller's; the substrate
   * supplies none.
   */
  continuation: string
  /** Folds `continuation` into the caller's Task shape for the next shot. */
  applyContinuation: ApplyContinuation<Task>
  /** Hard shot cap. The loop stops refining once history reaches this length. */
  maxIterations: number
  /** Trace-event identifier. Default `'naive'`. */
  name?: string
}

/**
 * `naiveDriver` — the no-signal steering control.
 *
 * `plan()` runs the initial `task` at shot 0, then issues the SAME fixed
 * `continuation` every subsequent round until a shot is valid or the cap is
 * hit. It reads NOTHING from `history[last].verdict` — not `.valid`, not
 * `.notes`, not `.scores`. It is the floor a coached loop must beat to earn its
 * coaching: any lift over naive that is not also present in `dumb` is
 * attributable to the pass/fail bit, and any lift of `refine` over `dumb` is
 * attributable to the grader's findings.
 */
export function naiveDriver<Task, Output>(
  options: NaiveDriverOptions<Task>,
): Driver<Task, Output, SteeringDecision> {
  const { continuation, applyContinuation, maxIterations, name = 'naive' } = options
  return {
    name,
    plan(task, history) {
      if (history.length === 0) return Promise.resolve([task])
      const last = history[history.length - 1]
      // Stop once a shot is valid or the cap is reached. The verdict is read
      // ONLY for `.valid` here, never to compose the prompt — the continuation
      // is fixed regardless of how the prior shot scored.
      if (last?.verdict?.valid) return Promise.resolve([])
      if (history.length >= maxIterations) return Promise.resolve([])
      return Promise.resolve([applyContinuation(task, continuation)])
    },
    decide(history) {
      return decideUntilValidOrCapped(history, maxIterations)
    },
    // Pure refine topology (one task per round) — render the steer move.
    describePlan() {
      return { kind: 'refine', rationale: 'naive fixed continuation (no grade signal)' }
    },
  }
}

/** Options for {@link dumbDriver}. */
export interface DumbDriverOptions<Task> {
  /**
   * Continuation issued when the prior shot's verdict is valid. In a
   * stop-on-pass loop this is rarely reached (a valid shot ends the loop), but
   * it is required so the driver is total over the pass/fail bit; pass a
   * confirmation/keep-going string.
   */
  onPass: string
  /** Continuation issued when the prior shot's verdict is NOT valid. */
  onFail: string
  /** Folds the chosen continuation into the caller's Task shape. */
  applyContinuation: ApplyContinuation<Task>
  /** Hard shot cap. The loop stops refining once history reaches this length. */
  maxIterations: number
  /** Trace-event identifier. Default `'dumb'`. */
  name?: string
}

/**
 * `dumbDriver` — the pass/fail-only steering control.
 *
 * `plan()` runs the initial `task` at shot 0, then reads ONLY
 * `history[last].verdict.valid` (the boolean) and issues `onPass` or `onFail`
 * accordingly. It MUST NOT read `.notes` or `.scores` — that boundary is the
 * leak-free firewall. A `verdict` with no `valid` set (or no verdict) is
 * treated as not-valid, so the driver is total and never throws on a
 * grader/transport gap.
 *
 * The `dumb → refine` gap is the headline measurement: refine reads the
 * grader's `notes`, dumb reads only the pass/fail bit, so the difference is
 * exactly the value the findings add over a bare boolean.
 */
export function dumbDriver<Task, Output>(
  options: DumbDriverOptions<Task>,
): Driver<Task, Output, SteeringDecision> {
  const { onPass, onFail, applyContinuation, maxIterations, name = 'dumb' } = options
  return {
    name,
    plan(task, history) {
      if (history.length === 0) return Promise.resolve([task])
      const last = history[history.length - 1]
      const passed = last?.verdict?.valid === true
      if (passed) return Promise.resolve([])
      if (history.length >= maxIterations) return Promise.resolve([])
      // The ONLY verdict read in the steering path: the pass/fail boolean.
      // `.notes`/`.scores` are deliberately never touched.
      const continuation = passed ? onPass : onFail
      return Promise.resolve([applyContinuation(task, continuation)])
    },
    decide(history) {
      return decideUntilValidOrCapped(history, maxIterations)
    },
    describePlan() {
      return { kind: 'refine', rationale: 'dumb pass/fail-only continuation (no grader findings)' }
    },
  }
}
