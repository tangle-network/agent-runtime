/**
 *
 * Tangle Intelligence — the RECEIVE half of the loop (pull-by-default).
 *
 * The sibling Observe path (`./index`) sends run records UP to the plane. This
 * module pulls certified context DOWN: it reads the tenant's promoted prompts,
 * skills, instructions, and safe files from the deployed Intelligence plane so
 * an approved improvement reaches the running agent.
 *
 * Pull contract (deployed plane): GET /v1/contexts/:target/certified →
 *   { tenantId, target, state, revision, generatedAt, expiresAt, entries, contentHash }
 * Auth: Bearer <apiKey> (the one TANGLE_API_KEY shared by router + sandbox +
 * intelligence), resolved to a tenant by platform-api's key-verify S2S contract.
 *
 * @experimental
 */

import { type CertifiedContext, parseCertifiedContext } from '@tangle-network/agent-interface'
import { type AgentImprovementProposal, verifyAgentImprovementProposal } from './improvement-cycle'

const defaultPlaneBaseUrl = 'https://intelligence.tangle.tools'
const defaultRefreshMs = 300_000
const maxCertifiedContextResponseBytes = 16_777_216
const maxProposalResponseBytes = 1_048_576
const maxPlaneErrorResponseBytes = 4_096
const maxGeneratedAtClockSkewMs = 300_000

export type {
  CertifiedContext,
  CertifiedContextDelivery,
  CertifiedContextEntry,
  CertifiedContextKind,
  CertifiedContextProvenance,
} from '@tangle-network/agent-interface'

/** Typed outcome for the pull. Inspect `succeeded` before reading `value`. */
export type PullCertifiedContextOutcome =
  | { succeeded: true; value: CertifiedContext }
  | { succeeded: false; error: string; status?: number }

export interface IntelligenceEndpointPolicy {
  /**
   * Exact HTTPS origins trusted in addition to the default Tangle
   * Intelligence origin. A custom `baseUrl` is rejected unless its origin is
   * listed here.
   */
  trustedBaseOrigins?: readonly string[]
  /** Permit explicit loopback HTTP endpoints for local development and tests. */
  allowInsecureLoopback?: boolean
}

export interface PullCertifiedContextOptions extends IntelligenceEndpointPolicy {
  /** Authenticated tenant expected in the signed response. */
  tenantId: string
  /** Agent target the certified context is promoted under. */
  target: string
  /** Bearer key. Defaults to `process.env.TANGLE_API_KEY`. */
  apiKey?: string
  /** Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
   *  `https://intelligence.tangle.tools`. */
  baseUrl?: string
  /** fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Abort the request after this many ms. Default 10000. */
  timeoutMs?: number
  /** Current time source for expiry checks. Defaults to `Date.now`. */
  now?: () => number
}

/** What Runtime knows about a failed proposal submission.
 * `not-sent` means no request began, `rejected` means Intelligence returned a
 * definitive 4xx response, and `unconfirmed` means the caller may safely retry
 * the same immutable proposal. */
export type AgentImprovementProposalSubmissionState = 'not-sent' | 'rejected' | 'unconfirmed'

/** Submit a completed measured proposal for product-side review. */
export interface SubmitAgentImprovementProposalOptions extends IntelligenceEndpointPolicy {
  proposal: AgentImprovementProposal
  /** Bearer key. Defaults to `process.env.TANGLE_API_KEY`. */
  apiKey?: string
  /** Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
   * `https://intelligence.tangle.tools`. */
  baseUrl?: string
  /** fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Abort the request after this many ms. Default 10000. */
  timeoutMs?: number
}

/** Typed result for proposal submission. A successful result contains the
 * exact immutable proposal Intelligence recorded. */
export type SubmitAgentImprovementProposalOutcome =
  | { succeeded: true; value: AgentImprovementProposal; status: number }
  | {
      succeeded: false
      submission: AgentImprovementProposalSubmissionState
      error: string
      status?: number
      code?: string
    }

const defaultPlaneRequestTimeoutMs = 10_000
const maxPlaneRequestTimeoutMs = 300_000
const maxPlaneErrorTextLength = 200
const maxApiKeyLength = 16_384
const maxPlaneIdentityLength = 256
const maxCheckpointRevision = 9_223_372_036_854_775_807n
const checkpointRevisionPattern = /^(0|[1-9]\d{0,18})$/
const checkpointContentHashPattern = /^sha256:[0-9a-f]{64}$/

type PlaneRequestOptions = Pick<
  PullCertifiedContextOptions,
  'apiKey' | 'baseUrl' | 'fetchImpl' | 'timeoutMs' | 'trustedBaseOrigins' | 'allowInsecureLoopback'
>

interface PlaneRequestInput extends PlaneRequestOptions {
  path: string
  method?: 'POST'
  headers?: Record<string, string>
  body?: string
  maxSuccessResponseBytes: number
}

type PlaneRequestResult =
  | { succeeded: true; status: number; ok: boolean; body: string }
  | { succeeded: false; attempted: false; error: string; status?: number }
  | { succeeded: false; attempted: true; error: string; status?: number }

function trustedOrigins(values: readonly string[] | undefined): ReadonlySet<string> {
  const origins = new Set<string>([new URL(defaultPlaneBaseUrl).origin])
  for (const value of values ?? []) {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error('trustedBaseOrigins entries must be HTTPS origins without paths')
    }
    origins.add(parsed.origin)
  }
  return origins
}

/** Resolve the Intelligence base URL used by both send and receive paths. */
export function resolveIntelligenceBaseUrl(
  baseUrl: string | undefined,
  policy: IntelligenceEndpointPolicy = {},
): string {
  const raw =
    baseUrl ??
    (typeof process !== 'undefined' ? process.env.TANGLE_INTELLIGENCE_URL : undefined) ??
    defaultPlaneBaseUrl
  const parsed = new URL(raw)
  const loopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]'
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Intelligence baseUrl cannot include credentials, query, or fragment')
  }
  if (parsed.protocol === 'http:' && loopback) {
    if (policy.allowInsecureLoopback !== true) {
      throw new Error('loopback HTTP requires allowInsecureLoopback: true')
    }
  } else {
    if (parsed.protocol !== 'https:') {
      throw new Error('Intelligence baseUrl must use HTTPS')
    }
    if (!trustedOrigins(policy.trustedBaseOrigins).has(parsed.origin)) {
      throw new Error(
        `Intelligence baseUrl origin '${parsed.origin}' is not trusted; add it to trustedBaseOrigins`,
      )
    }
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString().replace(/\/+$/, '')
}

function resolveApiKey(apiKey: string | undefined): string {
  if (apiKey !== undefined) return apiKey
  if (typeof process !== 'undefined' && process.env.TANGLE_API_KEY)
    return process.env.TANGLE_API_KEY
  return ''
}

/** Make one authenticated request and retain whether the network call began. */
async function requestPlane(input: PlaneRequestInput): Promise<PlaneRequestResult> {
  const doFetch = input.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)
  if (!doFetch) {
    return { succeeded: false, attempted: false, error: 'no fetch implementation available' }
  }
  const apiKey = resolveApiKey(input.apiKey)
  if (!apiKey) {
    return {
      succeeded: false,
      attempted: false,
      error: 'no apiKey (set TANGLE_API_KEY or opts.apiKey)',
    }
  }
  if (apiKey.length > maxApiKeyLength || /[\r\n]/.test(apiKey)) {
    return { succeeded: false, attempted: false, error: 'apiKey is not a valid header value' }
  }

  let url: string
  let timeoutMs: number
  try {
    const configuredTimeout = input.timeoutMs ?? defaultPlaneRequestTimeoutMs
    if (
      !Number.isInteger(configuredTimeout) ||
      configuredTimeout <= 0 ||
      configuredTimeout > maxPlaneRequestTimeoutMs
    ) {
      throw new Error(`timeoutMs must be an integer from 1 through ${maxPlaneRequestTimeoutMs}`)
    }
    timeoutMs = configuredTimeout
    url = `${resolveIntelligenceBaseUrl(input.baseUrl, input)}${input.path}`
  } catch (error) {
    return {
      succeeded: false,
      attempted: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let responseStatus: number | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([
      (async () => {
        const response = await doFetch(url, {
          ...(input.method === undefined ? {} : { method: input.method }),
          headers: {
            authorization: `Bearer ${apiKey}`,
            ...(input.headers ?? {}),
          },
          ...(input.body === undefined ? {} : { body: input.body }),
          redirect: 'error',
          signal: controller.signal,
        })
        responseStatus = response.status
        return {
          status: response.status,
          ok: response.ok,
          body: await readBoundedResponseText(
            response,
            response.ok ? input.maxSuccessResponseBytes : maxPlaneErrorResponseBytes,
          ),
        }
      })(),
      timeout,
    ])
    return { succeeded: true, ...result }
  } catch (err) {
    return {
      succeeded: false,
      attempted: true,
      error: err instanceof Error ? err.message : String(err),
      ...(responseStatus === undefined ? {} : { status: responseStatus }),
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function capPlaneErrorText(value: string): string {
  return value.slice(0, maxPlaneErrorTextLength)
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function encodePlaneIdentity(value: string, name: 'tenantId' | 'target'): string {
  if (
    value.trim().length === 0 ||
    value.length > maxPlaneIdentityLength ||
    hasControlCharacter(value)
  ) {
    throw new Error(`${name} must be a non-blank identifier of at most 256 characters`)
  }
  try {
    return encodeURIComponent(value)
  } catch {
    throw new Error(`${name} must contain well-formed Unicode`)
  }
}

/**
 * Pull certified context for a target. Fail-closed: a network
 * error or a non-2xx returns a typed `succeeded: false` (never throws), so a
 * caller can run on its base surface when Intelligence is unreachable. A
 * conforming endpoint always returns a revisioned active or revoked response.
 */
export async function pullCertifiedContext(
  opts: PullCertifiedContextOptions,
): Promise<PullCertifiedContextOutcome> {
  let path: string
  try {
    encodePlaneIdentity(opts.tenantId, 'tenantId')
    path = `/v1/contexts/${encodePlaneIdentity(opts.target, 'target')}/certified`
  } catch (error) {
    return {
      succeeded: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  const request = await requestPlane({
    ...opts,
    path,
    maxSuccessResponseBytes: maxCertifiedContextResponseBytes,
  })
  if (request.status === 404) {
    return {
      succeeded: false,
      error:
        'incompatible certified-context endpoint: expected a revisioned response, received 404',
      status: 404,
    }
  }
  if (!request.succeeded) {
    return {
      succeeded: false,
      error: request.attempted ? `pull request failed: ${request.error}` : request.error,
      ...(request.status === undefined ? {} : { status: request.status }),
    }
  }
  if (!request.ok) {
    return {
      succeeded: false,
      error: `pull ${request.status}: ${request.body.slice(0, 200)}`,
      status: request.status,
    }
  }
  try {
    const context = parseCertifiedContext(JSON.parse(request.body))
    if (context.tenantId !== opts.tenantId) {
      throw new Error(
        `response tenant '${context.tenantId}' does not match authenticated tenant '${opts.tenantId}'`,
      )
    }
    if (context.target !== opts.target) {
      throw new Error(
        `response target '${context.target}' does not match requested target '${opts.target}'`,
      )
    }
    assertCertifiedContextCurrent(context, (opts.now ?? Date.now)())
    return { succeeded: true, value: context }
  } catch (err) {
    return {
      succeeded: false,
      error: `pull response parse failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** Reject context that is not valid at the supplied wall-clock instant. */
export function assertCertifiedContextCurrent(context: CertifiedContext, nowMs: number): void {
  const generatedAt = Date.parse(context.generatedAt)
  const expiresAt = Date.parse(context.expiresAt)
  if (generatedAt > nowMs + maxGeneratedAtClockSkewMs) {
    throw new Error('certified context was generated too far in the future')
  }
  if (expiresAt <= nowMs) {
    throw new Error('certified context has expired')
  }
}

/**
 * Submit a completed Runtime proposal to Intelligence for product-side review.
 * This never runs an experiment, approves a proposal, or applies a candidate.
 * A 4xx response is a confirmed `rejected` request. Network failures, timeouts,
 * 5xx responses, and invalid success responses are `unconfirmed`, so callers
 * can retry the same digest because Intelligence stores proposals idempotently.
 */
export async function submitAgentImprovementProposal(
  opts: SubmitAgentImprovementProposalOptions,
): Promise<SubmitAgentImprovementProposalOutcome> {
  let proposal: AgentImprovementProposal
  try {
    proposal = verifyAgentImprovementProposal(opts.proposal)
  } catch (err) {
    return {
      succeeded: false,
      submission: 'not-sent',
      error: `proposal validation failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const request = await requestPlane({
    ...opts,
    path: '/v1/improvements/proposals',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proposal }),
    maxSuccessResponseBytes: maxProposalResponseBytes,
  })
  if (!request.succeeded) {
    const definitivelyRejected =
      request.status !== undefined && request.status >= 400 && request.status < 500
    return {
      succeeded: false,
      submission: definitivelyRejected
        ? 'rejected'
        : request.attempted
          ? 'unconfirmed'
          : 'not-sent',
      error: definitivelyRejected
        ? `proposal submission ${request.status}: ${request.error}`
        : request.attempted
          ? `proposal submission request failed: ${request.error}`
          : request.error,
      ...(request.status === undefined ? {} : { status: request.status }),
    }
  }
  if (!request.ok) {
    let code: string | undefined
    let message = capPlaneErrorText(request.body)
    try {
      const parsed = asRecord(JSON.parse(request.body))
      if (typeof parsed.error === 'string') code = capPlaneErrorText(parsed.error)
      if (typeof parsed.message === 'string') message = capPlaneErrorText(parsed.message)
    } catch {
      // The response body is optional; the HTTP status still determines the outcome.
    }
    return {
      succeeded: false,
      submission: request.status >= 400 && request.status < 500 ? 'rejected' : 'unconfirmed',
      error: `proposal submission ${request.status}: ${message}`,
      status: request.status,
      ...(code === undefined ? {} : { code }),
    }
  }

  try {
    const response = asRecord(JSON.parse(request.body))
    const recorded = verifyAgentImprovementProposal(response.proposal)
    if (recorded.digest !== proposal.digest) {
      return {
        succeeded: false,
        submission: 'unconfirmed',
        error: 'proposal submission returned a different proposal digest',
        status: request.status,
      }
    }
    return { succeeded: true, value: recorded, status: request.status }
  } catch (err) {
    return {
      succeeded: false,
      submission: 'unconfirmed',
      error: `proposal submission response parse failed: ${capPlaneErrorText(
        err instanceof Error ? err.message : String(err),
      )}`,
      status: request.status,
    }
  }
}

const contextKindOrder = {
  prompt: 0,
  skill: 1,
  instructions: 2,
} as const

/** Fold inline certified context into a base system prompt. */
export function composeCertifiedContextPrompt(
  base: string,
  certified: Pick<CertifiedContext, 'entries'> | null,
): string {
  const parts = inlineCertifiedContextEntries(certified)
  if (parts.length === 0) return base
  return `${base.trim()}\n\n## Certified guidance (Tangle Intelligence)\n\n${parts.join('\n\n')}`
}

/** Return the context additions in the exact order used by prompt composition. */
function inlineCertifiedContextEntries(
  certified: Pick<CertifiedContext, 'entries'> | null,
): readonly string[] {
  if (!certified) return []
  return Object.freeze(
    certified.entries
      .filter((entry) => entry.delivery.kind === 'inline')
      .sort((left, right) => {
        return (
          contextKindOrder[left.kind] - contextKindOrder[right.kind] ||
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id)
        )
      })
      .map((entry) => entry.delivery.content.trim())
      .filter((content) => content.length > 0),
  )
}

/** Return immutable safe files from certified context. */
function certifiedContextFileEntries(
  certified: Pick<CertifiedContext, 'entries'> | null,
): readonly Readonly<{ path: string; content: string }>[] {
  if (!certified) return []
  return Object.freeze(
    certified.entries
      .filter(
        (
          entry,
        ): entry is typeof entry & {
          delivery: { kind: 'file'; path: string; content: string }
        } => entry.delivery.kind === 'file',
      )
      .sort(
        (left, right) =>
          left.delivery.path.localeCompare(right.delivery.path) || left.id.localeCompare(right.id),
      )
      .map((entry) =>
        Object.freeze({ path: entry.delivery.path, content: entry.delivery.content }),
      ),
  )
}

export interface ComposedCertifiedContext {
  readonly systemPrompt: string
  readonly promptAdditions: readonly string[]
  readonly files: readonly Readonly<{ path: string; content: string }>[]
}

/** Materialize current certified context without creating executable behavior. */
export function composeCertifiedContext(
  base: { systemPrompt: string },
  certified: CertifiedContext | null,
  now: () => number = Date.now,
): ComposedCertifiedContext {
  if (!certified) {
    return Object.freeze({
      systemPrompt: base.systemPrompt,
      promptAdditions: Object.freeze([]),
      files: Object.freeze([]),
    })
  }
  const checked = parseCertifiedContext(certified)
  assertCertifiedContextCurrent(checked, now())
  if (checked.state === 'revoked') {
    return Object.freeze({
      systemPrompt: base.systemPrompt,
      promptAdditions: Object.freeze([]),
      files: Object.freeze([]),
    })
  }
  return Object.freeze({
    systemPrompt: composeCertifiedContextPrompt(base.systemPrompt, checked),
    promptAdditions: inlineCertifiedContextEntries(checked),
    files: certifiedContextFileEntries(checked),
  })
}

/** A cached, self-refreshing source of one certified context bundle. */
export interface CertifiedContextSource {
  /** Refresh (window-respecting) then fold the certified additions into a
   *  base system prompt. Returns `base` unchanged when context is unavailable. */
  compose(base: string): Promise<string>
  /** The immutable certified context currently in effect. */
  current(): CertifiedContext | null
  /** Pull now if the refresh window has elapsed; coalesced and fail-closed. */
  refresh(): Promise<void>
}

export interface CertifiedContextCheckpointKey {
  readonly tenantId: string
  readonly target: string
}

/** Durable rollback state for one tenant and target. It contains no delivered content. */
export interface CertifiedContextCheckpoint extends CertifiedContextCheckpointKey {
  readonly revision: string
  readonly contentHash: CertifiedContext['contentHash']
  readonly state: CertifiedContext['state']
}

/**
 * Caller-owned durable storage for certified-context rollback protection.
 * `save` must atomically retain the highest revision and reject rollback or an
 * equal-revision content/state conflict when multiple sources write concurrently.
 */
export interface CertifiedContextCheckpointStore {
  load(key: CertifiedContextCheckpointKey): Promise<CertifiedContextCheckpoint | null>
  save(checkpoint: CertifiedContextCheckpoint): Promise<void>
}

/** Options for {@link createCertifiedContextSource} plus
 *  the refresh cadence. */
export interface CertifiedContextSourceOptions extends PullCertifiedContextOptions {
  /** Min interval between certified-context pulls. Default 5m. */
  refreshMs?: number
  /**
   * Persist the highest accepted revision across source recreation and process
   * restarts. Without a store, rollback protection lasts for this source only.
   */
  checkpointStore?: CertifiedContextCheckpointStore
  /** Observe rollback, conflicting revision, or incompatible endpoint responses. */
  onReject?: (error: Error) => void
}

function checkpointError(message: string): Error {
  return new Error(`certified context checkpoint ${message}`)
}

function parseCertifiedContextCheckpoint(
  value: unknown,
  key: CertifiedContextCheckpointKey,
): CertifiedContextCheckpoint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw checkpointError('must be an object')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = ['contentHash', 'revision', 'state', 'target', 'tenantId']
  if (
    keys.length !== expectedKeys.length ||
    keys.some((entry, index) => entry !== expectedKeys[index])
  ) {
    throw checkpointError('must contain exactly tenantId, target, revision, contentHash, and state')
  }
  if (typeof record.tenantId !== 'string' || typeof record.target !== 'string') {
    throw checkpointError('tenantId and target must be strings')
  }
  encodePlaneIdentity(record.tenantId, 'tenantId')
  encodePlaneIdentity(record.target, 'target')
  if (record.tenantId !== key.tenantId || record.target !== key.target) {
    throw checkpointError('does not match the requested tenantId and target')
  }
  if (
    typeof record.revision !== 'string' ||
    !checkpointRevisionPattern.test(record.revision) ||
    BigInt(record.revision) > maxCheckpointRevision
  ) {
    throw checkpointError('revision must be a signed 64-bit non-negative decimal string')
  }
  if (
    typeof record.contentHash !== 'string' ||
    !checkpointContentHashPattern.test(record.contentHash)
  ) {
    throw checkpointError('contentHash must be a lowercase SHA-256 digest')
  }
  if (record.state !== 'active' && record.state !== 'revoked') {
    throw checkpointError("state must be 'active' or 'revoked'")
  }
  return Object.freeze({
    tenantId: record.tenantId,
    target: record.target,
    revision: record.revision,
    contentHash: record.contentHash as CertifiedContext['contentHash'],
    state: record.state,
  })
}

/** Create one coalesced cache that keeps the last valid context response. */
export function createCertifiedContextSource(
  opts: CertifiedContextSourceOptions,
): CertifiedContextSource {
  const refreshMs = opts.refreshMs ?? defaultRefreshMs
  const now = opts.now ?? Date.now
  let certified: CertifiedContext | null = null
  let lastPullAt = 0
  let hasPulled = false
  let inflight: Promise<void> | null = null
  let refreshAfterExpiry = false
  let highestRevision: bigint | null = null
  let highestContentHash: string | null = null
  let highestState: CertifiedContext['state'] | null = null
  let checkpointLoaded = opts.checkpointStore === undefined
  const checkpointKey = Object.freeze({ tenantId: opts.tenantId, target: opts.target })

  function reject(error: Error): void {
    try {
      opts.onReject?.(error)
    } catch {
      // Observers cannot change checkpoint or context state transitions.
    }
  }

  async function loadCheckpoint(): Promise<boolean> {
    if (checkpointLoaded) return true
    try {
      encodePlaneIdentity(checkpointKey.tenantId, 'tenantId')
      encodePlaneIdentity(checkpointKey.target, 'target')
      const stored = await opts.checkpointStore!.load(checkpointKey)
      if (stored !== null) {
        const checkpoint = parseCertifiedContextCheckpoint(stored, checkpointKey)
        highestRevision = BigInt(checkpoint.revision)
        highestContentHash = checkpoint.contentHash
        highestState = checkpoint.state
      }
      checkpointLoaded = true
      return true
    } catch (cause) {
      reject(
        checkpointError(`load failed: ${cause instanceof Error ? cause.message : String(cause)}`),
      )
      return false
    }
  }

  async function persistCheckpoint(context: CertifiedContext): Promise<boolean> {
    if (!opts.checkpointStore) return true
    const checkpoint: CertifiedContextCheckpoint = Object.freeze({
      tenantId: context.tenantId,
      target: context.target,
      revision: context.revision,
      contentHash: context.contentHash,
      state: context.state,
    })
    try {
      await opts.checkpointStore.save(checkpoint)
      return true
    } catch (cause) {
      reject(
        checkpointError(`save failed: ${cause instanceof Error ? cause.message : String(cause)}`),
      )
      return false
    }
  }

  function current(): CertifiedContext | null {
    if (certified && Date.parse(certified.expiresAt) <= now()) {
      certified = null
      refreshAfterExpiry = true
    }
    return certified
  }

  async function refresh(): Promise<void> {
    const checkedAt = now()
    const hadExpiredContext = certified !== null && Date.parse(certified.expiresAt) <= checkedAt
    if (hadExpiredContext) {
      certified = null
      refreshAfterExpiry = true
    }
    if (!refreshAfterExpiry && hasPulled && checkedAt - lastPullAt < refreshMs) return
    if (inflight) return inflight
    inflight = (async () => {
      if (!checkpointLoaded && !(await loadCheckpoint())) return
      const outcome = await pullCertifiedContext(opts)
      lastPullAt = now()
      hasPulled = true
      refreshAfterExpiry = false
      if (outcome.succeeded) {
        const nextRevision = BigInt(outcome.value.revision)
        if (highestRevision !== null && nextRevision < highestRevision) {
          reject(
            new Error(
              `certified context revision rolled back from ${highestRevision} to ${nextRevision}`,
            ),
          )
          current()
          return
        }
        if (
          highestRevision !== null &&
          nextRevision === highestRevision &&
          (highestContentHash !== outcome.value.contentHash || highestState !== outcome.value.state)
        ) {
          reject(
            new Error(
              `certified context revision ${nextRevision} has conflicting content or state`,
            ),
          )
          current()
          return
        }
        if (
          (highestRevision === null || nextRevision > highestRevision) &&
          !(await persistCheckpoint(outcome.value))
        ) {
          refreshAfterExpiry = true
          current()
          return
        }
        highestRevision = nextRevision
        highestContentHash = outcome.value.contentHash
        highestState = outcome.value.state
        certified = outcome.value.state === 'active' ? outcome.value : null
      } else if (outcome.status === 401 || outcome.status === 403) {
        certified = null
      } else {
        if (outcome.status === 404) {
          reject(
            new Error('certified context endpoint returned 404 instead of a revisioned response'),
          )
        }
        current()
      }
    })()
    try {
      await inflight
    } finally {
      inflight = null
    }
  }

  return {
    refresh,
    current,
    async compose(base: string): Promise<string> {
      await refresh()
      return composeCertifiedContextPrompt(base, current())
    },
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const length = response.headers.get('content-length')
  if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) {
    throw new Error(`response exceeds ${maxBytes} bytes`)
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`)
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } catch (cause) {
    await reader.cancel().catch(() => {})
    throw cause
  } finally {
    reader.releaseLock()
  }
}
