/** Exact Bridge run admission, HTTP transport, ordered reconnect, and acknowledged cancellation. */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { BackendTransportError, ValidationError } from '../../errors'
import { runAbortable } from './abortable'
import {
  type BridgeSeam,
  type ResolvedBridgeModelCredential,
  type ResolvedBridgeSeam,
  resolveBridgeModelCredential,
} from './bridge-config'
import {
  assertBridgeProfileMaterialization,
  type BridgeProfileMaterializationReceipt,
  type BridgeStreamChunk,
  bridgeProfileMaterializationSchema,
  parseSseChatStream,
} from './bridge-protocol'

const bridgeModelCredentialHeader = 'x-cli-bridge-model-credential'

const bridgeModelBaseUrlHeader = 'x-cli-bridge-model-base-url'

const bridgeUsageCostSchema = 'cli-bridge.usage-cost.v1'

/** The bridge's own view of the durable run, as `GET /v1/runs/:id` reports it. `at` is when this
 *  executor read it, so a stale snapshot is presented as stale rather than as current truth. */
export interface BridgeRunStateRead {
  readonly runId: string
  readonly status: string
  readonly state: string
  readonly terminal: boolean
  readonly lastSeq: number
  readonly at: number
}

/** Ceiling on one run-state read. A bridge that hangs must not pin `refreshing` forever and
 *  silently stop every later refresh. */
const BRIDGE_RUN_STATE_TIMEOUT_MS = 2_000

/** One bridge GET over the `node:http(s)` core client — the same transport every other bridge
 *  read uses, so a computed provider endpoint never reaches global `fetch`. Resolves the status
 *  and the body text; a transport failure rejects. */
function bridgeGet(
  seam: BridgeSeam,
  path: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  const target = new URL(`${seam.bridgeUrl.replace(/\/$/, '')}${path}`)
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException(`bridge GET ${path} aborted before request`, 'AbortError'))
      return
    }
    const req = requestFn(
      target,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${seam.bridgeBearer}` },
        timeout: timeoutMs,
      },
      (res) => {
        void (async () => {
          const chunks: Buffer[] = []
          for await (const chunk of res) chunks.push(Buffer.from(chunk))
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })().catch(reject)
      },
    )
    const abort = () => req.destroy(new DOMException(`bridge GET ${path} aborted`, 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    req.on('timeout', () => req.destroy(new Error(`bridge GET ${path} timed out`)))
    req.on('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    req.on('close', () => signal?.removeEventListener('abort', abort))
    req.end()
  })
}

export interface BridgeModelRouteRefusal {
  readonly detail: string
  readonly retryable: boolean
  readonly status?: number
}

/**
 * `GET /v1/capabilities?model=<wire id>` — does this bridge route this model AT ALL.
 *
 * The bridge answers exactly this question and 404s `no backend matches model "…"`, which is the
 * error a child would otherwise discover after it was spawned and metered. Returns `undefined`
 * when the route resolves; otherwise it returns the reason and whether the failure can recover.
 * A transport error and an unexpected status never become a silent pass.
 */
export async function bridgeModelRouteRefusal(
  seam: BridgeSeam,
  wireModel: string,
  signal?: AbortSignal,
): Promise<BridgeModelRouteRefusal | undefined> {
  const base = seam.bridgeUrl.replace(/\/$/, '')
  let answer: { status: number; body: string }
  try {
    answer = await bridgeGet(
      seam,
      `/v1/capabilities?model=${encodeURIComponent(wireModel)}`,
      BRIDGE_RUN_STATE_TIMEOUT_MS,
      signal,
    )
  } catch (error) {
    if (signal?.aborted) throw error
    return {
      detail: `bridge ${base} did not answer for model ${JSON.stringify(wireModel)}: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    }
  }
  if (answer.status === 200) return undefined
  if (answer.status === 404) {
    return {
      detail: `bridge ${base} routes no backend for model ${JSON.stringify(wireModel)}`,
      retryable: false,
      status: answer.status,
    }
  }
  return {
    detail: `bridge ${base} answered ${answer.status} for model ${JSON.stringify(wireModel)}`,
    retryable: answer.status === 408 || answer.status === 429 || answer.status >= 500,
    status: answer.status,
  }
}

/**
 * Read the default bulk lane from `GET /health`. Runtime sends no reserved-client header, so
 * overall capacity can look free while the lane this request will use is already full. Older
 * bridges expose only the overall counters; those retain the prior fallback.
 */
export async function bridgeAdmissionRefusal(
  seam: BridgeSeam,
  signal?: AbortSignal,
): Promise<string | undefined> {
  let answer: { status: number; body: string }
  try {
    answer = await bridgeGet(seam, '/health', BRIDGE_RUN_STATE_TIMEOUT_MS, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(answer.body)
  } catch {
    return undefined
  }
  const admission = (
    parsed as {
      admission?: {
        active?: unknown
        maxActive?: unknown
        bulkMaxActive?: unknown
        activeByClass?: { bulk?: unknown }
      }
    } | null
  )?.admission
  const active = admission?.active
  const maxActive = admission?.maxActive
  const bulkActive = admission?.activeByClass?.bulk
  const bulkMaxActive = admission?.bulkMaxActive
  if (
    typeof bulkActive === 'number' &&
    Number.isFinite(bulkActive) &&
    bulkActive >= 0 &&
    typeof bulkMaxActive === 'number' &&
    Number.isFinite(bulkMaxActive) &&
    bulkMaxActive >= 0
  ) {
    if (bulkActive < bulkMaxActive) return undefined
    const total =
      typeof active === 'number' && typeof maxActive === 'number'
        ? ` (total active ${active} of maxActive ${maxActive})`
        : ''
    return `bridge ${seam.bridgeUrl.replace(/\/$/, '')} bulk admission is full: active ${bulkActive} of bulkMaxActive ${bulkMaxActive}${total}`
  }
  if (
    typeof active !== 'number' ||
    !Number.isFinite(active) ||
    active < 0 ||
    typeof maxActive !== 'number' ||
    !Number.isFinite(maxActive) ||
    maxActive <= 0 ||
    active < maxActive
  ) {
    return undefined
  }
  return `bridge ${seam.bridgeUrl.replace(/\/$/, '')} admission is full: active ${active} of maxActive ${maxActive}`
}

/** `GET /v1/runs/:id` — the bridge's durable-run registry read. Resolves `undefined` for any
 *  non-200 or non-conforming body rather than throwing: this is only ever an observability read. */
export function bridgeRunStateGet(
  seam: BridgeSeam,
  runId: string,
): Promise<BridgeRunStateRead | undefined> {
  const target = new URL(
    `${seam.bridgeUrl.replace(/\/$/, '')}/v1/runs/${encodeURIComponent(runId)}`,
  )
  target.searchParams.set('wait_ms', '0')
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<BridgeRunStateRead | undefined>((resolve, reject) => {
    const req = requestFn(
      target,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${seam.bridgeBearer}` },
        timeout: BRIDGE_RUN_STATE_TIMEOUT_MS,
      },
      (res) => {
        void (async () => {
          const chunks: Buffer[] = []
          for await (const chunk of res) chunks.push(Buffer.from(chunk))
          if (res.statusCode !== 200) {
            resolve(undefined)
            return
          }
          resolve(readBridgeRunState(runId, Buffer.concat(chunks).toString('utf8')))
        })().catch(reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('bridgeExecutor: run state read timed out')))
    req.on('error', reject)
    req.end()
  })
}

/** Decode one run snapshot. A body that does not carry the fields we report is `undefined`, never
 *  a partially-invented snapshot. */
function readBridgeRunState(runId: string, body: string): BridgeRunStateRead | undefined {
  let parsed: {
    id?: unknown
    status?: unknown
    state?: unknown
    terminal?: unknown
    lastSeq?: unknown
  }
  try {
    parsed = JSON.parse(body) as typeof parsed
  } catch {
    return undefined
  }
  if (parsed.id !== runId) return undefined
  if (typeof parsed.status !== 'string' || typeof parsed.state !== 'string') return undefined
  if (typeof parsed.terminal !== 'boolean' || typeof parsed.lastSeq !== 'number') return undefined
  return {
    runId,
    status: parsed.status,
    state: parsed.state,
    terminal: parsed.terminal,
    lastSeq: parsed.lastSeq,
    at: Date.now(),
  }
}

export interface ActiveBridgeRun {
  readonly id: string
  requestDigest?: string
  profileMaterialization?: BridgeProfileMaterializationReceipt
  transportAttempts: number
  lastEventId: number
  terminal: boolean
  cancelInFlight?: Promise<boolean>
}

export const BRIDGE_CANCEL_LONG_POLL_MS = 30_000

const BRIDGE_BRUTAL_KILL_WAIT_MS = 150

interface StreamDurableBridgeRunArgs {
  seam: ResolvedBridgeSeam
  initialModelCredential?: ResolvedBridgeModelCredential
  profile: AgentProfile
  sessionId: string
  body: unknown
  signal: AbortSignal
  run: ActiveBridgeRun
  maxReconnects: number
  /** Trace request headers ({@link workerTraceHeaders}); empty when the run records no spans. */
  traceHeaders: Readonly<Record<string, string>>
}

/**
 * Drain one server-owned bridge run. A transport loss replays from the last
 * contiguous event id under the SAME run id and request bytes. No unnumbered,
 * duplicate, or skipped event is accepted: an exact replay contract that
 * cannot prove continuity fails instead of returning a plausible partial answer.
 */
export async function* streamDurableBridgeRun(
  args: StreamDurableBridgeRunArgs,
): AsyncIterable<BridgeStreamChunk> {
  let reconnects = 0
  let pendingUpstreamError: Error | undefined

  for (;;) {
    let res: BridgeResponse
    try {
      const modelCredential =
        args.run.transportAttempts === 0
          ? args.initialModelCredential
          : await runAbortable(
              () => resolveBridgeModelCredential(args.seam.modelCredential, 'bridgeExecutor'),
              args.signal,
              'bridgeExecutor: reconnect credential lookup aborted',
            )
      args.run.transportAttempts += 1
      res = await bridgeStreamPost(args.seam.bridgeUrl, {
        bearer: args.seam.bridgeBearer,
        modelCredential,
        sessionId: args.sessionId,
        runId: args.run.id,
        afterEventId: args.run.lastEventId,
        body: args.body,
        signal: args.signal,
        traceHeaders: args.traceHeaders,
      })
    } catch (error) {
      if (args.signal.aborted) throw error
      if (error instanceof ValidationError) throw error
      if (reconnects >= args.maxReconnects) {
        throw new ValidationError(
          `bridgeExecutor: run ${args.run.id} disconnected before terminal acknowledgement after ${reconnects + 1} attempts: ${errorMessage(error)}`,
        )
      }
      reconnects += 1
      continue
    }

    if (!res.ok) {
      // A remote status is a TRANSPORT fact, not a caller mistake: the package's taxonomy has
      // `BackendTransportError` precisely so a consumer (and the root-driver retry) can branch on
      // the upstream status — a 502 from a dying harness is recoverable, a 401 is not. Typing this
      // as a validation failure made every bridge fault look like a deliberate refusal.
      const body = (await res.text()).slice(0, 300)
      const providerDispatch = providerDispatchFromErrorBody(body)
      throw new BackendTransportError('bridge', `bridgeExecutor: bridge ${res.status}: ${body}`, {
        status: res.status,
        body,
        ...(providerDispatch === 'not_started' ? { providerDispatch } : {}),
      })
    }
    if (!res.body) {
      throw new ValidationError('bridgeExecutor: bridge response had no body to stream')
    }
    assertBridgeResponseIdentity(res, args.run)

    let sawDone = false
    try {
      for await (const event of parseSseChatStream(res.body)) {
        if (event.kind === 'done') {
          sawDone = true
          break
        }
        const expected = args.run.lastEventId + 1
        if (event.id !== expected) {
          throw new ValidationError(
            `bridgeExecutor: run ${args.run.id} replay gap: expected event ${expected}, received ${event.id}`,
          )
        }
        args.run.lastEventId = event.id
        if (event.error) pendingUpstreamError = event.error
        if (event.chunk?.profileMaterialization) {
          const receipt = assertBridgeProfileMaterialization(
            event.chunk.profileMaterialization,
            args.profile,
            args.seam.model,
          )
          if (
            args.run.profileMaterialization !== undefined &&
            JSON.stringify(args.run.profileMaterialization) !== JSON.stringify(receipt)
          ) {
            throw new ValidationError(
              `bridgeExecutor: run ${args.run.id} profile materialization changed across replay`,
            )
          }
          args.run.profileMaterialization = receipt
        }
        if (event.chunk) yield event.chunk
      }
    } catch (error) {
      if (args.signal.aborted) throw error
      if (error instanceof ValidationError) throw error
      if (reconnects >= args.maxReconnects) {
        throw new ValidationError(
          `bridgeExecutor: run ${args.run.id} stream disconnected before terminal acknowledgement after ${reconnects + 1} attempts: ${errorMessage(error)}`,
        )
      }
      reconnects += 1
      continue
    }

    if (sawDone) {
      if (args.run.profileMaterialization === undefined) {
        // The bridge said WHY. Prefer its diagnostic over the missing-receipt inference: a bridge
        // that refuses a profile at setup fails before it can retain a receipt, so the absence is
        // a CONSEQUENCE of the reported error, not independent evidence of anything. Reporting the
        // absence instead discards the only actionable message on the wire and renames a fixable
        // profile defect as a broken transport — an opencode arm that refused
        // `prompt.systemPrompt` and named `prompt.appendSystemPrompt` as the fix was read as a
        // dead seat and abandoned after 12 attempts. This mirrors the no-DONE path below, which
        // has preserved the provider's actual diagnostic since it was written.
        if (pendingUpstreamError) throw pendingUpstreamError
        // Also TRANSPORT: a bridge that advertises the capability emits this receipt on every
        // healthy turn, so its absence WITH NO REPORTED ERROR means the turn did not survive to
        // send it — the same mid-stream death as above, arriving as a missing field instead of an
        // error frame. Typed as validation it read as a permanently broken bridge and the
        // root-driver retry refused to re-enter; one arm of a six-arm wave was lost to exactly
        // this.
        throw new BackendTransportError(
          'bridge',
          `bridgeExecutor: run ${args.run.id} completed without ${bridgeProfileMaterializationSchema}`,
        )
      }
      args.run.terminal = true
      if (pendingUpstreamError) throw pendingUpstreamError
      return
    }
    // Preserve the provider's actual diagnostic even when a non-conforming
    // bridge drops the final [DONE]. The run remains nonterminal in our local
    // state, so teardown still has to cancel and obtain real terminal proof.
    if (pendingUpstreamError) throw pendingUpstreamError
    if (args.signal.aborted) {
      throw new DOMException('bridgeExecutor: turn aborted', 'AbortError')
    }
    if (reconnects >= args.maxReconnects) {
      throw new ValidationError(
        `bridgeExecutor: run ${args.run.id} ended without terminal acknowledgement after ${reconnects + 1} attempts`,
      )
    }
    reconnects += 1
  }
}

/** Refuse an old bridge before it can start a paid harness turn. This is intentionally uncached:
 * a process may restart behind the same URL, and a remembered capability from the prior process
 * is not evidence about the process that will receive the next POST. The terminal receipt remains
 * mandatory because the bridge can still restart between this GET and the run request. */
export async function assertBridgeExecutionCapabilities(
  seam: ResolvedBridgeSeam,
  signal: AbortSignal,
  requiresRuntimeAttachments: boolean,
): Promise<void> {
  const target = new URL(`${seam.bridgeUrl.replace(/\/$/, '')}/`)
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  const response = await new Promise<BridgeBufferedResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('bridgeExecutor: aborted before capability preflight', 'AbortError'))
      return
    }
    const req = requestFn(
      target,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${seam.bridgeBearer}` },
        timeout: 0,
      },
      (res) => {
        void (async () => {
          const chunks: Buffer[] = []
          for await (const chunk of res) chunks.push(Buffer.from(chunk))
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })().catch(reject)
      },
    )
    const abort = () =>
      req.destroy(new DOMException('bridgeExecutor: preflight aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    req.on('error', reject)
    req.on('close', () => signal.removeEventListener('abort', abort))
    req.end()
  })
  if (response.status < 200 || response.status >= 300) {
    throw new BackendTransportError(
      'bridge',
      `bridgeExecutor: capability preflight returned ${response.status}: ${response.text.slice(0, 200)}`,
      { status: response.status, body: response.text.slice(0, 200) },
    )
  }
  let body: { capabilities?: Record<string, unknown> }
  try {
    body = JSON.parse(response.text) as typeof body
  } catch {
    throw new ValidationError('bridgeExecutor: capability preflight returned invalid JSON')
  }
  if (body.capabilities?.profileMaterialization !== bridgeProfileMaterializationSchema) {
    throw new ValidationError(
      `bridgeExecutor: bridge does not advertise ${bridgeProfileMaterializationSchema}`,
    )
  }
  if (body.capabilities?.usageCostProvenance !== bridgeUsageCostSchema) {
    throw new ValidationError(`bridgeExecutor: bridge does not advertise ${bridgeUsageCostSchema}`)
  }
  if (requiresRuntimeAttachments) {
    const attachments = body.capabilities?.runtimeAttachments
    if (
      attachments === null ||
      typeof attachments !== 'object' ||
      (attachments as { mcp?: unknown }).mcp !== true
    ) {
      throw new ValidationError(
        `bridgeExecutor: bridge at ${seam.bridgeUrl} does not advertise capabilities.runtimeAttachments.mcp; ` +
          'upgrade cli-bridge to a version that carries Runtime MCP attachments outside the bound AgentProfile',
      )
    }
  }

  const routeRefusal = await bridgeModelRouteRefusal(seam, seam.model, signal)
  if (routeRefusal !== undefined) {
    if (routeRefusal.retryable) {
      throw new BackendTransportError('bridge', `bridgeExecutor: ${routeRefusal.detail}`, {
        ...(routeRefusal.status === undefined ? {} : { status: routeRefusal.status }),
        providerDispatch: 'not_started',
      })
    }
    throw new ValidationError(`bridgeExecutor: ${routeRefusal.detail}`)
  }

  const admissionRefusal = await bridgeAdmissionRefusal(seam, signal)
  if (admissionRefusal !== undefined) {
    throw new BackendTransportError('bridge', `bridgeExecutor: ${admissionRefusal}`, {
      providerDispatch: 'not_started',
    })
  }
}

/** The subset of `Response` `streamBridgeSession` consumes: status gate, an error
 *  body reader, and a web `ReadableStream` the SSE parser drains. */
interface BridgeResponse {
  ok: boolean
  status: number
  headers: Readonly<Record<string, string | string[] | undefined>>
  text: () => Promise<string>
  body: ReadableStream<Uint8Array> | null
}

interface BridgeStreamPostArgs {
  bearer: string
  modelCredential?: ResolvedBridgeModelCredential
  sessionId: string
  runId: string
  afterEventId: number
  body: unknown
  signal: AbortSignal
  /** Trace request headers ({@link workerTraceHeaders}); empty when the run records no spans. */
  traceHeaders: Readonly<Record<string, string>>
}

/**
 * POST one streamed turn to the cli-bridge over the `node:http(s)` core client
 * instead of global `fetch`. The bridge runs a harness CLI and streams SSE only
 * once that harness starts producing — first byte routinely arrives >5 min into a
 * heavy turn. `fetch` (undici) caps the wait for response headers at a fixed
 * `headersTimeout` (~300s) that no per-request option or `AbortSignal` overrides,
 * so it aborts a live-but-slow bridge with an opaque "Headers Timeout Error". The
 * core client has no such cap; the turn's `AbortSignal` (external teardown, a
 * forceful steer, or `seam.timeoutMs`) is the sole deadline. The response's
 * `IncomingMessage` (a Node `Readable`) is adapted to a web `ReadableStream` so the
 * shared `parseSseChatStream` consumes it unchanged.
 */
async function bridgeStreamPost(url: string, args: BridgeStreamPostArgs): Promise<BridgeResponse> {
  const target = new URL(`${url.replace(/\/$/, '')}/v1/chat/completions`)
  const payload = JSON.stringify(args.body)
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<BridgeResponse>((resolve, reject) => {
    if (args.signal.aborted) {
      reject(new DOMException('bridgeExecutor: aborted before request', 'AbortError'))
      return
    }
    const req = requestFn(
      target,
      {
        method: 'POST',
        headers: {
          // Trace context first, so a malformed caller value can never shadow the fixed
          // transport headers below.
          ...args.traceHeaders,
          'content-type': 'application/json',
          authorization: `Bearer ${args.bearer}`,
          ...(args.modelCredential === undefined
            ? {}
            : {
                [bridgeModelCredentialHeader]: args.modelCredential.token,
                [bridgeModelBaseUrlHeader]: args.modelCredential.baseUrl,
              }),
          'x-session-id': args.sessionId,
          'x-run-id': args.runId,
          ...(args.afterEventId > 0 ? { 'last-event-id': String(args.afterEventId) } : {}),
          'content-length': Buffer.byteLength(payload),
        },
        // No header/body idle timeout: a slow bridge is a live bridge; the abort
        // signal is the sole deadline.
        timeout: 0,
      },
      (res) => {
        response = res
        res.once('close', () => args.signal.removeEventListener('abort', onAbort))
        const status = res.statusCode ?? 0
        const ok = status >= 200 && status < 300
        const body = Readable.toWeb(res) as ReadableStream<Uint8Array>
        resolve({
          ok,
          status,
          headers: res.headers,
          body,
          text: async () => {
            const chunks: Buffer[] = []
            for await (const c of res) chunks.push(c as Buffer)
            return Buffer.concat(chunks).toString('utf8')
          },
        })
      },
    )
    let response: Parameters<typeof Readable.toWeb>[0] | undefined
    const onAbort = (): void => {
      req.destroy(new DOMException('bridgeExecutor: turn aborted', 'AbortError'))
      if (response && 'destroy' in response && typeof response.destroy === 'function') {
        response.destroy(new DOMException('bridgeExecutor: turn aborted', 'AbortError'))
      }
    }
    if (args.signal.aborted) onAbort()
    else args.signal.addEventListener('abort', onAbort, { once: true })
    req.on('error', (e) => {
      args.signal.removeEventListener('abort', onAbort)
      reject(e)
    })
    req.on('close', () => {
      if (!response) args.signal.removeEventListener('abort', onAbort)
    })
    req.write(payload)
    req.end()
  })
}

interface BridgeBufferedResponse {
  status: number
  headers: Readonly<Record<string, string | string[] | undefined>>
  text: string
}

function bridgeHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const raw = headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw.length === 1 ? raw[0] : undefined
  return raw
}

function assertBridgeResponseIdentity(response: BridgeResponse, run: ActiveBridgeRun): void {
  assertBridgeIdentityHeaders(response.headers, run)
}

function assertBridgeIdentityHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  run: ActiveBridgeRun,
): void {
  const responseRunId = bridgeHeader(headers, 'x-run-id')
  if (responseRunId !== run.id) {
    throw new ValidationError(
      `bridgeExecutor: bridge run identity mismatch: expected ${run.id}, received ${responseRunId ?? 'missing'}`,
    )
  }
  const digest = bridgeHeader(headers, 'x-run-request-digest')
  if (!digest || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new ValidationError('bridgeExecutor: bridge response omitted a valid request digest')
  }
  if (run.requestDigest !== undefined && run.requestDigest !== digest) {
    throw new ValidationError(
      `bridgeExecutor: bridge request digest changed for run ${run.id}: expected ${run.requestDigest}, received ${digest}`,
    )
  }
  run.requestDigest = digest
}

/** Explicitly cancel one server-owned run and long-poll for its terminal snapshot. */
function bridgeCancelPost(
  seam: BridgeSeam,
  run: ActiveBridgeRun,
  waitMs: number,
): Promise<BridgeBufferedResponse> {
  const target = new URL(
    `${seam.bridgeUrl.replace(/\/$/, '')}/v1/runs/${encodeURIComponent(run.id)}/cancel`,
  )
  target.searchParams.set('wait_ms', String(waitMs))
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<BridgeBufferedResponse>((resolve, reject) => {
    const req = requestFn(
      target,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${seam.bridgeBearer}`,
          'x-run-id': run.id,
          'content-length': '0',
        },
        timeout: 0,
      },
      (res) => {
        void (async () => {
          const chunks: Buffer[] = []
          for await (const chunk of res) chunks.push(Buffer.from(chunk))
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })().catch(reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

export async function requestBridgeRunCancellation(
  seam: BridgeSeam,
  run: ActiveBridgeRun,
  waitMs: number,
): Promise<boolean> {
  if (run.terminal) return true
  if (run.cancelInFlight) return run.cancelInFlight
  const work = (async (): Promise<boolean> => {
    const response = await bridgeCancelPost(seam, run, waitMs)
    if (response.status === 404) {
      throw new ValidationError(
        `bridgeExecutor: bridge no longer knows run ${run.id}; terminal state is unproven`,
      )
    }
    if (response.status !== 200 && response.status !== 202) {
      throw new ValidationError(
        `bridgeExecutor: cancel ${run.id} returned ${response.status}: ${response.text.slice(0, 300)}`,
      )
    }
    assertBridgeIdentityHeaders(response.headers, run)
    let parsed: {
      terminal?: unknown
      run?: { id?: unknown; requestDigest?: unknown; terminal?: unknown }
    }
    try {
      parsed = JSON.parse(response.text) as typeof parsed
    } catch {
      throw new ValidationError(`bridgeExecutor: cancel ${run.id} returned invalid JSON`)
    }
    if (
      parsed.run?.id !== run.id ||
      parsed.run.requestDigest !== run.requestDigest ||
      typeof parsed.terminal !== 'boolean' ||
      typeof parsed.run.terminal !== 'boolean' ||
      parsed.terminal !== parsed.run.terminal
    ) {
      throw new ValidationError(
        `bridgeExecutor: cancel ${run.id} returned an inconsistent terminal snapshot`,
      )
    }
    if (response.status === 200 && parsed.terminal === true) {
      run.terminal = true
      return true
    }
    if (response.status === 202 && parsed.terminal === false) return false
    throw new ValidationError(
      `bridgeExecutor: cancel ${run.id} status ${response.status} disagreed with terminal=${String(parsed.terminal)}`,
    )
  })()
  run.cancelInFlight = work
  try {
    return await work
  } finally {
    if (run.cancelInFlight === work) run.cancelInFlight = undefined
  }
}

export async function cancelBridgeRunToTerminal(
  seam: BridgeSeam,
  run: ActiveBridgeRun,
  grace: number | 'brutalKill' | 'infinity',
  stopSignal?: AbortSignal,
): Promise<boolean> {
  if (run.terminal) return true
  const deadline =
    grace === 'infinity'
      ? undefined
      : Date.now() + (grace === 'brutalKill' ? BRIDGE_BRUTAL_KILL_WAIT_MS : Math.max(0, grace))
  let first = true
  for (;;) {
    const remaining = deadline === undefined ? BRIDGE_CANCEL_LONG_POLL_MS : deadline - Date.now()
    if (!first && remaining <= 0) return false
    if (!first && stopSignal?.aborted) return false
    const waitMs = Math.max(
      0,
      Math.min(
        stopSignal ? 1_000 : BRIDGE_CANCEL_LONG_POLL_MS,
        deadline === undefined ? remaining : Math.max(0, remaining),
      ),
    )
    const terminal = await requestBridgeRunCancellation(seam, run, waitMs)
    if (terminal) return true
    first = false
    if (deadline !== undefined && Date.now() >= deadline) return false
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read only the Router-owned one-sided field from an error body. */
function providerDispatchFromErrorBody(body: string): 'not_started' | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const error = (parsed as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return undefined
  return (error as { provider_dispatch?: unknown }).provider_dispatch === 'not_started'
    ? 'not_started'
    : undefined
}
