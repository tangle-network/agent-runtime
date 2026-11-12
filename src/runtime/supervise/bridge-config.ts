/** Bridge configuration and protected credential validation; credentials resolve only at dispatch. */

import type { AgentExactRunControlRef, HarnessType } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { CodexRolloutStoreRef } from '../codex-rollout-store'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import type { KeyProvider } from '../key-provider'
import { assertExactConfigKeys } from './executor-seams'
import type { ExecutorNodeContext } from './types'

/**
 * cli-bridge transport seam. The spawned `AgentProfile` is the harness authority and is forwarded
 * verbatim; this seam carries transport only. `sessionId` is the harness conversation; each turn has
 * its own run id. A dropped reader reattaches to that run, and explicit cancel is the only stop.
 * Omit `sessionId` and the executor mints one. There is no argv field: materializing a profile
 * isolates the harness from ambient workspace state, `extensions.<harness>` chooses which extensions
 * load, and `permissions` / `tools` / `mcp` map to the harness's own controls. An argv array would
 * let a bearer token unwind the bridge's jail and egress policy and collide with the replay,
 * session, and streaming flags the bridge owns.
 */
export interface BridgeSeam {
  bridgeUrl: string
  bridgeBearer: string
  /** Require Bridge-owned final JSON; conversation text, tools and usage remain trace evidence. */
  outputFormat?: 'json'
  /**
   * Optional request-scoped model credential.
   *
   * The key name is portable configuration. The provider is a live service and is intentionally
   * not serialised. Runtime resolves both values immediately before every bridge POST and sends
   * them only to a loopback bridge through private request headers.
   */
  modelCredential?: BridgeModelCredential
  /** Optional working directory forwarded to cli-bridge and persisted with the session. */
  cwd?: string
  /**
   * The harness's OWN on-disk session store, read as a spend receipt.
   *
   * cli-bridge forwards no token usage for a codex worker, so a turn whose provider counters exist
   * only in codex's rollout meters `{0, 0}` with `tokensKnown: false`. Measured on one live seat
   * (discovery#80): 9 of 9 `metered` events read zero while 27,320,482 codex tokens sat in the same
   * run directory, 1,453,948 of them belonging to harness-native children the journal never saw.
   *
   * Naming the store here turns those rows into evidence. The executor tails it once per turn and
   * credits the DELTA, so each turn is charged once, and it reports the counters with
   * `provenance: 'harness-store'` so a reader can tell a disk receipt from a stream receipt.
   *
   * The path must be the run's OWN isolated store. An ambient host store credits this run with
   * another run's files, and `workspaceRoot` is the structural guard against it.
   */
  harnessStore?: BridgeHarnessStore
  /** Local native capture, after the admitted jobs are proven terminal. Retained live, never serialized. */
  harnessTranscript?: (request: {
    readonly sessionId: string
    readonly harness: HarnessType
    readonly profileDigest: `sha256:${string}`
    readonly cwd?: string
    readonly node?: ExecutorNodeContext
    readonly runs: readonly { readonly runId: string; readonly requestDigest: string }[]
    /** Present on the retained provider path; verified against its terminal status. */
    readonly controlRef?: AgentExactRunControlRef
    readonly signal: AbortSignal
  }) => Promise<HarnessTranscriptCapture>
  /** Caller-owned deadline for each bridge turn. Runtime enforces it locally and sends the
   *  same value in `execution.timeoutMs` so the bridge-owned process follows the same policy. */
  timeoutMs?: number
  /**
   * Longest model silence a bridge turn may hold: no stream event while no tool call is open. A
   * turn that stays silent this long fails, its bridge run is cancelled, and the driver re-enters
   * the run. A tool call the bridge reported and has not answered holds the clock, so a long tool
   * is never cut: magnetar-rust-20261018b ran one for 32 minutes. Off when absent. The bridge must
   * declare `toolCallSpans: true` on the model's route (`GET /v1/capabilities?model=`): its stream
   * reports each tool call at start and end. Every turn on a route that does not is refused before
   * dispatch, since a long tool would read as silence.
   */
  modelSilenceMs?: number
  /** Stable, caller-owned cli-bridge session id for harness-side resume. Defaults
   *  to a freshly minted per-spawn id so each worker is its own resumable session. */
  sessionId?: string
  /** Transport reconnects allowed after the first POST. Default 3; set 0 to disable. */
  maxReconnects?: number
  /** Newest-last activity window `progress()` reports. Default 12. */
  activityWindow?: number
}

/**
 * A harness's own session store on the bridge host, named so the runtime may read it.
 *
 * Only `codex` has a reader today. Any other harness is REFUSED rather than read with codex's
 * decoder: a different harness's file decoded as a codex rollout would either drop counters it does
 * not name or credit a number that is about the wrong wire shape.
 */
export interface BridgeHarnessStore extends CodexRolloutStoreRef {
  /** The harness family that wrote the store. */
  readonly harness: HarnessType
}

/** A live, request-scoped model credential reference for a local cli-bridge. */
export interface BridgeModelCredential {
  /** Provider key name for the scoped model token. */
  key: string
  /** Provider key name for the exact scoped HTTPS model gateway URL. */
  baseUrlKey: string
  /** Live credential service. Runtime retains this reference through reusable captures. */
  provider: KeyProvider
}

export const bridgeSeamKey = 'bridge'

/** Internal control seam used by Runtime-owned external supervisors. A completion request stops
 * the next bridge turn; it must not abort the paid request that is already streaming. */
export const bridgeStopSignalKey = '__bridge_stop_signal'

/** Internal attachment seam used by Runtime-owned external supervisors. The named MCP servers ride
 * beside the AgentProfile as `runtime_attachments`, so the bridge mounts them for the run and keeps
 * them out of its session profile binding. A rebound coordination port therefore cannot move the
 * authored profile digest that binds a durable session. */
export const bridgeRuntimeAttachmentsKey = '__bridge_runtime_attachments'

export const maxBridgeTimeoutMs = 2_147_483_647

function isLoopbackBridgeHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  if (host === '::ffff:127.0.0.1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host)
}

function isLoopbackBridgeUrl(value: string): boolean {
  try {
    const target = new URL(value)
    return (
      (target.protocol === 'http:' || target.protocol === 'https:') &&
      isLoopbackBridgeHost(target.hostname)
    )
  } catch {
    return false
  }
}

/** Validate and capture the non-serialisable credential service without reading its value. */
function captureBridgeModelCredential(
  value: BridgeModelCredential,
  context: string,
): BridgeModelCredential {
  if (value === null || typeof value !== 'object') {
    throw new ValidationError(`${context}: modelCredential must be an object`)
  }
  assertExactConfigKeys(
    value as unknown as Readonly<Record<string, unknown>>,
    new Set(['baseUrlKey', 'key', 'provider']),
    `${context} modelCredential`,
  )
  if (typeof value.key !== 'string' || value.key.trim().length === 0) {
    throw new ValidationError(`${context}: modelCredential.key must be a non-empty string`)
  }
  if (typeof value.baseUrlKey !== 'string' || value.baseUrlKey.trim().length === 0) {
    throw new ValidationError(`${context}: modelCredential.baseUrlKey must be a non-empty string`)
  }
  if (value.baseUrlKey === value.key) {
    throw new ValidationError(`${context}: modelCredential.baseUrlKey must differ from key`)
  }
  if (!value.provider || typeof value.provider.get !== 'function') {
    throw new ValidationError(`${context}: modelCredential.provider must implement get(name)`)
  }

  // Keep the service live while making JSON/config snapshots contain only the key NAME. The
  // provider may close over a secret, so it must not be an enumerable property of the snapshot.
  const captured = { key: value.key, baseUrlKey: value.baseUrlKey } as BridgeModelCredential
  Object.defineProperty(captured, 'provider', {
    configurable: false,
    enumerable: false,
    value: value.provider,
    writable: false,
  })
  return Object.freeze(captured)
}

export function validateBridgeModelCredential(
  value: BridgeModelCredential | undefined,
  bridgeUrl: string,
  context: string,
): BridgeModelCredential | undefined {
  if (value === undefined) return undefined
  if (!isLoopbackBridgeUrl(bridgeUrl)) {
    throw new ValidationError(
      `${context}: modelCredential is allowed only for a loopback bridge URL`,
    )
  }
  return captureBridgeModelCredential(value, context)
}

export interface ResolvedBridgeModelCredential {
  token: string
  baseUrl: string
}

function resolveProtectedModelBaseUrl(value: string, context: string): string {
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new ValidationError(`${context}: modelCredential.baseUrl must be an absolute HTTPS URL`)
  }
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  ) {
    throw new ValidationError(
      `${context}: modelCredential.baseUrl must be an HTTPS URL without credentials, query, or fragment`,
    )
  }
  return target.toString().replace(/\/$/u, '')
}

/** Resolve only at the outbound boundary. Provider errors are redacted because they may contain
 *  the protected value; diagnostics identify key names, never values or provider errors. */
export async function resolveBridgeModelCredential(
  credential: BridgeModelCredential | undefined,
  context: string,
): Promise<ResolvedBridgeModelCredential | undefined> {
  if (credential === undefined) return undefined
  const resolveValue = async (key: string): Promise<string> => {
    let value: string | undefined
    try {
      value = await credential.provider.get(key)
    } catch {
      throw new ValidationError(`${context}: modelCredential provider failed for '${key}'`)
    }
    if (typeof value !== 'string' || value.length === 0 || /[\r\n\0]/u.test(value)) {
      throw new ValidationError(
        `${context}: modelCredential provider has no usable value for '${key}'`,
      )
    }
    return value
  }
  const [token, baseUrl] = await Promise.all([
    resolveValue(credential.key),
    resolveValue(credential.baseUrlKey),
  ])
  return { token, baseUrl: resolveProtectedModelBaseUrl(baseUrl, context) }
}

// ── bridge executor (harness CLIs behind the local cli-bridge) ──────────────────

/**
 * A worker as a RESUMABLE cli-bridge harness session — the local twin of the
 * sandbox executor. Both are a persistent, streamed agent session the driver
 * spawns, watches stream `UsageEvent`s, then STEERS/RESUMES out-of-band; the only
 * difference is where the harness runs (local cli-bridge vs a cloud box).
 *
 * Structure mirrors `streamSandboxLeaf` + `routerToolsInlineExecutor`:
 *  - STREAMED: `execute` returns an `AsyncIterable<UsageEvent>`; the SSE chunks
 *    cli-bridge emits (`stream:true`) are parsed into incremental usage + a tail
 *    artifact read via `resultArtifact()` after the stream drains.
 *  - RESUMABLE: every turn carries a stable `session_id`. cli-bridge maps it to the
 *    harness's internal conversation id (SQLite `SessionStore`), so a steer delivered
 *    via `deliver` re-calls the SAME session id — opencode `-s <id>`, claude
 *    `--resume`, … — continuing the SAME harness session, not a fresh one.
 *  - STEERABLE: the down-leg `inbox` is taken at each turn boundary; a queued
 *    steer becomes the next turn's prompt on the same session, and the worker can't
 *    settle while a steer it never read is pending (the sandbox/router contract).
 *  - ABORT: reader abort only detaches HTTP. Interrupt/teardown then call the
 *    bridge's explicit cancel operation and wait for the owned run to terminate.
 *
 * Reports REAL usage when the bridge surfaces it, never a fabricated cost.
 */
export interface ResolvedBridgeSeam extends BridgeSeam {
  /** Derived once from the exact AgentProfile; never accepted as backend configuration. */
  readonly model: string
  /** Provider response model after removing the harness-only wire prefix. */
  readonly providerModel: string
  /** Profile-owned ceiling for one completion, forwarded as `max_tokens` when present. */
  readonly maxTokens?: number
}
