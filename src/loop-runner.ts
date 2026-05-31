/**
 * @experimental
 *
 * `runDelegatedLoop` — the configured delegated loop-runner.
 *
 * One typed entrypoint a worker agent (or a scheduled routine) calls to run a
 * disciplined loop in a chosen MODE, over agent-runtime's hardened engines:
 *
 *   code         → build-in-a-loop via the coder delegate (no-op + secret floor,
 *                  optional reviewer gate, winner-selection)
 *   review       → code mode with a REQUIRED reviewer (the gate is the point)
 *   research     → research-in-a-loop with valid-only KB growth (createKbGate)
 *   audit        → analyze trace/run data → findings (runAnalystLoop, caller-wired)
 *   self-improve → identity-gated prompt optimization (optimizePrompt, caller-wired)
 *   dynamic      → agent-authored topology (runLoop + createDynamicDriver)
 *
 * It is intentionally a thin façade: the value is that EVERY product reuses the
 * one hardened engine instead of forking delegation logic. The dispatcher owns
 * mode routing, timing, fail-loud on an unregistered mode, and a uniform result
 * shape; each mode's engine is a pre-configured runner in the registry (build it
 * with the factories below, or inject your own / a stub).
 */

import { ConfigError } from './errors'
import type { LoopSandboxClient } from './loops'
import {
  type CoderReviewer,
  type CoderWinnerSelection,
  createDefaultCoderDelegate,
  type DelegateRunCtx,
} from './mcp/delegates'
import type { DelegateCodeArgs } from './mcp/types'
import type { CoderOutput } from './profiles/coder'

/** @experimental */
export type DelegatedLoopMode =
  | 'code'
  | 'review'
  | 'research'
  | 'audit'
  | 'self-improve'
  | 'dynamic'

/** @experimental A pre-configured loop for one mode. Returns the mode's raw
 *  output; the dispatcher wraps it in a {@link DelegatedLoopResult}. */
export type DelegatedLoopRunner<T = unknown> = (signal: AbortSignal) => Promise<T>

/** @experimental Mode → configured runner. Partial: only register the modes a
 *  given product/routine actually uses. */
export type DelegatedLoopRegistry = Partial<Record<DelegatedLoopMode, DelegatedLoopRunner>>

/** @experimental Uniform result — never throws from a registered runner; a
 *  thrown engine becomes `{ ok: false, error }` so a routine can record + move on. */
export interface DelegatedLoopResult<T = unknown> {
  mode: DelegatedLoopMode
  ok: boolean
  output?: T
  error?: string
  durationMs: number
}

/** @experimental */
export interface RunDelegatedLoopOptions {
  signal?: AbortSignal
  /** Clock override for deterministic tests. */
  now?: () => number
}

/**
 * @experimental
 *
 * Dispatch a configured loop by mode. Fails loud (throws `ConfigError`) when no
 * runner is registered for the mode — a routine pointed at an unwired mode is a
 * config bug, not a silent no-op. A runner that throws is captured as
 * `{ ok: false }` so unattended runs record the failure rather than crash.
 */
export async function runDelegatedLoop<T = unknown>(
  mode: DelegatedLoopMode,
  registry: DelegatedLoopRegistry,
  options: RunDelegatedLoopOptions = {},
): Promise<DelegatedLoopResult<T>> {
  const runner = registry[mode] as DelegatedLoopRunner<T> | undefined
  if (!runner) {
    throw new ConfigError(
      `runDelegatedLoop: no runner registered for mode '${mode}' (registered: ${
        Object.keys(registry).join(', ') || 'none'
      })`,
    )
  }
  const now = options.now ?? Date.now
  const signal = options.signal ?? new AbortController().signal
  const start = now()
  try {
    const output = await runner(signal)
    return { mode, ok: true, output, durationMs: now() - start }
  } catch (err) {
    return {
      mode,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: now() - start,
    }
  }
}

/** @experimental Options for the default `code`/`review` runner. */
export interface CoderLoopRunnerOptions {
  sandboxClient: LoopSandboxClient
  /** What to build — the delegate args (goal, repoRoot, variants, config, …). */
  args: DelegateCodeArgs
  /** Adversarial reviewer. REQUIRED for `review` mode (see `reviewLoopRunner`). */
  reviewer?: CoderReviewer
  /** Winner-selection strategy. Default `highest-score`. */
  winnerSelection?: CoderWinnerSelection
  /** Harnesses for `variants > 1` fanout. */
  fanoutHarnesses?: string[]
}

/** @experimental Build a `code`-mode runner over the hardened coder delegate. */
export function coderLoopRunner(options: CoderLoopRunnerOptions): DelegatedLoopRunner<CoderOutput> {
  const delegate = createDefaultCoderDelegate({
    sandboxClient: options.sandboxClient,
    ...(options.reviewer ? { reviewer: options.reviewer } : {}),
    ...(options.winnerSelection ? { winnerSelection: options.winnerSelection } : {}),
    ...(options.fanoutHarnesses ? { fanoutHarnesses: options.fanoutHarnesses } : {}),
  })
  return async (signal) => {
    const ctx: DelegateRunCtx = { signal, report: () => {} }
    return delegate(options.args, ctx)
  }
}

/**
 * @experimental
 *
 * `review` mode = `code` with a REQUIRED reviewer. The gate is the whole point,
 * so the type forces a reviewer (a "review loop" with no reviewer is a code loop).
 */
export function reviewLoopRunner(
  options: CoderLoopRunnerOptions & { reviewer: CoderReviewer },
): DelegatedLoopRunner<CoderOutput> {
  return coderLoopRunner(options)
}
