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
  routerChatWithUsage,
} from '@tangle-network/agent-runtime/loops'
// `BackendType` is the sandbox SDK's harness union — its canonical home. agent-runtime consumes
// it from there too; it is not re-exported from the loops barrel.
import type { BackendType } from '@tangle-network/sandbox'

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
    const { content } = await routerChatWithUsage(cfg, [
      {
        role: 'system',
        content:
          "You review an AI agent's previous attempt at a task. From the task, the attempt's output, and its execution trace ALONE, judge whether it correctly and completely solved the task. If you find a specific fault — a wrong value, a guessed API signature, a missing step, a misread requirement — name it and give the concrete correction in 1-3 sentences. Reply exactly 'no change needed' if the attempt looks correct and complete.",
      },
      {
        role: 'user',
        content: `Task:\n${task ?? '(task unavailable)'}\n\nPrevious answer:\n${last?.output ?? '(none)'}\n\nTrace tail:\n${traceTail}`,
      },
    ])
    return content
  }

/** Cost-dial backend = the SDK's canonical `BackendType` (single source of truth; no local
 *  literal copy that drifts from the harness set). `hermes` = the inference-router agent (the
 *  cheap "router llm-call" dial); the rest are agent CLIs. The ONLY knob that changes which
 *  agent runs — no per-backend worker. */
export type WorkerBackendType = BackendType

/** Build the standard sandbox `AgentRunSpec` for a benchmark — the worker the
 *  kernel injects. `backendType` is the cost dial. Model auth is the BOX'S OWN
 *  provisioned credential: `backend.model` pins provider/model/baseUrl only, and
 *  the platform generates the in-box provider config keyed to
 *  `{env:OPENCODE_MODEL_API_KEY}`. Never pass an external router key into the
 *  box — the egress proxy rejects foreign credentials (403, empty output). */
export function sandboxAgentRun(opts: {
  model: string
  routerBaseUrl: string
  backendType?: WorkerBackendType
  /** In-box model provider. Default `openai` (registered models like gpt-4.1).
   *  Cheap router models (deepseek/kimi/glm) are not in opencode's `openai`
   *  registry and 404 in-box — pass `openai-compat` (generic passthrough). */
  provider?: string
  name?: string
  taskToPrompt?: (task: string) => string
  /** Extra box-level env (e.g. `TANGLE_SEARCH_DEFAULT_PROVIDER` to pin the in-box
   *  agent's web-search provider, provider keys like EXA_API_KEY). Allowlisted
   *  keys only reach the spawned CLI. Must NOT carry router/model credentials. */
  env?: Record<string, string>
  /** The developer's AgentProfile — the one knob for "which agent" (prompt / model /
   *  tools / mcp). Spread through verbatim; the backend cost-dial is tagged into
   *  metadata. Omitted ⇒ a minimal worker profile. */
  profile?: AgentProfile
}): AgentRunSpec<string> {
  const backendType = opts.backendType ?? 'opencode'
  const name = opts.profile?.name ?? opts.name ?? `${backendType}-worker`
  return {
    profile: { ...opts.profile, name, metadata: { ...opts.profile?.metadata, backendType } },
    name,
    taskToPrompt: opts.taskToPrompt ?? ((t) => t),
    sandboxOverrides: {
      ...(opts.env ? { env: opts.env } : {}),
      backend: {
        type: backendType,
        model: { provider: opts.provider ?? 'openai', model: opts.model, baseUrl: opts.routerBaseUrl },
      },
    },
  }
}
