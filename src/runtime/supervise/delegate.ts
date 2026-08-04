/**
 *
 * `delegate` — the one generic delegation verb. You hand it an INTENT (what you want done) and it
 * hands that intent to a default AUTHORING supervisor: a router-brained supervisor whose standing
 * instruction is `supervisorInstructions()` (the authoring-agent-profiles skill). The supervisor
 * DECOMPOSES the intent and AUTHORS the worker profile it needs per sub-task — there is NO hardcoded
 * coder/researcher profile here. That is the whole point: `delegate('fix the failing test', …)` and
 * `delegate('research X and cite sources', …)` route through the SAME front door; the supervisor
 * writes a code-shaped or research-shaped worker on its own.
 *
 * It is a thin wrapper over `supervise()` — the one front door — so the conserved-budget pool, the
 * completion oracle (`deliverable`), the coordination toolbox, and equal-compute accounting all come
 * for free; nothing is hand-rolled. The result is `supervise()`'s `SupervisedResult` returned
 * UNCHANGED, so its `spentTotal` (`{ iterations, tokens, usd, ms }`) rides straight back to the
 * caller on BOTH paths — a `winner` carries the delivered worker's spend, a `no-winner` carries the
 * spend incurred before it failed. That cost channel means a `delegate()` caller always learns what
 * the delegation actually spent.
 *
 * @experimental
 */

import { ConfigError } from '../../errors'
import type { RouterTransportConfig } from '../router-client'
import type { DeliverableSpec } from './completion-gate'
import type { ExecutorConfig } from './runtime'
import { supervise } from './supervise'
import type { SupervisorProfile } from './supervisor-agent'
import type { Budget, SupervisedResult } from './types'

/** The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`.
 *  A modest token ceiling + a small iteration ceiling — generous enough for a few-worker decompose,
 *  bounded enough that an unsupervised intent cannot run away. Callers override via `opts.budget`. */
export const defaultDelegateBudget: Budget = { maxIterations: 50, maxTokens: 200_000 }

/** Inputs to {@link delegate}. The intent is the first positional arg; everything here is optional
 *  with explicit execution identity, so the common call names one exact supervisor profile. */
export interface DelegateOptions<Out = unknown> {
  /** The completion oracle (settled ⟺ delivered) the authored workers settle against. Strongly
   *  recommended — without it the supervisor trusts a worker's self-report. For a code intent,
   *  `patchDelivered()` is the canonical example; for a free-form answer, a content check. */
  readonly deliverable?: DeliverableSpec<Out>
  /** WHERE the authored workers run — the worker-execution backend (`router-tools` / `sandbox` /
   *  `cli-worktree` / …). The supervisor authors the worker PROFILE; this is the substrate it runs
   *  on. Provide this OR `makeWorkerAgent`-style wiring through `supervise()` is unavailable. */
  readonly backend?: ExecutorConfig
  /** The conserved compute pool for the whole delegation. Defaults to {@link defaultDelegateBudget}. */
  readonly budget?: Budget
  /** Exact executable authoring supervisor. Model, prompt, harness, and provider live here. */
  readonly supervisorProfile: SupervisorProfile
  /** Router endpoint/auth for a `cli-base` supervisor; contains no behavioral settings. */
  readonly router: RouterTransportConfig
  /** Restrict the run to this subset of models (forwarded to `supervise()`). */
  readonly allowedModels?: readonly string[]
  readonly runId?: string
}

/**
 * Delegate an INTENT to a default authoring supervisor and return its `SupervisedResult` unchanged.
 *
 * The supervisor authors + spawns whatever worker the intent needs over the conserved-budget pool;
 * `result.spentTotal` reports what the whole delegation actually cost. A `winner` result carries the
 * authored worker's delivered output; a `no-winner` result names why (never a fabricated success).
 */
export async function delegate<Out = unknown>(
  intent: string,
  opts: DelegateOptions<Out>,
): Promise<SupervisedResult<Out>> {
  if (typeof intent !== 'string' || intent.trim().length === 0) {
    throw new ConfigError('delegate: `intent` must be a non-empty string')
  }
  return supervise(opts.supervisorProfile, intent, {
    budget: opts.budget ?? defaultDelegateBudget,
    ...(opts.backend ? { backend: opts.backend } : {}),
    ...(opts.deliverable ? { deliverable: opts.deliverable as DeliverableSpec<unknown> } : {}),
    router: opts.router,
    ...(opts.allowedModels ? { allowedModels: opts.allowedModels } : {}),
    ...(opts.runId ? { runId: opts.runId } : {}),
  }) as Promise<SupervisedResult<Out>>
}
