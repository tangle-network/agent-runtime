/**
 *
 * `delegate` MCP tool — the agent-facing front door to `delegate()` / `supervise()`.
 *
 * `delegate` is SYNCHRONOUS: it awaits the full supervised run and returns the delivered output
 * TOGETHER WITH `spentTotal` — the conserved cost of the whole delegation (`iterations` / `tokens` /
 * `usd` / `ms`), so the caller always learns what the delegation actually spent.
 *
 * The complete supervisor profile, execution backends, budgets, and completion check are injected at
 * server construction. The call supplies only the intent and its run identity.
 *
 * @experimental
 */

import { type DelegateOptions, delegate } from '../../runtime/supervise/delegate'
import type { SuperviseOptions } from '../../runtime/supervise/supervise'
import type { Spend, SupervisedResult } from '../../runtime/supervise/types'

/** MCP tool name for the `delegate` generic-delegation tool. @experimental */
export const DELEGATE_TOOL_NAME = 'delegate'

/** JSON Schema for `delegate` tool arguments. @experimental */
export const DELEGATE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      description: 'What you want accomplished, as an outcome. The supervisor authors the worker.',
    },
    runId: {
      type: 'string',
      description: 'Stable trace and replay identity for this delegation.',
    },
  },
  required: ['intent', 'runId'],
  additionalProperties: false,
} as const

/** Parsed `delegate` tool arguments. */
export interface DelegateArgs {
  intent: string
  runId: string
}

/** Parse and validate raw MCP tool input into typed `DelegateArgs`; throws `TypeError` on bad input. @experimental */
export function validateDelegateArgs(raw: unknown): DelegateArgs {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate: arguments must be an object')
  }
  const value = raw as Record<string, unknown>
  const intent = value.intent
  if (typeof intent !== 'string' || intent.trim().length === 0) {
    throw new TypeError('delegate: `intent` must be a non-empty string')
  }
  if (typeof value.runId !== 'string' || value.runId.trim().length === 0) {
    throw new TypeError('delegate: `runId` must be a non-empty string')
  }
  return { intent: intent.trim(), runId: value.runId }
}

/** The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or
 *  the no-winner reason) PLUS the conserved spend of the whole delegation. */
export type DelegateResult =
  | { status: 'winner'; out: unknown; outRef: string; spentTotal: Spend }
  | { status: 'no-winner'; reason: string; spentTotal: Spend }

/** @experimental */
export interface DelegateHandlerOptions extends Omit<SuperviseOptions, 'runId'> {
  /** Model-visible tool description, supplied by the product/profile that knows its intended use. */
  description: string
  profile: DelegateOptions['profile']
}

/** Project a `SupervisedResult` onto the tool's flat `DelegateResult`. Both variants carry the real
 *  conserved `spentTotal`, so the agent always learns the cost — even on a no-winner, never a faked
 *  output and never a fabricated zero spend. */
function toDelegateResult(result: SupervisedResult<unknown>): DelegateResult {
  if (result.kind === 'no-winner') {
    return { status: 'no-winner', reason: result.reason, spentTotal: result.spentTotal }
  }
  return {
    status: 'winner',
    out: result.out,
    outRef: result.outRef,
    spentTotal: result.spentTotal,
  }
}

/**
 * Build the `delegate` tool handler. Closes over the injected supervisor substrate (`router` /
 * `backend` / `deliverable`); each call routes the agent's intent to `delegate()` and returns the
 * delivered output with its conserved cost.
 */
export function createDelegateHandler(
  options: DelegateHandlerOptions,
): (raw: unknown) => Promise<DelegateResult> {
  return async (raw) => {
    const args = validateDelegateArgs(raw)
    const { description: _description, ...configured } = options
    const opts: DelegateOptions = { ...configured, runId: args.runId }
    const result = await delegate(args.intent, opts)
    return toDelegateResult(result)
  }
}
