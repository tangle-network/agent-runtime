/**
 *
 * `delegate` MCP tool — the ONE generic delegation verb, the agent-facing front door to
 * `delegate()` / `supervise()`. The agent hands it an INTENT (what it wants done); a default
 * authoring supervisor decomposes the intent and AUTHORS the worker profile it needs — there is no
 * hardcoded coder/researcher profile, so one verb covers code, research, and anything else.
 *
 * `delegate` is SYNCHRONOUS: it awaits the full supervised run and returns the delivered output
 * TOGETHER WITH `spentTotal` — the conserved cost of the whole delegation (`iterations` / `tokens` /
 * `usd` / `ms`), so the caller always learns what the delegation actually spent.
 *
 * The supervisor's substrate (its brain `router`, the worker `backend`, the completion `deliverable`)
 * is INJECTED at server construction — never an agent-supplied arg. The agent supplies only the
 * intent (+ an optional per-call `model` / `runId`).
 *
 * @experimental
 */

import type { RouterConfig } from '../../runtime/router-client'
import type { DeliverableSpec } from '../../runtime/supervise/completion-gate'
import { type DelegateOptions, delegate } from '../../runtime/supervise/delegate'
import type { ExecutorConfig } from '../../runtime/supervise/runtime'
import type { Spend, SupervisedResult } from '../../runtime/supervise/types'

/** @experimental */
export const DELEGATE_TOOL_NAME = 'delegate'

/** @experimental */
export const DELEGATE_DESCRIPTION = [
  'Delegate an INTENT to a supervisor that AUTHORS and drives whatever worker the intent needs.',
  '',
  'Use when: you want a task done but do not want to specify HOW. State the outcome — "fix the',
  'failing auth test", "research competitor pricing with citations", "refactor the parser for',
  'clarity" — and the supervisor decomposes it, writes a tailored worker profile per sub-task, runs',
  'the workers over a conserved compute budget, and settles only when a deployable check passes.',
  '',
  'There is no fixed worker type: this ONE verb replaces separate code / research delegation. The',
  'supervisor picks the worker shape from your intent.',
  '',
  'Returns synchronously with the delivered result AND the real cost of the whole delegation',
  '(spentTotal: iterations, input/output tokens, usd, ms) — so you always know what it spent. A run',
  'that produced no delivered worker returns status "no-winner" with the reason; it never fabricates',
  'a success.',
].join('\n')

/** @experimental */
export const DELEGATE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      description: 'What you want accomplished, as an outcome. The supervisor authors the worker.',
    },
    model: {
      type: 'string',
      description: 'Optional per-call override for the supervisor brain model.',
    },
    runId: {
      type: 'string',
      description: 'Optional trace-correlation id for this delegation.',
    },
  },
  required: ['intent'],
  additionalProperties: false,
} as const

/** Parsed `delegate` tool arguments. */
export interface DelegateArgs {
  intent: string
  model?: string
  runId?: string
}

/** @experimental */
export function validateDelegateArgs(raw: unknown): DelegateArgs {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate: arguments must be an object')
  }
  const value = raw as Record<string, unknown>
  const intent = value.intent
  if (typeof intent !== 'string' || intent.trim().length === 0) {
    throw new TypeError('delegate: `intent` must be a non-empty string')
  }
  const args: DelegateArgs = { intent: intent.trim() }
  if (value.model !== undefined) {
    if (typeof value.model !== 'string') throw new TypeError('delegate: `model` must be a string')
    args.model = value.model
  }
  if (value.runId !== undefined) {
    if (typeof value.runId !== 'string') throw new TypeError('delegate: `runId` must be a string')
    args.runId = value.runId
  }
  return args
}

/** The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or
 *  the no-winner reason) PLUS the conserved spend of the whole delegation. */
export type DelegateResult =
  | { status: 'winner'; out: unknown; outRef: string; spentTotal: Spend }
  | { status: 'no-winner'; reason: string; spentTotal: Spend }

/** @experimental */
export interface DelegateHandlerOptions {
  /** The supervisor brain's router substrate (REQUIRED — the default supervisor is router-brained). */
  router: RouterConfig
  /** WHERE the authored workers run. Required for `supervise()` to spawn anything. */
  backend: ExecutorConfig
  /** The completion oracle the authored workers settle against (settled ⟺ delivered). */
  deliverable?: DeliverableSpec
  /** Default supervisor brain model when a call omits `model`. */
  model?: string
  /** Restrict the run to this subset of models. */
  allowedModels?: readonly string[]
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
    const opts: DelegateOptions = {
      backend: options.backend,
      router: options.router,
      model: args.model ?? options.model,
      ...(options.deliverable ? { deliverable: options.deliverable } : {}),
      ...(options.allowedModels ? { allowedModels: options.allowedModels } : {}),
      ...(args.runId ? { runId: args.runId } : {}),
    }
    const result = await delegate(args.intent, opts)
    return toDelegateResult(result)
  }
}
