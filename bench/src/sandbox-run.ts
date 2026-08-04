/**
 * Shared sandbox-rollout helpers for the bench harnesses.
 *
 * The worker plumbing every sandbox-backed bench needs, independent of how the
 * loop is driven: build the standard `AgentRunSpec` (`sandboxAgentRun`), parse
 * the agent's final answer from the event stream (`answerOutput`), name the
 * cost-dial backend (`WorkerBackendType`), and run a single-model "review the
 * prior attempt" analyst (`llmAnalyst`/`AnalystFn`). These are pure profile /
 * backend / parsing plumbing — no experiment shell, no topology arms.
 */

import {
  type AgentProfile,
  type AgentRunSpec,
  type OutputAdapter,
} from '@tangle-network/agent-runtime/kernel'
import { parseExactAgentProfile } from '@tangle-network/agent-runtime'
// `BackendType` is the sandbox SDK's harness union and its canonical home. Runtime consumes it
// from there too; benchmark profiles use the same values as their exact harness identity.
import type { BackendType } from '@tangle-network/sandbox'
import { assertExecutableAgentProfile } from '../../src/runtime/supervise/model-policy'
import { benchRouterProfile, runBenchRouterTurn } from './router-turn'

/** Parse the agent's final answer from the event stream (harness-agnostic).
 *  The default deliverable; a benchmark whose artifact is a file overrides via
 *  its own `OutputAdapter` that reads from the run. */
export const answerOutput: OutputAdapter<string> = {
  parse(events) {
    let answer = ''
    for (const ev of events) {
      const d = (ev as { data?: Record<string, unknown> })?.data
      const t = d?.finalText ?? d?.text ?? d?.result
      if (typeof t === 'string' && t.length > 0) answer = t
    }
    return answer
  },
}

/** What an analyst sees of each prior attempt: its output, its verdict, and its
 *  raw trace events. The events are the trace an analyst reads. */
export type SteerHistory = ReadonlyArray<{
  output?: string
  verdict?: { valid?: boolean; score?: number; notes?: string }
  events?: readonly unknown[]
}>

/**
 * The investigation: read the prior attempt's trace, return targeted feedback for
 * the next one. It observes BEHAVIOR (output, trace), never the judge's verdict —
 * the selector != judge firewall.
 */
export type AnalystFn = (history: SteerHistory, task?: string) => Promise<string>

/** Simple analyst: ONE model call reads the public task plus a bounded view of the
 *  last attempt (its output + a tail of its trace events) and returns a concrete
 *  correction. Selector != judge firewall: it NEVER reads the held-out judge's
 *  verdict or failure detail — that would be a non-deployable oracle gradient
 *  toward the reference answer. A deployable steerer must locate the fault from the
 *  task and the agent's own behavior alone. */
export const llmAnalyst = (cfg: { routerBaseUrl: string; routerKey: string; model: string }): AnalystFn =>
  async (history, task) => {
    const last = history.at(-1)
    const traceTail = (last?.events ?? [])
      .slice(-12)
      .map((e) => (typeof e === 'string' ? e : JSON.stringify(e)))
      .join('\n')
      .slice(-2000)
    const systemPrompt =
      "You review an AI agent's previous attempt at a task. From the task, the attempt's output, and its execution trace ALONE, judge whether it correctly and completely solved the task. If you find a specific fault — a wrong value, a guessed API signature, a missing step, a misread requirement — name it and give the concrete correction in 1-3 sentences. Reply exactly 'no change needed' if the attempt looks correct and complete."
    const turn = await runBenchRouterTurn(
      {
        routerBaseUrl: cfg.routerBaseUrl,
        routerKey: cfg.routerKey,
        profile: benchRouterProfile('sandbox-run-analyst', cfg.model, { systemPrompt }),
      },
      `Task:\n${task ?? '(task unavailable)'}\n\nPrevious answer:\n${last?.output ?? '(none)'}\n\nTrace tail:\n${traceTail}`,
    )
    return turn.finalText
  }

/** Cost-dial backend = the SDK's canonical `BackendType` (single source of truth; no local
 *  literal copy that drifts from the harness set). `hermes` = the inference-router agent (the
 *  cheap "router llm-call" dial); the rest are agent CLIs. The ONLY knob that changes which
 *  agent runs — no per-backend worker. */
export type WorkerBackendType = BackendType

/** Build the standard sandbox `AgentRunSpec` for a benchmark. The complete profile is the only
 * behavioral input: its harness selects the box backend and its provider/model select inference.
 * Extra sandbox env remains infrastructure, not a second model-selection path. */
export function sandboxAgentRun(opts: {
  profile: AgentProfile
  taskToPrompt?: (task: string) => string
  /** Extra box-level env (e.g. `TANGLE_SEARCH_DEFAULT_PROVIDER` to pin the in-box
   *  agent's web-search provider, provider keys like EXA_API_KEY). Allowlisted
   *  keys only reach the spawned CLI. Must NOT carry router/model credentials. */
  env?: Record<string, string>
}): AgentRunSpec<string> {
  const profile = parseExactAgentProfile(opts.profile, 'sandboxAgentRun profile')
  assertExecutableAgentProfile(profile, 'sandboxAgentRun profile')
  const name = profile.name ?? 'sandbox-worker'
  return {
    profile,
    name,
    taskToPrompt: opts.taskToPrompt ?? ((t) => t),
    ...(opts.env ? { sandboxOverrides: { env: opts.env } } : {}),
  }
}
