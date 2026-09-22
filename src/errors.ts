/** Runtime-specific errors plus direct agent-eval error exports. */

import { AgentEvalError } from '@tangle-network/agent-eval'

export {
  AgentEvalError,
  type AgentEvalErrorCode,
  ConfigError,
  JudgeError,
  NotFoundError,
  ValidationError,
} from '@tangle-network/agent-eval'

/**
 *
 * A runtime-run lifecycle method was called in an order the state machine does
 * not allow: `persist()` before `complete()`, `complete()` twice, etc.
 *
 * @stable
 */
export class RuntimeRunStateError extends AgentEvalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('validation', message, options)
  }
}

/**
 *
 * The dynamic-loop planner returned an unusable topology move — the LLM emitted
 * no parseable envelope, an unknown `kind`, or a structurally-invalid move
 * (e.g. a fanout with zero tasks). This is a structural failure of the
 * agent-authored topology, not a config mistake: the planner ran but its output
 * cannot drive the kernel. Carries `validation` so cross-package handlers can
 * pattern-match without importing the runtime. Fail loud — never substitute a
 * default move, or the loop silently runs a topology nobody chose.
 *
 * @stable
 */
export class PlannerError extends AgentEvalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('validation', message, options)
  }
}

/**
 * The analyst loop could not read or run over a round's trace — e.g. an empty round
 * (no iterations to analyze) or a malformed trace projection. Fail loud: a silent empty
 * store would mask a broken capture path and the driver would steer on nothing.
 */
export class AnalystError extends AgentEvalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('validation', message, options)
  }
}
