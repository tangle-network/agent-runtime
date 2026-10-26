/**
 * Serve the coordination verbs (spawn_worker / observe_agent / steer_agent / submit_result / stop)
 * as a real HTTP MCP server over a LIVE `Scope`, so a coding-harness agent (opencode via the
 * cli-bridge, claude-code, codex) can BE the supervisor: it mounts this MCP
 * (`mcp.mcpServers.coordination`) and `spawn_worker` lands on `Scope.spawn`.
 *
 * Coordination vs DELEGATION (`../../mcp/delegates.ts`): coordination SPAWNS workers in a CHOSEN
 * backend (sandbox OR cli-bridge) and live-drives them (observe / steer / resume, recursive
 * sub-drivers, one conserved budget); delegation runs a durable fire-and-poll coding job INSIDE
 * the agent's OWN sandbox.
 *
 * Transport: JSON-RPC over HTTP POST (MCP streamable-HTTP, single `application/json` response).
 * The server is created INSIDE an agent's `act(task, scope)` and torn down when the act returns.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import { createStdioToolServer } from '../../mcp/tool-server'
import type {
  AnalystRegistry,
  AnalyzeOnSettleRoute,
  DefinedAnalystRecord,
} from '../../mcp/tools/coordination-analysts'
import type {
  CoordinationTools,
  GraphSubtasks,
  MakeWorkerAgent,
  PeerAuditAccess,
  SettledWorker,
  SpawnPreflight,
  SuperviseProfileEntry,
} from '../../mcp/tools/coordination-contracts'
import type { CoordinationEvent, WorkerWatchOptions } from '../../mcp/tools/coordination-events'
import { createCoordinationToolsForManager } from '../../mcp/tools/coordination-manager'
import type { MapOnSettleRoute } from '../../mcp/tools/coordination-map-contracts'
import type { AuthorizeDownMessage, ContinuityMode } from '../../mcp/tools/coordination-messages'
import type {
  ChildQuestionInbox,
  EscalateQuestion,
  QuestionEscalationRecord,
  QuestionPolicy,
  QuestionRecord,
} from '../../mcp/tools/coordination-questions'
import type { SpawnResourceReader } from '../../mcp/tools/spawn-resource-paths'
import { runAbortable } from './abortable'
import { createCoordinationCredentials } from './coordination-credentials'
import { type CoordinationHttpOptions, coordinationHttpLimits } from './coordination-http'
import {
  type CoordinationListenerContext,
  createCoordinationListener,
  openCoordinationListenerState,
} from './coordination-mcp-listener'
import { bindServedTools, coordinationToolOptions } from './coordination-mcp-tools'
import { preflightPublicCoordination } from './coordination-preflight'
import { scopeRetainedOwnerResourceReader } from './retained-scope-owner'

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
  /** Independent operator capability; never persist its protected headers in profiles or journals. */
  readonly control: CoordinationControlAccess
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

/** Hosts that reach only this machine (incl. IPv4-mapped and bracketed IPv6 spellings). A name not
 *  recognizably loopback counts as REMOTE: whether it resolves to loopback is unknowable here. */
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

/** Runtime-only owned-worker control capability, separate from read and manager authority. */
export interface CoordinationControlAccess extends CoordinationReadAccess {
  readonly runId: string
  readonly actorId: string
}

export interface CoordinationTransportOptions extends CoordinationHttpOptions {
  /** Publish the read capability before dispatch, so a remote client can observe the first worker. */
  readonly onReadReady?: (
    access: CoordinationReadAccess & { readonly runId: string; readonly actorId: string },
  ) => void | Promise<void>
  /** Publish the separate operator capability before dispatch. */
  readonly onControlReady?: (access: CoordinationControlAccess) => void | Promise<void>
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
  if (options.onControlReady && !options.authentication) {
    throw new ConfigError('coordination control capability publication requires authentication')
  }
  coordinationHttpLimits(options)
}

/** The longest any coordination call holds its response, whatever the request timeout: under the
 *  60 s MCP tool-call timeout Claude Code and Codex apply by default. */
const RESPONSE_FENCE_CAP_MS = 45_000

/** The longest a fenced call (`submit_result`, node tools) holds its response before answering with
 *  a receipt: half of `requestTimeoutMs` (beating the transport's 504), at most {@link RESPONSE_FENCE_CAP_MS}. */
function coordinationResponseFenceMs(requestTimeoutMs: number): number {
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
    /** Independent completion check exposed as `submit_result`; served single-flight and fenced like
     *  `nodeTools` (a check still running at the fence returns a receipt). */
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
    /** Product-selected tools bound to this supervisor node. They share this server with the
     *  coordination verbs (the MCP duplicate-name guard applies before listen) and are served
     *  single-flight and fenced (`./single-flight-tools`): an identical call joins the running one. */
    nodeTools?: ReadonlyArray<McpToolDescriptor>
    /** Exact bare tool names to expose from the coordination and node-tool set. Runtime never
     *  grants an implicit complete tool set. An unknown name fails before the listener opens. */
    toolNames: ReadonlyArray<string>
    /**
     * OPT-IN peer mail: workers message each other directly, bounded and audited
     * (`runtime/supervise/peer-mail`). Each spawn receives a capability URL on
     * `WorkerSpawnContext.peerMailUrl`, a separate path on the listener serving only `send_mail`
     * and `read_mail` for one worker identity; it cannot authorize a manager request. The boundary
     * is between AGENTS, not processes: a worker that can read another's environment or memory
     * holds its capability. Loopback plus an unguessable path is what this layer can enforce.
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

/**
 * Resolve the address the server advertises, then bind its audiences and paths and the credential
 * to it, and prove a caller-supplied public address reaches this server. Returns the advertised URL.
 */
async function bindCoordinationAddress(
  ctx: CoordinationListenerContext,
  port: number,
  addressSignal: AbortSignal,
): Promise<string> {
  const { opts, host, identity, state } = ctx
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const localUrl = `http://${urlHost}:${port}/mcp`
  const resolver = opts.publicUrl
  const configured =
    typeof resolver === 'function'
      ? await runAbortable(
          async () => resolver({ host, port, ...identity, signal: addressSignal }),
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
  const url = publicAddress.href
  ctx.credentials.setAudience(url)
  if (opts.authentication) ctx.credentials.rotate()
  state.audiences.add(new URL(localUrl).host)
  state.audiences.add(publicAddress.host)
  if (host === '0.0.0.0' || host === '::') state.audiences.add(`127.0.0.1:${port}`)
  state.paths.add(publicAddress.pathname)
  for (const path of state.paths) {
    state.readPaths.add(path.replace(/\/$/, '') + '/read')
    state.controlPaths.add(path.replace(/\/$/, '') + '/control')
    state.mailPaths.add(path.replace(/\/$/, '') + '/mail')
  }
  if (configured !== undefined) {
    await preflightPublicCoordination({
      url,
      headers: ctx.credentials.headers,
      signal: opts.scope.signal,
      requestTimeoutMs: ctx.requestTimeoutMs,
      toolNames: opts.toolNames,
    })
  }
  return url
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
  const state = openCoordinationListenerState()
  const credentials = createCoordinationCredentials({
    authentication: opts.authentication,
    identity,
    toolNames: opts.toolNames,
    scopeSignal: opts.scope.signal,
    lifetimeSignal: lifetime,
    isClosed: () => state.closed,
  })
  const ctx: CoordinationListenerContext = {
    opts,
    host,
    identity,
    requestTimeoutMs,
    credentials,
    state,
  }
  // Same precedence as the router arm in coordination-driver: caller reader, else host directory,
  // else the manager's own environment via its retained owner. Provider-backed roots and every
  // nested manager come through THIS arm, so a driver-arm-only fallback would leave them refused.
  const ownerReader =
    opts.spawnResourceReader ??
    (opts.spawnResourceRoot === undefined
      ? scopeRetainedOwnerResourceReader(opts.scope)
      : undefined)
  // Bound once the served set exists: `report_blocked` probes only what this manager was granted.
  let probeableByName: ReadonlyMap<string, McpToolDescriptor> | undefined
  const coord = createCoordinationToolsForManager(
    coordinationToolOptions(opts, ownerReader, (name) => probeableByName?.get(name)),
    lifetime,
  )
  await coord.ready()
  const { servedTools, background } = bindServedTools(opts, coord, responseFenceMs)
  probeableByName = new Map(servedTools.map((tool) => [tool.name, tool]))
  const mcp = createStdioToolServer({
    serverName: 'coordination',
    serverVersion: '1',
    tools: servedTools,
  })
  // Before the listener opens, so a node tool on the first request can call these verbs; read back
  // the ordered set so every consumer records the exact MCP surface.
  opts.onCoordinationTools?.([...mcp.tools.values()], coord)

  const server = createCoordinationListener(ctx, { coord, mcp, servedTools, background })
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

  let url: string
  try {
    url = await bindCoordinationAddress(ctx, port, addressLifetime.signal)
  } catch (error) {
    releaseAddress()
    state.closed = true
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
        headers: Object.freeze({ Authorization: `Bearer ${credentials.readerToken.toString()}` }),
      }
    },
    get headers() {
      return credentials.headers
    },
    get control() {
      if (!opts.authentication)
        throw new ConfigError('coordination control access requires authentication')
      return {
        ...identity,
        url: url.replace(/\/$/, '') + '/control',
        headers: credentials.controllerHeaders,
      }
    },
    get credentialExpiresAt() {
      return credentials.expiresAt
    },
    rotateCredential: credentials.rotate,
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
      state.closed = true
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
    await runAbortable(
      async () => opts.onControlReady?.(handle.control),
      opts.scope.signal,
      'control capability publication aborted',
    )
  } catch (error) {
    await handle.close()
    throw error
  }
  return { handle, controls: coord }
}
