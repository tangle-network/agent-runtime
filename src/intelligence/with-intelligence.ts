/**
 *
 * `withIntelligence` — the ONE agent-runtime hook that unifies Tangle
 * Intelligence send + receive.
 *
 * It does two things per call, both fail-open:
 *   1. RECEIVE — pull the tenant's certified profile from the deployed plane
 *      (cached + refreshed), hand the agent the certified prompt surface to fold
 *      (`applied.composePrompt`) and the promoted, gate-certified profile DIFFS
 *      as PROPOSALS (`applied.proposals` / `applied.applyProfile`).
 *   2. SEND — serialize a typed {@link RunRecord} for the call through the shipped
 *      OTLP builders to the plane's `/v1/otlp` ingest, best-effort.
 *
 * SAFETY — observe + deliver ONLY. This hook NEVER auto-applies a received diff
 * at runtime. A promoted diff is surfaced as a proposal; a human, or the gated
 * local `improve()` loop, turns a proposal into a shipped profile. That
 * preserves the held-out invariant the plane enforces — a runtime that silently
 * folded an un-gated diff into itself would defeat the very gate the diff cleared.
 *
 *   import { withIntelligence } from '@tangle-network/agent-runtime/intelligence'
 *
 *   export const agent = withIntelligence(
 *     async (input, applied) => {
 *       const out = await myAgent(input, { systemPrompt: applied.composePrompt(BASE) })
 *       applied.record({ success: true, usage: { inferenceUsd: 0.002, intelligenceUsd: 0 } })
 *       return out
 *     },
 *     { project: 'support-agent', target: 'support-agent' },
 *   )
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { applyAgentProfileDiff } from '@tangle-network/agent-interface'
import {
  type CertifiedProfile,
  composeCertifiedPrompt,
  createCertifiedPromptSource,
  type ProposedProfileDiff,
} from './delivery'
import {
  createIntelligenceClient,
  type IntelligenceConfig,
  type RunRecord,
  type RunReport,
} from './index'

/** What the hook hands the agent each run. Additive over the prompt-only
 *  delivery: `composePrompt` folds the certified prompt surface (as before);
 *  `proposals`/`applyProfile` surface the promoted profile DIFFS — never
 *  auto-applied; `record` enriches the {@link RunRecord} that is sent. */
export interface AppliedIntelligence {
  /** The certified profile in effect (null when none promoted / pull failed —
   *  fail-closed: the agent runs on its base surface). */
  certified: CertifiedProfile | null
  /** Fold the certified prompt surface into a base system prompt (the promoted
   *  prompt). The consumer opts in by calling it. */
  composePrompt(base: string): string
  /** The promoted, gate-certified profile diffs — surfaced for a human or the
   *  gated `improve()` loop. NEVER auto-applied by this hook. Empty when none. */
  proposals: ProposedProfileDiff[]
  /** Fold every proposal into `base` via `applyAgentProfileDiff`, in promotion
   *  order, and return the result. The caller invokes this EXPLICITLY (it is the
   *  human/gated apply step) — the hook never calls it on the run path. */
  applyProfile(base: AgentProfile): AgentProfile
  /** Enrich the {@link RunRecord} sent for this call — outcome, usage split,
   *  model/provider, and the loop event stream. Optional; an un-recorded run
   *  still sends input/output with an inference-only zero usage split. */
  record(report: RunReport): void
}

/** An agent wrapped by {@link withIntelligence}: receives the input plus the
 *  intelligence delivered for this run. */
export type IntelligenceAgent<I, O> = (input: I, applied: AppliedIntelligence) => Promise<O>

/** `withIntelligence` config = the Observe config plus the pull target, refresh
 *  cadence, and a proposals callback. One base URL (`baseUrl` /
 *  `TANGLE_INTELLIGENCE_URL`) drives both the send and receive paths. */
export interface IntelligenceHookConfig extends IntelligenceConfig {
  /** Pull target. Defaults to `project`. */
  target?: string
  /** Min interval between certified-profile pulls. Default 5m. */
  refreshMs?: number
  /** Per-pull timeout in ms (fail-closed on a hung plane). Default 10000. */
  timeoutMs?: number
  /** fetch impl for the pull (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Notified when a refresh delivers a NEW set of promoted proposals (by
   *  provenance content hash). Surfaces diffs without auto-applying them. */
  onProposals?: (proposals: ProposedProfileDiff[]) => void
}

/** The wrapped agent — same `(input) => Promise<output>` shape, plus a manual
 *  `refresh()` and a `proposals()` accessor for the currently-promoted diffs. */
export type IntelligenceWrapped<I, O> = ((input: I) => Promise<O>) & {
  refresh(): Promise<void>
  proposals(): ProposedProfileDiff[]
}

/**
 * Wrap an agent so it (a) RECEIVES the tenant's certified profile — the prompt
 * surface to fold and the promoted profile diffs as proposals — and (b) SENDS a
 * typed {@link RunRecord} per call to the plane. The pull is cached and refreshed
 * at most every `refreshMs`; a failed pull is fail-closed (the agent runs on its
 * base surface, never breaks because Intelligence is unreachable). The send is
 * best-effort — an export failure never fails the agent's turn — while an error
 * thrown by the agent itself propagates unchanged.
 */
export function withIntelligence<I, O>(
  agent: IntelligenceAgent<I, O>,
  config: IntelligenceHookConfig,
): IntelligenceWrapped<I, O> {
  const client = createIntelligenceClient(config)
  const target = config.target ?? config.project
  const source = createCertifiedPromptSource({
    target,
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.fetchImpl !== undefined ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.refreshMs !== undefined ? { refreshMs: config.refreshMs } : {}),
  })

  const currentProposals = (): ProposedProfileDiff[] => source.current()?.agentProfileDiffs ?? []

  // Fire `onProposals` only when the promoted set actually changes (keyed by
  // provenance content hash) — a refresh that re-delivers the same diffs is silent.
  let lastSignal = ''
  function signalProposals(): void {
    const proposals = currentProposals()
    if (proposals.length === 0) return
    const sig = proposals.map((p) => p.provenance.contentHash).join('|')
    if (sig === lastSignal) return
    lastSignal = sig
    config.onProposals?.(proposals)
  }

  async function refresh(): Promise<void> {
    await source.refresh()
    signalProposals()
  }

  const wrapped = (async (input: I): Promise<O> => {
    await refresh()
    const certified = source.current()
    const proposals = currentProposals()
    const report: RunReport = {}
    const applied: AppliedIntelligence = {
      certified,
      composePrompt: (base: string) => composeCertifiedPrompt(base, certified),
      proposals,
      applyProfile: (base: AgentProfile) =>
        proposals.reduce((profile, p) => applyAgentProfileDiff(profile, p.diff), base),
      record: (r: RunReport) => Object.assign(report, r),
    }

    const output = await agent(input, applied)

    const usage = {
      inferenceUsd: report.usage?.inferenceUsd ?? report.costUsd ?? 0,
      intelligenceUsd: report.usage?.intelligenceUsd ?? 0,
    }
    const record: RunRecord = {
      runId: client.freshRunId(),
      traceId: client.freshTraceId(),
      project: config.project,
      target,
      input,
      output,
      outcome: {
        ...(report.success !== undefined ? { success: report.success } : {}),
        ...(report.score !== undefined ? { score: report.score } : {}),
        usage,
      },
      ...(report.model !== undefined ? { model: report.model } : {}),
      ...(report.provider !== undefined ? { provider: report.provider } : {}),
      ...(report.loopEvents !== undefined ? { loopEvents: report.loopEvents } : {}),
    }
    // Best-effort: a send failure never fails the agent's turn.
    client.exportRunRecord(record)
    return output
  }) as IntelligenceWrapped<I, O>

  wrapped.refresh = refresh
  wrapped.proposals = currentProposals
  return wrapped
}
