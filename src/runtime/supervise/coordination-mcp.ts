/**
 *
 * Serve the coordination verbs (spawn_worker / observe_agent / steer_agent / submit_result / stop)
 * as a real HTTP MCP server over a LIVE `Scope`. This is the keystone that lets a coding-harness
 * agent (opencode via the cli-bridge, claude-code, codex) BE the supervisor: it mounts this MCP
 * (`mcp.mcpServers.coordination`) and calls `spawn_worker` as a native tool, which lands on
 * `Scope.spawn` — a real box driving real boxes, not emulated function-tools.
 *
 * Coordination vs DELEGATION (`../../mcp/delegates.ts`): coordination SPAWNS workers in a CHOSEN
 * backend (`createExecutor({ backend })` — sandbox OR cli-bridge) and live-drives them — observe /
 * steer / resume, recursive sub-drivers, one conserved budget. To instead delegate a coding task
 * INSIDE the agent's OWN sandbox (a durable fire-and-poll job that survives an MCP restart), use the
 * delegation MCP. Coordination is the live, cross-backend supervisor; delegation is own-sandbox async.
 *
 * Transport: JSON-RPC over HTTP POST (the MCP streamable-HTTP shape — `application/json` for a
 * single response). The server is created INSIDE an agent's `act(task, scope)` so it fronts that
 * agent's live scope; tear it down when the act returns.
 *
 * @experimental
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import { createStdioToolServer } from '../../mcp/tool-server'
import {
  type AnalystRegistry,
  type AnalyzeOnSettleRoute,
  type AuthorizeDownMessage,
  type ChildQuestionInbox,
  type ContinuityMode,
  type CoordinationEvent,
  type CoordinationTools,
  createCoordinationToolsForManager,
  type DefinedAnalystRecord,
  type EscalateQuestion,
  type GraphSubtasks,
  type MakeWorkerAgent,
  type MapOnSettleRoute,
  type PeerAuditAccess,
  type QuestionEscalationRecord,
  type QuestionPolicy,
  type QuestionRecord,
  type SettledWorker,
  type SpawnPreflight,
  type SuperviseProfileEntry,
  type WorkerWatchOptions,
} from '../../mcp/tools/coordination'
import type { SpawnResourceReader } from '../../mcp/tools/spawn-resource-paths'
import { runAbortable } from './abortable'
import {
  type CoordinationHttpOptions,
  type CoordinationRejection,
  coordinationHttpHandler,
  coordinationHttpLimits,
} from './coordination-http'
import { preflightPublicCoordination } from './coordination-preflight'
import {
  noteScopeRetainedOwnerCoordination,
  scopeRetainedOwnerResourceReader,
} from './retained-scope-owner'
import { singleFlightTools } from './single-flight-tools'

export type {
  CoordinationHttpAudit,
  CoordinationHttpOptions,
  CoordinationRejectReason,
} from './coordination-http'

import type { DeliverableSpec } from './completion-gate'
import type { BusRecord } from './event-bus'
import type { PeerMailEvent, PeerMailLimits } from './peer-mail'
import type { Budget, ResultBlobStore, Scope } from './types'

export interface CoordinationMcpHandle {
  /** The URL an in-box harness mounts as `mcp.mcpServers.coordination.url`. */
  readonly url: string
  readonly port: number
  /** A separately authenticated read-only endpoint. Never persist its protected headers. */
  readonly readOnly: { readonly url: string; readonly headers: Readonly<Record<string, string>> }
  /** Runtime-only credentials. Never put these headers in canonical profiles or journals. */
  readonly headers: Readonly<Record<string, string>>
  /** The current credential's expiry under `authentication.ttlMs`; undefined when it lives as long
   *  as the scope. */
  readonly credentialExpiresAt: number | undefined
  /** Revoke this listener’s current token and mint another. Remove a signing key to revoke across restarts. */
  rotateCredential(): void
  /** The coordination tools' settled-worker ledger (for the driver's finalize). */
  settled(): ReadonlyArray<SettledWorker>
  /** The first driver-authored result whose injected independent check passed. */
  submittedResult: CoordinationTools['submittedResult']
  /** Post-loop drain of already-settled, unpulled children into the ledger — call before reading
   *  `settled()` for a finalize, so a delivered child the harness never awaited is not lost. */
  drainResolved: CoordinationTools['drainResolved']
  finishAnalysis: CoordinationTools['finishAnalysis']
  isStopped(): boolean
  /** The full ordered bus-event log for current-process observability and audit evidence. */
  history: CoordinationTools['history']
  /** Bus throughput counters for live dashboards. */
  stats: CoordinationTools['stats']
  /** Raise a `finding` on the bus from an online detector watching a worker's live pipe. */
  raiseFinding: CoordinationTools['raiseFinding']
  /** Every peer-mail attempt in order, delivered and refused alike. Empty when peer mail is off. */
  mailHistory(): ReadonlyArray<PeerMailEvent>
  /** End one peer exchange: every further mail on the thread is refused `thread-stopped`. Returns
   *  false when peer mail is off or the thread was already stopped. */
  stopMailThread(threadId: string): boolean
  close(): Promise<void>
}

/** Hosts that reach only this machine, including the IPv4-mapped and bracketed IPv6 spellings a
 *  caller may pass through from config. A name that is not recognizably loopback counts as REMOTE:
 *  whether it resolves to a loopback interface is not knowable here, and the safe direction of that
 *  doubt is "exposed". */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '::ffff:127.0.0.1') {
    return true
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
}

export interface CoordinationAuthentication {
  /** Explicit finite lifetime. Omission binds the credential to the live scope: it is refused once
   *  the scope stops or the listener closes. A child's own time box does not stop its scope. */
  readonly ttlMs?: number
  /** Caller-owned secret keys. Keep prior keys to verify unexpired credentials after restart. */
  readonly signingKeys?: {
    readonly activeKeyId: string
    readonly keys: Readonly<Record<string, string>>
  }
}

export interface CoordinationPublicAddress {
  readonly host: string
  readonly port: number
  readonly runId: string
  readonly actorId: string
  /** Listener lifetime: aborts on close, failed setup, manager cancellation, or deadline. */
  readonly signal: AbortSignal
}

/** Runtime-only read capability delivered to an operator client, never to the canonical profile. */
export interface CoordinationReadAccess {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export interface CoordinationTransportOptions extends CoordinationHttpOptions {
  /** Publish the read capability before dispatch, so a remote client can observe the first worker. */
  readonly onReadReady?: (
    access: CoordinationReadAccess & { readonly runId: string; readonly actorId: string },
  ) => void | Promise<void>
  readonly host?: string
  readonly port?: number
  /** Required for remote binds. Each server mints a distinct run/actor credential. */
  readonly authentication?: true | CoordinationAuthentication
  /** Caller-owned reachable endpoint or mapping, awaited before dispatch. Runtime creates no tunnel. */
  readonly publicUrl?: string | ((address: CoordinationPublicAddress) => string | Promise<string>)
}

export function assertCoordinationTransport(options: CoordinationTransportOptions): void {
  const host = options.host ?? '127.0.0.1'
  if (!isLoopbackHost(host) && !options.authentication) {
    throw new ConfigError(
      'coordination non-loopback address requires authentication; allowUnauthenticatedRemote is no longer supported',
    )
  }
  if (
    options.authentication !== undefined &&
    options.authentication !== true &&
    (typeof options.authentication !== 'object' ||
      options.authentication === null ||
      Array.isArray(options.authentication))
  ) {
    throw new ConfigError(
      'coordination authentication must be true or a credential lifetime configuration',
    )
  }
  const ttl = typeof options.authentication === 'object' ? options.authentication.ttlMs : undefined
  if (
    ttl !== undefined &&
    (!Number.isSafeInteger(ttl) || ttl <= 0 || !Number.isSafeInteger(Date.now() + ttl))
  ) {
    throw new ConfigError(
      'coordination credential ttlMs must be a positive safe integer with a safe expiry',
    )
  }
  if (options.publicUrl !== undefined && !options.authentication) {
    throw new ConfigError('coordination publicUrl requires authentication')
  }
  const signingKeys =
    typeof options.authentication === 'object' ? options.authentication.signingKeys : undefined
  if (signingKeys !== undefined) {
    if (!options.publicUrl)
      throw new ConfigError('coordination signingKeys requires a stable publicUrl')
    if (!signingKeys.activeKeyId || !Object.hasOwn(signingKeys.keys, signingKeys.activeKeyId)) {
      throw new ConfigError('coordination signingKeys must contain the active key')
    }
    for (const [id, key] of Object.entries(signingKeys.keys)) {
      if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
        typeof key !== 'string' ||
        Buffer.byteLength(key) < 32
      ) {
        throw new ConfigError(
          'coordination signing keys require bounded key IDs and at least 32 secret bytes',
        )
      }
    }
  }
  if (options.onReadReady && !options.authentication) {
    throw new ConfigError('coordination read capability publication requires authentication')
  }
  coordinationHttpLimits(options)
}

/**
 * The coordination verb that runs an injected deliverable's check inside its request, so its work
 * can outlast one request and it is served like `nodeTools`. src/mcp/tools/coordination.ts builds it
 * exactly when a deliverable is injected.
 */
const DELIVERABLE_VERB = 'submit_result'

/** The longest any coordination call holds its response, whatever the request timeout: under the
 *  60 s MCP tool-call timeout Claude Code and Codex apply by default. */
const RESPONSE_FENCE_CAP_MS = 45_000

/**
 * The longest a fenced coordination call (`submit_result` and every method-supplied node tool)
 * holds its HTTP response before it answers with a receipt instead. The call keeps running, and
 * its outcome reaches the manager in its next wake.
 *
 * It is half of `requestTimeoutMs`, so the answer leaves before the transport's own 504 at
 * `requestTimeoutMs`, with the other half left for body transfer, admission, and serialization,
 * and at most {@link RESPONSE_FENCE_CAP_MS}.
 */
export function coordinationResponseFenceMs(requestTimeoutMs: number): number {
  return Math.max(1, Math.min(RESPONSE_FENCE_CAP_MS, Math.floor(requestTimeoutMs / 2)))
}

/** Stand up the existing coordination tools with bounded HTTP access over one live scope. */
export async function serveCoordinationMcp(
  opts: CoordinationTransportOptions & {
    /** Trusted audit identity; defaults to the live scope node. */
    identity?: { runId: string; actorId: string }
    scope: Scope<unknown>
    blobs: ResultBlobStore
    makeWorkerAgent: MakeWorkerAgent
    /** Serve `run_graph` — see `CoordinationToolsOptions.graphs`. */
    graphs?: GraphSubtasks
    authorizeDownMessage?: AuthorizeDownMessage
    perWorker: Budget
    /** Independent completion check exposed to the driver as `submit_result`. The check runs
     *  inside that call, so the call is served single-flight and fenced like `nodeTools`: a check
     *  still running at the fence returns a receipt, and the verdict reaches the manager in its
     *  next wake. */
    deliverable?: DeliverableSpec<unknown>
    /** Serve `read_continuation` from the manager's continuation records. */
    readContinuation?: (continuation: number | undefined) => unknown
    /** Called once when the external manager accepts a result or declares completion. */
    onStop?: (reason: string | undefined) => void
    /** Trace-analyst lenses the driver can run (`run_analyst`) or auto-fire on settle. */
    analysts?: AnalystRegistry
    /** Analyst kinds to auto-run when a worker settles `done` — findings flow up the bus. */
    analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
    /** Maps expanded when their source worker settles. */
    mapOnSettle?: ReadonlyArray<MapOnSettleRoute>
    /** Trusted source refs for this manager’s existing observe_agent capability. */
    sourceEvidenceRefs?: ReadonlyArray<string>
    peerAudit?: PeerAuditAccess
    /** Run the ONLINE detector panel over each worker's live tool trace (raises `finding` events). */
    watchWorkers?: WorkerWatchOptions
    /** Idle time after which `observe_agent` reports a worker as stalled. */
    stallAfterMs?: number
    /** Default continuity per worker profile name — `'resume'` re-attaches spawns of that name to
     *  the node's latest settled worker; the tool's per-call `continuity` overrides. */
    continuityByProfile?: Readonly<Record<string, ContinuityMode>>
    /** Pass-through subscriber for every bus event, including pre-delivery instruction receipts and
     * steer/answer delivery outcomes. */
    onEvent?: (
      event: CoordinationEvent,
      record: BusRecord<CoordinationEvent>,
    ) => void | Promise<void>
    /** Re-publish resume-time settlements through the awaited observer before this server listens. */
    replaySettlements?: boolean
    questionPolicy?: QuestionPolicy
    /** Where an `ask_parent` question goes when it leaves this manager. Omit = `no-parent`. */
    escalateQuestion?: EscalateQuestion
    /** Receives this manager's intake for questions its child managers raise. */
    onChildQuestionInbox?: (inbox: ChildQuestionInbox) => void
    /** Escalations replayed from a prior process — seeds what `stop` knows went unheard. */
    priorEscalations?: ReadonlyArray<QuestionEscalationRecord>
    /** Questions replayed from a prior process of this run — seeds the question ledger. */
    priorQuestions?: ReadonlyArray<QuestionRecord>
    /** Every coordination record from prior processes of this run — what `read_journal` reads before
     *  this process's own rows, so a resumed manager sees what it already did. */
    priorJournal?: ReadonlyArray<BusRecord<CoordinationEvent>>
    /** Lenses this manager defined in a prior process — seeds the menu and the definition cap. */
    priorAnalystDefinitions?: ReadonlyArray<DefinedAnalystRecord>
    /** Product-selected tools already bound to this exact supervisor node. They share this server
     *  with the coordination verbs, so the existing MCP duplicate-name guard applies before listen.
     *  Each is served single-flight and fenced (`./single-flight-tools`): an identical call joins
     *  the running call, and a call still running at the fence returns a receipt whose outcome
     *  reaches the manager in its next wake. */
    nodeTools?: ReadonlyArray<McpToolDescriptor>
    /** Exact bare tool names to expose from the coordination and node-tool set. Runtime never
     *  grants an implicit complete tool set. An unknown name fails before the listener opens. */
    toolNames: ReadonlyArray<string>
    /**
     * OPT-IN peer mail: let this manager's workers message each other directly, bounded and audited
     * (`runtime/supervise/peer-mail`). Each spawn receives a capability URL on
     * `WorkerSpawnContext.peerMailUrl`.
     *
     * It uses a separate capability path on the coordination listener. The manager endpoint
     * grants spawn, steer and stop; the mail path serves only `send_mail` and `read_mail`,
     * bound to one worker identity. A mail capability cannot authorize a manager request.
     *
     * The residual, stated plainly: the boundary is between AGENTS, not between processes. A worker
     * that can read another worker's environment or process memory still holds that worker's
     * capability. Loopback plus an unguessable path is what this layer can honestly enforce.
     */
    peerMail?: boolean | { limits?: Partial<PeerMailLimits> }
    /** OPT-IN async gate run before every spawn mints an assignment or reserves budget — the one
     *  pre-journal point that may ask the backend a question. See
     *  `CoordinationToolsOptions.preflightSpawn`. */
    preflightSpawn?: SpawnPreflight
    /** Pre-journal profile resolution for `preflightSpawn`; see
     *  `CoordinationToolsOptions.resolveSpawnProfile`. */
    resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile
    /** Composition of each authored child profile before identity is fixed —
     *  `CoordinationToolsOptions.composeSpawnProfile`. */
    composeSpawnProfile?: (profile: AgentProfile) => AgentProfile
    /** The run's validated profiles table — `CoordinationToolsOptions.profiles`. */
    profiles?: ReadonlyMap<string, SuperviseProfileEntry>
    /** See `CoordinationToolsOptions.spawnResourceRoot`. */
    spawnResourceRoot?: string
    /** See `CoordinationToolsOptions.spawnResourceReader`. */
    spawnResourceReader?: SpawnResourceReader
    /** Called with this server's exact MCP tool descriptors once they exist and BEFORE the listener
     *  opens — the seam a caller uses to give an already-bound node tool a way to call the same
     *  verbs in code (`SupervisorToolInvocationContext.verbs`). */
    onCoordinationTools?: (
      tools: ReadonlyArray<McpToolDescriptor>,
      coordination: Pick<CoordinationTools, 'awaitSettlement'>,
    ) => void
  },
): Promise<CoordinationMcpHandle> {
  return (await serveCoordinationMcpForManager(opts)).handle
}

/** Runtime-only binding: operator controls stay off the public MCP handle and tool grants. */
export async function serveCoordinationMcpForManager(
  opts: Parameters<typeof serveCoordinationMcp>[0],
  lifetime?: AbortSignal,
): Promise<{ handle: CoordinationMcpHandle; controls: CoordinationTools }> {
  const host = opts.host ?? '127.0.0.1'
  assertCoordinationTransport(opts)
  const requestTimeoutMs = coordinationHttpLimits(opts).requestTimeoutMs
  const responseFenceMs = coordinationResponseFenceMs(requestTimeoutMs)
  const identity = Object.freeze({
    ...(opts.identity ?? {
      runId: opts.scope.view?.root ?? '',
      actorId: opts.scope.view?.root ?? '',
    }),
  })
  if (
    (opts.authentication || opts.onAudit) &&
    (!identity.runId.trim() || !identity.actorId.trim())
  ) {
    throw new ConfigError('authenticated coordination requires a trusted run and actor identity')
  }
  const auth = typeof opts.authentication === 'object' ? opts.authentication : undefined
  const signingKeys = auth?.signingKeys
    ? { activeKeyId: auth.signingKeys.activeKeyId, keys: { ...auth.signingKeys.keys } }
    : undefined
  let readerToken = Buffer.from(randomBytes(32).toString('base64url'))
  let token: Buffer | undefined
  let credentialExpiresAt: number | undefined
  let headers: Readonly<Record<string, string>> = Object.freeze({})
  let credentialAudience = ''
  let closed = false
  const revoked = new Map<string, number>()
  const grantDigest = createHash('sha256')
    .update(JSON.stringify([...opts.toolNames].sort()))
    .digest('hex')
  const rotateCredential = () => {
    if (!opts.authentication) throw new ConfigError('coordination authentication is not configured')
    if (closed) throw new ConfigError('coordination server is closed')
    // Without `ttlMs` the credential carries no expiry: it lives as long as the scope
    // (`refusedCredential`), and a scope's deadline is not always its stop.
    const expiresAt = auth?.ttlMs === undefined ? undefined : Date.now() + auth.ttlMs
    if (expiresAt !== undefined && !Number.isSafeInteger(expiresAt)) {
      throw new ConfigError('coordination credential expiry must remain a safe integer')
    }
    for (const [credential, expiry] of revoked) {
      if (expiry <= Date.now()) revoked.delete(credential)
    }
    if (token) revoked.set(token.toString(), credentialExpiresAt ?? Number.POSITIVE_INFINITY)
    credentialExpiresAt = expiresAt
    const nonce = randomBytes(32).toString('base64url')
    let text = nonce
    if (signingKeys) {
      const payload = Buffer.from(
        JSON.stringify({
          key: signingKeys.activeKeyId,
          run: identity.runId,
          actor: identity.actorId,
          audience: credentialAudience,
          grants: grantDigest,
          expires: credentialExpiresAt ?? null,
          nonce,
        }),
      ).toString('base64url')
      const signature = createHmac('sha256', signingKeys.keys[signingKeys.activeKeyId]!)
        .update(payload)
        .digest('base64url')
      text = `${payload}.${signature}`
    }
    readerToken = Buffer.from(randomBytes(32).toString('base64url'))
    token = Buffer.from(text)
    headers = Object.freeze({ Authorization: `Bearer ${text}` })
  }
  /**
   * Why a supplied credential is refused, or undefined when it is valid. A credential lives as
   * long as the scope it fronts: until the scope's signal aborts, within an explicit `ttlMs`, and
   * until rotation revokes it. Every stop aborts that signal: cancellation, the run's deadline, and
   * a lead stopping its child. A child's own time box does not: its lead checks it in and keeps it
   * running (`deadline.ts` `DeadlineCheckIn`), and the check-in asks it to record its state and
   * submit through these very tools. Refusing at the time box left a checked-in child unable to do
   * either (2026-10-10: eu-datacenter-power-2030-20261010b:s3, every call for its last 41 minutes).
   */
  const refusedCredential = (
    supplied: Buffer,
  ): 'scope-stopped' | 'credential-refused' | undefined => {
    if (opts.scope.signal.aborted) return 'scope-stopped'
    return validCredential(supplied) ? undefined : 'credential-refused'
  }
  const validCredential = (supplied: Buffer): boolean => {
    if (revoked.has(supplied.toString())) return false
    if (!signingKeys)
      return (
        token !== undefined &&
        (credentialExpiresAt === undefined || Date.now() < credentialExpiresAt) &&
        supplied.length === token.length &&
        timingSafeEqual(supplied, token)
      )
    if (supplied.length > 8192) return false
    try {
      const parts = supplied.toString().split('.')
      if (parts.length !== 2) return false
      const payload = parts[0]!
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      if (!claims || typeof claims.key !== 'string' || !Object.hasOwn(signingKeys.keys, claims.key))
        return false
      const expected = createHmac('sha256', signingKeys.keys[claims.key]!).update(payload).digest()
      const signature = Buffer.from(parts[1]!, 'base64url')
      return (
        // Revocation keys use the wire token; alternate encodings must not alias it.
        signature.toString('base64url') === parts[1] &&
        signature.length === expected.length &&
        timingSafeEqual(signature, expected) &&
        claims.run === identity.runId &&
        claims.actor === identity.actorId &&
        claims.audience === credentialAudience &&
        claims.grants === grantDigest &&
        ((claims.expires === null && auth?.ttlMs === undefined) ||
          (Number.isSafeInteger(claims.expires) && claims.expires > Date.now()))
      )
    } catch {
      return false
    }
  }
  const audiences = new Set<string>()
  const paths = new Set(['/mcp'])
  // Same precedence as the router arm in coordination-driver: a caller-supplied reader, else a
  // host directory, else the manager's own environment through its scope's retained owner. A
  // provider-backed root and every nested manager come through THIS arm, so a fallback wired
  // only in the driver arm would leave a sandbox director refused by path exactly as before.
  const ownerReader =
    opts.spawnResourceReader ??
    (opts.spawnResourceRoot === undefined
      ? scopeRetainedOwnerResourceReader(opts.scope)
      : undefined)
  // Bound once the served set exists: `report_blocked` probes only what this manager was granted.
  let probeableByName: ReadonlyMap<string, McpToolDescriptor> | undefined
  const coord = createCoordinationToolsForManager(
    {
      resolveProbeTool: (name) => probeableByName?.get(name),
      scope: opts.scope,
      blobs: opts.blobs,
      makeWorkerAgent: opts.makeWorkerAgent,
      ...(opts.graphs ? { graphs: opts.graphs } : {}),
      ...(opts.authorizeDownMessage ? { authorizeDownMessage: opts.authorizeDownMessage } : {}),
      perWorker: opts.perWorker,
      ...(opts.deliverable ? { deliverable: opts.deliverable } : {}),
      ...(opts.readContinuation ? { readContinuation: opts.readContinuation } : {}),
      ...(opts.onStop ? { onStop: opts.onStop } : {}),
      ...(opts.analysts ? { analysts: opts.analysts } : {}),
      ...(opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {}),
      ...(opts.mapOnSettle ? { mapOnSettle: opts.mapOnSettle } : {}),
      ...(opts.sourceEvidenceRefs ? { sourceEvidenceRefs: opts.sourceEvidenceRefs } : {}),
      ...(opts.peerAudit ? { peerAudit: opts.peerAudit } : {}),
      ...(opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {}),
      ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
      ...(opts.continuityByProfile ? { continuityByProfile: opts.continuityByProfile } : {}),
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
      ...(opts.replaySettlements ? { replaySettlements: true } : {}),
      ...(opts.questionPolicy ? { questionPolicy: opts.questionPolicy } : {}),
      ...(opts.escalateQuestion ? { escalateQuestion: opts.escalateQuestion } : {}),
      ...(opts.onChildQuestionInbox ? { onChildQuestionInbox: opts.onChildQuestionInbox } : {}),
      ...(opts.priorEscalations?.length ? { priorEscalations: opts.priorEscalations } : {}),
      ...(opts.priorQuestions?.length ? { priorQuestions: opts.priorQuestions } : {}),
      ...(opts.priorJournal?.length ? { priorJournal: opts.priorJournal } : {}),
      ...(opts.priorAnalystDefinitions?.length
        ? { priorAnalystDefinitions: opts.priorAnalystDefinitions }
        : {}),
      ...(opts.preflightSpawn ? { preflightSpawn: opts.preflightSpawn } : {}),
      ...(opts.resolveSpawnProfile ? { resolveSpawnProfile: opts.resolveSpawnProfile } : {}),
      ...(opts.composeSpawnProfile ? { composeSpawnProfile: opts.composeSpawnProfile } : {}),
      ...(opts.profiles ? { profiles: opts.profiles } : {}),
      ...(opts.spawnResourceRoot ? { spawnResourceRoot: opts.spawnResourceRoot } : {}),
      ...(ownerReader ? { spawnResourceReader: ownerReader } : {}),
      ...(opts.peerMail
        ? {
            peerMail:
              typeof opts.peerMail === 'object' && opts.peerMail.limits
                ? { limits: opts.peerMail.limits }
                : {},
          }
        : {}),
    },
    lifetime,
  )
  await coord.ready()
  const reservedNames = new Set<string>(coord.tools.map((tool) => tool.name))
  for (const tool of opts.nodeTools ?? []) {
    if (reservedNames.has(tool.name)) {
      throw new ValidationError(
        `serveCoordinationMcp: node tool ${JSON.stringify(tool.name)} shadows a coordination verb or another node tool`,
      )
    }
    reservedNames.add(tool.name)
  }
  const nodeTools = singleFlightTools(opts.nodeTools ?? [], {
    fenceMs: responseFenceMs,
    receipts: coord,
  })
  // `submit_result` runs the injected completion check inside its request, and a product check can
  // re-run a build and a model review for minutes. Unfenced, the transport answered 504 at
  // `requestTimeoutMs` while the check kept running, so the manager never saw the verdict or its
  // reason: 25 of 25 submits in one 2026-09-22 factory run. Fenced, the call answers with a receipt
  // and the verdict reaches the manager in its next wake, from the same check.
  const fencedVerbs = singleFlightTools(
    coord.tools.filter((tool) => tool.name === DELIVERABLE_VERB),
    { fenceMs: responseFenceMs, receipts: coord },
  )
  // A rename in src/mcp/tools/coordination.ts must fail here, not leave the check unfenced and bring
  // back the 504. The test is the one that passed the deliverable to the coordination tools above.
  if (opts.deliverable && fencedVerbs.tools.length !== 1) {
    throw new ValidationError(
      `serveCoordinationMcp: a deliverable is injected but the coordination verbs lack ${DELIVERABLE_VERB}, so its check would run unfenced`,
    )
  }
  const fencedByName = new Map(fencedVerbs.tools.map((tool) => [tool.name, tool]))
  const availableTools = [
    ...coord.tools.map((tool) => fencedByName.get(tool.name) ?? tool),
    ...nodeTools.tools,
  ]
  const availableByName = new Map(availableTools.map((tool) => [tool.name, tool]))
  if (!Array.isArray(opts.toolNames)) {
    throw new ValidationError(
      'serveCoordinationMcp: toolNames must name every granted tool explicitly',
    )
  }
  const selectedNames = opts.toolNames
  if (new Set(selectedNames).size !== selectedNames.length) {
    throw new ValidationError('serveCoordinationMcp: toolNames contains a duplicate name')
  }
  const servedTools = selectedNames.map((name) => {
    const tool = availableByName.get(name)
    if (tool === undefined) {
      throw new ValidationError(
        `serveCoordinationMcp: requested tool ${JSON.stringify(name)} is unavailable`,
      )
    }
    return tool
  })
  probeableByName = new Map(servedTools.map((tool) => [tool.name, tool]))
  const mcp = createStdioToolServer({
    serverName: 'coordination',
    serverVersion: '1',
    tools: servedTools,
  })
  // Before the listener opens: a node tool invoked on the first request must already be able to
  // call these verbs. Read back the server's ordered set so every consumer records the exact MCP
  // surface.
  opts.onCoordinationTools?.([...mcp.tools.values()], coord)

  const authority = (req: IncomingMessage): CoordinationRejection | undefined => {
    // A proxy may use the destination IP as Host. A wildcard bind must
    // recognize its actual socket address without trusting forwarded names.
    const address = req.socket.localAddress?.replace(/^::ffff:/, '')
    const localAuthority = address?.includes(':')
      ? `[${address}]:${req.socket.localPort}`
      : `${address}:${req.socket.localPort}`
    const boundAuthority =
      audiences.size > 0 &&
      (host === '0.0.0.0' || host === '::') &&
      address !== undefined &&
      req.socket.localPort !== undefined &&
      req.headers.host === localAuthority
    if (!audiences.has(req.headers.host ?? '') && !boundAuthority)
      return { status: 403, reason: 'wrong-host' }
    if (closed) return { status: 401, reason: 'listener-closed' }
    return undefined
  }
  const readMcp = createStdioToolServer({
    serverName: 'supervisor-reader',
    serverVersion: '1',
    tools: coord.tools.filter(
      (tool) => tool.name === 'observe_agent' || tool.name === 'read_journal',
    ),
  })
  const readPaths = new Set<string>()
  const readHandler = coordinationHttpHandler({
    options: opts,
    identity,
    toolNames: new Set(['observe_agent', 'read_journal']),
    backgroundActions: () => 0,
    authorize: (req) => {
      const refused = authority(req)
      if (refused) return refused
      const supplied =
        typeof req.headers.authorization === 'string' &&
        req.headers.authorization.startsWith('Bearer ')
          ? Buffer.from(req.headers.authorization.slice(7))
          : Buffer.alloc(0)
      if (
        supplied.length !== readerToken.length ||
        !timingSafeEqual(supplied, readerToken) ||
        (credentialExpiresAt !== undefined && credentialExpiresAt <= Date.now())
      )
        return { status: 401, reason: 'credential-refused' }
      return undefined
    },
    handle: (message) => readMcp.handle(message),
  })
  const peerHandlers = new Map<string, ReturnType<typeof coordinationHttpHandler>>()
  const mailPaths = new Set<string>()
  const mainHandler = coordinationHttpHandler({
    options: opts,
    identity,
    toolNames: new Set(servedTools.map((tool) => tool.name)),
    handle: async (message) => {
      const response = await mcp.handle(message)
      // A coordination call is where a manager commits work, so it is when its workspace is
      // worth a checkpoint (`retained-scope-owner`, rate-limited, off the request path).
      if (message.method === 'tools/call') noteScopeRetainedOwnerCoordination(opts.scope)
      return response
    },
    backgroundActions: () => nodeTools.background() + fencedVerbs.background(),
    authorize: (req) => {
      if (!paths.has(req.url ?? '')) return { status: 404, reason: 'unknown-path' }
      const refusedAuthority = authority(req)
      if (refusedAuthority) return refusedAuthority
      if (!opts.authentication) return undefined
      const authorization = req.headers.authorization
      const supplied =
        typeof authorization === 'string' && authorization.startsWith('Bearer ')
          ? Buffer.from(authorization.slice(7))
          : Buffer.alloc(0)
      const refused = refusedCredential(supplied)
      return refused === undefined ? undefined : { status: 401, reason: refused }
    },
  })
  const server: Server = createServer((req, res) => {
    if (readPaths.has(req.url ?? '')) return readHandler(req, res)
    for (const base of mailPaths) {
      if (!(req.url ?? '').startsWith(base + '/')) continue
      const capabilityId = (req.url ?? '').slice(base.length + 1)
      const mailbox = coord.peerMail
      if (!/^[0-9a-f]{32}$/.test(capabilityId) || !mailbox?.hasCapability(capabilityId)) {
        res.writeHead(404).end()
        return
      }
      let handler = peerHandlers.get(capabilityId)
      if (!handler) {
        const peerMcp = createStdioToolServer({
          serverName: 'peer-mail',
          serverVersion: '1',
          tools: mailbox.tools(capabilityId),
        })
        handler = coordinationHttpHandler({
          options: opts,
          identity: { runId: identity.runId, actorId: 'peer' },
          toolNames: new Set(['send_mail', 'read_mail']),
          backgroundActions: () => 0,
          authorize: (request) =>
            authority(request) ??
            (!mailbox.hasCapability(capabilityId)
              ? { status: 401, reason: 'credential-refused' }
              : undefined),
          handle: (message) => peerMcp.handle(message),
        })
        peerHandlers.set(capabilityId, handler)
      }
      return handler(req, res)
    }
    return mainHandler(req, res)
  })

  server.requestTimeout = requestTimeoutMs
  server.headersTimeout = requestTimeoutMs

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0))
    })
  })

  const addressLifetime = new AbortController()
  const abortAddress = () => addressLifetime.abort(opts.scope.signal.reason)
  opts.scope.signal.addEventListener('abort', abortAddress, { once: true })
  if (opts.scope.signal.aborted) abortAddress()
  const releaseAddress = () => {
    opts.scope.signal.removeEventListener('abort', abortAddress)
    if (!addressLifetime.signal.aborted)
      addressLifetime.abort(new Error('coordination listener closed'))
  }

  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const localUrl = `http://${urlHost}:${port}/mcp`
  let url: string
  try {
    const resolver = opts.publicUrl
    const configured =
      typeof resolver === 'function'
        ? await runAbortable(
            async () => resolver({ host, port, ...identity, signal: addressLifetime.signal }),
            opts.scope.signal,
            'coordination public address resolution aborted',
          )
        : resolver
    const publicAddress = new URL(configured ?? localUrl)
    if (
      !['http:', 'https:'].includes(publicAddress.protocol) ||
      publicAddress.username ||
      publicAddress.password ||
      publicAddress.search ||
      publicAddress.hash
    ) {
      throw new ConfigError(
        'coordination publicUrl must be an HTTP endpoint without credentials, query, or fragment',
      )
    }
    if (
      configured !== undefined &&
      publicAddress.protocol !== 'https:' &&
      !isLoopbackHost(publicAddress.hostname)
    ) {
      throw new ConfigError('remote coordination publicUrl must use HTTPS')
    }
    url = publicAddress.href
    credentialAudience = url
    if (opts.authentication) rotateCredential()
    audiences.add(new URL(localUrl).host)
    audiences.add(publicAddress.host)
    if (host === '0.0.0.0' || host === '::') audiences.add(`127.0.0.1:${port}`)
    paths.add(publicAddress.pathname)
    for (const path of paths) {
      readPaths.add(path.replace(/\/$/, '') + '/read')
      mailPaths.add(path.replace(/\/$/, '') + '/mail')
    }
    if (configured !== undefined) {
      await preflightPublicCoordination({
        url,
        headers,
        signal: opts.scope.signal,
        requestTimeoutMs,
        toolNames: selectedNames,
      })
    }
  } catch (error) {
    releaseAddress()
    closed = true
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
    throw error
  }

  const mailbox = coord.peerMail
  mailbox?.setEndpoint(url.replace(/\/$/, '') + '/mail')

  const handle: CoordinationMcpHandle = {
    url,
    port,
    get readOnly() {
      if (!opts.authentication)
        throw new ConfigError('coordination read access requires authentication')
      return {
        url: url.replace(/\/$/, '') + '/read',
        headers: Object.freeze({ Authorization: `Bearer ${readerToken.toString()}` }),
      }
    },
    get headers() {
      return headers
    },
    get credentialExpiresAt() {
      return credentialExpiresAt
    },
    rotateCredential,
    settled: () => coord.settled(),
    submittedResult: () => coord.submittedResult(),
    drainResolved: () => coord.drainResolved(),
    finishAnalysis: (input) => coord.finishAnalysis(input),
    isStopped: () => coord.isStopped(),
    history: () => coord.history(),
    stats: () => coord.stats(),
    raiseFinding: (finding) => coord.raiseFinding(finding),
    mailHistory: () => mailbox?.history() ?? [],
    stopMailThread: (threadId) => mailbox?.stopThread(threadId) ?? false,
    close: async () => {
      releaseAddress()
      closed = true
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
  try {
    await runAbortable(
      async () => opts.onReadReady?.({ ...handle.readOnly, ...identity }),
      opts.scope.signal,
      'read capability publication aborted',
    )
  } catch (error) {
    await handle.close()
    throw error
  }
  return { handle, controls: coord }
}
