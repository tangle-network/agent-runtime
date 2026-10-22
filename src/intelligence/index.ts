/**
 *
 * Tangle Intelligence SDK — trace capture plus reviewable improvement.
 *
 * The client keeps live-agent trace delivery best-effort. The separate
 * improvement-cycle exports analyze completed traces and run a signed baseline
 * versus candidate experiment. Activation exports bind review to its result
 * and activate only the exact measured candidate.
 *
 *   1. OBSERVE — wrap a generic agent and export one trace span per call to
 *      Tangle Intelligence, swallowing every export failure so a live agent
 *      never fails because Intelligence is down.
 *   2. MODE 0 / OFF — at `effort: 'off'`, run the agent as PURE PASSTHROUGH
 *      (zero intelligence spawns) with best-effort telemetry still on. The
 *      exported trace tags usage by class `{ inferenceUsd, intelligenceUsd }`,
 *      and at OFF `intelligenceUsd` is provably `0` — the mechanism that proves
 *      an OFF customer paid inference-only.
 *
 * @module
 * @stable
 */

import type { AgentProfile, CandidateExecutionEvidence } from '@tangle-network/agent-interface'
import { createOtelExporter, type OtelExporter, type OtelExportStats } from '../otel-export'
import { type Redactor, resolveRedactor } from '../redact'
import type { LoopTraceEvent } from '../runtime/types'
import type { RuntimeTelemetryOptions } from '../sanitize'
import type { RuntimeStreamEvent } from '../types'
import { resolveIntelligenceBaseUrl } from './delivery'
import {
  defaultEffortTier,
  type EffortOverrides,
  type EffortSettings,
  type EffortTier,
  isIntelligenceOff,
  resolveEffort,
} from './effort'
import {
  exportLoopSpans,
  exportRunRecordSpans,
  exportTraceSpan,
  type TraceExportSettings,
  type TraceOutcome,
} from './otel-run-export'
import { mergeReportedUsage, normalizeReportedUsage } from './usage'

export type {
  AgentImprovementActivation,
  AgentImprovementActivationIntent,
  AgentImprovementActivationOutcome,
  AgentImprovementActivationResult,
  AgentImprovementEvaluation,
  AgentImprovementProposal,
  AgentImprovementReview,
  AgentImprovementReviewDecision,
  CandidateExecutionEvidence,
} from '@tangle-network/agent-interface'
export { parseAgentCandidateProfileActivation as parseCandidateProfileMaterialization } from '../candidate-execution/profile'
export type { Redactor } from '../redact'
export { defaultRedactor } from '../redact'
export type {
  AgentImprovementActivationTargetPlan,
  AgentImprovementActivationTransitionInput,
  AgentProfileImprovementActivationOperation,
  AgentProfileImprovementActivationTargetPlan,
  CreateAgentImprovementActivationOptions,
  CreateAgentImprovementActivationResultOptions,
  CreateAgentImprovementProposalOptions,
  ExecuteAgentImprovementActivationInput,
  ExecuteAgentImprovementActivationOptions,
  ProfileImprovementActivationTransitionInput,
  ReviewAgentImprovementInput,
  SealedCandidateActivationTransitionInput,
} from './activation'
export {
  createAgentImprovementActivation,
  createAgentImprovementActivationResult,
  createAgentImprovementProposal,
  executeAgentImprovementActivation,
  reviewAgentImprovementProposal,
  verifyAgentImprovementActivation,
  verifyAgentImprovementActivationResult,
  verifyAgentImprovementProposal,
  verifyAgentImprovementReview,
} from './activation'
export type {
  AgentProfileCandidateMeasurementExecutor,
  AuthoredAgentProfileCandidateLineage,
  ProposeAuthoredAgentProfileImprovementOptions,
  ProposeAuthoredAgentProfileImprovementResult,
} from './authored-profile-improvement'
export { proposeAuthoredAgentProfileImprovement } from './authored-profile-improvement'
export type {
  CapabilityAuth,
  CapabilityInterface,
  CapabilityManifest,
  CertifiedCapability,
  CertProvenance,
  ContentRef,
  CredentialRef,
  DeliveryBinding,
  HostSpec,
  JsonSchema,
} from './capability'
export { CapabilityNotAdmittedError, manifestFromProfile } from './capability'
export type {
  CertifiedArtifact,
  CertifiedCapabilitySummary,
  CertifiedProfile,
  CertifiedPromptSource,
  CertifiedPromptSourceOptions,
  CertifiedPromptSurface,
  DiffProvenance,
  ProposedProfileDiff,
  PullCertifiedOptions,
  PullOutcome,
} from './delivery'
export { composeCertifiedPrompt, createCertifiedPromptSource, pullCertified } from './delivery'
export type { CorpusAccess, EffortOverridesCompiled, EffortSettings, EffortTier } from './effort'
export { compileEffort, isIntelligenceOff, resolveEffort } from './effort'
export type {
  AgentCandidateExecutionHostPorts,
  CreateExactProcessCandidateExperimentExecutorOptions,
  CreateProtectedExactProcessCandidateExperimentExecutorOptions,
  ExactProcessCandidateExperimentExecution,
  ExactProcessCandidateExperimentExecutor,
  ProtectedExactProcessCandidateExperimentExecutor,
} from './exact-process-candidate'
export {
  createExactProcessCandidateExperimentExecutor,
  createProtectedExactProcessCandidateExperimentExecutor,
  exactProcessCandidateExperimentExecutionSupport,
} from './exact-process-candidate'
export type {
  AgentCandidateExperimentCellPlacement,
  AgentImprovementAnalysisOptions,
  AgentImprovementExperimentMaterial,
  AgentProfileImprovementBenchmark,
  AgentProfileImprovementExecutor,
  AgentProfileImprovementMethodOptions,
  ExecuteAgentCandidateExperimentCellOptions,
  ProposeAgentImprovementOptions,
  ProposeAgentImprovementResult,
  ProposeAgentProfileImprovementOptions,
  ProposeAgentProfileImprovementResult,
  RunAgentCandidateExperimentOptions,
  RunAgentCandidateExperimentResult,
  VerifyCandidateExecutionEvidenceOptions,
} from './improvement-cycle'
export {
  executeAgentCandidateExperimentCell,
  proposeAgentImprovement,
  proposeAgentProfileImprovement,
  runAgentCandidateExperiment,
  verifyCandidateExecutionEvidence,
} from './improvement-cycle'
export type {
  AGENT_IMPROVEMENT_PROFILE_SURFACES,
  AGENT_PROFILE_MEASURED_SURFACES,
  AgentImprovementActivationTargetIdentity,
  AgentImprovementProfileSurface,
  AgentImprovementTargetProfileDiffOptions,
  AgentProfileMeasuredSurface,
} from './improvement-surfaces'
export {
  agentImprovementProfileDiffs,
  agentImprovementProfileSurfaceDigest,
  agentImprovementProfileSurfaceInput,
  agentImprovementTargetProfileDiffs,
  isAgentImprovementProfileSurface,
  isAgentProfileMeasuredSurface,
} from './improvement-surfaces'
export {
  createOptimizationActivationReceipt,
  type OptimizationActivationReceipt,
  type OptimizationReceiptCost,
  optimizationActivationReceiptFromMetadata,
} from './optimization-receipt'
export type {
  AgentImprovementProfileActivationInput,
  AgentImprovementProfileActivationPreparation,
  AgentImprovementProfileActivationTarget,
  AgentImprovementProfileReplacement,
  AgentImprovementProfileStateDigest,
  AgentImprovementProfileStateDigestInput,
  AgentImprovementProfileStateResolver,
  AgentImprovementProfileStateResolverInput,
  AgentImprovementProfileTargetState,
  AgentImprovementProfileTargetTransition,
} from './profile-activation'
export { prepareAgentImprovementProfileActivation } from './profile-activation'
export type {
  AppliedIntelligence,
  IntelligenceAgent,
  IntelligenceHookConfig,
  IntelligenceWrapped,
} from './with-intelligence'
export { withIntelligence } from './with-intelligence'

/**
 * The per-class cost split carried by every trace and outcome. `off` ⇒
 * `intelligenceUsd: 0` by construction — there is no intelligence spawn to
 * bill. This is a classification on the trace, NOT a budget-pool split.
 */
export interface UsageSplit {
  /** Observed base-stream spend in USD; a subtotal when `inferenceUsdKnown` is false. */
  inferenceUsd: number
  /** Intelligence-spawn spend in USD. Provably `0` at the OFF tier. */
  intelligenceUsd: number
  /** False when inference cost is incomplete or unreported. */
  inferenceUsdKnown?: false
  /** False when Intelligence cost is incomplete or unreported. */
  intelligenceUsdKnown?: false
  /** Reported inference estimate, separate from observed spend and completeness. */
  estimatedInferenceUsd?: number
}

/**
 * The typed record `withIntelligence` sends per call — serialized through the
 * shipped OTLP builders to the plane's `/v1/otlp` ingest. `input`/`output` are
 * redacted on export; the per-class `usage` split carries the billing proof;
 * `loopEvents`, when present, export as the nested loop→round→iteration span
 * tree under the same `traceId`.
 */
export interface RunRecord {
  runId: string
  traceId: string
  project: string
  target: string
  input: unknown
  output: unknown
  outcome: {
    success?: boolean
    score?: number
    usage: UsageSplit
  }
  model?: string
  provider?: string
  loopEvents?: LoopTraceEvent[]
  runtimeEvents?: RuntimeStreamEvent[]
  profile?: AgentProfile
  sessionId?: string
  harness?: string
  repository?: string
  commitSha?: string
  timing?: { startedAt: number; completedAt: number; durationMs: number }
  tokens?: {
    input: number
    output: number
    cachedInput?: number
    reasoning?: number
    /** False when the numeric token subtotals are incomplete. */
    tokensKnown?: false
  }
  error?: { name: string; message: string; code?: string }
  /** Exact proposal → review → execution → receipt linkage for candidate runs. */
  candidateExecution?: CandidateExecutionEvidence
}

/**
 * What an agent reports (via `applied.record`) to enrich the {@link RunRecord}
 * sent for its call. All optional — an un-recorded run still sends input/output
 * with unknown usage, except for the OFF billing guarantee.
 * `costUsd` supplies inference spend when the split omits it.
 */
export interface RunReport {
  success?: boolean
  score?: number
  usage?: Partial<UsageSplit>
  costUsd?: number
  model?: string
  provider?: string
  loopEvents?: LoopTraceEvent[]
  runtimeEvents?: RuntimeStreamEvent[]
  profile?: AgentProfile
  sessionId?: string
  harness?: string
  commitSha?: string
  tokens?: RunRecord['tokens']
  error?: RunRecord['error']
  candidateExecution?: CandidateExecutionEvidence
}

/** Repo coordinates a product may declare for the (later) Gated-PR mode. The
 *  Observe slice only records their PRESENCE for `doctor()`; it never touches
 *  the repo. */
export interface RepoConfig {
  owner: string
  name: string
  baseBranch: string
}

/** Client configuration. `project` + `apiKey` are the Observe minimum; the
 *  rest tune effort, endpoint, redaction, and (for `doctor()` readiness)
 *  declare the surfaces/checks/repo a later PR mode would need. */
export interface IntelligenceConfig {
  /** Stable project id — the tenant dimension every trace is tagged with. */
  project: string
  /** Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted. */
  apiKey?: string
  /** Effort tier (default `'standard'`) plus optional per-field overrides. */
  effort?: EffortTier | { tier: EffortTier; overrides?: EffortOverrides }
  /**
   * The ONE Tangle Intelligence base URL — both the send (OTLP `/v1/otlp`) and
   * receive (`/v1/profiles/:target/composed`) paths derive from it. Reads
   * `TANGLE_INTELLIGENCE_URL` when omitted, else `https://intelligence.tangle.tools`.
   * Send is best-effort and only ships when an `apiKey` is present (the tenant
   * key the ingest requires); absent a key, export is a no-op.
   */
  baseUrl?: string
  /**
   * Redaction hook run over every exported input/output. A function replaces
   * the default scrubber; `false` opts out entirely (raw fidelity, caller has
   * sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.
   */
  redact?: Redactor | false
  /** Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only. */
  surfaces?: string[]
  /** Verification checks a later PR mode would gate on. Recorded for `doctor()` only. */
  checks?: string[]
  /** Repo access a later PR mode would need. Recorded for `doctor()` only. */
  repo?: RepoConfig
  /** Full canonical profile used for this agent. Exported redacted with a stable hash. */
  profile?: AgentProfile
  /** Commit that produced the running agent, when known. */
  commitSha?: string
  /** Runtime-event payload policy. Tool inputs/results remain off unless explicitly enabled. */
  runtimeTelemetry?: RuntimeTelemetryOptions
  /**
   * Payloads are metadata-only by default: the run span carries a stable hash
   * and UTF-8 byte count, but not the redacted content. Set `full` only when
   * the configured OTLP destination is approved to receive complete redacted
   * inputs, outputs, and profiles.
   */
  payloadAttributes?: 'metadata' | 'full'
}

/** Metadata describing one traced run. `runId`/`traceId` default to fresh ids. */
export interface TraceMeta {
  /** The run's input — exported through the redactor. */
  input?: unknown
  /** Stable run id. Defaults to a fresh id. */
  runId?: string
  /** 32-hex trace id. Defaults to a fresh id. */
  traceId?: string
  /** Model id, when known — stamped on the span. */
  model?: string
  /** Provider name, when known — stamped on the span. */
  provider?: string
  /** Arbitrary extra labels (string/number/boolean) stamped on the span. */
  labels?: Record<string, string | number | boolean>
}

/**
 * The trace handle a `traceRun` body records into. `recordOutput` captures the
 * agent's result (redacted on export); `recordOutcome` captures the scored
 * outcome + the `{ inferenceUsd, intelligenceUsd }` split. Both are optional —
 * an un-recorded run still exports a span with whatever was set.
 */
export interface TraceHandle {
  /** Capture the run's output. Exported through the redactor. */
  recordOutput(output: unknown): void
  /**
   * Capture the run's outcome. Unreported spend is unknown, except for Intelligence at OFF.
   * `costUsd` supplies inference spend when the split omits it.
   * Numeric usage updates replace subtotals; explicit incomplete flags remain sticky.
   */
  recordOutcome(outcome: {
    success?: boolean
    score?: number
    costUsd?: number
    usage?: Partial<UsageSplit>
  }): void
}

/** Metadata for {@link IntelligenceClient.recordTrace}. */
export interface RecordTraceMeta {
  /** 32-hex trace id to anchor every span to. Defaults to a fresh id. */
  traceId?: string
  /** Span id of an enclosing span the loop root should parent under (e.g. a
   *  `traceRun` span). Omitted ⇒ the loop root is the trace root. */
  rootParentSpanId?: string
}

/** The Observe-mode Intelligence client. */
export interface IntelligenceClient {
  /** The resolved project id. */
  readonly project: string
  /** The resolved effort settings. */
  readonly effort: EffortSettings
  /**
   * Run `fn` under a trace, export one span best-effort, and return whatever
   * `fn` returns. Telemetry-export failures are swallowed; an error THROWN by
   * `fn` propagates to the caller (the agent's own failures are not masked).
   */
  traceRun<T>(meta: TraceMeta, fn: (trace: TraceHandle) => Promise<T>): Promise<T>
  /**
   * Export a run's full loop topology — the ordered `LoopTraceEvent` stream a
   * `runAgentRounds`/`Supervisor` run emits — as a nested OTLP span tree (loop → round →
   * iteration) into ONE trace. Reuses the shipped `buildLoopOtelSpans` builder
   * (NO second span builder), so the topology a viewer renders matches the
   * kernel's. `traceId` defaults to a fresh id; `rootParentSpanId` parents the
   * loop root under an enclosing span (e.g. a `traceRun` span) when given.
   * Best-effort: export failures are swallowed. Returns the resolved `traceId`.
   */
  recordTrace(events: ReadonlyArray<LoopTraceEvent>, meta?: RecordTraceMeta): string
  /**
   * Send one typed {@link RunRecord} — the run's flat span (input/output/outcome/
   * usage/model/provider, redacted) plus, when `loopEvents` are present, the
   * nested loop topology under the same `traceId`. Reuses the shipped
   * `flatOtelSpan` + `buildLoopOtelSpans` builders (no second builder).
   * Best-effort: export failures are swallowed. Returns the record's `traceId`.
   */
  exportRunRecord(record: RunRecord): string
  /** Mint a fresh run id (`run-<hex>`). */
  freshRunId(): string
  /** Mint a fresh 32-hex trace id. */
  freshTraceId(): string
  /**
   * Network-free readiness report: which adoption modes are reachable given
   * this config. Observe is always reachable; Recommend needs outcomes; PR
   * needs checks + surfaces + repo.
   */
  doctor(): DoctorReport
  /** Flush any pending export spans. Best-effort; resolves even if export fails. */
  flush(): Promise<void>
  /**
   * Delivery accounting for the spans this client sent: written, dropped, pending and the last
   * error. `undefined` when no exporter exists (no tenant key). `flush()` stays best-effort, so
   * this is where a caller checks that a run's telemetry actually reached Intelligence.
   */
  exportStats(): OtelExportStats | undefined
}

/** One mode's readiness verdict. */
export interface ModeReadiness {
  ready: boolean
  /** Inputs this mode still needs, when not ready. Empty when ready. */
  missing: string[]
}

/** The `doctor()` readiness report — Mode-readiness without any network call. */
export interface DoctorReport {
  project: string
  effort: EffortSettings
  /** True when an OTLP endpoint is configured (export will actually ship). */
  exportConfigured: boolean
  modes: {
    observe: ModeReadiness
    recommend: ModeReadiness
    pr: ModeReadiness
  }
}

function resolveEffortConfig(effort: IntelligenceConfig['effort']): EffortSettings {
  if (effort === undefined) return resolveEffort(defaultEffortTier)
  if (typeof effort === 'string') return resolveEffort(effort)
  return resolveEffort(effort.tier, effort.overrides)
}

function freshTraceId(): string {
  return randomHex(32)
}

function freshRunId(): string {
  return `run-${randomHex(16)}`
}

function randomHex(chars: number): string {
  const bytes = new Uint8Array(Math.ceil(chars / 2))
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, chars)
}

/** The `doctor()` readiness report for a client's config, with no network call. */
function doctorReport(
  config: IntelligenceConfig,
  effort: EffortSettings,
  apiKey: string | undefined,
): DoctorReport {
  const hasRepo = Boolean(config.repo?.owner && config.repo?.name && config.repo?.baseBranch)
  const hasChecks = Boolean(config.checks && config.checks.length > 0)
  const hasSurfaces = Boolean(config.surfaces && config.surfaces.length > 0)

  const prMissing: string[] = []
  if (!hasChecks) prMissing.push('checks')
  if (!hasSurfaces) prMissing.push('surfaces')
  if (!hasRepo) prMissing.push('repo')

  // Recommend needs real outcomes to cluster. In the Observe slice the only
  // outcome source is `recordOutcome`; we can't introspect future calls, so
  // readiness reflects that outcome capture is WIRED (the API exists),
  // gated on the client emitting them — surfaced as the honest dependency.
  const recommendMissing: string[] = []
  if (isIntelligenceOff(effort)) recommendMissing.push('effort above off')

  return {
    project: config.project,
    effort,
    // Send ships only with a tenant key — the honest "will export actually
    // land" signal (the base URL always resolves to the plane default).
    exportConfigured: Boolean(apiKey),
    modes: {
      observe: { ready: true, missing: [] },
      recommend: {
        ready: recommendMissing.length === 0,
        missing: recommendMissing,
      },
      pr: { ready: prMissing.length === 0, missing: prMissing },
    },
  }
}

/**
 * Create an Observe-mode Intelligence client. Resolves effort, the base URL, and
 * the redactor up front; the exporter is built lazily and is `undefined` when no
 * `apiKey` is present (send becomes a no-op — the ingest requires a tenant key,
 * and best-effort export must never spam an unauthenticated plane).
 */
export function createIntelligenceClient(config: IntelligenceConfig): IntelligenceClient {
  if (!config.project) {
    throw new Error('createIntelligenceClient: `project` is required')
  }
  const effort = resolveEffortConfig(config.effort)
  const intelligenceOff = isIntelligenceOff(effort)
  const redactor = resolveRedactor(config.redact)
  const includeFullPayload = config.payloadAttributes === 'full'
  const apiKey =
    config.apiKey ?? (typeof process !== 'undefined' ? process.env.TANGLE_API_KEY : undefined)
  // The ONE base URL drives both send and receive; the OTLP ingest lives at
  // `${base}/v1/otlp` and the exporter appends `/v1/traces` → `${base}/v1/otlp/v1/traces`.
  const otlpEndpoint = `${resolveIntelligenceBaseUrl(config.baseUrl)}/v1/otlp`

  const exportSettings: TraceExportSettings = {
    project: config.project,
    intelligenceOff,
    redactor,
    includeFullPayload,
    get repo() {
      return config.repo
    },
    get runtimeTelemetry() {
      return config.runtimeTelemetry
    },
  }

  // Built lazily: a client with no tenant key never allocates an exporter timer.
  let exporter: OtelExporter | undefined
  let exporterResolved = false
  function getExporter(): OtelExporter | undefined {
    if (exporterResolved) return exporter
    exporterResolved = true
    if (!apiKey) return undefined
    exporter = createOtelExporter({
      endpoint: otlpEndpoint,
      headers: { authorization: `Bearer ${apiKey}` },
      serviceName: config.project,
      resourceAttributes: { 'tangle.project': config.project },
    })
    return exporter
  }

  function exportTrace(meta: TraceMeta, outcome: TraceOutcome, output: unknown): void {
    const ex = getExporter()
    if (!ex) return
    try {
      exportTraceSpan(ex, exportSettings, meta, outcome, output)
    } catch {
      // Best-effort — telemetry export must never fail the agent's turn.
    }
  }

  function exportRunRecord(record: RunRecord): string {
    const ex = getExporter()
    if (!ex) return record.traceId
    try {
      exportRunRecordSpans(ex, exportSettings, record)
    } catch {
      // Best-effort — a send failure must never fail the agent's turn.
    }
    return record.traceId
  }

  return {
    project: config.project,
    effort,
    exportRunRecord,
    freshRunId,
    freshTraceId,

    async traceRun<T>(meta: TraceMeta, fn: (trace: TraceHandle) => Promise<T>): Promise<T> {
      const runId = meta.runId ?? freshRunId()
      const traceId = meta.traceId ?? freshTraceId()
      let recordedOutput: unknown
      const usage: Partial<UsageSplit> = {}
      let success: boolean | undefined
      let score: number | undefined

      const trace: TraceHandle = {
        recordOutput(output: unknown): void {
          recordedOutput = output
        },
        recordOutcome(outcome): void {
          if (typeof outcome.success === 'boolean') success = outcome.success
          if (typeof outcome.score === 'number') score = outcome.score
          mergeReportedUsage(usage, outcome)
        },
      }

      // The OFF floor is a HARD invariant, not a default: no intelligence spawn
      // can occur in this Observe slice, so intelligence-class spend is zero.
      // We clamp on export rather than trust the caller, so the billing proof
      // holds even if a caller mis-records an outcome at OFF.
      const result = await fn(trace)

      const outcome: TraceOutcome = {
        runId,
        traceId,
        project: config.project,
        effort,
        intelligenceOff,
        ...(success !== undefined ? { success } : {}),
        ...(score !== undefined ? { score } : {}),
        usage: normalizeReportedUsage(usage, intelligenceOff),
      }
      exportTrace(meta, outcome, recordedOutput)
      return result
    },

    recordTrace(events: ReadonlyArray<LoopTraceEvent>, meta?: RecordTraceMeta): string {
      const traceId = meta?.traceId ?? freshTraceId()
      const ex = getExporter()
      if (!ex || events.length === 0) return traceId
      // Reuse the shipped topology builder — loop → round → iteration span tree —
      // so the structure matches the kernel's, never a second parallel builder.
      try {
        exportLoopSpans(ex, events, traceId, meta?.rootParentSpanId)
      } catch {
        // Best-effort — a trace export must never fail the caller's run.
      }
      return traceId
    },

    doctor: () => doctorReport(config, effort, apiKey),

    async flush(): Promise<void> {
      const ex = getExporter()
      if (!ex) return
      try {
        await ex.flush()
      } catch {
        // Best-effort: the loss stays visible through exportStats().
      }
    },

    exportStats(): OtelExportStats | undefined {
      return getExporter()?.stats()
    },
  }
}

export type { PrepareAgentCandidateExecutionOptions } from '../candidate-execution/prepare'
export type { ImproveResult } from '../improvement/improve-types'
export type { AgentEnvironmentProviderRef } from '../runtime/environment-provider/provider-registry'
