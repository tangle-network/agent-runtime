/**
 * @experimental
 *
 * Tangle Intelligence SDK — the Observe + Mode-0 product layer.
 *
 * A thin, best-effort wrapper over the shipped trace-export substrate
 * (`createOtelExporter` in `../otel-export`). It does exactly two things in
 * this slice:
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
 * Behavior-changing intelligence (analyst steer, candidate promotion, loops)
 * is a LATER phase and is NOT built here. This wrapper only Observes and passes
 * through; there is no abort path, so the only fail-soft surface is the
 * telemetry export.
 */

import {
  buildLoopOtelSpans,
  createOtelExporter,
  flatOtelSpan,
  type OtelExporter,
} from '../otel-export'
import type { LoopTraceEvent } from '../runtime/types'
import {
  defaultEffortTier,
  type EffortOverrides,
  type EffortSettings,
  type EffortTier,
  isIntelligenceOff,
  resolveEffort,
} from './effort'
import { type Redactor, resolveRedactor } from './redact'

export type {
  CapabilityAuth,
  CapabilityInterface,
  CapabilityManifest,
  CapabilitySurface,
  CertifiedCapability,
  CertProvenance,
  ContentRef,
  CredentialRef,
  DeliveryBinding,
  DeliveryBindingKind,
  HostSpec,
  JsonSchema,
  ResolvedHook,
  ResolvedRetrieval,
  ResolvedSubagent,
  ResolvedSurface,
} from './capability'
export { CapabilityNotAdmittedError, manifestFromProfile } from './capability'
export type {
  AppliedIntelligence,
  CertifiedArtifact,
  CertifiedProfile,
  CertifiedPromptSource,
  CertifiedPromptSourceOptions,
  CertifiedPromptSurface,
  DeliveredAgent,
  DeliveryConfig,
  PullCertifiedOptions,
  PullOutcome,
} from './delivery'
export {
  composeCertifiedPrompt,
  createCertifiedPromptSource,
  pullCertified,
  withCertifiedDelivery,
} from './delivery'
export type {
  CorpusAccess,
  EffortOverrides,
  EffortOverridesCompiled,
  EffortSettings,
  EffortTier,
} from './effort'
export {
  compileEffort,
  defaultEffortTier,
  isIntelligenceOff,
  resolveEffort,
} from './effort'
export type { Redactor } from './redact'
export { defaultRedactor, resolveRedactor } from './redact'
export type { ProvisionedHost, ResolveCtx } from './resolver'
export {
  composeCertifiedProfile,
  composeCertifiedProfileFromWire,
} from './resolver'

/** Usage class for billing. Base-stream tokens bill `'inference'`; every
 *  intelligence spawn (analyst, corpus, loop) bills `'intelligence'`. The
 *  billing line falls on the spawn line. */
export type UsageClass = 'inference' | 'intelligence'

/**
 * The per-class cost split carried by every trace and outcome. `off` ⇒
 * `intelligenceUsd: 0` by construction — there is no intelligence spawn to
 * bill. This is a classification on the trace, NOT a budget-pool split.
 */
export interface UsageSplit {
  /** Base-stream (model) spend in USD. */
  inferenceUsd: number
  /** Intelligence-spawn spend in USD. Provably `0` at the OFF tier. */
  intelligenceUsd: number
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
   * OTLP ingest base. The underlying exporter appends `/v1/traces`, so point
   * this at the OTLP route (e.g. `https://intelligence.tangle.tools/v1/otlp`).
   * Reads `INTELLIGENCE_OTLP_ENDPOINT` then `OTEL_EXPORTER_OTLP_ENDPOINT` when
   * omitted; absent all three, export is a no-op (best-effort by construction).
   */
  endpoint?: string
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
   * Capture the run's outcome. `usage` defaults to inference-only
   * (`intelligenceUsd: 0`) — the OFF baseline; an intelligence-enabled run
   * fills `intelligenceUsd` itself. `costUsd`, when given without a split, is
   * treated as pure inference.
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

/** The resolved outcome of one traced run, surfaced on the export span and
 *  available to the caller for downstream billing assertions. */
export interface TraceOutcome {
  runId: string
  traceId: string
  project: string
  /** The resolved effort settings this run executed under. */
  effort: EffortSettings
  /** True when this run ran as pure passthrough (the OFF floor). */
  intelligenceOff: boolean
  success?: boolean
  score?: number
  /** Per-class billing split. `intelligenceUsd` is `0` at the OFF tier. */
  usage: UsageSplit
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
   * `runLoop`/`Supervisor` run emits — as a nested OTLP span tree (loop → round →
   * iteration) into ONE trace. Reuses the shipped `buildLoopOtelSpans` builder
   * (NO second span builder), so the topology a viewer renders matches the
   * kernel's. `traceId` defaults to a fresh id; `rootParentSpanId` parents the
   * loop root under an enclosing span (e.g. a `traceRun` span) when given.
   * Best-effort: export failures are swallowed. Returns the resolved `traceId`.
   */
  recordTrace(events: ReadonlyArray<LoopTraceEvent>, meta?: RecordTraceMeta): string
  /**
   * Network-free readiness report: which adoption modes are reachable given
   * this config. Observe is always reachable; Recommend needs outcomes; PR
   * needs checks + surfaces + repo.
   */
  doctor(): DoctorReport
  /** Flush any pending export spans. Best-effort; resolves even if export fails. */
  flush(): Promise<void>
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

function resolveEndpoint(endpoint: string | undefined): string | undefined {
  if (endpoint) return endpoint
  if (typeof process === 'undefined') return undefined
  return process.env.INTELLIGENCE_OTLP_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
}

function freshTraceId(): string {
  return randomHex(32)
}

function freshRunId(): string {
  return `run-${randomHex(16)}`
}

/** Serialize a redacted value to a bounded string for a span attribute.
 *  `loopEventToOtelSpan` only stamps string/number/boolean payload fields, so a
 *  structured input/output must be flattened here. Bounded to keep span
 *  attributes small; the full payload is the consumer's own store, not the span. */
const previewMaxChars = 4096
function previewJson(value: unknown): string {
  let s: string
  if (typeof value === 'string') s = value
  else {
    try {
      s = JSON.stringify(value) ?? String(value)
    } catch {
      s = String(value)
    }
  }
  return s.length > previewMaxChars ? `${s.slice(0, previewMaxChars)}…[truncated]` : s
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

/**
 * Create an Observe-mode Intelligence client. Resolves effort, endpoint, and
 * redactor up front; the exporter is built lazily and is `undefined` when no
 * endpoint is configured (export becomes a no-op — best-effort by
 * construction).
 */
export function createIntelligenceClient(config: IntelligenceConfig): IntelligenceClient {
  if (!config.project) {
    throw new Error('createIntelligenceClient: `project` is required')
  }
  const effort = resolveEffortConfig(config.effort)
  const intelligenceOff = isIntelligenceOff(effort)
  const redactor = resolveRedactor(config.redact)
  const apiKey =
    config.apiKey ?? (typeof process !== 'undefined' ? process.env.TANGLE_API_KEY : undefined)
  const endpoint = resolveEndpoint(config.endpoint)

  // Built lazily: a client with no endpoint never allocates an exporter timer.
  let exporter: OtelExporter | undefined
  let exporterResolved = false
  function getExporter(): OtelExporter | undefined {
    if (exporterResolved) return exporter
    exporterResolved = true
    if (!endpoint) return undefined
    exporter = createOtelExporter({
      endpoint,
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      serviceName: config.project,
      resourceAttributes: { 'tangle.project': config.project },
    })
    return exporter
  }

  function exportTrace(meta: TraceMeta, outcome: TraceOutcome, output: unknown): void {
    const ex = getExporter()
    if (!ex) return
    const labels: Record<string, string | number | boolean> = {
      project: config.project,
      'tangle.effort.intelligence_off': outcome.intelligenceOff,
      'tangle.usage.inference_usd': outcome.usage.inferenceUsd,
      'tangle.usage.intelligence_usd': outcome.usage.intelligenceUsd,
      ...(meta.model ? { 'gen_ai.request.model': meta.model } : {}),
      ...(meta.provider ? { 'provider.name': meta.provider } : {}),
      ...(typeof outcome.success === 'boolean'
        ? { 'tangle.outcome.success': outcome.success }
        : {}),
      ...(typeof outcome.score === 'number' ? { 'tangle.outcome.score': outcome.score } : {}),
      ...(meta.labels ?? {}),
    }
    const redactedInput = meta.input !== undefined ? redactor(meta.input) : undefined
    const redactedOutput = output !== undefined ? redactor(output) : undefined
    if (redactedInput !== undefined) labels['tangle.input'] = previewJson(redactedInput)
    if (redactedOutput !== undefined) labels['tangle.output'] = previewJson(redactedOutput)
    try {
      // Flat span with VERBATIM attribute keys — the plane's session/model/
      // cost readers exact-match `tangle.sessionId` / `gen_ai.request.model`,
      // so the loop-namespacing builder must not be used here.
      ex.exportSpan(
        flatOtelSpan(
          'tangle.intelligence.run',
          { 'tangle.runId': outcome.runId, ...labels },
          outcome.traceId,
          Date.now(),
        ),
      )
    } catch {
      // Best-effort — telemetry export must never fail the agent's turn.
    }
  }

  return {
    project: config.project,
    effort,

    async traceRun<T>(meta: TraceMeta, fn: (trace: TraceHandle) => Promise<T>): Promise<T> {
      const runId = meta.runId ?? freshRunId()
      const traceId = meta.traceId ?? freshTraceId()
      let recordedOutput: unknown
      // Default split: inference-only. At OFF this is provably the whole bill.
      const usage: UsageSplit = { inferenceUsd: 0, intelligenceUsd: 0 }
      let success: boolean | undefined
      let score: number | undefined

      const trace: TraceHandle = {
        recordOutput(output: unknown): void {
          recordedOutput = output
        },
        recordOutcome(outcome): void {
          if (typeof outcome.success === 'boolean') success = outcome.success
          if (typeof outcome.score === 'number') score = outcome.score
          if (outcome.usage) {
            if (typeof outcome.usage.inferenceUsd === 'number') {
              usage.inferenceUsd = outcome.usage.inferenceUsd
            }
            if (typeof outcome.usage.intelligenceUsd === 'number') {
              usage.intelligenceUsd = outcome.usage.intelligenceUsd
            }
          } else if (typeof outcome.costUsd === 'number') {
            // A bare cost with no split is pure inference (the base stream).
            usage.inferenceUsd = outcome.costUsd
          }
        },
      }

      // The OFF floor is a HARD invariant, not a default: no intelligence spawn
      // can occur in this Observe slice, so intelligence-class spend is zero.
      // We clamp on export rather than trust the caller, so the billing proof
      // holds even if a caller mis-records an outcome at OFF.
      const result = await fn(trace)
      if (intelligenceOff) usage.intelligenceUsd = 0

      const outcome: TraceOutcome = {
        runId,
        traceId,
        project: config.project,
        effort,
        intelligenceOff,
        ...(success !== undefined ? { success } : {}),
        ...(score !== undefined ? { score } : {}),
        usage,
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
        const spans = buildLoopOtelSpans(
          events as ReadonlyArray<{
            kind: string
            runId: string
            timestamp: number
            payload: object
          }>,
          traceId,
          meta?.rootParentSpanId,
        )
        for (const span of spans) ex.exportSpan(span)
      } catch {
        // Best-effort — a trace export must never fail the caller's run.
      }
      return traceId
    },

    doctor(): DoctorReport {
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
      if (intelligenceOff) recommendMissing.push('effort above off')

      return {
        project: config.project,
        effort,
        exportConfigured: Boolean(endpoint),
        modes: {
          observe: { ready: true, missing: [] },
          recommend: {
            ready: recommendMissing.length === 0,
            missing: recommendMissing,
          },
          pr: { ready: prMissing.length === 0, missing: prMissing },
        },
      }
    },

    async flush(): Promise<void> {
      const ex = getExporter()
      if (!ex) return
      try {
        await ex.flush()
      } catch {
        // Best-effort — a flush failure must not surface to the caller.
      }
    },
  }
}

/** A generic agent: one async input → output. The shape `withTangleIntelligence`
 *  preserves exactly. */
export type Agent<TInput, TOutput> = (input: TInput) => Promise<TOutput>

/** Either a built client or the config to build one. */
export type ClientOrConfig = IntelligenceClient | IntelligenceConfig

function isClient(value: ClientOrConfig): value is IntelligenceClient {
  return typeof (value as IntelligenceClient).traceRun === 'function'
}

/**
 * Wrap a generic `agent` with best-effort Observe-mode tracing, returning the
 * SAME shape. Each call runs the agent under a trace and exports one span; an
 * export failure is swallowed (the live agent never fails because Intelligence
 * is down) but an error from the agent itself propagates unchanged.
 *
 * At `effort: 'off'` this is pure passthrough plus best-effort telemetry —
 * zero intelligence spawns, `intelligenceUsd: 0` on the trace.
 */
export function withTangleIntelligence<TInput, TOutput>(
  agent: Agent<TInput, TOutput>,
  clientOrConfig: ClientOrConfig,
): Agent<TInput, TOutput> {
  const client = isClient(clientOrConfig)
    ? clientOrConfig
    : createIntelligenceClient(clientOrConfig)

  return async (input: TInput): Promise<TOutput> => {
    return client.traceRun({ input }, async (trace) => {
      const output = await agent(input)
      trace.recordOutput(output)
      return output
    })
  }
}
