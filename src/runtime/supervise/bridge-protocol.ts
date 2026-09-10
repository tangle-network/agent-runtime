/** Decode Bridge stream and materialization receipts without owning transport or executor state. */

import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  harnessTypeSchema,
  nativeReasoningControl,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from '@tangle-network/agent-interface'
import { BackendTransportError, ValidationError } from '../../errors'
import { agentHarness } from '../harness-role'
import { detachedSnapshot } from './snapshot'
import { decodeOpenAiPart, type ToolStepInput } from './trace-source'

export const bridgeProfileMaterializationSchema = 'cli-bridge.profile-materialization.v2'

export interface BridgeProfileMaterializationReceipt {
  readonly schema: typeof bridgeProfileMaterializationSchema
  readonly effectiveProfileDigest: string
  readonly harness: string
  readonly provider: string | null
  /** Exact full bridge wire id, for example `pi/tangle-router/deepseek-v4-flash`. */
  readonly model: string
  readonly reasoningEffort: {
    readonly requested: ReasoningEffort | null
    /** Exact native argv/config value after the bridge's backend mapping. */
    readonly applied: string | null
  }
  /** Exact model transport selected by cli-bridge before the harness process started. */
  readonly inference?: BridgeInferenceReceipt
  readonly workspacePlanDigest: string
  readonly files: ReadonlyArray<{ path: string; mode: number }>
  readonly unsupported: ReadonlyArray<{ dimension: string; reason: string }>
}

interface BridgeInferenceReceipt {
  readonly effectiveEndpoint: string
  readonly apiMode: string
  readonly transport: 'scoped-loopback'
  /** Exact positive completion-token cap applied to the isolated model config. */
  readonly appliedMaxTokens?: number
  readonly observation?: BridgeInferenceObservation
}

interface BridgeInferenceObservation {
  readonly requests: number
  readonly generationRequests: number
  readonly auxiliaryRequests: number
  readonly usageReceipts: number
  readonly rejectedRequests: number
  readonly failedRequests: number
  readonly inFlightRequests: number
  readonly accountingMatched: boolean
  readonly usage: BridgeInferenceUsage
}

export interface BridgeInferenceUsage {
  readonly inputTokens?: number
  readonly freshInputTokens?: number
  readonly cacheReadInputTokens?: number
  readonly cacheWriteInputTokens?: number
  readonly outputTokens?: number
  readonly costKnown: false
  readonly estimatedCost?: number
}

/**
 * Recover the upstream HTTP status the bridge reports inside its message text.
 *
 * `classifyDriverFailure` already splits a transport failure correctly by status — 408/429/5xx
 * retryable, other 4xx terminal — but it reads `error.status`, and a bridge stream error carries
 * the status only as text: `pi assistant turn failed: 400: {"message":"The max_tokens parameter
 * is illegal ..."}`. With `status` undefined the classifier takes its "unknown, so assume the
 * upstream had a bad moment" branch, and a malformed request is retried to the attempt ceiling.
 * Measured: a 400 `invalid_request_error` retried 12 times, and it fails identically every time.
 *
 * Anchored to `: <status>: ` so it matches the bridge's own framing and not a status-shaped number
 * inside a provider's prose. A body that names no status leaves `status` undefined, which keeps
 * the existing retry-on-unknown behaviour.
 */
function upstreamStatusFromMessage(message: string | undefined): number | undefined {
  const match = message?.match(/: (\d{3}): /)
  if (!match) return undefined
  const status = Number(match[1])
  return status >= 100 && status <= 599 ? status : undefined
}

function bridgeUpstreamError(
  error: { message?: string; type?: string; provider_dispatch?: unknown; status?: unknown },
  prefix: string,
): BackendTransportError {
  const providerDispatch =
    error.provider_dispatch === 'not_started' ? ('not_started' as const) : undefined
  // A structured status is authoritative; the message text is the fallback the bridge actually
  // sends today.
  const status =
    typeof error.status === 'number' ? error.status : upstreamStatusFromMessage(error.message)
  // `type` is the bridge's own error class on a failure it raised itself (`parse_error` for a
  // profile that cannot materialize) and the provider's class when it relays one. Carried as
  // `upstreamCode` so a retry policy can read the bridge's never-retry decisions where no status rides.
  const upstreamCode =
    typeof error.type === 'string' && error.type.length > 0 ? error.type : undefined
  const options = {
    ...(providerDispatch === undefined ? {} : { providerDispatch }),
    ...(status === undefined ? {} : { status }),
    ...(upstreamCode === undefined ? {} : { upstreamCode }),
  }
  return new BackendTransportError(
    'bridge',
    `${prefix}: ${error.message ?? error.type ?? 'unknown'}`,
    Object.keys(options).length === 0 ? undefined : options,
  )
}

export interface BridgeStreamChunk {
  content?: string
  /** Provider-reported response model, not the bridge request model. */
  model?: string
  /** Provider response fingerprint carried alongside the response model. */
  systemFingerprint?: string
  /** Every tool call the delta carried, decoded into the shared tool-step currency. */
  toolCalls?: ReadonlyArray<ToolStepInput>
  usage?: {
    input: number
    output: number
    known: boolean
    promptCache?: { freshInput?: number; readInput?: number; writeInput?: number }
  }
  cost?: number
  costKnown?: boolean
  /** Which receipt the bridge proved a known cost with. Absent when the cost is not known. */
  costProvenance?: 'provider-receipt' | 'billing-receipt'
  estimatedCost?: number
  costScope?: 'incremental' | 'total'
  profileMaterialization?: BridgeProfileMaterializationReceipt
}

export function assertBridgeProfileMaterialization(
  value: unknown,
  profile: AgentProfile,
  wireModel: string | undefined,
): BridgeProfileMaterializationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('bridgeExecutor: profile materialization receipt must be an object')
  }
  const raw = value as Record<string, unknown>
  const requiredKeys = [
    'effectiveProfileDigest',
    'files',
    'harness',
    'model',
    'provider',
    'reasoningEffort',
    'schema',
    'unsupported',
    'workspacePlanDigest',
  ]
  // `inference` is part of the SAME v2 schema, not an extension of it: cli-bridge added it to
  // describe the bridge-owned model transport a jailed harness is pinned to (pi reaches its model
  // only through that loopback endpoint), and its own `ProfileMaterializationReceipt` type declares
  // it optional under `cli-bridge.profile-materialization.v2`. Comparing the key set EXACTLY made
  // this executor refuse a conformant receipt — every jailed pi run through a current bridge
  // settled `down` with "receipt has missing or unknown fields", which reads as a malformed bridge
  // rather than a validator that pinned an older spelling of the same version. Required keys stay
  // required and every value is still checked; the optional block is validated when present.
  const optionalKeys = ['inference']
  const presentKeys = Object.keys(raw)
  const missing = requiredKeys.filter((key) => !presentKeys.includes(key))
  const unknown = presentKeys.filter(
    (key) => !requiredKeys.includes(key) && !optionalKeys.includes(key),
  )
  if (missing.length > 0 || unknown.length > 0) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has missing or unknown fields' +
        (missing.length > 0 ? ` (missing: ${missing.sort().join(', ')})` : '') +
        (unknown.length > 0 ? ` (unknown: ${unknown.sort().join(', ')})` : ''),
    )
  }
  const inference =
    raw.inference === undefined ? undefined : parseBridgeInferenceReceipt(raw.inference)
  if (raw.schema !== bridgeProfileMaterializationSchema) {
    throw new ValidationError(
      `bridgeExecutor: profile materialization receipt is not ${bridgeProfileMaterializationSchema}`,
    )
  }
  const effectiveProfileDigest = raw.effectiveProfileDigest
  if (
    typeof effectiveProfileDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(effectiveProfileDigest)
  ) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has an invalid effectiveProfileDigest',
    )
  }
  const expectedDigest = canonicalAgentProfileDigest(profile)
  if (effectiveProfileDigest !== expectedDigest) {
    throw new ValidationError(
      `bridgeExecutor: bridge materialized profile ${effectiveProfileDigest}, expected ${expectedDigest}`,
    )
  }
  if (typeof raw.harness !== 'string' || raw.harness.length === 0) {
    throw new ValidationError('bridgeExecutor: profile materialization receipt has no harness')
  }
  if (raw.provider !== null && (typeof raw.provider !== 'string' || raw.provider.length === 0)) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has invalid provider',
    )
  }
  if (typeof raw.model !== 'string' || raw.model.length === 0 || raw.model !== wireModel) {
    throw new ValidationError(
      `bridgeExecutor: bridge materialized model ${JSON.stringify(raw.model)}, expected ${JSON.stringify(wireModel)}`,
    )
  }
  const expectedHarness = agentHarness(profile.harness) ?? wireModel?.split('/')[0]
  if (!expectedHarness || raw.harness !== expectedHarness) {
    throw new ValidationError(
      `bridgeExecutor: bridge materialized harness ${JSON.stringify(raw.harness)}, expected ${JSON.stringify(expectedHarness)}`,
    )
  }
  const expectedProvider = profile.model?.provider ?? null
  if (expectedProvider !== null && raw.provider !== expectedProvider) {
    throw new ValidationError(
      `bridgeExecutor: bridge materialized provider ${JSON.stringify(raw.provider)}, expected ${JSON.stringify(expectedProvider)}`,
    )
  }
  if (
    !raw.reasoningEffort ||
    typeof raw.reasoningEffort !== 'object' ||
    Array.isArray(raw.reasoningEffort)
  ) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has invalid reasoningEffort',
    )
  }
  const reasoningEffort = raw.reasoningEffort as Record<string, unknown>
  if (Object.keys(reasoningEffort).sort().join(',') !== 'applied,requested') {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt reasoningEffort has missing or unknown fields',
    )
  }
  const requested = reasoningEffort.requested
  const applied = reasoningEffort.applied
  if (
    (requested !== null &&
      (typeof requested !== 'string' ||
        !REASONING_EFFORTS.includes(requested as ReasoningEffort))) ||
    (applied !== null && (typeof applied !== 'string' || applied.length === 0))
  ) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has invalid reasoning effort values',
    )
  }
  const expectedRequested = profile.model?.reasoningEffort ?? null
  // `@tangle-network/agent-interface` owns the canonical-effort → native-control map, and the
  // cli-bridge argv builders read the same one: the acknowledgement is checked against what the
  // process must have received, and a renamed rung moves both sides together.
  const receiptHarness = harnessTypeSchema.safeParse(raw.harness)
  const expectedApplied = receiptHarness.success
    ? nativeReasoningControl(receiptHarness.data, expectedRequested)
    : null
  if (requested !== expectedRequested || applied !== expectedApplied) {
    throw new ValidationError(
      `bridgeExecutor: bridge materialized reasoning effort ${JSON.stringify({ requested, applied })}, expected ${JSON.stringify({ requested: expectedRequested, applied: expectedApplied })}`,
    )
  }
  if (
    typeof raw.workspacePlanDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(raw.workspacePlanDigest)
  ) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has invalid workspacePlanDigest',
    )
  }
  if (!Array.isArray(raw.files) || !Array.isArray(raw.unsupported)) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt files/unsupported must be arrays',
    )
  }
  const files = raw.files.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ValidationError('bridgeExecutor: profile materialization receipt has invalid file')
    }
    const file = entry as Record<string, unknown>
    if (
      Object.keys(file).sort().join(',') !== 'mode,path' ||
      typeof file.path !== 'string' ||
      file.path.length === 0 ||
      !Number.isSafeInteger(file.mode) ||
      (file.mode as number) < 0
    ) {
      throw new ValidationError('bridgeExecutor: profile materialization receipt has invalid file')
    }
    return { path: file.path, mode: file.mode as number }
  })
  const unsupported = raw.unsupported.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ValidationError(
        'bridgeExecutor: profile materialization receipt has invalid unsupported entry',
      )
    }
    const item = entry as Record<string, unknown>
    if (
      Object.keys(item).sort().join(',') !== 'dimension,reason' ||
      typeof item.dimension !== 'string' ||
      item.dimension.length === 0 ||
      typeof item.reason !== 'string' ||
      item.reason.length === 0
    ) {
      throw new ValidationError(
        'bridgeExecutor: profile materialization receipt has invalid unsupported entry',
      )
    }
    return { dimension: item.dimension, reason: item.reason }
  })
  if (unsupported.length > 0) {
    throw new ValidationError(
      `bridgeExecutor: bridge did not materialize profile dimensions: ${unsupported.map((item) => item.dimension).join(', ')}`,
    )
  }
  return Object.freeze({
    schema: bridgeProfileMaterializationSchema,
    effectiveProfileDigest,
    harness: raw.harness,
    provider: raw.provider as string | null,
    model: raw.model,
    reasoningEffort: {
      requested: requested as ReasoningEffort | null,
      applied: applied as string | null,
    },
    ...(inference === undefined ? {} : { inference }),
    workspacePlanDigest: raw.workspacePlanDigest,
    files: Object.freeze(files),
    unsupported: Object.freeze(unsupported),
  })
}

/**
 * Remove `inference.observation` — and ONLY that — before the cross-turn identity comparison.
 * cli-bridge's pi backend writes per-turn traffic and token counters into the receipt's
 * `inference.observation` block (`requests`, `generationRequests`, `usageReceipts`, the `usage`
 * token totals): a fresh measurement on every turn BY DESIGN, not profile identity, so two honest
 * receipts from the same session are never byte-equal and the raw compare refused every
 * multi-turn pi session at the end of turn 2. Every identity field stays compared: schema,
 * effectiveProfileDigest, harness, provider, model, reasoningEffort, workspacePlanDigest, files,
 * unsupported, and the stable inference identity (`effectiveEndpoint`, `apiMode`, `transport`,
 * `appliedMaxTokens`).
 */
export function stripMaterializationObservation(
  receipt: BridgeProfileMaterializationReceipt,
): BridgeProfileMaterializationReceipt {
  if (receipt.inference === undefined) return receipt
  const { observation: _observation, ...inferenceIdentity } = receipt.inference
  return { ...receipt, inference: inferenceIdentity }
}

function parseBridgeInferenceReceipt(value: unknown): BridgeInferenceReceipt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization receipt has an invalid inference block',
    )
  }
  const raw = value as Record<string, unknown>
  assertBridgeReceiptKeys(
    raw,
    ['apiMode', 'effectiveEndpoint', 'transport'],
    ['appliedMaxTokens', 'observation'],
    'profile materialization inference block',
  )
  const effectiveEndpoint = raw.effectiveEndpoint
  if (typeof effectiveEndpoint !== 'string' || effectiveEndpoint.length === 0) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization inference block has no effectiveEndpoint',
    )
  }
  const apiMode = raw.apiMode
  if (typeof apiMode !== 'string' || apiMode.length === 0) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization inference block has no apiMode',
    )
  }
  if (raw.transport !== 'scoped-loopback') {
    throw new ValidationError(
      'bridgeExecutor: profile materialization inference block has invalid transport',
    )
  }
  const observation =
    raw.observation === undefined ? undefined : parseBridgeInferenceObservation(raw.observation)
  const appliedMaxTokens =
    raw.appliedMaxTokens === undefined
      ? undefined
      : bridgeInferencePositiveCount(raw.appliedMaxTokens, 'appliedMaxTokens')
  return detachedSnapshot(
    {
      effectiveEndpoint,
      apiMode,
      transport: 'scoped-loopback' as const,
      ...(appliedMaxTokens === undefined ? {} : { appliedMaxTokens }),
      ...(observation === undefined ? {} : { observation }),
    },
    'bridgeExecutor: profile materialization inference block',
  )
}

function parseBridgeInferenceObservation(value: unknown): BridgeInferenceObservation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization inference observation must be an object',
    )
  }
  const raw = value as Record<string, unknown>
  assertBridgeReceiptKeys(
    raw,
    [
      'accountingMatched',
      'auxiliaryRequests',
      'failedRequests',
      'generationRequests',
      'inFlightRequests',
      'rejectedRequests',
      'requests',
      'usage',
      'usageReceipts',
    ],
    [],
    'profile materialization inference observation',
  )
  const observation = {
    requests: bridgeInferenceCount(raw.requests, 'requests'),
    generationRequests: bridgeInferenceCount(raw.generationRequests, 'generationRequests'),
    auxiliaryRequests: bridgeInferenceCount(raw.auxiliaryRequests, 'auxiliaryRequests'),
    usageReceipts: bridgeInferenceCount(raw.usageReceipts, 'usageReceipts'),
    rejectedRequests: bridgeInferenceCount(raw.rejectedRequests, 'rejectedRequests'),
    failedRequests: bridgeInferenceCount(raw.failedRequests, 'failedRequests'),
    inFlightRequests: bridgeInferenceCount(raw.inFlightRequests, 'inFlightRequests'),
    accountingMatched: bridgeInferenceBoolean(raw.accountingMatched, 'accountingMatched'),
    usage: parseBridgeInferenceUsage(raw.usage),
  }
  return detachedSnapshot(
    observation,
    'bridgeExecutor: profile materialization inference observation',
  )
}

function parseBridgeInferenceUsage(value: unknown): BridgeInferenceUsage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization inference usage must be an object',
    )
  }
  const raw = value as Record<string, unknown>
  assertBridgeReceiptKeys(
    raw,
    ['costKnown'],
    [
      'cacheReadInputTokens',
      'cacheWriteInputTokens',
      'estimatedCost',
      'freshInputTokens',
      'inputTokens',
      'outputTokens',
    ],
    'profile materialization inference usage',
  )
  if (raw.costKnown !== false) {
    throw new ValidationError(
      'bridgeExecutor: profile materialization inference usage must report costKnown=false',
    )
  }
  const usage = {
    ...(raw.inputTokens === undefined
      ? {}
      : { inputTokens: bridgeInferenceCount(raw.inputTokens, 'usage.inputTokens') }),
    ...(raw.freshInputTokens === undefined
      ? {}
      : { freshInputTokens: bridgeInferenceCount(raw.freshInputTokens, 'usage.freshInputTokens') }),
    ...(raw.cacheReadInputTokens === undefined
      ? {}
      : {
          cacheReadInputTokens: bridgeInferenceCount(
            raw.cacheReadInputTokens,
            'usage.cacheReadInputTokens',
          ),
        }),
    ...(raw.cacheWriteInputTokens === undefined
      ? {}
      : {
          cacheWriteInputTokens: bridgeInferenceCount(
            raw.cacheWriteInputTokens,
            'usage.cacheWriteInputTokens',
          ),
        }),
    ...(raw.outputTokens === undefined
      ? {}
      : { outputTokens: bridgeInferenceCount(raw.outputTokens, 'usage.outputTokens') }),
    costKnown: false as const,
    ...(raw.estimatedCost === undefined
      ? {}
      : { estimatedCost: bridgeInferenceMoney(raw.estimatedCost, 'usage.estimatedCost') }),
  }
  return detachedSnapshot(usage, 'bridgeExecutor: profile materialization inference usage')
}

function assertBridgeReceiptKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  context: string,
): void {
  const requiredSet = new Set(required)
  const optionalSet = new Set(optional)
  const missing = required.filter((key) => !Object.hasOwn(value, key))
  const unknown = Object.keys(value).filter((key) => !requiredSet.has(key) && !optionalSet.has(key))
  if (missing.length > 0 || unknown.length > 0) {
    throw new ValidationError(
      `bridgeExecutor: ${context} has missing or unknown fields` +
        (missing.length > 0 ? ` (missing: ${missing.sort().join(', ')})` : '') +
        (unknown.length > 0 ? ` (unknown: ${unknown.sort().join(', ')})` : ''),
    )
  }
}

function bridgeInferenceCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ValidationError(
      `bridgeExecutor: profile materialization inference ${field} must be a nonnegative safe integer`,
    )
  }
  return value as number
}

function bridgeInferencePositiveCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ValidationError(
      `bridgeExecutor: profile materialization inference ${field} must be a positive safe integer`,
    )
  }
  return value as number
}

function bridgeInferenceBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(
      `bridgeExecutor: profile materialization inference ${field} must be boolean`,
    )
  }
  return value
}

function bridgeInferenceMoney(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(
      `bridgeExecutor: profile materialization inference ${field} must be finite and nonnegative`,
    )
  }
  return value
}

/**
 * Decode the OpenAI-shaped `tool_calls` of one delta into the shared `ToolStepInput` currency,
 * through the SAME `decodeOpenAiPart` adapter the sandbox/parts trace source uses — the wire shape
 * cli-bridge emits (`{index, id, type:'function', function:{name, arguments}}`) is exactly the one
 * that decoder owns, so there is no second mapping to drift.
 *
 * FIDELITY, stated once: this wire carries the model's DECISION to call a tool. cli-bridge's
 * backends surface the call the moment the harness announces it and NEVER report the call
 * finishing, so no outcome, result, or duration exists to read. Each step is therefore marked
 * `statusCaptured: false` and carries no `startedAt`/`endedAt` — its span is an instant with no
 * status. Synthesising an end time would inject a fabricated 0ms latency, and defaulting to 'ok'
 * would count an unobserved call as a success; both would silently corrupt any downstream latency
 * or error-rate analysis. An honest lower-fidelity span beats a fabricated one. A harness whose
 * native protocol reports tool completion could carry true durations; this wire does not.
 *
 * cli-bridge emits each call complete in ONE delta (`{id, name, arguments}` together), so no
 * cross-delta argument-fragment assembly is needed; a frame that carries argument bytes without a
 * name decodes to nothing rather than to a nameless call.
 */
function decodeBridgeToolCalls(raw: unknown): ToolStepInput[] {
  if (!Array.isArray(raw)) return []
  const steps: ToolStepInput[] = []
  for (const call of raw) {
    if (!call || typeof call !== 'object') continue
    const record = call as Record<string, unknown>
    const fn = record.function as Record<string, unknown> | undefined
    // `type` is what `decodeOpenAiPart` matches on. A named function is a tool call whatever the
    // entry calls itself, and the previous parser keyed only on `function.name` — so normalize on
    // the name and never let an unrecognized `type` narrow what this executor observes. Dropping
    // one here also drops it from the public `out.toolCalls`.
    const named = typeof fn?.name === 'string' && fn.name.length > 0
    const step = decodeOpenAiPart(named ? { ...record, type: 'function' } : record)
    if (!step) continue
    const rawArgs = fn?.arguments ?? record.arguments
    const argsCaptured =
      typeof rawArgs === 'string' ? rawArgs.trim().length > 0 : rawArgs !== undefined
    steps.push({
      ...step,
      // An empty/absent `arguments` is an uncaptured argument list, not an empty one.
      ...(argsCaptured ? {} : { args: {}, argsCaptured: false }),
      statusCaptured: false,
    })
  }
  return steps
}

type BridgeSseEvent =
  | { kind: 'event'; id: number; chunk?: BridgeStreamChunk; error?: Error }
  | { kind: 'done' }

/**
 * Parse cli-bridge's OpenAI-compatible SSE stream into normalized chunks. Each
 * `data:` line is an OpenAI chat-completion chunk (`choices[].delta`). Every
 * run-owned frame, including an id-only comment, is returned so the caller can
 * prove a contiguous replay sequence. Transport keepalives have no id and are ignored.
 */
export async function* parseSseChatStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<BridgeSseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // SSE frames are separated by a blank line; split on it and keep the tail.
      let separator = /\r?\n\r?\n/u.exec(buf)
      while (separator) {
        const frame = buf.slice(0, separator.index)
        buf = buf.slice(separator.index + separator[0].length)
        const event = parseSseFrame(frame)
        if (event) yield event
        separator = /\r?\n\r?\n/u.exec(buf)
      }
    }
    buf += decoder.decode()
    // Upstream failures routinely arrive UNTERMINATED: a final `data:` frame
    // with no trailing blank line, or a bare JSON error body with no SSE
    // framing at all (kimi's access_terminated_error). Dropping the tail here
    // ends the stream as one empty zero-token turn — the integrity guard still
    // fails the run, but the diagnostic dies with the buffer. Parse the tail so
    // the upstream error message rides the thrown event instead.
    const tail = parseSseStreamTail(buf)
    if (tail !== undefined) yield tail
  } finally {
    reader.releaseLock()
  }
}

/** Parse the stream's unterminated tail: an SSE frame missing its trailing
 *  blank line, or a bare (non-SSE) JSON body — the shape bridge upstreams use
 *  for terminal failures. Throws `ValidationError` on an error payload; returns
 *  `undefined` for keepalive noise or non-JSON leftovers. */
function parseSseStreamTail(buf: string): BridgeSseEvent | undefined {
  const tail = buf.trim()
  if (!tail) return undefined
  const framed = parseSseFrame(tail)
  if (framed !== undefined) return framed
  let parsed: {
    error?: { message?: string; type?: string; provider_dispatch?: unknown }
  }
  try {
    parsed = JSON.parse(tail)
  } catch {
    return undefined
  }
  if (parsed.error) {
    throw bridgeUpstreamError(parsed.error, 'bridgeExecutor: bridge upstream error')
  }
  return undefined
}

/** Parse one SSE frame into a numbered run event, terminal marker, or unnumbered keepalive. */
function parseSseFrame(frame: string): BridgeSseEvent | undefined {
  const dataLines: string[] = []
  let id: number | undefined
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('id:')) {
      const rawId = line.slice('id:'.length).trim()
      if (!/^[1-9][0-9]*$/u.test(rawId)) {
        throw new ValidationError(`bridgeExecutor: invalid SSE event id ${JSON.stringify(rawId)}`)
      }
      const parsedId = Number(rawId)
      if (!Number.isSafeInteger(parsedId)) {
        throw new ValidationError(`bridgeExecutor: SSE event id exceeds safe integer range`)
      }
      id = parsedId
      continue
    }
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart())
  }
  if (dataLines.length === 0) {
    return id === undefined ? undefined : { kind: 'event', id }
  }
  const data = dataLines.join('\n')
  if (data === '[DONE]') return { kind: 'done' }
  let parsed: {
    model?: unknown
    system_fingerprint?: unknown
    choices?: Array<{
      delta?: {
        content?: string | null
        tool_calls?: unknown
      }
      message?: { content?: string | null }
    }>
    error?: { message?: string; type?: string; provider_dispatch?: unknown }
    usage?: {
      prompt_tokens?: unknown
      completion_tokens?: unknown
      fresh_input_tokens?: unknown
      cache_read_input_tokens?: unknown
      cache_write_input_tokens?: unknown
      prompt_cache_hit_tokens?: unknown
      prompt_tokens_details?: { cached_tokens?: unknown }
      prompt_cache?: { read_tokens?: unknown; write_tokens?: unknown }
      cost?: unknown
      estimated_cost?: unknown
      cost_known?: unknown
      cost_provenance?: unknown
      cost_scope?: unknown
      estimated?: unknown
    }
    profile_materialization?: unknown
  }
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new ValidationError('bridgeExecutor: bridge emitted a non-JSON SSE data frame')
  }
  if (id === undefined) {
    throw new ValidationError('bridgeExecutor: bridge emitted an unnumbered run event')
  }
  if (parsed.error) {
    // `type` is the upstream's error class (e.g. kimi's access_terminated_error)
    // — carry it when the payload has no message, never collapse to 'unknown'.
    //
    // TRANSPORT, not validation. What arrives here is the harness's or the provider's failure
    // relayed mid-stream — a turn that ended without emitting anything, a dropped upstream, a
    // provider 5xx. Typing it as a validation error made it read as Runtime's own deliberate
    // refusal, which is precisely what the root-driver retry treats as terminal: measured on a
    // six-arm wave, three arms died on `pi assistant turn failed: The model finished
    // (finish_reason=stop) without emitting any visible output — Retry the request`, and the
    // retry declined to retry a message that asked to be retried.
    return {
      kind: 'event',
      id,
      error: bridgeUpstreamError(parsed.error, 'bridgeExecutor: bridge stream error'),
    }
  }
  const out: BridgeStreamChunk = {}
  if (parsed.model !== undefined) {
    if (typeof parsed.model !== 'string' || parsed.model.length === 0) {
      throw new ValidationError('bridgeExecutor: bridge response model must be a non-empty string')
    }
    out.model = parsed.model
  }
  if (parsed.system_fingerprint !== undefined) {
    if (typeof parsed.system_fingerprint !== 'string' || parsed.system_fingerprint.length === 0) {
      throw new ValidationError(
        'bridgeExecutor: bridge system_fingerprint must be a non-empty string',
      )
    }
    out.systemFingerprint = parsed.system_fingerprint
  }
  const choice = parsed.choices?.[0]
  const content = choice?.delta?.content ?? choice?.message?.content
  if (typeof content === 'string' && content.length > 0) out.content = content
  const toolCalls = decodeBridgeToolCalls(choice?.delta?.tool_calls)
  if (toolCalls.length > 0) out.toolCalls = toolCalls
  const u = parsed.usage
  if (u) {
    const input = optionalBridgeTokenCount(u.prompt_tokens, 'prompt_tokens')
    const output = optionalBridgeTokenCount(u.completion_tokens, 'completion_tokens')
    const readInput = optionalBridgeTokenCount(
      u.cache_read_input_tokens ??
        u.prompt_cache?.read_tokens ??
        u.prompt_cache_hit_tokens ??
        u.prompt_tokens_details?.cached_tokens,
      'cache read input tokens',
    )
    const writeInput = optionalBridgeTokenCount(
      u.cache_write_input_tokens ?? u.prompt_cache?.write_tokens,
      'cache write input tokens',
    )
    const explicitFreshInput = optionalBridgeTokenCount(u.fresh_input_tokens, 'fresh_input_tokens')
    const freshInput =
      explicitFreshInput ??
      (input !== undefined &&
      readInput !== undefined &&
      writeInput !== undefined &&
      input >= readInput + writeInput
        ? input - readInput - writeInput
        : undefined)
    if (
      input !== undefined ||
      output !== undefined ||
      freshInput !== undefined ||
      readInput !== undefined ||
      writeInput !== undefined
    ) {
      out.usage = {
        input: input ?? 0,
        output: output ?? 0,
        known: input !== undefined && output !== undefined && u.estimated !== true,
        ...(freshInput !== undefined || readInput !== undefined || writeInput !== undefined
          ? {
              promptCache: {
                ...(freshInput !== undefined ? { freshInput } : {}),
                ...(readInput !== undefined ? { readInput } : {}),
                ...(writeInput !== undefined ? { writeInput } : {}),
              },
            }
          : {}),
      }
    }
    if (u.estimated !== undefined && typeof u.estimated !== 'boolean') {
      throw new ValidationError('bridgeExecutor: usage.estimated must be boolean')
    }
    if (u.cost_scope !== undefined && u.cost_scope !== 'incremental' && u.cost_scope !== 'total') {
      throw new ValidationError("bridgeExecutor: usage.cost_scope must be 'incremental' or 'total'")
    }
    out.costScope = u.cost_scope === 'total' ? 'total' : 'incremental'
    applyBridgeCostReceipt(out, u)
  }
  if (parsed.profile_materialization !== undefined) {
    out.profileMaterialization =
      parsed.profile_materialization as BridgeProfileMaterializationReceipt
  }
  return {
    kind: 'event',
    id,
    ...(Object.keys(out).length > 0 ? { chunk: out } : {}),
  }
}

function optionalBridgeTokenCount(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ValidationError(`bridgeExecutor: usage.${field} must be a nonnegative safe integer`)
  }
  return value as number
}

function optionalBridgeMoney(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(`bridgeExecutor: usage.${field} must be a finite nonnegative number`)
  }
  return value
}

/** Admit billed spend only with explicit trusted provenance. A catalog estimate remains visible on
 * the result but can never debit a dollar budget or turn unknown dollars into a known zero. */
function applyBridgeCostReceipt(
  out: BridgeStreamChunk,
  usage: {
    cost?: unknown
    estimated_cost?: unknown
    cost_known?: unknown
    cost_provenance?: unknown
  },
): void {
  const cost = optionalBridgeMoney(usage.cost, 'cost')
  const estimatedCost = optionalBridgeMoney(usage.estimated_cost, 'estimated_cost')
  const provenance = usage.cost_provenance
  if (usage.cost_known !== true && usage.cost_known !== false) {
    throw new ValidationError('bridgeExecutor: usage.cost_known must be an explicit boolean')
  }
  if (usage.cost_known) {
    if (
      cost === undefined ||
      (provenance !== 'provider-receipt' && provenance !== 'billing-receipt') ||
      estimatedCost !== undefined
    ) {
      throw new ValidationError(
        'bridgeExecutor: known cost requires cost plus provider-receipt or billing-receipt provenance',
      )
    }
    out.costKnown = true
    out.cost = cost
    out.costProvenance = provenance
    return
  }
  if (cost !== undefined) {
    throw new ValidationError('bridgeExecutor: unknown cost cannot carry billed cost')
  }
  if (estimatedCost !== undefined && provenance !== 'catalog-estimate') {
    throw new ValidationError('bridgeExecutor: estimated cost requires catalog-estimate provenance')
  }
  if (
    estimatedCost === undefined &&
    provenance !== undefined &&
    provenance !== 'catalog-estimate'
  ) {
    throw new ValidationError('bridgeExecutor: unknown cost has invalid provenance')
  }
  out.costKnown = false
  if (estimatedCost !== undefined) out.estimatedCost = estimatedCost
}
