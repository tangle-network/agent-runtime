/**
 *
 * `withIntelligence` — the ONE agent-runtime hook that unifies Tangle
 * Intelligence send + receive.
 *
 * It does two things per call, both fail-open:
 *   1. RECEIVE — pull the tenant's certified context from the deployed plane
 *      (cached + refreshed), and hand the agent the exact immutable context plus
 *      a helper that folds its context into the system prompt.
 *   2. SEND — serialize a typed {@link RunRecord} for the call through the shipped
 *      OTLP builders to the plane's `/v1/otlp` ingest, best-effort.
 *
 *   import { withIntelligence } from '@tangle-network/agent-runtime/intelligence'
 *
 *   export const agent = withIntelligence(
 *     async (input, applied) => {
 *       const out = await myAgent(input, { systemPrompt: applied.composePrompt(BASE) })
 *       applied.record({ success: true, usage: { inferenceUsd: 0.002, intelligenceUsd: 0 } })
 *       return out
 *     },
 *     { tenantId: 'tenant-1', project: 'support-agent', target: 'support-agent' },
 *   )
 *
 * @experimental
 */

import {
  type CertifiedContext,
  type CertifiedContextCheckpointStore,
  composeCertifiedContextPrompt,
  createCertifiedContextSource,
} from './delivery'
import {
  createIntelligenceClient,
  type IntelligenceConfig,
  type IntelligenceFlushResult,
  type RunRecord,
  type RunReport,
} from './index'

/** What the hook hands the agent each run. `composePrompt` folds certified
 * context and `record` enriches the {@link RunRecord} that is sent. */
export interface AppliedIntelligence {
  /** Stable ids shared by the run span and every nested runtime/loop span. */
  runId: string
  traceId: string
  /** The certified context in effect (null when none promoted / pull failed —
   *  fail-closed: the agent runs on its base surface). */
  certifiedContext: CertifiedContext | null
  /** Fold the certified prompt surface into a base system prompt (the promoted
   *  prompt). The consumer opts in by calling it. */
  composePrompt(base: string): string
  /** Enrich the {@link RunRecord} sent for this call — outcome, usage split,
   *  model/provider, and the loop event stream. Optional; an un-recorded run
   *  still sends input/output with an inference-only zero usage split. */
  record(report: RunReport): void
}

/** An agent wrapped by {@link withIntelligence}: receives the input plus the
 *  intelligence delivered for this run. */
export type IntelligenceAgent<I, O> = (input: I, applied: AppliedIntelligence) => Promise<O>

/** `withIntelligence` config = the Observe config plus tenant, pull target,
 *  refresh cadence, and a certified-context callback. One base URL (`baseUrl` /
 *  `TANGLE_INTELLIGENCE_URL`) drives both the send and receive paths. */
export interface IntelligenceHookConfig extends IntelligenceConfig {
  /** Authenticated tenant expected in every context response. */
  tenantId: string
  /** Pull target. Defaults to `project`. */
  target?: string
  /** Min interval between certified-context pulls. Default 5m. */
  refreshMs?: number
  /** Per-pull timeout in ms (fail-closed on a hung plane). Default 10000. */
  timeoutMs?: number
  /** fetch impl for the pull (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Current time source for certified-context expiry checks. Defaults to `Date.now`. */
  now?: () => number
  /** Persist accepted context revisions across process restarts. */
  checkpointStore?: CertifiedContextCheckpointStore
  /** Observe rejected checkpoints, rollbacks, conflicts, and incompatible endpoints. */
  onCertifiedContextReject?: (error: Error) => void
  /** Notified when the exact certified context changes or is revoked. */
  onCertifiedContext?: (context: CertifiedContext | null) => void
}

/** The wrapped agent — same `(input) => Promise<output>` shape, plus a manual
 *  `refresh()` and certified-context accessor. */
export type IntelligenceWrapped<I, O> = ((input: I) => Promise<O>) & {
  refresh(): Promise<void>
  currentCertifiedContext(): CertifiedContext | null
  /** Flush buffered trace spans before a short-lived process exits. */
  flush(): Promise<IntelligenceFlushResult>
}

interface RuntimeEventSummary {
  inferenceUsd: number
  inputTokens: number
  outputTokens: number
  model?: string
  sessionId?: string
  success?: boolean
  error?: RunRecord['error']
}

function summarizeRuntimeEvents(
  events: NonNullable<RunReport['runtimeEvents']>,
): RuntimeEventSummary {
  const summary: RuntimeEventSummary = { inferenceUsd: 0, inputTokens: 0, outputTokens: 0 }
  for (const event of events) {
    if ('sessionId' in event && event.sessionId) summary.sessionId = event.sessionId
    if (event.type === 'llm_call') {
      summary.model = event.model
      summary.inferenceUsd += event.costUsd ?? 0
      summary.inputTokens += event.tokensIn ?? 0
      summary.outputTokens += event.tokensOut ?? 0
    } else if (event.type === 'turn_error') {
      summary.success = false
      summary.error = {
        name: event.error.kind,
        message: event.message,
        ...(event.error.status !== undefined ? { code: String(event.error.status) } : {}),
      }
    } else if (event.type === 'final') {
      summary.success = event.status === 'completed'
      if (event.error) {
        summary.error = {
          name: event.error.kind,
          message: event.error.message,
          ...(event.error.status !== undefined ? { code: String(event.error.status) } : {}),
        }
      }
    }
  }
  return summary
}

function runError(cause: unknown): NonNullable<RunRecord['error']> {
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: unknown }).code
    return {
      name: cause.name || 'Error',
      message: cause.message,
      ...(typeof code === 'string' || typeof code === 'number' ? { code: String(code) } : {}),
    }
  }
  return { name: 'Error', message: String(cause) }
}

/**
 * Wrap an agent so it (a) RECEIVES the tenant's certified context — the prompt
 * context to fold — and (b) SENDS a
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
  const now = config.now ?? Date.now
  const source = createCertifiedContextSource({
    tenantId: config.tenantId,
    target,
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    ...(config.trustedBaseOrigins !== undefined
      ? { trustedBaseOrigins: config.trustedBaseOrigins }
      : {}),
    ...(config.allowInsecureLoopback !== undefined
      ? { allowInsecureLoopback: config.allowInsecureLoopback }
      : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.fetchImpl !== undefined ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.refreshMs !== undefined ? { refreshMs: config.refreshMs } : {}),
    ...(config.now !== undefined ? { now: config.now } : {}),
    ...(config.checkpointStore !== undefined ? { checkpointStore: config.checkpointStore } : {}),
    ...(config.onCertifiedContextReject !== undefined
      ? { onReject: config.onCertifiedContextReject }
      : {}),
  })

  let lastSignal = 'none'
  function signalCertifiedContext(): void {
    const context = source.current()
    const sig = context ? `${context.revision}:${context.contentHash}` : 'none'
    if (sig === lastSignal) return
    lastSignal = sig
    try {
      config.onCertifiedContext?.(context)
    } catch {
      // Observers cannot alter context delivery or fail an agent run.
    }
  }

  async function refresh(): Promise<void> {
    await source.refresh()
    signalCertifiedContext()
  }

  const wrapped = (async (input: I): Promise<O> => {
    const runId = client.freshRunId()
    const traceId = client.freshTraceId()
    const startedAt = Date.now()
    await refresh()
    const certifiedContext = source.current()
    const currentRunContext = (): CertifiedContext | null =>
      certifiedContext && Date.parse(certifiedContext.expiresAt) > now() ? certifiedContext : null
    const report: RunReport = {}
    const applied: AppliedIntelligence = {
      runId,
      traceId,
      get certifiedContext() {
        return currentRunContext()
      },
      composePrompt: (base: string) => {
        const context = currentRunContext()
        return context ? composeCertifiedContextPrompt(base, context) : base
      },
      record: (r: RunReport) => Object.assign(report, r),
    }

    function exportCompleted(output: unknown, caught?: unknown): void {
      const completedAt = Date.now()
      const eventSummary = summarizeRuntimeEvents(report.runtimeEvents ?? [])
      const error = report.error ?? (caught !== undefined ? runError(caught) : eventSummary.error)
      const tokens =
        report.tokens ??
        (eventSummary.inputTokens > 0 || eventSummary.outputTokens > 0
          ? { input: eventSummary.inputTokens, output: eventSummary.outputTokens }
          : undefined)
      const profile = report.profile ?? config.profile
      const record: RunRecord = {
        runId,
        traceId,
        project: config.project,
        target,
        input,
        output,
        outcome: {
          success:
            report.success ??
            (caught !== undefined ? false : (eventSummary.success ?? error === undefined)),
          ...(report.score !== undefined ? { score: report.score } : {}),
          usage: {
            inferenceUsd: report.usage?.inferenceUsd ?? report.costUsd ?? eventSummary.inferenceUsd,
            intelligenceUsd: report.usage?.intelligenceUsd ?? 0,
          },
        },
        timing: { startedAt, completedAt, durationMs: completedAt - startedAt },
        ...((report.model ?? eventSummary.model)
          ? { model: report.model ?? eventSummary.model }
          : {}),
        ...(report.provider !== undefined ? { provider: report.provider } : {}),
        ...(report.loopEvents !== undefined ? { loopEvents: report.loopEvents } : {}),
        ...(report.runtimeEvents !== undefined ? { runtimeEvents: report.runtimeEvents } : {}),
        ...(profile !== undefined ? { profile } : {}),
        ...((report.sessionId ?? eventSummary.sessionId)
          ? { sessionId: report.sessionId ?? eventSummary.sessionId }
          : {}),
        ...((report.harness ?? profile?.harness)
          ? { harness: report.harness ?? profile?.harness }
          : {}),
        ...((report.commitSha ?? config.commitSha)
          ? { commitSha: report.commitSha ?? config.commitSha }
          : {}),
        ...(tokens !== undefined ? { tokens } : {}),
        ...(error !== undefined ? { error } : {}),
        ...(report.candidateExecution !== undefined
          ? { candidateExecution: report.candidateExecution }
          : {}),
      }
      client.exportRunRecord(record)
    }

    try {
      const output = await agent(input, applied)
      exportCompleted(output)
      return output
    } catch (cause) {
      exportCompleted(undefined, cause)
      throw cause
    }
  }) as IntelligenceWrapped<I, O>

  wrapped.refresh = refresh
  wrapped.currentCertifiedContext = source.current
  wrapped.flush = client.flush
  return wrapped
}
